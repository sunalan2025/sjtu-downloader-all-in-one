import { useState, useEffect } from 'react'
import {
  useAppStore,
  type Theme,
  type WindowCloseAction,
  type ExitWhenDownloadingPolicy,
  type CourseViewMode
} from '../store/app'
import { Segmented } from '../components/Segmented'
import { applyTheme } from '../components/TitleBar'
import { prefetchCloudConnection } from '../services/prefetch'
import type { DownloadMode, VideoQualityOption, MaskedCredential } from '@shared/types'
import { formatPathFromTemplate, formatDate, CLOUD_DEST_PRESETS, formatCloudBreadcrumb, normalizeCloudPath } from '../../../shared/utils'
import pkg from '../../../../package.json'

export function Settings({
  onBack: _onBack,
  onLogout
}: {
  onBack?: () => void
  onLogout?: () => void
}) {
  const auth = useAppStore(s => s.auth)
  const downloadMode = useAppStore(s => s.downloadMode)
  const setDownloadMode = useAppStore(s => s.setDownloadMode)
  const fileConflictStrategy = useAppStore(s => s.fileConflictStrategy)
  const setFileConflictStrategy = useAppStore(s => s.setFileConflictStrategy)
  const concurrency = useAppStore(s => s.concurrency)
  const setConcurrency = useAppStore(s => s.setConcurrency)
  const maxDownloadSpeedKBps = useAppStore(s => s.maxDownloadSpeedKBps)
  const setMaxDownloadSpeedKBps = useAppStore(s => s.setMaxDownloadSpeedKBps)
  const videoQualityOption = useAppStore(s => s.videoQualityOption)
  const setVideoQualityOption = useAppStore(s => s.setVideoQualityOption)
  const cloudUserToken = useAppStore(s => s.cloudUserToken)
  const cloudSpaceInfo = useAppStore(s => s.cloudSpaceInfo)
  const localDestRoot = useAppStore(s => s.localDestRoot)
  const setLocalDestRoot = useAppStore(s => s.setLocalDestRoot)
  const cloudDestRoot = useAppStore(s => s.cloudDestRoot)
  const setCloudDestRoot = useAppStore(s => s.setCloudDestRoot)

  const [defaultDownloadsDir, setDefaultDownloadsDir] = useState<string>('')

  useEffect(() => {
    let mounted = true
    if (window.api?.getDefaultDownloadsDir) {
      window.api.getDefaultDownloadsDir().then(dir => {
        if (mounted && dir) setDefaultDownloadsDir(dir)
      }).catch(() => undefined)
    }
    return () => {
      mounted = false
    }
  }, [])

  const resolvedLocalPath = localDestRoot || defaultDownloadsDir
  const isDefaultLocalPath = !localDestRoot
  const theme = useAppStore(s => s.theme)
  const setTheme = useAppStore(s => s.setTheme)
  const courseViewMode = useAppStore(s => s.courseViewMode)
  const setCourseViewMode = useAppStore(s => s.setCourseViewMode)
  const windowCloseAction = useAppStore(s => s.windowCloseAction)
  const setWindowCloseAction = useAppStore(s => s.setWindowCloseAction)
  const exitWhenDownloading = useAppStore(s => s.exitWhenDownloading)
  const setExitWhenDownloading = useAppStore(s => s.setExitWhenDownloading)
  const namingTemplate = useAppStore(s => s.namingTemplate)
  const setNamingTemplate = useAppStore(s => s.setNamingTemplate)
  const canvasGroupByTerm = useAppStore(s => s.canvasGroupByTerm)
  const setCanvasGroupByTerm = useAppStore(s => s.setCanvasGroupByTerm)
  const pptSaveImages = useAppStore(s => s.pptSaveImages)
  const setPptSaveImages = useAppStore(s => s.setPptSaveImages)
  const canvasExportSrt = useAppStore(s => s.canvasExportSrt)
  const setCanvasExportSrt = useAppStore(s => s.setCanvasExportSrt)
  const canvasExportMarkdown = useAppStore(s => s.canvasExportMarkdown)
  const setCanvasExportMarkdown = useAppStore(s => s.setCanvasExportMarkdown)
  const canvasAssignmentOptions = useAppStore(s => s.canvasAssignmentOptions)
  const setCanvasAssignmentOptions = useAppStore(s => s.setCanvasAssignmentOptions)
  const autoDownloadUpdate = useAppStore(s => s.autoDownloadUpdate)
  const setAutoDownloadUpdate = useAppStore(s => s.setAutoDownloadUpdate)

  const SPEED_PRESETS = [0, 5120, 10240, 25600, 51200]
  const isPresetSpeed = SPEED_PRESETS.includes(maxDownloadSpeedKBps)
  const [isCustomSpeed, setIsCustomSpeed] = useState(!isPresetSpeed && maxDownloadSpeedKBps > 0)
  const [customSpeedMBText, setCustomSpeedMBText] = useState(
    maxDownloadSpeedKBps > 0 ? (maxDownloadSpeedKBps / 1024).toFixed(1).replace(/\.0$/, '') : '15'
  )
  const [isCustomTemplate, setIsCustomTemplate] = useState(
    namingTemplate !== '{term}/{course}/{category}/{fileName}' &&
    namingTemplate !== '{course}/{category}/{fileName}' &&
    namingTemplate !== '{course}/{fileName}'
  )

  const [activeNav, setActiveNav] = useState('general')
  const [credentials, setCredentials] = useState<MaskedCredential[]>([])
  const [isLoadingCreds, setIsLoadingCreds] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingLabel, setEditingLabel] = useState('')
  const [showClearModal, setShowClearModal] = useState(false)
  const [credToDelete, setCredToDelete] = useState<MaskedCredential | null>(null)
  const [updateChecking, setUpdateChecking] = useState(false)
  const [updateMessage, setUpdateMessage] = useState<string | null>(null)

  const handleManualCheckUpdate = async (): Promise<void> => {
    if (!window?.api?.checkUpdate) return
    try {
      setUpdateChecking(true)
      setUpdateMessage('正在检查最新版本...')
      const r = await window.api.checkUpdate()
      if (r?.hasUpdate) {
        setUpdateMessage(`发现新版本 v${r.latestVersion || ''}，可于窗口顶部更新面板开始下载`)
      } else {
        setUpdateMessage(`当前已是最新版本 (v${window.api?.version || pkg.version})`)
      }
    } catch (err: any) {
      setUpdateMessage('检查更新失败：' + (err?.message || '网络连接超时'))
    } finally {
      setUpdateChecking(false)
    }
  }

  const loadCredentials = async (): Promise<void> => {
    if (!window?.api?.credentials?.list) return
    try {
      setIsLoadingCreds(true)
      const list = await window.api.credentials.list()
      setCredentials(list || [])
    } catch (err) {
      console.error('[Settings] failed to load credentials:', err)
    } finally {
      setIsLoadingCreds(false)
    }
  }

  useEffect(() => {
    if (activeNav === 'account') {
      void loadCredentials()
    }
  }, [activeNav])

  const handleSaveLabel = async (id: string): Promise<void> => {
    if (!window?.api?.credentials?.updateLabel) return
    const trimmed = editingLabel.trim()
    await window.api.credentials.updateLabel(id, trimmed || undefined)
    setEditingId(null)
    await loadCredentials()
  }

  const handleDelete = async (): Promise<void> => {
    if (!credToDelete || !window?.api?.credentials?.delete) return
    await window.api.credentials.delete(credToDelete.id)
    setCredToDelete(null)
    await loadCredentials()
  }

  const handleClearAll = async (): Promise<void> => {
    if (!window?.api?.credentials?.clearAll) return
    await window.api.credentials.clearAll()
    setShowClearModal(false)
    await loadCredentials()
  }

  const handleSelectFolder = async (): Promise<void> => {
    const p = await window.api.selectFolder()
    if (p) setLocalDestRoot(p)
  }

  const handleCloudToggle = async (): Promise<void> => {
    if (cloudUserToken) {
      await window.api.cloudpan.logout()
      useAppStore.getState().setCloudUserToken(null)
      useAppStore.getState().setCloudSpaceInfo(null)
      useAppStore.getState().setCloudConnStatus('idle')
    } else {
      await prefetchCloudConnection()
    }
  }

  const onSelectTheme = (t: Theme): void => {
    setTheme(t)
    applyTheme(t)
  }

  const cloudPercent = (() => {
    if (!cloudSpaceInfo) return 0
    const sizeNum = typeof cloudSpaceInfo.size === 'number' ? cloudSpaceInfo.size : parseFloat(String(cloudSpaceInfo.size))
    const capNum = typeof cloudSpaceInfo.capacity === 'number' ? cloudSpaceInfo.capacity : parseFloat(String(cloudSpaceInfo.capacity))
    if (capNum > 0 && sizeNum >= 0) return Math.min(100, Math.round((sizeNum / capNum) * 100))
    return 45
  })()



  return (
    <div className="flex h-full w-full flex-col bg-surface-1">
      <div className="flex flex-1 overflow-hidden">
        {/* 左栏分类导航 */}
        <aside className="w-52 shrink-0 border-r border-bd/60 bg-surface-1/40 p-3 flex flex-col gap-1 select-none">
          {[
            { id: 'general', label: '⚙️ 常规偏好' },
            { id: 'storage', label: '📦 存储与下载' },
            { id: 'media', label: '🎬 课件与多媒体' },
            { id: 'network', label: '⚡ 传输与网络' },
            { id: 'account', label: '🔐 账号与云盘' },
            { id: 'about', label: 'ℹ️ 关于与更新' }
          ].map(item => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveNav(item.id)}
              className={`flex items-center rounded-lg px-3 py-2 text-left text-xs font-medium transition-all cursor-pointer ${
                activeNav === item.id
                  ? 'bg-accent/10 text-accent font-semibold'
                  : 'text-text-3 hover:bg-surface-2 hover:text-text-1'
              }`}
            >
              {item.label}
            </button>
          ))}
        </aside>

        {/* 右栏内容 */}
        <main className="flex-1 overflow-y-auto px-10 py-8">
          <div className="mx-auto max-w-2xl">
            {/* 1. 常规偏好 */}
            {activeNav === 'general' && (
              <section className="space-y-6">
                <div>
                  <h2 className="text-base font-bold text-text-1">常规偏好</h2>
                  <p className="mt-1 text-xs text-text-3">界面色彩主题、网盘排版视图与客户端关闭响应策略</p>
                </div>

                <div className="divide-y divide-bd/50 border-t border-bd/50">
                  {/* 行 1：主题切换 */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-5">
                    <div className="space-y-1">
                      <div className="text-sm font-medium text-text-1">界面外观模式</div>
                      <div className="text-xs text-text-3">支持跟随操作系统色彩自适应，亦可固定浅色或深色</div>
                    </div>
                    <div className="shrink-0">
                      <Segmented
                        size="md"
                        value={theme}
                        onChange={(v) => onSelectTheme(v as Theme)}
                        options={[
                          { key: 'system', label: '💻 系统' },
                          { key: 'light', label: '☀️ 浅色' },
                          { key: 'dark', label: '🌙 深色' }
                        ]}
                      />
                    </div>
                  </div>

                  {/* 行 2：默认网盘浏览视图 */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-5">
                    <div className="space-y-1">
                      <div className="text-sm font-medium text-text-1">默认网盘浏览视图</div>
                      <div className="text-xs text-text-3">进入课程页面时默认呈现的排版视图（顶部切换栏可随时临时调整）</div>
                    </div>
                    <div className="shrink-0">
                      <Segmented
                        size="md"
                        value={courseViewMode}
                        onChange={(v) => setCourseViewMode(v as CourseViewMode)}
                        options={[
                          { key: 'grid', label: '⊞ 网格大图标 (推荐)' },
                          { key: 'list', label: '☰ 详细列表' },
                          { key: 'column', label: '◫ 分栏多级并列' }
                        ]}
                      />
                    </div>
                  </div>

                  {/* 行 3：Canvas 课程默认分组方式 */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-5">
                    <div className="space-y-1 max-w-sm">
                      <div className="text-sm font-medium text-text-1">Canvas 课程默认展示方式</div>
                      <div className="text-xs text-text-3 leading-relaxed">
                        进入 Canvas 课程中心时默认的分组方式（在课程列表右上角也可随时一键切换）。
                      </div>
                    </div>
                    <div className="shrink-0">
                      <Segmented
                        size="md"
                        value={canvasGroupByTerm ? 'term' : 'flat'}
                        onChange={(v) => setCanvasGroupByTerm(v === 'term')}
                        options={[
                          { key: 'term', label: '🗂️ 按学期分栏折叠 (推荐)' },
                          { key: 'flat', label: '📄 平铺全部课程' }
                        ]}
                      />
                    </div>
                  </div>

                  {/* 行 4：关闭主窗口动作 */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-5">
                    <div className="space-y-1 max-w-sm">
                      <div className="text-sm font-medium text-text-1">关闭主窗口动作</div>
                      <div className="text-xs text-text-3 leading-relaxed">
                        点击窗口右上角关闭按钮或按快捷键时的响应动作。选择最小化到托盘可后台无感驻留。
                      </div>
                    </div>
                    <div className="shrink-0">
                      <Segmented
                        size="md"
                        value={windowCloseAction}
                        onChange={(v) => setWindowCloseAction(v as WindowCloseAction)}
                        options={[
                          { key: 'tray', label: '最小化到系统托盘 (推荐)' },
                          { key: 'taskbar', label: '最小化到任务栏' },
                          { key: 'quit', label: '彻底退出应用' }
                        ]}
                      />
                    </div>
                  </div>

                  {/* 行 5：正在下载时关闭策略 */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-5">
                    <div className="space-y-1 max-w-sm">
                      <div className="text-sm font-medium text-text-1">正在下载时关闭策略</div>
                      <div className="text-xs text-text-3 leading-relaxed">
                        当有未完成的课件或视频传输时触发关闭的应对机制，有效防误触中断传输。
                      </div>
                    </div>
                    <div className="shrink-0">
                      <Segmented
                        size="md"
                        value={exitWhenDownloading}
                        onChange={(v) => setExitWhenDownloading(v as ExitWhenDownloadingPolicy)}
                        options={[
                          { key: 'prompt', label: '始终弹窗询问确认 (推荐)' },
                          { key: 'background', label: '自动转入托盘继续下载' },
                          { key: 'pause_quit', label: '自动暂停任务并退出应用' }
                        ]}
                      />
                    </div>
                  </div>
                </div>
              </section>
            )}

            {/* 2. 存储与下载 */}
            {activeNav === 'storage' && (
              <section className="space-y-6">
                <div>
                  <h2 className="text-base font-bold text-text-1">存储与下载</h2>
                  <p className="mt-1 text-xs text-text-3">自定义课件与视频的存储策略、保存位置及同名冲突处理</p>
                </div>

                <div className="divide-y divide-bd/50 border-t border-bd/50">
                  {/* 行 1：存储目标模式 */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-5">
                    <div className="space-y-1 max-w-sm">
                      <div className="text-sm font-medium text-text-1">存储目标模式</div>
                      <div className="text-xs text-text-3 leading-relaxed">
                        {downloadMode === 'local' && '仅存放在本地磁盘指定目录中'}
                        {downloadMode === 'cloud' && '直接分片直传至交大云盘，不占本地硬盘空间'}
                        {downloadMode === 'both' && '本地保存一份，同时自动上传备份至交大云盘'}
                      </div>
                    </div>
                    <div className="shrink-0">
                      <Segmented
                        size="md"
                        value={downloadMode}
                        onChange={(v) => setDownloadMode(v as DownloadMode)}
                        options={[
                          { key: 'local', label: '本地' },
                          { key: 'cloud', label: '交大云盘' },
                          { key: 'both', label: '双备份' }
                        ]}
                      />
                    </div>
                  </div>

                  {/* 行 2：本地保存目录 */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-5">
                    <div className="space-y-1 min-w-0 flex-1 pr-4">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-text-1">本地保存目录</span>
                        {isDefaultLocalPath && resolvedLocalPath && (
                          <span className="rounded-md bg-accent/10 text-accent px-1.5 py-0.5 text-3xs font-semibold border border-accent/20">
                            系统默认
                          </span>
                        )}
                      </div>
                      <div className="truncate font-mono text-xs text-text-3" title={resolvedLocalPath || '系统默认下载目录'}>
                        {resolvedLocalPath || '系统默认下载目录（Downloads）'}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={handleSelectFolder}
                        className="rounded-lg border border-bd bg-surface-2 px-3 py-1.5 text-xs font-medium text-text-2 transition-all hover:bg-surface-3 hover:text-text-1 cursor-pointer shadow-2xs"
                      >
                        更改路径…
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          if (window.api?.openPath) {
                            await window.api.openPath(resolvedLocalPath)
                          }
                        }}
                        className="rounded-lg border border-bd bg-surface-2 px-3 py-1.5 text-xs font-medium text-text-2 transition-all hover:bg-surface-3 hover:text-text-1 cursor-pointer shadow-2xs"
                        title="在系统文件管理器中打开保存主目录"
                      >
                        打开所在目录 ↗
                      </button>
                    </div>
                  </div>

                  {/* 行：交大云盘保存目录 */}
                  <div className="py-5 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                      <div className="space-y-1 max-w-sm">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-text-1">交大云盘保存目录</span>
                          {cloudDestRoot === '/SJTU课程备份' && (
                            <span className="rounded-md bg-accent/10 text-accent px-1.5 py-0.5 text-3xs font-semibold border border-accent/20">
                              默认预设
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-text-3 leading-relaxed">
                          云盘直传或双备份模式下，教学资源在交大云盘个人空间中归档存放的顶层目录
                        </div>
                      </div>
                      {/* 快捷切换胶囊 */}
                      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                        {CLOUD_DEST_PRESETS.map(preset => {
                          const isSelected = (cloudDestRoot || '/SJTU课程备份') === preset.value
                          return (
                            <button
                              key={preset.value}
                              type="button"
                              onClick={() => setCloudDestRoot(preset.value)}
                              className={`rounded-full px-2.5 py-1 text-xs font-medium transition-all cursor-pointer ${
                                isSelected
                                  ? 'bg-accent text-white shadow-2xs font-semibold'
                                  : 'bg-surface-2 border border-bd/80 text-text-3 hover:text-text-1 hover:border-bd-strong hover:bg-surface-3'
                              }`}
                            >
                              {preset.label}
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    {/* 自定义路径输入与动态路径层级面包屑预览 */}
                    <div className="rounded-xl border border-bd/60 bg-surface-2/50 p-3 space-y-2.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-text-3 shrink-0">自定义路径：</span>
                        <input
                          type="text"
                          value={cloudDestRoot}
                          onChange={e => setCloudDestRoot(e.target.value)}
                          onBlur={() => setCloudDestRoot(normalizeCloudPath(cloudDestRoot))}
                          placeholder="/SJTU课程备份"
                          className="flex-1 rounded-xl border border-bd bg-surface-1 px-3 py-1.5 text-xs font-mono text-text-1 placeholder:text-text-4 outline-none focus:border-accent focus:ring-2 focus:ring-accent/15 transition-all"
                        />
                        {cloudDestRoot !== '/SJTU课程备份' && (
                          <button
                            type="button"
                            onClick={() => setCloudDestRoot('/SJTU课程备份')}
                            className="text-2xs text-text-3 hover:text-accent cursor-pointer"
                          >
                            恢复默认
                          </button>
                        )}
                      </div>
                      <div className="text-2xs text-text-3 flex items-center gap-1.5 font-mono">
                        <span className="text-accent select-none font-sans font-medium">☁️ 路径层级实时预览：</span>
                        <span className="truncate text-text-2 font-mono" title={formatCloudBreadcrumb(cloudDestRoot)}>
                          {formatCloudBreadcrumb(cloudDestRoot)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* 行 3：文件归档路径模板 */}
                  <div className="py-5 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="space-y-1 max-w-sm">
                        <div className="text-sm font-medium text-text-1">文件归档与目录结构</div>
                        <div className="text-xs text-text-3 leading-relaxed">
                          自定义下载文件在本地磁盘与交大云盘中的多级目录组织结构
                        </div>
                      </div>
                      <div className="shrink-0">
                        <Segmented
                          size="md"
                          value={
                            isCustomTemplate
                              ? 'custom'
                              : namingTemplate === '{term}/{course}/{category}/{fileName}'
                                ? 'full'
                                : namingTemplate === '{course}/{category}/{fileName}'
                                  ? 'course_cat'
                                  : namingTemplate === '{course}/{fileName}'
                                    ? 'flat'
                                    : 'custom'
                          }
                          onChange={(v) => {
                            if (v === 'full') {
                              setNamingTemplate('{term}/{course}/{category}/{fileName}')
                              setIsCustomTemplate(false)
                            } else if (v === 'course_cat') {
                              setNamingTemplate('{course}/{category}/{fileName}')
                              setIsCustomTemplate(false)
                            } else if (v === 'flat') {
                              setNamingTemplate('{course}/{fileName}')
                              setIsCustomTemplate(false)
                            } else {
                              setIsCustomTemplate(true)
                            }
                          }}
                          options={[
                            { key: 'full', label: '学期/课程/分类 (推荐)' },
                            { key: 'course_cat', label: '课程/分类' },
                            { key: 'flat', label: '紧凑扁平' },
                            { key: 'custom', label: '自定义…' }
                          ]}
                        />
                      </div>
                    </div>

                    {/* 自定义模板输入与动态路径效果预览 */}
                    <div className="rounded-xl border border-bd/60 bg-surface-2/50 p-3 space-y-2.5">
                      {isCustomTemplate && (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-text-3 shrink-0">自定义结构：</span>
                            <input
                              type="text"
                              value={namingTemplate}
                              onChange={e => setNamingTemplate(e.target.value)}
                              placeholder="{term}/{course}/{category}/{fileName}"
                              className="flex-1 rounded-xl border border-bd bg-surface-1 px-3 py-1.5 text-xs font-mono text-text-1 placeholder:text-text-4 outline-none focus:border-accent focus:ring-2 focus:ring-accent/15 transition-all"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                setNamingTemplate('{term}/{course}/{category}/{fileName}')
                                setIsCustomTemplate(false)
                              }}
                              className="text-2xs text-text-3 hover:text-accent cursor-pointer"
                            >
                              恢复默认
                            </button>
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 text-2xs text-text-4">
                            <span>可用占位符 (点击插入)：</span>
                            {['{term}', '{course}', '{category}', '{fileName}'].map(tag => (
                              <button
                                key={tag}
                                type="button"
                                onClick={() => {
                                  if (!namingTemplate.includes(tag)) {
                                    setNamingTemplate(namingTemplate ? `${namingTemplate}/${tag}` : tag)
                                  }
                                }}
                                className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-accent hover:bg-surface-4 transition-colors cursor-pointer"
                              >
                                {tag}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="text-2xs text-text-3 flex items-center gap-1.5 font-mono">
                        <span className="text-accent select-none font-sans font-medium">📂 路径效果预览：</span>
                        <span className="truncate text-text-2">
                          {formatPathFromTemplate(namingTemplate || '{term}/{course}/{category}/{fileName}', {
                            term: '2025-2026-1',
                            course: '程序设计思想与方法',
                            category: '课件资料',
                            fileName: '第1章_程序设计导论.pdf'
                          })}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* 行 4：同名冲突 */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-5">
                    <div className="space-y-1 max-w-sm">
                      <div className="text-sm font-medium text-text-1">同名文件冲突策略</div>
                      <div className="text-xs text-text-3 leading-relaxed">
                        {fileConflictStrategy === 'skip' ? '目标位置已存在同名且大小一致的文件时自动跳过' : '始终重新下载并覆盖旧版文件'}
                      </div>
                    </div>
                    <div className="shrink-0">
                      <Segmented
                        size="md"
                        value={fileConflictStrategy}
                        onChange={(v) => setFileConflictStrategy(v as any)}
                        options={[
                          { key: 'skip', label: '智能跳过 (推荐)' },
                          { key: 'overwrite', label: '覆盖更新' }
                        ]}
                      />
                    </div>
                  </div>
                </div>
              </section>
            )}

            {/* 3. 课件与多媒体 */}
            {activeNav === 'media' && (
              <section className="space-y-6">
                <div>
                  <h2 className="text-base font-bold text-text-1">课件与多媒体</h2>
                  <p className="mt-1 text-xs text-text-3">针对 Canvas 教学平台、旁听课程及好大学在线的音视频偏好</p>
                </div>

                <div className="divide-y divide-bd/50 border-t border-bd/50">
                  {/* 视频清晰度与提取偏好 */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-5">
                    <div className="space-y-1 max-w-sm">
                      <div className="text-sm font-medium text-text-1">视频清晰度与提取偏好</div>
                      <div className="text-xs text-text-3 leading-relaxed">
                        课堂视频与在线慕课解析时优先获取的分辨率规格，亦可直接提取为纯音频文件
                      </div>
                    </div>
                    <div className="shrink-0">
                      <Segmented
                        size="md"
                        value={videoQualityOption}
                        onChange={(v) => setVideoQualityOption(v as VideoQualityOption)}
                        options={[
                          { key: 'origin', label: '原画高清 (推荐)' },
                          { key: '1080p', label: '1080P' },
                          { key: '720p', label: '720P' },
                          { key: 'audio_only', label: '仅提取音频' }
                        ]}
                      />
                    </div>
                  </div>

                  {/* 导出外挂字幕 (.srt) */}
                  <div className="flex items-center justify-between gap-4 py-5">
                    <div className="space-y-1 max-w-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-text-1">导出外挂字幕 (.srt)</span>
                        <span className="rounded-md bg-accent/10 px-2 py-0.5 text-2xs font-semibold text-accent">外挂字幕</span>
                      </div>
                      <div className="text-xs text-text-3 leading-relaxed">
                        下载课堂实录时，提取录播中台 AI 语音识别文本并生成同名 .srt 字幕，主流播放器双击视频自动加载。
                      </div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={canvasExportSrt}
                      onClick={() => setCanvasExportSrt(!canvasExportSrt)}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors duration-150 ${
                        canvasExportSrt ? 'bg-accent' : 'bg-surface-4'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-150 mt-0.5 ml-0.5 ${
                          canvasExportSrt ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>

                  {/* 导出复习笔记 (.md) */}
                  <div className="flex items-center justify-between gap-4 py-5">
                    <div className="space-y-1 max-w-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-text-1">导出复习笔记 (.md)</span>
                        <span className="rounded-md bg-accent/10 px-2 py-0.5 text-2xs font-semibold text-accent">讲义笔记</span>
                      </div>
                      <div className="text-xs text-text-3 leading-relaxed">
                        生成包含精确时间戳跳转标记与段落纲要的 Markdown 复习讲义，便于全文搜索与知识回顾。
                      </div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={canvasExportMarkdown}
                      onClick={() => setCanvasExportMarkdown(!canvasExportMarkdown)}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors duration-150 ${
                        canvasExportMarkdown ? 'bg-accent' : 'bg-surface-4'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-150 mt-0.5 ml-0.5 ${
                          canvasExportMarkdown ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>

                  {/* Canvas 作业归档偏好 */}
                  <div className="py-5 space-y-3">
                    <div className="space-y-1 max-w-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-text-1">Canvas 作业归档偏好</span>
                        <span className="rounded-md bg-accent/10 px-2 py-0.5 text-2xs font-semibold text-accent">作业资料</span>
                      </div>
                      <div className="text-xs text-text-3 leading-relaxed">
                        批量下载课程作业与实验任务时包含的具体文件明细
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-2.5">
                      {[
                        {
                          key: 'exportMarkdown' as const,
                          icon: '📋',
                          title: '作业说明文档 (.md)',
                          desc: '包含作业题目要求、起止时间与教师评语',
                          checked: !!canvasAssignmentOptions.exportMarkdown
                        },
                        {
                          key: 'downloadAttachments' as const,
                          icon: '📎',
                          title: '题目附件与资料',
                          desc: '教师上传的实验模板、参考数据集与大作业说明附件',
                          checked: !!canvasAssignmentOptions.downloadAttachments
                        },
                        {
                          key: 'downloadSubmissions' as const,
                          icon: '📦',
                          title: '本人提交原件历史',
                          desc: '学生本人过往提交的代码包、实验报告原件与附件',
                          checked: !!canvasAssignmentOptions.downloadSubmissions
                        }
                      ].map(item => (
                        <div
                          key={item.key}
                          role="checkbox"
                          aria-checked={item.checked}
                          tabIndex={0}
                          onClick={() =>
                            setCanvasAssignmentOptions({
                              [item.key]: !item.checked
                            })
                          }
                          onKeyDown={e => {
                            if (e.key === ' ' || e.key === 'Enter') {
                              e.preventDefault()
                              setCanvasAssignmentOptions({
                                [item.key]: !item.checked
                              })
                            }
                          }}
                          className={`flex items-center justify-between gap-3 rounded-xl border p-3 cursor-pointer transition-all select-none ${
                            item.checked
                              ? 'border-accent/60 bg-accent/5 shadow-2xs'
                              : 'border-bd/70 bg-surface-2/40 hover:border-bd-strong hover:bg-surface-2'
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="text-xl select-none shrink-0">{item.icon}</span>
                            <div className="space-y-0.5 min-w-0">
                              <div className={`text-xs font-semibold truncate ${item.checked ? 'text-accent' : 'text-text-1'}`}>
                                {item.title}
                              </div>
                              <div className="text-2xs text-text-3 truncate">
                                {item.desc}
                              </div>
                            </div>
                          </div>
                          <div
                            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                              item.checked ? 'border-accent bg-accent text-white' : 'border-bd/80 bg-surface-1'
                            }`}
                          >
                            {item.checked && (
                              <svg className="h-2.5 w-2.5" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    {!canvasAssignmentOptions.exportMarkdown &&
                      !canvasAssignmentOptions.downloadAttachments &&
                      !canvasAssignmentOptions.downloadSubmissions && (
                        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400 flex items-center gap-2">
                          <span className="font-semibold select-none shrink-0">💡 温和提示：</span>
                          <span>未勾选任何内容时将仅创建作业文件夹结构</span>
                        </div>
                      )}
                  </div>

                  {/* 智能 PPT 讲义与幻灯片导出说明 */}
                  <div className="py-5 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-text-1">📑 PPT 演示幻灯片导出为 PDF 讲义</span>
                      <span className="rounded-md bg-accent/10 px-2 py-0.5 text-2xs font-semibold text-accent">已就绪</span>
                    </div>
                    <div className="text-xs text-text-3 leading-relaxed">
                      在 Canvas 课程浏览器的「📑 PPT课件 (PDF)」分类中，勾选后下载器会在提取课堂录像演示画面的同时自动整合生成包含全部板书与幻灯片画面的高清矢量 PDF 电子讲义，适合导入 iPad / 平板进行无纸化批注。
                    </div>
                  </div>

                  {/* PPT 幻灯片原图保留开关 */}
                  <div className="flex items-center justify-between gap-4 py-5">
                    <div className="space-y-1 max-w-sm">
                      <div className="text-sm font-medium text-text-1">保留幻灯片高清原图</div>
                      <div className="text-xs text-text-3 leading-relaxed">
                        生成 PDF 讲义的同时，在同名子文件夹中单独保留提取出的各页无损 PNG 原始幻灯片图片，方便提取关键图表或二次制作。
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPptSaveImages(!pptSaveImages)}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors duration-150 ${
                        pptSaveImages ? 'bg-accent' : 'bg-surface-4'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-150 mt-0.5 ml-0.5 ${
                          pptSaveImages ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </section>
            )}

            {/* 4. 传输与网络 */}
            {activeNav === 'network' && (
              <section className="space-y-6">
                <div>
                  <h2 className="text-base font-bold text-text-1">传输与网络</h2>
                  <p className="mt-1 text-xs text-text-3">精细控制网络吞吐与多任务并行数，支持自定义并发与下载限速</p>
                </div>

                <div className="divide-y divide-bd/50 border-t border-bd/50">
                  {/* 并发数 */}
                  <div className="py-5 space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="space-y-1">
                        <div className="text-sm font-medium text-text-1">最大并发任务数</div>
                        <div className="text-xs text-text-3">
                          同时进行网络传输的文件数量，千兆有线网络推荐 5~8，校园网无线 Wi-Fi 推荐 3
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 self-start sm:self-auto">
                        {[1, 3, 5, 8].map(p => (
                          <button
                            key={p}
                            type="button"
                            onClick={() => setConcurrency(p)}
                            className={`rounded-md px-2.5 py-1 text-xs font-mono transition-all cursor-pointer ${
                              concurrency === p
                                ? 'bg-accent text-white font-semibold'
                                : 'bg-surface-2 text-text-3 hover:bg-surface-3 hover:text-text-1'
                            }`}
                          >
                            {p}{p === 3 ? ' (推荐)' : ''}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center gap-4 rounded-xl bg-surface-2/60 p-3.5">
                      <span className="text-xs text-text-3 shrink-0">1</span>
                      <input
                        type="range"
                        min={1}
                        max={16}
                        step={1}
                        value={concurrency}
                        onChange={e => setConcurrency(parseInt(e.target.value, 10))}
                        className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-surface-4 accent-accent"
                      />
                      <span className="text-xs text-text-3 shrink-0">16</span>
                      <div className="flex items-center gap-1 shrink-0 rounded-lg border border-bd bg-surface-1 px-2 py-1 shadow-2xs">
                        <input
                          type="number"
                          min={1}
                          max={16}
                          value={concurrency}
                          onChange={e => {
                            const val = parseInt(e.target.value, 10)
                            if (!isNaN(val)) {
                              setConcurrency(Math.max(1, Math.min(16, val)))
                            }
                          }}
                          className="w-8 border-none bg-transparent text-center font-mono text-sm font-bold text-accent outline-none focus:ring-0"
                          title="直接键入 1~16 并发数"
                        />
                        <span className="text-2xs text-text-3 select-none">并发</span>
                      </div>
                    </div>
                  </div>

                  {/* 全局下载限速 */}
                  <div className="py-5 space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="space-y-1 max-w-sm">
                        <div className="text-sm font-medium text-text-1">全局下载限速</div>
                        <div className="text-xs text-text-3 leading-relaxed">
                          限制单机总下载带宽，避免占满网络影响其他正常业务
                        </div>
                      </div>
                      <div className="shrink-0">
                        <Segmented
                          size="md"
                          value={isCustomSpeed ? 'custom' : String(maxDownloadSpeedKBps)}
                          onChange={(v) => {
                            if (v === 'custom') {
                              setIsCustomSpeed(true)
                              const mb = parseFloat(customSpeedMBText) || 10
                              setMaxDownloadSpeedKBps(Math.round(mb * 1024))
                            } else {
                              setIsCustomSpeed(false)
                              const kbps = parseInt(v, 10)
                              setMaxDownloadSpeedKBps(kbps)
                              if (kbps > 0) {
                                setCustomSpeedMBText((kbps / 1024).toFixed(1).replace(/\.0$/, ''))
                              }
                            }
                          }}
                          options={[
                            { key: '0', label: '不限速 (推荐)' },
                            { key: '5120', label: '5 MB/s' },
                            { key: '10240', label: '10 MB/s' },
                            { key: '25600', label: '25 MB/s' },
                            { key: '51200', label: '50 MB/s' },
                            { key: 'custom', label: '自定义…' }
                          ]}
                        />
                      </div>
                    </div>

                    {isCustomSpeed && (
                      <div className="rounded-xl border border-bd/70 bg-surface-2/40 p-4 space-y-3">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div className="space-y-0.5">
                            <span className="text-xs font-medium text-text-1">自定义限制速率 (MB/s)</span>
                            <p className="text-2xs text-text-3">支持键入任意大小或拖动滑块连续调节</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="flex items-center rounded-lg border border-bd bg-surface-1 px-2.5 py-1 shadow-2xs">
                              <input
                                type="number"
                                min={0.5}
                                max={200}
                                step={0.5}
                                value={customSpeedMBText}
                                onChange={e => {
                                  const text = e.target.value
                                  setCustomSpeedMBText(text)
                                  const num = parseFloat(text)
                                  if (!isNaN(num) && num > 0) {
                                    setMaxDownloadSpeedKBps(Math.round(num * 1024))
                                  }
                                }}
                                className="w-16 border-none bg-transparent text-right font-mono text-sm font-bold text-accent outline-none focus:ring-0"
                              />
                              <span className="ml-1 text-xs text-text-3 select-none">MB/s</span>
                            </div>
                            <span className="text-2xs text-text-4 font-mono">
                              (约 {Math.round((maxDownloadSpeedKBps * 8) / 1000)} Mbps)
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 pt-1">
                          <span className="text-2xs text-text-3 shrink-0 font-mono">1 MB/s</span>
                          <input
                            type="range"
                            min={1}
                            max={100}
                            step={1}
                            value={Math.min(100, Math.max(1, Math.round(maxDownloadSpeedKBps / 1024)))}
                            onChange={e => {
                              const mb = parseInt(e.target.value, 10)
                              setCustomSpeedMBText(String(mb))
                              setMaxDownloadSpeedKBps(mb * 1024)
                            }}
                            className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-surface-4 accent-accent"
                          />
                          <span className="text-2xs text-text-3 shrink-0 font-mono">100 MB/s</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </section>
            )}

            {/* 5. 账号与云盘 */}
            {activeNav === 'account' && (
              <section className="space-y-6">
                <div>
                  <h2 className="text-base font-bold text-text-1">账号与云盘</h2>
                  <p className="mt-1 text-xs text-text-3">
                    统一身份认证 (jAccount) 登录会话、交大云盘直连集成与系统安全保险库
                  </p>
                </div>

                {/* 当前登录会话状态卡片 */}
                {auth?.loggedIn && (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-bd/80 bg-surface-2/60 p-4 shadow-2xs">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-lg">
                        👤
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-text-1">
                            {auth.accountName || auth.studentId || '当前登录账号'}
                          </span>
                          {auth.studentId && auth.accountName && (
                            <span className="rounded-md bg-surface-3 px-2 py-0.5 font-mono text-2xs text-text-3">
                              {auth.studentId}
                            </span>
                          )}
                          <span className="inline-flex items-center gap-1 rounded-md bg-success-bg px-2 py-0.5 text-2xs font-semibold text-success ring-1 ring-success-ring">
                            <span className="h-1.5 w-1.5 rounded-full bg-success" />
                            在线会话
                          </span>
                        </div>
                        <p className="text-xs text-text-3 mt-0.5">
                          当前会话有效，已建立 Canvas 与交大在线服务安全授权
                        </p>
                      </div>
                    </div>
                    {onLogout && (
                      <button
                        type="button"
                        onClick={onLogout}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-danger/30 bg-danger-bg px-3 py-1.5 text-xs font-semibold text-danger hover:brightness-110 active:scale-[0.98] transition-all cursor-pointer shadow-2xs self-start sm:self-auto shrink-0"
                        title="退出当前账号登录并返回欢迎页"
                      >
                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                          <polyline points="16 17 21 12 16 7" />
                          <line x1="21" y1="12" x2="9" y2="12" />
                        </svg>
                        <span>退出当前登录</span>
                      </button>
                    )}
                  </div>
                )}

                {/* 交大云盘直连与存储配额卡片 */}
                <div className="rounded-2xl border border-bd/80 bg-surface-2/60 p-4 shadow-2xs space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className={`inline-block h-2 w-2 rounded-full ${cloudUserToken ? 'bg-success' : 'bg-surface-4'}`} />
                        <span className="text-sm font-bold text-text-1">
                          {cloudUserToken ? '交大云盘已连接' : '交大云盘未连接'}
                        </span>
                        {cloudUserToken && (
                          <span className="rounded-md bg-accent/10 px-2 py-0.5 text-2xs font-semibold text-accent">
                            SSO 单点直连
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-text-3">
                        {cloudUserToken ? '会话有效，支持直传分片与秒传备份' : '通过当前 jAccount 统一身份认证一键免密接入云盘'}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={handleCloudToggle}
                        className={`rounded-xl px-3.5 py-1.5 text-xs font-semibold transition-all cursor-pointer shadow-2xs ${
                          cloudUserToken
                            ? 'border border-bd bg-surface-1 text-text-3 hover:bg-surface-3 hover:text-text-1'
                            : 'bg-accent text-white shadow-xs hover:bg-accent-light'
                        }`}
                      >
                        {cloudUserToken ? '断开云盘连接' : '一键直连 SSO'}
                      </button>
                    </div>
                  </div>

                  {/* 存储空间配额进度条 */}
                  {cloudSpaceInfo && (
                    <div className="space-y-2 pt-2 border-t border-bd/40">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-text-3">交大云盘已用存储配额</span>
                        <span className="font-mono text-text-2 font-medium">
                          {cloudSpaceInfo.size} / {cloudSpaceInfo.capacity} ({cloudPercent}%)
                        </span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-surface-3">
                        <div
                          className="h-full rounded-full bg-accent transition-all duration-500"
                          style={{ width: `${cloudPercent}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* 云端保存根目录 */}
                  <div className="flex items-center justify-between text-xs text-text-3 pt-2 border-t border-bd/40">
                    <span>云端转存默认根目录：</span>
                    <span className="rounded-lg border border-bd bg-surface-1 px-2.5 py-0.5 font-mono text-2xs text-text-2">
                      /SJTU课程下载
                    </span>
                  </div>
                </div>

                {/* 硬件级加密防护横幅 */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-success/30 bg-success-bg p-4 shadow-2xs">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-success-bg text-lg">
                      🛡️
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-text-1">系统硬件级加密保护中</span>
                        <span className="rounded-md bg-success-bg px-2 py-0.5 text-2xs font-semibold text-success ring-1 ring-success-ring">
                          DPAPI / Keychain
                        </span>
                      </div>
                      <p className="text-xs text-text-3 mt-0.5">
                        密码密文由操作系统安全芯片与系统凭据管理器隔离存储，渲染端与网络传输杜绝明文暴露
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
                    <span className="rounded-xl border border-bd/80 bg-surface-1 px-3 py-1.5 text-xs font-medium text-text-2 shadow-2xs">
                      已安全保存 <span className="font-mono font-bold text-accent">{credentials.length}</span> 个账号凭据
                    </span>
                  </div>
                </div>

                {/* 凭据列表与操作区 */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-text-2">已保存凭据列表</span>
                    {credentials.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowClearModal(true)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-danger/30 bg-danger-bg px-2.5 py-1 text-xs font-medium text-danger hover:brightness-110 transition-all cursor-pointer shadow-2xs"
                      >
                        <span>一键清空全部已保存凭据</span>
                      </button>
                    )}
                  </div>

                  {isLoadingCreds ? (
                    <div className="flex items-center justify-center py-8 text-xs text-text-3">
                      <span>正在读取凭据...</span>
                    </div>
                  ) : credentials.length === 0 ? (
                    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-bd/80 bg-surface-2/40 py-12 px-6 text-center space-y-3">
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-3 text-2xl">
                        🔐
                      </div>
                      <div className="space-y-1">
                        <div className="text-sm font-medium text-text-1">暂无已保存的账号凭据</div>
                        <p className="text-xs text-text-3 max-w-md leading-relaxed">
                          在登录页面输入账号密码成功登录后，可自动提示一键保存。
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {credentials.map(cred => (
                        <div
                          key={cred.id}
                          className="rounded-2xl border border-bd/80 bg-surface-2/60 p-4 shadow-2xs transition-all hover:border-bd-strong space-y-3"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="space-y-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-bold text-text-1 font-mono">{cred.username}</span>
                                {cred.label && (
                                  <span className="rounded-md bg-accent/10 px-2 py-0.5 text-2xs font-semibold text-accent border border-accent/20">
                                    {cred.label}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 text-xs text-text-3">
                                <span className="select-none text-text-4 font-mono">密码:</span>
                                <span className="font-mono tracking-widest text-text-2">{cred.maskedPassword || '••••••••'}</span>
                              </div>
                            </div>

                            {/* 操作按钮 */}
                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingId(cred.id)
                                  setEditingLabel(cred.label || '')
                                }}
                                className="rounded-lg border border-bd bg-surface-1 px-2.5 py-1 text-xs font-medium text-text-2 hover:border-accent hover:text-accent hover:bg-surface-2 transition-all cursor-pointer shadow-2xs"
                                title="编辑账号自定义别名"
                              >
                                ✏️ 编辑别名
                              </button>
                              <button
                                type="button"
                                onClick={() => setCredToDelete(cred)}
                                className="rounded-lg border border-danger/30 bg-danger-bg px-2.5 py-1 text-xs font-medium text-danger hover:brightness-110 transition-all cursor-pointer shadow-2xs"
                                title="删除此账号的已保存凭据"
                              >
                                🗑️ 删除
                              </button>
                            </div>
                          </div>

                          {/* 内联编辑别名表单 */}
                          {editingId === cred.id && (
                            <div className="flex items-center gap-2 pt-2 border-t border-bd/40">
                              <input
                                type="text"
                                value={editingLabel}
                                onChange={e => setEditingLabel(e.target.value)}
                                placeholder="输入账号备注别名（如：本科主账号，留空则清除）"
                                className="flex-1 rounded-xl border border-bd bg-surface-1 px-3 py-1.5 text-xs text-text-1 placeholder:text-text-4 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15 transition-all"
                                autoFocus
                                onKeyDown={e => {
                                  if (e.key === 'Enter') void handleSaveLabel(cred.id)
                                  if (e.key === 'Escape') setEditingId(null)
                                }}
                              />
                              <button
                                type="button"
                                onClick={() => void handleSaveLabel(cred.id)}
                                className="rounded-xl bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-light transition-all cursor-pointer shadow-2xs active:scale-[0.98]"
                              >
                                保存
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingId(null)}
                                className="rounded-xl border border-bd bg-surface-1 px-3 py-1.5 text-xs font-medium text-text-3 hover:text-text-1 transition-all cursor-pointer active:scale-[0.98]"
                              >
                                取消
                              </button>
                            </div>
                          )}

                          {/* 时间戳展示 */}
                          <div className="flex items-center gap-4 text-2xs text-text-4 pt-1 border-t border-bd/30">
                            <span>创建时间: {formatDate(cred.createdAt)}</span>
                            <span>•</span>
                            <span>
                              最近使用: {formatDate(cred.lastUsedAt, { fallback: '从未' })}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* 一键清空二次确认弹窗 */}
                {showClearModal && (
                  <div
                    className="fixed inset-0 z-50 flex items-center justify-center p-4"
                    role="dialog"
                    aria-modal="true"
                  >
                    <div
                      className="absolute inset-0 bg-black/40 backdrop-blur-xs transition-opacity"
                      onClick={() => setShowClearModal(false)}
                    />
                    <div className="relative w-full max-w-sm rounded-2xl border border-bd bg-surface-1 p-5 shadow-2xl space-y-4 animate-fadeIn">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-danger-bg text-danger text-lg font-bold">
                          ⚠️
                        </div>
                        <div>
                          <h3 className="text-sm font-bold text-text-1">清空全部已保存凭据</h3>
                          <p className="text-xs text-text-3 mt-0.5">此操作不可撤销</p>
                        </div>
                      </div>
                      <p className="text-xs text-text-2 leading-relaxed">
                        确定要清空所有已保存的账号凭据吗？此操作将彻底删除所有保存在系统安全保险库中的 jAccount 账号与加密密码，清空后登录时将不再提供自动填充。
                      </p>
                      <div className="flex items-center justify-end gap-2 pt-2 border-t border-bd/50">
                        <button
                          type="button"
                          onClick={() => setShowClearModal(false)}
                          className="rounded-xl border border-bd bg-surface-2 px-3 py-1.5 text-xs font-medium text-text-2 hover:bg-surface-3 hover:text-text-1 transition-all cursor-pointer"
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleClearAll()}
                          className="rounded-xl bg-danger px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110 active:scale-98 transition-all cursor-pointer shadow-xs"
                        >
                          确认清空
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* 单项删除二次确认弹窗 */}
                {credToDelete && (
                  <div
                    className="fixed inset-0 z-50 flex items-center justify-center p-4"
                    role="dialog"
                    aria-modal="true"
                  >
                    <div
                      className="absolute inset-0 bg-black/40 backdrop-blur-xs transition-opacity"
                      onClick={() => setCredToDelete(null)}
                    />
                    <div className="relative w-full max-w-sm rounded-2xl border border-bd bg-surface-1 p-5 shadow-2xl space-y-4 animate-fadeIn">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-danger-bg text-danger text-lg font-bold">
                          🗑️
                        </div>
                        <div>
                          <h3 className="text-sm font-bold text-text-1">删除账号凭据</h3>
                          <p className="text-xs text-text-3 mt-0.5 font-mono">账号: {credToDelete.username}</p>
                        </div>
                      </div>
                      <p className="text-xs text-text-2 leading-relaxed">
                        确定要删除账号「<strong className="text-text-1">{credToDelete.username}</strong>」
                        {credToDelete.label ? `（${credToDelete.label}）` : ''} 的已保存凭据吗？删除后在登录页面将不再自动填充此账号。
                      </p>
                      <div className="flex items-center justify-end gap-2 pt-2 border-t border-bd/50">
                        <button
                          type="button"
                          onClick={() => setCredToDelete(null)}
                          className="rounded-xl border border-bd bg-surface-2 px-3 py-1.5 text-xs font-medium text-text-2 hover:bg-surface-3 hover:text-text-1 transition-all cursor-pointer"
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete()}
                          className="rounded-xl bg-danger px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110 active:scale-98 transition-all cursor-pointer shadow-xs"
                        >
                          确认删除
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* 6. 关于与更新 */}
            {activeNav === 'about' && (
              <section className="space-y-6">
                <div>
                  <h2 className="text-base font-bold text-text-1">关于与更新</h2>
                  <p className="mt-1 text-xs text-text-3">客户端版本状态、后台自动更新与初始化向导重置</p>
                </div>

                <div className="divide-y divide-bd/50 border-t border-bd/50">
                  {/* 版本信息卡片 */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-5">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-text-1">交大课程转存助手</span>
                        <span className="rounded-md bg-accent/10 px-2 py-0.5 text-2xs font-semibold text-accent font-mono">
                          v{window.api?.version || pkg.version}
                        </span>
                      </div>
                      <div className="text-xs text-text-3">
                        上海交通大学课程一站式转存与同步套件（Canvas / 录播 / 慕课 / 交大云盘）
                      </div>
                      {updateMessage && (
                        <div className="text-xs text-accent font-medium mt-1">
                          {updateMessage}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => void handleManualCheckUpdate()}
                        disabled={updateChecking}
                        className="rounded-xl border border-bd bg-surface-2 px-3.5 py-1.5 text-xs font-medium text-text-2 hover:bg-surface-3 hover:text-text-1 transition-all cursor-pointer shadow-2xs disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {updateChecking ? '正在检查…' : '🔄 检查更新'}
                      </button>
                    </div>
                  </div>

                  {/* 自动后台下载新版本 */}
                  <div className="flex items-center justify-between gap-4 py-5">
                    <div className="space-y-1 max-w-sm">
                      <div className="text-sm font-medium text-text-1">新版本后台自动下载</div>
                      <div className="text-xs text-text-3 leading-relaxed">
                        检测到新版本时在后台自动下载安装包（下载就绪后提示安装，不强制打断当前操作）。
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setAutoDownloadUpdate(!autoDownloadUpdate)}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors duration-150 ${
                        autoDownloadUpdate ? 'bg-accent' : 'bg-surface-4'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-150 mt-0.5 ml-0.5 ${
                          autoDownloadUpdate ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>

                  {/* 重新运行设置向导 */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-5">
                    <div className="space-y-1 max-w-sm">
                      <div className="text-sm font-medium text-text-1">重新运行设置向导</div>
                      <div className="text-xs text-text-3 leading-relaxed">
                        重新打开偏好配置向导，快速确认或重置常用默认偏好与存储配置。
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        useAppStore.getState().setShowSetupWizardModal(true)
                      }}
                      className="rounded-xl border border-bd/80 bg-surface-2 px-3.5 py-1.5 text-xs font-semibold text-text-2 hover:text-accent hover:border-accent transition-all cursor-pointer shadow-2xs shrink-0"
                    >
                      🚀 重新运行设置向导
                    </button>
                  </div>

                  {/* 开源与技术说明 */}
                  <div className="py-5 space-y-2 text-2xs text-text-4">
                    <div className="flex items-center gap-2">
                      <span>SJTU All-In-One Downloader Suite</span>
                      <span>•</span>
                      <span>Electron + React + TypeScript + Tailwind CSS</span>
                    </div>
                    <p className="leading-relaxed">
                      专为上海交通大学在校师生打造的开源工具。所有网络请求仅直连学校内网及官方教学平台，数据全链路硬件级加密保护。
                    </p>
                  </div>
                </div>
              </section>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
