import { useState } from 'react'
import {
  useAppStore,
  type Theme,
  type WindowCloseAction,
  type ExitWhenDownloadingPolicy,
  type CourseViewMode
} from '../store/app'
import { Segmented } from '../components/Segmented'
import { applyTheme } from '../components/TitleBar'
import type { DownloadMode, VideoQualityOption } from '@shared/types'
import pkg from '../../../../package.json'

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

  const [activeNav, setActiveNav] = useState('storage')

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
            { id: 'appearance', label: '🎨 外观与窗口' }
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

          </div>
        </main>
      </div>
    </div>
  )
}
