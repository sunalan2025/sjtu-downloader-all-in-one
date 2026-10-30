# P2 架构次要优化与渲染端 Store 模块化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 完成全面架构审查报告中的 P2 阶段全部优化事项：收口版本比较算法至 `shared/utils` (m-3)、收敛主进程退出清理冗余 (m-4)、限制云盘批量上传并发 (m-6)、移除 `WindowApi` 宽松索引签名 (m-8)、为云盘文件夹缓存引入 TTL (m-9)，并将 1118 行巨型单体 `store/app.ts` 按业务领域切片化解耦 (M-7)。

**Architecture:**
1. **单一真相源与工具纯函数 (DRY)**：将语义版本比较算法 `isNewerVersion` 提取至 `src/shared/utils.ts`，导出并添加完备单测；
2. **传输与并发弹性**：在 `src/main/cloudpan-transfer.ts` 中引入最大并发控制队列（默认 3 并发），防止多文件并发击穿网络；为 `createdFolderPaths` 引入 15 分钟 TTL 失效机制；
3. **接口契约强类型化**：移除 `WindowApi` 中的 `[key: string]: unknown` 宽松索引签名，使渲染端对主进程 API 的调用获得 100% 严格类型推断；
4. **渲染端状态切片化 (Zustand Slices Architecture)**：将 `store/app.ts` 按领域拆分为 6 个切片（`auth-slice`, `settings-slice`, `course-slice`, `schedule-slice`, `download-slice`, `cloudpan-slice`），在 `app.ts` 中合成并导出 `useAppStore`，确保外部 20+ 组件调用零感知、100% 向后兼容。

**Tech Stack:** TypeScript 5.8 + Electron 39 + React 19 + Zustand 5 + Vitest 4

