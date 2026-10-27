import { MinHeap } from '../src/gen/util.js'
import { contours, categoryBorders, pathData } from '../src/render/atlas/svg/contour.js'
import type { Terrain } from './core.js'
import { territoryStep } from '../src/gen/political.js'
import { reliefKm } from '../src/gen/types.js'
import { riverThreshold } from '../src/gen/world.js'
import { RNG,hashString } from '../src/gen/rng.js'

export const REGION_VERSION='terrain-provinces-v2'

export interface Province {slot:number; path:string; x:number; y:number; cells:number}
export interface RegionMap {provinces:Province[]; borders:string; land:string; mainLandShare:number}

/** Permanent terrain slots. Multi-source shortest paths keep each mainland region connected.
 * All slots exist before data is assigned, so new domains never cut an existing province. */
export function buildRegions(terrain:Terrain):RegionMap {
 const {world,anchors}=terrain,{W,H,elevation}=world,N=W*H
 const owner=new Int16Array(N).fill(-1),dist=new Float64Array(N).fill(Infinity),q=new MinHeap(N)
 const step=territoryStep(elevation,world.flow,W,H,reliefKm(world),riverThreshold(W),H*.18,new RNG(hashString(world.params.seed+'#life-provinces')))
 for(let slot=0;slot<anchors.length;slot++){
  const a=anchors[slot],i=Math.round(a.y)*W+Math.round(a.x)
  owner[i]=slot;dist[i]=0;q.push(0,i)
 }
 while(q.size){
  const i=q.pop();if(q.lastKey!==dist[i])continue
  const x=i%W,y=Math.floor(i/W)
  for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]]){
   const nx=x+dx,ny=y+dy;if(nx<0||nx>=W||ny<0||ny>=H)continue
   const j=ny*W+nx;if(elevation[j]<=0)continue
   const cost=dist[i]+Math.hypot(dx,dy)*step(i,j)
   if(cost<dist[j]){dist[j]=cost;owner[j]=owner[i];q.push(cost,j)}
  }
 }
 let landCount=0,reached=0
 for(let i=0;i<N;i++)if(elevation[i]>0){landCount++;if(owner[i]>=0)reached++}
 const provinces=anchors.map((a,slot)=>{
  const mask=new Uint8Array(N);let cells=0
  for(let i=0;i<N;i++)if(owner[i]===slot){mask[i]=1;cells++}
  // The same upstream-smoothed path drives hit area, fog, highlight and border.
  return {slot,path:pathData(contours(mask,W,H,.5),2,{closed:true,tol:.65,smooth:true}),x:a.x*2,y:a.y*2,cells}
 })
 const land=new Uint8Array(N);for(let i=0;i<N;i++)land[i]=elevation[i]>0?1:0
 return {provinces,borders:pathData(categoryBorders(owner,W,H),2,{closed:false,tol:.65,smooth:true}),land:pathData(contours(land,W,H,.5),2,{closed:true,tol:.2,smooth:true}),mainLandShare:reached/Math.max(1,landCount)}
}
