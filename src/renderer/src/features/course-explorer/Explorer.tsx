import { useToast } from '../../hooks/useToast'
import { Toast } from '../../components/Toast'
import { memo, useMemo, useEffect, useRef, useState, useCallback } from 'react'
import { useShallow } from 'zustand/shallow'
import { BreadcrumbBar, type BreadcrumbItem } from '../../components/BreadcrumbBar'
import { FolderIcon, NetdiskViewModeSwitch, DropdownSelect, type DropdownOption } from '../../components/DownloadUI'
import { useAppStore } from '../../store/app'
import { estimateResourceSize, getDownloadActionLabels } from '@shared/utils'
import { FloatingCommandIsland, type VideoPerspective, type CategorySelectionState } from '../../components/FloatingCommandIsland'
import { computeBatchStats } from '../../download/progress'
import { NetdiskCourseExplorerProps, resolveCategoryChipKey, type NetdiskFileItem } from './model'
import { FileDetailInspector } from './Inspectors'
import { Dialog } from '../../components/ui'
import { CategoryIcon } from './shared'
import { ColumnView } from './ColumnView'
import { ListView } from './ListView'
import { GridView } from './GridView'
import { useVisibleCourses } from './useVisibleCourses'
import { CourseMenuContext, type CourseMenuEntry } from './Selection'
import type { MenuAction } from '../file-manager/ContextMenu'
import { copyFileText, matchesFile, type FileInfo, type FileKind } from '../file-manager/files'
import { DirectoryFilter } from '../file-manager/DirectoryFilter'
import { PropertiesDialog } from '../file-manager/PropertiesDialog'
import { useNavigationHistory } from '../file-manager/useNavigationHistory'

const sortOptions: DropdownOption<string>[] = [
  { value: 'name', label: '按名称' },
  { value: 'size', label: '按大小' },
  { value: 'modified', label: '按日期' }
]

// ─────────────────────────────────────────────────────────────
// NetdiskCourseExplorer Component
// ─────────────────────────────────────────────────────────────

