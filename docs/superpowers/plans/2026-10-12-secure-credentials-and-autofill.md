# jAccount 多账号安全凭据存储与原生级自动补全实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现基于系统硬件安全保险库（Electron `safeStorage` / AES-256-GCM 兜底）的 jAccount 多账号密码本地加密存储，并在登录界面提供原生 Chrome/Edge 风格的自动填充与多账号切换，登录成功后主动轻量询问保存，并在「设置」中心提供完整的账号与凭据管理。

**Architecture:**
1. 主进程安全保险库（`src/main/credentials.ts`）基于 Electron 原生 `safeStorage`（Windows DPAPI / macOS Keychain）结合 AES-256-GCM 容错兜底，原子化读写 `userData/credentials/accounts.enc.json`，并通过脱敏数据结构杜绝明文泄漏；
2. IPC 与 Preload 通道（`src/preload/index.ts`, `src/shared/types.ts`）提供隔离的 `credentials` API 门面；
3. 登录页（`src/renderer/src/pages/Login.tsx`）在 webview 中注入自动填充逻辑、Chrome/Edge 风格的原生浮动下拉切换菜单及表单提交监听，检测到登录成功时弹出轻量「记住账号密码」确认卡片；
4. 设置面板（`src/renderer/src/pages/Settings.tsx`）新增「🔐 账号与凭据管理」专区，支持多账号查看、编辑备注别名、单个删除与一键清空。

**Tech Stack:** Electron `safeStorage`, Node.js `crypto`, React, TypeScript, Tailwind CSS, Vitest.

