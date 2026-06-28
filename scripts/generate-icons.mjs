// scripts/generate-icons.mjs
// 从 build/icon.png 生成全平台图标到 build/icons/
//   - icon.png   1024×1024 (Linux / electron-builder 兜底)
//   - icon.ico   多尺寸 16/24/32/48/64/128/256 (Windows exe 静态图标)
//   - 各尺寸 PNG (16~512) 供托盘/开发期窗口使用
//
// 预处理 (透明 + 圆角 + 居中): 源图 build/icon.png 带米黄纯色背景 RGB(249,246,233),
//   logo 为深色系 (深青绿/深蓝/黑), 与米黄距离远, 可安全按颜色距离抠除。
//   - 抠除背景: 按到米黄的 RGB 距离, <=BG_TOL 全透明, BG_TOL~BG_TOL+BG_SOFT 软边缘
//     alpha 渐变 (消除锯齿 halo), 其余不透明。logo 内部缝隙同为米黄, 一并镂空。
//   - logo 居中: 抠除背景后, 按不透明像素的实际边界框裁出 logo 紧密子图,
//     再缩放到画布的 78% 居中放置, 消除源图 logo 偏上的构图, 让 logo 几何居中。
//   - 圆角过渡: SVG 圆角矩形蒙版 dest-in 裁切四角。半径 = 画布 × 0.22 (iOS squircle),
//     对角线切深 0.414R ≈ 9.1% 画布; logo 留白 11% 每侧 > 9.1%, 圆角不伤主体。
//
// 双主题 (深/浅):
//   - 深色版 (默认, 现状): 保留 logo 原深色, 透明背景 → 浅色主题(浅任务栏)上可见。
//     产物: build/icons/{16..1024}.png, icon.png, icon.ico (exe 静态图标)。
//   - 浅色版 (新增): logo 提亮为浅色 (HSL 保留色相, L→0.72), 透明背景 → 深色主题
//     (深任务栏)上可见。产物: build/icons/light/{16..1024}.png (仅 PNG, 运行时切换用;
//     不生成 .ico, 因 exe 图标静态无法运行时切换, 保持深色默认)。
//   运行时由主进程 nativeTheme 监听切换窗口/托盘/通知图标 (见 main/index.ts)。
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

// 米黄背景色 (实测 build/icon.png 四角均值); logo 为深色系, 抠除安全
const BG_COLOR = [249, 246, 233]
const BG_TOL = 28 // 距离<=此值视为背景 -> 完全透明
const BG_SOFT = 18 // [BG_TOL, BG_TOL+BG_SOFT] 区间 alpha 渐变, 消除锯齿 halo
const CORNER_RADIUS_RATIO = 0.22 // 圆角半径 / 画布边长 (iOS squircle)
// logo 在最终画布的占比; < 1 - 0.414×CORNER_RADIUS_RATIO 才不被圆角切到。
// 0.78 → 留白 11% 每侧 > 对角切深 9.1%, 安全且视觉饱满
const LOGO_FILL_RATIO = 0.78
// 浅色版提亮目标: HSL 明度 L 提到此值 (保留色相/饱和度, 深青绿→亮青, 深蓝→亮蓝)
const LIGHT_TARGET_L = 0.72

// ─── 颜色空间转换 (RGB↔HSL) ───────────────────────────────────
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  let h, s
  const l = (max + min) / 2
  if (max === min) { h = 0; s = 0 }
  else {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break
      case g: h = (b - r) / d + 2; break
      default: h = (r - g) / d + 4
    }
    h /= 6
  }
  return [h, s, l]
}

function hslToRgb(h, s, l) {
  let r, g, b
  if (s === 0) { r = g = b = l }
  else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1
      if (t > 1) t -= 1
      if (t < 1 / 6) return p + (q - p) * 6 * t
      if (t < 1 / 2) return q
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
      return p
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    r = hue2rgb(p, q, h + 1 / 3)
    g = hue2rgb(p, q, h)
    b = hue2rgb(p, q, h - 1 / 3)
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)]
}

