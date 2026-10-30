# P0 严重安全漏洞修复与安装包完整性校验实施方案

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 彻底消除架构审计中发现的 3 项 P0 级严重安全漏洞：全量加密敏感会话 Token（C-1）、自动更新安装包 SHA-256 数字指纹校验与 CI/CD 产物哈希生成（C-2）、macOS 更新脚本参数化执行以杜绝 shell 注入（C-3），并筑牢全链路自动化验证门禁。

**Architecture:** 
1. 会话持久化采用全文件密文存储体系（`session.enc`），通过 Electron `safeStorage`（系统级密钥链）配合 AES-256-GCM 兜底进行结构化加密与原子落盘，启动时主动消除老旧明文 `session.json`。
2. 自动更新链路采用“发布流哈希清单 + 客户端流式哈希校验”闭环：CI 构建 Release 时自动生成 `SHA256SUMS.txt` 挂载至发布资产；客户端检查与下载更新时提取目标平台 SHA-256 指纹，下载落盘同时进行流式哈希比对，不符即刻清理阻断。
3. macOS 更新脚本剥离字符串插值，固化为严格接收 `$1`、`$2` 位置参数的静态脚本模板，并施加 `.app` 路径合法性与系统敏感目录拦截白名单。

**Tech Stack:** Node.js Crypto (AES-256-GCM, SHA-256), Electron `safeStorage`, GitHub Actions (`release.yml`), Vitest, TypeScript.

**Spec / Baseline Document:** `C:\Users\MINISUNSHINE\.gemini\antigravity\brain\eb7ff9be-e088-407c-b547-f2221adaf548\architecture-review.md`

## Global Constraints

- **Single Source of Truth & DRY**: 加密与工具函数复用已有的加密模式或抽取至统一辅助模块，严禁在页面与模块中重复造轮子。
- **Audience-Centric Copywriting**: 严格遵守规范化词汇库，所有向用户展示的错误、提示均以友好通俗的师生视角呈现，杜绝“哈希”、“Hash”、“Shell”等技术黑话。
- **Mandatory Complete Verification Gate**: 任何改动必须依次全绿通过 `npm run typecheck`、`npm run lint` 与 `npm test`（100% 通过且无回归）。

---

## 拟修改词汇与规范化对照表 (UI Copywriting Alignment)

| 原表述 / 待定表述 | 拟规范化表述 | 修改考量与用户体验收益 |
|---|---|---|
| `SHA-256 哈希校验失败` / `hash mismatch` | `更新安装包完整性校验未通过，可能文件已损坏或网络传输异常` | 消除纯技术黑话（“哈希”、“Hash”），向师生用户准确表达原因并打消安全疑虑 |
| `无法定位 .app 路径` | `无法定位应用安装目录，请前往官网重新下载` | 将底层系统路径词汇通俗化为清晰明确的用户操作指引 |
| `校验和不匹配，文件可能被篡改` | `安装包数字指纹不匹配，为了您的系统安全已终止更新` | 突出对用户设备的安全守护，语气严谨专业且不过度引起恐慌 |
| `session.json 损坏或未加密` | `登录会话已失效，请重新登录` | 隐藏内部落盘文件名细节，聚焦用户下一步动作 |

---

## Tasks

### Task 1: C-1 Token 全量加密持久化与旧明文安全清理

**Files:**
- Modify: `src/main/auth.ts:35-90`
- Modify: `src/main/credentials.ts:40-75` (导出通用加解密函数供全应用复用)
- Test: `test/e2e/auth-session.test.ts`

**Interfaces:**
- Consumes: `encryptSecret(plain: string): string`, `decryptSecret(cipher: string): string`
- Produces: `saveSessionStore(data: Partial<PersistedSession>): void`, `loadSessionStoreRaw(): PersistedSession | null` 切换为读写 `session.enc`，且若检测到遗留的 `session.json` 时予以物理删除。

- [x] **Step 1: 编写针对 `session.enc` 加密落盘与旧文件清理的测试用例**

在 `test/e2e/auth-session.test.ts` 中新增单元测试：
1. 验证 `saveSessionStore` 写入的文件扩展名为 `.enc` 且内容非普通 JSON 明文；
2. 验证 `loadSessionStoreRaw` 能正确解密恢复完整的 `PersistedSession` 对象；
3. 验证当磁盘上残留旧明文 `session.json` 时，加载或保存逻辑会自动物理清理旧文件，防止残留泄漏。

- [x] **Step 2: 运行测试验证失败**

运行: `npx vitest run test/e2e/auth-session.test.ts`  
预期: FAIL（因为当前代码仍读写 `session.json` 且内容为明文 JSON）。

- [x] **Step 3: 提取通用加解密工具并改造 `auth.ts`**

