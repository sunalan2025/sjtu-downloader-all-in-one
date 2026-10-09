# SJTU Downloader — E2E Testing Infrastructure (`TEST_INFRA.md`)

> **Author**: `test_writer_e2e`  
> **Date**: 2026-10-09  
> **Status**: OPERATIONAL (100% Passing, 144 Total Tests)

---

## 1. 概述 (Architecture Overview)

本测试基础设施专为 `sjtu-downloader-all-in-one` 设计，旨在脱离交大校园网物理网络凭证的前提下，以高保真 Mock 网络拦截器与协议沙箱，对全链路 22 项业务特性（PROJECT.md § Feature Inventory）建立确定性、可重复运行的不透明盒 (Opaque-Box) 测试验证闭环。

```
sjtu-downloader-all-in-one/
├── test/
│   ├── helpers/
│   │   └── contracts.ts             # 核心协议规范契约校验器与辅助断言
│   ├── mocks/
│   │   ├── electron-session.mock.ts # Electron Session / Cookies / Fetch 内存沙箱
│   │   ├── fixtures.ts              # 各业务子系统真实响应报文 Fixture 库
│   │   └── network-harness.ts       # 模拟故障网关 (403, 302, 429, 单视角, Token过期)
│   └── e2e/
│       ├── domain-guard.test.ts     # R5-F1, R5-F2 域安全隔离与限流退避套件
│       ├── auth-session.test.ts     # R1-F1, R1-F2, R1-F3 凭证持久化与扫码容错套件
│       ├── canvas-download.test.ts  # R2-F1..R2-F4 Canvas 课程扫描与文件完整性套件
│       ├── lti-video.test.ts        # R2-F5..R2-F7, R4-F3 课堂视频与 PPT 切片套件
│       └── vsjtu-cloudpan-cnmooc.test.ts # R3-F1..R3-F6, R4-F1 旁听/云盘/好大学套件
├── vitest.config.ts                 # 注册 test/**/*.test.ts 与 src/**/*.test.ts
├── TEST_INFRA.md                    # 本规范文档
└── TEST_READY.md                    # 测试就绪与全量覆盖矩阵标识
```

---

## 2. 4-Tier 测试分层设计 (4-Tier Test Methodology)

测试套件严格遵循 4-Tier 层次化测试设计体系：

### Tier 1: Feature Coverage (功能隔离覆盖)
- **目标**: 针对 `PROJECT.md` 定义的每一项独立特性进行白盒/契约隔离验证，覆盖率 $\ge 5$ 个独立断言。
- **覆盖点**:
  - `isAllowedSjtuUrl` 校验官方域名 (`*.sjtu.edu.cn`, `s3.jcloud.sjtu.edu.cn`, `cnmooc.sjtu.cn`, `localhost`)
  - 429 退避算法计算 base 指数与 `Retry-After` (秒数及 HTTP-Date)
  - 会话存储加载、保存与身份（姓名/学号）提取
  - QR 码多模式 DOM 选择器匹配
  - Canvas 课程学期分组、多状态归档与大纲文件正则抽取
  - LTI 讲次大小为 500 的翻页查询及中文/英文多格式讲次解析
  - v.sjtu `totalPage` 多页循环合并与单视角容错
  - 交大云盘空间配额查询、已有 Token 复用与分片上传
  - 好大学在线二级嵌套章节树 (`chapterTitle` -> `sectionTitle` -> `items`)

### Tier 2: Boundary & Corner Cases (边界与异常防御)
- **目标**: 极限输入、畸形报文、系统异常及越权访问拦截。
- **覆盖点**:
  - 非法协议 (`ftp://`, `file:///`, `javascript:`, `data:`) 拒绝
  - 伪造钓鱼域名 (`https://sjtu.edu.cn.attacker.com`) 阻断
  - 空字符串、畸形 URL 无异常抛出
  - 损坏的本地加密 JSON 凭据恢复
  - 过期 JWT 载荷拦截
  - 0 字节文件与以 `<!DOCTYPE html>` 或 `<html` 开头的伪装网页识别拦截
  - 教师禁用文件 Tab (403 Forbidden) 时的静默降级
  - 缺失视频流视角时的平滑容错
  - 无法识别的讲次编号兜底
  - 仅含作业/测验的小节自动过滤

