import { useState } from 'react'
import { useAppStore, type Theme } from '../store/app'
import { Segmented } from '../components/Segmented'
import { applyTheme } from '../components/TitleBar'
import type { DownloadMode } from '@shared/types'
import pkg from '../../../../package.json'

export function Settings({ onBack: _onBack }: { onBack?: () => void }) {
  const downloadMode = useAppStore(s => s.downloadMode)
  const setDownloadMode = useAppStore(s => s.setDownloadMode)
  const fileConflictStrategy = useAppStore(s => s.fileConflictStrategy)
  const setFileConflictStrategy = useAppStore(s => s.setFileConflictStrategy)
  const concurrency = useAppStore(s => s.concurrency)
  const setConcurrency = useAppStore(s => s.setConcurrency)
  const cloudUserToken = useAppStore(s => s.cloudUserToken)
  const cloudSpaceInfo = useAppStore(s => s.cloudSpaceInfo)
  const localDestRoot = useAppStore(s => s.localDestRoot)
  const setLocalDestRoot = useAppStore(s => s.setLocalDestRoot)
  const theme = useAppStore(s => s.theme)
  const setTheme = useAppStore(s => s.setTheme)
  const courseLayoutMode = useAppStore(s => s.courseLayoutMode)
  const setCourseLayoutMode = useAppStore(s => s.setCourseLayoutMode)

  const [activeNav, setActiveNav] = useState('storage')
  const [videoStreamPref, setVideoStreamPref] = useState<'both' | 'teacher' | 'ppt'>('both')
  const [pptToPdf, setPptToPdf] = useState(true)
  const [pptExportSlices, setPptExportSlices] = useState(true)
  const [autoSyncCourses, setAutoSyncCourses] = useState(true)

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
        {/* 左栏分类导航：通透极简，无厚重背景 */}
        <aside className="w-52 shrink-0 border-r border-bd/60 bg-surface-1/40 p-3 flex flex-col gap-1 select-none">
          {[
            { id: 'storage', label: '📦 存储与下载' },
            { id: 'cloud', label: '☁️ 交大云盘集成' },
            { id: 'performance', label: '⚡ 性能与并发' },
            { id: 'video', label: '🎬 课件与视频' },
            { id: 'appearance', label: '🎨 外观与通用' }
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

        {/* 右栏内容：去框化无界排版（Divided List Rows），透气舒展 */}
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
                          { key: 'skip', label: '智能跳过' },
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
                        {cloudUserToken ? '会话有效，支持直传与秒传' : '点击右侧按钮可通过 jAccount 免密快速登录'}
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
                </div>
              </section>
            )}

            {/* 3. 性能与并发 */}
            {activeNav === 'performance' && (
              <section className="space-y-6">
                <div>
                  <h2 className="text-base font-bold text-text-1">性能与并发</h2>
                  <p className="mt-1 text-xs text-text-3">精细控制网络吞吐与多任务并行数，支持自定义 1~16 并发</p>
                </div>

                <div className="divide-y divide-bd/50 border-t border-bd/50">
                  {/* 并发数：支持快速预设与滑动/数字微调自定义 */}
                  <div className="py-5 space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="space-y-1">
                        <div className="text-sm font-medium text-text-1">最大并发任务数</div>
                        <div className="text-xs text-text-3">
                          同时下载或上传的最大文件数，范围 1 ~ 16
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
                            {p}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* 自定义精确滑块 + 数字步进 */}
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
                </div>
              </section>
            )}

            {/* 4. 课件与视频 */}
            {activeNav === 'video' && (
              <section className="space-y-6">
                <div>
                  <h2 className="text-base font-bold text-text-1">课件与视频</h2>
                  <p className="mt-1 text-xs text-text-3">针对 Canvas LTI 与交大视频的双流视角提取及课件格式处理</p>
                </div>

                <div className="divide-y divide-bd/50 border-t border-bd/50">
                  {/* 行 1：视角偏好 */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-5">
                    <div className="space-y-1 max-w-sm">
                      <div className="text-sm font-medium text-text-1">课堂视频视角偏好</div>
                      <div className="text-xs text-text-3">
                        {videoStreamPref === 'both' && '同时解析并下载教师讲台与 PPT 高清投影机位'}
                        {videoStreamPref === 'teacher' && '仅保留教师端机位'}
                        {videoStreamPref === 'ppt' && '仅保留 PPT 高清演示机位'}
                      </div>
                    </div>
                    <div className="shrink-0">
                      <Segmented
                        size="md"
                        value={videoStreamPref}
                        onChange={(v) => setVideoStreamPref(v as any)}
                        options={[
                          { key: 'both', label: '双视角' },
                          { key: 'teacher', label: '仅教师' },
                          { key: 'ppt', label: '仅 PPT' }
                        ]}
                      />
                    </div>
                  </div>

                  {/* 行 2：PPT 转 PDF */}
                  <div className="flex items-center justify-between gap-4 py-5">
                    <div className="space-y-1">
                      <div className="text-sm font-medium text-text-1">自动转存 PPT 课件为 PDF</div>
                      <div className="text-xs text-text-3">便于在 iPad 或平板设备上进行手写批注</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPptToPdf(!pptToPdf)}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors duration-150 ${
                        pptToPdf ? 'bg-accent' : 'bg-surface-4'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-150 mt-0.5 ml-0.5 ${
                          pptToPdf ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>

                  {/* 行 3：PPT 幻灯片切片导出 */}
                  <div className="flex items-center justify-between gap-4 py-5">
                    <div className="space-y-1">
                      <div className="text-sm font-medium text-text-1">导出讲义高清切片图集目录</div>
                      <div className="text-xs text-text-3">将讲义单页保存为高清图片伴生目录</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPptExportSlices(!pptExportSlices)}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors duration-150 ${
                        pptExportSlices ? 'bg-accent' : 'bg-surface-4'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-150 mt-0.5 ml-0.5 ${
                          pptExportSlices ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </section>
            )}

            {/* 5. 外观与通用 */}
            {activeNav === 'appearance' && (
              <section className="space-y-6">
                <div>
                  <h2 className="text-base font-bold text-text-1">外观与通用</h2>
                  <p className="mt-1 text-xs text-text-3">界面色彩主题与客户端后台偏好设置</p>
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

                  {/* 行 2：课程列表排版模式切换 (新版 Deck vs 旧版 List) */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-5">
                    <div className="space-y-1">
                      <div className="text-sm font-medium text-text-1">课程列表排版风格</div>
                      <div className="text-xs text-text-3">支持在现代卡片网格流（新版）与传统全宽紧凑列表（旧版）之间自由切换</div>
                    </div>
                    <div className="shrink-0">
                      <Segmented
                        size="md"
                        value={courseLayoutMode}
                        onChange={(v) => setCourseLayoutMode(v as 'deck' | 'list')}
                        options={[
                          { key: 'deck', label: '🎴 卡片网格 (Deck)' },
                          { key: 'list', label: '📋 紧凑列表 (List)' }
                        ]}
                      />
                    </div>
                  </div>

                  {/* 行 3：启动自动同步 */}
                  <div className="flex items-center justify-between gap-4 py-5">
                    <div className="space-y-1">
                      <div className="text-sm font-medium text-text-1">启动时静默预检课程</div>
                      <div className="text-xs text-text-3">进入应用后在后台静默刷新 Canvas 与好大学在线课程索引</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setAutoSyncCourses(!autoSyncCourses)}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors duration-150 ${
                        autoSyncCourses ? 'bg-accent' : 'bg-surface-4'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-150 mt-0.5 ml-0.5 ${
                          autoSyncCourses ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>

                  {/* 行 3：版本与信息 */}
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