export const NetdiskCourseExplorer = memo(function NetdiskCourseExplorer({
  courses: sourceCourses,
  viewMode,
  navState,
  onNavigate: navigateTo,
  emptyPlaceholder,
  groupByTerm = true,
  onDownloadSingle,
  onDownloadCourse,
  onStartDownload,
  perspective,
  onPerspectiveChange,
  hasPptPdf,
  onTogglePptPdf,
  downloadMode: _downloadMode,
  onViewModeChange,
  hideCategoryChips
}: NetdiskCourseExplorerProps) {
  const [detailFile, setDetailFile] = useState<NetdiskFileItem | null>(null)
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<FileKind>('all')
  const [sort, setSort] = useState('name')
  const [descending, setDescending] = useState(false)
  const [properties, setProperties] = useState<FileInfo[] | null>(null)
  const courses = useMemo(() => sourceCourses.map(course => ({ ...course, categories: course.categories.map(category => {
    if (String(course.id) !== String(navState.courseId) || category.id !== navState.categoryId) return category
    return { ...category, items: category.items.filter(item => matchesFile(item, query, kind)).sort((a, b) => {
      const difference = sort === 'size' ? (a.size ?? 0) - (b.size ?? 0) : sort === 'modified' ? (Date.parse(a.date ?? '') || 0) - (Date.parse(b.date ?? '') || 0) : a.name.localeCompare(b.name, 'zh-CN', { numeric: true })
      return (difference || a.name.localeCompare(b.name, 'zh-CN', { numeric: true })) * (descending ? -1 : 1)
    }) }
  }) })), [sourceCourses, navState.courseId, navState.categoryId, query, kind, sort, descending])
  const viewportRef = useVisibleCourses(courses, `${viewMode}:${navState.level}:${navState.courseId ?? ''}:${groupByTerm}`)
  const onNavigate: NetdiskCourseExplorerProps['onNavigate'] = next => {
    setDetailFile(null)
    setQuery('')
    setKind('all')
    navigateTo(next)
  }
  const history = useNavigationHistory(navState, onNavigate, JSON.stringify(sourceCourses.map(course => course.id)))
  const filterChanged = () => {
    setDetailFile(null)
  }
  const storeDownloadMode = useAppStore(s => s.downloadMode)
  const effectiveStoreMode = typeof useAppStore.getState === 'function' ? useAppStore.getState().downloadMode : storeDownloadMode
  const currentDownloadMode = _downloadMode ?? effectiveStoreMode ?? storeDownloadMode ?? 'local'
  // 当前处于的课程对象
  const currentCourse = useMemo(() => {
    if (!navState?.courseId) return undefined
    return courses.find(c => String(c.id) === String(navState.courseId))
  }, [courses, navState?.courseId])

  // 当前处于的分类对象
  const currentCategory = useMemo(() => {
    if (!currentCourse || !navState.categoryId) return undefined
    return currentCourse.categories.find(cat => cat.id === navState.categoryId)
  }, [currentCourse, navState.categoryId])

  // 在 Column 分栏视图下，当前活跃选中的课程与分类（严格单层步进，未点击时不默认预选 courses[0]）
  const columnActiveCourse = useMemo(() => {
    return currentCourse
  }, [currentCourse])

  const columnActiveCategory = useMemo(() => {
    if (!columnActiveCourse || !navState.categoryId) return undefined
    return columnActiveCourse.categories.find(cat => cat.id === navState.categoryId)
  }, [columnActiveCourse, navState.categoryId])

  const globalPerspective = useAppStore(s => s.videoPerspectivePreference)
  const globalVideoQuality = useAppStore(s => s.videoQualityOption)
  const isAudioOnly = globalVideoQuality === 'audio_only' || globalPerspective === 'audio'

  const [sharedPerspective, setSharedPerspective] = useState<VideoPerspective>('teacher')
  const lastEnteredCourseIdRef = useRef<number | string | null>(null)

  // Column 模式下仅在选中的课程 ID 变化时触发进入加载（阻断每帧重新触发的死循环）
  useEffect(() => {
    if (viewMode === 'column' && columnActiveCourse?.id) {
      if (lastEnteredCourseIdRef.current !== columnActiveCourse.id) {
        lastEnteredCourseIdRef.current = columnActiveCourse.id
        columnActiveCourse.onEnter?.()
      }
    } else if (viewMode !== 'column') {
      lastEnteredCourseIdRef.current = null
    }
  }, [viewMode, columnActiveCourse])

  // 构造面包屑项目
  const breadcrumbItems = useMemo<BreadcrumbItem[]>(() => {
    const items: BreadcrumbItem[] = [
      {
        id: 'root',
        label: '全部课程',
        icon: (
          <svg className="h-3.5 w-3.5 text-accent" viewBox="0 0 24 24" fill="currentColor">
            <path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H8V4h12v12z" />
          </svg>
        )
      }
    ]

    const targetCourse = viewMode === 'column' ? columnActiveCourse : currentCourse
    const targetCategory = viewMode === 'column' ? columnActiveCategory : currentCategory

    if (targetCourse) {
      items.push({
        id: 'course',
        label: targetCourse.name,
        icon: <FolderIcon className="h-3.5 w-3.5 text-amber-500" />
      })
    }

    if (targetCategory && (viewMode === 'column' || navState.level === 'category')) {
      items.push({
        id: 'category',
        label: targetCategory.name,
        icon: (
          <span className="scale-75 origin-center inline-block">
            <CategoryIcon icon={targetCategory.icon} />
          </span>
        )
      })
    }

    return items
  }, [viewMode, columnActiveCourse, currentCourse, columnActiveCategory, currentCategory, navState.level])

  const handleBreadcrumbNavigate = (id: string) => {
    if (id === 'root') {
      onNavigate({ level: 'root' })
    } else if (id === 'course') {
      const courseId = (viewMode === 'column' ? columnActiveCourse?.id : currentCourse?.id) ?? navState.courseId
      onNavigate({ level: 'course', courseId })
    }
  }

  // 统计信息文本
  const statsLabel = useMemo(() => {
    if (viewMode === 'column') {
      if (!columnActiveCourse) return `共 ${courses.length} 门课程`
      if (!columnActiveCategory) return `${columnActiveCourse.categories.length} 个分类`
      const unit = columnActiveCategory.itemUnit || (columnActiveCategory.chipKey === 'videos' ? '讲视频' : columnActiveCategory.chipKey === 'assignments' ? '项作业' : '个文件')
      return `${columnActiveCategory.items.length} ${unit}`
    }
    if (navState.level === 'root') {
      return `共 ${courses.length} 门课程`
    }
    if (navState.level === 'course' && currentCourse) {
      return `${currentCourse.categories.length} 个分类${!currentCourse.isLoading && currentCourse.itemCount > 0 ? ` · ${currentCourse.itemCount} 项资源` : ''}`
    }
    if (navState.level === 'category' && currentCategory) {
      const unit = currentCategory.itemUnit || (currentCategory.chipKey === 'videos' ? '讲视频' : currentCategory.chipKey === 'assignments' ? '项作业' : '个文件')
      return `共 ${currentCategory.items.length} ${unit}`
    }
    return ''
  }, [viewMode, columnActiveCourse, columnActiveCategory, courses.length, navState.level, currentCourse, currentCategory])

  // 全局 Toast 提示状态（统一收口至 useToast）
  const { toast, showToast, hideToast } = useToast(2500)

  const isSingleCourse = navState.level !== 'root' && !!currentCourse

  // 动作岛统计汇总与体积估算
  const selectedStats = useMemo(() => {
    let courseCount = 0
    let categoryCount = 0
    let totalItems = 0
    let filesCount = 0
    let videoCount = 0
    let assignCount = 0
    let pptCount = 0
    let fileBytes = 0

    // 统计选中课程数
    for (const c of courses) {
      if (c.state === 'all' || c.state === 'some') {
        courseCount++
      }
    }

    // 统计当前课程内选中的分类数
    if (currentCourse) {
      for (const cat of currentCourse.categories) {
        if (cat.state === 'all' || cat.state === 'some') {
          categoryCount++
        }
      }
    }

    const relevantCourses = isSingleCourse ? [currentCourse!] : courses
    for (const c of relevantCourses) {
      for (const cat of c.categories) {
        const chipKey = resolveCategoryChipKey(cat)

        for (const item of cat.items) {
          if (item.selected) {
            totalItems++
            if (chipKey === 'files') {
              filesCount++
              fileBytes += item.size || 0
            } else if (chipKey === 'videos') {
              videoCount++
            } else if (chipKey === 'assignments') {
              assignCount++
            } else if (chipKey === 'pptPdf') {
              pptCount++
            }
          }
        }

        // 未展开/未扫描分类兜底：若勾选了该分类但尚未拉取具体 items，计入 1 项
        if (cat.items.length === 0 && (cat.state === 'all' || cat.state === 'some')) {
          totalItems++
          if (chipKey === 'files') filesCount++
          else if (chipKey === 'videos') videoCount++
          else if (chipKey === 'assignments') assignCount++
          else if (chipKey === 'pptPdf') pptCount++
        }
      }

      // 未扫描课程兜底
      if (c.categories.length === 0 && (c.state === 'all' || c.state === 'some')) {
        totalItems += c.itemCount || 1
        fileBytes += c.totalBytes || 0
        filesCount += c.itemCount || 1
      }
    }

    const effectivePerspective: VideoPerspective = isAudioOnly
      ? 'audio'
      : (perspective ?? currentCourse?.perspective ?? globalPerspective ?? 'teacher')

    const estimated = estimateResourceSize({
      fileBytes,
      videoCount,
      perspective: effectivePerspective,
      hasAssignments: assignCount > 0,
      assignmentCount: assignCount,
      hasPptPdf: pptCount > 0,
      pptPdfCount: pptCount
    })

    return {
      courseCount,
      categoryCount,
      totalItems,
      formattedSize: estimated.formattedSize,
      totalBytes: estimated.totalBytes,
      filesCount,
      videoCount,
      assignCount,
      pptCount,
      isSingleCourse,
      effectivePerspective
    }
  }, [courses, isSingleCourse, currentCourse, perspective, isAudioOnly, globalPerspective])

  // 动作岛分类过滤芯片勾选状态（根视图下严格收口至当前已勾选的课程）
  const categorySelectionState = useMemo<CategorySelectionState>(() => {
    const targetCourses = isSingleCourse
      ? (currentCourse ? [currentCourse] : [])
      : courses.filter(c => c.state !== 'none')
    let hasFiles = false
    let hasVideos = false
    let hasAssignments = false
    let hasPptPdf = false

    for (const c of targetCourses) {
      for (const cat of c.categories) {
        if (cat.state !== 'none') {
          const chipKey = resolveCategoryChipKey(cat)
          if (chipKey === 'files') hasFiles = true
          else if (chipKey === 'videos') hasVideos = true
          else if (chipKey === 'assignments') hasAssignments = true
          else if (chipKey === 'pptPdf') hasPptPdf = true
        }
      }
    }

    return {
      files: hasFiles,
      videos: hasVideos,
      assignments: hasAssignments,
      pptPdf: hasPptPdf
    }
  }, [courses, isSingleCourse, currentCourse])

  const handleToggleIslandCategory = useCallback(
    (catKey: 'files' | 'videos' | 'assignments' | 'pptPdf') => {
      const targetCourses = isSingleCourse
        ? (currentCourse ? [currentCourse] : [])
        : courses.filter(c => c.state !== 'none')
      if (targetCourses.length === 0) return

      const nextOn = !categorySelectionState[catKey]

      for (const c of targetCourses) {
        const matchedCategories = c.categories.filter(k => resolveCategoryChipKey(k) === catKey)
        if (c.onToggleCategory) {
          c.onToggleCategory(catKey, nextOn)
        } else if (matchedCategories.length > 0) {
          for (const cat of matchedCategories) {
            if ((nextOn && cat.state !== 'all') || (!nextOn && cat.state !== 'none')) {
              cat.onToggle()
            }
          }
        }
      }
    },
    [isSingleCourse, currentCourse, courses, categorySelectionState]
  )

  const handleClearSelection = useCallback(() => {
    if (isSingleCourse && currentCourse) {
      if (currentCourse.state !== 'none') currentCourse.onToggle()
    } else {
      for (const c of courses) {
        if (c.state !== 'none') c.onToggle()
      }
    }
  }, [isSingleCourse, currentCourse, courses])

  // ── 本轮批量下载进度（供岛的进度环）：复用领域层 computeBatchStats 统一口径 ──
  const storeDownloading = useAppStore(s => s.downloading)
  const batchProgress = useAppStore(
    useShallow(s => {
      if (!s.downloading || s.batchTaskIds.length === 0) return undefined
      const isBoth = s.downloadMode === 'both'
      return computeBatchStats(s.batchTaskIds, s.progress, s.cloudLinkedIds, isBoth)
    })
  )

  const handleStartDownload = useCallback(() => {
    // [Bug Fix] 原兜底链 course.onDownload → onDownloadCourse → courses[0].onDownload
    // 在旁听/好大学页三环皆空 → 岛的主按钮点击无任何反应。改为优先走页面级
    // onStartDownload 提交函数（各页 onDownload），仅 Column 视图 inspector 走
    // onDownloadCourse / course.onDownload（那两个视图不挂岛）。
    if (onStartDownload) {
      onStartDownload()
      return
    }
    if (isSingleCourse && currentCourse?.onDownload) {
      currentCourse.onDownload()
    } else if (onDownloadCourse && currentCourse) {
      onDownloadCourse(currentCourse)
    } else {
      const selCourses = courses.filter(c => c.state !== 'none')
      if (selCourses.length > 0) {
        selCourses.forEach(c => {
          if (c.onDownload) {
            c.onDownload()
          } else if (onDownloadCourse) {
            onDownloadCourse(c)
          }
        })
      }
      // 兜底链末环（courses[0]?.onDownload?.()）删除：单课程下载是 inspector 的职责，
      // 岛是批量提交入口，无回调可用时保持静默而非随机下载列表第一门课。
    }
  }, [onStartDownload, isSingleCourse, currentCourse, onDownloadCourse, courses])

  if (courses.length === 0) {
    return <div className="h-full w-full">{emptyPlaceholder}</div>
  }

  const menuActions = (entries: CourseMenuEntry[]): MenuAction[] => {
    const labels = getDownloadActionLabels(currentDownloadMode)
    const info: FileInfo[] = entries.map(entry => {
      const owner = entry.kind === 'course' ? entry.item : entry.kind === 'category' ? currentCourse : sourceCourses.find(course => course.categories.some(category => category.items.some(item => item.id === entry.item.id)))
      const category = entry.kind === 'file' ? owner?.categories.find(category => category.items.some(item => item.id === entry.item.id)) : undefined
      return { name: entry.item.name, path: `课程资源:/${[owner?.term, owner?.name, category?.name, entry.kind !== 'course' ? entry.item.name : null].filter(Boolean).join('/')}`, directory: entry.kind !== 'file', size: entry.kind === 'file' ? entry.item.size : undefined, modified: entry.kind === 'file' ? entry.item.date : undefined }
    })
    const copy = (text: string) => { void copyFileText(text).then(() => showToast('已复制')).catch(() => showToast('复制失败，请检查剪贴板权限')) }
    return [{ id: 'download', label: `${currentDownloadMode === 'cloud' ? '转存至交大云盘' : labels.verb}${entries.length > 1 ? `（${entries.length} 项）` : ''}`, run: () => {
      if (entries.length === 1 && entries[0].kind === 'file') {
        const file = entries[0].item
        const owner = courses.find(course => course.categories.some(category => category.items.some(item => item.id === file.id)))
        const category = owner?.categories.find(category => category.items.some(item => item.id === file.id))
        if (file.onDownloadSingle) file.onDownloadSingle()
        else if (file.onDownload) file.onDownload()
        else onDownloadSingle?.(file, owner, category)
      } else handleStartDownload()
    } },
    { id: 'copy-name', label: '复制名称', divider: true, run: () => copy(info.map(file => file.name).join('\n')) },
    { id: 'copy-path', label: '复制目录路径', run: () => copy(info.map(file => file.path).join('\n')) },
    { id: 'properties', label: '属性', run: () => setProperties(info) }]
  }

  return (
    <CourseMenuContext.Provider value={menuActions}>
    <div ref={viewportRef} className="ui-page" onKeyDown={history.onKeyDown}>
      {/* 顶部综合导航与过滤操作栏：深入课程/分类后展示，统一容器设计 */}
      {navState.level !== 'root' && (
        <div className="border-b border-bd bg-surface-1 px-[var(--page-gutter)] py-2.5 transition-all">
          {/* 第一行：面包屑导航 + 资源统计 + 三栏视图模式切换 */}
          <div className="flex items-center justify-between gap-3">
            <BreadcrumbBar items={breadcrumbItems} onNavigate={handleBreadcrumbNavigate} />

            <div className="flex items-center gap-3 shrink-0">
              <div className="text-xs text-text-3 font-mono">{statsLabel}</div>
              {onViewModeChange && (
                <NetdiskViewModeSwitch mode={viewMode} onChange={onViewModeChange} />
              )}
            </div>
          </div>

          {/* 第二行：当前分类内的文件搜索、类型筛选与排序（与顶行自然融合，无割裂黑线） */}
          {currentCategory && currentCategory.items.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
              <DirectoryFilter
                query={query}
                kind={kind}
                onQuery={value => { filterChanged(); setQuery(value) }}
                onKind={value => { filterChanged(); setKind(value) }}
              />
              <div className="flex items-center gap-2 shrink-0">
                <DropdownSelect<string>
                  value={sort}
                  options={sortOptions}
                  onChange={setSort}
                  title="文件排序方式"
                  size="md"
                  buttonClassName="h-9"
                />
                <button
                  type="button"
                  onClick={() => setDescending(value => !value)}
                  title={descending ? '当前降序，点击切换为升序' : '当前升序，点击切换为降序'}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-bd bg-surface-2 px-3 text-xs font-medium text-text-2 shadow-2xs transition-all hover:border-bd-strong hover:bg-surface-1 hover:text-text-1 cursor-pointer select-none"
                >
                  <span>{descending ? '降序 ↓' : '升序 ↑'}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 核心视图区域：依据 viewMode 呈现（带平滑渐入微缩放过渡动效，12px 适度呼吸微留白） */}
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden p-3">
        <div key={viewMode} className="h-full w-full animate-fadeIn">
          {viewMode === 'column' ? (
            <ColumnView
              courses={courses}
              activeCourse={columnActiveCourse}
              activeCategory={columnActiveCategory}
              onSelectCourse={c => {
                if (lastEnteredCourseIdRef.current !== c.id) {
                  lastEnteredCourseIdRef.current = c.id
                  c.onEnter?.()
                }
                onNavigate({
                  level: 'course',
                  courseId: c.id
                })
              }}
              onSelectCategory={cat => {
                if (columnActiveCourse) {
                  onNavigate({
                    level: 'category',
                    courseId: columnActiveCourse.id,
                    categoryId: cat.id
                  })
                }
              }}
              groupByTerm={groupByTerm}
              onDownloadSingle={onDownloadSingle}
              onDownloadCourse={onDownloadCourse}
              perspective={perspective}
              onPerspectiveChange={onPerspectiveChange}
              hasPptPdf={hasPptPdf}
              onTogglePptPdf={onTogglePptPdf}
              hasSelection={selectedStats.totalItems > 0}
              downloadMode={currentDownloadMode}
            />
          ) : viewMode === 'list' ? (
            <ListView
              courses={courses}
              currentCourse={currentCourse}
              currentCategory={currentCategory}
              navState={navState}
              onNavigate={onNavigate}
              groupByTerm={groupByTerm}
              onDownloadSingle={onDownloadSingle}
              onInspectFile={setDetailFile}
              onDownloadCourse={onDownloadCourse}
              perspective={perspective}
              onPerspectiveChange={onPerspectiveChange}
              showToast={showToast}
              hasSelection={selectedStats.totalItems > 0}
              downloadMode={currentDownloadMode}
            />
          ) : (
            <GridView
              courses={courses}
              currentCourse={currentCourse}
              currentCategory={currentCategory}
              navState={navState}
              onNavigate={onNavigate}
              groupByTerm={groupByTerm}
              onDownloadSingle={onDownloadSingle}
              onInspectFile={setDetailFile}
              onDownloadCourse={onDownloadCourse}
              perspective={perspective}
              onPerspectiveChange={onPerspectiveChange}
              showToast={showToast}
              hasSelection={selectedStats.totalItems > 0}
              downloadMode={currentDownloadMode}
            />
          )}
        </div>
      </div>

      {/* 底部浮动命令动作岛 (非分栏视图下挂载：选中项 > 0 或本轮批量下载进行中)。
          batchProgress 复用已死的 OverallProgressBar 的 batchTaskIds 统计口径
          （both 模式区分下载中/上传中），让批量进度在岛上以进度环实时可见。 */}
      {(selectedStats.totalItems > 0 || storeDownloading) && (
        <FloatingCommandIsland
          selectedSummary={{
            courseCount: selectedStats.courseCount,
            categoryCount: selectedStats.categoryCount,
            totalItems: selectedStats.totalItems,
            formattedSize: selectedStats.formattedSize,
            filesCount: selectedStats.filesCount,
            videoCount: selectedStats.videoCount,
            assignCount: selectedStats.assignCount,
            pptCount: selectedStats.pptCount
          }}
          isSingleCourse={selectedStats.isSingleCourse}
          hideCategoryChips={hideCategoryChips}
          categorySelection={categorySelectionState}
          onToggleCategory={handleToggleIslandCategory}
          perspective={selectedStats.effectivePerspective ?? perspective ?? currentCourse?.perspective ?? sharedPerspective}
          onPerspectiveChange={p => {
            setSharedPerspective(p)
            onPerspectiveChange?.(p)
            if (currentCourse) {
              currentCourse.onPerspectiveChange?.(p)
            } else {
              const targetCourses = courses.filter(c => c.state !== 'none')
              const broadcastList = targetCourses.length > 0 ? targetCourses : courses
              broadcastList.forEach(c => c.onPerspectiveChange?.(p))
            }
          }}
          onStartDownload={handleStartDownload}
          onClearSelection={handleClearSelection}
          batchProgress={batchProgress}
          downloadMode={currentDownloadMode}
        />
      )}

      {/* Toast 提示浮条 */}
      {detailFile && <Dialog title="课件详情" onClose={() => setDetailFile(null)}>
        <FileDetailInspector item={currentCategory?.items.find(item => item.id === detailFile.id) ?? detailFile}
          course={currentCourse} category={currentCategory} onClose={() => setDetailFile(null)}
          onDownloadSingle={onDownloadSingle} downloadMode={currentDownloadMode} />
      </Dialog>}
      <Toast toast={toast} onClose={hideToast} />
      {properties && <PropertiesDialog files={properties} onClose={() => setProperties(null)} />}
    </div>
    </CourseMenuContext.Provider>
  )
})