### Tier 3: Cross-Feature Pairwise Interactions (跨特性组合交互)
- **目标**: 检验多个特性相互联动时的状态协同与防重放。
- **覆盖点**:
  - **域隔离 + 重定向链**: 302 重定向至 S3 允许，重定向至外部攻击域拦截
  - **403 隐藏 Tab + 模块/大纲文件补漏 + 下载写入**: 隐藏 Tab 课程成功补齐 3 个模块与大纲附件并校验通过
  - **302 登录页拦截 + 文件完整性**: 会话失效 302 拦截发生在写盘之前，避免落盘任何伪装 HTML
  - **VOD 单视角 + 并发请求去重**: 教师与 PPT 两个并发任务共享同一在途网络请求，零冗余查询
  - **超长云盘直传 + 动态 Token 续期**: 上传超过 50 个分片触发动态凭证续期

### Tier 4: End-to-End User Workflows (端到端用户场景闭环)
- **目标**: 模拟用户真实使用场景的完整生命周期。
- **覆盖点**:
  - **扫码登录到持久化闭环**: 扫码捕获 -> 写入加密 Vault -> 重启应用 -> 无感免扫码加载 -> 验证身份成功
  - **Canvas 完整扫描下载闭环**: 隐藏 Tab 课程扫描 -> 补漏文件解析 -> 302 安全校验 -> 写入 `.part` -> 完整性校验 -> 改名归档
  - **课堂视频与 PPT 切片捕获闭环**: LTI Tab 发现 -> 全量翻页讲次扫描 -> 双视角辨析 -> HLS 任务派发 -> PPT 高清切片与 PDF 合成
  - **v.sjtu 到交大云盘直传闭环**: 多页旁听课程扫描 -> 单视角容错直链解析 -> 云盘直传分片上传与凭证续期
  - **好大学在线全流程**: 课程列表 -> 二级章节树解析 -> 懒解析视频/课件直链 -> 分级目录组织落地

---

## 3. Mock 基础设施组件说明 (Mock Utilities)

### 3.1 `MockSession` (`test/mocks/electron-session.mock.ts`)
- 完全模拟 Chromium / Electron 的 `Session` API。
- 维护内存级 Cookies 存储树，支持域与 URL 的正则级过滤、添加及存储抹除。
- 具备堆栈式 `registerFetchHandler`，支持动态挂载自定义网络拦截管道。

### 3.2 `NetworkHarness` (`test/mocks/network-harness.ts`)
- 集中拦截并处理 SJTU 各官方端点：
  - `jaccount.sjtu.edu.cn`: OAuth2 / 统一身份认证
  - `v.sjtu.edu.cn`: `/cloud-rbac/authority/me`, `/audit-course/my`, `/vod-info-by-course-id`
  - `oc.sjtu.edu.cn`: `/api/v1/courses`, `/files`, `/folders`, `/modules`
  - `pan.sjtu.edu.cn`: SSO 换取 Token, COS 分片直传
  - `cnmooc.sjtu.cn`: `myCourseIndex`, `unitNavigation`, `play.mooc`, `detail.mooc`
- 支持场景注入开关：
  - `simulateCanvasFiles403`: 模拟教师隐藏文件 Tab
  - `simulateCanvas302Login`: 模拟会话失效 302 登录页跳转
  - `simulate429RateLimit`: 模拟校园网限流及 `Retry-After` 退避
  - `simulateSingleAngleVOD`: 模拟录播教室仅有单路视角
  - `simulateExpiredCloudPanToken`: 模拟云盘凭证中间失效

### 3.3 规范契约工具 (`test/helpers/contracts.ts`)
- 包含符合 `PROJECT.md` 规范的独立断言函数：
  - `isAllowedSjtuUrl(url)`: 严格域名白名单检测器
  - `verifyDownloadIntegrity(path, minBytes, allowHtml)`: 落地文件有效性与 HTML 伪装嗅探器
  - `calculateBackoffMs(retryAfter, attempt, maxDelayMs)`: 指数退避与 HTTP-Date 解析器
  - `extractQrElementSelector(html)`: 多级容错二维码选择器匹配器
  - `decodeJwtClaims(token)`: JWT Base64 载荷解析器

---

## 4. 运行验证指南 (How to Run)

在根目录下执行以下命令：

```bash
# 1. 运行全量测试套件 (Vitest)
npm test

# 2. 运行单一套件
npx vitest run test/e2e/domain-guard.test.ts
npx vitest run test/e2e/auth-session.test.ts
npx vitest run test/e2e/canvas-download.test.ts
npx vitest run test/e2e/lti-video.test.ts
npx vitest run test/e2e/vsjtu-cloudpan-cnmooc.test.ts

# 3. 运行 TypeScript 类型检查
npm run typecheck

# 4. 运行代码风格与 Lint 检查
npm run lint
```
