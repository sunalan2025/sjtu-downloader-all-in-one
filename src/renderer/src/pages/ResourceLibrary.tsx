import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BackupCourse, BackupResult, BackupSnapshot, BackupSource, CourseSubscription, DownloadOptions } from '@shared/backup'
import { useAppStore } from '../store/app'
import { DropdownSelect, type DropdownOption } from '../components/DownloadUI'
import { pendingSubscriptionResources } from '@shared/backup'
import { PageHeader } from '../components/ui'

const sourceOptions: DropdownOption<BackupSource>[] = [
  { value: 'canvas', label: 'Canvas' },
  { value: 'cnmooc', label: '好大学在线' },
  { value: 'audited', label: '旁听课程' }
]

const perspectiveOptions: DropdownOption<'teacher' | 'ppt' | 'all'>[] = [
  { value: 'teacher', label: '教师视角' },
  { value: 'ppt', label: 'PPT 视角' },
  { value: 'all', label: '两个视角' }
]

const sources: Record<BackupSource, string> = { canvas: 'Canvas', cnmooc: '好大学在线', audited: '旁听课程' }
const empty: BackupSnapshot = { resources: [], recoverableTasks: [], subscriptions: [], busySubscriptionIds: [] }
const button = 'ui-button ui-button-secondary'

function currentOptions(): DownloadOptions {
  const s = useAppStore.getState()
  return {
    mode: s.downloadMode,
    localDestRoot: s.localDestRoot,
    cloudDestRoot: s.cloudDestRoot,
    namingTemplate: s.namingTemplate,
    conflictStrategy: 'skip',
    privateWorker: s.privateWorkerConfig
  }
}
function destination(options: DownloadOptions): string {
  const remote = options.privateWorker?.enabled
    ? options.privateWorker.storageMode === 'server_local'
      ? '远端服务器'
      : '云盘（通过中转）'
    : '交大云盘'
  return options.mode === 'both' ? `本机 + ${remote}` : options.mode === 'cloud' ? remote : '本机'
}
function destinationPaths(options: DownloadOptions): string {
  const paths: string[] = []
  if (options.mode !== 'cloud') paths.push(options.localDestRoot || '系统默认下载目录')
  if (options.mode !== 'local')
    paths.push(
      options.privateWorker?.enabled && options.privateWorker.storageMode === 'server_local'
        ? `${options.privateWorker.endpointUrl} → ${options.privateWorker.serverDownloadDir || '~/downloads'}`
        : `云盘 /${options.cloudDestRoot || ''}`
    )
  return paths.join(' · ')
}
function time(value?: number): string {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '尚未检查'
}

