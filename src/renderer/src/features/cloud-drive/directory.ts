import type { CloudPanApi, CloudPanItem } from '@shared/types'

/** Load complete directories, so search, counts and selection never silently stop at page one. */
export async function readDirectory(
  path: string[],
  list: CloudPanApi['listDirectory'] = window.api.cloudpan.listDirectory
): Promise<CloudPanItem[]> {
  const items = new Map<string, CloudPanItem>()
  let loaded = 0
  for (let page = 1; page <= 200; page++) {
    const result = await list(path, page, 500)
    if (!result.ok || !result.data) throw new Error(result.error || '无法读取目录')
    const data = result.data
    for (const item of data.contents) items.set(item.name, item)
    loaded += data.contents.length
    if (loaded >= data.totalNum) return [...items.values()]
    if (!data.contents.length) throw new Error('目录分页中断，请刷新后重试')
  }
  throw new Error('目录超过 100000 项，请使用网页版管理')
}

export type SortKey = 'name' | 'modified' | 'size'
export function sortItems(items: CloudPanItem[], search: string, sort: SortKey, descending: boolean): CloudPanItem[] {
  const query = search.trim().toLocaleLowerCase()
  return items
    .filter(item => item.name.toLocaleLowerCase().includes(query))
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
      const value =
        sort === 'size'
          ? (a.size ?? 0) - (b.size ?? 0)
          : sort === 'modified'
            ? (Date.parse(a.modificationTime) || 0) - (Date.parse(b.modificationTime) || 0)
            : a.name.localeCompare(b.name, 'zh-CN', { numeric: true })
      return (value || a.name.localeCompare(b.name, 'zh-CN', { numeric: true })) * (descending ? -1 : 1)
    })
}
