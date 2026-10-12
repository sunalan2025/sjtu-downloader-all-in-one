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
import type { DownloadMode, VideoQualityOption, MaskedCredential } from '@shared/types'
import pkg from '../../../../package.json'

function formatCredentialDate(ts: number): string {
  if (!ts) return '从未'
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const date = String(d.getDate()).padStart(2, '0')
  const h = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${date} ${h}:${min}`
}

export function Settings({ onBack: _onBack }: { onBack?: () => void }) {
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
  const theme = useAppStore(s => s.theme)
  const setTheme = useAppStore(s => s.setTheme)
  const courseViewMode = useAppStore(s => s.courseViewMode)
  const setCourseViewMode = useAppStore(s => s.setCourseViewMode)
  const windowCloseAction = useAppStore(s => s.windowCloseAction)
  const setWindowCloseAction = useAppStore(s => s.setWindowCloseAction)
  const exitWhenDownloading = useAppStore(s => s.exitWhenDownloading)
  const setExitWhenDownloading = useAppStore(s => s.setExitWhenDownloading)
  const autoDownloadUpdate = useAppStore(s => s.autoDownloadUpdate)
  const setAutoDownloadUpdate = useAppStore(s => s.setAutoDownloadUpdate)
  const hasCompletedInitialSetup = useAppStore(s => s.hasCompletedInitialSetup)
  const setHasCompletedInitialSetup = useAppStore(s => s.setHasCompletedInitialSetup)
  const setActiveTab = useAppStore(s => s.setActiveTab)
  const lastCourseTab = useAppStore(s => s.lastCourseTab)

  const [wizardMode, setWizardMode] = useState(!hasCompletedInitialSetup)
  const [activeNav, setActiveNav] = useState('storage')
  const [credentials, setCredentials] = useState<MaskedCredential[]>([])
  const [isLoadingCreds, setIsLoadingCreds] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingLabel, setEditingLabel] = useState('')
  const [showClearModal, setShowClearModal] = useState(false)
  const [credToDelete, setCredToDelete] = useState<MaskedCredential | null>(null)

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
    if (activeNav === 'credentials') {
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
    } else {
      const res = await window.api.cloudpan.directLogin()
      if (res.ok && res.userToken) {
        useAppStore.getState().setCloudUserToken(res.userToken)
        const infoRes = await window.api.cloudpan.spaceInfo()
        if (infoRes.ok && infoRes.info) {
          useAppStore.getState().setCloudSpaceInfo(infoRes.info)
        }
      }
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

  if (wizardMode) {
    return (
      <div className="flex h-full w-full flex-col bg-surface-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-6 py-10 space-y-8">
          {/* 顶栏欢迎横幅 */}
          <div className="space-y-2 text-center sm:text-left">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-3 py-1 text-xs font-semibold text-accent border border-accent/20">
              <span>✨ 首次使用引导</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-text-1">欢迎使用交大课程下载器！请完成初始偏好设置</h1>
            <p className="text-xs sm:text-sm text-text-3 leading-relaxed">
              为了确保下载流程顺畅并符合您的使用习惯，请确认以下 4 项核心设置。配置完成后即可进入主界面开启下载。
            </p>
          </div>

          {/* 四步精简向导卡片 */}
          <div className="grid grid-cols-1 gap-5">
            {/* 卡片 1：本地保存位置 */}
            <div className="rounded-2xl border border-bd/80 bg-surface-2/60 p-5 shadow-xs transition-all hover:border-bd-strong space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-accent/10 text-xs font-bold text-accent">1</span>
                  <span className="text-sm font-bold text-text-1">📦 本地文件保存目录</span>
                </div>
                <button
                  type="button"
                  onClick={handleSelectFolder}
                  className="rounded-xl border border-bd bg-surface-1 px-3 py-1.5 text-xs font-medium text-text-1 hover:border-accent hover:text-accent transition-all cursor-pointer shadow-2xs"
                >
                  浏览并选择目录…
                </button>
              </div>
              <p className="text-xs text-text-3">所有课程课件、讲义及音视频文件落盘存储的主目录：</p>
              <div className="flex items-center gap-2 rounded-xl border border-bd/60 bg-surface-1 px-3.5 py-2.5 font-mono text-xs text-text-2">
                <span className="text-text-4 select-none">📁</span>
                <span className="truncate flex-1">{localDestRoot || '未自定义（将默认使用系统的「下载」文件夹）'}</span>
              </div>
            </div>

            {/* 卡片 2：存储目标模式 */}
            <div className="rounded-2xl border border-bd/80 bg-surface-2/60 p-5 shadow-xs transition-all hover:border-bd-strong space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-accent/10 text-xs font-bold text-accent">2</span>
                  <span className="text-sm font-bold text-text-1">🎯 存储目标模式</span>
                </div>
                <Segmented
                  size="md"
                  value={downloadMode}
                  onChange={(v) => setDownloadMode(v as DownloadMode)}
                  options={[
                    { key: 'local', label: '本地下载 (推荐)' },
                    { key: 'cloud', label: '直传交大云盘' },
                    { key: 'both', label: '本地+云盘双备份' }
                  ]}
                />
              </div>
              <div className="text-xs text-text-3 leading-relaxed">
                {downloadMode === 'local' && '💡 仅保存在本地磁盘指定目录中，最稳定且随时离线阅读。'}
                {downloadMode === 'cloud' && '💡 直接分片上传至交大云盘，不占用本地硬盘空间（需在云盘设置中完成授权）。'}
                {downloadMode === 'both' && '💡 本地与云端各存一份，自动双向备份，兼顾本地查阅与云端同步。'}
              </div>
            </div>

            {/* 卡片 3：视频清晰度与提取偏好 */}
            <div className="rounded-2xl border border-bd/80 bg-surface-2/60 p-5 shadow-xs transition-all hover:border-bd-strong space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-accent/10 text-xs font-bold text-accent">3</span>
                  <span className="text-sm font-bold text-text-1">🎬 视频清晰度与仅提取音频偏好</span>
                </div>
                <Segmented
                  size="md"
                  value={videoQualityOption}
                  onChange={(v) => setVideoQualityOption(v as VideoQualityOption)}
                  options={[
                    { key: 'origin', label: '原画高清 (推荐)' },
                    { key: '1080p', label: '1080P' },
                    { key: '720p', label: '720P' },
                    { key: 'audio_only', label: '🎵 仅提取音频 (.m4a)' }
                  ]}
                />
              </div>
              <div className="text-xs text-text-3 leading-relaxed">
                {videoQualityOption === 'audio_only'
                  ? '🎵 已启用「仅提取音频」：课堂视频与在线慕课将自动抽取出高保真 AAC 纯音频 (.m4a)，跳过无声的 PPT 录像，体积缩小 90% 以上，适合随身听或导入音频播放器！'
                  : '💡 下载视频时的画质偏好；后续在设置或下载栏中可随时无缝切换。'}
              </div>
            </div>

            {/* 卡片 4：窗口退出与关闭行为 */}
            <div className="rounded-2xl border border-bd/80 bg-surface-2/60 p-5 shadow-xs transition-all hover:border-bd-strong space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-accent/10 text-xs font-bold text-accent">4</span>
                  <span className="text-sm font-bold text-text-1">🚪 窗口退出与后台运行行为</span>
                </div>
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
              <div className="text-xs text-text-3 leading-relaxed">
                点击窗口右上角关闭按钮时的默认响应动作，可在下载大文件时保证后台平稳进行。
              </div>
            </div>
          </div>

          {/* 底部操作与流转 */}
          <div className="pt-4 flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-bd/60">
            <button
              type="button"
              onClick={() => setWizardMode(false)}
              className="text-xs text-text-3 hover:text-text-1 transition-colors cursor-pointer"
            >
              切换到完整专业设置面板 (高级选项) →
            </button>
            <button
              type="button"
              onClick={() => {
                setHasCompletedInitialSetup(true)
                setWizardMode(false)
                setActiveTab(lastCourseTab || 'canvas')
              }}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-6 py-3 text-sm font-semibold text-white shadow-glow-sm hover:bg-accent-light active:scale-98 transition-all cursor-pointer"
            >
              <span>完成配置，开始使用 🚀</span>
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full w-full flex-col bg-surface-1">
      <div className="flex flex-1 overflow-hidden">
        {/* 左栏分类导航 */}
        <aside className="w-52 shrink-0 border-r border-bd/60 bg-surface-1/40 p-3 flex flex-col gap-1 select-none">
          {[
            { id: 'storage', label: '📦 存储与下载' },
            { id: 'cloud', label: '☁️ 交大云盘集成' },
            { id: 'performance', label: '⚡ 性能与并发' },
            { id: 'video', label: '🎬 课件与视频' },
            { id: 'appearance', label: '🎨 外观与窗口' },
            { id: 'credentials', label: '🔐 账号与凭据管理' }
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

          <div className="mt-auto pt-3 border-t border-bd/50">
            <button
              type="button"
              onClick={() => setWizardMode(true)}
              className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-bd/80 bg-surface-2 px-2.5 py-1.5 text-2xs font-medium text-text-3 hover:text-text-1 hover:border-bd-strong hover:bg-surface-3 transition-all cursor-pointer"
              title="重新打开首次配置四步向导"
            >
              <span>🚀 重新运行初始化向导</span>
            </button>
          </div>
        </aside>

        {/* 右栏内容 */}
        <main className="flex-1 overflow-y-auto px-10 py-8">
          <div className="mx-auto max-w-2xl">
            {!hasCompletedInitialSetup && (
              <div className="mb-6 flex items-center justify-between rounded-xl bg-accent/10 border border-accent/20 px-4 py-3 text-xs text-accent">
                <span className="font-medium">您正在专业设置面板中，完成后请点击右侧确认以进入课程主页。</span>
                <button
                  type="button"
                  onClick={() => {
                    setHasCompletedInitialSetup(true)
                    setActiveTab(lastCourseTab || 'canvas')
                  }}
                  className="rounded-lg bg-accent px-3 py-1 font-semibold text-white shadow-xs hover:bg-accent-light transition-all cursor-pointer"
                >
                  完成配置并进入课程
                </button>
              </div>
            )}
            
            {/* 1. 存储与下载 */}
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
                        {downloadMode === 'both' && '本地保存一份，同时自动双向同步至交大云盘'}
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
                      <div className="text-sm font-medium text-text-1">本地保存目录</div>
                      <div className="truncate font-mono text-xs text-text-3" title={localDestRoot || '系统默认下载目录'}>
                        {localDestRoot || '系统默认下载目录（Downloads）'}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleSelectFolder}
                      className="shrink-0 rounded-lg border border-bd bg-surface-2 px-3 py-1.5 text-xs font-medium text-text-2 transition-all hover:bg-surface-3 hover:text-text-1 cursor-pointer"
                    >
                      更改路径…
                    </button>
                  </div>

                  {/* 行 3：同名冲突 */}
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

            {/* 2. 交大云盘集成 */}
            {activeNav === 'cloud' && (
              <section className="space-y-6">
                <div>
                  <h2 className="text-base font-bold text-text-1">交大云盘集成</h2>
                  <p className="mt-1 text-xs text-text-3">依托 jAccount 单点登录，支持无缝大文件切片直传与极速备份</p>
                </div>

                <div className="divide-y divide-bd/50 border-t border-bd/50">
                  {/* 行 1：连接与授权 */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-5">
                    <div className="space-y-1 max-w-sm">
                      <div className="flex items-center gap-2">
                        <span className={`inline-block h-2 w-2 rounded-full ${cloudUserToken ? 'bg-success' : 'bg-surface-4'}`} />
                        <span className="text-sm font-medium text-text-1">
                          {cloudUserToken ? '交大云盘已连接' : '交大云盘未连接'}
                        </span>
                      </div>
                      <div className="text-xs text-text-3">
                        {cloudUserToken ? '会话有效，支持秒传与分片直传' : '点击右侧按钮可通过 jAccount 免密快速授权'}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleCloudToggle}
                      className={`shrink-0 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                        cloudUserToken
                          ? 'border border-bd bg-surface-2 text-text-3 hover:bg-surface-3 hover:text-text-1'
                          : 'bg-accent text-white shadow-sm hover:bg-accent-light'
                      }`}
                    >
                      {cloudUserToken ? '断开连接' : '一键直连 SSO'}
                    </button>
                  </div>

                  {/* 行 2：存储空间进度 */}
                  {cloudSpaceInfo && (
                    <div className="py-5 space-y-2.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-text-3">已用存储配额</span>
                        <span className="font-mono text-text-2 font-medium">
                          {cloudSpaceInfo.size} / {cloudSpaceInfo.capacity} ({cloudPercent}%)
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
                        <div
                          className="h-full rounded-full bg-accent transition-all duration-500"
                          style={{ width: `${cloudPercent}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* 行 3：云端保存目录说明 */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-5">
                    <div className="space-y-1 max-w-sm">
                      <div className="text-sm font-medium text-text-1">云端保存根目录</div>
                      <div className="text-xs text-text-3 leading-relaxed">
                        直传或备份时自动保存在交大云盘根目录下的专属文件夹中，保持与课程相同的分类层级。
                      </div>
                    </div>
                    <span className="rounded-lg border border-bd bg-surface-2 px-3 py-1 font-mono text-xs text-text-2">
                      /SJTU课程下载
                    </span>
                  </div>
                </div>
              </section>
            )}

            {/* 3. 性能与并发 */}
            {activeNav === 'performance' && (
              <section className="space-y-6">
                <div>
                  <h2 className="text-base font-bold text-text-1">性能与并发</h2>
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
                      <div className="flex items-center gap-1 shrink-0 rounded-lg border border-bd bg-surface-1 px-2.5 py-1">
                        <span className="font-mono text-sm font-bold text-accent">{concurrency}</span>
                        <span className="text-2xs text-text-3">并发</span>
                      </div>
                    </div>
                  </div>

                  {/* 全局下载限速 */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-5">
                    <div className="space-y-1 max-w-sm">
                      <div className="text-sm font-medium text-text-1">全局下载限速</div>
                      <div className="text-xs text-text-3 leading-relaxed">
                        限制单机总下载带宽，避免占满网络影响其他正常业务
                      </div>
                    </div>
                    <div className="shrink-0">
                      <Segmented
                        size="md"
                        value={String(maxDownloadSpeedKBps)}
                        onChange={(v) => setMaxDownloadSpeedKBps(parseInt(v, 10))}
                        options={[
                          { key: '0', label: '不限速 (推荐)' },
                          { key: '10240', label: '10 MB/s' },
                          { key: '25600', label: '25 MB/s' },
                          { key: '51200', label: '50 MB/s' }
                        ]}
                      />
                    </div>
                  </div>
                </div>
              </section>
            )}

            {/* 4. 课件与视频 */}
            {activeNav === 'video' && (
              <section className="space-y-6">
                <div>
                  <h2 className="text-base font-bold text-text-1">课件与视频</h2>
                  <p className="mt-1 text-xs text-text-3">针对 Canvas 教学平台、旁听课程及好大学在线的音视频偏好</p>
                </div>

                <div className="divide-y divide-bd/50 border-t border-bd/50">
                  {/* 视频清晰度与提取偏好 */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-5">
                    <div className="space-y-1 max-w-sm">
                      <div className="text-sm font-medium text-text-1">视频清晰度与提取偏好</div>
                      <div className="text-xs text-text-3 leading-relaxed">
                        课堂视频与在线慕课解析时优先获取的分辨率规格，亦可直接抽取为纯音频文件
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

                  {/* 智能 PPT 讲义与切片导出说明 */}
                  <div className="py-5 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-text-1">📑 PPT 演示切片导出为 PDF 讲义</span>
                      <span className="rounded-md bg-accent/10 px-2 py-0.5 text-2xs font-semibold text-accent">已就绪</span>
                    </div>
                    <div className="text-xs text-text-3 leading-relaxed">
                      在 Canvas 课程浏览器的「📑 PPT课件 (PDF)」分类中，勾选后下载器会在抓取课堂录像演示画面的同时自动整合生成包含全部板书与幻灯片切片的高清矢量 PDF 电子讲义，适合导入 iPad / 平板进行无纸化批注。
                    </div>
                  </div>
                </div>
              </section>
            )}

            {/* 5. 外观与窗口 */}
            {activeNav === 'appearance' && (
              <section className="space-y-6">
                <div>
                  <h2 className="text-base font-bold text-text-1">外观与窗口</h2>
                  <p className="mt-1 text-xs text-text-3">界面色彩主题、网盘排版视图与客户端关闭保护策略</p>
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

                  {/* 行 2：默认网盘浏览视图 (替换旧版冲突的 courseLayoutMode) */}
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

                  {/* 行 3：关闭主窗口动作 */}
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

                  {/* 行 4：正在下载时关闭策略 */}
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

                  {/* 行 5：新版本自动后台下载 */}
                  <div className="flex items-center justify-between gap-4 py-5">
                    <div className="space-y-1 max-w-sm">
                      <div className="text-sm font-medium text-text-1">新版本自动下载</div>
                      <div className="text-xs text-text-3">检测到新版本时在后台静默下载安装包（下载就绪后提示安装，不强制打断）</div>
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

                  {/* 行 6：版本信息 */}
                  <div className="flex items-center justify-between gap-4 py-5">
                    <div className="space-y-1">
                      <div className="text-sm font-medium text-text-1">当前客户端版本</div>
                      <div className="text-xs text-text-3">上海交通大学课程一站式转存与同步套件</div>
                    </div>
                    <span className="rounded-md bg-surface-2 px-2.5 py-1 font-mono text-xs font-semibold text-accent">
                      v{window.api?.version || pkg.version}
                    </span>
                  </div>
                </div>
              </section>
            )}

            {/* 6. 账号与凭据管理 */}
            {activeNav === 'credentials' && (
              <section className="space-y-6">
                <div>
                  <h2 className="text-base font-bold text-text-1">账号与凭据管理</h2>
                  <p className="mt-1 text-xs text-text-3">
                    基于系统安全保险库（Windows DPAPI / macOS Keychain）保护的 jAccount 统一身份认证账号密码
                  </p>
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
                                className="flex-1 rounded-lg border border-bd bg-surface-1 px-3 py-1.5 text-xs text-text-1 placeholder-text-4 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                                autoFocus
                                onKeyDown={e => {
                                  if (e.key === 'Enter') void handleSaveLabel(cred.id)
                                  if (e.key === 'Escape') setEditingId(null)
                                }}
                              />
                              <button
                                type="button"
                                onClick={() => void handleSaveLabel(cred.id)}
                                className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-light transition-all cursor-pointer"
                              >
                                保存
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingId(null)}
                                className="rounded-lg border border-bd bg-surface-1 px-3 py-1.5 text-xs font-medium text-text-3 hover:text-text-1 transition-all cursor-pointer"
                              >
                                取消
                              </button>
                            </div>
                          )}

                          {/* 时间戳展示 */}
                          <div className="flex items-center gap-4 text-2xs text-text-4 pt-1 border-t border-bd/30">
                            <span>创建时间: {formatCredentialDate(cred.createdAt)}</span>
                            <span>•</span>
                            <span>
                              最近使用: {cred.lastUsedAt ? formatCredentialDate(cred.lastUsedAt) : '从未'}
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
          </div>
        </main>
      </div>
    </div>
  )
}
