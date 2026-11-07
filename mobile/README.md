# SJTU Downloader for Android

面向交大师生的课程资源下载与日程应用，支持手机和平板。安卓与桌面端分别发布，版本号独立。

[下载 Android 1.0.0](https://github.com/sunalan2025/sjtu-downloader-all-in-one/releases/download/android-v1.0.0/SJTU-Downloader-Android-v1.0.0.apk) · [应用介绍与截图](../docs/android.md)

## 使用

登录交大账号后，可浏览学期课程、搜索和批量下载文件，查看课程、考试、作业与个人日程。首页近期安排按时间加载，最多显示至下周日。学校提供相关信息时，作业可显示已提交、待批改和评分。

日历提供周课表和每日列表，课程独立浅色、考试浅红，支持准确起止时间与实时时间线。桌面提供每日安排和周课表两款组件；周末自动预览下周工作日，并分两行标明本周末与下周日期。

在“下载 → 偏好设置”管理外观、分类提醒、后台同步和桌面组件。系统权限集中在“系统权限”；允许通知后仍需手动开启日程提醒。后台定期同步单独开启，手机省电或断网时可能延迟，重新打开应用会补充更新。

最低 Android 6.0；Android 12 及以上提供系统取色和原生清晰文字周组件。账号与内容受学校授权及网络环境限制，纯 HarmonyOS NEXT 无法安装 APK。

## 构建

需要 Node.js 22、JDK 21、Android SDK 35。应用图标来自仓库根目录的 `build/icon.png`。

```sh
cd mobile
npm ci
npm run build
npm run android:prepare
npm run android:icons
cd android
./gradlew assembleRelease
```

Release 构建关闭可调试标记。没有签名文件时生成未签名 APK；正式发布流程注入升级兼容签名，并校验包名、版本、启动入口、可调试标记和证书。

保留应用 ID `me.hisunalan.sjtudownloader.beta` 以兼容已有安装，应用显示名称不含 Beta。版本 1.0.0 的版本码为 10000，可覆盖同签名旧版。历史固定签名已公开，只用于延续现有直装版本的升级兼容性，不能作为私密生产签名使用；请从本仓库正式 Release 获取 APK。

## 维护

`npm run test:ui` 运行完整界面回归；Android 工作流执行原生测试、真实 WebView 触摸与动画、组件时钟恢复，以及正式 APK 的启动和返回检查。测试数据、截图产物及 instrumentation APK 不进入正式 APK。

测试前先执行 `npm run build`。界面回归需要 Playwright Chromium，可通过 `UI_TEST_BROWSER` 指定已有 Chrome/Chromium。构建与发布入口为 [Android 工作流](../.github/workflows/android.yml)。

[设计参考与许可](docs/DESIGN_REFERENCES.md)。
