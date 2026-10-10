/**
 * 现场交互式登录与接口连通性探测脚手架 (R4-F1)
 *
 * 用途：
 * 1. 弹出受控 Electron 窗口加载交大 jAccount 统一身份认证，协助用户完成现场扫码；
 * 2. 提取并持久化 session cookies、JWT Token 与 UserToken；
 * 3. 现场执行端到端连通性测试（Canvas、v.sjtu、交大云盘、好大学在线），输出诊断报告；
 * 4. 支持 CLI 抓包参数与会话持久化导出。
 *
 * 运行方式：
 *   npx electron -r esbuild-register scripts/interactive-login.ts [--dump-traffic] [--save-session] [--probe-only]
 */
import { app, BrowserWindow, session, type Session } from 'electron'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  SJTU_PARTITION,
  V_SJTU_ORIGIN,
  CANVAS_BASE_URL,
  CNMOOC_BASE_URL
} from '../src/shared/types'

export interface CliOptions {
  dumpTraffic: boolean
  saveSession: boolean
  probeOnly: boolean
  help: boolean
}

export function parseCliArgs(args: string[] = process.argv.slice(2)): CliOptions {
  return {
    dumpTraffic: args.includes('--dump-traffic'),
    saveSession: args.includes('--save-session'),
    probeOnly: args.includes('--probe-only'),
    help: args.includes('--help') || args.includes('-h')
  }
}

export interface ProbeScorecard {
  auth: boolean
  canvas: boolean
  vsjtu: boolean
  cloudpan: boolean
  cnmooc: boolean
  details: Record<string, string>
}

/** 遍历交大 6 大核心域名收割 Cookie 并提取身份令牌 */
export async function extractSessionCredentials(ses: Session): Promise<Record<string, any>> {
  const domains = [
    'sjtu.edu.cn',
    'jaccount.sjtu.edu.cn',
    'v.sjtu.edu.cn',
    'oc.sjtu.edu.cn',
    'pan.sjtu.edu.cn',
    'cnmooc.sjtu.cn'
  ]
  const allCookies: any[] = []
  const seenKeys = new Set<string>()

  for (const domain of domains) {
    const list = await ses.cookies.get({ domain })
    for (const c of list) {
      const key = `${c.domain}:${c.name}:${c.path}`
      if (!seenKeys.has(key)) {
        seenKeys.add(key)
        allCookies.push(c)
      }
    }
  }

  // 额外从 pan.sjtu.edu.cn url 获取 host-only cookie
  try {
    const panCookies = await ses.cookies.get({ url: 'https://pan.sjtu.edu.cn' })
    for (const c of panCookies) {
      const key = `${c.domain}:${c.name}:${c.path}`
      if (!seenKeys.has(key)) {
        seenKeys.add(key)
        allCookies.push(c)
      }
    }
  } catch {
    /* ignore */
  }

  const userToken = allCookies.find(c => c.name === 'USER_TOKEN')?.value
  const cpstk = allCookies.find(c => c.name === 'cpstk')?.value
  const jsessionid = allCookies.find(c => c.name.toUpperCase() === 'JSESSIONID')?.value

  return {
    timestamp: new Date().toISOString(),
    totalCookies: allCookies.length,
    userToken,
    cpstk,
    jsessionid,
    cookies: allCookies
  }
}

/** 探测校内 5 大业务子系统端点连通性 */
export async function probeSubsystemConnectivity(ses: Session, userToken?: string): Promise<ProbeScorecard> {
  const scorecard: ProbeScorecard = {
    auth: false,
    canvas: false,
    vsjtu: false,
    cloudpan: false,
    cnmooc: false,
    details: {}
  }

  // 1. Auth 统一身份认证
  try {
    const aResp = await ses.fetch('https://jaccount.sjtu.edu.cn/jaccount/', { method: 'GET', redirect: 'manual' })
    scorecard.auth = aResp.status === 200 || aResp.status === 302
    scorecard.details.auth = `HTTP ${aResp.status}`
  } catch (e: any) {
    scorecard.details.auth = String(e)
  }

  // 2. Canvas LMS
  try {
    const cResp = await ses.fetch(`${CANVAS_BASE_URL}/api/v1/courses`, { method: 'GET' })
    scorecard.canvas = cResp.status === 200
    scorecard.details.canvas = `HTTP ${cResp.status}`
  } catch (e: any) {
    scorecard.details.canvas = String(e)
  }

  // 3. v.sjtu 旁听课程
  try {
    const vResp = await ses.fetch(`${V_SJTU_ORIGIN}/jy-application-resmgr-resource/auditCourse/my`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageNo: 1, pageSize: 5 })
    })
    scorecard.vsjtu = vResp.status === 200
    scorecard.details.vsjtu = `HTTP ${vResp.status}`
  } catch (e: any) {
    scorecard.details.vsjtu = String(e)
  }

  // 4. 交大云盘 CloudPan
  if (userToken) {
    try {
      const panResp = await ses.fetch(`https://pan.sjtu.edu.cn/user/v1/space/1?user_token=${userToken}`)
      scorecard.cloudpan = panResp.status === 200
      scorecard.details.cloudpan = `HTTP ${panResp.status}`
    } catch (e: any) {
      scorecard.details.cloudpan = String(e)
    }
  } else {
    try {
      const panResp = await ses.fetch('https://pan.sjtu.edu.cn/user/v1/space/1')
      scorecard.cloudpan = panResp.status === 200
      scorecard.details.cloudpan = `HTTP ${panResp.status}`
    } catch (e: any) {
      scorecard.details.cloudpan = String(e)
    }
  }

  // 5. 好大学在线 CNMOOC
  try {
    const moocResp = await ses.fetch(`${CNMOOC_BASE_URL}/portal/myCourseIndex/1.mooc`, { redirect: 'manual' })
    scorecard.cnmooc = moocResp.status === 200 || moocResp.status === 302
    scorecard.details.cnmooc = `HTTP ${moocResp.status}`
  } catch (e: any) {
    scorecard.details.cnmooc = String(e)
  }

  return scorecard
}

