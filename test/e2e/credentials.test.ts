import { describe, it, expect, beforeEach, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { existsSync, rmSync } from 'node:fs'

const testDir = join(tmpdir(), 'sjtu-test-credentials-' + Date.now())

let mockEncryptionAvailable = true

vi.mock('electron', () => {
  return {
    app: {
      getPath: vi.fn(() => testDir),
      whenReady: vi.fn().mockResolvedValue(undefined),
      isReady: vi.fn().mockReturnValue(true),
      quit: vi.fn()
    },
    safeStorage: {
      isEncryptionAvailable: vi.fn(() => mockEncryptionAvailable),
      encryptString: vi.fn((plain: string) => Buffer.from('mock_encrypted_' + plain)),
      decryptString: vi.fn((buf: Buffer) => buf.toString().replace(/^mock_encrypted_/, ''))
    }
  }
})

import {
  saveCredential,
  listMaskedCredentials,
  updateCredentialLabel,
  deleteCredential,
  clearAllCredentials,
  getCredentialForFill,
  encryptPassword,
  decryptPassword
} from '../../src/main/credentials'

describe('Credentials Vault Suite', () => {
  beforeEach(async () => {
    mockEncryptionAvailable = true
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
    await clearAllCredentials()
  })

  it('encrypts and decrypts passwords safely', () => {
    const original = 'SjtuSecretPassword2026!'
    const encrypted = encryptPassword(original)
    expect(encrypted).not.toContain(original)
    const decrypted = decryptPassword(encrypted)
    expect(decrypted).toBe(original)
  })

  it('falls back to AES-256-GCM encryption when safeStorage is unavailable', () => {
    mockEncryptionAvailable = false
    const original = 'FallbackPassword2026!'
    const encrypted = encryptPassword(original)
    expect(encrypted.startsWith('aes:')).toBe(true)
    expect(encrypted).not.toContain(original)
    const decrypted = decryptPassword(encrypted)
    expect(decrypted).toBe(original)
  })

  it('saves new credential and lists masked version', async () => {
    const res = await saveCredential('student001', 'my_pass_123', '本科主账号')
    expect(res.ok).toBe(true)
    expect(res.id).toBeDefined()

    const list = await listMaskedCredentials()
    expect(list.length).toBe(1)
    expect(list[0].username).toBe('student001')
    expect(list[0].label).toBe('本科主账号')
    expect(list[0].maskedPassword).toBe('••••••••')
    expect((list[0] as unknown as { encryptedPassword?: string }).encryptedPassword).toBeUndefined()
  })

  it('updates password and label when saving existing username', async () => {
    await saveCredential('student001', 'old_pass', '旧别名')
    await saveCredential('student001', 'new_pass', '新别名')

    const list = await listMaskedCredentials()
    expect(list.length).toBe(1)
    expect(list[0].label).toBe('新别名')

    const fill = await getCredentialForFill(list[0].id)
    expect(fill.ok).toBe(true)
    expect(fill.password).toBe('new_pass')
  })

  it('updates credential label independently', async () => {
    const saved = await saveCredential('student002', 'pass2', '初版别名')
    const updateRes = await updateCredentialLabel(saved.id!, '修改后别名')
    expect(updateRes.ok).toBe(true)

    const list = await listMaskedCredentials()
    expect(list[0].label).toBe('修改后别名')
  })

  it('retrieves fill data and updates lastUsedAt', async () => {
    const saved = await saveCredential('student003', 'pass3')
    const beforeFill = (await listMaskedCredentials())[0].lastUsedAt

    // 稍微等待确保时间戳前进
    await new Promise(r => setTimeout(r, 10))
    const fill = await getCredentialForFill(saved.id!)
    expect(fill.ok).toBe(true)
    expect(fill.username).toBe('student003')
    expect(fill.password).toBe('pass3')

    const afterFill = (await listMaskedCredentials())[0].lastUsedAt
    expect(afterFill).toBeGreaterThanOrEqual(beforeFill)
  })

  it('deletes specific credential and clears all', async () => {
    const c1 = await saveCredential('userA', 'pA')
    const c2 = await saveCredential('userB', 'pB')
    expect((await listMaskedCredentials()).length).toBe(2)

    await deleteCredential(c1.id!)
    const afterDel = await listMaskedCredentials()
    expect(afterDel.length).toBe(1)
    expect(afterDel[0].username).toBe('userB')

    await clearAllCredentials()
    expect((await listMaskedCredentials()).length).toBe(0)
  })
})
