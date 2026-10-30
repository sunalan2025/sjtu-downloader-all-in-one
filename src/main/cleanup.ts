// 启动清理：每次打开应用清掉上次残留的临时/半下载文件，释放本地空间。
// 纯 fs 操作，无状态、无副作用外的依赖。

import { existsSync, lstatSync, readdirSync, rmSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { normalizeComparePath } from './utils/paths'

// 应用子目录名（Canvas / 好大学在线 / 旁听课程），下载根下统一。
export const APP_COURSE_DIRS = ['Canvas课程', '好大学在线', 'SJTU旁听课程']

/** 递归遍历 dir，仅清理 *.part 临时未完成文件。
 *  保留 *.mp4、*.ts 等所有合法文件与课件代码——用户选定目录里的成品与文件绝不误删。
 *  遇到符号链接时跳过，严禁穿越软链接。 */
export function cleanupHalfDownloaded(dir: string, protectedPaths: readonly string[] = []): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch (_err) {
    // 目录不存在或无读取权限时静默返回
    return
  }

  for (const name of entries) {
    const p = join(dir, name)
    let st: ReturnType<typeof lstatSync>
    try {
      st = lstatSync(p, { throwIfNoEntry: false })
    } catch (_err) {
      // 偶发文件系统锁占或无权限读取时跳过
      continue
    }
    if (!st || st.isSymbolicLink()) continue

    if (st.isDirectory()) {
      cleanupHalfDownloaded(p, protectedPaths)
    } else if (name.endsWith('.part')) {
      if (protectedPaths.some(kept => normalizeComparePath(kept) === normalizeComparePath(p))) continue
      try {
        unlinkSync(p)
      } catch (err) {
        // 遇到文件锁占或只读权限时跳过，记录调试日志
        console.debug('[cleanup] 删除残留 .part 失败:', err instanceof Error ? err.message : err)
      }
    }
  }
}

/** 启动清理残留文件。
 *  - cloud-only 临时根（C:/tmp | /tmp）+ OS tmpdir 下的应用子目录：纯中间产物，整目录 rmSync。
 *  - 若用户恰好把 localDestRoot 设成了 tempRoot/tmpdir，跳过整删，交由 .part 安全清理，避免误删用户文件。
 *  - OS tmpdir/sjtu-ppt-*：PPT 图片临时目录，rmSync。
 *  - localDestRoot（用户选定目录）应用子目录：仅删除 *.part，保留全部成品与代码文件。
 *  跳过 sjtu-update*（updater 自管）。任一步失败不抛、不阻塞启动。 */
export function cleanupStaleDownloads(localDestRoot?: string, protectedPaths: readonly string[] = []): void {
  const tempRoot = process.platform === 'win32' ? 'C:/tmp' : '/tmp'
  // 1) cloud-only 临时根 + OS tmpdir 下的应用子目录：整目录删（纯中间产物）。
  //    若用户恰好把 localDestRoot 设成了 tempRoot/tmpdir，通过 normalizeComparePath 规范化比较跳过整删。
  for (const base of [tempRoot, tmpdir()]) {
    if (localDestRoot && normalizeComparePath(base) === normalizeComparePath(localDestRoot)) continue
    for (const d of APP_COURSE_DIRS) {
      const targetDir = join(base, d)
      const normalizedTarget = normalizeComparePath(targetDir).replace(/\\/g, '/')
      if (protectedPaths.some(kept => {
        const normalized = normalizeComparePath(kept).replace(/\\/g, '/')
        return normalized === normalizedTarget || normalized.startsWith(normalizedTarget + '/')
      })) continue
      if (!existsSync(targetDir)) continue
      try {
        rmSync(targetDir, { recursive: true, force: true })
      } catch (err) {
        console.debug('[cleanup] 清理临时应用目录失败:', err instanceof Error ? err.message : err)
      }
    }
  }

  // 2) PPT 图片临时目录（tmpdir/sjtu-ppt-*）：整目录删。
  let tmpEntries: string[] = []
  try {
    tmpEntries = readdirSync(tmpdir())
  } catch (_err) {
    /* ignore */
  }

  for (const name of tmpEntries) {
    if (name.startsWith('sjtu-ppt-')) {
      const targetPptDir = join(tmpdir(), name)
      if (!existsSync(targetPptDir)) continue
      try {
        rmSync(targetPptDir, { recursive: true, force: true })
      } catch (err) {
        console.debug('[cleanup] 清理 PPT 临时目录失败:', err instanceof Error ? err.message : err)
      }
    }
  }

  // 3) localDestRoot 应用子目录：仅清理半下载 .part 文件，保留 .mp4 等所有成品及代码文件。
  if (localDestRoot) {
    for (const d of APP_COURSE_DIRS) {
      cleanupHalfDownloaded(join(localDestRoot, d), protectedPaths)
    }
  }
}
