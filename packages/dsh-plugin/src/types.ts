/** 浏览器与 Host 的只读总览契约。 */
export interface OverviewSource {
  file: string;
  text: string;
}
export interface OverviewMetric {
  key: string;
  label: string;
  unit: string;
  value: number | null;
  days: number;
  estimated: boolean;
  from: string | null;
  to: string | null;
  cutoff: string;
  latest: string | null;
  sources: OverviewSource[];
}
export interface OverviewBlock {
  id: string;
  title: string;
  kind: "event" | "proposal" | "task";
  status: "confirmed" | "pending" | "done" | "skipped" | "rejected";
  start?: string;
  end?: string;
  module?: string;
  ref?: string;
}
export interface OverviewNext {
  id: string;
  title: string;
  proposed: boolean;
  module: string;
  file: string;
}
export interface OverviewVersion {
  oid: string;
  short: string;
  message: string;
  time: string;
  source: "user" | "agent" | "cloud" | "unknown";
}
export interface OverviewDaily {
  file: string;
  date: string;
  organizer: string;
  body: string;
  unresolved: number;
}
export interface OverviewProject {
  metricFiles: string[];
  slug: string;
  title: string;
  file: string;
  next: string[];
  words: number | null;
  commits: number | null;
  from: string;
  to: string;
}
export interface OverviewData {
  root: string;
  timeZone: string;
  today: string;
  cutoff: string;
  drive: boolean;
  empty: boolean;
  blocks: OverviewBlock[];
  next: OverviewNext[];
  versions: OverviewVersion[];
  daily: OverviewDaily | null;
  projects: OverviewProject[];
  metrics: OverviewMetric[];
  pending: number;
  inboxNotes: number;
  notes: OverviewSource[];
  warnings: string[];
}
