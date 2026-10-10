// dev/build wrapper:
// 某些集成终端会预设 ELECTRON_RUN_AS_NODE=1，让 electron 退化成纯 Node，
// 窗口无法创建。这里启动 electron-vite 前剥掉该变量。
import { spawn, execSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

// Windows 中文系统控制台默认代码页是 GBK(936)，而 electron 主进程 console.log
// 写出的是 UTF-8 字节，936 按 GBK 解码 → 中文乱码（如「触发」显示成「瑙﹀彂」）。
// 启动前切到 UTF-8(65001)，让 PowerShell/conhost 正确渲染中文日志。
// stdio:'ignore' 丢弃 chcp 自身的 "Active code page" 输出；非控制台环境
// （CI / 管道重定向）下 chcp 会失败，try/catch 静默忽略即可。
if (process.platform === 'win32') {
  try {
    execSync('chcp 65001', { stdio: 'ignore', shell: true })
  } catch {
    // 无控制台（被重定向）时无法切换，忽略
  }
}

// 开发模式启动前：自动清理可能残留在后台的本项目旧 electron 进程，防止 Windows 独占锁 (Error 32)
if (process.argv.includes('dev') && process.platform === 'win32') {
  try {
    const projectDir = path.resolve(__dirname, '..')
    const psCmd = `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'electron.exe' } | ForEach-Object { if ($_.CommandLine -and $_.CommandLine -like '*${projectDir.replace(/\\/g, '\\\\')}*') { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } }"`
    execSync(psCmd, { stdio: 'ignore' })
  } catch {
    // 忽略异常
  }
}

const electronViteJs = path.join(
  __dirname,
  '..',
  'node_modules',
  'electron-vite',
  'bin',
  'electron-vite.js'
)

const child = spawn(process.execPath, [electronViteJs, ...process.argv.slice(2)], {
  env,
  stdio: 'inherit',
  windowsHide: false
})

child.on('exit', code => process.exit(code ?? 0))
child.on('error', err => {
  console.error('[run-electron-vite] failed to spawn:', err)
  process.exit(1)
})
