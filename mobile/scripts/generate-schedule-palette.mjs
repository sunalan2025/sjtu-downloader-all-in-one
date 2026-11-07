import { Hct } from '../node_modules/@material/material-color-utilities/hct/hct.js'
import { hexFromArgb, argbFromHex } from '../node_modules/@material/material-color-utilities/utils/string_utils.js'
import { labFromArgb } from '../node_modules/@material/material-color-utilities/utils/color_utils.js'
import fs from 'node:fs/promises'
const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]))
const ink = '#263238'
const entry = fill => {
  const value = argbFromHex(fill),
    hct = Hct.fromInt(value)
  const color = { fill, ink, edge: hexFromArgb(Hct.from(hct.hue, 40, 57).toInt()) }
  return { light: { ...color }, dark: { ...color }, lab: labFromArgb(value) }
}
// Named, soft color families first. Calendar cards stay pastel in BOTH themes.
// Dark surfaces belong to the app scaffold, never to subject color blocks.
const chosen = ['#fff0b3', '#b8dfff', '#c5e8b4', '#ffd0a1', '#d8c7ff', '#b5ece7'].map(entry)
const exam = labFromArgb(argbFromHex('#ffc1c4'))
let candidates = []
for (let hue = 40; hue <= 335; hue += 5)
  for (const tone of [85, 90, 95])
    for (const chroma of [25, 45, 65]) {
      const item = entry(hexFromArgb(Hct.from(hue, chroma, tone).toInt()))
      if (
        distance(item.lab, exam) >= 18 &&
        item.lab[0] >= 84 &&
        Math.min(
          ...item.light.fill
            .slice(1)
            .match(/../g)
            .map(x => parseInt(x, 16))
        ) >= 155
      )
        candidates.push(item)
    }
while (chosen.length < 64) {
  let best,
    score = -1
  for (const candidate of candidates) {
    const difference = Math.min(...chosen.map(old => distance(candidate.lab, old.lab)))
    if (difference > score) {
      score = difference
      best = candidate
    }
  }
  chosen.push(best)
  candidates = candidates.filter(c => c !== best)
}
let minimum = Infinity
for (let i = 0; i < 12; i++) for (let j = 0; j < i; j++) minimum = Math.min(minimum, distance(chosen[i].lab, chosen[j].lab))
console.log('Pastel palette: first 12 minimum Lab distance', minimum.toFixed(1))
if (minimum < 12) throw new Error('Pastel colors are too similar')
await fs.writeFile(new URL('../public/schedule-palette.json', import.meta.url), JSON.stringify(chosen.map(({ lab, ...color }) => color)))