1. 将 `src/main/credentials.ts` 中的 `encryptPassword` / `decryptPassword` 通用化并导出别名 `encryptSecret` / `decryptSecret`；
2. 在 `src/main/auth.ts` 中：
   - 将 `getSessionFilePath()` 指向 `session.enc`；
   - 在 `saveSessionStore()` 中，将 JSON 序列化字符串通过 `encryptSecret` 加密后再写入临时文件并重命名为 `session.enc`；
   - 在 `loadSessionStoreRaw()` 中，读取 `session.enc` 并经 `decryptSecret` 解密后解析 JSON；
   - 增加旧明文清理逻辑：若 `userData/session.json` 存在，通过 `unlinkSync` 立即安全擦除；
   - 在 `clearSessionStore()` 中同时清理 `session.enc` 与旧 `session.json`。

- [x] **Step 4: 运行测试验证通过**

运行: `npx vitest run test/e2e/auth-session.test.ts`  
预期: PASS

- [x] **Step 5: 提交改动**

```bash
git add src/main/auth.ts src/main/credentials.ts test/e2e/auth-session.test.ts
git commit -m "security: encrypt persisted session to session.enc and scrub legacy plaintext (C-1)"
```

---

### Task 2: C-2 CI/CD SHA-256 清单生成与客户端安装包完整性校验

**Files:**
- Modify: `.github/workflows/release.yml:85-103`
- Modify: `src/main/updater.ts:80-205`
- Test: `src/main/updater.test.ts`

**Interfaces:**
- Consumes: Release 资产中的 `SHA256SUMS.txt` 文本清单、Node.js `crypto.createHash('sha256')`
- Produces: `downloadUpdate(asset: UpdateAsset, sha256Expected?: string): { ok: boolean; error?: string }`；下载完成时计算真实 sha256 并强校验，不匹配时阻断安装并安全擦除文件。

- [x] **Step 1: 编写针对安装包 SHA-256 校验与清单解析的单元测试**

在 `src/main/updater.test.ts` 中新增测试：
1. 测试 `parseSha256Checksums(manifestText, fileName)` 能正确从 `SHA256SUMS.txt` 多行内容中提取对应文件的 64 位十六进制哈希；
2. 测试当哈希匹配时允许进入 `update:ready`；
3. 测试当哈希不匹配时触发 `update:failed`（提示语为 `更新安装包完整性校验未通过，可能文件已损坏或网络传输异常`），并确认下载的不完整/被篡改文件已被删除。

- [x] **Step 2: 运行测试验证失败**

运行: `npx vitest run src/main/updater.test.ts`  
预期: FAIL（尚未实现 `parseSha256Checksums` 与哈希流式校验）。

- [x] **Step 3: 实现 `release.yml` 自动生成哈希清单与 `updater.ts` 校验逻辑**

1. 修改 `.github/workflows/release.yml`：在 `release` job 的 `Download all artifacts` 之后、`Create GitHub Release` 之前增加步骤：
   ```yaml
   - name: Generate SHA-256 Checksums
     shell: bash
     run: |
       cd artifacts
       sha256sum * > SHA256SUMS.txt
       cat SHA256SUMS.txt
   ```
2. 修改 `src/main/updater.ts`：
   - 导出纯函数 `parseSha256Checksums(content: string, targetFileName: string): string | null`；
   - 在 `checkUpdate()` 获取 assets 时，一并记录 `SHA256SUMS.txt` 资产的下载 URL；
   - 在 `downloadUpdate` 阶段：若存在校验清单，并发拉取清单文本并解析出期望哈希值 `expectedHash`；
   - 在下载二进制流时，将数据块同步写入 `hasher = createHash('sha256')`；
   - 在流 `end` 触发时计算 `actualHash = hasher.digest('hex')`；
   - 比对逻辑：若有 `expectedHash`，大小写不敏感比对。若不匹配，调用 `fail('更新安装包完整性校验未通过，可能文件已损坏或网络传输异常')` 并删除临时文件；若历史版本无清单，回退至文件大小校验并给出安全日志说明。

- [x] **Step 4: 运行测试验证通过**

运行: `npx vitest run src/main/updater.test.ts`  
预期: PASS

- [x] **Step 5: 提交改动**

```bash
git add .github/workflows/release.yml src/main/updater.ts src/main/updater.test.ts
git commit -m "security: generate and verify sha256 checksums for release updates (C-2)"
```

---

### Task 3: C-3 macOS 更新脚本参数化执行与路径安全白名单

**Files:**
- Modify: `src/main/updater.ts:245-296`
- Test: `src/main/updater.test.ts`

**Interfaces:**
- Consumes: `process.execPath`, `spawn('/bin/sh', [scriptPath, appPath, newApp])`
- Produces: 安全参数化替换脚本，禁止任何包含 shell 特殊字符求值的动态拼串。

