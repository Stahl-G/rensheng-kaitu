export type FactKind = 'project' | 'goal' | 'experience' | 'plan' | 'topic' | 'context'
export interface Fact {
  id: string; title: string; kind: FactKind; status: string; source: string; updated?: string
  /** Derived event time for a verified real activity; never a file modification timestamp. */
  actualActivityAt?: string
  progress?: { current: number; target: number; unit: string }
  detail?: string
}
export interface Domain { id: string; title: string; facts: Fact[]; priority?: number }
export interface LifeData { title: string; domains: Domain[]; sources: string[]; bytesRead: number; gaps: string[] }
