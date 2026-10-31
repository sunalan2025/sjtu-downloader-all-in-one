# SJTU Downloader for Android — v0.3 Beta

独立 Android 测试应用。代码位于 `feature/android-mvp`，不修改桌面版主线。

## 已接入（真正有代码实现）

- **同款图标**：Android 启动图标、桌面内 logo 全部由桌面版 `build/icon.png` 自动生成；不会使用 Capacitor 的默认机器人图标。
- **学期筛选**：读取 Canvas 返回的 `term.name`，按学期过滤、检索课程、查看课程文件。
- **批量下载**：多课程勾选、当前学期全选、单课程文件多选、全选当前文件类型、文档/视频文件/其他分类、点击下载后最多并行两项。课程扫描同时最多 3 项，最多单批次 1200 个文件。
- **存储归档**：App 私有外部下载目录 `Downloads/SJTU Downloader/<学期>/<课程名>/<文件>`，使用原生文件名清理并避免重名覆盖。当前无公共 Downloads 目录写入和 Android 系统下载管理器入口。
- **登录**：通过官方 Canvas SSO 进入 jAccount 手机网页，允许用户主动点击“交我办”链接跳转。额外的“交我办”按钮只会尝试触发**官方页面真实存在**的链接，不构造未经验证的 Deep Link，也不能保证校方 App 可以返回 WebView 会话。
- **日历**：Canvas `calendar_events` 先尝试，401/403 时退回已授权的 `users/self/upcoming_events` 及各课程 `assignments`。显示真实可访问活动与 DDL，明确说明部分数据可能不完整。没有完整正式教学课表与考试同步。
- **系统安全区**：Android 原生 edge-to-edge 和系统 Insets。
- **安装包身份**：独立 `me.hisunalan.sjtudownloader.beta` Beta 包名，可与旧 v0.1/v0.2 测试版并存。此分支以后由公开**测试用途专用**签名签署；绝不用于正式版发布，任何人都能复制此测试密钥，不能作为可信应用发布渠道。

## 未移植（不可误称已支持）

桌面版的旁听课程、好大学在线、Canvas 教师/PPT 双视角录播、HLS/FFmpeg 视频合并、PPT 图片转 PDF、交大云盘、可靠后台断点续传、多账号、私有中转服务、完整课表/考试仍需单独进行 Android 原生移植。页面里的“视频文件”分类仅限 Canvas Files API 已直接列出的常规视频文件，不会搜索课堂录播。

## 构建

要求 Node.js 22、JDK 21、Android SDK 35。图标从仓库根目录 `build/icon.png` 读取。

```bash
cd mobile
npm install
npm run build
npm run android:prepare
npm run android:icons
cd android
./gradlew assembleDebug
```

Android 工程和 native overlay 由 `android:prepare` 自动处理。也可进入 GitHub Actions 的 `Android MVP Debug APK` 流程查看已验证构建，下载 Artifact。

## 真机测试

1. 同时保留旧版（旧包名）与新版 Beta 应用，确认能独立安装启动，且图标与桌面版一致。
2. 登录 jAccount；验证“交我办”网页入口、App 打开及 SSO 返回。如果学校网页不展示快捷登录，记录具体页面地址和登录页截图，不要输入凭据到任何非官方域名。
3. 在“课程”中按学期筛选，分别测试单文件、多文件、多课程批量下载。检查私有目录层级（某些手机文件管理器不显示 Android/data，属于系统限制）。
4. 日历如遇 401 应显示授权提示或部分备用数据，不应直接把 401 当作整个日历崩溃。
5. 检查系统状态栏、挖孔与底部手势区适配、旋转屏幕、前后台切换。

当前版本的 Web 前端与原生代码由 CI 编译验证，但不等于使用交大账号完成真实授权及下载测试。只有在真机上验证后才能对这些功能做“可用”声明。

## v0.3.2 登录保持（安卓）

**正常关闭或杀死应用后重新打开，无需立即重新登录。** 登录成功后，App 将关键 Canvas / 正式课表会话 Cookie 加密保存于 Android 私有存储；AES-GCM 密钥由 Android Keystore 管理。再次启动前端会在原生网络请求前尝试恢复 Cookie，然后调用学校接口验证会话。恢复成功后自动加载课程；返回前台也会适时复查。没有保存 jAccount 账号密码，也不会把 Cookie 发送到开发者服务器。默认启用，无需“记住密码”复选框。

**边界**：会话是否继续有效由交大服务端决定；服务端过期/撤销或校园网不可达时无法绕过登录限制。清除应用数据、卸载重装将删除会话。明确点击“退出登录”并确认会同时清除 WebView Cookies 与加密的会话备份；不会在普通关闭应用时清除。

测试：`SessionCookieVaultTest` 使用虚构的本地会话 Cookie，在 Android 模拟器上检查加密、Vault 实例重建后恢复、退出后不可恢复。模拟器冒烟测试会 force-stop 和重新启动真实 APK。因为 CI 没有交大账号，真实服务器登录续期能力必须在已登录的实体手机上验证。
