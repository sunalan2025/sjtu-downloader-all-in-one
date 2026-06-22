// dev/build wrapper:
// 某些集成终端会预设 ELECTRON_RUN_AS_NODE=1，让 electron 退化成纯 Node，
// 窗口无法创建。这里启动 electron-vite 前剥掉该变量。
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

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
