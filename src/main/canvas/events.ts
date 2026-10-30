/** Canvas 轻量事件发送回调 */
export type CanvasEmitter = (channel: string, data?: unknown) => void

let _emit: CanvasEmitter | null = null

export function setCanvasEmitter(emitter: CanvasEmitter): void {
  _emit = emitter
}

export function emitToRenderer(channel: string, data?: unknown): void {
  _emit?.(channel, data)
}

export function emitScanProgress(courseId: number, phase: string, message: string): void {
  emitToRenderer('canvas:scan-progress', { courseId, phase, message })
}
