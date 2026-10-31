import { copyFile, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// Reuse the actual desktop launcher icon; do not redraw an unrelated S logo.
const mobile = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(mobile, '..', 'build', 'icon.png')
const target = join(mobile, 'public', 'desktop-logo.png')
await mkdir(dirname(target), { recursive: true })
await copyFile(source, target)
console.log('Mobile brand asset synchronized from build/icon.png')
