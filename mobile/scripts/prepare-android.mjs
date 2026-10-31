import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'

function run(...args) {
  execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', args, { stdio: 'inherit' })
}
if (!existsSync('android')) run('cap', 'add', 'android')
run('cap', 'sync', 'android')
