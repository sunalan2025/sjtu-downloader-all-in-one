# SJTU Downloader for Android — v0.1 prototype

Android 端的独立 React + Capacitor 工程，使用 Kotlin Android 原生插件访问 SJTU Canvas。桌面主线不受影响。

## 当前可用范围

- jAccount 登录入口：Android 内置浏览器视图打开 **Canvas 官方登录页**，由服务器执行 SSO，登录后复用同一 Cookie 会话。
- Canvas 课程列表；文件列表（支持分页）与课件下载。
- Android 原生网络请求与 App 专属 Downloads/SJTU Downloader 保存目录。
- 流式下载进度、任务取消、文件名过滤、Host 重定向与下载时 Cookie 保护。
- 课程筛选、下载进度、适配手机宽度的界面。

## 当前限制（务必阅读）

此版本是开发预览版，尚未经过交大真实账号的真机端到端验收。Canvas 页面可能修改登录跳转流程，部分课程需要通过模块、作业、录播入口读取，因此尚未覆盖。当前只列 Canvas Files API 直接返回的文件，不包括视频、旁听、好大学在线、云盘、PPT 导出、课表。下载仅保证应用在前台运行时的基本能力，不保证系统杀进程后的恢复；任务列表只保存在本次会话。文件保存在 App 私有外部 files/Downloads/SJTU Downloader 文件夹，卸载应用可能清除文件；目前没有实现导出到公共 Downloads/系统分享。

**不应将这版称为正式完整安卓客户端。**

## 本地准备

- Node.js 20+
- JDK 17 或 21
- Android Studio 与 Android SDK（platforms;android-35、build-tools;35.0.0）
- 可使用校园网或 VPN 访问 SJTU 教学平台的 Android 设备

\`\`\`bash
cd mobile
npm install
npm run build
npm run android:prepare
# 首次生成 android/ 后，把 android-overlay 的内容复制到 android/ 对应路径，
# 再运行 npm run android:prepare 确保 Web 资源是最新版本
cp -r android-overlay/. android/
cd android && ./gradlew assembleDebug
\`\`\`

最终可在 \`mobile/android/app/build/outputs/apk/debug/app-debug.apk\` 找到 APK。

CI 将自动执行 Android 生成、原生文件覆盖与 debug APK 编译；APK 为调试版，仅用于个人测试，不应上传正式商店。

## 原生接口

\`src/native.ts\` 定义 \`SjtuCanvas\` 插件契约。原生实现位于 \`android-overlay/app/src/main/java/me/hisunalan/sjtudownloader/\`。
