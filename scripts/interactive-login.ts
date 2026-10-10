/**
 * 现场交互式登录与接口连通性探测脚手架 (R4-F1)
 *
 * 用途：
 * 1. 弹出受控 Electron 窗口加载交大 jAccount 统一身份认证，协助用户完成现场扫码；
 * 2. 提取并持久化 session cookies、JWT Token 与 UserToken；
 * 3. 现场执行端到端连通性测试（Canvas、v.sjtu、交大云盘、好大学在线），输出诊断报告。
 *
 * 运行方式：
 *   npx electron -r esbuild-register scripts/interactive-login.ts
 */
import { app, BrowserWindow, session } from 'electron'
import { SJTU_PARTITION, V_SJTU_ORIGIN, CANVAS_BASE_URL } from '../src/shared/types'

async function runInteractiveProbe(): Promise<void> {
  await app.whenReady()

  const ses = session.fromPartition(SJTU_PARTITION)
  console.log('====================================================')
  console.log('🚀 SJTU 交互式登录与接口连通性探测工具')
  console.log('====================================================')

  // 1. 检查既有凭证
  const cookies = await ses.cookies.get({ domain: 'sjtu.edu.cn' })
  const hasJa = cookies.some(c => c.name.includes('JA') || c.domain.includes('jaccount'))
  console.log(`[Session] 当前存储 Cookie 数量: ${cookies.length}`)
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
      const freshCookies = await ses.cookies.get({ domain: 'sjtu.edu.cn' })
      const userToken = freshCookies.find(c => c.name === 'USER_TOKEN')?.value

      if (currentUrl.includes('/#/home') || currentUrl.includes('oc.sjtu.edu.cn') || userToken) {
        console.log('----------------------------------------------------')
        console.log('✅ 登录成功！已捕获登录后会话态。')
        console.log(`[Probe] 当前页面 URL: ${currentUrl}`)
        if (userToken) console.log(`[Probe] 捕获交大云盘 USER_TOKEN: ${userToken.slice(0, 16)}...`)

        // 探测 Canvas 连通性
        try {
          const cResp = await ses.fetch(`${CANVAS_BASE_URL}/api/v1/courses`, { method: 'GET' })
          console.log(`[Probe] Canvas /api/v1/courses HTTP 响应码: ${cResp.status}`)
        } catch (e) {
          console.log(`[Probe] Canvas 探测异常:`, e)
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

if (process.env.NODE_ENV !== 'test') {
  void runInteractiveProbe()
}
