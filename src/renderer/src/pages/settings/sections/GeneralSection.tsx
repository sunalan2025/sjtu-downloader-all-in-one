import { useAppStore, type Theme, type WindowCloseAction, type ExitWhenDownloadingPolicy } from '../../../store/app'
import { Segmented } from '../../../components/Segmented'
import { applyTheme } from '../../../components/TitleBar'

export function GeneralSection() {
  const theme = useAppStore(s => s.theme)
  const setTheme = useAppStore(s => s.setTheme)
  const canvasGroupByTerm = useAppStore(s => s.canvasGroupByTerm)
  const setCanvasGroupByTerm = useAppStore(s => s.setCanvasGroupByTerm)
  const windowCloseAction = useAppStore(s => s.windowCloseAction)
  const setWindowCloseAction = useAppStore(s => s.setWindowCloseAction)
  const exitWhenDownloading = useAppStore(s => s.exitWhenDownloading)
  const setExitWhenDownloading = useAppStore(s => s.setExitWhenDownloading)

  const onSelectTheme = (t: Theme): void => {
    setTheme(t)
    applyTheme(t)
  }

  return (
              <section className="space-y-6">
                <div>
                  <h2 className="text-base font-bold text-text-1">常规偏好</h2>
                  <p className="mt-1 text-xs text-text-3">界面色彩主题、网盘排版视图与客户端关闭响应策略</p>
                </div>

                <div className="divide-y divide-bd border-t border-bd">
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

                  {/* 行 2：Canvas 课程默认分组方式 */}
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
                          { key: 'term', label: '🗂️ 按学期分栏折叠' },
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
                          { key: 'tray', label: '最小化到系统托盘' },
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
                        当有未完成的课件或视频传输时触发关闭的应对机制；选择取消任务将自动中止下载并清理未完成的临时文件。
                      </div>
                    </div>
                    <div className="shrink-0">
                      <Segmented
                        size="md"
                        value={exitWhenDownloading}
                        onChange={(v) => setExitWhenDownloading(v as ExitWhenDownloadingPolicy)}
                        options={[
                          { key: 'prompt', label: '始终弹窗询问确认' },
                          { key: 'background', label: '自动转入托盘继续下载' },
                          { key: 'pause_quit', label: '退出时自动取消任务' }
                        ]}
                      />
                    </div>
                  </div>
                </div>
              </section>
  )
}