- [x] **Step 1: 编写 macOS 更新脚本安全性与路径校验的测试用例**

在 `src/main/updater.test.ts` 中新增测试：
1. 验证 `isSafeMacAppPath(path: string): boolean`：
   - 必须以 `.app` 结尾；
   - 严禁为根目录 `/`、`/Applications` 本身、`/System` 或任何上级相对遍历 `..`；
2. 验证生成的替换脚本中不再包含插值变量 `${appPath}`，而是统一使用静态 `$1` 与 `$2` 占位，且参数通过 `spawn` 的 args 数组安全传递。

- [x] **Step 2: 运行测试验证失败**

运行: `npx vitest run src/main/updater.test.ts`  
预期: FAIL（因为当前代码仍直接通过模板字符串插值变量拼接脚本）。

- [x] **Step 3: 重构 `installMac` 实现参数化与白名单**

1. 提取并导出纯函数 `isSafeMacAppPath(path: string): boolean`：
   ```typescript
   export function isSafeMacAppPath(p: string): boolean {
     if (!p || typeof p !== 'string') return false
     const trimmed = p.trim()
     if (!trimmed.endsWith('.app')) return false
     if (trimmed === '/' || trimmed === '/Applications' || trimmed === '/Applications/' || trimmed.startsWith('/System')) return false
     if (trimmed.includes('..')) return false
     return true
   }
   ```
2. 在 `installMac` 中增加路径前置校验：
   ```typescript
   if (!isSafeMacAppPath(appPath) || !isSafeMacAppPath(newApp)) {
     installing = false
     return { ok: false, error: '无法定位应用安装目录，请前往官网重新下载' }
   }
   ```
3. 将动态脚本写入改造为静态参数化模板：
   ```sh
   #!/bin/sh
   set -e
   sleep 1
   OLD_APP="$1"
   NEW_APP="$2"
   rm -rf "$OLD_APP"
   mv "$NEW_APP" "$OLD_APP"
   open -n "$OLD_APP"
   ```
4. 调用 `spawn` 时将路径作为独立数组参数安全传入：
   ```typescript
   spawn('/bin/sh', [scriptPath, appPath, newApp], { detached: true, stdio: 'ignore' }).unref()
   ```

- [x] **Step 4: 运行测试验证通过**

运行: `npx vitest run src/main/updater.test.ts`  
预期: PASS

- [x] **Step 5: 提交改动**

```bash
git add src/main/updater.ts src/main/updater.test.ts
git commit -m "security: parameterize macOS update script and validate app paths (C-3)"
```

---

### Task 4: 全链路门禁检验与架构规范对齐

**Files:**
- Modify: `docs/superpowers/plans/2026-10-24-p0-security-fixes-and-integrity-verification.md` (标记进度)
- Review: `src/main/auth.ts`, `src/main/credentials.ts`, `src/main/updater.ts`, `.github/workflows/release.yml`

- [x] **Step 1: 运行 TypeScript 严格类型检查**

运行: `npm run typecheck`  
预期: 0 错误通过

- [x] **Step 2: 运行 ESLint 代码规范检查**

运行: `npm run lint`  
预期: 0 错误 0 警告通过

- [x] **Step 3: 运行全量单元与端到端测试**

运行: `npm test`  
预期: 56+ 测试文件全绿，测试总数 1000+ 全部通过

- [x] **Step 4: 最终提交**

```bash
git commit --allow-empty -m "chore: complete P0 security hardening gate verification"
```

---

## P1 阶段架构解耦规划蓝图 (Subsequent Roadmap)

在 P0 缺陷验证修复后，将平滑进入 P1 架构重构，主要目标为**将 1250 行的 `src/main/index.ts` 彻底瘦身为 ~180 行的纯生命周期编排器**：

```
src/main/
├── index.ts                     ← 纯应用生命周期、单实例锁、托盘与主窗口组装 (~180行)
├── ipc/
│   ├── download-handlers.ts     ← 承接 download:* 10个通道与 ~160 行 download:start 入队业务
│   ├── cloudpan-handlers.ts     ← 承接 cloudpan:* 14个通道与 85 行 SSO directLogin 流程
│   ├── auth-handlers.ts         ← 承接 auth:* 与 vsjtu:* 扫描分页业务
│   └── app-handlers.ts          ← 承接 app:* 通用原子操作（选择目录、系统通知、更新入口）
```

同时在 P1 阶段实施：
- **M-2**: 消除 `COMPUTERNAME+USERNAME` 的弱秘钥派生，改用 OS Keychain 或随机高强度 KeyFile 授权；
- **M-5**: 将 `cloudpan.ts` 中的 `fs.readSync` 切片读取改造为异步流式管道，杜绝大文件上传阻塞主进程。
