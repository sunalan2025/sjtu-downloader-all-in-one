# 开发与发布

桌面端、安卓端和介绍网站共用仓库，分别构建。本文只记录当前可用的维护流程，历史计划和一次性审计脚本不作为开发入口。

## 环境与桌面端

需要 Node.js 22、npm，以及对应平台的 Electron 构建环境。依赖的 FFmpeg 和 Electron 安装脚本需要下载平台二进制；仅检查渲染器时可使用 `npm ci --ignore-scripts`，运行完整桌面应用前仍需完成对应安装。

```sh
npm ci
npm run dev
npm run typecheck
npm run lint
npm test
```

`npm run build` 构建当前平台安装包；`build:win`、`build:mac`、`build:linux` 构建指定平台，`build:unpack` 生成解包目录。实际支持的处理器架构以 Release 中的资产为准。

桌面版本号来自根目录 `package.json`。发布 `v<版本>` 标签触发 `.github/workflows/release.yml`，生成安装包与 SHA256 校验和。安卓构建与发布见 [mobile/README.md](../mobile/README.md)。

## 文档截图

截图直接运行 `src/renderer` 的真实 React 组件，通过隔离的 `window.api` 示例响应提供数据。不会调用真实登录、写入云盘、下载学校资源或读取用户会话。

```sh
npm ci
npm --prefix website ci
# 使用已安装的 Chrome/Chromium，或先安装 Playwright Chromium
UI_TEST_BROWSER=/usr/bin/chromium npm --prefix website run capture:desktop
```

维护入口为 `website/scripts/capture-desktop.mjs` 和 `desktop-fixture.mjs`。图片写入 `docs/images/desktop/`；更新应用界面后可重新生成，确认截图无真实个人信息，再提交文档图片。截图用于说明界面，不代替真实学校账号的功能验证。

## 介绍网站

网站使用 Astro，部署到 GitHub Pages，自定义域名为 `sjtu.hisunalan.me`。

```sh
npm --prefix website ci
npm --prefix website run dev
npm --prefix website run check
npm --prefix website test
npm --prefix website run build
UI_TEST_BROWSER=/usr/bin/chromium npm --prefix website run test:ui
```

构建前将 `docs/images/desktop/`、`docs/images/android/` 和应用图标复制到网站公共目录，生成的副本不提交。构建期分别同步桌面端与安卓端正式 Release，依据实际文件名识别平台与架构；网络不可用时沿用仓库内已核对的元数据，不编造安装包或校验和。

网站、图片及部署工作流的变更推送到 `master` 后，`.github/workflows/website-deploy.yml` 先检查并构建，再部署。功能单测覆盖发布筛选、架构和下载推荐；浏览器回归检查截图切换、大图、手机菜单、主题、下载链接及页面溢出。

## 源码说明

- [技术架构](architecture.md)
- [前端结构](frontend-architecture.md)
- [云盘能力边界](cloud-drive.md)
- [资源库与恢复](backup-library.md)
- [安全说明](../SECURITY.md)
