import { createCanvas, ImageData, Path2D, GlobalFonts } from '@napi-rs/canvas'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
Object.assign(globalThis, {ImageData,Path2D,document:{createElement:()=>createCanvas(1,1)}})
// The same OFL font ships with source, desktop payload and CLI engine. No system-font or network dependency.
const font = ['../../fonts/', '../fonts/', '../data/cartographer/fonts/', './data/cartographer/fonts/']
 .map(path => fileURLToPath(new URL(`${path}NotoSerifSC-Regular.otf`, import.meta.url)))
 .find(existsSync)
if (!font) throw new Error('地图中文字体缺失，请重新安装完整功能包')
for (const family of ['Noto Serif SC', 'Noto Sans SC', 'Ma Shan Zheng'])
 if (!GlobalFonts.registerFromPath(font, family)) throw new Error(`无法加载地图中文字体：${family}`)
export { createCanvas }
