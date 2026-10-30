export type FileKind = 'all' | 'folder' | 'document' | 'video' | 'audio' | 'image' | 'archive' | 'other'
export interface FileInfo {
  name: string
  path: string
  size?: number
  directory?: boolean
  modified?: string
  type?: string
}
export function fileKind(file: Pick<FileInfo, 'name' | 'directory' | 'type'>): Exclude<FileKind, 'all'> {
  if (file.directory) return 'folder'
  const ext = (file.type || file.name.split('.').pop() || '').toLowerCase()
  if (/^(mp4|mkv|mov|webm|flv|ts|video)$/.test(ext)) return 'video'
  if (/^(mp3|m4a|wav|flac|ogg|audio)$/.test(ext)) return 'audio'
  if (/^(png|jpg|jpeg|gif|webp|bmp|avif|svg)$/.test(ext)) return 'image'
  if (/^(pdf|docx?|xlsx?|pptx?|txt|md|csv|html?|rtf)$/.test(ext)) return 'document'
  if (/^(zip|rar|7z|tar|gz)$/.test(ext)) return 'archive'
  return 'other'
}
export function matchesFile(file: Pick<FileInfo, 'name' | 'directory' | 'type'>, query: string, kind: FileKind): boolean {
  return file.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) && (kind === 'all' || fileKind(file) === kind)
}
export function fileSummary(files: FileInfo[]) {
  const regular = files.filter(file => !file.directory)
  const known = regular.filter(file => typeof file.size === 'number' && Number.isFinite(file.size) && file.size >= 0)
  return {
    files: regular.length,
    folders: files.length - regular.length,
    knownBytes: known.reduce((sum, file) => sum + file.size!, 0),
    unknown: regular.length - known.length
  }
}
export async function copyFileText(text: string): Promise<void> {
  if (!navigator.clipboard?.writeText) throw new Error('当前环境无法访问剪贴板')
  await navigator.clipboard.writeText(text)
}
