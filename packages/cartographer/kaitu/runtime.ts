import { createCanvas, ImageData, Path2D, GlobalFonts } from '@napi-rs/canvas'
import { existsSync } from 'node:fs'
Object.assign(globalThis, {ImageData,Path2D,document:{createElement:()=>createCanvas(1,1)}})
// Register installed fonts only; no downloaded fonts, CDN or bundled proprietary font files.
for (const [path,name] of [
  ['/System/Library/Fonts/Supplemental/Songti.ttc','Songti SC'],
  ['/System/Library/Fonts/Supplemental/Songti.ttc','Noto Serif SC'],
  ['/System/Library/Fonts/Supplemental/Songti.ttc','Ma Shan Zheng'],
  ['/System/Library/Fonts/STHeiti Medium.ttc','Noto Sans SC'],
  ['/System/Library/Fonts/Supplemental/Arial Unicode.ttf','Kaitu CJK']
]) if(existsSync(path)) GlobalFonts.registerFromPath(path,name)
export { createCanvas }
