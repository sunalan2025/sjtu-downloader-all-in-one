/**
 * Network Test Harness for SJTU Downloader.
 * Intercepts SJTU API calls and simulates normal, degraded, and error network scenarios.
 */

import { MockSession, mockSjtuSession } from './electron-session.mock'
import {
  FIXTURES_AUTH,
  FIXTURES_CANVAS,
  FIXTURES_LTI,
  FIXTURES_VSJTU,
  FIXTURES_CLOUDPAN,
  FIXTURES_CNMOOC
} from './fixtures'

export interface NetworkHarnessOptions {
  session?: MockSession
  simulateCanvasFiles403?: boolean
  simulateCanvas302Login?: boolean
  simulate429RateLimit?: { delaySeconds: number; triggered: boolean }
  simulateSingleAngleVOD?: boolean
  simulateExpiredCloudPanToken?: boolean
}

export class NetworkHarness {
  public session: MockSession
  public options: NetworkHarnessOptions
  public requestLog: Array<{ url: string; method?: string; headers?: Record<string, string>; body?: string }> = []

  constructor(options: NetworkHarnessOptions = {}) {
    this.session = options.session || mockSjtuSession
    this.options = options
    this.setupInterceptors()
  }

  public reset(): void {
    this.session.reset()
    this.requestLog = []
    this.setupInterceptors()
  }

  private setupInterceptors(): void {
    this.session.registerFetchHandler(async (url: string, init?: RequestInit) => {
      const u = new URL(url)
      const method = init?.method?.toUpperCase() || 'GET'
      const headers = (init?.headers as Record<string, string>) || {}
      const body = typeof init?.body === 'string' ? init.body : undefined

      this.requestLog.push({ url, method, headers, body })

      // Rate limit check (429)
      if (this.options.simulate429RateLimit && !this.options.simulate429RateLimit.triggered) {
        this.options.simulate429RateLimit.triggered = true
        return new Response(JSON.stringify({ error: 'Too Many Requests' }), {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': String(this.options.simulate429RateLimit.delaySeconds)
          }
        })
      }

      // ─── jAccount / v.sjtu Auth ───
      if (u.pathname === '/cloud-rbac/authority/me') {
        const hasJwt = headers['jwt-token'] && headers['jwt-token'] !== 'null'
        if (hasJwt) {
          return new Response(JSON.stringify(FIXTURES_AUTH.meSuccess), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          })
        }
        return new Response(JSON.stringify(FIXTURES_AUTH.meUnauthorized), {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        })
      }

      // ─── Canvas LMS ───
      if (u.hostname === 'oc.sjtu.edu.cn') {
        // 302 login check
        if (this.options.simulateCanvas302Login && u.pathname.includes('/files/') && u.pathname.includes('/download')) {
          return new Response('', {
            status: 302,
            headers: { Location: 'https://oc.sjtu.edu.cn/login/canvas' }
          })
        }

        if (u.pathname === '/api/v1/courses') {
          return new Response(JSON.stringify(FIXTURES_CANVAS.courses), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          })
        }

        if (u.pathname.includes('/folders')) {
          if (this.options.simulateCanvasFiles403) {
            return new Response(JSON.stringify({ message: 'Forbidden' }), {
              status: 403,
              headers: { 'Content-Type': 'application/json' }
            })
          }
          return new Response(JSON.stringify(FIXTURES_CANVAS.folders), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          })
        }

