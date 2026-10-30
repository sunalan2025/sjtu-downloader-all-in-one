import type { CloudOperationResult } from '@shared/cloud-drive'
import { Button } from '../../components/ui'
export function OperationResults({ results, onClear }: { results: CloudOperationResult[]; onClear: () => void }) {
  if (!results.length) return null
  const pending = results.filter(item => item.state === 'pending').length
  return (
    <details className="mx-4 mt-3 shrink-0 rounded-lg border border-bd p-3 text-xs" open={pending > 0 || undefined}>
      <summary className="cursor-pointer text-text-2">
        操作结果：完成 {results.filter(item => item.state === 'done').length} 项 · 处理中 {pending} 项 · 未完成{' '}
        {results.filter(item => item.state === 'error').length} 项
      </summary>
      <ul className="mt-2 max-h-36 space-y-2 overflow-auto">
        {results.map((item, index) => (
          <li key={index} className={`break-all ${item.state === 'error' ? 'text-danger' : 'text-text-2'}`}>
            {item.source.join('/')} → {item.destination.join('/')} ·{' '}
            {item.state === 'done' ? '完成' : item.state === 'pending' ? `服务器处理中（${item.taskId}）` : item.error}
          </li>
        ))}
      </ul>
      <Button className="mt-2" onClick={onClear}>
        清除已结束记录
      </Button>
    </details>
  )
}
