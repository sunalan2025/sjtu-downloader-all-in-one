import { useEffect, useState } from 'react'
import { formatBytes, formatDate } from '@shared/utils'
import { Button, Dialog } from '../../components/ui'
import { FileIcon, type FileSelection } from './FileViews'

export function PreviewDialog({
  file,
  onClose,
  onDownload,
  onWeb
}: {
  file: FileSelection
  onClose: () => void
  onDownload: () => void
  onWeb: () => void
}) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const ext = file.item.name.split('.').pop()?.toLowerCase() ?? ''
  const image = /^(png|jpg|jpeg|gif|webp|bmp|avif)$/.test(ext)
  const video = /^(mp4|webm|mov)$/.test(ext)
  const audio = /^(mp3|wav|m4a|ogg|flac)$/.test(ext)
  const previewable = image || video || audio
  useEffect(() => {
    let cancelled = false
    if (previewable)
      void window.api.cloudpan
        .getDownloadUrl([...file.parent, file.item.name])
        .then(res => {
          if (cancelled) return
          if (res.ok && res.url && /^https:\/\//i.test(res.url)) setUrl(res.url)
          else setError(res.error || '预览链接不可用')
        })
        .catch(err => {
          if (!cancelled) setError(err instanceof Error ? err.message : '预览失败')
        })
    return () => {
      cancelled = true
    }
  }, [file, previewable])
  return (
    <Dialog
      title="文件详情"
      onClose={onClose}
      actions={
        <>
          <Button onClick={onWeb}>网页端预览</Button>
          <Button variant="primary" onClick={onDownload}>
            下载文件
          </Button>
        </>
      }
    >
      <div className="flex min-w-0 items-center gap-3">
        <FileIcon item={file.item} />
        <h3 className="min-w-0 break-all font-medium">{file.item.name}</h3>
      </div>
      <dl className="grid grid-cols-[64px_minmax(0,1fr)] gap-3 text-sm">
        <dt className="text-text-3">位置</dt>
        <dd className="break-all">/{file.parent.join('/')}</dd>
        <dt className="text-text-3">大小</dt>
        <dd>{formatBytes(file.item.size ?? 0)}</dd>
        <dt className="text-text-3">修改时间</dt>
        <dd>{formatDate(file.item.modificationTime)}</dd>
      </dl>
      {error ? (
        <p role="alert" className="text-danger">
          {error}
        </p>
      ) : !previewable ? (
        <p className="text-sm text-text-3">此格式可下载查看，或在云盘网页端预览。</p>
      ) : !url ? (
        <p>正在加载预览…</p>
      ) : image ? (
        <img
          src={url}
          alt={file.item.name}
          className="max-h-80 w-full rounded-lg object-contain"
          onError={() => setError('图片预览失败，请下载查看')}
        />
      ) : video ? (
        <video src={url} controls preload="metadata" className="max-h-80 w-full" onError={() => setError('视频格式无法预览，请下载查看')} />
      ) : (
        <audio src={url} controls preload="metadata" className="w-full" onError={() => setError('音频格式无法预览，请下载查看')} />
      )}
    </Dialog>
  )
}
