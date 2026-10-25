import type {
  Experience,
  ExperienceChanges,
  ExplorationCommand,
  ExplorationData,
  HandoverPack,
  LibraryQuery,
  NewsData,
  NewsFeedback,
  NewsItem,
  NoteSearchResult,
} from "@kaitu/core";
import { experienceLayer } from "@kaitu/core/experience-time";
import type {
  DoingProject,
  HealthData,
  InboxEntry,
  LibraryData,
  LifeMapData,
  OverviewData,
  OverviewMetric,
  OverviewNext,
} from "../types.js";

// This is disposable browser demo state, never a Kaitu workspace or a new record format.
const key = "kaitu:testsite:v1";
export const taskTitle = "给业余项目约一次 20 分钟的用户访谈";
const goalTitle = "做出一个有人愿意用的业余项目";
export type DemoMode = "new" | "data" | "pending";
export const sampleNote = "示例：今晚走了三公里，明天想试试早点出门。";
export const documents = [
  {
    file: "learning/interview/STATUS.md",
    title: "第一次用户访谈",
    kind: "笔记" as const,
    status: "先问对方最近一次怎么解决问题",
    body: "# 第一次用户访谈\n\n这是小林的笔记。先问对方最近一次遇到问题的经过，再问用了什么办法。不要先介绍自己的产品。\n\n下一步：约一位朋友聊 20 分钟，把原话记下来。",
  },
  {
    file: "decisions/hangzhou/STATUS.md",
    title: "要不要搬去杭州",
    kind: "决定" as const,
    status: "先短住，再决定",
    body: "# 要不要搬去杭州\n\n小林的决定：先安排一个周末短住，观察通勤和生活节奏。上海的工作暂时保持，预算还需要核对。",
  },
];
type State = {
  version: 1;
  notes: InboxEntry[];
  task: "proposed" | "open" | "done" | "skipped";
  result: string;
  exploration?: ExplorationData;
  experiences?: Experience[];
  hidden?: string[];
  hometown?: Experience["place"];
  newsFeedback?: Record<string, NewsFeedback>;
  newsTasks?: Record<string, "proposed" | "open" | "done" | "skipped">;
  newsStatus?: Record<string, "new" | "tried" | "dismissed">;
  keywords?: string[];
};
function seed(): State {
  return {
    version: 1,
    notes: [
      {
        file: "inbox/notes/sample.md",
        text: "小林：想重新开始训练，也想每周给业余项目留一点时间。",
        source: "me",
        originalSource: null,
        date: new Date().toISOString(),
        status: "raw",
        destination: null,
      },
    ],
    task: "proposed",
    result: "",
  };
}
const emptyState = (): State => ({ version: 1, notes: [], task: "skipped", result: "" });
let state: State = { ...seed(), task: "open" };
let changedAt = Date.now();
let storageError = "";
try {
  const saved = sessionStorage.getItem(key);
  if (saved) {
    const value = JSON.parse(saved) as State;
    if (
      value.version !== 1 ||
      !Array.isArray(value.notes) ||
      value.notes.length > 500 ||
      !value.notes.every(
        (note) =>
          typeof note.file === "string" &&
          typeof note.text === "string" &&
          note.source === "me" &&
          note.status === "raw",
      ) ||
      !["proposed", "open", "done", "skipped"].includes(value.task) ||
      typeof value.result !== "string"
    )
      throw new Error("Invalid demo state");
    state = value;
  }
} catch {
  storageError = "无法读取本标签页的示例状态，请重置后重试。 / Cannot read demo state. Reset to continue.";
}
const listeners = new Set<() => void>();
export const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const snapshot = () => state;
export const loadError = () => storageError;
function commit(next: State) {
  if (storageError) throw new Error(storageError);
  try {
    sessionStorage.setItem(key, JSON.stringify(next));
  } catch {
    throw new Error(
      "浏览器未能保存，本次操作未完成。请允许标签页存储或重置后重试。 / Browser storage failed. The change was not saved.",
    );
  }
  state = next;
  changedAt = Math.max(Date.now(), changedAt + 1);
  for (const listener of listeners) listener();
}
export function reset() {
  // Do not clear any other application or website state on this origin.
  sessionStorage.removeItem(key);
  storageError = "";
  state = seed();
  changedAt = Math.max(Date.now(), changedAt + 1);
  for (const listener of listeners) listener();
}
export function clear() {
  // Keep the existing v1 shape, and never touch unrelated origin storage.
  const next = emptyState();
  try {
    sessionStorage.setItem(key, JSON.stringify(next));
  } catch {
    throw new Error("浏览器未能清除示例。 / Browser could not clear the demo.");
  }
  storageError = "";
  state = next;
  changedAt = Math.max(Date.now(), changedAt + 1);
  for (const listener of listeners) listener();
}
export const mode = (): DemoMode =>
  state.task === "proposed" ? "pending" : state.notes.length ? "data" : "new";
