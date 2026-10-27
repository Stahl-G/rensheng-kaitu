import { getTerrain, GENERATOR_VERSION, UPSTREAM_SHA } from './core.js'
import { buildRegions, REGION_VERSION } from './regions.js'
import { renderNative } from './render.js'
import { marginOf, compassSpot } from '../src/render/atlas/index.js'
import { themeById } from '../src/render/atlas/styles.js'
import { type MapSettings } from './settings.js'
import { THEME_CONFIG } from './core.js'
export { settings, PARAMETER_PORTS, STYLE_PORTS } from './settings.js'
export type { MapSettings } from './settings.js'
export type { RegionMap } from './regions.js'
export { mapDomains, scoreDomain, totalCoverage } from './domains.js'
export type { DomainRule, DomainScore, MappedDomain, DomainPlan } from './domains.js'
export type { Fact, LifeData } from './workspace.js'

/** Called only inside a desktop worker. Terrain cache contains no personal records. */
export function generateAtlas(cache: string, seed: string, variant: number, input: MapSettings,
 progress?: (stage: string, fraction: number) => void) {
 const selected = input
 const result = getTerrain(cache,seed,variant,progress,{...THEME_CONFIG,...selected.terrain})
 const regions = buildRegions(result.terrain)
 const svg = renderNative(result.terrain,selected.style,'',true,selected)
 const dimensions = svg.match(/width="([0-9.]+)" height="([0-9.]+)"/)!
 const width=Number(dimensions[1]),height=Number(dimensions[2]),theme=themeById(selected.style),margin=marginOf(theme,2)
 return {key:result.key,seed,variant,settings:selected,generator:GENERATOR_VERSION,upstream:UPSTREAM_SHA,regionVersion:REGION_VERSION,
   svg,regions,width,height,margin,compass:compassSpot(theme,2,width-margin*2,height-margin*2),terrainCacheHit:result.cacheHit}
}
export type AtlasResource=ReturnType<typeof generateAtlas>
