import type { Domain, Fact, LifeData } from './workspace.js'

export interface Facet {
 id: string; label: string; factIds: string[]; applicable?: boolean
 /** Optional kind selector is limited to this domain's evidence. */
 kinds?: Fact['kind'][]
}
export interface DomainRule {
 id: string; title: string; priority?: number
 temporal: {kind:'live'|'historical'; cadenceDays?:number}
 includeDomains?: string[]; factIds?: string[]; facets: Facet[]
}
/** Local Agent output contract, independent of the original workspace schema. No cloud calls. */
export interface DomainPlan {version:1; modules?:string[]; discover?:boolean; domains:DomainRule[]}
export interface MappedDomain extends Domain {
 temporal:DomainRule['temporal']; facets:(Facet & {evidence:Fact[]})[]
}
export interface DomainScore {coverage:number|null; freshness:number|null; clarity:number; glow?:number; latest:string|null; missing:string[]}
const safeId=/^[\p{L}\p{N}][\p{L}\p{N}_-]{0,79}$/u
const uncertain=new Set(['unknown','inferred','needs_review','suggested','planned'])
const dedupe=(facts:Fact[])=>[...new Map(facts.map(f=>[f.id,f])).values()]

export function validatePlan(plan:DomainPlan) {
 if(plan.version!==1||!Array.isArray(plan.domains)||plan.domains.length>12)throw new Error('Domain plan must be version 1 with at most 12 domains.')
 const ids=new Set<string>()
 for(const d of plan.domains){
  if(!safeId.test(d.id)||ids.has(d.id)||!d.title?.trim()||d.title.length>80)throw new Error('Invalid or duplicate domain identity.')
  ids.add(d.id)
  if(!['live','historical'].includes(d.temporal?.kind))throw new Error(`Missing temporal policy: ${d.id}`)
  if(d.temporal.kind==='live'&&(!Number.isFinite(d.temporal.cadenceDays)||d.temporal.cadenceDays!<1))throw new Error(`Invalid update cadence: ${d.id}`)
  if(!Array.isArray(d.facets)||d.facets.length>16||new Set(d.facets.map(f=>f.id)).size!==d.facets.length)throw new Error(`Invalid coverage facets: ${d.id}`)
  for(const f of d.facets)if(!f.id||!f.label||!Array.isArray(f.factIds))throw new Error(`Invalid evidence facet: ${d.id}`)
 }
}
function defaultRule(d:Domain):DomainRule {
 const historical=d.id==='experience'||(d.facts.length>0&&d.facts.every(f=>f.kind==='experience'))
 return {id:d.id,title:d.title||'待整理领域',priority:d.priority,includeDomains:[d.id],temporal:historical?{kind:'historical'}:{kind:'live',cadenceDays:14},facets:historical?[
  {id:'records',label:'已确认经历',factIds:[],kinds:['experience']},
  {id:'context',label:'经历细节与时间',factIds:[]}
 ]:[
  {id:'focus',label:'关注事项',factIds:d.facts.map(f=>f.id)},
  {id:'state',label:'近期状态',factIds:[],kinds:['project','context']},
  {id:'next',label:'下一步方向',factIds:[],kinds:['goal','plan']},
  {id:'evidence',label:'实际进展记录',factIds:d.facts.filter(f=>f.progress).map(f=>f.id)}
 ]}
}
export function mapDomains(data:LifeData,plan?:DomainPlan):MappedDomain[] {
 if(plan)validatePlan(plan)
 const rules=[...(plan?.domains??[])], claimed=new Set(rules.flatMap(d=>d.includeDomains??[]))
 const explicitIds=new Set(rules.flatMap(d=>d.factIds??[]))
 for(const d of plan?.discover===false?[]:data.domains){
  const remaining={...d,facts:d.facts.filter(f=>!explicitIds.has(f.id))}
  if(!claimed.has(d.id)&&remaining.facts.length&&!rules.some(r=>r.id===d.id))rules.push(defaultRule(remaining))
 }
 const all=new Map(data.domains.flatMap(d=>d.facts).map(f=>[f.id,f]))
 return rules.map(rule=>{
  const facts=dedupe([
   ...data.domains.filter(d=>rule.includeDomains?.includes(d.id)).flatMap(d=>d.facts),
   ...(rule.factIds??[]).map(id=>all.get(id)).filter((f):f is Fact=>!!f)
  ])
  return {id:rule.id,title:rule.title,priority:rule.priority,facts,temporal:rule.temporal,facets:rule.facets.map(f=>({...f,evidence:dedupe(facts.filter(item=>f.factIds.includes(item.id)||f.kinds?.includes(item.kind))).filter(f=>(!uncertain.has(f.status)||(f.status==='planned'&&(f.kind==='plan'||f.kind==='goal'))))}))}
 })
}
/** Semantic dimensions count once; duplicating uploads/facts never increases coverage. */
export function scoreDomain(domain:MappedDomain,now:Date):DomainScore {
 const applicable=domain.facets.filter(f=>f.applicable!==false),known=applicable.filter(f=>f.evidence.length)
 const coverage=applicable.length?known.length/applicable.length:null
 const dates=domain.facts.map(f=>Date.parse(f.updated??'')).filter(n=>Number.isFinite(n)&&n<=now.getTime())
 const latest=dates.length?new Date(Math.max(...dates)).toISOString().slice(0,10):null
 let freshness:number|null=domain.temporal.kind==='historical'?1:null
 if(domain.temporal.kind==='live'&&known.length){
  const scores=known.flatMap(f=>{
   const times=f.evidence.map(e=>Date.parse(e.updated??'')).filter(n=>Number.isFinite(n)&&n<=now.getTime())
   if(!times.length)return []
   const age=Math.max(0,(now.getTime()-Math.max(...times))/86400000),cadence=domain.temporal.cadenceDays??14
   return [Math.max(.12,Math.pow(.5,Math.max(0,age-cadence)/cadence))]
  })
  // Undated evidence stays explicitly unknown; it is never stamped as today's data.
  freshness=scores.length?scores.reduce((a,b)=>a+b,0)/known.length:null
 }
 const activityDates=domain.facts.filter(f=>!uncertain.has(f.status)).map(f=>Date.parse(f.actualActivityAt??'')).filter(n=>Number.isFinite(n)&&n<=now.getTime())
 const hasExperience=domain.facts.some(f=>f.kind==='experience'&&['observed','user_reported'].includes(f.status))
 const clarity=hasExperience||activityDates.length?1:.18
 const glow=activityDates.some(n=>now.getTime()-n<7*86400000)?1:0
 return {coverage,freshness,clarity,glow,latest,missing:applicable.filter(f=>!f.evidence.length).map(f=>f.label)}
}
export function totalCoverage(domains:MappedDomain[]) {
 const applicable=domains.flatMap(d=>d.facets).filter(f=>f.applicable!==false)
 return applicable.length?applicable.filter(f=>f.evidence.length).length/applicable.length:null
}
