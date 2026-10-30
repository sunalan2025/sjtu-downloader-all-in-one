import { useAppStore } from '../../../store/app'
import { Segmented } from '../../../components/Segmented'
import type { VideoQualityOption, VideoPerspective } from '@shared/types'

export interface MediaSectionProps {
  videoQualityOption: VideoQualityOption
  setVideoQualityOption: (v: VideoQualityOption) => void
  videoPerspectivePreference: VideoPerspective
  setVideoPerspectivePreference: (v: VideoPerspective) => void
  isAudioOnly: boolean
  handleToggleAudioOnly: (enabled: boolean) => void
}

export function MediaSection({
  videoQualityOption,
  setVideoQualityOption,
  videoPerspectivePreference,
  setVideoPerspectivePreference,
  isAudioOnly,
  handleToggleAudioOnly
}: MediaSectionProps) {
  const autoExportPptPdf = useAppStore(s => s.autoExportPptPdf)
  const setAutoExportPptPdf = useAppStore(s => s.setAutoExportPptPdf)
  const pptSaveImages = useAppStore(s => s.pptSaveImages)
  const setPptSaveImages = useAppStore(s => s.setPptSaveImages)
  const canvasExportSrt = useAppStore(s => s.canvasExportSrt)
  const setCanvasExportSrt = useAppStore(s => s.setCanvasExportSrt)
  const canvasExportMarkdown = useAppStore(s => s.canvasExportMarkdown)
  const setCanvasExportMarkdown = useAppStore(s => s.setCanvasExportMarkdown)
  const canvasAssignmentOptions = useAppStore(s => s.canvasAssignmentOptions)
  const setCanvasAssignmentOptions = useAppStore(s => s.setCanvasAssignmentOptions)

  return (
              <section className="space-y-6">
                <div>
                  <h2 className="text-base font-bold text-text-1">课件与多媒体</h2>
                  <p className="mt-1 text-xs text-text-3">针对 Canvas 教学平台、旁听课程及好大学在线的音视频偏好</p>
                </div>

                <div className="divide-y divide-bd border-t border-bd">
                  {/* 仅下载原声音频 */}
                  <div className="flex items-center justify-between gap-4 py-5">
                    <div className="space-y-1 max-w-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-text-1">仅下载原声音频</span>
                        <span className="rounded-md bg-accent/10 px-2 py-0.5 text-2xs font-semibold text-accent">省流 90%</span>
                      </div>
                      <div className="text-xs text-text-3 leading-relaxed">
                        开启后所有课堂视频与录播均仅提取音频文件（MP3 / M4A），不下载视频画面，节省大量存储空间。
                      </div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={isAudioOnly}
                      onClick={() => handleToggleAudioOnly(!isAudioOnly)}
                      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
                        isAudioOnly ? 'bg-accent' : 'bg-surface-4'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-xs transition-transform ${
                          isAudioOnly ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>

                  {isAudioOnly ? (
                    <div className="flex items-center gap-3 rounded-xl border border-accent/30 bg-accent/5 px-4 py-3 my-2 text-xs text-text-2">
                      <span className="text-base select-none">🎵</span>
                      <div className="leading-relaxed">
                        当前已开启<strong className="text-accent font-semibold">仅下载原声音频</strong>模式。下载课堂视频与慕课时将自动提取为音频文件（MP3 / M4A），无需选择画面分辨率与镜头机位。
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* 默认视频清晰度 */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-5">
                        <div className="space-y-1 max-w-sm">
                          <div className="text-sm font-medium text-text-1">默认视频清晰度</div>
                          <div className="text-xs text-text-3 leading-relaxed">
                            课堂视频与在线慕课解析时优先获取的分辨率规格
                          </div>
                        </div>
                        <div className="shrink-0">
                          <Segmented
                            size="md"
                            value={videoQualityOption}
                            onChange={(v) => setVideoQualityOption(v as VideoQualityOption)}
                            options={[
                              { key: 'origin', label: '原画高清' },
                              { key: '1080p', label: '1080P' },
                              { key: '720p', label: '720P' }
                            ]}
                          />
                        </div>
                      </div>

                      {/* 默认录播镜头视角 */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-5">
                        <div className="space-y-1 max-w-sm">
                          <div className="text-sm font-medium text-text-1">默认录播镜头视角</div>
                          <div className="text-xs text-text-3 leading-relaxed">
                            下载课堂实录录播时的默认视角。主界面与底栏动作岛将统一遵循此设置，无需逐门课程重复配置
                          </div>
                        </div>
                        <div className="shrink-0">
                          <Segmented
                            size="md"
                            value={videoPerspectivePreference}
                            onChange={(v) => setVideoPerspectivePreference(v as VideoPerspective)}
                            options={[
                              { key: 'all', label: '📹 双机位同时下载' },
                              { key: 'teacher', label: '👨‍🏫 仅教师视角' },
                              { key: 'ppt', label: '📑 仅PPT投屏' }
                            ]}
                          />
                        </div>
                      </div>
                    </>
                  )}

                  {/* 导出外挂字幕 (.srt) */}
                  <div className="flex items-center justify-between gap-4 py-5">
                    <div className="space-y-1 max-w-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-text-1">导出外挂字幕</span>

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
                        <span className="text-sm font-medium text-text-1">导出复习讲义笔记</span>

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
                          title: '作业说明文档',
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
                              : 'border-bd bg-surface-2/40 hover:border-bd-strong hover:bg-surface-2'
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
                              item.checked ? 'border-accent bg-accent text-white' : 'border-bd bg-surface-1'
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

                  {/* 默认提取并合成 PPT 讲义 */}
                  <div className="flex items-center justify-between gap-4 py-5">
                    <div className="space-y-1 max-w-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-text-1">默认提取并合成 PPT 讲义</span>
                        <span className="rounded-md bg-accent/10 px-2 py-0.5 text-2xs font-semibold text-accent">已就绪</span>
                      </div>
                      <div className="text-xs text-text-3 leading-relaxed">
                        包含课堂录播的课程自动提取演示画面并去重整合为高清 PDF 电子讲义，适合导入 iPad / 平板无纸化批注。无需在每门课程内单独手动开启。
                      </div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={autoExportPptPdf}
                      onClick={() => setAutoExportPptPdf(!autoExportPptPdf)}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors duration-150 ${
                        autoExportPptPdf ? 'bg-accent' : 'bg-surface-4'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-150 mt-0.5 ml-0.5 ${
                          autoExportPptPdf ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
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
  )
}