const hasSamples = () => state.notes.some((note) => note.file === "inbox/notes/sample.md");
export function selectMode(next: DemoMode) {
  if (next === "new") return clear();
  if (!hasSamples() && state.notes.length >= 500)
    throw new Error("演示记录已满，请重置后继续。 / Demo is full. Reset to continue.");
  commit({
    ...state,
    notes: hasSamples() ? state.notes : [...state.notes, ...seed().notes],
    task: next === "pending" ? "proposed" : "open",
    result: "",
  });
}
export async function capture(text: string) {
  const trimmed = text.trim();
  if (!trimmed || text.length > 4000)
    throw new Error("请用 1–4000 字的示例文字。 / Use 1–4000 characters of sample text.");
  if (state.notes.length >= 500)
    throw new Error("演示记录已满，请重置后继续。 / Demo is full. Reset to continue.");
  const entry: InboxEntry = {
    file: `inbox/notes/${crypto.randomUUID()}.md`,
    text,
    source: "me",
    originalSource: null,
    date: new Date().toISOString(),
    status: "raw",
    destination: null,
  };
  commit({ ...state, notes: [entry, ...state.notes] });
}
export function adopt(id = "sample-interview") {
  if (id !== "sample-interview") {
    commit({ ...state, newsTasks: { ...state.newsTasks, [id]: "open" } });
    return;
  }
  if (state.task !== "proposed") throw new Error("这条建议已处理。 / Suggestion already handled.");
  commit({ ...state, task: "open" });
}
export function dismiss(id = "sample-interview") {
  if (id !== "sample-interview") {
    commit({ ...state, newsTasks: { ...state.newsTasks, [id]: "skipped" } });
    return;
  }
  if (state.task !== "proposed") throw new Error("这条建议已处理。 / Suggestion already handled.");
  commit({ ...state, task: "skipped" });
}
export function complete(result = state.notes[0]?.text ?? "", id = "sample-interview") {
  if (id !== "sample-interview") {
    commit({ ...state, newsTasks: { ...state.newsTasks, [id]: "done" } });
    return;
  }
  if (state.task !== "open" || !result.trim())
    throw new Error("先采纳下一步，并记一句示例结果。 / Adopt the step and add a sample result first.");
  commit({ ...state, task: "done", result });
}
function dayAgo(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}
export async function projects(): Promise<DoingProject[]> {
  if (!hasSamples()) return [];
  return [
    {
      slug: "sample-project",
      title: "业余项目",
      stage: "active",
      kind: "personal",
      links: [],
      recentLog: { date: dayAgo(1), text: xiaolin.project.log },
      recent7: { words: null, commits: null, daily: [] },
      next: [],
      completion: null,
      github: null,
    },
  ];
}
function metrics(): OverviewMetric[] {
  if (!hasSamples()) return [];
  const h = healthData();
  const from = dayAgo(6);
  const to = dayAgo(0);
  const rows = xiaolin.health;
  const recent = (items: HealthRow[], field = "ts") =>
    items.filter((row) => String(row[field]).slice(0, 10) >= from);
  const specs = [
    {
      key: "workouts",
      label: "训练",
      unit: "次",
      rows: recent(rows.workouts),
      type: "workout",
      daily: h.training.heatmap
        .filter((p) => p.date >= from && p.date <= to)
        .map((p) => ({ date: p.date, value: p.sessions })),
      estimated: false,
    },
    {
      key: "sleep",
      label: "睡眠",
      unit: "小时",
      rows: recent(rows.sleeps, "end"),
      type: "sleep",
      daily: h.sleep.slice(-7),
      estimated: false,
    },
    {
      key: "protein",
      label: "蛋白质",
      unit: "克",
      rows: recent(rows.meals),
      type: "meal",
      daily: h.nutrition.protein,
      estimated: true,
    },
  ];
  return specs.map((spec) => {
    const values = spec.daily.flatMap((p) => (p.value === null ? [] : [p.value]));
    return {
      key: spec.key,
      label: spec.label,
      unit: spec.unit,
      estimated: spec.estimated,
      value:
        spec.key === "workouts"
          ? values.reduce((a, b) => a + b, 0)
          : Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(1)),
      days: values.length,
      from,
      to,
      cutoff: new Date(changedAt).toISOString(),
      latest: dayAgo(1),
      daily: spec.daily,
      target: null,
      sources: spec.rows.map((row) => ({
        file: `health/data/${spec.type}/${String(row.ts ?? row.end).slice(0, 7)}.jsonl`,
        text: JSON.stringify(row),
      })),
    };
  });
}
export function overview(): OverviewData {
  const next: OverviewNext[] =
    state.task === "open"
      ? [
          {
            id: "sample-interview",
            title: taskTitle,
            proposed: false,
            section: "me",
            module: "me",
            file: "me/STATUS.md",
            by: "user",
          },
        ]
      : [];
  next.push(
    ...newsItems
      .filter((n) => state.newsTasks?.[n.id] === "open")
      .map((n) => ({
        id: n.id,
        title: `读完：${n.title}`,
        proposed: false,
        section: "me",
        module: "me",
        file: "me/STATUS.md",
        by: "user",
      })),
  );
  return {
    root: "browser-demo",
    timeZone: "UTC",
    today: new Date().toISOString().slice(0, 10),
    cutoff: new Date(changedAt).toISOString(),
    drive: false,
    empty: state.notes.length === 0,
    sections: [],
    blocks: [],
    next,
    allNext: next,
    proposedTasks: [
      ...(state.task === "proposed" ? [{ id: "sample-interview", title: taskTitle }] : []),
      ...newsItems
        .filter((n) => state.newsTasks?.[n.id] === "proposed")
        .map((n) => ({ id: n.id, title: `读完：${n.title}` })),
    ],
    plans: {
      goals: hasSamples()
        ? [
            {
              id: "sample-project",
              title: goalTitle,
              area: null,
              origin: null,
              next: next[0] ? { id: next[0].id, title: taskTitle, due: null, rev: 1 } : null,
              results: state.task === "done" ? 1 : 0,
              lastResult: state.result || null,
            },
          ]
        : [],
      projects: hasSamples() ? 1 : 0,
      directions: hasSamples() ? explorationData().directions.filter((d) => d.status === "active").length : 0,
      sources: {},
    },
    sync: {
      received: state.notes.length,
      organizer: false,
      needsReview: 0,
      mapNeedsReview: 0,
      mapPendingImports: 0,
      directionSuggestions: 0,
      updatedAt: null,
    },
    versions: [],
    daily: null,
    projects: [],
    metrics: metrics(),
    pending: 0,
    inboxNotes: state.notes.length,
    notes: [],
    warnings: [],
  };
}
export async function library(query: LibraryQuery = {}): Promise<LibraryData> {
  return {
    inbox: query.source && query.source !== "all" && query.source !== "me" ? [] : state.notes,
    next: null,
    sections: [
      {
        id: "notes",
        title: "笔记与决策",
        count: allDocuments().length,
        sources: ["示例 / Samples"],
        latest: null,
      },
      { id: "inbox", title: "收件箱", count: state.notes.length, sources: ["随手记"], latest: null },
    ],
    notes: allDocuments().map(({ body: _body, ...note }) => note),
  };
}
export async function search(query: string): Promise<NoteSearchResult[]> {
  const term = query.trim().toLocaleLowerCase();
  if (!term) return [];
  return allDocuments()
    .filter((note) => `${note.title}\n${note.body}`.toLocaleLowerCase().includes(term))
    .map((note) => ({
      file: note.file,
      title: note.title,
      kind: note.kind,
      snippet: note.body.slice(0, 180),
    }));
}

