/**
 * OEM-specific launcher guidance. No vendor-only private API assumptions:
 * third-party Android RemoteViews must use explicit taps for date changes.
 * Huawei's ArkTS Form Kit requires a separate HarmonyOS NEXT/HAP target.
 */
export function widgetVendorGuide(manufacturer: string, brand: string): {
  name: string
  add: string
  gestures: string
  power: string
} {
  const device = (manufacturer + ' ' + brand).toLowerCase()
  if (/xiaomi|redmi|poco/.test(device)) return {
    name:'小米 / Redmi / POCO · HyperOS',
    add:'桌面双指捏合，点击“小部件”，在“安卓小部件”中选择 SJTU Downloader。',
    gestures:'小米官方小部件规范不允许组件内部横向或纵向滑动；桌面换日请使用两侧箭头。',
    power:'若更新延迟，请允许本应用自启动和后台运行。'
  }
  if (/vivo|iqoo|bbk/.test(device)) return {
    name:'vivo / iQOO · OriginOS',
    add:'长按桌面空白处，点击“小组件”，找到 SJTU Downloader。',
    gestures:'系统原子组件的滑动交互不等于第三方 APK 的横滑权限；当前使用稳定的日期箭头。',
    power:'若更新延迟，在手机设置中搜索“自启动”或“后台高耗电”，允许本应用运行。'
  }
  if (/oppo|oneplus|realme|heytap/.test(device)) return {
    name:'OPPO / 一加 / realme · ColorOS / realme UI',
    add:'长按桌面空白处，选择“添加小组件”或“桌面卡片”，找到 SJTU Downloader。',
    gestures:'速览卡片、流体云和原子交互并不是开放给标准 APK 的通用桌面横滑接口。',
    power:'若更新延迟，可在应用耗电设置中允许后台运行。'
  }
  if (/huawei/.test(device)) return {
    name:'华为 · EMUI / HarmonyOS',
    add:'桌面双指捏合，打开“服务卡片”或“窗口小工具”，找到 SJTU Downloader。',
    gestures:'HarmonyOS NEXT 的 ArkTS Form Kit 支持 Swiper，但需要独立开发 HAP 卡片，不能给 Android RemoteViews 直接启用。',
    power:'如刷新延迟，可检查「应用启动管理」中的后台运行设置。'
  }
  if (/honor/.test(device)) return {
    name:'荣耀 · MagicOS',
    add:'桌面双指捏合或长按空白处 → 服务卡片／窗口小工具 → 查找 SJTU Downloader。',
    gestures:'荣耀快应用智慧服务卡片规范明确不支持 swiper；当前 Android 组件以左右箭头切换日期。',
    power:'检查「应用启动管理」是否允许后台活动。'
  }
  if (/meizu/.test(device)) return {
    name:'魅族 · Flyme',
    add:'长按桌面空白处，选择“添加小组件”，找到 SJTU Downloader。',
    gestures:'未找到对第三方 APK 公开的桌面横滑日期 API；保留箭头和竖直日程列表。',
    power:'如果自动换日明显延迟，可检查后台应用管理。'
  }
  if (/nubia|zte|redmagic/.test(device)) return {
    name:'努比亚 / 红魔 / 中兴 · MyOS / REDMAGIC OS',
    add:'桌面长按空白处 → 小组件／微件 → 选择 SJTU Downloader。',
    gestures:'暂未确认可供普通 APK 使用的厂商横滑接口；使用标准 Android 组件。',
    power:'检查自启动、后台管理和系统省电设置。'
  }
  if (/lenovo|motorola|moto/.test(device)) return {
    name:'联想 / 摩托罗拉 · ZUI / Hello UI',
    add:'长按桌面空白处 → 微件／小组件 → 添加 SJTU Downloader。',
    gestures:'使用 Android 标准小组件交互：日程上下滚动，日期由箭头切换。',
    power:'如果日期更新延迟，可调整应用电池策略。'
  }
  return {
    name:'Android 桌面兼容模式',
    add:'长按桌面空白处 → 微件／小组件 → 找到 SJTU Downloader。',
    gestures:'桌面标准组件不能保证收到横向滑动；日期使用左右箭头，日程上下滚动。',
    power:'若系统省电限制导致刷新延迟，可在应用电池设置里调整后台活动。'
  }
}
