import type { MaskedCredential } from '@shared/types'
import { formatDate, formatBytes } from '../../../../../shared/utils'

export interface AccountSectionProps {
  auth?: { loggedIn?: boolean; accountName?: string; studentId?: string }
  onLogout?: () => void
  cloudUserToken?: string | null
  cloudSpaceInfo?: { size: number | string; capacity: number | string } | null
  cloudPercent: number | null
  handleCloudToggle: () => Promise<void>
  credentials: MaskedCredential[]
  isLoadingCreds: boolean
  editingId: string | null
  setEditingId: (id: string | null) => void
  editingLabel: string
  setEditingLabel: (label: string) => void
  showClearModal: boolean
  setShowClearModal: (show: boolean) => void
  credToDelete: MaskedCredential | null
  setCredToDelete: (cred: MaskedCredential | null) => void
  handleSaveLabel: (id: string) => Promise<void>
  handleDelete: () => Promise<void>
  handleClearAll: () => Promise<void>
}

export function AccountSection({
  auth,
  onLogout,
  cloudUserToken,
  cloudSpaceInfo,
  cloudPercent,
  handleCloudToggle,
  credentials,
  isLoadingCreds,
  editingId,
  setEditingId,
  editingLabel,
  setEditingLabel,
  showClearModal,
  setShowClearModal,
  credToDelete,
  setCredToDelete,
  handleSaveLabel,
  handleDelete,
  handleClearAll
}: AccountSectionProps) {
  return (
              <section className="space-y-6">
                <div>
                  <h2 className="text-base font-bold text-text-1">账号与云盘</h2>
                  <p className="mt-1 text-xs text-text-3">
                    管理 jAccount 登录状态、交大云盘连接与已保存的账号
                  </p>
                </div>

                {/* 当前登录会话状态卡片 */}
                {auth?.loggedIn && (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-bd bg-surface-2/60 p-4 shadow-2xs">
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
                            已登录
                          </span>
                        </div>
                        <p className="text-xs text-text-3 mt-0.5">
                          登录状态有效，已建立交大教学平台授权
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
                <div className="rounded-2xl border border-bd bg-surface-2/60 p-4 shadow-2xs space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className={`inline-block h-2 w-2 rounded-full ${cloudUserToken ? 'bg-success' : 'bg-surface-4'}`} />
                        <span className="text-sm font-bold text-text-1">
                          {cloudUserToken ? '交大云盘已连接' : '交大云盘未连接'}
                        </span>
                        {cloudUserToken && (
                          <span className="rounded-md bg-accent/10 px-2 py-0.5 text-2xs font-semibold text-accent">
                            一键免密连接
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-text-3">
                        {cloudUserToken ? '已连接，下载课件时可直接转存至云盘' : '通过交大统一身份认证一键免密接入云盘'}
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
                        {cloudUserToken ? '断开云盘连接' : '连接交大云盘'}
                      </button>
                    </div>
                  </div>

                  {/* 存储空间配额进度条 */}
                  {cloudSpaceInfo && (
                    <div className="space-y-2 pt-2 border-t border-bd">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-text-3">交大云盘已用空间</span>
                        <span className="font-mono text-text-2 font-medium">
                          {formatBytes(Number(cloudSpaceInfo.size) || 0)} / {formatBytes(Number(cloudSpaceInfo.capacity) || 0)} · {cloudPercent}%
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
                  <div className="flex items-center justify-between text-xs text-text-3 pt-2 border-t border-bd">
                    <span>云盘保存目录：</span>
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
                        <span className="text-sm font-semibold text-text-1">账号安全加密防护</span>
                      </div>
                      <p className="text-xs text-text-3 mt-0.5">
                        账号密码采用系统安全芯片隔离存储，全程加密保护，杜绝明文暴露
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
                    <span className="rounded-xl border border-bd bg-surface-1 px-3 py-1.5 text-xs font-medium text-text-2 shadow-2xs">
                      已安全保存 <span className="font-mono font-bold text-accent">{credentials.length}</span> 个账号
                    </span>
                  </div>
                </div>

                {/* 凭据列表与操作区 */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-text-2">已保存的账号</span>
                    {credentials.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowClearModal(true)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-danger/30 bg-danger-bg px-2.5 py-1 text-xs font-medium text-danger hover:brightness-110 transition-all cursor-pointer shadow-2xs"
                      >
                        <span>清空已保存账号</span>
                      </button>
                    )}
                  </div>

                  {isLoadingCreds ? (
                    <div className="flex items-center justify-center py-8 text-xs text-text-3">
                      <span>正在加载账号...</span>
                    </div>
                  ) : credentials.length === 0 ? (
                    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-bd bg-surface-2/40 py-12 px-6 text-center space-y-3">
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-3 text-2xl">
                        🔐
                      </div>
                      <div className="space-y-1">
                        <div className="text-sm font-medium text-text-1">暂无已保存的账号</div>
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
                          className="rounded-2xl border border-bd bg-surface-2/60 p-4 shadow-2xs transition-all hover:border-bd-strong space-y-3"
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
                                title="删除此账号"
                              >
                                🗑️ 删除
                              </button>
                            </div>
                          </div>

                          {/* 内联编辑别名表单 */}
                          {editingId === cred.id && (
                            <div className="flex items-center gap-2 pt-2 border-t border-bd">
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
                          <div className="flex items-center gap-4 text-2xs text-text-4 pt-1 border-t border-bd">
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
                    className="fixed inset-0 z-[60] flex items-center justify-center p-4"
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
                          <h3 className="text-sm font-bold text-text-1">清空所有已保存账号</h3>
                          <p className="text-xs text-text-3 mt-0.5">此操作不可撤销</p>
                        </div>
                      </div>
                      <p className="text-xs text-text-2 leading-relaxed">
                        确定要清空所有已保存的账号吗？此操作将删除所有本地安全保存的 jAccount 账号与加密密码，清空后登录时将不再提供快捷填充。
                      </p>
                      <div className="flex items-center justify-end gap-2 pt-2 border-t border-bd">
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
                    className="fixed inset-0 z-[60] flex items-center justify-center p-4"
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
                          <h3 className="text-sm font-bold text-text-1">删除账号</h3>
                          <p className="text-xs text-text-3 mt-0.5 font-mono">账号: {credToDelete.username}</p>
                        </div>
                      </div>
                      <p className="text-xs text-text-2 leading-relaxed">
                        确定要删除已保存的账号「<strong className="text-text-1">{credToDelete.username}</strong>」
                        {credToDelete.label ? `（${credToDelete.label}）` : ''} 吗？删除后在登录页面将不再自动填充此账号。
                      </p>
                      <div className="flex items-center justify-end gap-2 pt-2 border-t border-bd">
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
  )
}
