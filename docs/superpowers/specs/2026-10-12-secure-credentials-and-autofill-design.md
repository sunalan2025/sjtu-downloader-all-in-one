# jAccount 多账号安全凭据存储与原生级自动补全设计方案 (Design Specification)

> **适用模块**：用户认证凭据安全保险库 (`src/main/credentials.ts`)、IPC 管道 (`src/preload/index.ts`, `src/shared/types.ts`)、登录窗口自动填充与选择器 (`src/renderer/src/pages/Login.tsx`)、设置面板凭据管理 (`src/renderer/src/pages/Settings.tsx`)

---

## 1. 业务目标与需求背景

在多学籍、多身份或多人共用客户端的场景下，用户经常需要反复输入上海交通大学统一身份认证（jAccount）的账号与复杂密码。当前客户端内嵌加载 jAccount 网页，每次会话过期后用户需重新手动输入。

本设计目标：
1. **自动记住账密**：登录成功后，主动询问用户是否安全保存账密与备注别名；
2. **多账号选择与自动填充**：
   - 单账号时：打开登录界面直接自动回填账号和密码；
   - 多账号时：默认回填最近一次使用的账号，并在账号输入框下方注入原生浏览器风格（Chrome / Edge 浮动卡片）的账号下拉切换面板，一键切换并自动填好；
   - 自动填充仅填入输入框，**不自动提交登录**，由用户确认或处理二次验证后手动点击；
3. **高标准本地化隐私与硬件级加密**：
   - 使用 Electron `safeStorage`（底层基于 Windows DPAPI / macOS Keychain / Linux Secret Service，绑定当前操作系统登录用户与本地硬件安全秘钥）；
   - 磁盘上绝不出现明文密码；
   - 渲染进程获取的列表数据严格脱敏（仅提供掩码 `••••••••`，不可逆向还原明文）；
4. **全生命周期管理**：在「设置」面板中配备独立的「🔐 账号与凭据管理」专区，支持查看、修改备注别名、单个删除与一键清空。

---

## 2. 总体架构与数据流图

```mermaid
flowchart TD
    subgraph Renderer ["渲染端 (Renderer / UI)"]
        LoginPage["Login.tsx (Webview jAccount)"]
        DropdownUI["原生注入自动补全下拉框 (Chrome/Edge Style)"]
        SaveModal["登录成功：是否记住账密确认弹窗"]
        SettingsPage["Settings.tsx (账号与凭据管理面板)"]
    end

    subgraph Preload ["Preload 隔离通道 (Context Bridge)"]
        API["window.api.credentials"]
    end

    subgraph Main ["主进程安全保险库 (Main Process Vault)"]
        CredManager["credentials.ts (凭据管理器)"]
        SafeStorage["Electron safeStorage (Windows DPAPI / Keychain)"]
        FileStore[("accounts.enc.json (本地加密存储)")]
    end

    LoginPage -->|DOM 交互与聚焦| DropdownUI
    DropdownUI -->|请求账号列表脱敏数据| API
    API -->|IPC: credentials:list| CredManager
    CredManager -->|读取并脱敏 (密码变掩码)| FileStore
    DropdownUI -->|选择某一账号进行填充| API
    API -->|IPC: credentials:get-fill-data| CredManager
    CredManager -->|safeStorage.decryptString| SafeStorage
    CredManager -->|向 Webview 注入填充脚本| LoginPage

    LoginPage -->|检测到登录成功并持有新账密| SaveModal
    SaveModal -->|确认保存 (含备注别名)| API
    API -->|IPC: credentials:save| CredManager
    CredManager -->|safeStorage.encryptString| SafeStorage
    CredManager -->|原子化写盘| FileStore

    SettingsPage -->|管理/修改别名/删除/清空| API
```

---

## 3. 详细设计规范

### 3.1 凭据安全存储与加解密设计 (`src/main/credentials.ts`)

#### 数据结构
```typescript
export interface StoredCredential {
  id: string              // 唯一 ID (如 cred_<timestamp>_<rand>)
  username: string        // jAccount 学工号/用户名 (明文存储用于检索)
  label?: string          // 用户自定义备注别名 (如 "本科账号", "科研账号")
  encryptedPassword: string // safeStorage 加密后的 base64 密文
  createdAt: number       // 创建时间戳
  lastUsedAt: number      // 最近一次登录/填充时间戳
}

export interface MaskedCredential {
  id: string
  username: string
  label?: string
  maskedPassword: string  // 固定为 "••••••••"
  createdAt: number
  lastUsedAt: number
}
```

