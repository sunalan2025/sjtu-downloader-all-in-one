// scripts/generate-icons.mjs
// 从 build/icon.png 生成全平台图标到 build/icons/
//   - icon.png   1024×1024 (Linux / electron-builder 兜底)
//   - icon.ico   多尺寸 16/24/32/48/64/128/256 (Windows)
//   - icon.icns  (macOS) — 仅当平台支持时尝试, 失败则跳过并提示
//   - 各尺寸 PNG (16~512) 供托盘/开发期窗口使用
//
// 依赖: sharp, png-to-ico (devDependencies)
// 用法: node scripts/generate-icons.mjs

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import sharp from 'sharp'
import pngToIco from 'png-to-ico'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const srcPath = join(root, 'build', 'icon.png')
const outDir = join(root, 'build', 'icons')

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
const PNG_SIZES = [16, 32, 48, 64, 128, 256, 512, 1024]

async function main() {
  const src = await readFile(srcPath)
  await mkdir(outDir, { recursive: true })
  // 清理旧产物, 避免残留过时的尺寸文件
  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })

  const srcBuffer = Buffer.from(src)
  const transparent = { r: 0, g: 0, b: 0, alpha: 0 }

  // 1. 各尺寸 PNG (contain 居中, 透明背景, 兼容非正方形源图)
  const pngFiles = []
  for (const s of PNG_SIZES) {
    const buf = await sharp(srcBuffer)
      .resize(s, s, { fit: 'contain', background: transparent })
      .png()
      .toBuffer()
    const file = join(outDir, `${s}.png`)
    await writeFile(file, buf)
    pngFiles.push(file)
  }
  console.log(`✓ 生成 PNG: ${PNG_SIZES.join(', ')}`)

  // 1024 -> icon.png (electron-builder linux / 兜底)
  await writeFile(join(outDir, 'icon.png'), await readFile(join(outDir, '1024.png')))
  console.log('✓ 生成 icon.png (1024×1024)')

  // 2. ICO (Windows) — png-to-ico 接受 PNG buffer 数组, 内嵌多尺寸
  const icoPngs = await Promise.all(
    ICO_SIZES.map((s) =>
      sharp(srcBuffer)
        .resize(s, s, { fit: 'contain', background: transparent })
        .png()
        .toBuffer()
    )
  )
  const ico = await pngToIco(icoPngs)
  await writeFile(join(outDir, 'icon.ico'), ico)
  console.log(`✓ 生成 icon.ico (尺寸: ${ICO_SIZES.join(', ')})`)

  // 3. ICNS (macOS) — 用 png-to-ico 无能为力, 尝试 sharp + 手写未免太脆弱;
  //    electron-builder 在 macOS 上可直接用 512×512 PNG 作为 icon (会自动处理),
  //    因此这里不强制生成 .icns, 仅留 icon.png 兜底。如需 .icns 请用 electron-icon-builder。
  console.log('ℹ macOS 图标复用 icon.png (electron-builder 支持 PNG→icns 自动转换)')
  console.log(`\n完成 → ${outDir}`)
}

main().catch((err) => {
  console.error('生成图标失败:', err)
  process.exit(1)
})