        if (u.pathname.includes('/files')) {
          if (this.options.simulateCanvasFiles403 && !u.pathname.match(/\/files\/\d+/)) {
            return new Response(JSON.stringify({ message: 'Forbidden' }), {
              status: 403,
              headers: { 'Content-Type': 'application/json' }
            })
          }
          if (u.pathname.endsWith('/files/303')) {
            return new Response(JSON.stringify(FIXTURES_CANVAS.fileMeta303), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            })
          }
          if (u.pathname.endsWith('/files/304')) {
            return new Response(JSON.stringify(FIXTURES_CANVAS.fileMeta304), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            })
          }
          return new Response(JSON.stringify(FIXTURES_CANVAS.files), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          })
        }

        if (u.pathname.includes('/modules')) {
          if (u.pathname.endsWith('/items')) {
            return new Response(JSON.stringify(FIXTURES_CANVAS.modules[0].items), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            })
          }
          return new Response(JSON.stringify(FIXTURES_CANVAS.modules), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          })
        }

        if (u.pathname.includes('/tabs')) {
          return new Response(JSON.stringify(FIXTURES_LTI.tabs), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          })
        }
      }

      // ─── LTI 1.3 Video Endpoints ───
      if (u.pathname.includes('/directOnDemandPlay/findVodVideoList')) {
        return new Response(JSON.stringify(FIXTURES_LTI.videoListPaginated), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      }

      if (u.pathname.includes('/directOnDemandPlay/getVodVideoInfos')) {
        const fixture = this.options.simulateSingleAngleVOD
          ? FIXTURES_LTI.vodInfosSingle
          : FIXTURES_LTI.vodInfosDual
        return new Response(JSON.stringify(fixture), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      }

      if (u.pathname.includes('/vod-analysis/query-ppt-slice-es')) {
        return new Response(JSON.stringify(FIXTURES_LTI.pptSlices), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      }

      // ─── v.sjtu 旁听课 ───
      if (u.pathname.includes('/audit-course/my')) {
        let page = 1
        try {
          if (body) {
            const parsed = JSON.parse(body)
            page = parsed.pageNo || 1
          }
        } catch {}
        const fixture = page === 2 ? FIXTURES_VSJTU.myAuditCoursesPage2 : FIXTURES_VSJTU.myAuditCoursesPage1
        return new Response(JSON.stringify(fixture), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      }

      if (u.pathname.includes('/resmgr-resource/detail/auditCourse')) {
        return new Response(JSON.stringify(FIXTURES_VSJTU.courseDetail), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      }

      if (u.pathname.includes('/resmgr-ivs-res/vod-info-by-course-id')) {
        const fixture = this.options.simulateSingleAngleVOD
          ? FIXTURES_VSJTU.vodInfoSingleAngleOnly0
          : FIXTURES_VSJTU.vodInfoDual
        return new Response(JSON.stringify(fixture), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      }

      // ─── 交大云盘 ───
      if (u.hostname === 'pan.sjtu.edu.cn') {
        if (u.pathname.includes('/user/v1/space/1/personal')) {
          if (this.options.simulateExpiredCloudPanToken) {
            return new Response(JSON.stringify({ error: 'Token Expired' }), { status: 401 })
          }
          return new Response(JSON.stringify(FIXTURES_CLOUDPAN.spaceCred), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          })
        }
        if (u.pathname.includes('/user/v1/space/1')) {
          return new Response(JSON.stringify(FIXTURES_CLOUDPAN.spaceInfo), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          })
        }
      }

      // ─── 好大学在线 CNMOOC ───
      if (u.hostname === 'cnmooc.sjtu.cn') {
        if (u.pathname.includes('/myCourseIndex/1.mooc')) {
          return new Response(FIXTURES_CNMOOC.myCoursesPage1Html, {
            status: 200,
            headers: { 'Content-Type': 'text/html' }
          })
        }
        if (u.pathname.includes('/myCourseIndex/2.mooc')) {
          return new Response(FIXTURES_CNMOOC.myCoursesPage2Html, {
            status: 200,
            headers: { 'Content-Type': 'text/html' }
          })
        }
        if (u.pathname.includes('/portal/session/unitNavigation/')) {
          return new Response(FIXTURES_CNMOOC.unitNavigationHtml, {
            status: 200,
            headers: { 'Content-Type': 'text/html' }
          })
        }
        if (u.pathname.includes('/study/play.mooc')) {
          return new Response(FIXTURES_CNMOOC.playMoocVideoHtml, {
            status: 200,
            headers: { 'Content-Type': 'text/html' }
          })
        }
        if (u.pathname.includes('/item/detail.mooc')) {
          return new Response(JSON.stringify(FIXTURES_CNMOOC.detailMoocVideoJson), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          })
        }
      }

      return undefined
    })
  }
}
