import type { DownloadMode } from '@shared/types'

/** An empty preference means the system Downloads folder, as shown in Settings. */
export async function resolveLocalDestination(mode: DownloadMode, preference: string): Promise<string> {
  if (mode === 'cloud') return ''
  if (preference.trim()) return preference
  const directory = await window.api.getDefaultDownloadsDir()
  if (!directory?.trim()) throw new Error('无法获取系统下载目录，请在设置中选择本地目录')
  return directory
}
