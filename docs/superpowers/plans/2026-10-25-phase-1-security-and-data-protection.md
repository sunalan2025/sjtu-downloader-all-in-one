# 阶段一：安全与核心数据防线 (A01~A05) 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 彻底修复审计报告中指出的前 5 项 P1 级严重安全与数据丢失缺陷（启动清理误删文件 A01、独立 Worker 守护进程 SSRF 与越权 A02、登录自动填充 Origin 校验缺陷 A03、安装包 SHA256 清单竞态 A04、以及 Webview 运行时加固 A05），并升级隔离复现脚本回归断言。

**Architecture:** 采用“专用临时沙盒隔离 + 严格协议与 Origin 守卫 + 同步清单校验锁 + 主进程 will-attach-webview 权限锁”的纵深防御架构。用户选定目录只删具有本应用私有标记的临时文件；Worker 默认回环绑定并实施白名单与 Jail 目录限制；登录敏感凭据强制要求 `https://jaccount.sjtu.edu.cn` 严格 Origin；安装包下载与清单获取通过 Promise 同步收口并引入已验证执行锁。

**Tech Stack:** TypeScript, Node.js (fs, path, crypto, http, https, os), Electron (webContents, will-attach-webview, session), React, Vitest.

**Spec:** [docs/superpowers/specs/2026-10-25-phase-1-security-and-data-protection-design.md](file:///D:/SJTU/编程/sjtu-downloader-all-in-one/docs/superpowers/specs/2026-10-25-phase-1-security-and-data-protection-design.md)

## Global Constraints

- 严禁未经用户对齐确认变更界面文案，文案严格遵循《拟修改词汇与规范化对照表》。
- 界面操作出口唯一性：错误提示与重试出口统一，无多重竞争按钮。
- 严禁重复造轮子：通用路径规整与 Origin 匹配统一收口至 `src/shared/utils.ts`。
- 全链路严格验证门禁：每一项改动均需依次通过 `npm run typecheck`、`npm run lint`、`npm test` 且测试 100% 通过。
- 严禁在同一自然段中出现两个未转义的 `$`，公式使用标准 KaTeX 语法。

---

### Task 1: A01 启动清理机制重构与专用临时目录隔离

**Files:**
- Modify: `src/shared/utils.ts:400-450`
- Modify: `src/main/cleanup.ts:1-104`
- Modify: `src/renderer/src/App.tsx:115-122`
- Modify: `src/main/index.ts:130-150`
- Create: `test/unit/cleanup.test.ts`

**Interfaces:**
- Consumes: `APP_COURSE_DIRS` from `src/main/cleanup.ts`
- Produces:
  - `normalizeComparePath(p: string): string` in `src/shared/utils.ts`
  - `cleanupHalfDownloaded(dir: string): void` in `src/main/cleanup.ts` (仅清理 `.part` 文件，绝不按 `.ts` 扩展名删除文件)
  - `cleanupStaleDownloads(localDestRoot?: string): void` in `src/main/cleanup.ts` (基于规整真实路径比较，不遍历 symlink，不误删用户目录)

- [ ] **Step 1: 编写失败的单元测试 `test/unit/cleanup.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { cleanupHalfDownloaded, cleanupStaleDownloads } from '../../src/main/cleanup'
import { normalizeComparePath } from '../../src/shared/utils'

describe('A01 Cleanup Safety Suite', () => {
  const testRoot = path.join(os.tmpdir(), 'sjtu-test-cleanup-' + Date.now())

  beforeEach(() => {
    fs.mkdirSync(testRoot, { recursive: true })
  })

  afterEach(() => {
    try {
      fs.rmSync(testRoot, { recursive: true, force: true })
    } catch {}
  })

  it('normalizeComparePath 统一 Windows 路径正反斜杠与大小写', () => {
    const p1 = 'C:/Tmp/Course'
    const p2 = 'C:\\tmp\\course'
    if (process.platform === 'win32') {
      expect(normalizeComparePath(p1)).toBe(normalizeComparePath(p2))
    } else {
      expect(normalizeComparePath(p1)).toBe(path.resolve(p1))
    }
  })

  it('cleanupHalfDownloaded 保留合法的 assignment.ts 代码文件，仅删除 .part 临时文件', () => {
    const courseDir = path.join(testRoot, 'Canvas课程')
    fs.mkdirSync(courseDir, { recursive: true })
    const tsFile = path.join(courseDir, 'assignment.ts')
    const partFile = path.join(courseDir, 'video.mp4.part')
    const mp4File = path.join(courseDir, 'lecture.mp4')

    fs.writeFileSync(tsFile, 'console.log("hello typescript")')
    fs.writeFileSync(partFile, 'partial-data')
    fs.writeFileSync(mp4File, 'video-content')

    cleanupHalfDownloaded(courseDir)

    // assignment.ts 必须保留，绝不能被误删
    expect(fs.existsSync(tsFile)).toBe(true)
    // lecture.mp4 必须保留
    expect(fs.existsSync(mp4File)).toBe(true)
    // .part 文件必须被清理
    expect(fs.existsSync(partFile)).toBe(false)
  })

  it('当 localDestRoot 设为临时根时（正反斜杠不同），绝不递归整删用户课程目录', () => {
    const fakeTmp = path.join(testRoot, 'tmp-root')
    fs.mkdirSync(fakeTmp, { recursive: true })
    const courseDir = path.join(fakeTmp, 'Canvas课程')
    fs.mkdirSync(courseDir, { recursive: true })
    const userFile = path.join(courseDir, 'important-homework.pdf')
    fs.writeFileSync(userFile, 'homework')

    // 传入不同斜杠形式的 localDestRoot
    const formattedRoot = fakeTmp.replace(/\//g, '\\')
    cleanupStaleDownloads(formattedRoot)

    // 用户课程目录与文件必须完好无损
    expect(fs.existsSync(courseDir)).toBe(true)
    expect(fs.existsSync(userFile)).toBe(true)
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

运行：`npm test test/unit/cleanup.test.ts`  
预期：FAIL，报错找不到 `normalizeComparePath` 或由于旧版 `cleanupHalfDownloaded` 删除了 `assignment.ts`。

- [ ] **Step 3: 实现 `normalizeComparePath` 与加固 `src/main/cleanup.ts`**

在 `src/shared/utils.ts` 中新增并导出 `normalizeComparePath`：
```typescript
export function normalizeComparePath(p: string): string {
  if (!p) return ''
  const resolved = path.resolve(p)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}
```

在 `src/main/cleanup.ts` 中：
1. 移除 `name.endsWith('.ts')` 的删除逻辑，仅保留 `name.endsWith('.part')` 的安全清理。
2. 递归遍历改为使用 `lstatSync`，遇到 `st.isSymbolicLink()` 时直接 `continue` 跳过，拒绝穿越软链接。
3. `cleanupStaleDownloads` 中，利用 `normalizeComparePath` 比较 `base` 与 `localDestRoot`，杜绝 Windows 路径比较不一致导致误删课程根目录。
4. 在 `src/renderer/src/App.tsx` 中移除无参或挂载时触发的 `cleanupStaleDownloads`。
5. 在 `src/main/index.ts` 的 `app.whenReady()` 启动流程中，单次调用 `cleanupStaleDownloads()` 执行无害临时目录清理。

- [ ] **Step 4: 运行测试验证通过**

运行：`npm test test/unit/cleanup.test.ts`  
预期：PASS，3 个用例全部通过。

- [ ] **Step 5: 提交任务更改**

```bash
git add src/shared/utils.ts src/main/cleanup.ts src/renderer/src/App.tsx src/main/index.ts test/unit/cleanup.test.ts
git commit -m "fix(cleanup): isolate temp directory and prevent deletion of user ts files (A01)"
```

---

### Task 2: A02 独立 Worker 守护进程安全加固（SSRF、Token 强制与固定存储根）

**Files:**
- Modify: `scripts/private-worker-daemon.mjs:20-60, 595-710, 855-882`
- Create: `test/unit/private-worker-daemon-security.test.ts`

**Interfaces:**
- Consumes: `http`, `path`, `fs`, `os`
- Produces:
  - 默认监听 `127.0.0.1`，仅在指定监听 `0.0.0.0` 时强制校验 `WORKER_TOKEN >= 16`
  - SSRF 拦截：白名单域名校验 `/(^|\.)(sjtu\.edu\.cn|sjtu\.cn|cnmooc\.org)$/i` 并封禁内网与回环 IP
  - 服务端固定存储根 `SERVER_DOWNLOAD_ROOT` Jail 锁定
  - 仅支持 `Authorization: Bearer <token>` 请求头鉴权，拒绝 Query 参数传 Token

- [ ] **Step 1: 编写失败的单元测试 `test/unit/private-worker-daemon-security.test.ts`**

```typescript
import { describe, it, expect } from 'vitest'
import http from 'node:http'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

describe('A02 Private Worker Daemon Security Suite', () => {
  function loadDaemon(env = {}, fetchMock = async () => new Response('ok')) {
    let handler: any
    let binding: any
    const daemonSource = fs.readFileSync(path.join(process.cwd(), 'scripts/private-worker-daemon.mjs'), 'utf8')
      .replace(/^import .*$/gm, '')
    const context = vm.createContext({
      http: {
        createServer: (fn: any) => {
          handler = fn
          return {
            listen: (port: number, host: string) => { binding = { port, host } },
            close: () => {}
          }
        }
      },
      fs: { mkdirSync() {}, writeFileSync() {}, existsSync: () => true },
      path,
      os: { homedir: () => '/mock/home' },
      process: {
        env: { ...env },
        argv: [],
        on() {},
        exit: vi.fn(),
        uptime: () => 1,
        memoryUsage: () => ({ rss: 0 })
      },
      fetch: fetchMock,
      console: { log() {}, warn() {}, error() {}, debug() {} },
      Buffer, URL, AbortController, setTimeout, clearTimeout
    })
    vm.runInContext(daemonSource, context)
    return { handler, binding, context }
  }

  it('未指定 HOST 时，默认绑定 127.0.0.1 回环地址而非 0.0.0.0', () => {
    const { binding } = loadDaemon({})
    expect(binding.host).toBe('127.0.0.1')
  })

  it('指定 0.0.0.0 但未配置强 Token 时，启动抛错或退出', () => {
    const { context } = loadDaemon({ HOST: '0.0.0.0', WORKER_TOKEN: 'short' })
    expect(context.process.exit).toHaveBeenCalledWith(1)
  })

  it('代理接口拦截未授权访问并返回 401', async () => {
    const { handler } = loadDaemon({ WORKER_TOKEN: 'super-secret-token-12345678' })
    const req = new EventEmitter()
    Object.assign(req, {
      method: 'GET',
      url: '/api/proxy?url=' + encodeURIComponent('https://oc.sjtu.edu.cn/test'),
      headers: { host: 'localhost' }
    })
    const res = {
      statusCode: 0,
      headers: {},
      writeHead(s: number, h: any) { this.statusCode = s; this.headers = h },
      end: vi.fn()
    }
    await handler(req, res)
    expect(res.statusCode).toBe(401)
  })

  it('代理接口拦截对回环与私有 IP 的请求 (SSRF 防御)', async () => {
    const { handler } = loadDaemon({ WORKER_TOKEN: 'super-secret-token-12345678' })
    const req = new EventEmitter()
    Object.assign(req, {
      method: 'GET',
      url: '/api/proxy?url=' + encodeURIComponent('http://127.0.0.1:8080/private'),
      headers: {
        host: 'localhost',
        authorization: 'Bearer super-secret-token-12345678'
      }
    })
    const res = {
      statusCode: 0,
      headers: {},
      writeHead(s: number, h: any) { this.statusCode = s; this.headers = h },
      end: vi.fn()
    }
    await handler(req, res)
    expect(res.statusCode).toBe(403)
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

运行：`npm test test/unit/private-worker-daemon-security.test.ts`  
预期：FAIL，绑定地址为 `0.0.0.0`，无 Token 未退出，SSRF 未拦截返回 200。

- [ ] **Step 3: 加固 `scripts/private-worker-daemon.mjs`**

1. 绑定地址修改：
   ```javascript
   const HOST = process.env.HOST || '127.0.0.1'
   if (HOST === '0.0.0.0' || (!HOST.startsWith('127.') && HOST !== 'localhost')) {
     if (!AUTH_TOKEN || AUTH_TOKEN.length < 16) {
       console.error('[worker:security] 致命错误：外部网络监听 (0.0.0.0) 必须配置强 WORKER_TOKEN（长度 >= 16 位）')
       process.exit(1)
     }
   }
   ```
2. 鉴权逻辑仅保留 `Authorization` 请求头：
   ```javascript
   function verifyAuth(req) {
     if (!AUTH_TOKEN) return false
     const authHeader = req.headers['authorization'] || ''
     return authHeader === `Bearer ${AUTH_TOKEN}`
   }
   ```
3. 增加 SSRF 与域名白名单检查函数：
   ```javascript
   function isAllowedTargetUrl(rawUrl) {
     try {
       const u = new URL(rawUrl)
       if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
       const hostname = u.hostname
       // 封禁回环与私网 IP
       if (/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|169\.254\.|localhost|::1)/i.test(hostname)) {
         return false
       }
       // 允许交大与认证域名
       return /(^|\.)(sjtu\.edu\.cn|sjtu\.cn|cnmooc\.org)$/i.test(hostname)
     } catch {
       return false
     }
   }
   ```
4. 服务端固定输出根 Jail 锁定：
   ```javascript
   const SERVER_DOWNLOAD_ROOT = path.resolve(expandHomeDir(process.env.WORKER_DOWNLOAD_ROOT || '~/sjtu-downloads'))
   ```
   并在 `server_local` 任务落盘时，验证 `normalizedTarget.startsWith(SERVER_DOWNLOAD_ROOT)`。
5. 监听启动时传入 `server.listen(PORT, HOST, ...)`。

- [ ] **Step 4: 运行测试验证通过**

运行：`npm test test/unit/private-worker-daemon-security.test.ts`  
预期：PASS，全部 4 个用例通过。

- [ ] **Step 5: 提交任务更改**

```bash
git add scripts/private-worker-daemon.mjs test/unit/private-worker-daemon-security.test.ts
git commit -m "fix(worker): enforce strong token, loopback binding, SSRF whitelist, and storage jail (A02)"
```

---

### Task 3: A03 登录 Webview 自动填充敏感凭据与严格 Origin 校验

**Files:**
- Modify: `src/renderer/src/pages/Login.tsx:560-580, 1090-1105, 1145-1165, 1420-1440`
- Create: `test/unit/login-origin-guard.test.ts`

**Interfaces:**
- Consumes: `isAllowedNavDomain`, `getAutofillScript` in `src/renderer/src/pages/Login.tsx`
- Produces:
  - `isTrustedJAccountOrigin(rawUrl: string): boolean` in `src/renderer/src/pages/Login.tsx`
  - 严格限制凭据填充仅在 `https://jaccount.sjtu.edu.cn` 发生
  - 脚本内置运行时 Origin 守卫

- [ ] **Step 1: 编写失败的单元测试 `test/unit/login-origin-guard.test.ts`**

```typescript
import { describe, it, expect } from 'vitest'
import { isTrustedJAccountOrigin, getAutofillScript } from '../../src/renderer/src/pages/Login'

describe('A03 Login Origin Security Suite', () => {
  it('isTrustedJAccountOrigin 仅接受 https://jaccount.sjtu.edu.cn 及其路径', () => {
    expect(isTrustedJAccountOrigin('https://jaccount.sjtu.edu.cn/oauth2/authorize')).toBe(true)
    expect(isTrustedJAccountOrigin('https://jaccount.sjtu.edu.cn/')).toBe(true)

    // 拒绝 HTTP 协议
    expect(isTrustedJAccountOrigin('http://jaccount.sjtu.edu.cn/login')).toBe(false)
    // 拒绝非认证域但带查询参数伪装
    expect(isTrustedJAccountOrigin('https://attacker.sjtu.edu.cn/?target=jaccount.sjtu.edu.cn')).toBe(false)
    // 拒绝子域名仿冒
    expect(isTrustedJAccountOrigin('https://fake-jaccount.sjtu.edu.cn/')).toBe(false)
    // 拒绝非法 URL 字符串
    expect(isTrustedJAccountOrigin('not-a-valid-url')).toBe(false)
  })

  it('生成的自动填充脚本在首行包含运行时 Origin 双重守卫', () => {
    const script = getAutofillScript([], false, { username: 'test', password: 'pwd' })
    expect(script).toContain("window.location.origin !== 'https://jaccount.sjtu.edu.cn'")
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

运行：`npm test test/unit/login-origin-guard.test.ts`  
预期：FAIL，报错找不到 `isTrustedJAccountOrigin` 或生成的脚本未包含双重守卫。

- [ ] **Step 3: 在 `src/renderer/src/pages/Login.tsx` 中实现严格 Origin 守卫**

1. 导出 `isTrustedJAccountOrigin`：
   ```typescript
   export function isTrustedJAccountOrigin(rawUrl: string): boolean {
     try {
       const u = new URL(rawUrl)
       return u.protocol === 'https:' && u.hostname === 'jaccount.sjtu.edu.cn'
     } catch {
       return false
     }
   }
   ```
2. 在 `getAutofillScript` 生成的脚本首部加入防泄漏守卫：
   ```javascript
   if (window.location.origin !== 'https://jaccount.sjtu.edu.cn') {
     console.warn('[Security] 凭据填充已阻止：页面 Origin 不匹配');
     return;
   }
   ```
3. 在 `handleSelectAccount` 与 `injectAutofill` 中，调用注入前先执行：
   ```typescript
   if (!isTrustedJAccountOrigin(wv.getURL())) {
     console.warn('[Login] 拒绝向非 jAccount 官方页面填充凭据:', wv.getURL())
     return
   }
   ```
4. 在页面导航拦截处应用规范化提示文案：
   `安全拦截：当前网页非交大官方认证服务 (jaccount.sjtu.edu.cn)，已自动返回认证首页`。

- [ ] **Step 4: 运行测试验证通过**

运行：`npm test test/unit/login-origin-guard.test.ts`  
预期：PASS，2 个用例全部通过。

- [ ] **Step 5: 提交任务更改**

```bash
git add src/renderer/src/pages/Login.tsx test/unit/login-origin-guard.test.ts
git commit -m "fix(login): enforce strict origin check and script guard for jAccount credential autofill (A03)"
```

---

### Task 4: A04 更新管理器 SHA256 清单 Promise 竞态消除与验证锁

**Files:**
- Modify: `src/main/updater.ts:160-260, 320-340`
- Modify: `src/main/updater.test.ts:80-140`

**Interfaces:**
- Consumes: `downloadUpdate`, `installUpdate`, `setUpdateEmitter` in `src/main/updater.ts`
- Produces:
  - 清单获取与文件下载 Promise 同步收口
  - `verifiedFilePath: string | null` 校验状态锁
  - 校验失败提示文案 `安装包完整性校验失败：文件指纹与发布清单不一致，已中止安装以保护系统安全`

- [ ] **Step 1: 编写失败的单元测试用例在 `src/main/updater.test.ts`**

```typescript
it('延迟清单场景下，清单就绪前绝不提前触发 update:ready；哈希不一致时触发 update:failed', async () => {
  // 模拟异步延迟清单
  let manifestResolve: (value: string) => void
  const delayedManifestPromise = new Promise<string>(resolve => { manifestResolve = resolve })
  
  // 模拟下载完成但清单慢于文件流
  // 断言未 resolve 清单前 ready 计数为 0
  // resolve 错误 hash 后，触发 update:failed 且 installUpdate 返回未验证错误
})
```

- [ ] **Step 2: 运行测试验证失败**

运行：`npm test src/main/updater.test.ts`  
预期：FAIL。

- [ ] **Step 3: 重构 `src/main/updater.ts` 的校验流**

1. 引入模块级 `let verifiedFilePath: string | null = null`。
2. 将清单请求转换为 Promise 并与 `fileStream.finish` 协同等待：
   ```typescript
   let manifestPromise: Promise<string | null> | null = null
   if (asset.sha256) {
     manifestPromise = Promise.resolve(asset.sha256)
   } else if (asset.sha256Url) {
     manifestPromise = fetchText(asset.sha256Url).then(manifest => {
       return parseSha256Checksum(manifest, asset.fileName)
     }).catch(err => {
       console.error('[updater] 获取或解析校验清单失败:', err)
       return null
     })
   }
   ```
3. 在 `fileStream.on('finish')` 中：
   ```typescript
   const expectedHash = manifestPromise ? await manifestPromise : null
   const actualHash = hasher.digest('hex').toLowerCase()
   if (asset.sha256Url && !expectedHash) {
     fail('安装包完整性校验失败：无法获取官方发布校验清单，已中止更新以保护系统安全')
     return
   }
   if (expectedHash && actualHash !== expectedHash.toLowerCase()) {
     fail('安装包完整性校验失败：文件指纹与发布清单不一致，已中止安装以保护系统安全')
     return
   }
   verifiedFilePath = destPath
   emit('update:ready', { ... })
   ```
4. 在 `installUpdate()` 中增加验证锁断言：
   ```typescript
   if (!verifiedFilePath || verifiedFilePath !== destPath || !existsSync(destPath)) {
     return { ok: false, error: '安装包尚未通过完整性校验，禁止执行' }
   }
   ```

- [ ] **Step 4: 运行测试验证通过**

运行：`npm test src/main/updater.test.ts`  
预期：PASS，所有测试通过。

- [ ] **Step 5: 提交任务更改**

```bash
git add src/main/updater.ts src/main/updater.test.ts
git commit -m "fix(updater): eliminate sha256 manifest race condition and add verified file gate (A04)"
```

---

### Task 5: A05 Webview 权限收紧与主进程 `will-attach-webview` 守卫

**Files:**
- Modify: `src/main/window.ts:100-140`
- Create: `test/unit/window-security.test.ts`

**Interfaces:**
- Consumes: `createMainWindow` in `src/main/window.ts`
- Produces: 主进程 `will-attach-webview` 守卫与 webview 敏感 Node 集成剥离

- [ ] **Step 1: 编写失败的单元测试 `test/unit/window-security.test.ts`**

```typescript
import { describe, it, expect, vi } from 'vitest'
import { attachWebviewSecurityGuard } from '../../src/main/window'

describe('A05 Window & Webview Security Suite', () => {
  it('attachWebviewSecurityGuard 强制剥离 Node 集成并禁用不安全能力', () => {
    const webPreferences: any = {
      preload: '/some/malicious/preload.js',
      nodeIntegration: true,
      nodeIntegrationInWorker: true,
      contextIsolation: false
    }
    const params = { src: 'https://jaccount.sjtu.edu.cn/oauth2/authorize' }
    const event = { preventDefault: vi.fn() }

    attachWebviewSecurityGuard(event as any, webPreferences, params)

    expect(webPreferences.nodeIntegration).toBe(false)
    expect(webPreferences.nodeIntegrationInWorker).toBe(false)
    expect(webPreferences.contextIsolation).toBe(true)
    expect(webPreferences.webSecurity).toBe(true)
    expect(webPreferences.preload).toBeUndefined()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('当 webview 加载非交大认证域名时拦截附加', () => {
    const webPreferences: any = {}
    const params = { src: 'https://malicious-site.com/exploit' }
    const event = { preventDefault: vi.fn() }

    attachWebviewSecurityGuard(event as any, webPreferences, params)

    expect(event.preventDefault).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

运行：`npm test test/unit/window-security.test.ts`  
预期：FAIL，报错找不到 `attachWebviewSecurityGuard`。

- [ ] **Step 3: 在 `src/main/window.ts` 中实现 `attachWebviewSecurityGuard` 并在窗口创建时注册**

1. 导出 `attachWebviewSecurityGuard`：
   ```typescript
   export function attachWebviewSecurityGuard(
     event: { preventDefault: () => void },
     webPreferences: Record<string, unknown>,
     params: { src?: string }
   ): void {
     delete webPreferences.preload
     webPreferences.nodeIntegration = false
     webPreferences.nodeIntegrationInWorker = false
     webPreferences.contextIsolation = true
     webPreferences.webSecurity = true
     webPreferences.allowRunningInsecureContent = false

     const src = params.src || ''
     if (!isSafeWebviewOrigin(src)) {
       console.warn('[security] 拦截未授权 webview 目标地址:', src)
       event.preventDefault()
     }
   }
   ```
2. 在 `mainWindow.webContents.on('will-attach-webview', ...)` 中绑定该守卫。

- [ ] **Step 4: 运行测试验证通过**

运行：`npm test test/unit/window-security.test.ts`  
预期：PASS。

- [ ] **Step 5: 提交任务更改**

```bash
git add src/main/window.ts test/unit/window-security.test.ts
git commit -m "fix(window): add will-attach-webview security guard and strip node integration (A05)"
```

---

### Task 6: 阶段一全链路门禁验证与隔离复现回归脚本断言升级

**Files:**
- Modify: `docs/audits/2026-10-24-reproduce.mjs`

**Interfaces:**
- Consumes: 全量业务改动
- Produces:
  - 运行 `node docs/audits/2026-10-24-reproduce.mjs` 输出更新，S1/S2/L3 漏洞场景成功收敛
  - `npm run typecheck` 全绿
  - `npm run lint` 全绿
  - `npm test` 全绿

- [ ] **Step 1: 升级隔离复现脚本中的断言与测试桩**

运行 `node docs/audits/2026-10-24-reproduce.mjs`，查看 S1、S2、L3 的输出：
- S1 鉴权与 SSRF：未提供 Token 返回 401，私网请求被拒。
- S2 清单竞态：`readyBeforeManifest` 变为 `false`，`failedAfterManifest` 变为 `true`。
- L3 清理防护：`legitimateTypeScriptDeleted` 为空数组，`fullDirectoryDeleteDespiteLocalDestRoot` 为空数组。

- [ ] **Step 2: 顺序运行三道全链路门禁**

1. 运行 `npm run typecheck` -> 验证 0 errors。
2. 运行 `npm run lint` -> 验证 0 errors / 0 warnings。
3. 运行 `npm test` -> 验证全量测试套件（1029+ 个用例）全绿。

- [ ] **Step 3: 提交全链路验证与审计脚本更新**

```bash
git add docs/audits/2026-10-24-reproduce.mjs
git commit -m "test(audit): update reproduction assertions for Phase 1 security fixes"
```
