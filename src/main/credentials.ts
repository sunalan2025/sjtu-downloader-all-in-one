import { app, safeStorage } from 'electron'
import { join, dirname } from 'node:path'
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, unlinkSync } from 'node:fs'
import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from 'node:crypto'
import type { StoredCredential, MaskedCredential } from '../shared/types'

// AES-256-GCM 兜底高熵独立秘钥管理（当运行环境无 safeStorage 时使用）
let _cachedFallbackKey: Buffer | null = null

export function _resetFallbackKeyForTesting(): void {
  _cachedFallbackKey = null
}

function getFallbackKey(): Buffer {
  if (_cachedFallbackKey) return _cachedFallbackKey
  try {
    if (app && typeof app.getPath === 'function') {
      const keyDir = join(app.getPath('userData'), 'credentials')
      mkdirSync(keyDir, { recursive: true })
      const keyPath = join(keyDir, '.fallback.key')
      if (existsSync(keyPath)) {
        const key = readFileSync(keyPath)
        if (key.length === 32) {
          _cachedFallbackKey = key
          return key
        }
      }
      const newKey = randomBytes(32)
      writeFileSync(keyPath, newKey, { mode: 0o600 })
      _cachedFallbackKey = newKey
      return newKey
    }
  } catch {
    /* ignore and fallback to in-memory random bytes */
  }
  _cachedFallbackKey = randomBytes(32)
  return _cachedFallbackKey
}

function fallbackEncrypt(plain: string): string {
  const key = getFallbackKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  let encrypted = cipher.update(plain, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const authTag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`
}

function fallbackDecrypt(cipherText: string): string {
  const parts = cipherText.split(':')
  if (parts.length !== 3) {
    throw new Error('Invalid fallback cipher format')
  }
  const [ivHex, authTagHex, encryptedHex] = parts
  const key = getFallbackKey()
  const iv = Buffer.from(ivHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}

export function encryptPassword(plain: string): string {
  if (safeStorage && typeof safeStorage.isEncryptionAvailable === 'function' && safeStorage.isEncryptionAvailable()) {
    try {
      const encBuf = safeStorage.encryptString(plain)
      return 'safe:' + encBuf.toString('base64')
    } catch {
      /* safeStorage 失败回退到 AES */
    }
  }
  return 'aes:' + fallbackEncrypt(plain)
}

export function decryptPassword(cipher: string): string {
  if (cipher.startsWith('safe:')) {
    if (safeStorage && typeof safeStorage.decryptString === 'function') {
      const buf = Buffer.from(cipher.slice(5), 'base64')
      return safeStorage.decryptString(buf)
    }
    throw new Error('safeStorage is not available to decrypt this credential')
  }
  if (cipher.startsWith('aes:')) {
    return fallbackDecrypt(cipher.slice(4))
  }
  // 兼容未带前缀的旧数据
  try {
    if (safeStorage && typeof safeStorage.decryptString === 'function') {
      const buf = Buffer.from(cipher, 'base64')
      return safeStorage.decryptString(buf)
    }
  } catch {
    /* ignore */
  }
  return fallbackDecrypt(cipher)
}

export const encryptSecret = encryptPassword
export const decryptSecret = decryptPassword

function getCredentialsFilePath(): string {
  return join(app.getPath('userData'), 'credentials', 'accounts.enc.json')
}

let memoryCredentialsCache: StoredCredential[] | null = null

function loadStoredCredentials(): StoredCredential[] {
  if (memoryCredentialsCache !== null) {
    return memoryCredentialsCache
  }
  const filePath = getCredentialsFilePath()
  if (!existsSync(filePath)) {
    memoryCredentialsCache = []
    return []
  }
  try {
    const raw = readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      memoryCredentialsCache = parsed
      return parsed
    }
  } catch (e) {
    console.error('[credentials] failed to parse credentials file:', e)
  }
  memoryCredentialsCache = []
  return []
}

function writeStoredCredentials(credentials: StoredCredential[]): void {
  const filePath = getCredentialsFilePath()
  const dir = dirname(filePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  const tmpPath = filePath + '.tmp'
  writeFileSync(tmpPath, JSON.stringify(credentials, null, 2), 'utf8')
  renameSync(tmpPath, filePath)
  memoryCredentialsCache = credentials
}

export async function listMaskedCredentials(): Promise<MaskedCredential[]> {
  const creds = loadStoredCredentials()
  return creds
    .map(c => ({
      id: c.id,
      username: c.username,
      label: c.label,
      maskedPassword: '••••••••',
      createdAt: c.createdAt,
      lastUsedAt: c.lastUsedAt
    }))
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
}

export async function saveCredential(
  username: string,
  password: string,
  label?: string
): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    const creds = loadStoredCredentials()
    const now = Date.now()
    const encryptedPassword = encryptPassword(password)
    const existingIndex = creds.findIndex(c => c.username === username)

    let savedId: string
    if (existingIndex >= 0) {
      savedId = creds[existingIndex].id
      creds[existingIndex] = {
        ...creds[existingIndex],
        label: label !== undefined ? label : creds[existingIndex].label,
        encryptedPassword,
        lastUsedAt: now
      }
    } else {
      savedId = `cred_${now}_${Math.random().toString(36).slice(2, 8)}`
      creds.push({
        id: savedId,
        username,
        label,
        encryptedPassword,
        createdAt: now,
        lastUsedAt: now
      })
    }
    writeStoredCredentials(creds)
    return { ok: true, id: savedId }
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to save credential' }
  }
}

export async function updateCredentialLabel(
  id: string,
  label?: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const creds = loadStoredCredentials()
    const index = creds.findIndex(c => c.id === id)
    if (index === -1) {
      return { ok: false, error: 'Credential not found' }
    }
    creds[index].label = label
    writeStoredCredentials(creds)
    return { ok: true }
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to update label' }
  }
}

export async function deleteCredential(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const creds = loadStoredCredentials()
    const filtered = creds.filter(c => c.id !== id)
    writeStoredCredentials(filtered)
    return { ok: true }
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to delete credential' }
  }
}

export async function clearAllCredentials(): Promise<{ ok: boolean; error?: string }> {
  try {
    const filePath = getCredentialsFilePath()
    if (existsSync(filePath)) {
      unlinkSync(filePath)
    }
    memoryCredentialsCache = []
    return { ok: true }
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to clear credentials' }
  }
}

export async function getCredentialForFill(
  id?: string
): Promise<{ ok: boolean; username?: string; password?: string; error?: string }> {
  try {
    const creds = loadStoredCredentials()
    if (creds.length === 0) {
      return { ok: false, error: 'No credentials stored' }
    }
    let target = id ? creds.find(c => c.id === id) : null
    if (!target) {
      // 默认按最近一次使用排序
      target = [...creds].sort((a, b) => b.lastUsedAt - a.lastUsedAt)[0]
    }
    if (!target) {
      return { ok: false, error: 'Credential not found' }
    }
    // 更新 lastUsedAt
    target.lastUsedAt = Date.now()
    writeStoredCredentials(creds)

    const plainPassword = decryptPassword(target.encryptedPassword)
    return { ok: true, username: target.username, password: plainPassword }
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to decrypt credential' }
  }
}
