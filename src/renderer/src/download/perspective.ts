/**
 * 下载领域层 — 视频机位偏好映射
 *
 * Phase 1 领域模块的第一块基石。悬浮命令岛 / Inspector / 分类头的「机位选择」
 * UI 统一使用四档互斥选项（all/teacher/ppt/audio），其中 audio 档对应全局
 * videoQualityOption='audio_only'（仅提取音频 M4A），其余三档为视频机位。
 *
 * [Bug Fix] 原先岛的「仅原声音频 (M4A)」选项是全程 no-op：perspective 链路
 * （onPerspectiveChange → handleVideoPerspective）只处理 all/teacher/ppt/none，
 * 真正控制音频的 videoQualityOption 只有设置页/向导能改，两条链路从未接通。
 * 本函数是唯一的桥：任何机位选择 UI 都经它同步全局画质偏好。
 */
import type { VideoQualityOption } from '@shared/types'
import { useAppStore } from '../store/app'
import type { VideoPerspective } from '../components/FloatingCommandIsland'

/** 机位语义的完整取值（含"清空"档——清空只影响勾选，不改变画质偏好） */
export type VideoPerspectiveChoice = VideoPerspective | 'none'

/**
 * 把机位选择同步到全局画质偏好：
 * - 'audio' → videoQualityOption='audio_only'
 * - 其余（all/teacher/ppt/none）→ 若当前处于 audio_only 则恢复 'origin'
 *   （机位选项是用户的显式选择，选了视频机位就意味着要画面，不能停留在纯音频；
 *   'none' 清空勾选同样视为离开纯音频模式的显式信号）
 * 幂等：值未变化时不触发 set，避免无谓重渲染。
 */
export function applyVideoPerspectivePreference(p: VideoPerspectiveChoice): void {
  const store = useAppStore.getState()
  if (p === 'audio') {
    if (store.videoQualityOption !== 'audio_only') {
      store.setVideoQualityOption('audio_only')
    }
  } else if (store.videoQualityOption === 'audio_only') {
    store.setVideoQualityOption('origin')
  }
}

/** 画质选项到机位语义的反向映射：audio_only → 'audio'，其余 → undefined（非机位语义） */
export function qualityToPerspective(q: VideoQualityOption): VideoPerspective | undefined {
  return q === 'audio_only' ? 'audio' : undefined
}
