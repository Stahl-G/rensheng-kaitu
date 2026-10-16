import type {
  FinanceImportOptions,
  FinanceViewOptions,
  commitFinanceImport,
  financeAccounts,
  financeCashflow,
  financeInvestments,
  financeOverview,
  previewFinanceImport,
  readHealthPage,
} from "@kaitu/core";
export type HealthData = ReturnType<typeof readHealthPage>;
export type {
  ExperienceImportsData,
  ExperienceBatchPreview,
  ExplorationData,
  ExplorationCommand,
  Direction,
  ExplorationExperiment,
  DirectionNote,
  ExplorationReference,
  ExperienceSource,
  LifeMapData,
  LifeMapFeature,
  Experience,
  ExperienceChanges,
  City,
  DoingData,
} from "@kaitu/core";

/** 浏览器与 Host 的只读总览契约。 */
export interface OverviewSource {
  file: string;
  text: string;
}

export type { NewsVia, NewsPost, NewsDiscussion } from "@kaitu/core";
import type { NewsContent, NewsVia, TrendContent } from "@kaitu/core";
export interface NewsItem extends NewsContent {
  id: string;
}
export interface NewsTrend extends TrendContent {
  id: string;
}
export interface NewsData {
  date: string;
  picked: NewsItem[];
  trends: NewsTrend[];
  others: NewsItem[];
  sources: Partial<Record<NewsVia, number>>;
  keywords: string[] | null;
  feedCount: number | null;
  moduleNames: Record<string, string>;
}
export interface NewsAction {
  id: string;
  status: "tried" | "dismissed";
  version: string | null;
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
  daily: { date: string; value: number | null }[];
  target: number[] | null;
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
  section: string;
  module: string;
  file: string;
}
export interface OverviewVersion {
  oid: string;
  short: string;
  message: string;
  text: string;
  time: string;
  source: "user" | "agent" | "cloud" | "unknown";
  actor: string | null;
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
  daily: { date: string; words: number | null; commits: number | null }[];
  from: string;
  to: string;
}
export interface OverviewData {
  sections: { id: string; label: string; count: number; latest: string | null }[];
  root: string;
  timeZone: string;
  today: string;
  cutoff: string;
  drive: boolean;
  empty: boolean;
  blocks: OverviewBlock[];
  next: OverviewNext[];
  allNext: OverviewNext[];
  sync: {
    received: number;
    needsReview: number;
    mapNeedsReview: number;
    mapPendingImports: number;
    directionSuggestions: number;
    updatedAt: string | null;
  };
  versions: OverviewVersion[];
  daily: OverviewDaily | null;
  projects: OverviewProject[];
  metrics: OverviewMetric[];
  pending: number;
  inboxNotes: number;
  notes: (OverviewSource & { status: "received" | "needs_review" })[];
  warnings: string[];
}

export interface DoingProject {
  slug: string;
  title: string;
  stage: "idea" | "active" | "paused" | "done";
  kind: "work" | "personal";
  links: { path: string; role: "manuscript" | "repo" | "folder" }[];
  recentLog: { date: string; text: string } | null;
  recent7: {
    words: number | null;
    commits: number | null;
    daily: { date: string; words: number | null; commits: number | null }[];
  };
  next: { id: string; title: string; status: "todo" | "proposed" | "done" | "skipped" }[];
  completion: { done: number; total: number; basis: "progress" | "tasks" } | null;
  github: {
    repo: string;
    url: string;
    latest: {
      stars: number;
      forks: number;
      open_issues: number;
      open_prs: number;
      default_branch: string;
      archived: boolean;
      pushed_at: string | null;
      latest_release: { tag: string; name: string; published_at: string; url: string } | null;
      commits: { sha: string; title: string; date: string }[];
      ci: {
        state: "success" | "failure" | "running" | "none" | "no_access";
        run_at: string | null;
        url: string | null;
      };
      ts: string;
    } | null;
    stale: boolean;
    problem: "gone_or_forbidden" | "rate_limited" | "network" | "archived" | "renamed" | null;
    ok_at: string | null;
    since: string | null;
    history: { date: string; stars: number; forks: number; open_issues: number; open_prs: number }[];
  } | null;
}

/** 财务边界类型从 core 派生，供生成器为浏览器导入具名契约。 */
export interface FinanceRemoteViewOptions extends FinanceViewOptions {}
export interface FinanceRemoteImportOptions extends FinanceImportOptions {}
export interface FinanceRemoteCommitOptions extends FinanceRemoteImportOptions {
  account: string;
}
export type FinanceOverviewData = ReturnType<typeof financeOverview>;
export type FinanceCashflowData = ReturnType<typeof financeCashflow>;
export type FinanceInvestmentsData = ReturnType<typeof financeInvestments>;
export type FinanceAccountsData = ReturnType<typeof financeAccounts>;
export type FinanceImportPreviewData = { file: string; preview: ReturnType<typeof previewFinanceImport> };
export type FinanceImportCommitData = Awaited<ReturnType<typeof commitFinanceImport>>;
export type { MeGoal, MeRules, MeData } from "@kaitu/core";

export type { CalendarData, CalendarEntry, AutomationSettings, AutomationKey } from "@kaitu/core";

export type { LibraryData, InboxEntry } from "@kaitu/core";
