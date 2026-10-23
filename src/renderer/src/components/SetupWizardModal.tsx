import { useState, useEffect } from 'react'
import {
  useAppStore,
  type WindowCloseAction
} from '../store/app'
import type { DownloadMode, VideoQualityOption, VideoPerspective } from '@shared/types'
import { formatCloudBreadcrumb, CLOUD_DEST_PRESETS } from '@shared/utils'
import pkg from '../../../../package.json'

export function SetupWizardModal({ initialStep = 1, showModal: propShowModal }: { initialStep?: number; showModal?: boolean } = {}) {
  const storeShowModal = useAppStore(s => s.showSetupWizardModal)
  const effectiveShowModal = typeof useAppStore.getState === 'function' ? useAppStore.getState().showSetupWizardModal : storeShowModal
  const showSetupWizardModal = propShowModal ?? effectiveShowModal ?? storeShowModal
  const setShowSetupWizardModal = useAppStore(s => s.setShowSetupWizardModal)
  const storeLastSetupVersion = useAppStore(s => s.lastSetupVersion)
  const lastSetupVersion = typeof useAppStore.getState === 'function' ? useAppStore.getState().lastSetupVersion : storeLastSetupVersion
  const setLastSetupVersion = useAppStore(s => s.setLastSetupVersion)
  const setHasCompletedInitialSetup = useAppStore(s => s.setHasCompletedInitialSetup)

  const storeDownloadMode = useAppStore(s => s.downloadMode)
  const downloadMode = typeof useAppStore.getState === 'function' ? useAppStore.getState().downloadMode : storeDownloadMode
  const setDownloadMode = useAppStore(s => s.setDownloadMode)

  const storeLocalDestRoot = useAppStore(s => s.localDestRoot)
  const localDestRoot = typeof useAppStore.getState === 'function' ? useAppStore.getState().localDestRoot : storeLocalDestRoot
  const setLocalDestRoot = useAppStore(s => s.setLocalDestRoot)

  const storeCloudDestRoot = useAppStore(s => s.cloudDestRoot)
  const cloudDestRoot = typeof useAppStore.getState === 'function' ? useAppStore.getState().cloudDestRoot : storeCloudDestRoot
  const setCloudDestRoot = useAppStore(s => s.setCloudDestRoot)

  const storeVideoQualityOption = useAppStore(s => s.videoQualityOption)
  const videoQualityOption = typeof useAppStore.getState === 'function' ? useAppStore.getState().videoQualityOption : storeVideoQualityOption
  const setVideoQualityOption = useAppStore(s => s.setVideoQualityOption)

  const storeVideoPerspectivePreference = useAppStore(s => s.videoPerspectivePreference)
  const videoPerspectivePreference = typeof useAppStore.getState === 'function' ? useAppStore.getState().videoPerspectivePreference : storeVideoPerspectivePreference
  const setVideoPerspectivePreference = useAppStore(s => s.setVideoPerspectivePreference)

  const storeAutoExportPptPdf = useAppStore(s => s.autoExportPptPdf)
  const autoExportPptPdf = typeof useAppStore.getState === 'function' ? useAppStore.getState().autoExportPptPdf : storeAutoExportPptPdf
  const setAutoExportPptPdf = useAppStore(s => s.setAutoExportPptPdf)

  const storeCanvasExportSrt = useAppStore(s => s.canvasExportSrt)
  const canvasExportSrt = typeof useAppStore.getState === 'function' ? useAppStore.getState().canvasExportSrt : storeCanvasExportSrt
  const setCanvasExportSrt = useAppStore(s => s.setCanvasExportSrt)

  const storeCanvasExportMarkdown = useAppStore(s => s.canvasExportMarkdown)
  const canvasExportMarkdown = typeof useAppStore.getState === 'function' ? useAppStore.getState().canvasExportMarkdown : storeCanvasExportMarkdown
  const setCanvasExportMarkdown = useAppStore(s => s.setCanvasExportMarkdown)

  const storeWindowCloseAction = useAppStore(s => s.windowCloseAction)
  const windowCloseAction = typeof useAppStore.getState === 'function' ? useAppStore.getState().windowCloseAction : storeWindowCloseAction
  const setWindowCloseAction = useAppStore(s => s.setWindowCloseAction)

  const [defaultDownloadsDir, setDefaultDownloadsDir] = useState<string>('')
  const [wizardStep, setWizardStep] = useState(initialStep)
  const [wizardDirection, setWizardDirection] = useState<'forward' | 'backward'>('forward')

  const currentVersion = (typeof window !== 'undefined' && window.api?.version) || pkg.version
  const isUpdate = Boolean(lastSetupVersion && lastSetupVersion !== currentVersion)

  useEffect(() => {
    let mounted = true
    if (typeof window !== 'undefined' && window.api?.getDefaultDownloadsDir) {
      window.api.getDefaultDownloadsDir().then(dir => {
        if (mounted && dir) setDefaultDownloadsDir(dir)
      }).catch(() => undefined)
    }
    return () => {
      mounted = false
    }
  }, [])

  if (!showSetupWizardModal) return null

  const resolvedLocalPath = localDestRoot || defaultDownloadsDir
  const isDefaultLocalPath = !localDestRoot

  const TOTAL_STEPS = 4
  const STEPS = [
    { id: 1, label: '存储模式', icon: '🎯' },
    { id: 2, label: '保存目录', icon: '📦' },
    { id: 3, label: '课件与辅助', icon: '🎬' },

    { id: 4, label: '后台保护', icon: '🚪' }
  ]

  const handleNext = (): void => {
    if (wizardStep < TOTAL_STEPS) {
      setWizardDirection('forward')
      setWizardStep(prev => prev + 1)
    } else {
      handleComplete()
    }
  }

  const handlePrev = (): void => {
    if (wizardStep > 1) {
      setWizardDirection('backward')
      setWizardStep(prev => prev - 1)
    }
  }

  const handleJumpToStep = (targetStep: number): void => {
    if (targetStep === wizardStep) return
    setWizardDirection(targetStep > wizardStep ? 'forward' : 'backward')
    setWizardStep(targetStep)
  }

  const handleComplete = (): void => {
    setLastSetupVersion(currentVersion)
    setHasCompletedInitialSetup(true)
    setShowSetupWizardModal(false)
  }

  const handleSelectFolder = async (): Promise<void> => {
    const p = await window.api.selectFolder()
    if (p) setLocalDestRoot(p)
  }

  const renderCloudDestRootCard = (badgeText: string) => {
    const breadcrumb = formatCloudBreadcrumb(cloudDestRoot)
    return (
      <div className="space-y-3 rounded-2xl border border-bd/70 bg-surface-2/60 p-5 shadow-2xs">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <span className="text-base select-none">☁️</span>
            <span className="font-semibold text-text-2">交大云盘保存目录</span>
            <span className="rounded-md bg-accent/10 text-accent px-2 py-0.5 text-2xs font-semibold border border-accent/20">
              {badgeText}
            </span>
          </div>
          <span className="text-2xs text-text-4">云端自动按学期与课程分类归档</span>
        </div>

        {/* 3 个快捷预设胶囊按钮 */}
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          <span className="text-2xs font-medium text-text-4 select-none">快捷预设:</span>
          {CLOUD_DEST_PRESETS.map(preset => {
            const isSelected = cloudDestRoot === preset.value
            return (
              <button
                key={preset.value}
                type="button"
                onClick={() => setCloudDestRoot(preset.value)}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-accent text-white shadow-2xs font-semibold'
                    : 'bg-surface-1 border border-bd/80 text-text-3 hover:text-text-1 hover:border-bd-strong hover:bg-surface-2'
                }`}
              >
                {preset.label}
              </button>
            )
          })}
        </div>

        {/* 自定义路径输入框 */}
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center justify-between text-2xs text-text-3">
            <span className="font-medium">自定义目标路径</span>
            <span className="text-3xs text-text-4">以 / 开头，支持自定义多级目录</span>
          </div>
          <div className="relative flex items-center">
            <span className="absolute left-3.5 text-base select-none text-text-4 pointer-events-none">☁️</span>
            <input
              type="text"
              value={cloudDestRoot}
              onChange={e => setCloudDestRoot(e.target.value)}
              placeholder="/SJTU课程备份"
              className="w-full rounded-xl border border-bd/80 bg-surface-1 pl-10 pr-4 py-2 font-mono text-xs text-text-1 placeholder:text-text-4 focus:border-accent focus:outline-hidden focus:ring-1 focus:ring-accent/30 transition-all shadow-2xs"
            />
          </div>
        </div>

        {/* 实时面包屑预览 */}
        <div className="rounded-xl bg-surface-1 border border-bd/60 p-3 text-2xs space-y-1">
          <div className="flex items-center gap-1.5 text-text-4 font-medium select-none">
            <span>🧭</span>
            <span>路径层级实时预览</span>
          </div>
          <div className="font-mono text-accent truncate text-xs font-medium pl-5" title={breadcrumb}>
            {breadcrumb}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-md p-4 sm:p-6 animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl max-h-[90vh] flex flex-col rounded-3xl border border-bd/80 bg-surface-1 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        {/* 顶部 Header */}
        <div className="border-b border-bd/60 bg-surface-2/40 px-6 sm:px-8 pt-6 pb-5 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-3 py-1 text-xs font-semibold text-accent border border-accent/20">
              <span>{isUpdate ? `🚀 版本更新偏好确认 · v${currentVersion}` : '✨ 首次使用向导'}</span>
              <span className="text-accent/60 font-mono text-2xs">· 步骤 {wizardStep} / {TOTAL_STEPS}</span>
            </div>
            <button
              type="button"
              onClick={handleComplete}
              className="text-text-4 hover:text-text-2 text-xs transition-colors cursor-pointer px-2 py-1 rounded-lg hover:bg-surface-3"
              title="稍后可在系统设置中随时修改"
            >
              跳过向导 ✕
            </button>
          </div>
          <h1 className="text-lg sm:text-xl font-bold text-text-1">
            {isUpdate
              ? `交大课程下载器已更新至 v${currentVersion}！请确认偏好设置`
              : '欢迎使用交大课程下载器！请完成初始偏好设置'}
          </h1>
          <p className="text-xs text-text-3 leading-relaxed">
            {isUpdate
              ? '检测到应用已升级。以下为核心偏好配置，已自动保留您之前的配置习惯，请快速确认或按需调整。'
              : '根据您的使用习惯确认以下核心设置。配置完成后即可进入主界面开启下载（后续亦可在设置中随时更改）。'}
          </p>
        </div>

        {/* 内容滚动作业区 */}
        <div className="flex-1 overflow-y-auto p-6 sm:p-8 space-y-6">
          <div
            key={wizardStep}
            className={wizardDirection === 'forward' ? 'animate-slide-in-right' : 'animate-slide-in-left'}
          >
            {/* 卡片 1：存储目标模式 */}
            {wizardStep === 1 && (
              <div className="space-y-5">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-accent/10 text-base">
                      🎯
                    </span>
                    <h2 className="text-base sm:text-lg font-bold text-text-1">存储目标模式</h2>
                  </div>
                  <p className="text-xs text-text-3 leading-relaxed">
                    课件与视频下载完成后，您希望如何存放这些文件？
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-3">
                  {[
                    {
                      key: 'local',
                      icon: '💻',
                      title: '仅存本地',
                      desc: '仅保存在本地磁盘指定目录中，最稳定且随时离线阅读，不占用交大云盘配额。',
                      badge: '推荐'
                    },
                    {
                      key: 'cloud',
                      icon: '☁️',
                      title: '直传交大云盘',
                      desc: '直接分片上传至交大云盘个人空间，不占用本地硬盘空间（需在云盘设置中完成免密授权）。',
                      badge: '免占本地'
                    },
                    {
                      key: 'both',
                      icon: '🔄',
                      title: '本地 + 云盘双备份',
                      desc: '本地磁盘与交大云盘各存一份，自动双向备份，兼顾本地查阅与多设备云端同步。',
                      badge: '最稳妥'
                    }
                  ].map(opt => {
                    const selected = downloadMode === opt.key
                    return (
                      <div
                        key={opt.key}
                        onClick={() => setDownloadMode(opt.key as DownloadMode)}
                        className={`flex items-start gap-4 rounded-2xl border p-4 cursor-pointer transition-all ${
                          selected
                            ? 'border-accent bg-accent/10 shadow-xs'
                            : 'border-bd/70 bg-surface-1 hover:border-bd-strong hover:bg-surface-2/60'
                        }`}
                      >
                        <span className="text-2xl select-none shrink-0 mt-0.5">{opt.icon}</span>
                        <div className="flex-1 space-y-1">
                          <div className="flex items-center gap-2">
                            <span className={`text-sm font-bold ${selected ? 'text-accent' : 'text-text-1'}`}>
                              {opt.title}
                            </span>
                            {opt.badge && (
                              <span className={`rounded-md px-2 py-0.5 text-2xs font-semibold ${
                                selected ? 'bg-accent text-white' : 'bg-surface-3 text-text-3'
                              }`}>
                                {opt.badge}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-text-3 leading-relaxed">{opt.desc}</p>
                        </div>
                        <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border mt-0.5 transition-colors ${
                          selected ? 'border-accent bg-accent text-white' : 'border-bd bg-surface-2'
                        }`}>
                          {selected && (
                            <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* 卡片 2：保存目录与路径配置 */}
            {wizardStep === 2 && (
              <div className="space-y-5">
                {downloadMode === 'cloud' ? (
                  <>
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-accent/10 text-base">
                          ☁️
                        </span>
                        <h2 className="text-base sm:text-lg font-bold text-text-1">云端归档与保存目录</h2>
                      </div>
                      <p className="text-xs text-text-3 leading-relaxed">
                        您已选择「直传交大云盘」，课件与视频将直接上传归档至您的交大云盘个人空间。
                      </p>
                    </div>

                    <div className="rounded-2xl border border-sky-500/20 bg-sky-500/5 dark:bg-sky-500/10 p-4 text-xs text-text-2 leading-relaxed flex items-start gap-3">
                      <span className="text-base select-none shrink-0">☁️</span>
                      <div>
                        <div className="font-semibold text-text-1">免占本地硬盘空间</div>
                        <div className="text-3xs text-text-3 mt-0.5 leading-relaxed">
                          分片直传完成后，临时缓存将自动清理。您可在云盘界面随时查看与在线预览。
                        </div>
                      </div>
                    </div>

                    {/* 交大云盘保存目录（主要配置卡片） */}
                    {renderCloudDestRootCard('主保存路径')}

                    <div className="space-y-3 rounded-2xl border border-bd/70 bg-surface-2/60 p-5 shadow-2xs">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-text-2">本地缓冲与备用路径</span>
                        <span className="text-2xs text-text-4">用于切片处理或网络降级备用</span>
                      </div>
                      <div className="flex items-center gap-3 rounded-xl border border-bd/80 bg-surface-1 px-4 py-3 font-mono text-xs text-text-1">
                        <span className="text-lg select-none">📁</span>
                        <span className="truncate flex-1 font-medium" title={resolvedLocalPath || '系统默认下载目录'}>
                          {resolvedLocalPath || '系统默认下载目录（Downloads）'}
                        </span>
                        {isDefaultLocalPath && resolvedLocalPath && (
                          <span className="shrink-0 rounded-md bg-accent/10 text-accent px-2 py-0.5 text-2xs font-semibold border border-accent/20">
                            系统默认
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2.5 pt-1">
                        <button
                          type="button"
                          onClick={handleSelectFolder}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-bd bg-surface-2 px-3.5 py-2 text-xs font-semibold text-text-1 shadow-xs hover:bg-surface-3 active:scale-98 transition-all cursor-pointer"
                        >
                          <span>📂 更改备用目录…</span>
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            if (window.api?.openPath) {
                              await window.api.openPath(resolvedLocalPath)
                            }
                          }}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-bd bg-surface-2 px-3.5 py-2 text-xs font-medium text-text-2 hover:bg-surface-3 hover:text-text-1 transition-all cursor-pointer shadow-2xs"
                        >
                          <span>打开所在目录 ↗</span>
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-accent/10 text-base">
                          {downloadMode === 'both' ? '🔄' : '📦'}
                        </span>
                        <h2 className="text-base sm:text-lg font-bold text-text-1">
                          {downloadMode === 'both' ? '保存目录与双备份路径' : '本地文件保存目录'}
                        </h2>
                      </div>
                      <p className="text-xs text-text-3 leading-relaxed">
                        {downloadMode === 'both'
                          ? '双备份模式下，所有教学资源将首先完整落盘在本地目录，随后自动上传至交大云盘。'
                          : '所有课件讲义、课堂录像与复习笔记落盘存储的根目录。'}
                      </p>
                    </div>

                    <div className="space-y-3 rounded-2xl border border-bd/70 bg-surface-2/60 p-5 shadow-2xs">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-text-2">本地保存路径</span>
                        <span className="text-2xs text-text-4">自动按学期与课程分类归档</span>
                      </div>
                      <div className="flex items-center gap-3 rounded-xl border border-bd/80 bg-surface-1 px-4 py-3 font-mono text-xs text-text-1">
                        <span className="text-lg select-none">📁</span>
                        <span className="truncate flex-1 font-medium" title={resolvedLocalPath || '系统默认下载目录'}>
                          {resolvedLocalPath || '系统默认下载目录（Downloads）'}
                        </span>
                        {isDefaultLocalPath && resolvedLocalPath && (
                          <span className="shrink-0 rounded-md bg-accent/10 text-accent px-2 py-0.5 text-2xs font-semibold border border-accent/20">
                            系统默认
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2.5 pt-1">
                        <button
                          type="button"
                          onClick={handleSelectFolder}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-accent-light active:scale-98 transition-all cursor-pointer"
                        >
                          <span>📂 浏览并选择新目录…</span>
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            if (window.api?.openPath) {
                              await window.api.openPath(resolvedLocalPath)
                            }
                          }}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-bd bg-surface-2 px-3.5 py-2 text-xs font-medium text-text-2 hover:bg-surface-3 hover:text-text-1 transition-all cursor-pointer shadow-2xs"
                        >
                          <span>打开所在目录 ↗</span>
                        </button>
                      </div>
                    </div>

                    {/* 交大云盘保存目录（本地/双备份模式均清晰呈现） */}
                    {renderCloudDestRootCard(downloadMode === 'both' ? '云端备份路径' : '云端归档预设')}

                    <div className="rounded-xl border border-accent/20 bg-accent/5 p-4 text-xs text-text-2 leading-relaxed flex items-start gap-3">
                      <span className="text-base select-none shrink-0">💡</span>
                      <p>
                        <strong className="text-accent">温馨建议：</strong>后续所有从 Canvas、好大学在线与旁听平台抓取的教学资源，都将自动按规范目录清晰收纳至此处。建议选择剩余空间大于 20 GB 的磁盘分区。
                      </p>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* 卡片 3：课件与学习辅助 */}
            {wizardStep === 3 && (
              <div className="space-y-5">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-accent/10 text-base">
                      🎬
                    </span>
                    <h2 className="text-base sm:text-lg font-bold text-text-1">课件与学习辅助</h2>
                  </div>
                  <p className="text-xs text-text-3 leading-relaxed">
                    自定义课堂视频录播的画质规格、镜头机位偏好，并按需开启 PPT 讲义与 AI 复习材料自动导出。
                  </p>
                </div>

                {/* 分区 1：视频清晰度偏好 */}
                <div className="space-y-2.5 rounded-2xl border border-bd/70 bg-surface-2/40 p-4 shadow-2xs">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-text-2 flex items-center gap-1.5">
                      <span>🖥️</span>
                      <span>视频优先清晰度</span>
                    </span>
                    <span className="text-2xs text-text-4">优先下载此画质（若无则自动匹配最高可用）</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2.5">
                    {[
                      { key: 'origin', title: '原画高清', desc: '板书最清晰', badge: '推荐' },
                      { key: '1080p', title: '1080P 全高清', desc: '画质体积均衡' },
                      { key: '720p', title: '720P 高清', desc: '便携紧凑加载' }
                    ].map(opt => {
                      const selected = (videoQualityOption || 'origin') === opt.key
                      return (
                        <div
                          key={opt.key}
                          onClick={() => setVideoQualityOption(opt.key as VideoQualityOption)}
                          className={`flex flex-col justify-between rounded-xl border p-3 cursor-pointer transition-all ${
                            selected
                              ? 'border-accent bg-accent/10 shadow-2xs'
                              : 'border-bd/70 bg-surface-1 hover:border-bd-strong hover:bg-surface-2/60'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className={`text-xs font-bold ${selected ? 'text-accent' : 'text-text-1'}`}>
                              {opt.title}
                            </span>
                            {opt.badge && (
                              <span className={`rounded-md px-1.5 py-0.2 text-3xs font-semibold ${
                                selected ? 'bg-accent text-white' : 'bg-surface-3 text-text-3'
                              }`}>
                                {opt.badge}
                              </span>
                            )}
                          </div>
                          <p className="text-3xs text-text-3 mt-1">{opt.desc}</p>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* 分区 2：默认录播机位偏好 */}
                <div className="space-y-2.5 rounded-2xl border border-bd/70 bg-surface-2/40 p-4 shadow-2xs">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-text-2 flex items-center gap-1.5">
                      <span>📹</span>
                      <span>默认录播机位视角</span>
                    </span>
                    <span className="text-2xs text-text-4">避免重复下载多机位，节省磁盘与云盘空间</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[
                      { key: 'teacher', title: '仅教师视角', desc: '主镜头·450MB/讲', badge: '推荐' },
                      { key: 'all', title: '双机位录像', desc: '教师+PPT·全保留' },
                      { key: 'ppt', title: '仅PPT投屏', desc: '纯课件·200MB/讲' },
                      { key: 'audio', title: '纯音频 MP3', desc: '随身听·45MB/讲', badge: '省流' }
                    ].map(opt => {
                      const selected = (videoPerspectivePreference || 'teacher') === opt.key
                      return (
                        <div
                          key={opt.key}
                          onClick={() => setVideoPerspectivePreference(opt.key as VideoPerspective)}
                          className={`flex flex-col justify-between rounded-xl border p-2.5 cursor-pointer transition-all ${
                            selected
                              ? 'border-accent bg-accent/10 shadow-2xs'
                              : 'border-bd/70 bg-surface-1 hover:border-bd-strong hover:bg-surface-2/60'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className={`text-xs font-bold ${selected ? 'text-accent' : 'text-text-1'}`}>
                              {opt.title}
                            </span>
                            {opt.badge && (
                              <span className={`rounded-md px-1.5 py-0.2 text-3xs font-semibold ${
                                selected ? 'bg-accent text-white' : 'bg-surface-3 text-text-3'
                              }`}>
                                {opt.badge}
                              </span>
                            )}
                          </div>
                          <p className="text-3xs text-text-3 mt-1">{opt.desc}</p>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* 分区 3：课后复习与学习辅助资料导出 */}
                <div className="space-y-2.5 rounded-2xl border border-bd/70 bg-surface-2/40 p-4 shadow-2xs">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-text-2 flex items-center gap-1.5">
                      <span>📑</span>
                      <span>学习辅助资料自动生成</span>
                    </span>
                    <span className="text-2xs text-text-4">随视频同步处理，支持独立启闭</span>
                  </div>

                  <div className="space-y-2">
                    {/* 项 1: PPT 讲义自动提取 */}
                    <div
                      role="checkbox"
                      aria-checked={autoExportPptPdf}
                      tabIndex={0}
                      onClick={() => setAutoExportPptPdf(!autoExportPptPdf)}
                      className={`flex items-center justify-between gap-3 rounded-xl border p-3 cursor-pointer transition-all select-none ${
                        autoExportPptPdf
                          ? 'border-accent bg-accent/10 shadow-2xs'
                          : 'border-bd/70 bg-surface-1 hover:border-bd-strong hover:bg-surface-2/60'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-xl select-none shrink-0">📑</span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className={`text-xs font-bold ${autoExportPptPdf ? 'text-accent' : 'text-text-1'}`}>
                              自动生成 PPT 讲义 PDF
                            </span>
                            <span className="rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.2 text-3xs font-semibold border border-emerald-500/20">
                              复习神器
                            </span>
                          </div>
                          <p className="text-3xs text-text-3 truncate mt-0.5">
                            自动抓取投屏高清切片，合成为便于做笔记、打印与复习的单份 PDF
                          </p>
                        </div>
                      </div>
                      <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                        autoExportPptPdf ? 'border-accent bg-accent text-white' : 'border-bd/80 bg-surface-2'
                      }`}>
                        {autoExportPptPdf && (
                          <svg className="h-2.5 w-2.5" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        )}
                      </div>
                    </div>

                    {/* 项 2: AI 语音外挂字幕 (.srt) */}
                    <div
                      role="checkbox"
                      aria-checked={canvasExportSrt}
                      tabIndex={0}
                      onClick={() => setCanvasExportSrt(!canvasExportSrt)}
                      className={`flex items-center justify-between gap-3 rounded-xl border p-3 cursor-pointer transition-all select-none ${
                        canvasExportSrt
                          ? 'border-accent bg-accent/10 shadow-2xs'
                          : 'border-bd/70 bg-surface-1 hover:border-bd-strong hover:bg-surface-2/60'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-xl select-none shrink-0">📺</span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className={`text-xs font-bold ${canvasExportSrt ? 'text-accent' : 'text-text-1'}`}>
                              导出外挂字幕 (.srt)
                            </span>
                            <span className="rounded-md bg-sky-500/10 text-sky-600 dark:text-sky-400 px-1.5 py-0.2 text-3xs font-semibold border border-sky-500/20">
                              播放器直读
                            </span>
                          </div>
                          <p className="text-3xs text-text-3 truncate mt-0.5">
                            依托交大录播中台 AI 语音识别，生成同名 .srt，双击视频自动挂载
                          </p>
                        </div>
                      </div>
                      <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                        canvasExportSrt ? 'border-accent bg-accent text-white' : 'border-bd/80 bg-surface-2'
                      }`}>
                        {canvasExportSrt && (
                          <svg className="h-2.5 w-2.5" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        )}
                      </div>
                    </div>

                    {/* 项 3: 复习笔记讲义 (.md) */}
                    <div
                      role="checkbox"
                      aria-checked={canvasExportMarkdown}
                      tabIndex={0}
                      onClick={() => setCanvasExportMarkdown(!canvasExportMarkdown)}
                      className={`flex items-center justify-between gap-3 rounded-xl border p-3 cursor-pointer transition-all select-none ${
                        canvasExportMarkdown
                          ? 'border-accent bg-accent/10 shadow-2xs'
                          : 'border-bd/70 bg-surface-1 hover:border-bd-strong hover:bg-surface-2/60'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-xl select-none shrink-0">📝</span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className={`text-xs font-bold ${canvasExportMarkdown ? 'text-accent' : 'text-text-1'}`}>
                              导出复习讲义笔记 (.md)
                            </span>
                            <span className="rounded-md bg-purple-500/10 text-purple-600 dark:text-purple-400 px-1.5 py-0.2 text-3xs font-semibold border border-purple-500/20">
                              结构化讲义
                            </span>
                          </div>
                          <p className="text-3xs text-text-3 truncate mt-0.5">
                            生成结构化 Markdown 讲义，带精确时间戳与章节重点，便于全文检索
                          </p>
                        </div>
                      </div>
                      <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                        canvasExportMarkdown ? 'border-accent bg-accent text-white' : 'border-bd/80 bg-surface-2'
                      }`}>
                        {canvasExportMarkdown && (
                          <svg className="h-2.5 w-2.5" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 卡片 4：窗口退出与关闭行为 */}
            {wizardStep === 4 && (
              <div className="space-y-5">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-accent/10 text-base">
                      🚪
                    </span>
                    <h2 className="text-base sm:text-lg font-bold text-text-1">窗口关闭与后台运行保护</h2>
                  </div>
                  <p className="text-xs text-text-3 leading-relaxed">
                    点击窗口右上角关闭按钮时的默认响应动作，有效保障批量大文件下载平稳进行。
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-3">
                  {[
                    {
                      key: 'tray',
                      icon: '🛡️',
                      title: '最小化到系统托盘',
                      desc: '点击关闭窗口时自动隐藏至任务栏托盘后台静默运行，正在进行的课件与视频传输不会中断。',
                      badge: '推荐'
                    },
                    {
                      key: 'taskbar',
                      icon: '📌',
                      title: '最小化到任务栏',
                      desc: '保留在系统的任务栏图标中，方便随时点击一键还原并查看实时下载速度。'
                    },
                    {
                      key: 'quit',
                      icon: '❌',
                      title: '彻底退出应用',
                      desc: '关闭主窗口时直接退出程序并终止全部下载。'
                    }
                  ].map(opt => {
                    const selected = windowCloseAction === opt.key
                    return (
                      <div
                        key={opt.key}
                        onClick={() => setWindowCloseAction(opt.key as WindowCloseAction)}
                        className={`flex items-start gap-4 rounded-2xl border p-4 cursor-pointer transition-all ${
                          selected
                            ? 'border-accent bg-accent/10 shadow-xs'
                            : 'border-bd/70 bg-surface-2/60 hover:border-bd-strong hover:bg-surface-2'
                        }`}
                      >
                        <span className="text-2xl select-none shrink-0 mt-0.5">{opt.icon}</span>
                        <div className="flex-1 space-y-1">
                          <div className="flex items-center gap-2">
                            <span className={`text-sm font-bold ${selected ? 'text-accent' : 'text-text-1'}`}>
                              {opt.title}
                            </span>
                            {opt.badge && (
                              <span className={`rounded-md px-2 py-0.5 text-2xs font-semibold ${
                                selected ? 'bg-accent text-white' : 'bg-surface-3 text-text-3'
                              }`}>
                                {opt.badge}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-text-3 leading-relaxed">{opt.desc}</p>
                        </div>
                        <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border mt-0.5 transition-colors ${
                          selected ? 'border-accent bg-accent text-white' : 'border-bd bg-surface-3'
                        }`}>
                          {selected && (
                            <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 底部 Footer 导航栏 */}
        <div className="flex items-center justify-between border-t border-bd/60 bg-surface-2/40 px-6 sm:px-8 py-4">
          <div className="min-w-[100px]">
            {wizardStep > 1 && (
              <button
                type="button"
                onClick={handlePrev}
                className="inline-flex items-center gap-1.5 rounded-xl border border-bd bg-surface-2 px-4 py-2 text-xs font-semibold text-text-2 hover:bg-surface-3 hover:text-text-1 active:scale-98 transition-all cursor-pointer shadow-2xs"
              >
                <span>← 上一步</span>
              </button>
            )}
          </div>

          {/* 胶囊指示器 */}
          <div className="flex items-center gap-1.5 select-none" title={`步骤 ${wizardStep} / ${TOTAL_STEPS}：${STEPS[wizardStep - 1].label}`}>
            {STEPS.map(s => {
              const isCurrent = s.id === wizardStep
              const isPassed = s.id < wizardStep
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => handleJumpToStep(s.id)}
                  className={`transition-all duration-300 rounded-full cursor-pointer ${
                    isCurrent
                      ? 'w-6 h-2 bg-accent shadow-2xs'
                      : isPassed
                        ? 'w-2 h-2 bg-accent/50 hover:bg-accent'
                        : 'w-2 h-2 bg-surface-4 dark:bg-white/20 hover:bg-white/40'
                  }`}
                  title={`跳转到第 ${s.id} 步：${s.label}`}
                />
              )
            })}
          </div>

          <div className="flex items-center justify-end min-w-[100px]">
            <button
              type="button"
              onClick={handleNext}
              className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-accent-light active:scale-98 transition-all cursor-pointer whitespace-nowrap"
            >
              <span>{wizardStep < TOTAL_STEPS ? '下一步 →' : '完成并开启使用 ✓'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
