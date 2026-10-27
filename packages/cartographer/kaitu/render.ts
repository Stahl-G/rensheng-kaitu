import './runtime.js'
import { createCanvas, loadImage, SvgExportFlag } from '@napi-rs/canvas'
import { renderAtlasSvg } from '../src/render/atlas/svg/vector.js'
import { marginOf } from '../src/render/atlas/index.js'
import { smoothRivers } from '../src/render/rivers.js'
import { THEMES, themeById, type StyleId } from '../src/render/atlas/styles.js'
import { createHash } from 'node:crypto'
import type { Terrain } from './core.js'
import type { layout } from './core.js'
import type { Fact } from './workspace.js'

export const COMPARISON_STYLES:StyleId[]=['teyvat','fantasy','ink','topo']
export const escapeXml=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!))
const measure=createCanvas(10,10).getContext('2d')
const font='"Songti SC", "Kaitu CJK", serif'
export function wrap(text:string,maxWidth:number,size:number,maxLines=2):string[] {
 measure.font=`${size}px ${font}`
 const result:string[]=[];let line=''
 for(const ch of [...text]) {
   if(measure.measureText(line+ch).width>maxWidth && line){result.push(line);line=''}
   line+=ch
 }
 if(line)result.push(line)
 if(result.length>maxLines) {
   result.length=maxLines
   let last=result[maxLines-1]
   while(last && measure.measureText(last+'…').width>maxWidth)last=last.slice(0,-1)
   result[maxLines-1]=last+'…'
 }
 return result
}
function summary(facts:Fact[]) {
 const projects=facts.filter(f=>f.kind==='project')
 if(projects.length)return projects.map(f=>f.title.replace(/（[^]*?）/g,'')).join(' · ')
 const experience=facts.filter(f=>f.kind==='experience' && ['user_reported','observed','current'].includes(f.status))
 if(experience.length)return experience.slice(0,2).map(f=>f.title).join(' · ')
 return facts[0]?.title??''
}
export function renderOverlay(domains:ReturnType<typeof layout>,style:StyleId,scale=2) {
 const theme=themeById(style)
 const foreground=style==='teyvat'?'#fbf7e8':'#302f2b'
 const halo=style==='teyvat'?'#244840':'#f5edda'
 return `<g id="kaitu-data-overlay" font-family='${font}' text-anchor="middle">${domains.map(d=>{
   const x=d.anchor.x*scale,y=d.anchor.y*scale
   const titleLines=wrap(summary(d.facts),224,16,2)
   const progress=d.facts.find(f=>f.progress)
   const info=progress?`记录：${progress.progress!.current} / ${progress.progress!.target} ${progress.progress!.unit} · ${String(progress.updated??'日期待补').slice(0,10)}`:d.facts.every(f=>f.kind==='experience')?'已有经历':d.facts.some(f=>f.kind==='goal')?'有进行中的目标':d.facts[0]?.kind==='plan'?'已有计划 · 完成情况未核对':'已有项目 · 进展按记录'
   const line=(t:string,dy:number,size:number,weight=400)=>`<g font-size="${size}" font-weight="${weight}"><text x="0" y="${dy}" text-anchor="middle" font-size="${size}" font-weight="${weight}" fill="none" stroke="${halo}" stroke-width="4.6" stroke-linejoin="round">${escapeXml(t)}</text><text x="0" y="${dy}" text-anchor="middle" font-size="${size}" font-weight="${weight}" fill="${foreground}">${escapeXml(t)}</text></g>`
   return `<g data-domain="${escapeXml(d.id)}" transform="translate(${x} ${y})"><title>${escapeXml(d.title+': '+d.facts.map(f=>f.title).join('；'))}</title><path d="M0 -27 l5 7 -5 7 -5 -7Z" fill="${foreground}" stroke="${halo}" stroke-width="1.5"/>${line(d.title,-32,25,600)}${titleLines.map((t,i)=>line(t,9+i*23,16)).join('')}${line(info,20+titleLines.length*23,12)}</g>`
 }).join('')}</g>`
}
/** Native Cartographer vector renderer, unmodified theme palettes/contours/ornament. */
export function renderNative(terrain:Terrain,style:StyleId,title:string,lifeMap=false,appearance={glyphDensity:.24,compassScale:.55}) {
 const world={...terrain.world,worldName:title,worldNameZh:title,worldNameJa:title,labels:[]}
 const svg=renderAtlasSvg(world,smoothRivers(world),style,{labels:false,contours:true,graticule:false,...(lifeMap?{...appearance,minimalFurniture:true}:{})},measure as any,2)
 // Upstream emits Google Fonts @imports. Offline output must never make a network request.
 return svg.replace(/Noto Serif SC/g,'Songti SC').replace(/Noto Sans SC/g,'Kaitu CJK').replace(/Ma Shan Zheng/g,'Songti SC').replace(/<style>[^]*?<\/style>/g,'').replace(/<title>[^]*?<\/title>/,`<title>${escapeXml(title)}</title>`)
}
export function compose(native:string,overlay:string,style:StyleId) {
 const margin=marginOf(themeById(style),2)
 return native.replace('</svg>',`<g transform="translate(${margin} ${margin})">${overlay}</g></svg>`)
}
function unescapeXml(s:string) {return s.replace(/&apos;/g,"'").replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&')}
/** Font outlines are generated locally through the same Canvas font engine used for measurement.
 * Only text nodes are replaced; native paths, filters, paper patterns and opacity remain byte-for-byte. */
export function outlineText(svg:string) {
 const [w,h]=svg.match(/width="([0-9.]+)" height="([0-9.]+)"/)!.slice(1).map(Number)
 return svg.replace(/<text\b([^>]*?)>([^]*?)<\/text>/g,(_node,attrs:string,raw:string)=>{
   const a=Object.fromEntries([...attrs.matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],unescapeXml(m[2])]))
   const canvas=createCanvas(w*3,h*3,SvgExportFlag.ConvertTextToPaths),ctx=canvas.getContext('2d')
   ctx.translate(w,h)
   const text=unescapeXml(raw), css=a.style?.match(/font:([^;]+)/)?.[1]
   const size=Number(css?.match(/([0-9.]+)px/)?.[1]??a['font-size']??16)
   const weight=css?.match(/(?:^| )(\d{3})(?: |$)/)?.[1]??a['font-weight']??'400'
   ctx.font=`${css?.includes('italic')?'italic ':''}${weight} ${size}px "Songti SC"`
   ctx.textAlign=({middle:'center',end:'right',start:'left'} as const)[a['text-anchor'] as 'middle']??'left'
   ctx.textBaseline=({central:'middle',hanging:'hanging','text-after-edge':'bottom'} as const)[a['dominant-baseline'] as 'central']??'alphabetic'
   if(a.transform){const m=a.transform.match(/matrix\(([^)]+)\)/)?.[1].split(/[ ,]+/).map(Number);if(m)ctx.transform(m[0],m[1],m[2],m[3],m[4],m[5])}
   const x=Number(a.x??0),y=Number(a.y??0)
   ctx.globalAlpha=Number(a.opacity??1)
   if(a.stroke && a.stroke!=='none'){ctx.strokeStyle=a.stroke;ctx.lineWidth=Number(a['stroke-width']??1);ctx.lineJoin='round';ctx.globalAlpha*=Number(a['stroke-opacity']??1);ctx.strokeText(text,x,y)}
   if(a.fill!=='none'){ctx.fillStyle=a.fill??'#000';ctx.globalAlpha=Number(a.opacity??1)*Number(a['fill-opacity']??1);ctx.fillText(text,x,y)}
   const fragment=canvas.getContent().toString().replace(/^<\?xml[^]*?\?>/,'').replace(/^\s*<svg[^>]*>/,'').replace(/<\/svg>\s*$/,'')
   return `<g aria-label="${escapeXml(text)}" transform="translate(${-w} ${-h})">${fragment}</g>`
 })
}
export async function png(svg:string) {
 const image=await loadImage(Buffer.from(svg));const canvas=createCanvas(image.width,image.height)
 canvas.getContext('2d').drawImage(image,0,0)
 return canvas.toBuffer('image/png')
}
export const digest=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex')
export const nativeThemes=()=>THEMES.map(({id,name})=>({id,name}))
