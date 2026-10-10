/**
 * v.sjtu VOD stream resolution with in-flight deduplication, caching, and single-angle tolerance (R3-F2).
 */

export interface VodStreamResult {
  availableAngles: number[]
  streamUrl: string | null
  angleName: string
  success: boolean
}

interface CacheEntry {
  data: any
  ts: number
}

export class VsjtuVodResolver {
  private cache = new Map<number, CacheEntry>()
  private inFlight = new Map<number, Promise<any>>()
  public networkCallCount = 0
  private ttl: number

  constructor(ttlMs = 5 * 60 * 1000) {
    this.ttl = ttlMs
  }

  async resolveVodStream(
    courseId: number,
    requestedAngle: number,
    fetchFn: (id: number) => Promise<any>
  ): Promise<VodStreamResult> {
    let vodData: any
    const cached = this.cache.get(courseId)

    if (cached && Date.now() - cached.ts < this.ttl) {
      vodData = cached.data
    } else {
      let pending = this.inFlight.get(courseId)
      if (!pending) {
        this.networkCallCount++
        pending = fetchFn(courseId)
          .then(data => {
            this.cache.set(courseId, { data, ts: Date.now() })
            this.inFlight.delete(courseId)
            return data
          })
          .catch(err => {
            this.inFlight.delete(courseId)
            throw err
          })
        this.inFlight.set(courseId, pending)
      }
      vodData = await pending
    }

    const videoInfos = vodData?.data?.videoInfos || []
    const availableAngles = videoInfos.map((i: any) => i.angle)

    // 1. Exact angle match
    const targetInfo = videoInfos.find((i: any) => i.angle === requestedAngle)
    if (targetInfo) {
      const rawUrl = targetInfo.extendPlayUrls?.[0] || targetInfo.playUrls?.[0] || targetInfo.videoUrl || ''
      const streamUrl = rawUrl.startsWith('//') ? `https:${rawUrl}` : rawUrl
      return {
        availableAngles,
        streamUrl: streamUrl || null,
        angleName: targetInfo.angleName || `视角${requestedAngle}`,
        success: Boolean(streamUrl)
      }
    }

    // 2. [R3-F2] Graceful single-angle fallback: when target angle is absent, fall back to available angle
    if (videoInfos.length > 0) {
      const fallback = videoInfos[0]
      const rawUrl = fallback.extendPlayUrls?.[0] || fallback.playUrls?.[0] || fallback.videoUrl || ''
      const streamUrl = rawUrl.startsWith('//') ? `https:${rawUrl}` : rawUrl
      return {
        availableAngles,
        streamUrl: streamUrl || null,
        angleName: fallback.angleName || `视角${fallback.angle ?? 0}`,
        success: Boolean(streamUrl)
      }
    }

    return {
      availableAngles,
      streamUrl: null,
      angleName: `视角${requestedAngle}`,
      success: false
    }
  }

  clearCache(): void {
    this.cache.clear()
    this.inFlight.clear()
  }
}

export const vsjtuVodResolver = new VsjtuVodResolver()
