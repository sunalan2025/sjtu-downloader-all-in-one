import { useCallback, useEffect, useMemo, useRef, useState, memo, type MouseEvent } from 'react'
import { useAppStore, useEffectiveProgress } from '../store/app'
import { Spinner } from '../components/Spinner'
import type {
  AuditCourseDetail,
  AuditCourseItem,
  AuditCourseVideo,
  Course,
  DownloadMode,
  DownloadProgress,
  DownloadState,
  DownloadTaskSpec,
  VideoTask
} from '@shared/types'

// 稳定空数组：避免 tasksByCourse[id] 缺失时每次渲染都生成新 [] 引用，破坏子组件 memo
const EMPTY_TASKS: VideoTask[] = []

export function Browser() {
  const setAuth = useAppStore(s => s.setAuth)
  const setStage = useAppStore(s => s.setStage)

  const scanState = useAppStore(s => s.scanState)
  const scanMessage = useAppStore(s => s.scanMessage)
  const courses = useAppStore(s => s.courses)
  const tasksByCourse = useAppStore(s => s.tasksByCourse)
  const selected = useAppStore(s => s.selected)
  const expandedCourses = useAppStore(s => s.expandedCourses)
  const cloudUserToken = useAppStore(s => s.cloudUserToken)
  const cloudSpaceInfo = useAppStore(s => s.cloudSpaceInfo)
  const downloadMode = useAppStore(s => s.downloadMode)
  const localDestRoot = useAppStore(s => s.localDestRoot)
  const cloudLinkedIds = useAppStore(s => s.cloudLinkedIds)
  const downloading = useAppStore(s => s.downloading)
  const progress = useAppStore(s => s.progress)
  const concurrency = useAppStore(s => s.concurrency)

  const setScan = useAppStore(s => s.setScan)
  const setCourses = useAppStore(s => s.setCourses)
  const setTasksForCourse = useAppStore(s => s.setTasksForCourse)
  const resetScanResults = useAppStore(s => s.resetScanResults)
  const setSelected = useAppStore(s => s.setSelected)
  const toggleSelect = useAppStore(s => s.toggleSelect)
  const toggleSelectMany = useAppStore(s => s.toggleSelectMany)
  const toggleExpand = useAppStore(s => s.toggleExpand)
  const setCloudUserToken = useAppStore(s => s.setCloudUserToken)
  const setCloudSpaceInfo = useAppStore(s => s.setCloudSpaceInfo)
  const setDownloadMode = useAppStore(s => s.setDownloadMode)
  const setLocalDestRoot = useAppStore(s => s.setLocalDestRoot)
  const setCloudLinkedIds = useAppStore(s => s.setCloudLinkedIds)
  const setDownloading = useAppStore(s => s.setDownloading)
  const applyProgress = useAppStore(s => s.applyProgress)
  const setConcurrency = useAppStore(s => s.setConcurrency)

  // ── 辅助：both 模式下判断单个任务是否完成 / 出错 ──
  const isBothMode = downloadMode === 'both' && Object.keys(cloudLinkedIds).length > 0

  // 把当前所有任务摊平一下，方便全选 / 计数
  const allTasks = useMemo(() => {
    const out: VideoTask[] = []
    for (const c of courses) out.push(...(tasksByCourse[c.id] ?? []))
    return out
  }, [courses, tasksByCourse])
  const total = allTasks.length
  const selectedCount = selected.size

  // 进入页面自动扫描，防止 strict-mode 双调用用 ref 锁一下
  const scanStartedRef = useRef(false)
  const runScan = useCallback(async (): Promise<void> => {
    resetScanResults()
    setScan('scanning', '正在拉取课程列表…')
    try {
      const env = await window.api.vsjtu.scanAudit(1, 100)
      if (!env?.success) {
        const msg = env?.message || '拉取课程列表失败'
        setScan('error', msg)
        if (msg.includes('未登录') || msg.includes('登录已过期')) {
          setAuth({ loggedIn: false })
          setStage('login')
        }
        return
      }
      const records: AuditCourseItem[] = env.data?.list ?? []
      const approved = records.filter(r => r.applyStatus === 1)
      // 同一门课多次申请按 resourceId 去重，保留最近一条
      const dedup = new Map<number, Course>()
      for (const r of approved) {
        const rid = r.auditCourseResources?.[0]?.resourceId
        if (!rid) continue
        dedup.set(rid, {
          id: rid,
          applyId: r.id,
          name: r.subjName || '未命名课程',
          courseCode: r.subjCode,
          teacher: r.teacName,
          term: r.acteTerm,
          org: r.orgaName
        })
      }
      const list = Array.from(dedup.values())
      setCourses(list)

      if (list.length === 0) {
        setScan('done', '没有找到已批准的旁听课程')
        return
      }

      setScan('scanning', `正在扫描视频…0 / ${list.length}`)
      let done = 0
      // 课程详情可以并发拉，每完成一个就更新进度
      await Promise.all(
        list.map(async c => {
          try {
            const det = await window.api.vsjtu.auditCourseDetail(c.id)
            if (det?.success && det.data) {
              const tasks = buildTasksForCourse(c, det.data)
              setTasksForCourse(c.id, tasks)
            } else {
              setTasksForCourse(c.id, [])
            }
          } catch {
            setTasksForCourse(c.id, [])
          } finally {
            done += 1
            setScan('scanning', `正在扫描视频…${done} / ${list.length}`)
          }
        })
      )
      setScan('done')
    } catch (err) {
      setScan('error', '扫描出错：' + String(err))
    }
  }, [
    resetScanResults,
    setScan,
    setCourses,
    setTasksForCourse,
    setAuth,
    setStage
  ])

  useEffect(() => {
    if (scanStartedRef.current) return
    if (scanState !== 'idle') return
    scanStartedRef.current = true
    void runScan()
  }, [runScan, scanState])

  // 初次进来检查是否有缓存的云盘 UserToken
  useEffect(() => {
    if (cloudUserToken) {
      // 已有 token，验证并获取空间信息
      void window.api.cloudpan.validateToken(cloudUserToken).then(r => {
        if (!r.ok) setCloudUserToken(null)
        else {
          void window.api.cloudpan.spaceInfo(cloudUserToken).then(si => {
            if (si.ok && si.info) setCloudSpaceInfo(si.info)
          })
        }
      })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 扫描结束默认全选（只执行一次，避免用户手动取消全选后又被 effect 重新勾上）
  const autoSelectedRef = useRef(false)
  useEffect(() => {
    if (scanState === 'done' && total > 0 && !autoSelectedRef.current) {
      autoSelectedRef.current = true
      setSelected(new Set(allTasks.map(t => t.taskId)))
    }
  }, [scanState, total, allTasks, setSelected])

  // 订阅下载进度
  useEffect(() => window.api.download.onProgress(p => applyProgress(p)), [applyProgress])

  // 把渲染端的并发偏好同步给主进程；store 已经 persist 这个值
  useEffect(() => {
    void window.api.download.setConcurrency(concurrency)
  }, [concurrency])

  // 全任务都到 final 状态时收尾（paused 不算 final，保留 downloading 让全局控制可见）
  useEffect(() => {
    if (!downloading) return
    const ids = allTasks.filter(t => selected.has(t.taskId)).map(t => t.taskId)
    if (ids.length === 0) {
      setDownloading(false)
      return
    }
    const allFinal = ids.every(id => {
      if (isBothMode) {
        const localDone = progress[id]?.state === 'done' || progress[id]?.state === 'skipped' || progress[id]?.state === 'error' || progress[id]?.state === 'cancelled'
        const cloudId = cloudLinkedIds[id]
        const cloudDone = !cloudId || progress[cloudId]?.state === 'done' || progress[cloudId]?.state === 'skipped' || progress[cloudId]?.state === 'error' || progress[cloudId]?.state === 'cancelled'
        return localDone && cloudDone
      }
      const s = progress[id]?.state
      return s === 'done' || s === 'error' || s === 'skipped' || s === 'cancelled'
    })
    if (allFinal) setDownloading(false)
  }, [progress, downloading, allTasks, selected, setDownloading, downloadMode, cloudLinkedIds])

  const onLogout = async (): Promise<void> => {
    await window.api.auth.logout()
    setAuth({ loggedIn: false })
    resetScanResults()
    scanStartedRef.current = false
    autoSelectedRef.current = false
    setStage('welcome')
  }

  const [cloudConn, setCloudConn] = useState<
    | { status: 'idle' }
    | { status: 'connecting' }
    | { status: 'error'; message: string }
  >({ status: 'idle' })

  const onConnectCloud = async (): Promise<void> => {
    setCloudConn({ status: 'connecting' })
    try {
      const r = await window.api.cloudpan.directLogin()
      if (r.ok && r.userToken) {
        setCloudUserToken(r.userToken)
        setCloudConn({ status: 'idle' })
        const si = await window.api.cloudpan.spaceInfo(r.userToken)
        if (si.ok && si.info) setCloudSpaceInfo(si.info)
      } else {
        setCloudConn({ status: 'error', message: r.error || '连接失败' })
      }
    } catch (err) {
      setCloudConn({ status: 'error', message: err instanceof Error ? err.message : '连接失败' })
    }
  }

  const onDisconnectCloud = (): void => {
    setCloudUserToken(null)
    setCloudSpaceInfo(null)
    setCloudConn({ status: 'idle' })
    void window.api.cloudpan.logout()
  }

  const onToggleAll = (): void => {
    if (selectedCount === total && total > 0) setSelected(new Set())
    else setSelected(new Set(allTasks.map(t => t.taskId)))
  }

  const onSelectLocalFolder = async (): Promise<void> => {
    const path = await window.api.selectFolder()
    if (path) setLocalDestRoot(path)
  }

  const onDownload = async (): Promise<void> => {
    if (selectedCount === 0 || downloading) return

    const chosen = allTasks.filter(t => selected.has(t.taskId))

    // 按 lecture (videoId) 分组：一次 vod-info 同时解出教师 + PPT 两路
    const byLecture = new Map<number, VideoTask[]>()
    for (const t of chosen) {
      const arr = byLecture.get(t.videoId) ?? []
      arr.push(t)
      byLecture.set(t.videoId, arr)
    }

    // 构建需要处理的任务 spec：跳过已完全完成的（本地 done 且云端 done）
    const specs: DownloadTaskSpec[] = []
    for (const items of byLecture.values()) {
      for (const t of items) {
        const localDone = progress[t.taskId]?.state === 'done' || progress[t.taskId]?.state === 'skipped'
        const cloudId = cloudLinkedIds[t.taskId]
        const cloudDone = !cloudId
          || progress[cloudId]?.state === 'done'
          || progress[cloudId]?.state === 'skipped'
        if (localDone && cloudDone) continue
        applyProgress({
          taskId: t.taskId,
          state: 'pending',
          received: 0,
          total: 0,
          message: '等待解析直链…'
        })
        specs.push({
          taskId: t.taskId,
          url: '',
          courseName: t.courseName,
          fileName: t.fileName,
          refId: t.refId,
          angle: t.angle
        })
      }
    }

    if (specs.length === 0) return
    setDownloading(true)

    if (downloadMode === 'both') {
      const mapping: Record<string, string> = { ...cloudLinkedIds }
      for (const spec of specs) mapping[spec.taskId] = spec.taskId + '_cloud'
      setCloudLinkedIds(mapping)
    } else {
      setCloudLinkedIds({})
    }

    const result = await window.api.download.start('', specs, {
      mode: downloadMode,
      localDestRoot: downloadMode !== 'cloud' ? localDestRoot : undefined
    })
    if (!result.ok) {
      setDownloading(false)
      setCloudLinkedIds({})
      for (const spec of specs) {
        applyProgress({
          taskId: spec.taskId,
          state: 'error',
          received: 0,
          total: 0,
          message: result.error || '下载启动失败'
        })
      }
    }
  }

  // 单任务 / 全局 控制
  const onPauseTask = useCallback((id: string) => {
    window.api.download.pause(id).catch(() => undefined)
  }, [])
  const onCancelTask = useCallback((id: string) => {
    window.api.download.cancel(id).catch(() => undefined)
  }, [])
  const onResumeTask = useCallback((id: string) => {
    window.api.download.resume(id).catch(() => undefined)
  }, [])
  const onPauseAll = useCallback(() => {
    window.api.download.pauseAll().catch(() => undefined)
  }, [])
  const onCancelAll = useCallback(() => {
    window.api.download.cancelAll().catch(() => undefined)
  }, [])
  const onResumeAll = useCallback(() => {
    window.api.download.resumeAll().catch(() => undefined)
  }, [])
  const onConcurrencyChange = useCallback(
    (n: number) => {
      setConcurrency(n)
    },
    [setConcurrency]
  )

  const completed = useMemo(() => {
    if (!isBothMode) {
      return allTasks.reduce((n, t) => {
        if (!selected.has(t.taskId)) return n
        const s = progress[t.taskId]?.state
        return n + (s === 'done' || s === 'skipped' ? 1 : 0)
      }, 0)
    }
    return allTasks.reduce((n, t) => {
      if (!selected.has(t.taskId)) return n
      const local = progress[t.taskId]
      const localDone = local?.state === 'done' || local?.state === 'skipped'
      if (!localDone) return n
      const cloudId = cloudLinkedIds[t.taskId]
      if (!cloudId) return n + 1
      const cloud = progress[cloudId]
      return n + (cloud?.state === 'done' || cloud?.state === 'skipped' ? 1 : 0)
    }, 0)
  }, [allTasks, selected, progress, isBothMode, cloudLinkedIds])
  const failed = useMemo(() => {
    if (!isBothMode) {
      return allTasks.reduce((n, t) =>
        n + (selected.has(t.taskId) && progress[t.taskId]?.state === 'error' ? 1 : 0), 0)
    }
    return allTasks.reduce((n, t) => {
      if (!selected.has(t.taskId)) return n
      if (progress[t.taskId]?.state === 'error') return n + 1
      const cloudId = cloudLinkedIds[t.taskId]
      return n + (cloudId && progress[cloudId]?.state === 'error' ? 1 : 0)
    }, 0)
  }, [allTasks, selected, progress, isBothMode, cloudLinkedIds])

  return (
    <div className="flex h-full w-full flex-col">
      <TopBar
        scanState={scanState}
        scanMessage={scanMessage}
        courseCount={courses.length}
        total={total}
        onLogout={onLogout}
      />

      {scanState === 'done' && total > 0 && (
        <ActionBar
          selectedCount={selectedCount}
          total={total}
          cloudUserToken={cloudUserToken}
          cloudSpaceInfo={cloudSpaceInfo}
          cloudConnecting={cloudConn.status === 'connecting'}
          cloudError={cloudConn.status === 'error' ? cloudConn.message : null}
          downloadMode={downloadMode}
          localDestRoot={localDestRoot}
          downloading={downloading}
          completed={completed}
          failed={failed}
          concurrency={concurrency}
          onToggleAll={onToggleAll}
          onConnectCloud={onConnectCloud}
          onDisconnectCloud={onDisconnectCloud}
          onDownload={onDownload}
          onSelectLocalFolder={onSelectLocalFolder}
          onModeChange={setDownloadMode}
          onConcurrencyChange={onConcurrencyChange}
          onPauseAll={onPauseAll}
          onResumeAll={onResumeAll}
          onCancelAll={onCancelAll}
        />
      )}

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {scanState === 'scanning' && <ScanningHero msg={scanMessage} />}
        {scanState === 'error' && (
          <ErrorHero msg={scanMessage} onRetry={() => void runScan()} />
        )}
        {scanState === 'done' && courses.length === 0 && <EmptyHero />}
        {scanState === 'done' && courses.length > 0 && (
          <div className="flex flex-col gap-4">
            {courses.map(c => (
              <CourseSection
                key={c.id}
                course={c}
                tasks={tasksByCourse[c.id] ?? EMPTY_TASKS}
                selected={selected}
                expanded={expandedCourses.has(c.id)}
                onToggle={toggleSelect}
                onToggleMany={toggleSelectMany}
                onToggleExpand={toggleExpand}
                onPauseTask={onPauseTask}
                onCancelTask={onCancelTask}
                onResumeTask={onResumeTask}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// 顶栏
// ─────────────────────────────────────────────────────────────

function TopBar({
  scanState,
  scanMessage,
  courseCount,
  total,
  onLogout
}: {
  scanState: 'idle' | 'scanning' | 'done' | 'error'
  scanMessage: string
  courseCount: number
  total: number
  onLogout: () => void
}) {
  return (
    <div className="no-drag flex items-center gap-4 border-b border-bd px-6 py-3">
      <div className="inline-flex items-center gap-2 rounded-full bg-success-bg px-3 py-1.5 text-xs font-medium text-success ring-1 ring-success-ring">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-success shadow-[0_0_8px_var(--success-ring)]" />
        已登录
      </div>
      <div className="min-w-0 flex-1 truncate text-sm text-text-2">
        {scanState === 'scanning' && (
          <span className="inline-flex items-center gap-2">
            <Spinner size={14} /> {scanMessage}
          </span>
        )}
        {scanState === 'done' && courseCount > 0 && (
          <span>
            扫描完成 · {courseCount} 门课 · 共 {total} 节视频流（含教师 / PPT 两路）
          </span>
        )}
        {scanState === 'error' && <span className="text-warning">{scanMessage}</span>}
      </div>
      <button
        type="button"
        onClick={onLogout}
        className="rounded-lg px-3 py-1.5 text-xs text-text-3 transition-all duration-150 hover:bg-surface-3 hover:text-text-1"
        title="清除本机登录会话，返回首页"
      >
        退出登录
      </button>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// 操作条 — 双行布局，第一行选择/云盘/目录，第二行模式/并发/控制/下载
// ─────────────────────────────────────────────────────────────

function ActionBar({
  selectedCount,
  total,
  cloudUserToken,
  cloudSpaceInfo,
  cloudConnecting,
  cloudError,
  downloadMode,
  localDestRoot,
  downloading,
  completed,
  failed,
  concurrency,
  onToggleAll,
  onConnectCloud,
  onDisconnectCloud,
  onDownload,
  onSelectLocalFolder,
  onModeChange,
  onConcurrencyChange,
  onPauseAll,
  onResumeAll,
  onCancelAll
}: {
  selectedCount: number
  total: number
  cloudUserToken: string | null
  cloudSpaceInfo: import('@shared/types').CloudPanSpaceInfo | null
  cloudConnecting: boolean
  cloudError: string | null
  downloadMode: DownloadMode
  localDestRoot: string
  downloading: boolean
  completed: number
  failed: number
  concurrency: number
  onToggleAll: () => void
  onConnectCloud: () => void
  onDisconnectCloud: () => void
  onDownload: () => void
  onSelectLocalFolder: () => void
  onModeChange: (m: DownloadMode) => void
  onConcurrencyChange: (n: number) => void
  onPauseAll: () => void
  onResumeAll: () => void
  onCancelAll: () => void
}) {
  const triState: TriState =
    selectedCount === 0 ? 'none' : selectedCount === total ? 'all' : 'some'

  const needsCloud = downloadMode === 'cloud' || downloadMode === 'both'
  const needsLocal = downloadMode === 'local' || downloadMode === 'both'
  const canStart = selectedCount > 0
    && !downloading
    && (!needsCloud || !!cloudUserToken)
    && (!needsLocal || !!localDestRoot)

  const btnLabel = downloading
    ? '进行中…'
    : downloadMode === 'local'
      ? `开始下载 ${selectedCount} 项`
      : downloadMode === 'cloud'
        ? `开始上传 ${selectedCount} 项`
        : `开始下载+上传 ${selectedCount} 项`

  return (
    <div className="no-drag border-b border-bd bg-surface-3 px-6 py-3">
      {/* 第一行：选择 + 云盘/目录 + 进度 + 模式/并发/帮助 */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onToggleAll}
          className="inline-flex items-center gap-2 rounded-lg px-2 py-1 text-sm text-text-1 transition-colors duration-150 hover:bg-surface-3 hover:text-text-1"
        >
          <TriCheckbox state={triState} size="lg" />
          <span>
            全选 <span className="text-text-3">({selectedCount} / {total})</span>
          </span>
        </button>

        <div className="h-4 w-px bg-bd-strong" />

        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {needsCloud && cloudUserToken ? (
            <button
              type="button"
              onClick={onDisconnectCloud}
              className="inline-flex max-w-full items-center gap-2 rounded-lg border border-info-ring bg-info-bg px-3 py-1.5 text-xs font-medium text-info transition-all duration-150 hover:border-cloud-40 hover:text-cloud"
              title="点击断开云盘连接"
            >
              <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
                <path d="M12 13v5m-3-3l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="truncate">
                交大云盘已连接
                {cloudSpaceInfo && (
                  <span className="ml-1.5 text-text-muted">
                    {(Number(cloudSpaceInfo.size) / (1024 ** 3)).toFixed(1)}GB / {(Number(cloudSpaceInfo.capacity) / (1024 ** 3)).toFixed(0)}GB
                  </span>
                )}
              </span>
            </button>
          ) : needsCloud && cloudConnecting ? (
            <span className="inline-flex items-center gap-2 text-xs text-info">
              <Spinner size={14} />
              正在连接交大云盘…
            </span>
          ) : needsCloud ? (
            <button
              type="button"
              onClick={onConnectCloud}
              className="inline-flex max-w-full items-center gap-2 rounded-lg border border-bd-strong bg-surface-3 px-3 py-1.5 text-xs text-text-2 transition-all duration-150 hover:border-info-ring hover:text-info"
              title="通过 jAccount 单点登录连接交大云盘，用于上传视频文件"
            >
              <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
              </svg>
              <span>连接交大云盘</span>
            </button>
          ) : null}
          {cloudError && !cloudConnecting && !cloudUserToken && needsCloud && (
            <span className="text-xs text-warning">{cloudError}</span>
          )}

          {needsLocal && (
            <button
              type="button"
              onClick={onSelectLocalFolder}
              className="inline-flex max-w-full items-center gap-2 rounded-lg border border-bd-strong bg-surface-3 px-3 py-1.5 text-xs text-text-2 transition-all duration-150 hover:border-success-ring hover:text-success"
              title="选择视频保存的本地文件夹，未选择时使用系统默认下载目录"
            >
              <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              <span className="truncate max-w-[180px]">
                {localDestRoot || '选择下载目录'}
              </span>
            </button>
          )}

          {downloading && (
            <div className="flex items-center gap-3 rounded-lg bg-surface-3 px-3 py-1.5 text-xs">
              <span className="text-text-2">
                完成 <span className="font-medium text-success">{completed}</span> / {selectedCount}
              </span>
              {failed > 0 && (
                <span className="text-warning">失败 {failed}</span>
              )}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <ModeSelector value={downloadMode} onChange={onModeChange} />
          <ConcurrencyControl value={concurrency} onChange={onConcurrencyChange} />
          <HelpButton />
        </div>
      </div>

      {/* 第二行：全局控制 + 开始按钮 */}
      <div className="mt-2.5 flex flex-wrap items-center gap-3">
        <div className="flex-1" />

        {downloading && (
          <div className="flex items-center gap-1">
            <GlobalCtrlButton kind="pause" onClick={onPauseAll} title="暂停全部下载任务" />
            <GlobalCtrlButton kind="resume" onClick={onResumeAll} title="继续全部下载任务" />
            <GlobalCtrlButton kind="cancel" onClick={onCancelAll} title="取消全部下载任务" />
          </div>
        )}

        <button
          type="button"
          onClick={onDownload}
          disabled={!canStart}
          className="inline-flex h-9 items-center gap-2 rounded-xl bg-accent px-5 text-sm font-semibold text-white shadow-glow-sm transition-all duration-200 hover:scale-[1.02] hover:bg-accent-light hover:shadow-glow disabled:scale-100 disabled:bg-surface-2 disabled:text-text-3 disabled:shadow-none"
        >
          {btnLabel}
        </button>
      </div>
    </div>
  )
}

function ModeSelector({
  value,
  onChange
}: {
  value: DownloadMode
  onChange: (m: DownloadMode) => void
}) {
  const modes: { key: DownloadMode; label: string; hint: string }[] = [
    { key: 'local', label: '本地', hint: '仅下载视频到本地磁盘' },
    { key: 'cloud', label: '云盘', hint: '仅上传视频到交大云盘' },
    { key: 'both', label: '两者', hint: '同时下载到本地并上传到云盘' }
  ]
  const activeIdx = modes.findIndex(m => m.key === value)
  return (
    <div className="relative inline-flex select-none items-center rounded-lg border border-bd bg-surface-2 p-0.5 text-xs">
      {/* 玻璃滑动指示器 */}
      <span
        className="absolute top-0.5 bottom-0.5 rounded-md bg-surface-1 shadow-sm transition-all duration-300 ease-out"
        style={{
          width: `calc(${100 / modes.length}% - 2px)`,
          left: `calc(${activeIdx * (100 / modes.length)}% + 1px)`
        }}
      />
      {modes.map(m => (
        <button
          key={m.key}
          type="button"
          onClick={() => onChange(m.key)}
          title={m.hint}
          className={`relative z-10 px-3 py-1.5 font-medium transition-colors duration-200 ${
            value === m.key ? 'text-accent' : 'text-text-3 hover:text-text-1'
          }`}
        >
          {m.label}
        </button>
      ))}
    </div>
  )
}

function ConcurrencyControl({
  value,
  onChange
}: {
  value: number
  onChange: (n: number) => void
}) {
  return (
    <label
      className="inline-flex select-none items-center gap-2.5 rounded-lg border border-bd bg-surface-3 px-3 py-1.5 text-xs text-text-2"
      title="同时进行的下载/上传任务数量。数值越大速度越快，但对网络要求越高"
    >
      <span className="shrink-0 text-text-2">并发</span>
      <input
        type="range"
        min={2}
        max={16}
        step={1}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="h-1.5 w-24 cursor-pointer accent-accent"
      />
      <span className="w-7 text-center font-mono text-sm font-medium text-text-1">{value}</span>
    </label>
  )
}

function HelpButton() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // 点击外部关闭
  useEffect(() => {
    if (!open) return
    const handler = (e: globalThis.MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-accent text-xs font-bold text-text-1 shadow-glow-sm animate-pulse transition-all duration-150 hover:scale-110 hover:shadow-glow"
        title="查看模式和并发设置说明"
      >
        ?
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 rounded-xl border border-bd-strong bg-surface-1/95 p-4 text-xs leading-relaxed text-text-2 shadow-xl backdrop-blur-md">
          <div className="mb-3 text-sm font-semibold text-text-1">设置说明</div>

          <div className="space-y-3">
            <div>
              <div className="mb-1 font-medium text-text-1">下载模式</div>
              <div className="space-y-1.5 text-text-3">
                <p><span className="font-medium text-text-2">本地</span> — 视频下载到你选择的本地文件夹。适合需要离线观看或备份的场景。</p>
                <p><span className="font-medium text-text-2">云盘</span> — 视频直传交大云盘，不占本地空间。适合磁盘空间有限或需要多设备访问的场景。</p>
                <p><span className="font-medium text-text-2">两者</span> — 同时下载到本地和上传到云盘。一份带宽双重备份，适合重要课程。</p>
              </div>
            </div>

            <div className="border-t border-bd pt-3">
              <div className="mb-1 font-medium text-text-1">并发数设置</div>
              <div className="space-y-1.5 text-text-3">
                <p>并发数 = 同时进行的下载/上传任务数量。数值越大速度越快，但对带宽和 CPU 的要求越高。</p>
                <div className="mt-2 space-y-1">
                  <p><span className="font-medium text-success">2-3</span> — 校园无线网、VPN、带宽有限时推荐</p>
                  <p><span className="font-medium text-info">4-6</span> — 有线网络、带宽充裕时推荐（默认）</p>
                  <p><span className="font-medium text-warning">7-10</span> — 千兆网络、需要快速批量下载时</p>
                  <p><span className="font-medium text-danger">11-16</span> — 仅限非常充裕的带宽环境，过高可能触发限流</p>
                </div>
                <p className="mt-1.5 text-text-4">建议从低并发开始，逐步调高观察速度变化。如果速度反而下降或频繁出错，请降低并发数。</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function GlobalCtrlButton({
  kind,
  onClick,
  title
}: {
  kind: 'pause' | 'resume' | 'cancel'
  onClick: () => void
  title: string
}) {
  const tone =
    kind === 'cancel'
      ? 'text-danger ring-danger-ring hover:bg-danger-bg'
      : kind === 'pause'
        ? 'text-warning ring-warning-ring hover:bg-warning-bg'
        : 'text-success ring-success-ring hover:bg-success-bg'
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-lg bg-surface-3 ring-1 transition-all duration-150 hover:scale-105 ${tone}`}
    >
      <CtrlIcon kind={kind} />
    </button>
  )
}

function CtrlIcon({ kind, size = 14 }: { kind: 'pause' | 'resume' | 'cancel'; size?: number }) {
  if (kind === 'pause') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
        <rect x="6" y="5" width="4" height="14" rx="1" />
        <rect x="14" y="5" width="4" height="14" rx="1" />
      </svg>
    )
  }
  if (kind === 'resume') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
        <path d="M7 5v14l12-7L7 5z" />
      </svg>
    )
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

// ─────────────────────────────────────────────────────────────
// 课程卡片（可折叠） + 一讲一行（教师+PPT 合并）
// ─────────────────────────────────────────────────────────────

type TriState = 'none' | 'some' | 'all'

interface Lecture {
  videoId: number
  lectureLabel: string
  lectureDate?: string
  sort: number
  teacher?: VideoTask
  ppt?: VideoTask
}

function groupByLecture(tasks: VideoTask[]): Lecture[] {
  const map = new Map<number, Lecture>()
  for (const t of tasks) {
    let lec = map.get(t.videoId)
    if (!lec) {
      lec = {
        videoId: t.videoId,
        lectureLabel: t.lectureLabel,
        lectureDate: t.lectureDate,
        sort: t.sort
      }
      map.set(t.videoId, lec)
    }
    if (t.angle === 0) lec.teacher = t
    else if (t.angle === 3) lec.ppt = t
  }
  return [...map.values()].sort((a, b) => a.sort - b.sort)
}

const CourseSection = memo(function CourseSection({
  course,
  tasks,
  selected,
  expanded,
  onToggle,
  onToggleMany,
  onToggleExpand,
  onPauseTask,
  onCancelTask,
  onResumeTask
}: {
  course: Course
  tasks: VideoTask[]
  selected: Set<string>
  expanded: boolean
  onToggle: (id: string) => void
  onToggleMany: (ids: string[], on: boolean) => void
  onToggleExpand: (id: number) => void
  onPauseTask: (id: string) => void
  onCancelTask: (id: string) => void
  onResumeTask: (id: string) => void
}) {
  const ids = tasks.map(t => t.taskId)
  const teacherIds = tasks.filter(t => t.angle === 0).map(t => t.taskId)
  const pptIds = tasks.filter(t => t.angle === 3).map(t => t.taskId)
  const selCount = tasks.reduce((n, t) => n + (selected.has(t.taskId) ? 1 : 0), 0)
  const teacherSel = teacherIds.reduce((n, id) => n + (selected.has(id) ? 1 : 0), 0)
  const pptSel = pptIds.reduce((n, id) => n + (selected.has(id) ? 1 : 0), 0)
  const triState: TriState =
    selCount === 0 ? 'none' : selCount === ids.length ? 'all' : 'some'
  const teacherTri: TriState =
    teacherSel === 0 ? 'none' : teacherSel === teacherIds.length ? 'all' : 'some'
  const pptTri: TriState = pptSel === 0 ? 'none' : pptSel === pptIds.length ? 'all' : 'some'
  // 只订阅本课程任务的 done/skipped 计数
  const doneCount = useAppStore(s => {
    if (s.downloadMode !== 'both') {
      return tasks.reduce((n, t) => {
        const st = s.progress[t.taskId]?.state
        return n + (st === 'done' || st === 'skipped' ? 1 : 0)
      }, 0)
    }
    return tasks.reduce((n, t) => {
      const local = s.progress[t.taskId]
      const cloudId = s.cloudLinkedIds[t.taskId]
      const cloud = cloudId ? s.progress[cloudId] : undefined
      const localDone = local?.state === 'done' || local?.state === 'skipped'
      const cloudDone = cloud?.state === 'done' || cloud?.state === 'skipped'
      return n + ((localDone && cloudDone) || (localDone && !cloudId) ? 1 : 0)
    }, 0)
  })
  // 编码下载中 + 出错计数为单个数值，避免 selector 返回对象导致每次 progress 更新都触发重渲染
  // both 模式下同时检查本地和云端状态：本地完成但云端还在上传 → 算下载中
  const dlAndErr = useAppStore(s => {
    const isBoth = s.downloadMode === 'both' && Object.keys(s.cloudLinkedIds).length > 0
    let downloading = 0, errors = 0
    for (const t of tasks) {
      const st = s.progress[t.taskId]?.state
      const isLocalFinal = st === 'done' || st === 'skipped' || st === 'cancelled'
      if (isBoth) {
        const cloudId = s.cloudLinkedIds[t.taskId]
        const cloudSt = cloudId ? s.progress[cloudId]?.state : undefined
        const isCloudFinal = !cloudId || cloudSt === 'done' || cloudSt === 'skipped' || cloudSt === 'cancelled'
        if (!isLocalFinal || !isCloudFinal) {
          if (st === 'error' || cloudSt === 'error') errors++
          else downloading++
        }
      } else {
        if (!isLocalFinal) {
          if (st === 'error') errors++
          else downloading++
        }
      }
    }
    return downloading * 1000 + errors
  })
  const downloadingCount = Math.floor(dlAndErr / 1000)
  const errorCount = dlAndErr % 1000
  const lectures = useMemo(() => groupByLecture(tasks), [tasks])

  return (
    <section className="overflow-hidden rounded-2xl border border-bd bg-surface-3 shadow-card transition-shadow duration-200 hover:shadow-card-hover">
      <header
        className="flex cursor-pointer select-none items-center gap-4 px-5 py-4 transition-colors duration-150 hover:bg-surface-3"
        onClick={() => onToggleExpand(course.id)}
      >
        <Chevron open={expanded} />
        <span
          role="checkbox"
          aria-checked={triState === 'some' ? 'mixed' : triState === 'all'}
          tabIndex={0}
          onClick={e => {
            e.stopPropagation()
            onToggleMany(ids, triState !== 'all')
          }}
          onKeyDown={e => {
            if (e.key === ' ' || e.key === 'Enter') {
              e.preventDefault()
              e.stopPropagation()
              onToggleMany(ids, triState !== 'all')
            }
          }}
          className="shrink-0"
        >
          <TriCheckbox state={triState} size="lg" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="line-clamp-1 text-base font-semibold text-text-1">{course.name}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-3">
            {course.courseCode && (
              <span className="rounded-md bg-surface-2 px-2 py-0.5 font-mono text-xs text-text-2">
                {course.courseCode}
              </span>
            )}
            {course.teacher && <span>{course.teacher}</span>}
            {course.teacher && course.term && <span className="text-text-4">·</span>}
            {course.term && <span>{course.term}</span>}
          </div>
        </div>

        <div
          className="flex shrink-0 items-center gap-2"
          onClick={e => e.stopPropagation()}
        >
          {teacherIds.length > 0 && (
            <BatchAngleButton
              label="教师"
              state={teacherTri}
              selCount={teacherSel}
              total={teacherIds.length}
              accent="sky"
              onClick={() => onToggleMany(teacherIds, teacherTri !== 'all')}
            />
          )}
          {pptIds.length > 0 && (
            <BatchAngleButton
              label="PPT"
              state={pptTri}
              selCount={pptSel}
              total={pptIds.length}
              accent="amber"
              onClick={() => onToggleMany(pptIds, pptTri !== 'all')}
            />
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2 text-xs text-text-3">
          <span>
            {lectures.length} 讲 · 已选 <span className="font-medium text-text-1">{selCount}</span> /{' '}
            {ids.length}
          </span>
        </div>
      </header>

      {(doneCount > 0 || downloadingCount > 0 || errorCount > 0) && (
        <div className="border-t border-bd px-5 py-3">
          <div className="flex items-center gap-3">
            {/* 进度条 */}
            <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-surface-2">
              <div
                className={`h-full rounded-full transition-[width] duration-300 ${
                  errorCount > 0 && doneCount === 0 ? 'bg-warning' : 'bg-success'
                }`}
                style={{ width: `${ids.length > 0 ? Math.round((doneCount / ids.length) * 100) : 0}%` }}
              />
            </div>
            {/* 状态文字 */}
            <div className="flex shrink-0 items-center gap-2.5 text-xs tabular-nums">
              <span className="font-medium text-success">{doneCount}/{ids.length}</span>
              {downloadingCount > 0 && (
                <span className="inline-flex items-center gap-1 text-info">
                  <Spinner size={11} />{downloadingCount}
                </span>
              )}
              {errorCount > 0 && (
                <span className="text-warning">失败 {errorCount}</span>
              )}
            </div>
          </div>
        </div>
      )}

      {expanded && (
        <div className="animate-slideDown">
        {lectures.length === 0 ? (
          <div className="border-t border-bd px-5 py-5 text-center text-sm text-text-3">
            该课程暂无可下载视频
          </div>
        ) : (
          <ul className="divide-y divide-bd border-t border-bd">
            {lectures.map(lec => (
              <LectureRow
                key={lec.videoId}
                lecture={lec}
                selected={selected}
                onToggle={onToggle}
                onToggleMany={onToggleMany}
                onPauseTask={onPauseTask}
                onCancelTask={onCancelTask}
                onResumeTask={onResumeTask}
              />
            ))}
          </ul>
        )}
        </div>
      )}
    </section>
  )
})

const LectureRow = memo(function LectureRow({
  lecture,
  selected,
  onToggle,
  onToggleMany,
  onPauseTask,
  onCancelTask,
  onResumeTask
}: {
  lecture: Lecture
  selected: Set<string>
  onToggle: (id: string) => void
  onToggleMany: (ids: string[], on: boolean) => void
  onPauseTask: (id: string) => void
  onCancelTask: (id: string) => void
  onResumeTask: (id: string) => void
}) {
  const { teacher, ppt, lectureLabel, lectureDate } = lecture
  const ids = [teacher?.taskId, ppt?.taskId].filter(Boolean) as string[]
  const selCount = ids.reduce((n, id) => n + (selected.has(id) ? 1 : 0), 0)
  const triState: TriState =
    selCount === 0 ? 'none' : selCount === ids.length ? 'all' : 'some'

  return (
    <li className="flex items-center gap-4 px-5 py-3 transition-colors duration-100 hover:bg-surface-3">
      <span
        role="checkbox"
        aria-checked={triState === 'some' ? 'mixed' : triState === 'all'}
        onClick={() => onToggleMany(ids, triState !== 'all')}
        className="shrink-0 cursor-pointer"
      >
        <TriCheckbox state={triState} size="lg" />
      </span>
      <div className="flex w-44 shrink-0 items-baseline gap-2">
        <span className="text-sm font-medium text-text-1">{lectureLabel}</span>
        {lectureDate && (
          <span className="font-mono text-xs text-text-4">{lectureDate}</span>
        )}
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-3">
        <AngleCell
          task={teacher}
          selected={selected}
          onToggle={onToggle}
          onPauseTask={onPauseTask}
          onCancelTask={onCancelTask}
          onResumeTask={onResumeTask}
        />
        <div className="h-6 w-px shrink-0 bg-surface-2" />
        <AngleCell
          task={ppt}
          selected={selected}
          onToggle={onToggle}
          onPauseTask={onPauseTask}
          onCancelTask={onCancelTask}
          onResumeTask={onResumeTask}
        />
      </div>
    </li>
  )
})

const AngleCell = memo(function AngleCell({
  task,
  selected,
  onToggle,
  onPauseTask,
  onCancelTask,
  onResumeTask
}: {
  task?: VideoTask
  selected: Set<string>
  onToggle: (id: string) => void
  onPauseTask: (id: string) => void
  onCancelTask: (id: string) => void
  onResumeTask: (id: string) => void
}) {
  // 订阅本任务的进度（both 模式下自动聚合本地+云端状态）
  const p = useEffectiveProgress(task?.taskId ?? '')
  if (!task) {
    return (
      <div className="flex min-w-0 flex-1 items-center gap-2 text-xs text-text-4">
        无视频
      </div>
    )
  }
  const isOn = selected.has(task.taskId)
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2.5">
      <button
        type="button"
        onClick={() => onToggle(task.taskId)}
        title={task.angle === 0 ? '教师视角：录制教师讲课画面的视频' : 'PPT视角：录制投影/课件画面的视频'}
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium ring-1 transition-all duration-150 hover:scale-[1.03] ${
          isOn
            ? task.angle === 0
              ? 'bg-info-bg text-info ring-info-ring'
              : 'bg-warning-bg text-warning ring-warning-ring'
            : task.angle === 0
              ? 'bg-info-bg/50 text-info/70 ring-info-ring/50 hover:bg-info-bg'
              : 'bg-warning-bg/50 text-warning/70 ring-warning-ring/50 hover:bg-warning-bg'
        }`}
      >
        <SmallCheck on={isOn} />
        {task.viewLabel}
      </button>
      <div className="min-w-0 flex-1">
        {p ? <ProgressBar p={p} /> : <div className="h-2 rounded-full bg-surface-3" />}
      </div>
      {p && (
        <TaskCtrlButtons
          state={p.state}
          onPause={() => onPauseTask(task.taskId)}
          onCancel={() => onCancelTask(task.taskId)}
          onResume={() => onResumeTask(task.taskId)}
        />
      )}
    </div>
  )
})

function TaskCtrlButtons({
  state,
  onPause,
  onCancel,
  onResume
}: {
  state: DownloadState
  onPause: () => void
  onCancel: () => void
  onResume: () => void
}) {
  // 终态：不显示控制按钮
  if (state === 'done' || state === 'skipped' || state === 'cancelled') return null
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {state === 'downloading' || state === 'pending' ? (
        <TaskCtrlBtn kind="pause" onClick={onPause} title="暂停此任务" />
      ) : (
        <TaskCtrlBtn kind="resume" onClick={onResume} title="继续此任务" />
      )}
      <TaskCtrlBtn kind="cancel" onClick={onCancel} title="取消此任务" />
    </div>
  )
}

function TaskCtrlBtn({
  kind,
  onClick,
  title
}: {
  kind: 'pause' | 'resume' | 'cancel'
  onClick: () => void
  title: string
}) {
  const tone =
    kind === 'cancel'
      ? 'text-danger/80 hover:bg-danger-bg hover:text-danger'
      : kind === 'pause'
        ? 'text-warning/80 hover:bg-warning-bg hover:text-warning'
        : 'text-success/80 hover:bg-success-bg hover:text-success'
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`inline-flex h-6 w-6 items-center justify-center rounded-md transition-all duration-150 hover:scale-110 ${tone}`}
    >
      <CtrlIcon kind={kind} size={12} />
    </button>
  )
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-4 w-4 shrink-0 text-text-3 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  )
}

function TriCheckbox({ state, size = 'sm' }: { state: TriState; size?: 'sm' | 'lg' }) {
  const dims = size === 'lg' ? 'h-[18px] w-[18px]' : 'h-3.5 w-3.5'
  const tick = size === 'lg' ? 'h-3 w-3' : 'h-2.5 w-2.5'
  const dash = size === 'lg' ? 'h-[2px] w-2.5' : 'h-[2px] w-2'
  const base = `inline-flex ${dims} items-center justify-center rounded-[4px] border-2 transition-all duration-150`
  if (state === 'all') {
    return (
      <span className={`${base} border-accent bg-accent text-white`}>
        <svg viewBox="0 0 16 16" className={tick} fill="none" stroke="currentColor" strokeWidth="3">
          <path d="M3 8l3.5 3.5L13 5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    )
  }
  if (state === 'some') {
    return (
      <span className={`${base} border-accent bg-accent-80 text-white`}>
        <span className={`${dash} rounded-full bg-white`} />
      </span>
    )
  }
  return <span className={`${base} border-bd-strong bg-transparent`} />
}

function BatchAngleButton({
  label,
  state,
  selCount,
  total,
  onClick,
  accent
}: {
  label: string
  state: TriState
  selCount: number
  total: number
  onClick: (e: MouseEvent) => void
  accent: 'sky' | 'amber'
}) {
  const ring =
    accent === 'sky'
      ? state === 'none'
        ? 'ring-info-ring hover:ring-info text-info/70 hover:text-info'
        : 'ring-info text-info bg-info-bg'
      : state === 'none'
        ? 'ring-warning-ring hover:ring-warning text-warning/70 hover:text-warning'
        : 'ring-warning text-warning bg-warning-bg'
  const dot = accent === 'sky' ? 'bg-info' : 'bg-warning'
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium ring-1 transition-all duration-150 hover:scale-[1.03] ${ring}`}
      title={accent === 'sky' ? '批量选择/取消教师视角视频' : '批量选择/取消PPT视角视频'}
    >
      <span className="relative inline-flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border border-current/40">
        {state === 'all' && (
          <svg viewBox="0 0 16 16" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="M3 8l3.5 3.5L13 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
        {state === 'some' && <span className="h-[2px] w-2 rounded-full bg-current" />}
      </span>
      <span>{label}</span>
      <span className="ml-0.5 inline-flex items-center gap-1 text-current/60">
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${dot}`} />
        <span className="font-mono text-xs">
          {selCount}/{total}
        </span>
      </span>
    </button>
  )
}

function SmallCheck({ on }: { on: boolean }) {
  return (
    <span
      className={`inline-flex h-3 w-3 shrink-0 items-center justify-center rounded-[3px] border-2 transition-all duration-150 ${
        on ? 'border-current bg-current/30' : 'border-current/60'
      }`}
    >
      {on && (
        <svg viewBox="0 0 16 16" className="h-2 w-2" fill="none" stroke="currentColor" strokeWidth="3">
          <path d="M3 8l3.5 3.5L13 5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────
// 进度条
// ─────────────────────────────────────────────────────────────

function ProgressBar({ p }: { p: DownloadProgress }) {
  const prevRef = useRef<{ t: number; r: number; speed: number }>({ t: 0, r: 0, speed: 0 })

  if (p.state === 'downloading') {
    if (p.received > prevRef.current.r) {
      const now = Date.now()
      if (prevRef.current.t > 0) {
        const dt = (now - prevRef.current.t) / 1000
        const db = p.received - prevRef.current.r
        if (dt > 0.1) {
          const inst = db / dt
          // EMA 平滑，避免数字跳动
          prevRef.current.speed =
            prevRef.current.speed === 0 ? inst : prevRef.current.speed * 0.6 + inst * 0.4
        }
      }
      prevRef.current.t = now
      prevRef.current.r = p.received
    }
  } else {
    prevRef.current = { t: 0, r: 0, speed: 0 }
  }

  const pct =
    p.total > 0
      ? Math.min(100, Math.round((p.received / p.total) * 100))
      : p.state === 'done'
        ? 100
        : 0
  const isDl = p.state === 'downloading'
  const color =
    p.state === 'done'
      ? 'bg-success'
      : p.state === 'error'
        ? 'bg-warning'
        : p.state === 'skipped'
          ? 'bg-text-4'
          : p.state === 'paused'
            ? 'bg-warning/70'
            : p.state === 'cancelled'
              ? 'bg-text-4'
              : 'bg-accent'
  const textColor =
    p.state === 'error'
      ? 'text-warning'
      : p.state === 'done'
        ? 'text-success'
        : p.state === 'skipped'
          ? 'text-text-3'
          : p.state === 'paused'
            ? 'text-warning'
            : p.state === 'cancelled'
              ? 'text-text-4'
              : 'text-text-2'

  // paused 时进度条宽度按已下载比例显示；cancelled 显示当前已下载比例（视觉残留）
  const barWidth =
    p.state === 'skipped'
      ? 100
      : p.state === 'paused' || p.state === 'cancelled'
        ? pct
        : Math.max(isDl ? 2 : 0, pct)

  return (
    <div className="space-y-1.5">
      <div className="relative h-2 overflow-hidden rounded-full bg-surface-2">
        <div
          className={`relative h-full overflow-hidden rounded-full ${color} transition-[width] duration-200`}
          style={{ width: `${barWidth}%` }}
        >
          {isDl && (
            <div className="absolute inset-y-0 -inset-x-2 animate-shimmer bg-gradient-to-r from-transparent via-white/40 to-transparent" />
          )}
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 text-xs tabular-nums">
        {isDl ? (
          <>
            <span className="text-text-2">
              {formatBytes(p.received)}
              {p.total > 0 && (
                <span className="text-text-4"> / {formatBytes(p.total)}</span>
              )}
              <span className="ml-2 font-medium text-text-1">{pct}%</span>
            </span>
            {prevRef.current.speed > 0 && (
              <span className="text-text-3">{formatBytes(prevRef.current.speed)}/s</span>
            )}
          </>
        ) : (
          <span className={`truncate ${textColor}`} title={stateHint(p.state, p.message)}>
            {stateLabel(p.state, pct, p.message)}
          </span>
        )}
      </div>
    </div>
  )
}

function formatBytes(b: number): string {
  if (!b || b < 0) return '0 B'
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function stateLabel(s: DownloadState, pct: number, msg?: string): string {
  switch (s) {
    case 'pending':
      return msg || '等待中'
    case 'downloading':
      return `${pct}%`
    case 'done':
      return '完成'
    case 'error':
      return msg || '失败'
    case 'skipped':
      return '已存在'
    case 'paused':
      return pct > 0 ? `已暂停 · ${pct}%` : '已暂停'
    case 'cancelled':
      return '已取消'
  }
}

/** 为进度条状态提供更详细的 tooltip 提示 */
function stateHint(s: DownloadState, msg?: string): string {
  switch (s) {
    case 'pending':
      return '任务正在排队等待，即将开始下载'
    case 'downloading':
      return '正在下载中'
    case 'done':
      return '下载完成'
    case 'error':
      return msg || '下载失败，可点击重试按钮重新下载'
    case 'skipped':
      return '该文件已存在，自动跳过'
    case 'paused':
      return '已暂停，可点击继续按钮恢复下载'
    case 'cancelled':
      return '已取消，如需重新下载请重新选择'
  }
}

// ─────────────────────────────────────────────────────────────
// Hero 占位
// ─────────────────────────────────────────────────────────────

function ScanningHero({ msg }: { msg: string }) {
  return (
    <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center text-center">
      <Spinner size={32} />
      <div className="mt-5 text-base font-medium text-text-1">{msg || '正在扫描…'}</div>
      <div className="mt-2 max-w-xs text-sm leading-relaxed text-text-3">
        正在拉取你旁听的每门课程的视频列表，稍等几秒
      </div>
    </div>
  )
}

function ErrorHero({ msg, onRetry }: { msg: string; onRetry: () => void }) {
  return (
    <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center text-center">
      <div className="rounded-xl bg-warning-bg px-5 py-3 text-sm font-medium text-warning">
        {msg}
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="mt-5 inline-flex h-10 items-center rounded-xl bg-accent px-5 text-sm font-semibold text-text-1 shadow-glow-sm transition-all duration-200 hover:scale-[1.02] hover:bg-accent-light hover:shadow-glow"
      >
        重试扫描
      </button>
    </div>
  )
}

function EmptyHero() {
  return (
    <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center text-center">
      <div className="text-xl font-bold text-text-1">没有找到旁听课程</div>
      <div className="mt-3 max-w-xs text-sm leading-relaxed text-text-3">
        请确认你在 v.sjtu.edu.cn 已成功旁听了至少一门课程，且申请已通过审核。
      </div>
    </div>
  )
}



// ─────────────────────────────────────────────────────────────
// 数据处理
// ─────────────────────────────────────────────────────────────

/** 从 audit-course-detail 的 videos[] 生成任务列表：
 *  每节课产 2 条（教师 angle=0 + PPT angle=3）。
 *  按 (sortTime, sort, id) 时间顺序重排后重新编号为 第1讲...第N讲，
 *  原始 sort 经常有错乱（同一门课的"第11讲"出现两次但日期不同），
 *  统一按时间序号显示能消除歧义并保持稳定。 */
function buildTasksForCourse(course: Course, detail: AuditCourseDetail): VideoTask[] {
  const entries: AuditCourseVideo[] = Array.isArray(detail.videos) ? detail.videos : []
  const released = entries.filter(e => e.releaseStatus === undefined || e.releaseStatus === 1)

  const sorted = [...released].sort((a, b) => {
    const ta = a.sortTime ?? ''
    const tb = b.sortTime ?? ''
    if (ta !== tb) return ta.localeCompare(tb)
    const sa = a.sort ?? 0
    const sb = b.sort ?? 0
    if (sa !== sb) return sa - sb
    return (a.id ?? 0) - (b.id ?? 0)
  })

  const out: VideoTask[] = []
  sorted.forEach((e, idx) => {
    const lectureNo = idx + 1
    const lectureLabel = `第${lectureNo}讲`
    const lectureDate = e.sortTime
    for (const [angle, viewLabel] of [
      [0, '教师'],
      [3, 'PPT']
    ] as const) {
      out.push({
        taskId: `${course.id}_${e.id}_${angle}`,
        courseId: course.id,
        videoId: e.id,
        refId: e.refId,
        angle,
        viewLabel,
        lectureLabel,
        lectureDate,
        sort: lectureNo,
        sortTime: e.sortTime,
        fileName: buildFileName(lectureLabel, viewLabel),
        courseName: [course.name, course.teacher || '未署名', course.term || ''].filter(Boolean).join('-'),
        teacher: course.teacher || '',
        term: course.term || ''
      })
    }
  })
  return out
}

/** 文件夹名规则：课程名-教师-学期（在 buildTasksForCourse 中设置） */
/** 文件名规则：第N讲-视角.mp4 */
function buildFileName(lectureLabel: string, viewLabel: '教师' | 'PPT'): string {
  return `${lectureLabel}-${viewLabel}.mp4`
}
