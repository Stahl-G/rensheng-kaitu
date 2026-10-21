import type { latestDaily } from "./overview.js";
import { type PhoneReceipt, phoneReceipts } from "./phone-receipts.js";
import { schemas } from "./schema.js";
import type { Workspace } from "./workspace.js";

interface AgentUpdate {
  name: string;
  generatedAt: string;
}
interface Daily {
  date: string;
  organizer: string;
  file: string;
}
interface Visit {
  agent: AgentUpdate;
  actions: number;
  needsReview: number;
  daily: Daily | null;
  returnedAt: string;
  seen: boolean;
}
interface OrganizerState {
  agent: AgentUpdate | null;
  daily: Daily | null;
  computerAt?: string;
  visits: Visit[];
}
const file = ".kaitu/organizer.json";
const states = new WeakMap<Workspace, { root: string; value: OrganizerState }>();
const events = new WeakMap<Workspace, EventEmitter>();
export function subscribeOrganizer(ws: Workspace, notify: () => void) {
  let emitter = events.get(ws);
  if (!emitter) {
    emitter = new EventEmitter();
    events.set(ws, emitter);
  }
  emitter.on("change", notify);
  return () => {
    emitter.off("change", notify);
  };
}
function state(ws: Workspace) {
  const hit = states.get(ws);
  if (hit?.root === ws.root) return hit.value;
  const value: OrganizerState = ws.exists(file)
    ? ws.readJson(file)
    : { agent: null, daily: null, visits: [] };
  states.set(ws, { root: ws.root, value });
  return value;
}
function store(ws: Workspace, value: OrganizerState) {
  ws.writeJson(file, value, { internal: true });
  events.get(ws)?.emit("change");
}
export interface OrganizerStatus {
  agent: AgentUpdate | null;
  daily: Daily | null;
  away: Visit | null;
  unread: boolean;
}
export function organizerStatus(ws: Workspace): OrganizerStatus {
  const s = state(ws);
  const away = s.visits.at(-1) ?? null;
  return { agent: s.agent, daily: s.daily, away, unread: !!away && !away.seen };
}

/** 只在外部输入处校验；先保存来源和回执摘要，随后电脑才可覆盖快照。 */
export function rememberOrganizer(
  ws: Workspace,
  today: string | undefined,
  receipts: PhoneReceipt[] | undefined,
  daily: ReturnType<typeof latestDaily>,
  now = new Date(),
) {
  let incoming: AgentUpdate | undefined;
  if (today) {
    try {
      const value = JSON.parse(today);
      if (schemas().builtin("phone-today.schema.json")(value)) {
        const snapshot = value as { generator?: { kind: string; name: string }; generated_at: string };
        if (snapshot.generator?.kind === "agent")
          incoming = { name: snapshot.generator.name, generatedAt: snapshot.generated_at };
      }
    } catch {
      /* 格式不合法的外部快照不改变来源。 */
    }
  }
  const s = state(ws);
  const before = JSON.stringify(s);
  const agentChanged =
    incoming && (!s.agent || Date.parse(incoming.generatedAt) > Date.parse(s.agent.generatedAt));
  if (incoming && agentChanged) s.agent = incoming;
  const dailyChanged =
    daily &&
    (daily.date !== s.daily?.date || daily.organizer !== s.daily?.organizer || daily.file !== s.daily?.file);
  if (daily) s.daily = { date: daily.date, organizer: daily.organizer, file: daily.file };
  // Drive 的回执与资料在同一目录；电脑处理过的 client_id 在本机账本里，不能再算给整理员。
  const ledger =
    receipts === undefined && agentChanged && ws.exists(".kaitu/phone-actions.json")
      ? ws.readJson<Record<string, unknown>>(".kaitu/phone-actions.json")
      : {};
  const added =
    receipts ??
    (incoming && agentChanged
      ? phoneReceipts(ws).filter(
          (r) =>
            !ledger[r.ref] &&
            Date.parse(r.at) > Date.parse(s.computerAt ?? "1970-01-01") &&
            Date.parse(r.at) <= Date.parse(incoming.generatedAt),
        )
      : []);
  const actions = added.filter((r) => r.kind === "action");
  if (s.agent && (agentChanged || actions.length || (dailyChanged && daily.organizer === s.agent.name))) {
    const previous = s.visits.at(-1);
    const sameVisit = previous?.agent.generatedAt === s.agent.generatedAt;
    const visit: Visit = {
      agent: s.agent,
      actions: (sameVisit ? previous.actions : 0) + actions.length,
      needsReview:
        (sameVisit ? previous.needsReview : 0) +
        actions.filter((r) => r.status === "conflict" || r.status === "rejected").length,
      daily: daily?.organizer === s.agent.name ? s.daily : null,
      returnedAt: now.toISOString(),
      seen: false,
    };
    if (sameVisit) s.visits[s.visits.length - 1] = visit;
    else s.visits.push(visit);
  }
  if (JSON.stringify(s) !== before) store(ws, s);
}
export function rememberComputerSnapshot(ws: Workspace, now: Date) {
  const s = state(ws);
  s.computerAt = now.toISOString();
  store(ws, s);
}
export function markOrganizerSeen(ws: Workspace) {
  const s = state(ws);
  const visit = s.visits.at(-1);
  if (visit && !visit.seen) {
    visit.seen = true;
    store(ws, s);
  }
  return organizerStatus(ws);
}
import { EventEmitter } from "node:events";