#### 加密机制
1. **优先使用 `safeStorage`**：
   - 检查 `safeStorage.isEncryptionAvailable()`；
   - 若可用，调用 `safeStorage.encryptString(password)` 返回 `Buffer`，转为 Base64 存储；
   - 解密时将 Base64 转为 `Buffer`，调用 `safeStorage.decryptString(buf)`。
2. **容错加密兜底（Fallback）**：
   - 若当前运行环境（如极端精简 Linux/虚拟机）`safeStorage` 暂不可用，使用基于当前机器指纹 + 应用专用 Salt 派生的 AES-256-GCM 算法进行对称加密，保证磁盘无明文。
3. **文件落盘位置**：
   - 存储于 `app.getPath('userData')/credentials/accounts.enc.json`；
   - 写入时使用临时文件原子替换（write to tmp and rename），确保断电或崩溃时无文件损坏风险。

#### 安全边界与 IPC 权限隔离
- `credentials:list`：仅返回 `MaskedCredential[]`，绝不向渲染层暴露解密后的明文密码；
- `credentials:fill-into-webview` 或 `credentials:get-fill-data`：由主进程直接执行或仅在特定受信时刻交付。

---

### 3.2 登录界面原生交互注入与多账号选择器 (`Login.tsx`)

#### 场景 1：自动填充策略
1. **0 个账号**：显示空表单，等待用户手动输入或扫码；
2. **1 个账号**：jAccount 页面 DOM 就绪后，直接自动填充该账号与密码至 `#user` 与 `#pass`；用户只需确认并点击登录；
3. **多个账号**：
   - 默认回填最近一次使用的账号；
   - 在 `#user` 输入框右侧/下方注入现代悬浮下拉补全卡片：
     - 每行展示：`👤 [别名] [学工号] · •••••••• (上次登录: X月X日)`；
     - 右侧配有单个快捷删除图标；
     - 底部带有「+ 输入新账号」选项（清空输入框）；
   - 用户点击任一账号后，立即换填该账号的用户名与密码。

#### 场景 2：记住账号密码触发时机
1. 用户在 webview 中点击登录提交表单时，前端在 webview 内监听 `submit` 事件并捕获当前填写的用户名与密码暂存于内存（不写盘）；
2. 当且仅当客户端检测到进入 `isLoginSuccessUrl`（SSO 成功回调）时：
   - 校验捕获的凭据是否已在保存列表中且密码一致：
     - 若已存在：直接更新其 `lastUsedAt`；
     - 若不存在（新账号或密码已更新）：弹出轻量卡片弹窗：
       > **检测到成功登录 jAccount 账号：`{username}`**
       >
       > 是否记住此账号密码？（下次登录将自动为您填好）
       >
       > [输入框：个性化备注，如「本科账号」，可选]
       >
       > `[ 记住此账号 ]`  `[ 暂不保存 ]`
   - 用户点击「记住此账号」后，IPC 异步通知主进程加密写盘。

---

### 3.3 设置面板（Settings.tsx）管理中心

在客户端设置中心新增「🔐 账号与凭据管理」卡片：
1. **状态与列表展示**：
   - 卡片顶部显示已安全保存的账号数量及加密状态标签（`🛡️ 系统硬件级加密 (DPAPI/Keychain) 保护中`）；
   - 列表展示所有账号卡片：用户名、别名 Badge、创建时间、最近登录时间；
2. **操作能力**：
   - **编辑别名**：内联或弹窗修改「备注别名」（如「本科账号」改为「博后账号」）；
   - **单个删除**：移除指定账号的本地加密凭据；
   - **一键清空全部**：二次确认后彻底抹除本地 `accounts.enc.json`。

---

## 4. 自动化测试与质量保证指标

1. **单元测试与集成测试** (`test/e2e/credentials.test.ts`):
   - 凭据存储、读取、修改别名、删除与全量清空；
   - 加解密正确性校验（确保密文在磁盘上绝非明文，且解密还原 100% 准确）；
   - 脱敏数据校验（`list` 严格杜绝明文泄漏）；
   - 多账号按 `lastUsedAt` 排序与活跃账号推导；
2. **代码规范与类型安全**：
   - `npm run typecheck` 0 报错；
   - `npm run lint` 0 报错；
   - 全量 476+ 项测试用例持续 100% 通过。