**Spec:** [`architecture-review.md`](file:///C:/Users/MINISUNSHINE/.gemini/antigravity/brain/eb7ff9be-e088-407c-b547-f2221adaf548/architecture-review.md)

## Global Constraints

- 严禁出现未转义的美元符号（正文中的非公式 `$` 必须写为 `\$` 或放入代码块）；
- 严禁在页面/组件内部私自重复造轮子（DRY 铁律）；
- 全链路验证门禁：每个任务提交前及最终交付前，必须顺序通过 `npm run typecheck`、`npm run lint` 与 `npm test`。

---

### Task 1: m-3 版本比较工具函数沉淀至 `shared/utils`

**Files:**
- Modify: `src/shared/utils.ts`
- Modify: `src/main/ipc/app-handlers.ts`
- Test: `src/shared/utils.test.ts`

**Interfaces:**
- Produces: `isNewerVersion(latest: string, current: string): boolean`
- Consumes: 在 `app-handlers.ts` 中导入 `isNewerVersion`

- [x] **Step 1: 编写 `isNewerVersion` 单元测试**

在 `src/shared/utils.test.ts` 中新增覆盖测试：
1. 正常升版（`1.2.3` vs `1.2.4`，`2.0.0` vs `1.9.9`，`1.10.0` vs `1.9.0`）；
2. 相同版本（`1.0.0` vs `1.0.0`，返回 `false`）；
3. 降级或历史版本（`1.0.0` vs `1.0.1`，返回 `false`）；
4. 段数不等（`1.2` vs `1.2.1`，`1.2.0` vs `1.2`）；
5. 包含非数字非法字符串（优雅返回 `false`）。

- [x] **Step 2: 运行测试确认失败**

运行: `npx vitest run src/shared/utils.test.ts`  
预期: FAIL (未导出 `isNewerVersion`)

- [x] **Step 3: 在 `src/shared/utils.ts` 中实现并导出 `isNewerVersion`**

将 `isNewerVersion` 写入 `src/shared/utils.ts` 并导出。

- [x] **Step 4: 在 `src/main/ipc/app-handlers.ts` 中替换内联实现**

移除 `app-handlers.ts` 内部私有 `isNewerVersion`，改为 `import { isNewerVersion } from '../../shared/utils'`。

- [x] **Step 5: 运行测试验证通过**

运行: `npx vitest run src/shared/utils.test.ts`  
预期: PASS

- [x] **Step 6: 提交改动**

```bash
git add src/shared/utils.ts src/shared/utils.test.ts src/main/ipc/app-handlers.ts
git commit -m "refactor: extract isNewerVersion to shared utils with comprehensive unit tests (m-3)"
```

---

### Task 2: m-4, m-6, m-8, m-9 基础设施、并发与类型契约加固

**Files:**
- Modify: `src/main/index.ts` (m-4 移除 `before-quit` 中冗余的 `stopSshTunnel`)
- Modify: `src/main/cloudpan-transfer.ts` (m-6 限制 `uploadCloudFiles` 最大并发数)
- Modify: `src/shared/types.ts` (m-8 移除 `WindowApi` 宽松索引签名 `[key: string]: unknown`)
- Modify: `src/main/cloudpan.ts` (m-9 增加 `createdFolderPaths` 15 分钟 TTL 失效机制)
- Test: `test/e2e/cloudpan-explorer.test.ts`

**Interfaces:**
- `uploadCloudFiles(targetDirPath?: string[]): Promise<{ ok: boolean; count?: number; error?: string }>` 保证上传队列受控，并发限制为 3。
- `WindowApi` 接口只暴露严格声明的 API 方法。
- `createdFolderPaths` Map 记录路径生成时间戳，超时自动失效。

- [x] **Step 1: 编写云盘批量上传并发控制测试**

在 `test/e2e/cloudpan-explorer.test.ts` 中测试选择多个文件时，并发在途的上传 Promise 数量不超过指定上限（3 个）。

- [x] **Step 2: 在 `src/main/cloudpan-transfer.ts` 中增加并发限制器**

使用轻量并发池模式限制 `uploadCloudFiles`，最大并发度为 3：
```typescript
const MAX_CONCURRENT_UPLOADS = 3
let cursor = 0
async function runWorker(): Promise<void> {
  while (cursor < fileList.length) {
    const item = fileList[cursor++]
    await uploadSingleFile(item)
  }
}
await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_UPLOADS, fileList.length) }, runWorker))
```

- [x] **Step 3: 在 `src/main/cloudpan.ts` 中为 `createdFolderPaths` 增加 15 分钟 TTL**

修改 `createdFolderPaths` 为 `Map<string, number>`，记录创建时间；并在 `clearCachedCredentials` 时一并清空。

- [x] **Step 4: 在 `src/shared/types.ts` 中移除 `[key: string]: unknown`**

删除 `WindowApi` 末尾的 `[key: string]: unknown`，并执行 `npm run typecheck` 验证所有调用端类型吻合。

- [x] **Step 5: 在 `src/main/index.ts` 中清理重复的 `stopSshTunnel`**

移除 `before-quit` 中的多余 `stopSshTunnel().catch(...)`。

- [x] **Step 6: 运行全量测试验证**

运行: `npm run typecheck && npm test`  
预期: 全部通过。

- [x] **Step 7: 提交改动**

```bash
git add src/main/index.ts src/main/cloudpan.ts src/main/cloudpan-transfer.ts src/shared/types.ts test/e2e/cloudpan-explorer.test.ts
git commit -m "harden: bound cloud batch upload concurrency, add folder cache ttl, and tighten WindowApi type (m-4, m-6, m-8, m-9)"
```

---

### Task 3: M-7 Zustand Store 切片化分层解耦 (Store Slices)

**Files:**
- Create: `src/renderer/src/store/slices/auth-slice.ts`
- Create: `src/renderer/src/store/slices/settings-slice.ts`
- Create: `src/renderer/src/store/slices/download-slice.ts`
- Create: `src/renderer/src/store/slices/course-slice.ts`
- Create: `src/renderer/src/store/slices/schedule-slice.ts`
- Create: `src/renderer/src/store/slices/cloudpan-slice.ts`
- Modify: `src/renderer/src/store/app.ts` (精简为组合入口)
- Test: `test/unit/download-domain.test.ts` & 全体 renderer 页面

**Interfaces:**
- `createAuthSlice`: 管理登录态、Stage、导航 Tab、用户信息
- `createSettingsSlice`: 管理主题、窗口关闭动作、向导状态、私有中转配置
- `createDownloadSlice`: 管理本地与云盘下载模式、并发数、限速、进度批处理缓冲、下载历史
- `createCourseSlice`: 管理旁听课程、Canvas 课程、好大学在线课程及其分类勾选状态
- `createScheduleSlice`: 管理课表视图、学期切换、图层过滤
- `createCloudPanSlice`: 管理云盘 Token、空间配额、连接状态机
- `useAppStore`: 保持完全一致的公开接口和 `persist` 序列化结构，外部消费无感知

- [x] **Step 1: 创建 `src/renderer/src/store/slices/auth-slice.ts`**
包含 `theme`、`stage`、`activeTab`、`auth` 及对应 setter。

- [x] **Step 2: 创建 `src/renderer/src/store/slices/settings-slice.ts`**
包含窗口行为偏好、初始化向导状态、PPT/AI 字幕导出偏好、私有中转配置及对应 setter。

- [x] **Step 3: 创建 `src/renderer/src/store/slices/download-slice.ts`**
包含 `downloadMode`、`localDestRoot`、`cloudDestRoot`、`progress`、`batchTaskIds`、`maxDownloadSpeedKBps`、`concurrency`、`downloadHistory`、`applyProgress` 缓冲逻辑及对应 action。

- [x] **Step 4: 创建 `src/renderer/src/store/slices/course-slice.ts`**
包含 `courses`（旁听）、`canvasCourses`（Canvas）、`cnmoocCourses`（好大学在线）扫描结果、分类选择树与任务折叠展开状态。

- [x] **Step 5: 创建 `src/renderer/src/store/slices/schedule-slice.ts`**
包含 `scheduleSelectedSemesterKey`、`scheduleViewMode`、`scheduleLayerFilter`、`scheduleExpandNoonSlot` 及对应 setter。

- [x] **Step 6: 创建 `src/renderer/src/store/slices/cloudpan-slice.ts`**
包含 `cloudUserToken`、`cloudSpaceInfo`、`cloudConnStatus`、`cloudConnMessage` 及对应 setter。

- [x] **Step 7: 重构 `src/renderer/src/store/app.ts` 为合成入口**
引入上述 6 个切片 creator，合并为单一 `AppState` 并挂载 `persist` 中间件与 `useAppStore`。
保留原有 `partialize` 与 `onRehydrateStorage` 逻辑，确保与用户的 `localStorage` 完全兼容。

- [x] **Step 8: 运行渲染端组件测试与全量测试**

运行: `npm run typecheck && npm test`  
预期: PASS

- [x] **Step 9: 提交改动**

```bash
git add src/renderer/src/store/
git commit -m "refactor: decompose monolithic app store into modular domain slices (M-7)"
```

---

### Task 4: 全链路门禁检验与整体交付

- [x] **Step 1: 静态类型检查**
运行: `npm run typecheck`  
预期: 0 错误

- [x] **Step 2: ESLint 规范检查**
运行: `npm run lint`  
预期: 0 错误 0 警告

- [x] **Step 3: 全套自动化测试套件**
运行: `npm test`  
预期: 57 套测试 100% 全绿

- [x] **Step 4: 计划文档归档提交**
```bash
git add docs/superpowers/plans/2026-10-24-p2-minor-refinements-and-store-modularization.md
git commit -m "docs: complete P2 minor refinements and store modularization plan"
```