/** 浅色版: 把深色 RGB 提亮 (HSL 保留色相, L→LIGHT_TARGET_L, S 微增鲜艳) */
function lightenRgb(r, g, b) {
  const [h, s, l] = rgbToHsl(r, g, b)
  // 纯黑/极暗无色相 → 直接转中性浅灰, 避免色相漂移
  if (l < 0.02) return [184, 184, 184]
  const newL = LIGHT_TARGET_L
  const newS = Math.min(1, s * 1.12)
  return hslToRgb(h, newS, newL)
}

/**
 * 预处理: 抠除米黄背景 + (可选)提亮为浅色 + logo 居中裁正方形 + 四角圆角裁切
 * variant: 'dark' (原色) | 'light' (提亮)
 * 返回处理后的 PNG buffer (1024×1024 正方形, 含 alpha)
 */
async function preprocess(srcBuffer, variant = 'dark') {
  const { data, info } = await sharp(srcBuffer).raw().toBuffer({ resolveWithObject: true })
  const { width, height, channels } = info
  if (channels < 4) {
    throw new Error('源图需为 RGBA (含 alpha 通道), 当前 channels=' + channels)
  }

  // 1. 颜色距离抠除背景, 软边缘 alpha 渐变 (覆盖原 alpha, 源图原 alpha 全 255)
  const [br, bg, bb] = BG_COLOR
  for (let i = 0; i < data.length; i += channels) {
    const dr = data[i] - br
    const dg = data[i + 1] - bg
    const db = data[i + 2] - bb
    const dist = Math.sqrt(dr * dr + dg * dg + db * db)
    let alpha
    if (dist <= BG_TOL) alpha = 0
    else if (dist <= BG_TOL + BG_SOFT) alpha = Math.round(((dist - BG_TOL) / BG_SOFT) * 255)
    else alpha = 255
    data[i + 3] = alpha
  }

  // 1b. 浅色版: 对不透明像素提亮 (保留软边缘 alpha, 仅改 RGB)
  if (variant === 'light') {
    for (let i = 0; i < data.length; i += channels) {
      if (data[i + 3] === 0) continue
      const [lr, lg, lb] = lightenRgb(data[i], data[i + 1], data[i + 2])
      data[i] = lr; data[i + 1] = lg; data[i + 2] = lb
    }
  }

  // 2. 按 alpha>0 像素找 logo 实际边界框 (含软边缘像素)
  let minX = width, minY = height, maxX = 0, maxY = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels
      if (data[i + 3] > 0) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  const logoW = maxX - minX + 1
  const logoH = maxY - minY + 1

  // 3. 裁掉 logo 外围背景 (紧密包围 logo), 得到 logo 占满的子图
  const croppedBuf = await sharp(data, { raw: { width, height, channels } })
    .extract({ left: minX, top: minY, width: logoW, height: logoH })
    .png()
    .toBuffer()

  // 4. 缩放到目标画布边长 × LOGO_FILL_RATIO, 再放到同尺寸透明正方形中心 (contain 居中留白)
  //    logo 在裁切框内本就居中, contain 后四周等距留白 → 最终画布 logo 几何居中
  const CANVAS = 1024 // 高分辨率工作画布, 后续再 resize 到各尺寸
  const logoSize = Math.round(CANVAS * LOGO_FILL_RATIO)
  const resizedLogo = await sharp(croppedBuf)
    .resize(logoSize, logoSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()

  const composited = await sharp({
    create: {
      width: CANVAS,
      height: CANVAS,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite([{ input: resizedLogo, gravity: 'center' }])
    .png()
    .toBuffer()

  // 5. 圆角矩形蒙版 dest-in: 蒙版白色区域保留, 四角(蒙版外)变透明
  const radius = Math.round(CANVAS * CORNER_RADIUS_RATIO)
  const maskSvg = Buffer.from(
    `<svg width="${CANVAS}" height="${CANVAS}" xmlns="http://www.w3.org/2000/svg">` +
      `<rect x="0" y="0" width="${CANVAS}" height="${CANVAS}" rx="${radius}" ry="${radius}" fill="#ffffff"/></svg>`
  )

  return sharp(composited)
    .composite([{ input: maskSvg, blend: 'dest-in' }])
    .png()
    .toBuffer()
}

/** 把已预处理的 1024 画布缩放到各尺寸 PNG, 写到 outDir/subDir/ */
async function emitPngs(processed, subDir) {
  const dir = join(outDir, subDir)
  await mkdir(dir, { recursive: true })
  const transparent = { r: 0, g: 0, b: 0, alpha: 0 }
  for (const s of PNG_SIZES) {
    const buf = await sharp(processed)
      .resize(s, s, { fit: 'contain', background: transparent })
      .png()
      .toBuffer()
    await writeFile(join(dir, `${s}.png`), buf)
  }
}

async function main() {
  const src = await readFile(srcPath)
  await mkdir(outDir, { recursive: true })
  // 清理旧产物, 避免残留过时的尺寸文件
  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })

  // 预处理: 深色版 (原色) + 浅色版 (提亮), 共享同一抠除背景/居中/圆角流程
  const darkProcessed = await preprocess(Buffer.from(src), 'dark')
  console.log('✓ 预处理深色版: 抠除米黄背景 (透明) + logo 居中 + 圆角过渡')
  const lightProcessed = await preprocess(Buffer.from(src), 'light')
  console.log('✓ 预处理浅色版: 同上 + logo HSL 提亮 (深色主题用)')

  const transparent = { r: 0, g: 0, b: 0, alpha: 0 }

  // 1. 深色版各尺寸 PNG (根目录) — 现有路径不变, 兼容打包配置
  await emitPngs(darkProcessed, '.')
  console.log(`✓ 生成深色 PNG: ${PNG_SIZES.join(', ')}`)

  // 1024 -> icon.png (electron-builder linux / 兜底)
  await writeFile(join(outDir, 'icon.png'), await readFile(join(outDir, '1024.png')))
  console.log('✓ 生成 icon.png (1024×1024)')

  // 2. ICO (Windows) — png-to-ico 接受 PNG buffer 数组, 内嵌多尺寸 (仅深色, exe 静态图标)
  const icoPngs = await Promise.all(
    ICO_SIZES.map((s) =>
      sharp(darkProcessed)
        .resize(s, s, { fit: 'contain', background: transparent })
        .png()
        .toBuffer()
    )
  )
  const ico = await pngToIco(icoPngs)
  await writeFile(join(outDir, 'icon.ico'), ico)
  console.log(`✓ 生成 icon.ico (尺寸: ${ICO_SIZES.join(', ')})`)

  // 3. 浅色版各尺寸 PNG (light/ 子目录) — 运行时深色主题切换用 (窗口/托盘/通知)
  await emitPngs(lightProcessed, 'light')
  console.log(`✓ 生成浅色 PNG: light/${PNG_SIZES.join(', ')}`)

  // 4. ICNS (macOS) — 用 png-to-ico 无能为力, 尝试 sharp + 手写未免太脆弱;
  //    electron-builder 在 macOS 上可直接用 512×512 PNG 作为 icon (会自动处理),
  //    因此这里不强制生成 .icns, 仅留 icon.png 兜底。如需 .icns 请用 electron-icon-builder。
  //    macOS 托盘图标运行时用 setTemplateImage(true) 自动跟随菜单栏深浅反色, 不需浅色版。
  console.log('ℹ macOS 图标复用 icon.png (electron-builder 支持 PNG→icns 自动转换)')
  console.log(`\n完成 → ${outDir}`)
}

main().catch((err) => {
  console.error('生成图标失败:', err)
  process.exit(1)
})
