// 启动清理：每次打开应用清掉上次残留的临时/半下载文件，释放本地空间。
// 纯 fs 操作，无状态、无副作用外的依赖。

import { readdirSync, rmSync, statSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 应用子目录名（Canvas / 好大学在线 / 旁听课程），下载根下统一。
export const APP_COURSE_DIRS = ['Canvas课程', '好大学在线', 'SJTU旁听课程']

/** 递归遍历 dir，删除 *.part（下载到一半）+ 孤立 *.ts（HLS remux 失败遗留、无同名 .mp4）。
 *  保留 *.mp4 等已完成文件——用户选定目录里的成品不删。
 *  会话内 pause/resume 仍正常（内存态保留 .part）；此处仅清上次会话残留（跨重启续传不再支持，
 *  因 CDN 预签名 URL 1h 过期且用户诉求是释放空间）。 */
export function cleanupHalfDownloaded(dir: string): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch (_err) {
    // 目录不存在或无读取权限时静默返回
    return
  }

  for (const name of entries) {
    const p = join(dir, name)
    let st: ReturnType<typeof statSync>
    try {
      st = statSync(p, { throwIfNoEntry: false })
    } catch (_err) {
      // 偶发文件系统锁占或无权限读取时跳过
      continue
    }
    if (!st) continue

    if (st.isDirectory()) {
      cleanupHalfDownloaded(p)
    } else if (name.endsWith('.part')) {
      try {
        unlinkSync(p)
      } catch (err) {
        // 遇到文件锁占或只读权限时跳过，记录调试日志
        console.debug('[cleanup] 删除残留 .part 失败:', err instanceof Error ? err.message : err)
      }
    } else if (name.endsWith('.ts')) {
      // 孤立 .ts：无同名 .mp4（remux 成功会删 .ts；.ts 残留仅在 remux 失败且无成品 .mp4 时）
      const mp4 = p.slice(0, -3) + '.mp4'
      if (!statSync(mp4, { throwIfNoEntry: false })) {
        try {
          unlinkSync(p)
        } catch (err) {
          console.debug('[cleanup] 删除孤立 .ts 失败:', err instanceof Error ? err.message : err)
        }
      }
    }
  }
}

/** 启动清理残留文件（由渲染端 onDownload 前调用一次，传 localDestRoot）。
 *  - cloud-only 临时根（C:/tmp | /tmp）+ OS tmpdir 下的应用子目录：纯中间产物（cloud-only
 *    iframe HLS / PPT PDF 中间件），整目录 rmSync。
 *  - OS tmpdir/sjtu-ppt-*：PPT 图片临时目录，rmSync。
 *  - localDestRoot（用户选定目录）应用子目录：删 *.part + 孤立 *.ts，保留 *.mp4 成品。
 *  跳过 sjtu-update*（updater 自管）。任一步失败不抛、不阻塞启动。 */
export function cleanupStaleDownloads(localDestRoot?: string): void {
  const tempRoot = process.platform === 'win32' ? 'C:/tmp' : '/tmp'
  // 1) cloud-only 临时根 + OS tmpdir 下的应用子目录：整目录删（纯中间产物）。
  //    若用户恰好把 localDestRoot 设成了 tempRoot/tmpdir，跳过整删——交由下方 localDestRoot
  //    的 .part/.ts 逻辑处理，避免误删用户成品 .mp4。
  for (const base of [tempRoot, tmpdir()]) {
    if (localDestRoot && base === localDestRoot) continue
    for (const d of APP_COURSE_DIRS) {
      try {
        rmSync(join(base, d), { recursive: true, force: true })
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
      try {
        rmSync(join(tmpdir(), name), { recursive: true, force: true })
      } catch (err) {
        console.debug('[cleanup] 清理 PPT 临时目录失败:', err instanceof Error ? err.message : err)
      }
    }
  }

  // 3) localDestRoot 应用子目录：删半下载 .part + 孤立 .ts，保留 .mp4 成品。
  if (localDestRoot) {
    for (const d of APP_COURSE_DIRS) {
      cleanupHalfDownloaded(join(localDestRoot, d))
    }
  }
}
