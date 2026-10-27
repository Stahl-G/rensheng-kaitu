import './runtime.js'
import { createCanvas } from '@napi-rs/canvas'
import { renderAtlasSvg } from '../src/render/atlas/svg/vector.js'
import { smoothRivers } from '../src/render/rivers.js'
import type { StyleId } from '../src/render/atlas/styles.js'
import type { Terrain } from './core.js'
const escapeXml=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!))
const measure=createCanvas(10,10).getContext('2d')
/** Native Cartographer vector renderer, unmodified theme palettes/contours/ornament. */
export function renderNative(terrain:Terrain,style:StyleId,title:string,lifeMap=false,appearance={glyphDensity:.24,compassScale:.55}) {
 const world={...terrain.world,worldName:title,worldNameZh:title,worldNameJa:title,labels:[]}
 const svg=renderAtlasSvg(world,smoothRivers(world),style,{labels:false,contours:true,graticule:false,...(lifeMap?{...appearance,minimalFurniture:true}:{})},measure as any,2)
 // Upstream emits Google Fonts @imports. Offline output must never make a network request.
 return svg.replace(/Noto Serif SC|Noto Sans SC|Ma Shan Zheng/g,'Noto Serif SC, Songti SC, SimSun, Microsoft YaHei, Noto Serif CJK SC').replace(/<style>[^]*?<\/style>/g,'').replace(/<title>[^]*?<\/title>/,`<title>${escapeXml(title)}</title>`)
}
