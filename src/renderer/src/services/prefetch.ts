/**
 * 登录后后台预加载服务
 *
 * jAccount 登录成功后由 App.tsx 并行触发，提前拉取 Canvas / 好大学在线课程列表
 * 并自动连接云盘（隐式 SSO，复用 persist:sjtu 的 jAccount 会话，无需额外扫码）。
 * 用户切到对应 tab 时数据已就绪，云盘已连上可立即用 cloud/both 模式下载。
 *
 * 三个函数各自独立、失败不抛出（allSettled 语义）：失败时置对应 scanState /
 * cloudConnStatus 为 error，由用户在页面手动重试，不弹通知打扰。
 *
 * 同时被各页面组件复用以去重：CanvasBrowser.loadCourses / CnmoocBrowser.runScan /
 * useCloudConnection.onConnectCloud 内部调这些函数，避免逻辑重复。
 */
import { useAppStore } from '../store/app'

/** 预加载 Canvas 课程列表：listCourses → setCanvasCourses + setCanvasScanState('done'/'error')。
 *  handler 内 ensureCanvasLogin 会自动走 OIDC SSO（隐藏窗口，复用 jAccount cookie）。 */
export async function prefetchCanvasCourses(): Promise<void> {
  const store = useAppStore.getState()
  store.setCanvasScanState('scanning', '正在拉取 Canvas 课程列表…')
  try {
    const r = await window.api.canvas.listCourses()
    if (!r.ok) { store.setCanvasScanState('error', r.error || '拉取失败'); return }
    store.setCanvasCourses(r.courses ?? [])
    store.setCanvasScanState('done')
  } catch (err) {
    store.setCanvasScanState('error', String(err))
  }
}

/** 预加载好大学在线课程列表 + 并行拉取每门课章节（仅 HTML，不预探直链）。
 *  handler 内 ensureCnmoocLogin 会自动走 jAccount SSO。不含 resetProgress
 *  （刷新语义由调用方 CnmoocBrowser.runScan 按需前置；登录预加载无需清进度）。 */
export async function prefetchCnmoocCourses(): Promise<void> {
  const store = useAppStore.getState()
  store.setCnmoocScanState('scanning', '正在连接好大学在线…')
  try {
    const r = await window.api.cnmooc.scan()
    if (!r.ok) { store.setCnmoocScanState('error', r.error || '扫描失败'); return }
    const list = r.courses ?? []
    store.setCnmoocCourses(list)
    if (list.length === 0) {
      store.setCnmoocScanState('done', '没有找到正在学习的好大学在线课程')
      return
    }
    store.setCnmoocScanState('scanning', `正在解析章节…0 / ${list.length}`)
    let done = 0
    await Promise.all(
      list.map(async c => {
        try {
          const cr = await window.api.cnmooc.scanCourse(c.courseId)
          if (cr.ok && cr.chapters) store.setCnmoocCourseData(c.courseId, { chapters: cr.chapters })
          else store.setCnmoocCourseData(c.courseId, { chapters: [] })
        } catch {
          store.setCnmoocCourseData(c.courseId, { chapters: [] })
        } finally {
          done += 1
          store.setCnmoocScanState('scanning', `正在解析章节…${done} / ${list.length}`)
        }
      })
    )
    store.setCnmoocScanState('done')
  } catch (err) {
    store.setCnmoocScanState('error', '扫描出错：' + String(err))
  }
}

/** 自动连接云盘：directLogin（隐式 SSO，复用 jAccount 会话）→ setCloudUserToken +
 *  setCloudConnStatus('idle'/'error') + 拉取 spaceInfo。失败置 error，用户可手动重连。
 *  提取自 useCloudConnection.onConnectCloud，供 hook 与 App.tsx 登录预加载共用。 */
export async function prefetchCloudConnection(): Promise<void> {
  const store = useAppStore.getState()
  store.setCloudConnStatus('connecting')
  try {
    const r = await window.api.cloudpan.directLogin()
    if (r.ok && r.userToken) {
      store.setCloudUserToken(r.userToken)
      store.setCloudConnStatus('idle')
      // spaceInfo 不传 token，main 进程使用 directLogin 已写入的缓存
      const si = await window.api.cloudpan.spaceInfo()
      if (si.ok && si.info) store.setCloudSpaceInfo(si.info)
    } else {
      store.setCloudConnStatus('error', r.error || '连接失败')
    }
  } catch (err) {
    store.setCloudConnStatus('error', err instanceof Error ? err.message : '连接失败')
  }
}
