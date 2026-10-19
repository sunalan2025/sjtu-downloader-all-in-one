# SJTU 课程下载器 — 开发与发布指南

本文档提供本项目的本地开发环境搭建、构建打包、测试规范以及基于 GitHub Actions 的自动化发布流程说明。

---

## 1. 环境准备

- **Node.js**：版本 $\ge 18.0.0$
- **包管理器**：npm
- **网络环境**：开发测试涉及交大内网资源抓取，请确保连接 SJTU 校园网或交大 VPN。

> 💡 **关于 FFmpeg**：项目依赖 `ffmpeg-static`。在执行 `npm install` 时会自动拉取对应平台的预编译二进制文件至 `node_modules`。如遇网络原因下载缓慢，可设置环境变量 `FFMPEG_BIN` 指向系统本地已有路径。

---

## 2. 常用开发命令

```bash
# 安装项目依赖
npm install

# 启动本地热重载开发调试
npm run dev

# 执行全量单元测试与 E2E 测试 (Vitest)
npm test

# 执行单文件测试（例如凭据测试）
npx vitest run test/e2e/credentials.test.ts

# TypeScript 类型检查
npm run typecheck

# ESLint 代码风格与规范检查
npm run lint
```

---

## 3. 构建与打包

项目使用 `electron-vite` 与 `electron-builder` 构建流水线，构建产物将输出至 `release/` 目录：

```bash
# 打包当前操作系统平台的安装包
npm run build

# Windows 打包 (生成 NSIS .exe 安装程序)
npm run build:win

# macOS 打包 (生成 .dmg 镜像与 .zip)
npm run build:mac

# Linux 打包 (生成 .AppImage)
npm run build:linux

# 仅构建解包目录（不生成安装包单文件，方便排查产物）
npm run build:unpack
```

---

## 4. 自动化版本发布与更新工作流

客户端内建了基于 GitHub Releases 的无感更新检测。当需要发布新版本并向用户推送时，请遵循以下流程：

### 4.1 发布规则说明
- **Git Tag 驱动**：GitHub Actions 工作流（`.github/workflows/release.yml`）仅在监听到 `v*` 格式的 Tag 推送时触发全平台交叉编译；
- **版本一致性门禁**：推送的 Git Tag 名称（如 `v2.4.0`）必须与 `package.json` 中的 `version` 字段（如 `2.4.0`）保持一致。

### 4.2 标准发布操作步骤

```bash
# 1. 确认 package.json 中版本号已完成递增修改，提交并推送代码
git add package.json
git commit -m "chore: bump version to 2.4.0"
git push origin master

# 2. 本地打上对应的 Git Tag
git tag v2.4.0

# 3. 推送 Tag 触发 GitHub Actions 编译发布流水线
git push origin v2.4.0
```

推送完成后，GitHub Actions 会并行启动 Ubuntu、macOS 与 Windows 三大虚拟机矩阵，编译全平台安装包并自动创建 Release 附带产物。客户端在启动或检查更新时即可自动提示升级。
