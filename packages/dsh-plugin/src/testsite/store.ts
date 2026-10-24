import type { LibraryQuery, NoteSearchResult } from "@kaitu/core";
import type { InboxEntry, LibraryData, OverviewData, OverviewNext } from "../types.js";

// This is disposable browser demo state, never a Kaitu workspace or a new record format.
const key = "kaitu:testsite:v1";
const taskTitle = "给业余项目约一次 20 分钟的用户访谈";
const goalTitle = "做出一个有人愿意用的业余项目";
export const sampleNote = "示例：今晚走了三公里，明天想试试早点出门。";
export const documents = [
  {
    file: "learning/interview/STATUS.md",
    title: "第一次用户访谈（合成示例）",
    kind: "笔记" as const,
    status: "先问对方最近一次怎么解决问题",
    body: "# 第一次用户访谈\n\n这是小林的合成示例笔记。先问对方最近一次遇到问题的经过，再问用了什么办法。不要先介绍自己的产品。\n\n下一步：约一位朋友聊 20 分钟，把原话记下来。",
  },
  {
    file: "decisions/hangzhou/STATUS.md",
    title: "要不要搬去杭州（合成示例）",
    kind: "决定" as const,
    status: "先短住，再决定",
    body: "# 要不要搬去杭州\n\n小林的合成示例决定：先安排一个周末短住，观察通勤和生活节奏。上海的工作暂时保持，预算还需要核对。",
  },
];
type State = {
  version: 1;
  notes: InboxEntry[];
  task: "proposed" | "open" | "done" | "skipped";
  result: string;
};
function seed(): State {
  return {
    version: 1,
    notes: [
      {
        file: "inbox/notes/sample.md",
        text: "合成示例 · 小林：想重新开始训练，也想每周给业余项目留一点时间。",
        source: "me",
        originalSource: null,
        date: "2026-10-23T09:00:00Z",
        status: "raw",
        destination: null,
      },
    ],
    task: "proposed",
    result: "",
  };
}
let state = seed();
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
  for (const listener of listeners) listener();
}
export function reset() {
  // Do not clear any other application or website state on this origin.
  sessionStorage.removeItem(key);
  storageError = "";
  state = seed();
  for (const listener of listeners) listener();
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
export function adopt() {
  if (state.task !== "proposed") throw new Error("这条建议已处理。 / Suggestion already handled.");
  commit({ ...state, task: "open" });
}
export function dismiss() {
  if (state.task !== "proposed") throw new Error("这条建议已处理。 / Suggestion already handled.");
  commit({ ...state, task: "skipped" });
}
export function complete(result: string) {
  if (state.task !== "open" || !result.trim())
    throw new Error("先采纳下一步，并记一句示例结果。 / Adopt the step and add a sample result first.");
  commit({ ...state, task: "done", result: result.trim() });
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
  return {
    root: "browser-demo",
    timeZone: "UTC",
    today: new Date().toISOString().slice(0, 10),
    cutoff: "",
    drive: false,
    empty: false,
    sections: [],
    blocks: [],
    next,
    allNext: next,
    proposedTasks: state.task === "proposed" ? [{ id: "sample-interview", title: taskTitle }] : [],
    plans: {
      goals: [
        {
          id: "sample-project",
          title: goalTitle,
          area: null,
          origin: null,
          next: next[0] ? { id: next[0].id, title: taskTitle, due: null, rev: 1 } : null,
          results: state.task === "done" ? 1 : 0,
          lastResult: state.result || null,
        },
      ],
      projects: 0,
      directions: 1,
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
    metrics: [],
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
        count: documents.length,
        sources: ["合成示例 / Synthetic samples"],
        latest: null,
      },
      { id: "inbox", title: "收件箱", count: state.notes.length, sources: ["随手记"], latest: null },
    ],
    notes: documents.map(({ body: _body, ...note }) => note),
  };
}
export async function search(query: string): Promise<NoteSearchResult[]> {
  const term = query.trim().toLocaleLowerCase();
  if (!term) return [];
  return documents
    .filter((note) => `${note.title}\n${note.body}`.toLocaleLowerCase().includes(term))
    .map((note) => ({
      file: note.file,
      title: note.title,
      kind: note.kind,
      snippet: note.body.slice(0, 180),
    }));
}
