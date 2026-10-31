import sharp from 'sharp'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir, writeFile, copyFile, stat } from 'node:fs/promises'

const mobile = join(dirname(fileURLToPath(import.meta.url)), '..')
const root = join(mobile, '..')
const source = join(root, 'build', 'icon.png')
const res = join(mobile, 'android', 'app', 'src', 'main', 'res')
await stat(source)
const densities = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 }
for (const [density, size] of Object.entries(densities)) {
  const dir = join(res, `mipmap-${density}`)
  await mkdir(dir, { recursive: true })
  const png = await sharp(source).resize(size, size, { fit: 'cover' }).png().toBuffer()
  await writeFile(join(dir, 'ic_launcher.png'), png)
  await writeFile(join(dir, 'ic_launcher_round.png'), png)
  // Adaptive foreground is 108dp; keep the desktop artwork in the center safe zone.
  const fgSize = Math.round(size * 108 / 48)
  const artworkSize = Math.round(fgSize * 0.67)
  const fg = await sharp(source).resize(artworkSize, artworkSize, { fit: 'contain' }).png().toBuffer()
  await sharp({ create: { width: fgSize, height: fgSize, channels: 4, background: '#00000000' } })
    .composite([{ input: fg, gravity: 'centre' }]).png()
    .toFile(join(dir, 'ic_launcher_foreground.png'))
}
const adaptive = join(res, 'mipmap-anydpi-v26')
await mkdir(adaptive, { recursive: true })
const iconXml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
  <background android:drawable="@color/ic_launcher_background"/>
  <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
`
await writeFile(join(adaptive, 'ic_launcher.xml'), iconXml)
await writeFile(join(adaptive, 'ic_launcher_round.xml'), iconXml)
const values = join(res, 'values')
await mkdir(values, { recursive: true })
await writeFile(join(values, 'sjtu_icon_background.xml'), `<?xml version="1.0" encoding="utf-8"?>
<resources><color name="ic_launcher_background">#F9F6E9</color></resources>
`)
console.log('Android launcher icons generated from the same build/icon.png used by the desktop app.')
