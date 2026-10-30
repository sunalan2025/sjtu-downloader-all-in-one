import { Button, Dialog } from '../../components/ui'
import { formatBytes } from '@shared/utils'
import { fileSummary, type FileInfo } from './files'

export function PropertiesDialog({ files, onClose }: { files: FileInfo[]; onClose: () => void }) {
  const summary = fileSummary(files)
  return (
    <Dialog title="所选项目属性" onClose={onClose} actions={<Button onClick={onClose}>关闭</Button>}>
      <dl className="grid grid-cols-[80px_minmax(0,1fr)] gap-3 text-sm">
        <dt className="text-text-3">项目</dt>
        <dd>
          {files.length} 项 · {summary.files} 个文件 · {summary.folders} 个文件夹
        </dd>
        <dt className="text-text-3">已知大小</dt>
        <dd>
          {formatBytes(summary.knownBytes)}
          {summary.unknown > 0 && ` · ${summary.unknown} 个文件大小未知`}
        </dd>
      </dl>
      {summary.folders > 0 && <p className="text-xs text-text-3">文件夹内部大小未统计，不会为此扫描子目录。</p>}
      <div className="max-h-64 space-y-3 overflow-auto">
        {files.slice(0, 50).map((file, index) => (
          <div key={`${file.path}:${index}`} className="rounded-lg border border-bd p-3">
            <p className="break-all text-sm font-medium">{file.name}</p>
            <p className="mt-1 break-all text-xs text-text-3">{file.path}</p>
            {file.modified && <p className="mt-1 text-xs text-text-3">修改时间：{file.modified}</p>}
          </div>
        ))}
        {files.length > 50 && <p className="text-xs text-text-3">仅展示前 50 项位置，统计包含全部所选项目。</p>}
      </div>
    </Dialog>
  )
}
