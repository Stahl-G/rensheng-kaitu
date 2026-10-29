import { createHash } from 'node:crypto'
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { serialize, deserialize } from 'node:v8'
import type { Progress } from '../src/gen/world.js'

import { generateTerrain, terrainCacheInput, THEME_CONFIG, type Terrain } from './terrain.js'
export { GENERATOR_VERSION, UPSTREAM_SHA, THEME_CONFIG, mainland } from './terrain.js'
export type { Anchor, Terrain } from './terrain.js'
export function cacheKey(seed:string, variant:number, config=THEME_CONFIG) {
 return createHash('sha256').update(terrainCacheInput(seed,variant,config)).digest('hex').slice(0,24)
}
function atomic(path:string, bytes:string|Buffer) {const tmp=path+`.${process.pid}.tmp`;writeFileSync(tmp,bytes,{mode:0o600});renameSync(tmp,path)}
export function getTerrain(dir:string, seed:string, variant=0, progress?:Progress,config=THEME_CONFIG): {terrain:Terrain;cacheHit:boolean;key:string} {
 mkdirSync(dir,{recursive:true,mode:0o700})
 const key=cacheKey(seed,variant,config), path=join(dir,`${key}.terrain`)
 if(existsSync(path)) return {terrain:deserialize(readFileSync(path)),cacheHit:true,key}
 const terrain=generateTerrain(seed,variant,progress,config)
 atomic(path,serialize(terrain));return {terrain,cacheHit:false,key}
}
export { atomic }
