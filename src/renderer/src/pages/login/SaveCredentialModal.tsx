import React from 'react'

export interface SaveCredentialModalProps {
  pendingSaveCred: {
    username: string
    password: string
    defaultLabel?: string
  }
  customLabel: string
  setCustomLabel: (v: string) => void
  isSavingCred: boolean
  onConfirm: () => void
  onSkip: () => void
}

export function SaveCredentialModal({
  pendingSaveCred,
  customLabel,
  setCustomLabel,
  isSavingCred,
  onConfirm,
  onSkip
}: SaveCredentialModalProps) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border border-bd bg-surface-1 p-6 shadow-2xl space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-lg text-accent">
            🔐
          </div>
          <div>
            <h3 className="text-base font-semibold text-text-1">记住此账号密码？</h3>
            <p className="text-xs text-text-3">下次登录将自动为您填好，安全便捷</p>
          </div>
        </div>

        <div className="rounded-xl border border-bd bg-surface-2 p-3 space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-text-3">登录账号</span>
            <span className="font-mono font-medium text-text-1">{pendingSaveCred.username}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-text-3">密码保护</span>
            <span className="font-medium text-emerald-500">🛡️ 系统硬件级加密保护</span>
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-text-2">
            账号备注别名 <span className="font-normal text-text-3">(可选)</span>
          </label>
          <input
            type="text"
            value={customLabel}
            onChange={e => setCustomLabel(e.target.value)}
            placeholder="例如：本科账号、研究生账号、科研账号"
            maxLength={30}
            autoFocus
            onKeyDown={e => {
              if (e.key === 'Enter') void onConfirm()
              if (e.key === 'Escape') onSkip()
            }}
            className="w-full rounded-xl border border-bd bg-surface-2 px-3 py-2 text-xs text-text-1 placeholder:text-text-4 outline-none transition-all focus:border-accent focus:ring-2 focus:ring-accent/15"
          />
        </div>

        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            disabled={isSavingCred}
            onClick={onSkip}
            className="flex-1 rounded-xl border border-bd bg-surface-2 py-2 text-xs font-medium text-text-2 transition hover:bg-surface-3 disabled:opacity-50"
          >
            暂不保存
          </button>
          <button
            type="button"
            disabled={isSavingCred}
            onClick={onConfirm}
            className="flex-1 rounded-xl bg-accent py-2 text-xs font-medium text-white shadow-sm transition hover:bg-accent-hover disabled:opacity-50"
          >
            {isSavingCred ? '正在保存…' : '记住此账号'}
          </button>
        </div>
      </div>
    </div>
  )
}