/** 挂载网络抓包与请求完成事件监听器 */
export function setupTrafficInterceptor(ses: Session, dump = false): void {
  if (!dump) return
  console.log('[Traffic] 实时抓包探测拦截器已挂载...')
  ses.webRequest.onBeforeRequest({ urls: ['*://*.sjtu.edu.cn/*', '*://*.sjtu.cn/*'] }, (details, cb) => {
    if (details.method !== 'GET') {
      console.log(`[Traffic:Req] ${details.method} ${details.url}`)
    }
    cb({})
  })
  ses.webRequest.onCompleted({ urls: ['*://*.sjtu.edu.cn/*', '*://*.sjtu.cn/*'] }, (details) => {
    if (details.statusCode >= 400 || details.url.includes('/api/') || details.url.includes('.mooc')) {
      console.log(`[Traffic:Resp] ${details.statusCode} ${details.url}`)
    }
  })
}

/** 将提取的会话信息导出为文件 */
export function saveSessionToFile(sessionData: any, filePath = resolve(process.cwd(), '.auth-session.json')): void {
  writeFileSync(filePath, JSON.stringify(sessionData, null, 2), 'utf-8')
  console.log(`[Session] 凭据已成功导出至 ${filePath}`)
}

export async function runInteractiveProbe(customOptions?: Partial<CliOptions>): Promise<void> {
  const cli = { ...parseCliArgs(), ...customOptions }

  if (cli.help) {
    console.log(`
用法: npx electron -r esbuild-register scripts/interactive-login.ts [选项]

选项:
  --dump-traffic    启用实时抓包探测日志 (通过 session.webRequest)
  --save-session    将获取的 Cookie 和凭据导出至 .auth-session.json
  --probe-only      跳过弹窗登录，仅探测当前已有会话连通性
  --help, -h        显示帮助信息
`)
    if (app && !app.isReady()) app.quit()
    return
  }

  await app.whenReady()
  const ses = session.fromPartition(SJTU_PARTITION)
  setupTrafficInterceptor(ses, cli.dumpTraffic)

  console.log('====================================================')
  console.log('🚀 SJTU 交互式登录与接口连通性探测工具 (R4-F1)')
  console.log('====================================================')

  if (cli.probeOnly) {
    console.log('[Probe] 正在执行无窗口连通性探测...')
    const creds = await extractSessionCredentials(ses)
    console.log(`[Session] 捕获凭据: ${creds.totalCookies} 个 Cookie, userToken: ${Boolean(creds.userToken)}`)
    const scorecard = await probeSubsystemConnectivity(ses, creds.userToken)
    console.log('[Scorecard] 连通性测试结果:', JSON.stringify(scorecard, null, 2))
    if (cli.saveSession) {
      saveSessionToFile({ ...creds, scorecard })
    }
    app.quit()
    return
  }

  // 1. 检查既有凭据
  const creds = await extractSessionCredentials(ses)
  const hasJa = creds.cookies.some((c: any) => c.name.includes('JA') || c.domain.includes('jaccount'))
  console.log(`[Session] 当前存储 Cookie 数量: ${creds.totalCookies}`)
  console.log(`[Session] jAccount 会话标识: ${hasJa ? '已存在' : '未检测到，即将弹出登录窗口'}`)

  // 2. 创建登录窗口
  const win = new BrowserWindow({
    width: 900,
    height: 700,
    title: 'SJTU jAccount 现场登录探测窗口',
    webPreferences: {
      session: ses,
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  const loginUrl = `${V_SJTU_ORIGIN}/jy-application-resmgr-ui/#/login`
  console.log(`[Login] 正在载入登录页: ${loginUrl}`)
  await win.loadURL(loginUrl)

  // 3. 轮询检测登录结果
  const pollInterval = setInterval(async () => {
    try {
      const currentUrl = win.webContents.getURL()
      const freshCreds = await extractSessionCredentials(ses)
      const userToken = freshCreds.userToken

      if (currentUrl.includes('/#/home') || currentUrl.includes('oc.sjtu.edu.cn') || userToken) {
        console.log('----------------------------------------------------')
        console.log('✅ 登录成功！已捕获登录后会话态。')
        console.log(`[Probe] 当前页面 URL: ${currentUrl}`)
        if (userToken) console.log(`[Probe] 捕获交大云盘 USER_TOKEN: ${userToken.slice(0, 16)}...`)

        // 探测全部 5 个子系统
        const scorecard = await probeSubsystemConnectivity(ses, userToken)
        console.log('[Scorecard] 连通性测试报告:', JSON.stringify(scorecard, null, 2))

        if (cli.saveSession) {
          saveSessionToFile({ ...freshCreds, scorecard })
        }

        clearInterval(pollInterval)
        console.log('====================================================')
        console.log('探测完成，窗口可关闭。')
      }
    } catch {
      // 忽略窗口关闭等异常
    }
  }, 1500)

  win.on('closed', () => {
    clearInterval(pollInterval)
    console.log('[Probe] 探测窗口已关闭。')
    app.quit()
  })
}

if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  void runInteractiveProbe()
}
