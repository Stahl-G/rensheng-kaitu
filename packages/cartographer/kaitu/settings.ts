import type { StyleId } from '../src/render/atlas/styles.js'
export const PARAMETER_PORTS={
 landRatio:{label:'大陆面积',min:.35,max:.72,default:.58},
 mountains:{label:'山脉起伏',min:.2,max:1.6,default:.65},
 coastRoughness:{label:'海岸曲折',min:0,max:.7,default:.18},
 erosion:{label:'地形侵蚀',min:.2,max:1.5,default:.75},
 rainfall:{label:'水系丰沛程度',min:.2,max:1.8,default:.85},
 plates:{label:'构造板块',min:4,max:24,default:8,integer:true}
} as const
export type TerrainSettings={ [K in keyof typeof PARAMETER_PORTS]:number }
export interface MapSettings {version:1;style:StyleId;terrain:TerrainSettings;glyphDensity:number;compassScale:number}
export const STYLE_PORTS:StyleId[]=['fantasy','ink','topo','teyvat','physical','nautical','political','strategy']
export function settings(input:any={}):MapSettings {
 const defaults=Object.fromEntries(Object.entries(PARAMETER_PORTS).map(([k,v])=>[k,v.default]))
 const out={version:1 as const,style:input.style??'fantasy',terrain:{...defaults,...input.terrain} as TerrainSettings,glyphDensity:input.glyphDensity??.24,compassScale:input.compassScale??.55}
 if(input.version!==undefined&&input.version!==1)throw Error('Unsupported map settings version')
 for(const key of Object.keys(input))if(!['version','style','terrain','glyphDensity','compassScale'].includes(key))throw Error(`Unknown map setting: ${key}`)
 if(!STYLE_PORTS.includes(out.style))throw Error('Unknown native map style')
 for(const [key,value] of Object.entries(out.terrain)){
  const spec=PARAMETER_PORTS[key as keyof TerrainSettings]
  if(!spec||!Number.isFinite(value)||value<spec.min||value>spec.max||('integer' in spec&&!Number.isInteger(value)))throw Error(`Invalid terrain parameter: ${key}`)
 }
 if(!Number.isFinite(out.glyphDensity)||out.glyphDensity<0||out.glyphDensity>1)throw Error('glyphDensity must be between 0 and 1')
 if(!Number.isFinite(out.compassScale)||out.compassScale<.4||out.compassScale>1)throw Error('compassScale must be between .4 and 1')
 return out
}
