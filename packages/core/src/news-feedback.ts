import { KaituError } from "./errors.js";
import { snapshot } from "./history.js";
import { readRecords } from "./records.js";
import type { Workspace } from "./workspace.js";

export type NewsFeedback = "useful" | "irrelevant";
interface Vote {
  value: NewsFeedback;
  term: string;
  at: number;
}
interface FeedbackState {
  votes: Record<string, Vote>;
  baseline: Record<string, { keyword: boolean; muted: boolean }>;
}
const file = ".kaitu/news-feedback.json";
function state(ws: Workspace): FeedbackState {
  return ws.exists(file) ? ws.readJson(file) : { votes: {}, baseline: {} };
}
export function readNewsFeedback(ws: Workspace): Record<string, NewsFeedback> {
  return Object.fromEntries(Object.entries(state(ws).votes).map(([id, vote]) => [id, vote.value]));
}
export async function setNewsFeedback(ws: Workspace, id: string, value: NewsFeedback | null) {
  if (value !== null && value !== "useful" && value !== "irrelevant")
    throw new KaituError("无效的资讯反馈", "BAD_ARGS");
  const row = readRecords(ws, "news_item").find((row) => row.id === id);
  if (!row) throw new KaituError("找不到这条资讯", "NOT_FOUND");
  const current = state(ws);
  const term = String(row.source).trim();
  if (value === null) delete current.votes[id];
  else
    current.votes[id] = {
      value,
      term,
      at: Math.max(Date.now(), ...Object.values(current.votes).map((vote) => vote.at + 1)),
    };
  ws.writeJson(file, current, { internal: true });
  await snapshot(ws, "你记录了资讯反馈");
  return readNewsFeedback(ws);
}
