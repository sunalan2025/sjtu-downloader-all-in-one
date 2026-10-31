# SJTU Downloader Android — v0.2 UI / 登录 / 安全区 / 日历验证版

这个分支只修改 `mobile/` 和 Android 构建工作流；桌面 `master` 不受影响。

## 本版改动

- **移动 UI**：全新浅色视觉，四个底部导航（首页 / 课程 / 日历 / 下载），手机与平板自适应。
- **登录**：登录页使用 Android WebView 的手机端 UA/Viewport 打开 Canvas 官方 SSO，让 jAccount 官方网站自行提供手机登录界面与“交我办”跳转。允许用户主动点击的 `intent://` 及部分认证 App scheme 跳转至系统 App；未安装时提示回到网页版登录。保留显式“完成登录”校验按钮，**只有 Canvas profile API 返回 200 时才判定登录成功**。没有逆向实现或伪造交我办登录接口。
- **状态栏与系统导航栏**：MainActivity 启用 edge-to-edge；原生插件读取 Android 系统安全区/刘海/导航区域像素，前端再动态留白，避免遮挡操作区。不同品牌和手势/三键模式仍需真机测试。
- **日历**：新增实际可切换月份的月视图，通过 Canvas 官方 `calendar_events` API 获取课程活动与作业截止日期，按北京时间分组；点击不同日期查看事件。**这不是交大教学信息服务网的完整课表**，正式课程表与考试尚未移植，提供访问 `calendar.sjtu.edu.cn` 的官方入口。
- **课程与下载**：继续支持 Canvas 课程文件 API、前台下载与进度显示。

## 构建

项目依赖 Node 22、JDK 21、Android SDK 35。

```bash
cd mobile
npm install
npm run build
npm run android:prepare
cp -r android-overlay/. android/
npm run android:prepare
cd android
./gradlew assembleDebug
```

也可以直接在 GitHub Actions 中检查 `Android MVP Debug APK` 运行结果与 Artifact。

## 真机验收清单

1. 打开首页，检查状态栏、刘海挖孔及底部手势/三键区域均未遮挡文字或底部导航。
2. 点击登录，看 jAccount 是否显示适配手机的页面；点击网页中的“交我办”入口，确认能否打开对应 App 并返回认证流程。
3. 登录成功后检验 Canvas 课程列表、课件下载与任务进度。
4. 打开日历，切换前后月份，检查 Canvas 活动和 DDL 是否正确；点击交大官方课表入口。
5. 测试不同字体大小、横屏、深浅系统状态栏、返回手势和不同 Android 版本。

**注意：** 当前尚未拿交大账号完成真机验证，交我办 App 深链回跳能否复用同一个 WebView Cookie 会话仍需真机检查。Android 系统会对应用后台下载有限制，本版未提供可靠后台断点续传。文件保存于应用私有外部 Downloads/SJTU Downloader，卸载应用前请自行备份。Debug APK 由 CI 的临时密钥签名，安装新包时若出现签名冲突，先备份旧数据并卸载旧调试版再安装。

后续计划：正式教学课表和考试 → 三大课程源视频与云盘 → Android 后台可靠下载、公共文件管理及分享功能。