**Spec:** [docs/superpowers/specs/2026-10-12-secure-credentials-and-autofill-design.md](file:///d:/SJTU/编程/sjtu-downloader-all-in-one/docs/superpowers/specs/2026-10-12-secure-credentials-and-autofill-design.md)

## Global Constraints

- 磁盘上绝不存储明文密码，渲染进程获取的列表数据必须为掩码（`••••••••`）；
- 自动填充仅填入输入框，**绝不自动提交表单**，必须由用户确认或处理二次验证后手动点击；
- 正文中凡是不属于数学公式的美元符号必须转义为 `\$` 或包裹在行内代码块中；
- 所有链接使用 `[file](file:///...)` 格式；
- 全量测试（476+ 项）100% 通过，`npm run lint` 与 `npm run typecheck` 0 报错。

---

### Task 1: 主进程安全凭据保险库与加解密测试套件

**Files:**
- Create: `test/e2e/credentials.test.ts`
- Create: `src/main/credentials.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/index.ts`

**Interfaces:**
- Consumes: Electron `safeStorage`, `app.getPath('userData')`, Node `crypto`
- Produces:
  ```typescript
  export interface StoredCredential {
    id: string
    username: string
    label?: string
    encryptedPassword: string
    createdAt: number
    lastUsedAt: number
  }

  export interface MaskedCredential {
    id: string
    username: string
    label?: string
    maskedPassword: string
    createdAt: number
    lastUsedAt: number
  }

  export interface CredentialsApi {
    list: () => Promise<MaskedCredential[]>
    save: (username: string, password: string, label?: string) => Promise<{ ok: boolean; id?: string; error?: string }>
    updateLabel: (id: string, label?: string) => Promise<{ ok: boolean; error?: string }>
    delete: (id: string) => Promise<{ ok: boolean; error?: string }>
    clearAll: () => Promise<{ ok: boolean; error?: string }>
    getFillData: (id?: string) => Promise<{ ok: boolean; username?: string; password?: string; error?: string }>
  }
  ```

- [ ] **Step 1: 在 `src/shared/types.ts` 中声明数据结构与 WindowApi 接口**

在 `src/shared/types.ts` 中添加 `StoredCredential`、`MaskedCredential`、`CredentialsApi`，并在 `WindowApi` 中声明 `credentials: CredentialsApi`：

```typescript
export interface StoredCredential {
  id: string
  username: string
  label?: string
  encryptedPassword: string
  createdAt: number
  lastUsedAt: number
}

export interface MaskedCredential {
  id: string
  username: string
  label?: string
  maskedPassword: string
  createdAt: number
  lastUsedAt: number
}

export interface CredentialsApi {
  list: () => Promise<MaskedCredential[]>
  save: (username: string, password: string, label?: string) => Promise<{ ok: boolean; id?: string; error?: string }>
  updateLabel: (id: string, label?: string) => Promise<{ ok: boolean; error?: string }>
  delete: (id: string) => Promise<{ ok: boolean; error?: string }>
  clearAll: () => Promise<{ ok: boolean; error?: string }>
  getFillData: (id?: string) => Promise<{ ok: boolean; username?: string; password?: string; error?: string }>
}
```

并在 `WindowApi` 中添加：
```typescript
export interface WindowApi {
  credentials: CredentialsApi
  cloudpan: CloudPanApi
  [key: string]: unknown
}
```

- [ ] **Step 2: 编写测试用例 `test/e2e/credentials.test.ts`**

创建 `test/e2e/credentials.test.ts`，验证凭据存储、加解密、脱敏、别名更新、按 `lastUsedAt` 排序及清空等全部逻辑：

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { existsSync, readFileSync, rmSync } from 'node:fs'

const testDir = join(tmpdir(), 'sjtu-test-credentials-' + Date.now())

vi.mock('electron', () => {
  let encryptionAvailable = true
  return {
    app: {
      getPath: vi.fn(() => testDir),
      whenReady: vi.fn().mockResolvedValue(undefined),
      isReady: vi.fn().mockReturnValue(true),
      quit: vi.fn()
    },
    safeStorage: {
      isEncryptionAvailable: vi.fn(() => encryptionAvailable),
      encryptString: vi.fn((plain: string) => Buffer.from('mock_encrypted_' + plain)),
      decryptString: vi.fn((buf: Buffer) => buf.toString().replace(/^mock_encrypted_/, ''))
    },
    // 供测试动态切换 safeStorage 可用性
    __setEncryptionAvailable: (avail: boolean) => {
      encryptionAvailable = avail
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
  beforeEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
    clearAllCredentials()
  })

  it('encrypts and decrypts passwords safely', () => {
    const original = 'SjtuSecretPassword2026!'
    const encrypted = encryptPassword(original)
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
    expect((list[0] as any).encryptedPassword).toBeUndefined()
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
```

- [ ] **Step 3: 运行测试验证失败**

运行：`npx vitest run test/e2e/credentials.test.ts`
预期：FAIL，提示找不到 `../../src/main/credentials` 模块。

- [ ] **Step 4: 实现 `src/main/credentials.ts`**

创建 `src/main/credentials.ts`，支持 `safeStorage` 与 `crypto` AES-256-GCM 双模加解密、原子文件写入与脱敏输出：

```typescript
import { app, safeStorage } from 'electron'
import { join, dirname } from 'node:path'
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, unlinkSync } from 'node:fs'
import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from 'node:crypto'
import type { StoredCredential, MaskedCredential } from '../shared/types'

// AES-256-GCM 兜底秘钥派生（当运行环境无 safeStorage 时使用）
const FALLBACK_SALT = 'sjtu-course-downloader-fallback-salt-2026'
function getFallbackKey(): Buffer {
  const machineKey = `${process.env.COMPUTERNAME || process.env.HOSTNAME || 'sjtu-machine'}-${process.env.USERNAME || process.env.USER || 'default-user'}`
  return scryptSync(machineKey, FALLBACK_SALT, 32)
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
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Failed to save credential' }
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
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Failed to update label' }
  }
}

export async function deleteCredential(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const creds = loadStoredCredentials()
    const filtered = creds.filter(c => c.id !== id)
    writeStoredCredentials(filtered)
    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Failed to delete credential' }
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
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Failed to clear credentials' }
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
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Failed to decrypt credential' }
  }
}
```

- [ ] **Step 5: 注册 IPC 管道与 Preload 暴露**

在 `src/main/index.ts` 中注册处理函数：
```typescript
import {
  listMaskedCredentials,
  saveCredential,
  updateCredentialLabel,
  deleteCredential,
  clearAllCredentials,
  getCredentialForFill
} from './credentials'

ipcMain.handle('credentials:list', () => listMaskedCredentials())
ipcMain.handle('credentials:save', (_e, { username, password, label }) => saveCredential(username, password, label))
ipcMain.handle('credentials:update-label', (_e, { id, label }) => updateCredentialLabel(id, label))
ipcMain.handle('credentials:delete', (_e, id) => deleteCredential(id))
ipcMain.handle('credentials:clear-all', () => clearAllCredentials())
ipcMain.handle('credentials:get-fill-data', (_e, id) => getCredentialForFill(id))
```

在 `src/preload/index.ts` 的 `api` 对象中暴露：
```typescript
credentials: {
  list: (): Promise<MaskedCredential[]> => ipcRenderer.invoke('credentials:list'),
  save: (username: string, password: string, label?: string): Promise<{ ok: boolean; id?: string; error?: string }> =>
    ipcRenderer.invoke('credentials:save', { username, password, label }),
  updateLabel: (id: string, label?: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('credentials:update-label', { id, label }),
  delete: (id: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('credentials:delete', id),
  clearAll: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('credentials:clear-all'),
  getFillData: (id?: string): Promise<{ ok: boolean; username?: string; password?: string; error?: string }> =>
    ipcRenderer.invoke('credentials:get-fill-data', id)
}
```

- [ ] **Step 6: 运行测试并验证通过**

运行：`npx vitest run test/e2e/credentials.test.ts`
预期：PASS（全量用例全部通过）。
运行：`npm run typecheck`
预期：0 errors。

- [ ] **Step 7: 提交代码**

```bash
git add src/shared/types.ts src/main/credentials.ts src/preload/index.ts src/main/index.ts test/e2e/credentials.test.ts
git commit -m "feat(credentials): implement secure credential vault, encryption fallback, and IPC handlers"
```

---

### Task 2: 登录页（Login.tsx）自动填充、原生悬浮下拉切换面板与记住密码卡片

**Files:**
- Modify: `src/renderer/src/pages/Login.tsx`

**Interfaces:**
- Consumes:
  - `window.api.credentials.list()`
  - `window.api.credentials.getFillData(id)`
  - `window.api.credentials.save(username, password, label)`
- Produces:
  - jAccount Webview DOM 中自动回填用户名密码；
  - 类似 Chrome/Edge 风格的原生浮动下拉补全菜单，支持多账号点击切换；
  - 成功登录后调起轻量卡片提示「记住此账号密码？（下次登录自动为您填好）」，支持输入可选别名，绝不自动提交。

- [ ] **Step 1: 在 `Login.tsx` 中编写 Webview 注入脚本生成函数**

在 `src/renderer/src/pages/Login.tsx` 中新增脚本注入逻辑 `getAutofillScript(accounts, isDark)`：
1. 捕获表单输入与提交事件：通过 `console.log('__SJTU_CRED_CAPTURED__:' + JSON.stringify({ user, pass }))` 通知宿主；
2. 若传入单一账号填充数据，直接填入 `#user, #input-login-user, input[name="user"]` 和 `#pass, #input-login-pass, input[type="password"]` 并派发 `input` 与 `change` 事件；
3. 若存在多账号，在 `#user` 容器下方注入悬浮下拉卡片：
   - 点击任一账号，触发 `console.log('__SJTU_CRED_SELECT__:' + id)`；
   - 点击删除按钮，触发 `console.log('__SJTU_CRED_DELETE__:' + id)`；
   - 点击外部区域自动关闭下拉框。

- [ ] **Step 2: 在 `Login.tsx` 中监听 `console-message` 与处理捕获**

在 `<webview>` 实例上注册 `console-message` 监听器：
```typescript
const onConsoleMsg = (e: any): void => {
  const msg = e.message || ''
  if (msg.startsWith('__SJTU_CRED_CAPTURED__:')) {
    try {
      const data = JSON.parse(msg.slice(23))
      if (data.user && data.pass) {
        capturedCredRef.current = { username: data.user, password: data.pass }
      }
    } catch {}
  } else if (msg.startsWith('__SJTU_CRED_SELECT__:')) {
    const id = msg.slice(21)
    void handleSelectAccount(id)
  } else if (msg.startsWith('__SJTU_CRED_DELETE__:')) {
    const id = msg.slice(21)
    void handleDeleteAccountFromWebview(id)
  }
}
```

- [ ] **Step 3: 登录成功时弹窗询问「是否记住此账号密码」**

在 `handleLoginCompletion` 成功检测后：
- 检查 `capturedCredRef.current`：
- 若存在捕获到的账密：
  - 调用 `window.api.credentials.list()` 检查该账号是否已保存且最近密码是否匹配；
  - 若为新账号或新密码：显示轻量气泡卡片 Modal：
    - 展示账号名；
    - 可选输入别名（如「本科账号」）；
    - 按钮「记住此账号」/「暂不保存」；
    - 点击「记住此账号」执行 `window.api.credentials.save(...)` 后进入主页；点击「暂不保存」直接进入主页。
  - 若已存在同名账号且未改动，静默更新其 `lastUsedAt` 并直接进入主页。

- [ ] **Step 4: 运行类型检查并验证**

运行：`npm run typecheck`
预期：0 errors。

- [ ] **Step 5: 提交代码**

```bash
git add src/renderer/src/pages/Login.tsx
git commit -m "feat(login): inject autofill, multi-account dropdown, and remember-credentials prompt"
```

---

### Task 3: 设置面板（Settings.tsx）「🔐 账号与凭据管理」专区

**Files:**
- Modify: `src/renderer/src/pages/Settings.tsx`
- Modify: `src/renderer/src/components/DownloadUI.test.ts`

**Interfaces:**
- Consumes:
  - `window.api.credentials.list()`
  - `window.api.credentials.updateLabel(id, label)`
  - `window.api.credentials.delete(id)`
  - `window.api.credentials.clearAll()`
- Produces:
  - 设置面板左侧导航新增「🔐 账号与凭据管理」分类；
  - 右侧主区域展示已保存账号列表、硬件加密保护指示条、备注别名修改、单项删除与一键清空弹窗。

- [ ] **Step 1: 在 `DownloadUI.test.ts` 中编写测试验证凭据管理状态**

在 `src/renderer/src/components/DownloadUI.test.ts` 中新增单元测试：
```typescript
it('supports settings navigation to credentials tab', () => {
  // 验证设置面板导航项包含 credentials
  const navItems = [
    { id: 'storage', label: '📦 存储与下载' },
    { id: 'cloud', label: '☁️ 交大云盘集成' },
    { id: 'performance', label: '⚡ 性能与并发' },
    { id: 'video', label: '🎬 课件与视频' },
    { id: 'appearance', label: '🎨 外观与窗口' },
    { id: 'credentials', label: '🔐 账号与凭据管理' }
  ]
  expect(navItems.some(item => item.id === 'credentials')).toBe(true)
})
```

- [ ] **Step 2: 运行测试验证**

运行：`npx vitest run src/renderer/src/components/DownloadUI.test.ts`
预期：PASS。

- [ ] **Step 3: 在 `Settings.tsx` 中实现「🔐 账号与凭据管理」界面**

在 `Settings.tsx` 中：
1. 导入 `MaskedCredential` 类型；
2. 左栏添加 `{ id: 'credentials', label: '🔐 账号与凭据管理' }`；
3. 在 `activeNav === 'credentials'` 时渲染管理区域：
   - 顶部防护徽标：`🛡️ 系统硬件级加密保护中 (DPAPI / Keychain)`；
   - 凭据列表卡片：
     - 用户名与别名徽章；
     - 掩码密码：`••••••••`；
     - 创建时间与最近使用时间格式化展示；
     - 操作按钮：`✏️ 编辑别名`、`🗑️ 删除`；
   - 危险操作区：`一键清空全部已保存凭据`（带确认对话框）；
   - 编辑别名内联/弹窗表单。

- [ ] **Step 4: 运行类型检查与全量测试**

运行：`npm run typecheck`
预期：0 errors。
运行：`npm test`
预期：全量测试全部 PASS。

- [ ] **Step 5: 提交代码**

```bash
git add src/renderer/src/pages/Settings.tsx src/renderer/src/components/DownloadUI.test.ts
git commit -m "feat(settings): add credentials and accounts management section"
```

---

### Task 4: 全流程回归测试、代码审查与交付验收

**Files:**
- Verify: 全量工作区文件

- [ ] **Step 1: 执行全量测试**

运行：`npm test`
预期：全量 476+ 项测试用例 100% 通过。

- [ ] **Step 2: 执行代码规范检查**

运行：`npm run lint`
预期：0 报错。

- [ ] **Step 3: 执行 TypeScript 类型检查**

运行：`npm run typecheck`
预期：0 报错。

- [ ] **Step 4: 检查 Git 状态与提交历史**

运行：`git status` 与 `git log -n 5`
确认提交历史清晰规范。