// One synthetic person, projected into existing product contracts. No workspace/schema changes.
type HealthRow = { id: string; ts: string; [key: string]: unknown };
const stamp = (days: number, time = "12:00") => `${dayAgo(days)}T${time}:00Z`;
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("合成资料缺失 / Missing sample data");
  return value;
}
const rounded = (n: number) => Number(n.toFixed(1));
const days = (n: number) => Array.from({ length: n }, (_, i) => dayAgo(n - 1 - i));
const healthRows = {
  workouts: Array.from({ length: 89 }, (_, i) => 89 - i)
    .filter((i) => [1, 3, 5].includes(i % 7))
    .map((i) => ({
      id: `workout-${i}`,
      ts: stamp(i, "18:00"),
      session_id: `session-${i}`,
      exercise: "深蹲",
      sets: 3,
      reps: 12,
      weight_kg: rounded(35 + (89 - i) * 0.2),
      duration_min: 45,
      by: "user",
    })),
  sleeps: Array.from({ length: 89 }, (_, i) => 89 - i).map((i) => ({
    id: `sleep-${i}`,
    ts: stamp(i + 1, "23:00"),
    end: stamp(i, "07:00"),
    duration_min: 420 + (i % 5) * 12,
    by: "user",
  })),
  steps: Array.from({ length: 89 }, (_, i) => 89 - i).map((i) => ({
    id: `steps-${i}`,
    ts: stamp(i, "21:00"),
    steps: 5400 + (i % 7) * 650 + (i % 3) * 180,
    by: "user",
  })),
  weights: Array.from({ length: 89 }, (_, i) => 89 - i).map((i) => ({
    id: `weight-${i}`,
    ts: stamp(i, "07:30"),
    value: rounded(73 - (89 - i) * 0.02 + Math.sin(i) * 0.2),
    kind: "weight",
    unit: "kg",
    by: "user",
  })),
  meals: Array.from({ length: 89 }, (_, i) => 89 - i).flatMap((i) =>
    [0, 1, 2].map((j) => ({
      id: `meal-${i}-${j}`,
      ts: stamp(i, ["08:00", "12:00", "19:00"][j]),
      meal: ["早餐", "午餐", "晚餐"][j],
      items: [{ name: ["燕麦、牛奶与鸡蛋", "米饭、鸡肉与蔬菜", "豆腐、鱼与杂粮"][j] }],
      protein_g: 35 + (i % 4) * 3 + j * 4,
      kcal: 500 + j * 120 + (i % 3) * 30,
      uncertainty: 20,
      by: "user",
    })),
  ),
};
export const xiaolin = {
  name: "小林",
  profile: "小林，29 岁，在上海做产品设计。正在恢复规律训练，晚上用小块时间做访谈笔记工具。家乡是成都。",
  health: healthRows,
  project: { title: "业余项目", log: "整理了三位朋友提到的问题。", goal: goalTitle },
};
export function healthData(): HealthData {
  const today = dayAgo(0);
  const from = dayAgo(29);
  const month = today.slice(0, 7);
  const previousMonth = new Date(`${month}-01T12:00:00Z`);
  previousMonth.setUTCDate(0);
  const previous = previousMonth.toISOString().slice(0, 7);
  const monday = dayAgo((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7);
  const sessions = hasSamples()
    ? xiaolin.health.workouts.map((r) => ({
        id: r.session_id,
        ts: r.ts,
        date: r.ts.slice(0, 10),
        parts: ["腿部"],
        duration: r.duration_min,
        repetitions: r.sets * r.reps,
        exercises: [
          {
            id: r.id,
            name: r.exercise,
            cardio: false,
            sets: r.sets,
            reps: r.reps,
            weight: r.weight_kg,
            distance: null,
            duration: r.duration_min,
            recorder: "你",
            estimated: false,
          },
        ],
      }))
    : [];
  const monthRows = sessions.filter((r) => r.date.startsWith(month));
  const lastRows = sessions.filter((r) => r.date.startsWith(previous));
  const daily = (rows: HealthRow[], field: string, n: number, dateField = "ts", divisor = 1) =>
    days(n).map((date) => {
      const hits = hasSamples() ? rows.filter((r) => String(r[dateField]).slice(0, 10) === date) : [];
      return {
        date,
        value: hits.length ? rounded(hits.reduce((sum, r) => sum + Number(r[field]), 0) / divisor) : null,
        estimated: field === "protein_g" || field === "kcal",
      };
    });
  return {
    today,
    timeZone: "UTC",
    training: {
      week: sessions.filter((s) => s.date >= monday).length || null,
      month: monthRows.length || null,
      previousMonth: lastRows.length || null,
      rule: { pattern: "custom", duration_min: 45 },
      topPart: monthRows.length ? { name: "腿部", count: monthRows.length } : null,
      lift: monthRows.length
        ? {
            name: "深蹲",
            initial: required(required(monthRows[0]).exercises[0]).weight,
            max: Math.max(...monthRows.map((r) => required(r.exercises[0]).weight)),
            change: rounded(
              required(required(monthRows.at(-1)).exercises[0]).weight -
                required(required(monthRows[0]).exercises[0]).weight,
            ),
          }
        : null,
      heatmap: Array.from({ length: 35 }, (_, i) =>
        new Date(Date.parse(`${monday}T12:00:00Z`) + (i - 28) * 86400000).toISOString().slice(0, 10),
      ).map((date) => {
        const hits = sessions.filter((r) => r.date === date);
        return {
          date,
          future: date > today,
          sessions: hits.length || null,
          repetitions: hits.length ? hits.reduce((sum, r) => sum + r.repetitions, 0) : null,
          minutes: hits.length ? hits.reduce((sum, r) => sum + r.duration, 0) : null,
        };
      }),
      recent: sessions.filter((r) => r.date >= from).reverse(),
    },
    nutrition: {
      calories: daily(xiaolin.health.meals, "kcal", 7),
      protein: daily(xiaolin.health.meals, "protein_g", 7),
      target: [110, 140],
      meals: hasSamples()
        ? xiaolin.health.meals
            .filter((r) => r.ts.slice(0, 10) >= from)
            .reverse()
            .map((r) => ({
              id: r.id,
              ts: r.ts,
              meal: String(r.meal),
              items: r.items.map((i) => i.name).join("、"),
              kcal: r.kcal,
              protein: r.protein_g,
              estimated: true,
            }))
        : [],
    },
    sleep: daily(xiaolin.health.sleeps, "duration_min", 14, "end", 60),
    steps: daily(xiaolin.health.steps, "steps", 14),
    metrics: hasSamples()
      ? [
          {
            key: "weight:kg",
            kind: "weight",
            unit: "kg",
            points: xiaolin.health.weights
              .filter((r) => r.ts.slice(0, 10) >= from)
              .map((r) => ({
                id: r.id,
                ts: r.ts,
                date: r.ts.slice(0, 10),
                value: r.value,
                estimated: false,
              })),
          },
        ]
      : [],
    photos: [],
    goals: hasSamples()
      ? [{ id: "health-goal", title: "连续 12 周规律训练", area: "health", status: "active" }]
      : [],
    next: hasSamples() ? [{ id: "health-weigh", title: "周六早上起床后称一次体重", status: "todo" }] : [],
  };
}
export const loadHealth = async () => healthData();

// GeoNames city identities/coordinates from the product's packaged city table.
const cityRows: [
  number,
  string,
  number,
  number,
  Experience["event_type"],
  string,
  string | undefined,
  string,
  string,
][] = [
  [
    1815286,
    "成都",
    30.6667,
    104.0667,
    "lived",
    "1997",
    "2015",
    "在成都长大",
    "中学放学后常去河边跑步，家人现在仍住在这里。",
  ],
  [
    1808926,
    "杭州",
    30.2936,
    120.1614,
    "studied",
    "2015",
    "2019",
    "大学四年：第一次做产品设计",
    "参加校园社团做活动海报，毕业设计做了一款公交出行原型。",
  ],
  [
    1795565,
    "深圳",
    22.5455,
    114.0683,
    "worked",
    "2019",
    "2022",
    "第一份工作：从设计稿到上线",
    "加入一家小团队，第一次跟工程师一起把产品交给用户。",
  ],
  [
    1796236,
    "上海",
    31.2222,
    121.4581,
    "lived",
    "2022",
    undefined,
    "搬到上海，重新安排工作与生活",
    "换工作后搬到上海，周末会和朋友去附近散步。",
  ],
  [
    1816670,
    "北京",
    39.9075,
    116.3972,
    "travel",
    "2023-05-01",
    "2023-05-04",
    "五一去北京看大学室友",
    "住在室友家，一起逛博物馆，也聊了各自工作的变化。",
  ],
  [
    1799962,
    "南京",
    32.0617,
    118.7778,
    "travel",
    "2024-11-16",
    "2024-11-17",
    "去南京参加同学婚礼",
    "顺路走了大学同学推荐的老街，回来后把照片整理给朋友。",
  ],
  [
    1886760,
    "苏州",
    31.3041,
    120.5954,
    "travel",
    "2025-04-12",
    "2025-04-13",
    "和父母在苏州慢慢逛园林",
    "没有排满景点，下午找了家茶馆休息。",
  ],
  [
    1814093,
    "大理",
    25.5847,
    100.2123,
    "travel",
    "2026-10-02",
    "2026-10-06",
    "国庆和朋友去大理",
    "白天沿洱海走走，晚上做饭，发现慢一点也能把一天过好。",
  ],
  [
    1810821,
    "福州",
    26.0614,
    119.3061,
    "visit",
    dayAgo(-21),
    dayAgo(-18),
    "下一次短住：福州的日常生活",
    "计划住三晚，按工作日的节奏买菜、步行，先不做搬家决定。",
  ],
];
const originalExperiences: Experience[] = cityRows.map(
  ([geonameid, name, lat, lng, event_type, start, end, title, notes], i) => ({
    id: `place-${i}`,
    ts: stamp(80),
    by: "user",
    rev: 1,
    place: { name, country: "CN", geonameid, lat, lng, precision: "city" },
    event_type,
    fact_status: i === cityRows.length - 1 ? "planned" : "user_reported",
    start,
    ...(end ? { end } : {}),
    time_precision: start.length === 4 ? "year" : "day",
    title,
    notes,
    source: "me/footprints.md",
  }),
);
export async function lifeMap(): Promise<LifeMapData> {
  const all = hasSamples() ? (state.experiences ?? originalExperiences) : [];
  const hidden = state.hidden ?? [];
  const experiences = all.filter((e) => !hidden.includes(e.id));
  return {
    type: "FeatureCollection",
    asOf: dayAgo(0),
    experiences,
    review: [],
    undated: 0,
    importsPending: 0,
    hidden: all.filter((e) => hidden.includes(e.id)).map((item) => ({ item, revision: item.rev ?? 1 })),
    hometown: {
      status: "ready",
      place: state.hometown ?? required(originalExperiences[0]).place,
      evidence: "家乡：成都",
      source: "me/profile.md",
    },
    features: experiences.map((e) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [required(e.place.lng), required(e.place.lat)] },
      properties: { layer: experienceLayer(e, dayAgo(0)) ?? "been", place: e.place, experiences: [e] },
    })),
  };
}
export async function experienceSource(id: string) {
  const e = (state.experiences ?? originalExperiences).find((e) => e.id === id);
  if (!e) throw new Error("找不到经历 / Experience not found");
  return {
    kind: "local" as const,
    locator: e.source,
    file: e.source,
    text: `# 小林的足迹\n\n${e.start} ${e.place.name} · ${e.title}\n\n${e.notes}`,
    firstLine: 1,
    focusLine: null,
    truncated: false,
  };
}
export async function editExperience(id: string, changes: ExperienceChanges, revision: number) {
  const all = state.experiences ?? originalExperiences;
  const old = all.find((e) => e.id === id);
  if (!old || old.rev !== revision) throw new Error("经历已经更新 / Experience changed");
  commit({
    ...state,
    experiences: all.map((e) =>
      e.id === id ? { ...e, ...changes, place: { ...e.place, ...changes.place }, rev: revision + 1 } : e,
    ),
  });
}
export async function hideExperience(id: string) {
  commit({ ...state, hidden: [...(state.hidden ?? []), id] });
  return 1;
}
export async function unhideExperience(id: string) {
  commit({ ...state, hidden: (state.hidden ?? []).filter((v) => v !== id) });
}
export async function hometownCities(name: string) {
  return originalExperiences
    .filter((e) => e.place.name.includes(name))
    .map((e) => ({
      geonameid: required(e.place.geonameid),
      name: e.place.name,
      ascii: e.place.name,
      zh: [e.place.name],
      country: "CN",
      admin1: "",
      lat: required(e.place.lat),
      lng: required(e.place.lng),
      population: 0,
    }));
}
export async function saveHometown(name: string, id: number) {
  const city = (await hometownCities(name)).find((c) => c.geonameid === id);
  if (!city) throw new Error("请选择已有城市 / Choose a city");
  commit({
    ...state,
    hometown: {
      name: city.name,
      country: city.country,
      geonameid: id,
      lat: city.lat,
      lng: city.lng,
      precision: "city",
    },
  });
}
export const experienceImports = async () => ({ sources: [], batches: [], pending: [] });

