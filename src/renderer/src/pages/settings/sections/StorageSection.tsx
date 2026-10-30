import { useAppStore } from '../../../store/app'
import { Segmented } from '../../../components/Segmented'
import type { DownloadMode } from '@shared/types'
import {
  formatPathFromTemplate,
  CLOUD_DEST_PRESETS,
  formatCloudBreadcrumb,
  normalizeCloudPath
} from '../../../../../shared/utils'

export interface StorageSectionProps {
  handleSelectFolder: () => Promise<void>
  resolvedLocalPath: string
  isDefaultLocalPath: boolean
  isCustomTemplate: boolean
  setIsCustomTemplate: (val: boolean) => void
}

export function StorageSection({
  handleSelectFolder,
  resolvedLocalPath,
  isDefaultLocalPath,
  isCustomTemplate,
  setIsCustomTemplate
}: StorageSectionProps) {
  const downloadMode = useAppStore(s => s.downloadMode)
  const setDownloadMode = useAppStore(s => s.setDownloadMode)
  const fileConflictStrategy = useAppStore(s => s.fileConflictStrategy)
  const setFileConflictStrategy = useAppStore(s => s.setFileConflictStrategy)
  const namingTemplate = useAppStore(s => s.namingTemplate)
  const setNamingTemplate = useAppStore(s => s.setNamingTemplate)
  const cloudDestRoot = useAppStore(s => s.cloudDestRoot)
  const setCloudDestRoot = useAppStore(s => s.setCloudDestRoot)

  return (
              <section className="space-y-6">
                <div>
                  <h2 className="text-base font-bold text-text-1">存储与下载</h2>
                  <p className="mt-1 text-xs text-text-3">自定义课件与视频的存储策略、保存位置及同名冲突处理</p>
                </div>

                <div className="divide-y divide-bd border-t border-bd">
                  {/* 行 1：存储目标模式 */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-5">
                    <div className="space-y-1 max-w-sm">
                      <div className="text-sm font-medium text-text-1">存储目标模式</div>
                      <div className="text-xs text-text-3 leading-relaxed">
                        {downloadMode === 'local' && '仅存放在本地磁盘指定目录中'}
                        {downloadMode === 'cloud' && '直接分片直传至交大云盘，不占本地硬盘空间'}
                        {downloadMode === 'both' && '本地保存一份，同时自动上传备份至交大云盘'}
                      </div>
                    </div>
                    <div className="shrink-0">
                      <Segmented
                        size="md"
                        value={downloadMode}
                        onChange={(v) => setDownloadMode(v as DownloadMode)}
                        options={[
                          { key: 'local', label: '本地' },
                          { key: 'cloud', label: '交大云盘' },
                          { key: 'both', label: '双备份' }
                        ]}
                      />
                    </div>
                  </div>

                  {/* 行 2：本地保存目录 */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-5">
                    <div className="space-y-1 min-w-0 flex-1 pr-4">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-text-1">本地保存目录</span>
                        {isDefaultLocalPath && resolvedLocalPath && (
                          <span className="rounded-md bg-accent/10 text-accent px-1.5 py-0.5 text-3xs font-semibold border border-accent/20">
                            系统默认
                          </span>
                        )}
                      </div>
                      <div className="truncate font-mono text-xs text-text-3" title={resolvedLocalPath || '系统默认下载目录'}>
                        {resolvedLocalPath || '系统默认下载目录'}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={handleSelectFolder}
                        className="rounded-lg border border-bd bg-surface-2 px-3 py-1.5 text-xs font-medium text-text-2 transition-all hover:bg-surface-3 hover:text-text-1 cursor-pointer shadow-2xs"
                      >
                        更改路径…
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          if (window.api?.openPath) {
                            await window.api.openPath(resolvedLocalPath)
                          }
                        }}
                        className="rounded-lg border border-bd bg-surface-2 px-3 py-1.5 text-xs font-medium text-text-2 transition-all hover:bg-surface-3 hover:text-text-1 cursor-pointer shadow-2xs"
                        title="在系统文件管理器中打开保存主目录"
                      >
                        打开所在目录 ↗
                      </button>
                    </div>
                  </div>

                  {/* 行：交大云盘保存目录 */}
                  <div className="py-5 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                      <div className="space-y-1 max-w-sm">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-text-1">交大云盘保存目录</span>
                          {cloudDestRoot === '/SJTU课程备份' && (
                            <span className="rounded-md bg-accent/10 text-accent px-1.5 py-0.5 text-3xs font-semibold border border-accent/20">
                              默认预设
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-text-3 leading-relaxed">
                          云盘直传或双备份模式下，教学资源在交大云盘个人空间中归档存放的顶层目录
                        </div>
                      </div>
                      {/* 快捷切换胶囊 */}
                      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                        {CLOUD_DEST_PRESETS.map(preset => {
                          const isSelected = (cloudDestRoot || '/SJTU课程备份') === preset.value
                          return (
                            <button
                              key={preset.value}
                              type="button"
                              onClick={() => setCloudDestRoot(preset.value)}
                              className={`rounded-full px-2.5 py-1 text-xs font-medium transition-all cursor-pointer ${
                                isSelected
                                  ? 'bg-accent text-white shadow-2xs font-semibold'
                                  : 'bg-surface-2 border border-bd text-text-3 hover:text-text-1 hover:border-bd-strong hover:bg-surface-3'
                              }`}
                            >
                              {preset.label}
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    {/* 自定义路径输入与动态路径层级面包屑预览 */}
                    <div className="rounded-xl border border-bd bg-surface-2/50 p-3 space-y-2.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-text-3 shrink-0">自定义路径：</span>
                        <input
                          type="text"
                          value={cloudDestRoot}
                          onChange={e => setCloudDestRoot(e.target.value)}
                          onBlur={() => setCloudDestRoot(normalizeCloudPath(cloudDestRoot))}
                          placeholder="/SJTU课程备份"
                          className="flex-1 rounded-xl border border-bd bg-surface-1 px-3 py-1.5 text-xs font-mono text-text-1 placeholder:text-text-4 outline-none focus:border-accent focus:ring-2 focus:ring-accent/15 transition-all"
                        />
                        {cloudDestRoot !== '/SJTU课程备份' && (
                          <button
                            type="button"
                            onClick={() => setCloudDestRoot('/SJTU课程备份')}
                            className="text-2xs text-text-3 hover:text-accent cursor-pointer"
                          >
                            恢复默认
                          </button>
                        )}
                      </div>
                      <div className="text-2xs text-text-3 flex items-center gap-1.5 font-mono">
                        <span className="text-accent select-none font-sans font-medium">☁️ 路径层级实时预览：</span>
                        <span className="truncate text-text-2 font-mono" title={formatCloudBreadcrumb(cloudDestRoot)}>
                          {formatCloudBreadcrumb(cloudDestRoot)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* 行 3：文件归档路径模板 */}
                  <div className="py-5 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="space-y-1 max-w-sm">
                        <div className="text-sm font-medium text-text-1">文件归档与目录结构</div>
                        <div className="text-xs text-text-3 leading-relaxed">
                          自定义下载文件在本地磁盘与交大云盘中的多级目录组织结构
                        </div>
                      </div>
                      <div className="shrink-0">
                        <Segmented
                          size="md"
                          value={
                            isCustomTemplate
                              ? 'custom'
                              : namingTemplate === '{term}/{course}/{category}/{fileName}'
                                ? 'full'
                                : namingTemplate === '{course}/{category}/{fileName}'
                                  ? 'course_cat'
                                  : namingTemplate === '{course}/{fileName}'
                                    ? 'flat'
                                    : 'custom'
                          }
                          onChange={(v) => {
                            if (v === 'full') {
                              setNamingTemplate('{term}/{course}/{category}/{fileName}')
                              setIsCustomTemplate(false)
                            } else if (v === 'course_cat') {
                              setNamingTemplate('{course}/{category}/{fileName}')
                              setIsCustomTemplate(false)
                            } else if (v === 'flat') {
                              setNamingTemplate('{course}/{fileName}')
                              setIsCustomTemplate(false)
                            } else {
                              setIsCustomTemplate(true)
                            }
                          }}
                          options={[
                            { key: 'full', label: '学期/课程/分类' },
                            { key: 'course_cat', label: '课程/分类' },
                            { key: 'flat', label: '紧凑扁平' },
                            { key: 'custom', label: '自定义…' }
                          ]}
                        />
                      </div>
                    </div>

                    {/* 自定义模板输入与动态路径效果预览 */}
                    <div className="rounded-xl border border-bd bg-surface-2/50 p-3 space-y-2.5">
                      {isCustomTemplate && (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-text-3 shrink-0">自定义结构：</span>
                            <input
                              type="text"
                              value={namingTemplate}
                              onChange={e => setNamingTemplate(e.target.value)}
                              placeholder="{term}/{course}/{category}/{fileName}"
                              className="flex-1 rounded-xl border border-bd bg-surface-1 px-3 py-1.5 text-xs font-mono text-text-1 placeholder:text-text-4 outline-none focus:border-accent focus:ring-2 focus:ring-accent/15 transition-all"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                setNamingTemplate('{term}/{course}/{category}/{fileName}')
                                setIsCustomTemplate(false)
                              }}
                              className="text-2xs text-text-3 hover:text-accent cursor-pointer"
                            >
                              恢复默认
                            </button>
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 text-2xs text-text-4">
                            <span>可用占位符：</span>
                            {['{term}', '{course}', '{category}', '{fileName}'].map(tag => (
                              <button
                                key={tag}
                                type="button"
                                onClick={() => {
                                  if (!namingTemplate.includes(tag)) {
                                    setNamingTemplate(namingTemplate ? `${namingTemplate}/${tag}` : tag)
                                  }
                                }}
                                className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-accent hover:bg-surface-4 transition-colors cursor-pointer"
                              >
                                {tag}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="text-2xs text-text-3 flex items-center gap-1.5 font-mono">
                        <span className="text-accent select-none font-sans font-medium">📂 路径效果预览：</span>
                        <span className="truncate text-text-2">
                          {formatPathFromTemplate(namingTemplate || '{term}/{course}/{category}/{fileName}', {
                            term: '2025-2026-1',
                            course: '程序设计思想与方法',
                            category: '课件资料',
                            fileName: '第1章_程序设计导论.pdf'
                          })}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* 行 4：同名冲突 */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-5">
                    <div className="space-y-1 max-w-sm">
                      <div className="text-sm font-medium text-text-1">同名文件冲突策略</div>
                      <div className="text-xs text-text-3 leading-relaxed">
                        {fileConflictStrategy === 'skip' ? '目标位置已存在同名且大小一致的文件时自动跳过' : '始终重新下载并覆盖旧版文件'}
                      </div>
                    </div>
                    <div className="shrink-0">
                      <Segmented
                        size="md"
                        value={fileConflictStrategy}
                        onChange={(v) => setFileConflictStrategy(v as any)}
                        options={[
                          { key: 'skip', label: '智能跳过' },
                          { key: 'overwrite', label: '覆盖更新' }
                        ]}
                      />
                    </div>
                  </div>
                </div>
              </section>
  )
}
