import { generateWorld, type Progress } from '../src/gen/world.js'
import { DEFAULT_PARAMS, type World } from '../src/gen/types.js'
import { RNG, hashString } from '../src/gen/rng.js'

export const UPSTREAM_SHA='e8c8db8919abe6a074e4d72e2f431e46bf93f2d1'
export const GENERATOR_VERSION='kaitu-desktop-0.2.2'
export const THEME_CONFIG={width:640,height:400,landRatio:.58,plates:8,mountains:.65,erosion:.75,rainfall:.85,coastRoughness:.18,sketch:'mainland-v2'}
export interface Anchor {x:number;y:number}
export interface Terrain {world:World;anchors:Anchor[]}
/** A seeded land intention uses upstream sketch → erosion → hydrology; no replacement terrain algorithm. */
export function mainland(seed:string,variant:number,W:number,H:number,landRatio=.58) {
 const rng=new RNG(hashString(`${seed}#mainland${variant}`))
 const phase=()=>rng.range(0,Math.PI*2)
 const rotation=phase(),p1=phase(),p2=phase(),p3=phase()
 const lobes=rng.int(2,5),stretch=rng.range(.92,1.08)
 const radius=.36*Math.sqrt(landRatio/.58),cx=rng.range(.47,.53),cy=rng.range(.47,.53)
 const land=new Float32Array(W*H)
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){
  const dx=(x/W-cx)/radius,dy=(y/H-cy)/radius
  const u=(dx*Math.cos(rotation)+dy*Math.sin(rotation))/stretch
  const v=(-dx*Math.sin(rotation)+dy*Math.cos(rotation))*stretch,a=Math.atan2(v,u)
  const coast=.90+.14*Math.sin(a*lobes+p1)+.10*Math.cos(a*(lobes+1)+p2)+.08*Math.sin(a*7+p3)
  land[y*W+x]=Math.hypot(u,v)<coast?1:0
 }
 const jitter=()=>rng.range(-.025,.025)
 return {land,ranges:[
  {pts:[W*(.26+jitter()),H*.32,W*.32,H*.43,W*.34,H*.58],height:.65,width:95},
  {pts:[W*.57,H*.21,W*.67,H*.29,W*(.73+jitter()),H*.40],height:.55,width:80}
 ]}
}
/** Same procedural terrain and fixed slots in browser and desktop; persistence stays with the host. */
export function generateTerrain(seed:string, variant=0, progress?:Progress, config=THEME_CONFIG):Terrain {
 const world=generateWorld({...DEFAULT_PARAMS,...config,seed,terrainVariant:variant,settlements:false},progress,{sketch:mainland(seed,variant,config.width,config.height,config.landRatio),sketchRev:1})
 // Fixed empty slots are selected from terrain only, independently of which domains exist.
 const targets=[[.41,.48],[.62,.48],[.32,.70],[.49,.25],[.70,.70],[.25,.35],[.15,.56],[.43,.84],[.66,.85],[.85,.51],[.76,.25],[.40,.15]]
 const anchors:Anchor[]=[]
 for(const [tx,ty] of targets) {
   let best=-1, score=Infinity
   for(let y=12;y<world.H-12;y+=2)for(let x=12;x<world.W-12;x+=2) {
     const i=y*world.W+x
     if(world.elevation[i]<=.03 || world.water[i]>0 || anchors.some(a=>Math.hypot(a.x-x,a.y-y)<world.H*.105))continue
     const s=Math.hypot((x/world.W-tx),(y/world.H-ty))*2 + Math.max(0,3-world.coastDist[i])*.015
     if(s<score){score=s;best=i}
   }
   if(best<0) throw new Error('当前地形放不下全部区域，请提高大陆面积或降低海岸曲折程度后重试。')
   anchors.push({x:best%world.W,y:Math.floor(best/world.W)})
 }
 return {world,anchors}
}
export function terrainCacheInput(seed:string,variant:number,config=THEME_CONFIG) {
 return JSON.stringify({seed,variant,generator:GENERATOR_VERSION,upstream:UPSTREAM_SHA,config})
}
