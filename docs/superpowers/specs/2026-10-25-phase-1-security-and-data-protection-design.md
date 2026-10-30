# 阶段一设计规范：安全与核心数据防线 (A01 ~ A05)

**设计日期**：2026-10-25  
**目标版本**：2.5.1-security-patch  
**关联审查报告**：[2026-10-24-review.md](file:///D:/SJTU/编程/sjtu-downloader-all-in-one/docs/audits/2026-10-24-review.md)（问题编号：A01、A02、A03、A04、A05）

---

## 1. 架构目标与阶段范围

阶段一聚焦于解决审查报告中风险等级最高、直接危及用户本地已有文件与敏感凭据的阻断性缺陷（P1）：
1. **A01（清理安全）**：彻底消除对用户合法文件（如 Canvas 下载的 `.ts` 代码文件）及完整课程目录的误删风险，规范 Windows 路径匹配与沙箱隔离。
2. **A02（Worker 守护进程安全）**：默认限制回环绑定，强化强制强密钥校验，防御 SSRF（禁止内网及回环访问），锁定服务端固定输出根（Jail 机制），禁止 URL 明文传参。
3. **A03（登录凭据防泄漏）**：严密限制自动填充与凭据注入的页面 Origin，强制 HTTPS 严格匹配 `https://jaccount.sjtu.edu.cn`，杜绝子串绕过与非认证域脚本注入。
4. **A04（更新完整性竞态消除）**：重构 SHA256 异步校验流，确保文件下载与清单解析同步等待；未经验证通过的安装包绝对不可安装。
5. **A05（Webview 运行时加固）**：在主进程全局注册 `will-attach-webview` 守卫，剥离 Node.js、Worker Node 权限，加固运行时沙箱隔离。

---

## 2. 拟修改词汇与规范化对照表

| 原表述 / 待定表述 | 拟规范化表述 | 修改考量与用户体验收益 |
| :--- | :--- | :--- |
| `[Login] blocked navigation to unexpected domain` (静默控制台) | `安全拦截：当前网页非交大官方认证服务 (jaccount.sjtu.edu.cn)，已自动返回认证首页` | 提升用户对钓鱼/非认证页面的安全防护感知，告知页面重置原因，杜绝误以为软件卡死 |
| `下载失败：哈希不匹配` / 静默降级安装 | `安装包完整性校验失败：文件指纹与发布清单不一致，已中止安装以保护系统安全` | 动词先行、表意严谨，让师生明确安装包安全阻断原因并杜绝执行不可信产物 |
| `Unauthorized` | `授权失败：访问密钥 (Token) 不匹配` | 通俗化中文，指示具体排查原因（Token 填写错误） |
| `检测到非法路径穿越尝试` | `存储路径无效：禁止访问受保护的根目录以外路径` | 消除生硬技术黑话，清晰表意服务端沙箱越界拒绝原因 |

---

## 3. 详细设计与实现方案

### 3.1 A01 · 启动清理与临时文件隔离重构

#### 根因剖析
- 原 `cleanupHalfDownloaded` 直接匹配 `name.endsWith('.ts')`，将无同名 `.mp4` 的合法 TypeScript 课件作业误认为 HLS 碎片直接 `unlinkSync`。
- 原 `cleanupStaleDownloads` 使用简单字符串比较 `base === localDestRoot`，Windows 下正反斜杠（`C:/tmp` vs `C:\\tmp`）、大小写与尾斜杠差异导致未能识别用户目录恰好位于临时路径，从而误将整个课程目录递归 `rmSync`。
- `statSync` 默认跟随符号链接与 Junction，缺乏真实路径边界检查。
- 清理在 `App.tsx` 页面挂载时重复触发，易引发正在运行任务的误删。

#### 重构设计
1. **主进程一次性启动触发**：
   - 将清理入口移至 Electron 主进程启动钩子（`app.whenReady()` 后执行一次），彻底从 Renderer 端（`App.tsx`）剔除。
2. **应用专用临时沙盒目录隔离**：
   - 所有中间临时产物（包括 HLS 分片、PPT 转存缓冲）统一放在系统临时目录下的独立命名空间：
     `path.join(os.tmpdir(), 'sjtu-downloader-temp', subCategory)`
   - HLS 下载在沙盒临时目录内完成所有分片拉取与 remux 转封装，生成最终有效 `.mp4` 后，再通过原子移动（`fs.renameSync` 或流式复制）发布至用户选定的成品目录。
3. **用户成品目录免扫保护**：
   - 用户成品目录（`localDestRoot`）只允许清理带明确应用私有标识的文件（例如仅清理 `.part` 文件，严禁清理 `.ts` 扩展名）。
4. **强健的规范化真实路径比较**：
   - 采用统一的规范化工具函数：
     ```typescript
     function normalizeComparePath(p: string): string {
       const resolved = path.resolve(p)
       return process.platform === 'win32' ? resolved.toLowerCase() : resolved
     }
     ```
   - 比较 `normalizeComparePath(base) === normalizeComparePath(localDestRoot)`，彻底杜绝 Windows 路径格式误判。
   - 遍历文件时使用 `lstatSync` 代替 `statSync`，遇到 `isSymbolicLink()` 时跳过，严禁穿越符号链接。

---

### 3.2 A02 · 独立 Worker 守护进程安全防御

#### 根因剖析
- 默认监听 `0.0.0.0`，无 Token 时直接放行，使得任意能够连通端口的外部网络均可调用 Worker。
- `/api/proxy` 与下载接口未对目标 URL 做内网 IP 解析封禁，且盲目转发客户端 Cookie，存在 SSRF 风险。
- `serverDownloadDir` 允许客户端任意指定，仅依靠相对路径过滤无法限制服务端绝对路径逃逸。

#### 重构设计
1. **监听绑定与强 Token 强制门禁**：
   - 默认监听地址改为 `127.0.0.1`（配合 SSH 隧道安全转发）。
   - 若用户通过 CLI 或环境变量显式指定监听 `0.0.0.0` 或局域网/公网 IP，守护进程启动时**强制校验** `WORKER_TOKEN`：
     - 若 `!WORKER_TOKEN || WORKER_TOKEN.length < 16`，守护进程直接抛出致命错误并退出进程（`process.exit(1)`），拒绝不安全对外暴露。
2. **SSRF 与域名目标白名单**：
   - 代理接口与下载任务仅允许向交大官方域名及白名单服务发起请求：
     - 白名单主机正则：`/(^|\.)(sjtu\.edu\.cn|sjtu\.cn|cnmooc\.org)$/i`。
   - 解析目标 IP，严禁连接回环地址（`127.0.0.0/8`, `::1`）、私有内网地址（`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`）及链路本地地址。
   - 请求重定向（Redirect）在守护进程内逐跳（hop-by-hop）校验，防止通过 302 重定向到内网。
   - 隔离 Cookie：禁止在代理请求中将客户端全量 Cookie 广播至任意第三方，仅携带白名单目标域匹配的凭据。
3. **服务端固定输出根 Jail 机制**：
   - 服务端配置固定的基准输出根目录 `SERVER_DOWNLOAD_ROOT`（默认为 `~/sjtu-downloads`，可通过环境变量或启动参数锁定）。
   - 客户端传入的相对路径只能作为该根目录下的子路径；使用 `path.resolve` 与 `fs.realpathSync` 验证其真实绝对路径必须以 `SERVER_DOWNLOAD_ROOT` 开头，严防路径越权。
4. **Header 唯一鉴权通道**：
   - 鉴权统一收口至 `Authorization: Bearer <token>` 请求头。
   - 移除 URL query 中的 `?token=...` 支持，防止 Token 被记录在 Web 访问日志中。

---

### 3.3 A03 · 登录 Webview 自动填充敏感凭据与严格 Origin 校验

#### 根因剖析
- 页面导航仅检查域名后缀（`isAllowedNavDomain`），未限定 `https:` 协议。
- 自动填充触发逻辑采用 `url.includes('jaccount.sjtu.edu.cn')`，攻击者可在查询参数注入该子串诱导填充。
- 自动填充脚本将明文账号密码直接拼入待注入脚本，且脚本内部缺乏运行时二次 Origin 守卫。

#### 重构设计
1. **协议与 Origin 严格校验函数**：
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
2. **多重守卫链**：
   - **导航守卫**：Webview `did-navigate` 和 `will-navigate` 时，严格限制协议必须为 `https:`，域名必须匹配交大白名单列表。
   - **触发前校验**：在调用 `injectAutofill()` 或 `handleSelectAccount()` 时，必须先通过 `isTrustedJAccountOrigin(wv.getURL())` 验证当前页面 Origin。
   - **脚本内置运行时二次校验**：在注入的 JavaScript 字符串首部加入守卫：
     ```javascript
     if (window.location.origin !== 'https://jaccount.sjtu.edu.cn') {
       throw new Error('Security check failed: untrusted origin');
     }
     ```
3. **安全拦截提示**：
   - 若 Webview 尝试跳转非白名单 URL，强制重定向至交大统一认证首页，并提示规范化文案：
     `安全拦截：当前网页非交大官方认证服务 (jaccount.sjtu.edu.cn)，已自动返回认证首页`。

---

### 3.4 A04 · 更新管理器 SHA256 清单竞态消除与验证锁

#### 根因剖析
- `updater.ts` 中 `fetchText(asset.sha256Url)` 为非阻塞 Promise，若安装包文件先于清单下载完成，`expectedSha256` 仍为 `null`，导致跳过哈希校验直接触发 `update:ready`。
- 安装接口 `installUpdate()` 仅基于本地文件存在性判断，缺乏已验证状态标识。

#### 重构设计
1. **文件流与清单获取协同等待**：
   - 定义校验准备 Promise：
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
2. **双重就绪检查**：
   - 当安装包写入流 `fileStream` 触发 `finish` 时，必须 `await manifestPromise`。
   - 若声明了 `sha256Url` 但获取失败或未解析到匹配项，**严禁静默降级**，必须触发 `fail('安装包完整性校验失败：文件指纹与发布清单不一致，已中止安装以保护系统安全')`。
   - 计算得到实际哈希 `actualHash`，必须与 `expectedSha256` 全字符匹配（大小写无关）。
3. **已验证状态锁（Verified Gate）**：
   - 维护模块级状态 `let verifiedFilePath: string | null = null`。
   - 只有在哈希完全吻合时，才设置 `verifiedFilePath = destPath` 并发送 `update:ready`。
   - 在 `installUpdate()` 执行时，增加前置守卫：
     ```typescript
     if (!verifiedFilePath || verifiedFilePath !== destPath || !existsSync(destPath)) {
       return { ok: false, error: '安装包尚未通过完整性校验，禁止执行' }
     }
     ```
   - 一旦触发重新下载、取消或校验失败，立即将 `verifiedFilePath` 置为 `null`。

---

### 3.5 A05 · Webview 权限收紧与纵深防御

#### 根因剖析
- Electron 开启了 `webviewTag: true` 且 `sandbox: false`，若 Webview 内载入第三方不可信内容，可能利用旧版 Electron 的漏洞启用 Node 集成或逃逸。

#### 重构设计
1. **主进程全局 `will-attach-webview` 守卫**：
   - 在 `src/main/window.ts` 中，监听主窗口 `webContents` 的 `will-attach-webview` 事件：
     ```typescript
     mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
       // 强制剔除所有 Node 运行时及高级权限
       delete webPreferences.preload
       webPreferences.nodeIntegration = false
       webPreferences.nodeIntegrationInWorker = false
       webPreferences.contextIsolation = true
       webPreferences.webSecurity = true
       webPreferences.allowRunningInsecureContent = false
       // 校验 webview 的 src 是否为合法的交大认证入口
       if (!isSafeWebviewUrl(params.src)) {
         event.preventDefault()
       }
     })
     ```
2. **全局 `web-contents-created` 拦截**：
   - 监听所有新创建的 `webContents`，严禁通过 `window.open` 开启未经安全审核的新窗口，统一经由 `shell.openExternal` 校验外部链接。

---

## 4. 验证与门禁标准

阶段一实施完毕后，必须顺序通过以下严格门禁：

1. **隔离复现脚本验收**：
   - 运行 `node docs/audits/2026-10-24-reproduce.mjs`，验证：
     - `S1-default-worker-and-SSRF`：无鉴权请求被 401 拦截，回环及私网访问被拒。
     - `S2-updater-manifest-race`：延迟清单测试中，未返回清单前绝不触发 `update:ready`，哈希不匹配时正确触发 `update:failed`。
     - `L3-cleanup-data-loss`：`assignment.ts` 得到保留；Windows 路径不发生误删。
2. **自动化测试套件**：
   - 补充针对 A01、A02、A03、A04、A05 的单元测试用例。
   - `npm test` 100% 通过（保持 1029+ 个测试全绿）。
3. **全链路工程门禁**：
   - `npm run typecheck`（TypeScript 静态类型检查 0 错误）。
   - `npm run lint`（ESLint 检查 0 错误 0 警告）。