export function ResourceLibrary() {
  const [data, setData] = useState<BackupSnapshot>(empty)
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null)
  const [working, setWorking] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string>()
  const [formEnabled, setFormEnabled] = useState(true)
  const [source, setSource] = useState<BackupSource>('canvas')
  const [courses, setCourses] = useState<BackupCourse[]>([])
  const [courseId, setCourseId] = useState('')
  const courseOptions = useMemo<DropdownOption<string>[]>(
    () =>
      courses.map(c => ({
        value: c.id,
        label: `${c.term ? `${c.term} · ` : ''}${c.name}`
      })),
    [courses]
  )
  const [files, setFiles] = useState(true)
  const [videos, setVideos] = useState(false)
  const [perspective, setPerspective] = useState<'teacher' | 'ppt' | 'all'>('teacher')
  const mounted = useRef(true)
  const latestRequest = useRef(0)
  const refresh = useCallback(async () => {
    const request = ++latestRequest.current
    try {
      const snapshot = await window.api.backup.snapshot('library')
      if (!Array.isArray(snapshot.resources)) throw Error((snapshot as unknown as BackupResult).error || '资源库读取失败')
      if (mounted.current && request === latestRequest.current) setData(snapshot)
    } catch (error) {
      if (mounted.current) setNotice({ error: true, text: error instanceof Error ? error.message : '资源库读取失败' })
    }
  }, [])
  useEffect(() => {
    mounted.current = true
    void refresh()
    const unsubscribe = window.api.backup.onChanged(() => {
      void refresh()
    })
    return () => {
      mounted.current = false
      unsubscribe()
    }
  }, [refresh])
  const run = async (action: () => Promise<BackupResult>, success: string): Promise<void> => {
    setWorking(true)
    setNotice(null)
    try {
      const result = await action()
      if (!result.ok) throw Error(result.error || '操作未完成')
      if (mounted.current) setNotice({ error: false, text: `${success}${result.count !== undefined ? `（${result.count} 项）` : ''}` })
      await refresh()
    } catch (error) {
      if (mounted.current) setNotice({ error: true, text: error instanceof Error ? error.message : '操作失败' })
    } finally {
      if (mounted.current) setWorking(false)
    }
  }
  const loadCourses = (): void => {
    void run(async () => {
      const result = await window.api.backup.courses(source)
      if (result.ok && mounted.current) {
        setCourses(result.courses || [])
        setCourseId(result.courses?.[0]?.id || '')
      }
      return result
    }, '课程列表已更新')
  }
  const save = (): void => {
    const course = courses.find(c => c.id === courseId)
    if (!course) return
    void run(async () => {
      const result = await window.api.backup.saveSubscription({
        id: editingId,
        course,
        selection: { files, videos, perspective },
        options: currentOptions(),
        enabled: formEnabled,
        autoDownload: false,
        intervalMinutes: 30
      })
      if (result.ok && mounted.current) {
        setShowForm(false)
        setEditingId(undefined)
      }
      return result
    }, '收藏已保存，可立即检查课程变化')
  }
  const update = (subscription: CourseSubscription, change: Partial<Pick<CourseSubscription, 'enabled'>>): void => {
    void run(() => window.api.backup.saveSubscription({ ...subscription, ...change }), '订阅设置已保存')
  }
  return (
    <div className="ui-page">
      <PageHeader title="资源库" description="收藏课程，及时发现尚未下载的新文件和新版本。" actions={
          <button
            type="button"
            className={`${button} border-accent bg-accent text-white hover:brightness-110`}
            onClick={() => {
              setEditingId(undefined)
              setFormEnabled(true)
              setShowForm(v => !v)
            }}
            aria-expanded={showForm}
            aria-controls="subscription-form"
          >
            {showForm ? '收起订阅设置' : '+ 收藏课程'}
          </button>
      } />
      <div className="ui-content">
        {data.storageError && (
          <div role="alert" className="mb-4 rounded-xl border border-danger bg-danger-bg p-4 text-sm text-danger">
            {data.storageError}
          </div>
        )}
        {notice && (
          <div
            role={notice.error ? 'alert' : 'status'}
            className={`mb-4 rounded-xl border border-bd p-3 text-sm ${notice.error ? 'bg-danger-bg text-danger' : 'bg-surface-2 text-text-1'}`}
          >
            {notice.text}
          </div>
        )}
        {showForm && (
          <form
            id="subscription-form"
            className="mb-6 rounded-xl border border-bd bg-surface-2 p-5"
            onSubmit={e => {
              e.preventDefault()
              save()
            }}
          >
            <h2 className="font-semibold">{editingId ? '调整收藏课程' : '添加收藏课程'}</h2>
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-2 text-sm">
                <span>课程来源</span>
                <DropdownSelect<BackupSource>
                  value={source}
                  onChange={next => {
                    setSource(next)
                    setCourses([])
                    setCourseId('')
                    setFiles(next !== 'audited')
                    setVideos(next === 'audited')
                  }}
                  options={sourceOptions}
                  disabled={working || !!editingId}
                  fullWidth
                />
              </div>
              <div className="flex items-end">
                <button type="button" className={button} disabled={working || !!editingId} onClick={loadCourses}>
                  {working ? '处理中…' : '读取可访问的课程'}
                </button>
              </div>
              <div className="flex flex-col gap-2 text-sm md:col-span-2">
                <span>课程</span>
                <DropdownSelect<string>
                  value={courseId}
                  onChange={setCourseId}
                  options={courseOptions}
                  placeholder={!courses.length ? '请先读取课程列表' : '请选择课程'}
                  disabled={!courses.length || !!editingId}
                  fullWidth
                />
              </div>
              <fieldset className="flex flex-wrap items-center gap-4 text-sm">
                <legend className="mb-2">关注内容</legend>
                {source !== 'audited' && (
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={files} onChange={e => setFiles(e.target.checked)} />
                    课件
                  </label>
                )}
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={videos} onChange={e => setVideos(e.target.checked)} />
                  视频
                </label>
                {videos && source !== 'cnmooc' && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-text-3">录播视角:</span>
                    <DropdownSelect<'teacher' | 'ppt' | 'all'>
                      value={perspective}
                      onChange={setPerspective}
                      options={perspectiveOptions}
                      size="sm"
                    />
                  </div>
                )}
              </fieldset>

            </div>

            <p className="mt-3 text-sm text-text-2">
              保存目标：{destination(currentOptions())}。保存时使用当前设置中的目录，之后固定此目标；不同版本单独保留。
            </p>
            <p className="mt-1 break-all text-xs text-text-2">{destinationPaths(currentOptions())}</p>
            <div className="mt-4 flex gap-2">
              <button type="submit" className={`${button} bg-accent text-white`} disabled={working || !courseId || (!files && !videos)}>
                保存收藏
              </button>
              <button type="button" className={button} onClick={() => useAppStore.getState().setActiveTab('settings')}>
                调整保存目录
              </button>
            </div>
          </form>
        )}
        {(
          <div className="space-y-4">
            {!data.subscriptions.length && (
              <div className="rounded-xl border border-dashed border-bd p-10 text-center">
                <h2 className="text-lg font-medium">让课程资料持续更新</h2>
                <p className="mt-2 text-sm text-text-2">添加课程后，先检查新增与更新，再一键补齐。下载后可在传输中心查看。</p>
                <button className={`${button} mt-5`} onClick={() => setShowForm(true)}>
                  收藏第一门课程
                </button>
              </div>
            )}
            {data.subscriptions.map(sub => {
              const blocked = working || data.busySubscriptionIds.includes(sub.id)
              const resources = data.resources.filter(
                r => r.course.key === sub.course.key && (!sub.lastCheckedAt || r.lastSeenAt >= sub.lastCheckedAt)
              )
              const pending = pendingSubscriptionResources(sub, resources)
              return (
                <article key={sub.id} className="ui-panel ui-reveal">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="font-semibold">{sub.course.name}</h2>
                      <p className="mt-1 text-sm text-text-2">
                        {sources[sub.course.source]} · {sub.course.term || '未标注学期'} · {destination(sub.options)}
                      </p>
                      <p className="mt-1 break-all text-xs text-text-2">{destinationPaths(sub.options)}</p>
                    </div>
                    <span
                      className={`rounded-full px-3 py-1 text-xs ${sub.enabled ? 'bg-accent/10 text-accent' : 'bg-surface-2 text-text-2'}`}
                    >
                      {data.busySubscriptionIds.includes(sub.id)
                        ? '检查中…'
                        : sub.enabled
                          ? `每 ${sub.intervalMinutes} 分钟检查`
                          : '已暂停订阅'}
                    </span>
                  </div>
                  <p className="mt-3 text-sm">
                    {pending.length ? `${pending.length} 项待下载更新` : sub.lastCheckedAt ? '已是最新，当前没有待下载更新' : '等待首次检查'}
                  </p>
                  <p className="mt-1 text-xs text-text-2">
                    上次检查：{time(sub.lastCheckedAt)}
                    {sub.enabled ? ` · 下次检查：${time(sub.nextCheckAt)}` : ''}
                  </p>
                  {!!pending.length && <details className="mt-3 rounded-xl bg-surface-2 p-3 text-sm"><summary className="cursor-pointer text-accent">查看待下载更新（{pending.length} 项）</summary><ul className="mt-3 max-h-64 space-y-2 overflow-y-auto ui-reveal">{pending.slice(0, 100).map(resource => <li key={resource.id} className="flex gap-3"><span className="min-w-0 flex-1 truncate" title={resource.spec.fileName}>{resource.spec.fileName}</span><span className="shrink-0 text-xs text-text-3">{resource.copies.length ? '版本更新' : '尚未下载'}</span></li>)}{pending.length > 100 && <li className="text-xs text-text-3">另有 {pending.length - 100} 项，可在课程页面查看。</li>}</ul></details>}
                  {sub.warning && <p className="mt-2 text-xs leading-relaxed text-text-2">{sub.warning}</p>}
                  {sub.lastError && (
                    <p className="mt-2 text-sm text-danger" role="status">
                      {sub.lastError}
                    </p>
                  )}
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button
                      className={button}
                      disabled={blocked}
                      onClick={() => {
                        void run(() => window.api.backup.checkSubscription(sub.id), '课程检查已完成')
                      }}
                    >
                      检查更新
                    </button>
                    <button
                      className={`${button} bg-accent text-white`}
                      disabled={blocked}
                      onClick={() => {
                        void run(() => window.api.backup.fillMissing(sub.id), '下载已提交，请到传输中心查看')
                      }}
                    >
                      下载待更新内容
                    </button>
                    <button className={button} disabled={blocked} onClick={() => update(sub, { enabled: !sub.enabled })}>
                      {sub.enabled ? '暂停订阅' : '启用订阅'}
                    </button>
                    <button
                      className={button}
                      disabled={blocked}
                      onClick={() => {
                        setEditingId(sub.id)
                        setFormEnabled(sub.enabled)
                        setSource(sub.course.source)
                        setCourses([sub.course])
                        setCourseId(sub.course.id)
                        setFiles(sub.selection.files)
                        setVideos(sub.selection.videos)
                        setPerspective(sub.selection.perspective)
                        setShowForm(true)
                      }}
                    >
                      调整收藏
                    </button>

                    <button
                      className={`${button} ml-auto`}
                      disabled={blocked}
                      onClick={() => {
                        void run(() => window.api.backup.removeSubscription(sub.id), '已取消收藏，已有文件和资源记录保留')
                      }}
                    >
                      取消收藏
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