function originalExploration(): ExplorationData {
  const directions: ExplorationData["directions"] = [
    {
      id: "direction-project",
      title: "给访谈笔记做一个小工具",
      motivation: "让业余项目服务真实的整理需求。",
      hypothesis: "与其追求全自动，不如先帮人保留原话和来源。",
      unknowns: "朋友是否愿意在第二次访谈继续用？",
    },
    {
      id: "direction-city",
      title: "试一试更从容的城市生活",
      motivation: "工作之后仍有精力散步和训练。",
      hypothesis: "短住比想象更能看清日常成本。",
      unknowns: "跨城通勤和见朋友会不会变难？",
    },
  ].map((d, i) => ({
    ...d,
    ts: stamp(75 - i * 4),
    by: "user",
    rev: 2,
    status: "active" as const,
    favorite: i === 0,
  }));
  directions.push({
    id: "direction-suggestion",
    title: "参加一次本地独立开发者交流",
    motivation: "认识同样在做小工具的人。",
    hypothesis: "一次交流可能找到更具体的访谈对象。",
    unknowns: "活动是否适合当前阶段？",
    ts: stamp(1),
    by: "agent",
    rev: 1,
    status: "suggested",
    favorite: false,
  });
  const experiments = directions.slice(0, 2).map((d, i) => ({
    id: `experiment-${i}`,
    direction_id: d.id,
    ts: stamp(20 - i * 3),
    by: "user",
    rev: 1,
    question: i === 0 ? "访谈后多久能找到原话？" : "短住时晚上还有精力做自己的事吗？",
    action: i === 0 ? "请三位朋友用纸上原型整理一次访谈" : "在杭州住两晚，按工作日路线走一遍",
    budget: i === 0 ? "两个晚上，不先写代码" : "两晚住宿与交通，合计 1200 元",
    deadline: dayAgo(-7),
    criteria: i === 0 ? "能在两分钟内找回原话" : "每天能留出半小时散步",
    status: "active" as const,
    conclusion: "unassessed" as const,
  }));
  const checkins = experiments.flatMap((e, i) =>
    [0, 1].map((j) => ({
      id: `result-${i}-${j}`,
      experiment_id: e.id,
      date: dayAgo(14 - i * 2 - j),
      ts: stamp(14 - i * 2 - j),
      by: "user",
      rev: 1,
      done: true,
      note:
        i === 0
          ? ["第一位朋友想先保留原话，而不是立即看 AI 总结。", "第二位朋友用标签找到了上次的原话。"][j]
          : ["短住第一晚步行买菜，通勤比预想短。", "第二晚发现下雨时骑车不方便，改为步行与地铁。"][j],
    })),
  );
  const notes = directions.slice(0, 2).map((d, i) => ({
    id: `reflection-${i}`,
    direction_id: d.id,
    ts: stamp(5 - i),
    by: "user",
    rev: 1,
    kind: "reflection" as const,
    text:
      i === 0
        ? "原来以为需要自动写结论，现在更想先把原话找回来。"
        : "原来只看房租，现在会把通勤、朋友与天气一起考虑。",
    stance: "supports" as const,
    question: required(experiments[i]).question,
    experiment_id: required(experiments[i]).id,
  }));
  return {
    references: {
      projects: [{ id: "sample-project", title: "业余项目" }],
      decisions: [{ path: "decisions/hangzhou/decision.md", title: "要不要搬去杭州" }],
    },
    directions,
    experiments: experiments.map((e) => ({
      ...e,
      result: checkins
        .filter((c) => c.experiment_id === e.id)
        .map((c) => `${c.date}：${c.note}`)
        .join("\n"),
    })),
    checkins,
    notes,
    timeline: notes.map((n) => ({
      id: n.id,
      record_id: n.id,
      direction_id: n.direction_id,
      kind: "direction_note",
      at: n.ts,
      by: n.by,
      text: n.text,
      before: "只看一个指标就能做决定",
      after: n.text,
    })),
  };
}
function explorationData() {
  return hasSamples()
    ? (state.exploration ?? originalExploration())
    : {
        references: { projects: [], decisions: [] },
        directions: [],
        experiments: [],
        checkins: [],
        notes: [],
        timeline: [],
      };
}
export const exploration = async () => explorationData();
export async function writeExploration(command: ExplorationCommand) {
  const data = structuredClone(explorationData());
  const id = "id" in command ? command.id : crypto.randomUUID();
  const ts = new Date().toISOString();
  const record = { id, ts, by: "user", rev: 1, ...command.data };
  const table = command.operation.includes("direction")
    ? data.directions
    : command.operation.includes("experiment")
      ? data.experiments
      : command.operation.includes("checkin")
        ? data.checkins
        : data.notes;
  if (command.operation.startsWith("update")) {
    const index = table.findIndex((r) => r.id === id);
    const old = table[index];
    if (!old || !("expected_revision" in command) || old.rev !== command.expected_revision)
      throw new Error("记录已更新 / Record changed");
    Object.assign(old, command.data, { rev: (old.rev ?? 1) + 1, updated_at: ts });
  } else if (command.operation === "create_direction")
    data.directions.push({ ...record, ...command.data, status: "active", favorite: false });
  else if (command.operation === "create_experiment")
    data.experiments.push({ ...record, ...command.data, status: "planned", conclusion: "unassessed" });
  else if (command.operation === "create_checkin") data.checkins.push({ ...record, ...command.data });
  else if (command.operation === "add_note")
    data.notes.push({
      ...record,
      ...command.data,
      question: data.experiments.find((e) => e.id === command.data.experiment_id)?.question ?? "",
    });
  const owner =
    "direction_id" in command.data
      ? command.data.direction_id
      : data.directions.some((d) => d.id === id)
        ? id
        : (data.experiments.find((e) => e.id === id)?.direction_id ??
          data.notes.find((n) => n.id === id)?.direction_id);
  if (owner)
    data.timeline.push({
      id: `${id}:${ts}`,
      record_id: id,
      direction_id: owner,
      kind: command.operation,
      at: ts,
      by: "user",
      text:
        "text" in command.data
          ? (command.data.text ?? "调整认识")
          : "action" in command.data
            ? (command.data.action ?? "调整尝试")
            : "调整方向",
    });
  commit({ ...state, exploration: data });
  return { id, version: null };
}
export async function explorationSource() {
  return {
    kind: "local" as const,
    locator: "learning/interview/STATUS.md",
    file: "learning/interview/STATUS.md",
    text: required(documents[0]).body,
    firstLine: 1,
    focusLine: null,
    truncated: false,
  };
}

