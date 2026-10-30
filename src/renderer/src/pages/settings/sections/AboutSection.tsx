import { useAppStore } from '../../../store/app'
import pkg from '../../../../../../package.json'

export interface AboutSectionProps {
  updateChecking: boolean
  updateMessage: string | null
  handleManualCheckUpdate: () => Promise<void>
}

export function AboutSection({
  updateChecking,
  updateMessage,
  handleManualCheckUpdate
}: AboutSectionProps) {
  const autoDownloadUpdate = useAppStore(s => s.autoDownloadUpdate)
  const setAutoDownloadUpdate = useAppStore(s => s.setAutoDownloadUpdate)

  return (
              <section className="space-y-6">
                <div>
                  <h2 className="text-base font-bold text-text-1">关于与更新</h2>
                  <p className="mt-1 text-xs text-text-3">客户端版本状态、后台自动更新与初始化向导重置</p>
                </div>

                <div className="divide-y divide-bd border-t border-bd">
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
                        上海交通大学课程一站式转存与同步套件 · Canvas / 录播 / 慕课 / 交大云盘
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
                        检测到新版本时在后台自动下载安装包，下载就绪后提示安装，不强制打断当前操作。
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
                      className="rounded-xl border border-bd bg-surface-2 px-3.5 py-1.5 text-xs font-semibold text-text-2 hover:text-accent hover:border-accent transition-all cursor-pointer shadow-2xs shrink-0"
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
  )
}
