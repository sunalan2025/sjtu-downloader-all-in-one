import sharp from 'sharp'
import { mkdir, stat } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// Same desktop artwork, sized for its 28px UI slot (including high-density
// screens). Ship one optimized asset rather than the full desktop source.
const mobile = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(mobile, '..', 'build', 'icon.png')
const target = join(mobile, 'public', 'desktop-logo.png')
await mkdir(dirname(target), { recursive: true })
await sharp(source).resize(192, 192, { fit: 'contain', withoutEnlargement: true })
  .png({ compressionLevel: 9 }).toFile(target)
console.log('Mobile brand artwork optimized:', (await stat(target)).size, 'bytes')
