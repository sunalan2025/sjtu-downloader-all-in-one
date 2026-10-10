import { useState } from 'react'
import { useAppStore, type Theme } from '../store/app'
import { Segmented } from '../components/Segmented'
import { applyTheme } from '../components/TitleBar'
import type { DownloadMode, FileConflictStrategy } from '@shared/types'

export function Settings({ onBack }: { onBack: () => void }) {
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

  const [activeNav, setActiveNav] = useState('storage')
  const [videoStreamPref, setVideoStreamPref] = useState<'both' | 'teacher' | 'ppt'>('both')
  const [pptToPdf, setPptToPdf] = useState(true)
  const [pptExportSlices, setPptExportSlices] = useState(true)
  const [autoSyncCourses, setAutoSyncCourses] = useState(true)

  const handleSelectFolder = async () => {
    const p = await window.api.selectFolder()
    if (p) setLocalDestRoot(p)
  }

  const handleCloudToggle = async () => {
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

  const onSelectTheme = (t: Theme) => {
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
      {/* 顶部标题栏 */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-bd bg-surface-1 px-6 shadow-sm">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 rounded-lg border border-bd bg-surface-2 px-3 py-1.5 text-xs font-medium text-text-2 transition-all hover:bg-surface-3 hover:text-text-1"
          >
            ← 返回课程列表
          </button>
          <h1 className="text-sm font-bold text-text-1">全局设置与偏好</h1>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* 左栏分类导航 */}
        <div className="w-56 shrink-0 border-r border-bd bg-surface-2 p-4 flex flex-col gap-1.5">
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
              className={`flex items-center rounded-xl px-3.5 py-2.5 text-left text-sm font-medium transition-all ${
                activeNav === item.id
                  ? 'bg-accent text-white shadow-glow-sm'
                  : 'text-text-2 hover:bg-surface-3 hover:text-text-1'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* 右栏内容 */}
        <div className="flex-1 overflow-y-auto p-8">
          <div className="mx-auto max-w-3xl space-y-8">
            
            {/* 1. 存储与下载 */}
            {activeNav === 'storage' && (
              <section className="space-y-6">
                <div>
                  <h2 className="text-base font-bold text-text-1">存储与下载偏好</h2>
                  <p className="mt-1 text-xs text-text-3">配置课件与视频的存储目标、保存目录以及同名文件的处理逻辑</p>
                </div>
                
                <div className="rounded-2xl border border-bd bg-surface-2 p-6 shadow-card">
                  <label className="mb-3 block text-sm font-semibold text-text-1">存储目标模式</label>
                  <Segmented
                    size="lg"
                    value={downloadMode}
                    onChange={(v) => setDownloadMode(v as DownloadMode)}
                    options={[
                      { key: 'local', label: '本地下载' },
                      { key: 'cloud', label: '直传交大云盘' },
                      { key: 'both', label: '本地+云盘双备份' }
                    ]}
                  />
                  <p className="mt-2 text-xs text-text-3">
                    {downloadMode === 'local' && '文件仅保存在本地磁盘指定的下载目录中。'}
                    {downloadMode === 'cloud' && '文件直接切片流式上传到交大云盘（pan.sjtu.edu.cn），不占本地空间。'}
                    {downloadMode === 'both' && '本地保存一份完整文件，同时自动同步直传一份至交大云盘个人空间。'}
                  </p>
                </div>

                <div className="rounded-2xl border border-bd bg-surface-2 p-6 shadow-card">
                  <label className="mb-3 block text-sm font-semibold text-text-1">本地保存位置</label>
                  <div className="flex items-center justify-between rounded-xl border border-bd bg-surface-1 p-4">
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-text-3">当前目标路径：</div>
                      <div className="mt-1 truncate font-mono text-sm font-medium text-text-1" title={localDestRoot || '未设置'}>
                        {localDestRoot || '（默认使用系统下载目录）'}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleSelectFolder}
                      className="ml-4 shrink-0 rounded-lg bg-accent px-4 py-2 text-xs font-medium text-white shadow-sm transition hover:bg-accent-light"
                    >
                      更改目录…
                    </button>
                  </div>
                </div>

                <div className="rounded-2xl border border-bd bg-surface-2 p-6 shadow-card">
                  <label className="mb-3 block text-sm font-semibold text-text-1">文件同名冲突策略</label>
                  <div className="grid grid-cols-2 gap-4">
                    <button
                      type="button"
                      onClick={() => setFileConflictStrategy('skip')}
                      className={`rounded-xl border p-4 text-left transition-all ${
                        fileConflictStrategy === 'skip'
                          ? 'border-accent bg-accent/10 shadow-sm'
                          : 'border-bd bg-surface-1 hover:border-bd-strong'
                      }`}
                    >
                      <div className="font-semibold text-text-1">智能跳过已存在文件</div>
                      <div className="mt-1 text-xs text-text-3">本地或云盘已有同名完整文件时自动跳过，节省带宽与时间。</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setFileConflictStrategy('overwrite')}
                      className={`rounded-xl border p-4 text-left transition-all ${
                        fileConflictStrategy === 'overwrite'
                          ? 'border-accent bg-accent/10 shadow-sm'
                          : 'border-bd bg-surface-1 hover:border-bd-strong'
                      }`}
                    >
                      <div className="font-semibold text-text-1">自动覆盖同名文件</div>
                      <div className="mt-1 text-xs text-text-3">重新完整下载并覆盖旧版本文件，确保课件最新。</div>
                    </button>
                  </div>
                </div>
              </section>
            )}

            {/* 2. 交大云盘集成 */}
            {activeNav === 'cloud' && (
              <section className="space-y-6">
                <div>
                  <h2 className="text-base font-bold text-text-1">交大云盘集成 (pan.sjtu.edu.cn)</h2>
                  <p className="mt-1 text-xs text-text-3">依托交大统一身份认证 jAccount 单点登录，支持无缝大文件分片直传与秒传</p>
                </div>
                
                <div className="rounded-2xl border border-bd bg-surface-2 p-6 shadow-card">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`h-3 w-3 rounded-full ${cloudUserToken ? 'bg-success shadow-[0_0_8px_var(--success)]' : 'bg-surface-4'}`} />
                      <div>
                        <div className="font-semibold text-text-1">{cloudUserToken ? '已连接交大云盘' : '未连接云盘'}</div>
                        <div className="text-xs text-text-3">{cloudUserToken ? '会话有效，可直接进行云端传输' : '点击右侧按钮可通过 jAccount 自动 SSO 登录'}</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleCloudToggle}
                      className={`rounded-xl px-5 py-2.5 text-xs font-semibold shadow-sm transition-all ${
                        cloudUserToken
                          ? 'border border-bd bg-surface-1 text-text-2 hover:bg-surface-3 hover:text-text-1'
                          : 'bg-accent text-white shadow-glow-sm hover:bg-accent-light'
                      }`}
                    >
                      {cloudUserToken ? '断开连接' : '一键直连 SSO'}
                    </button>
                  </div>

                  {cloudSpaceInfo && (
                    <div className="mt-6 border-t border-bd pt-4">
                      <div className="mb-2 flex justify-between text-xs font-medium text-text-2">
                        <span>已用容量: {cloudSpaceInfo.size}</span>
                        <span>总配额: {cloudSpaceInfo.capacity}</span>
                      </div>
                      <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-3">
                        <div className="h-full rounded-full bg-accent transition-all duration-500" style={{ width: `${cloudPercent}%` }} />
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
                  <h2 className="text-base font-bold text-text-1">性能与并发下载</h2>
                  <p className="mt-1 text-xs text-text-3">根据当前网络带宽合理配置多任务并发数与资源消耗策略</p>
                </div>
                
                <div className="rounded-2xl border border-bd bg-surface-2 p-6 shadow-card">
                  <label className="mb-3 block text-sm font-semibold text-text-1">最大并发任务数</label>
                  <div className="grid grid-cols-4 gap-3">
                    {[
                      { val: 1, label: '节能稳定', num: '1 并发', desc: '低带宽与弱网推荐' },
                      { val: 3, label: '平衡推荐', num: '3 并发', desc: '校园网日常推荐' },
                      { val: 5, label: '极速宽带', num: '5 并发', desc: '千兆有线网络推荐' },
                      { val: 8, label: '极限激进', num: '8 并发', desc: '多任务同时跑满' }
                    ].map(opt => (
                      <button
                        key={opt.val}
                        type="button"
                        onClick={() => setConcurrency(opt.val)}
                        className={`rounded-xl border p-4 text-center transition-all ${
                          concurrency === opt.val
                            ? 'border-accent bg-accent/10 shadow-sm'
                            : 'border-bd bg-surface-1 hover:border-bd-strong'
                        }`}
                      >
                        <div className={`text-sm font-bold ${concurrency === opt.val ? 'text-accent' : 'text-text-1'}`}>{opt.label}</div>
                        <div className="mt-1 text-xs font-semibold text-text-2">{opt.num}</div>
                        <div className="mt-1 text-[11px] text-text-3">{opt.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>
              </section>
            )}

            {/* 4. 课件与视频 */}
            {activeNav === 'video' && (
              <section className="space-y-6">
                <div>
                  <h2 className="text-base font-bold text-text-1">课堂视频与 PPT 课件转换</h2>
                  <p className="mt-1 text-xs text-text-3">针对 Canvas LTI 与交大视频的双流 HLS 讲次解析与课件保存配置</p>
                </div>
                
                <div className="rounded-2xl border border-bd bg-surface-2 p-6 shadow-card">
                  <label className="mb-3 block text-sm font-semibold text-text-1">课堂视频视角抓取偏好</label>
                  <Segmented
                    size="lg"
                    value={videoStreamPref}
                    onChange={(v) => setVideoStreamPref(v as any)}
                    options={[
                      { key: 'both', label: '教师 + PPT 双视角流' },
                      { key: 'teacher', label: '仅教师讲台视角' },
                      { key: 'ppt', label: '仅 PPT 课件高清视角' }
                    ]}
                  />
                  <p className="mt-2 text-xs text-text-3">双视角模式将同时解析教师机位与 PPT 投影机位，保存为两个独立高清 MP4。</p>
                </div>

                <div className="rounded-2xl border border-bd bg-surface-2 p-6 shadow-card space-y-4">
                  <label className="block text-sm font-semibold text-text-1">PPT 自动转换与切片捕获</label>
                  <div className="flex items-center justify-between rounded-xl border border-bd bg-surface-1 p-4">
                    <div>
                      <div className="text-sm font-medium text-text-1">将 PPT 课件自动转为高清 PDF 课件</div>
                      <div className="text-xs text-text-3">便于在 iPad / 电子阅读器上进行批注复习</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPptToPdf(!pptToPdf)}
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                        pptToPdf ? 'bg-accent' : 'bg-surface-4'
                      }`}
                    >
                      <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ease-in-out ${
                        pptToPdf ? 'translate-x-5' : 'translate-x-0'
                      }`} />
                    </button>
                  </div>

                  <div className="flex items-center justify-between rounded-xl border border-bd bg-surface-1 p-4">
                    <div>
                      <div className="text-sm font-medium text-text-1">导出讲义高清幻灯片切片图集目录</div>
                      <div className="text-xs text-text-3">单张幻灯片导出为独立图片保存在伴生文件夹中</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPptExportSlices(!pptExportSlices)}
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                        pptExportSlices ? 'bg-accent' : 'bg-surface-4'
                      }`}
                    >
                      <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ease-in-out ${
                        pptExportSlices ? 'translate-x-5' : 'translate-x-0'
                      }`} />
                    </button>
                  </div>
                </div>
              </section>
            )}

            {/* 5. 外观与通用 */}
            {activeNav === 'appearance' && (
              <section className="space-y-6">
                <div>
                  <h2 className="text-base font-bold text-text-1">界面外观与系统首选项</h2>
                  <p className="mt-1 text-xs text-text-3">自定义应用显示主题与后台静默行为</p>
                </div>
                
                <div className="rounded-2xl border border-bd bg-surface-2 p-6 shadow-card">
                  <label className="mb-3 block text-sm font-semibold text-text-1">应用界面主题</label>
                  <Segmented
                    size="lg"
                    value={theme}
                    onChange={(v) => onSelectTheme(v as Theme)}
                    options={[
                      { key: 'light', label: '☀️ 浅色明亮' },
                      { key: 'dark', label: '🌙 深色暗黑' },
                      { key: 'system', label: '💻 跟随系统' }
                    ]}
                  />
                </div>

                <div className="rounded-2xl border border-bd bg-surface-2 p-6 shadow-card">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-text-1">启动时自动同步各平台课程</div>
                      <div className="text-xs text-text-3">进入应用后在后台静默预检 Canvas 与好大学在线最新课程</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setAutoSyncCourses(!autoSyncCourses)}
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                        autoSyncCourses ? 'bg-accent' : 'bg-surface-4'
                      }`}
                    >
                      <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ease-in-out ${
                        autoSyncCourses ? 'translate-x-5' : 'translate-x-0'
                      }`} />
                    </button>
                  </div>
                </div>
              </section>
            )}

          </div>
        </div>
      </div>
    </div>
  )
}