// Verified original announcements, kept at their publication dates; never fetched by the browser.
const articles = [
  [
    "保护前沿模型训练与评估环境",
    "OpenAI",
    "2026-10-23",
    "https://openai.com/index/securing-our-frontier-model-training-environment/",
    "OpenAI 介绍训练与评估环境的隔离方法，以及用模型测试隔离边界的过程。",
    "小林的访谈工具也需要先界定资料读取范围。",
    "可以借鉴先明确边界再验证的做法，不必把大公司的基础设施照搬进小项目。",
  ],
  [
    "GitHub Apps 支持企业级安装",
    "GitHub",
    "2026-10-23",
    "https://github.blog/changelog/2026-10-23-enterprise-installations-for-github-apps-generally-available/",
    "GitHub Apps 企业安装正式可用，扩展治理、安全与管理接口。",
    "小林想让自己的小工具以后能接入团队现有流程。",
    "先想清楚最小权限与退出方式，再决定是否需要企业集成。",
  ],
  [
    "Visual Studio 的 Copilot 九月更新",
    "GitHub",
    "2026-10-22",
    "https://github.blog/changelog/2026-10-22-github-copilot-in-visual-studio-september-update-2/",
    "GitHub 汇总在聊天中查看 PR、模型选择和依赖漏洞修复等更新。",
    "小林会用 AI 协助实现访谈笔记原型。",
    "可见的改动和清楚的验收条件，比一次生成很多代码更容易评估。",
  ],
  [
    "OpenAI 模型将接入 Google Cloud",
    "OpenAI",
    "2026-10-21",
    "https://openai.com/index/openai-models-google-cloud/",
    "OpenAI 与 Google Cloud 宣布合作，把模型和 Codex 工作流带入 Model Garden。",
    "小林正在比较后续原型的实现路径。",
    "这是合作公告，不表示现在就需要迁移工具；先确认用户真正要解决的问题。",
  ],
  [
    "GitHub Copilot 停用部分旧模型",
    "GitHub",
    "2026-10-19",
    "https://github.blog/changelog/2026-10-19-github-copilot-models-deprecated-on-october-19-2026/",
    "GitHub 公告部分 Copilot 模型自 10 月 19 日停用，并列出替代项。",
    "小林想让业余项目的验证流程可以重复执行。",
    "把模型名称、日期与测试样本一起记下，避免把换模型的变化误认为产品改进。",
  ],
  [
    "Copilot 模型策略 API 正式可用",
    "GitHub",
    "2026-10-19",
    "https://github.blog/changelog/2026-10-19-copilot-model-policy-api-for-enterprise-orgs-and-teams/",
    "企业、团队、Agent App 与组织可通过 REST API 查询和更新 Copilot 模型策略。",
    "小林考虑把访谈工具交给团队共同使用。",
    "先让团队看得见正在使用哪个模型，再讨论自动化策略。",
  ],
  [
    "Anthropic 研究内部工作与招聘变化",
    "Anthropic",
    "2026-10-16",
    "https://www.anthropic.com/research/employment-at-anthropic",
    "研究描述 AI 工具使用、员工产出和内部招聘结构的变化。",
    "小林正在重新分配设计工作与业余项目的时间。",
    "单个公司的观察不能直接代表所有岗位；可以先记录自己在哪些环节节省了时间。",
  ],
  [
    "前沿工作经验如何影响对 AI 的预期",
    "Anthropic",
    "2026-10-16",
    "https://www.anthropic.com/research/expectations-for-the-future",
    "Anthropic 介绍两份研究，比较内部就业变化和员工与公众对 AI 的预期。",
    "小林的用户访谈需要区分亲身使用经验与对未来的想象。",
    "先问最近一次具体经历，再问未来期待，能让访谈材料更容易检验。",
  ],
];
const newsItems: NewsItem[] = articles.map(([title, source, date, url, summary, reason, comment], i) => ({
  id: `news-${i}`,
  ts: `${date}T12:00:00Z`,
  by: "user",
  kind: "article",
  title: required(title),
  source: required(source),
  published_at: `${date}T12:00:00Z`,
  url: required(url),
  summary,
  comment,
  relevance: { module: "projects", reason: required(reason) },
  via: "user",
  status: "new",
}));
// Official release timestamps remain UTC instants; Source displays them in the browser's time zone.
newsItems.push(
  {
    id: "news-openspec-v1.15.0",
    ts: "2026-10-24T00:50:05Z",
    by: "user",
    kind: "release",
    title: "OpenSpec 1.15.0：独立安装与更新预览",
    url: "https://github.com/Fission-AI/OpenSpec/releases/tag/v1.15.0",
    source: "OpenSpec",
    via: "user",
    version: "1.15.0",
    repo: "https://github.com/Fission-AI/OpenSpec",
    published_at: "2026-10-24T00:50:05Z",
    summary: "官方新增无需 Node.js 的独立安装、更新 dry-run，并加快 JSON 命令启动。",
    relevance: { module: "projects", reason: "小林想让访谈工具的安装和更新更容易理解。" },
    comment: "更新前先展示会改哪些文件，也适合用来检查小工具的交付体验。",
    status: "new",
  },
  {
    id: "news-claude-code-v2.1.310",
    ts: "2026-10-23T23:39:00Z",
    by: "user",
    kind: "release",
    title: "Claude Code 2.1.310：Monitor 扩展与兼容修复",
    url: "https://github.com/anthropics/claude-code/releases/tag/v2.1.310",
    source: "Anthropic",
    via: "user",
    version: "2.1.310",
    repo: "https://github.com/anthropics/claude-code",
    published_at: "2026-10-23T23:39:00Z",
    summary: "官方扩展 Monitor 的运行环境，并修复兼容网关请求和 Windows hooks 的部分问题。",
    relevance: { module: "projects", reason: "小林用 AI 协助原型开发，需要记录工具版本与复现环境。" },
    comment: "先对照自己的工作流阅读修复项，再决定更新；不要只凭版本号判断效果。",
    status: "new",
  },
);
export async function news(): Promise<NewsData> {
  return {
    date: dayAgo(0),
    picked: hasSamples()
      ? newsItems
          .filter((n) => state.newsStatus?.[n.id] !== "dismissed")
          .map((n) => ({ ...n, status: state.newsStatus?.[n.id] ?? n.status }))
          .sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""))
      : [],
    others: [],
    trends: [],
    feedback: state.newsFeedback ?? {},
    keywords: state.keywords ?? ["访谈工具", "AI 与资料", "城市生活", "规律训练"],
    feedCount: 0,
    sources: { user: newsItems.length },
    moduleNames: { projects: "业余项目", health: "健康" },
  };
}
export async function feedbackNews(id: string, value: NewsFeedback | null) {
  const feedback = { ...state.newsFeedback };
  if (value) feedback[id] = value;
  else delete feedback[id];
  commit({ ...state, newsFeedback: feedback });
  return feedback;
}
export async function tryNews(id: string) {
  const item = newsItems.find((n) => n.id === id);
  if (!item) throw new Error("找不到资讯 / News not found");
  commit({
    ...state,
    newsTasks: { ...state.newsTasks, [id]: state.newsTasks?.[id] ?? "proposed" },
    newsStatus: { ...state.newsStatus, [id]: "tried" },
  });
  return { id, status: "tried" as const, version: null };
}
export async function dismissNews(id: string) {
  commit({ ...state, newsStatus: { ...state.newsStatus, [id]: "dismissed" } });
  return { id, status: "dismissed" as const, version: null };
}
export async function saveNewsKeywords(keywords: string[]) {
  const next = [...new Set(keywords.map((k) => k.trim()).filter(Boolean))].slice(0, 20);
  commit({ ...state, keywords: next });
  return next;
}
export async function handover(locale = "zh-CN"): Promise<HandoverPack> {
  const english = locale === "en";
  const o = overview();
  const p = await projects();
  const d = explorationData();
  const sections: HandoverPack["sections"] = [
    { id: "about", title: english ? "Profile" : "关于小林", lines: [xiaolin.profile], defaultOn: true },
    {
      id: "goals",
      title: english ? "Goals" : "目标",
      lines: o.plans.goals.map((g) => g.title),
      defaultOn: true,
    },
    {
      id: "results",
      title: english ? "Recent activity and health" : "近况与健康",
      lines: [
        ...state.notes.map((n) => n.text),
        ...(state.result ? [state.result] : []),
        ...o.metrics.map(
          (m) => `${m.from} — ${m.to} · ${m.label}：${m.value} ${m.unit}${m.estimated ? "（估算）" : ""}`,
        ),
      ],
      defaultOn: true,
    },
    {
      id: "next",
      title: english ? "Next steps" : "下一步",
      lines: [...o.allNext.map((n) => n.title), ...healthData().next.map((n) => n.title)],
      defaultOn: true,
    },
    {
      id: "projects",
      title: english ? "Projects" : "项目",
      lines: p.map((v) => `${v.title}：${v.recentLog?.text} 下一步：${taskTitle}`),
      defaultOn: true,
    },
    {
      id: "directions",
      title: english ? "Directions" : "方向",
      lines: d.directions.map(
        (v) => `${v.title}（${v.status === "suggested" ? "待采纳" : "在试"}）：${v.hypothesis}`,
      ),
      defaultOn: true,
    },
    { id: "finance", title: english ? "Finance" : "财务", lines: [], defaultOn: false },
  ];
  const header = english ? "Xiaolin's context" : "小林的近况";
  const footer = english
    ? "Keep sources and ask before adopting a suggestion."
    : "请保留来源，建议先由小林确认，再作为下一步。";
  return {
    header,
    sections,
    footer,
    excluded: "finance",
    text: [
      header,
      ...sections.filter((s) => s.defaultOn).map((s) => `## ${s.title}\n${s.lines.join("\n")}`),
      footer,
    ].join("\n\n"),
  };
}
export function allDocuments() {
  const h = healthData();
  const o = overview();
  const d = explorationData();
  const generated = [
    { file: "me/profile.md", title: "小林的档案", body: `# 小林\n\n${xiaolin.profile}` },
    {
      file: "me/goals.md",
      title: "目标与下一步",
      body: `# 目标\n\n${o.plans.goals.map((g) => `${g.title}\n\n下一步：${g.next?.title ?? "暂无"}\n\n最近结果：${g.lastResult ?? "还没有"}`).join("\n\n")}`,
    },
    {
      file: "health/STATUS.md",
      title: "健康记录",
      body: `# 健康\n\n${o.metrics.map((m) => `${m.from} — ${m.to} · ${m.label}：${m.value} ${m.unit}`).join("\n\n")}\n\n近 30 天训练 ${h.training.recent.length} 次。体重、睡眠和饮食的原始记录可在开图的健康页查看。`,
    },
    {
      file: "projects/sample-project/log.md",
      title: "业余项目进展",
      body: `# 业余项目\n\n## ${dayAgo(1)}\n\n${xiaolin.project.log}\n\n下一步：${taskTitle}`,
    },
    {
      file: "exploration/STATUS.md",
      title: "方向与认识变化",
      body: `# 方向\n\n${d.directions.map((v) => `## ${v.title}\n\n${v.hypothesis}`).join("\n\n")}\n\n${d.notes.map((v) => v.text).join("\n\n")}`,
    },
    {
      file: "feed/COLLECT.md",
      title: "资讯来源与 X 缺口",
      body: `# 资讯来源\n\n${newsItems.map((n) => `${n.published_at?.slice(0, 10)} · ${n.title}\n${n.url}`).join("\n\n")}\n\nX 原帖读取返回 403，未能完成原帖核验，因此未收录 X 帖文、作者或热度。新闻保留原始发布日期，不作为实时资讯。`,
    },
  ];
  return [...documents, ...generated.map((n) => ({ ...n, kind: "笔记" as const, status: null }))];
}
