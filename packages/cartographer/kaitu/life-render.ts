import { escapeXml as esc, wrap } from './render.js'
import type { MappedDomain, DomainScore } from './domains.js'
import type { RegionMap } from './regions.js'
import { compassSpot } from '../src/render/atlas/index.js'
import { themeById,type StyleId } from '../src/render/atlas/styles.js'
export interface ViewDomain extends MappedDomain {slot:number;score:DomainScore}
export interface MapView {
 revision:string;title:string;terrainKey:string;terrainImage:string;generatedAt:string
 style?:StyleId;compassScale?:number
 width:number;height:number;margin:number;regions:RegionMap;domains:ViewDomain[];coverage:number|null;gaps:string[]
}
const colors=['#7d8f65','#ad885a','#8b9a88','#b3966d','#8a9c9f','#b08a80','#b6a37f','#9b9b76','#9d8a6e','#92958b','#a8a286','#a5937d']
function label(d:ViewDomain,p:RegionMap['provinces'][number],style:StyleId){
 const foreground=style==='teyvat'?'#fbf7e8':'#493a29',halo=style==='teyvat'?'#244840':'#efe2bf'
 const text=(s:string,y:number,size:number,weight=400)=>`<text x="${p.x}" y="${p.y+y}" font-size="${size}" font-weight="${weight}" text-anchor="middle" fill="${foreground}" stroke="${halo}" stroke-width="4" paint-order="stroke" stroke-linejoin="round">${esc(s)}</text>`
 const lines=wrap(d.title,210,27,2)
 return `<g class="region-label" data-label="${esc(d.id)}" pointer-events="none" font-family="Songti SC,serif"><path d="M${p.x} ${p.y-37-(lines.length-1)*29}l4 5-4 5-4-5Z" fill="#826b44"/>${lines.map((s,i)=>text(s,-6-(lines.length-1-i)*29,27,600)).join('')}</g>`
}
function progressCompass(view:MapView){
 const spot=compassSpot(themeById(view.style??'fantasy'),2,view.width-view.margin*2,view.height-view.margin*2)
 const x=spot.cx,y=spot.cy,r=Math.max(32,spot.r*(view.compassScale??.55)*.87),c=2*Math.PI*r
 const percentage=view.coverage===null?'待了解':Math.round(view.coverage*100)+'%'
 return `<g id="progress-compass" transform="translate(${x} ${y})" pointer-events="none" role="img" aria-label="档案完善度 ${percentage}"><circle r="${r}" fill="none" stroke="#b2a480" stroke-width="3.5"/><circle r="${r}" fill="none" stroke="#6f8056" stroke-width="4.5" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c*(1-(view.coverage??0))}" transform="rotate(-90)"/><circle r="20" fill="#eadbb6" stroke="#a3926d" stroke-width=".8"/><text x="0" y="5" text-anchor="middle" font-size="15" font-weight="600" fill="#4f593e">${percentage}</text><text x="0" y="${r+30}" text-anchor="middle" font-size="14" fill="${view.style==='teyvat'?'#efe2bf':'#7c6d50'}">档案完善度</text></g>`
}
/** Province geometry, haze and labels are separate from the cached native raster. */
export function overlay(view:MapView,interactive=false){
 const {regions,domains,margin}=view
 return `<g transform="translate(${margin} ${margin})"><g id="coverage-layer">${regions.provinces.map(p=>{
  const d=domains.find(d=>d.slot===p.slot),clarity=d?.score.clarity??.12
  return `<path d="${p.path}" fill="#efe5ca" fill-opacity="${(.78*(1-clarity)).toFixed(3)}" fill-rule="evenodd"/>`
 }).join('')}</g><path d="${regions.borders}" fill="none" stroke="#8b7758" stroke-width=".9" stroke-opacity=".24"/><g id="province-layer">${domains.map(d=>{
  const p=regions.provinces[d.slot]
  return `<path class="province" data-region="${esc(d.id)}" d="${p.path}" fill="${colors[d.slot]}" fill-opacity=".13" stroke="#86724f" stroke-width="1.1" stroke-opacity=".55" fill-rule="evenodd" ${interactive?`role="button" tabindex="0" aria-label="${esc(d.title)}，点击查看资料" aria-pressed="false"`:''}/>`
 }).join('')}</g><g id="label-layer">${domains.map(d=>label(d,regions.provinces[d.slot],view.style??'fantasy')).join('')}</g>${progressCompass(view)}</g>`
}
export function exportSvg(view:MapView,native:string){
 return native.replace('</svg>',`${overlay(view)}</svg>`)
}
