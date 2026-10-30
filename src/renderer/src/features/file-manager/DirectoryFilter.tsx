import type { FileKind } from './files'
import { SearchInput, DropdownSelect, type DropdownOption } from '../../components/widgets'

const fileKindOptions: DropdownOption<FileKind>[] = [
  { value: 'all', label: '全部类型' },
  { value: 'folder', label: '文件夹' },
  { value: 'document', label: '文档' },
  { value: 'video', label: '视频' },
  { value: 'audio', label: '音频' },
  { value: 'image', label: '图片' },
  { value: 'archive', label: '压缩包' },
  { value: 'other', label: '其他' }
]

export function DirectoryFilter({
  query,
  kind,
  onQuery,
  onKind
}: {
  query: string
  kind: FileKind
  onQuery: (value: string) => void
  onKind: (value: FileKind) => void
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <SearchInput
        aria-label="搜索当前目录"
        placeholder="搜索当前目录…"
        value={query}
        onChange={onQuery}
        className="h-9 w-44"
      />
      <DropdownSelect<FileKind>
        value={kind}
        options={fileKindOptions}
        onChange={onKind}
        title="文件类型筛选"
        size="md"
        buttonClassName="h-9"
      />
      {(query || kind !== 'all') && (
        <button
          type="button"
          onClick={() => {
            onQuery('')
            onKind('all')
          }}
          className="inline-flex h-9 items-center gap-1 rounded-xl border border-bd bg-surface-2 px-3 text-xs font-medium text-text-3 shadow-2xs transition-all hover:bg-surface-3 hover:text-text-1 hover:border-bd-strong cursor-pointer select-none"
          title="重置所有筛选条件"
        >
          <span>重置筛选</span>
        </button>
      )}
    </div>
  )
}
