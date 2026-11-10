import { createHash } from 'node:crypto'
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { serialize, deserialize } from 'node:v8'
import { generateWorld, type Progress } from '../src/gen/world.js'
import { DEFAULT_PARAMS, type World } from '../src/gen/types.js'
import { RNG, hashString } from '../src/gen/rng.js'

export const UPSTREAM_SHA='e8c8db8919abe6a074e4d72e2f431e46bf93f2d1'
export const GENERATOR_VERSION='kaitu-desktop-0.2.1'
export const THEME_CONFIG={width:640,height:400,landRatio:.58,plates:8,mountains:.65,erosion:.75,rainfall:.85,coastRoughness:.18,sketch:'mainland-v1'}
export interface Anchor {x:number;y:number}
export interface Terrain {world:World;anchors:Anchor[]}
export function cacheKey(seed:string, variant:number, config=THEME_CONFIG) {
 return createHash('sha256').update(JSON.stringify({seed,variant,generator:GENERATOR_VERSION,upstream:UPSTREAM_SHA,config})).digest('hex').slice(0,24)
}
function atomic(path:string, bytes:string|Buffer) {const tmp=path+`.${process.pid}.tmp`;writeFileSync(tmp,bytes,{mode:0o600});renameSync(tmp,path)}
/** A seeded land intention uses upstream sketch → erosion → hydrology; no replacement terrain algorithm. */
export function mainland(seed:string,variant:number,W:number,H:number,landRatio=.58) {
 const rng=new RNG(hashString(`${seed}#mainland${variant}`)),phase=rng.range(0,Math.PI*2)
 const land=new Float32Array(W*H)
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){
  const radius=.405*Math.sqrt(landRatio/.58),dx=(x/W-.5)/radius,dy=(y/H-.51)/radius,a=Math.atan2(dy,dx)
  const coast=1+.065*Math.sin(a*3+phase)+.045*Math.cos(a*5-phase)
  land[y*W+x]=Math.hypot(dx,dy)<coast?1:0
 }
 const jitter=()=>rng.range(-.025,.025)
 return {land,ranges:[
  {pts:[W*(.26+jitter()),H*.32,W*.32,H*.43,W*.34,H*.58],height:.65,width:95},
  {pts:[W*.57,H*.21,W*.67,H*.29,W*(.73+jitter()),H*.40],height:.55,width:80}
 ]}
}
export function getTerrain(dir:string, seed:string, variant=0, progress?:Progress,config=THEME_CONFIG): {terrain:Terrain;cacheHit:boolean;key:string} {
 mkdirSync(dir,{recursive:true,mode:0o700})
 const key=cacheKey(seed,variant,config), path=join(dir,`${key}.terrain`)
 if(existsSync(path)) return {terrain:deserialize(readFileSync(path)),cacheHit:true,key}
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
 const terrain={world,anchors};atomic(path,serialize(terrain));return {terrain,cacheHit:false,key}
}
