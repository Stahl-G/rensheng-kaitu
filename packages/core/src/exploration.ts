import { isAbsolute } from "node:path";
import { readDoing } from "./doing-page.js";
import { KaituError } from "./errors.js";
import { type ExperienceSource, readSourceContent } from "./experience-source.js";
import { explorationCommandSchema } from "./exploration-contract.js";
import { snapshot } from "./history.js";
import { listRecordTypes } from "./modules.js";
import { assertPublicProject, listProjects, projectDirectory } from "./projects.js";
import { type StoredRecord, addRecord, readRecordRevisions, readRecords, updateRecord } from "./records.js";
import { isoInZone } from "./time.js";
import type { Workspace } from "./workspace.js";

export interface ExplorationRecord {
  id: string;
  ts: string;
  by: string;
  rev?: number;
}
export interface ExplorationReference {
  kind: "project" | "decision" | "source";
  ref: string;
}
export interface DirectionInput {
  title: string;
  motivation: string;
  hypothesis: string;
  unknowns?: string;
  references?: ExplorationReference[];
}
export interface Direction extends ExplorationRecord, DirectionInput {
  status: "suggested" | "active" | "paused" | "archived" | "dismissed";
  favorite: boolean;
  updated_at?: string;
}
export interface ExperimentInput {
  direction_id: string;
  question: string;
  action: string;
  budget: string;
  deadline: string;
  criteria: string;
}
export interface ExplorationExperiment extends ExplorationRecord, ExperimentInput {
  status: "planned" | "active" | "completed" | "cancelled";
  result?: string;
  conclusion: "unassessed" | "supports" | "refutes" | "inconclusive";
  source?: string;
  updated_at?: string;
}
export interface DirectionNoteInput {
  direction_id: string;
  kind: "evidence" | "reflection" | "decision";
  text: string;
  stance: "unclear" | "supports" | "refutes";
  source?: string;
  experiment_id?: string;
  references?: ExplorationReference[];
}
export interface DirectionNote extends ExplorationRecord, DirectionNoteInput {
  question: string;
  updated_at?: string;
}
export type ExplorationCommand =
  | { operation: "create_direction"; data: DirectionInput }
  | {
      operation: "update_direction";
      id: string;
      expected_revision: number;
      data: Partial<DirectionInput & Pick<Direction, "status" | "favorite">>;
    }
  | { operation: "create_experiment"; data: ExperimentInput }
  | {
      operation: "update_experiment";
      id: string;
      expected_revision: number;
      data: Partial<
        Omit<ExperimentInput, "direction_id"> &
          Pick<ExplorationExperiment, "status" | "result" | "conclusion" | "source">
      >;
    }
  | { operation: "add_note"; data: DirectionNoteInput }
  | {
      operation: "update_note";
      id: string;
      expected_revision: number;
      data: Partial<Omit<DirectionNoteInput, "direction_id" | "experiment_id">>;
    };
const types = ["direction", "exploration_experiment", "direction_note"];
export function isExplorationType(type: string): boolean {
  return types.includes(type);
}
function rows<T>(ws: Workspace, type: string): T[] {
  return listRecordTypes(ws).some((r) => r.type === type) ? (readRecords(ws, type) as unknown as T[]) : [];
}
function current<T extends ExplorationRecord>(ws: Workspace, type: string, id: string, revision?: number): T {
  const record = rows<T>(ws, type).find((r) => r.id === id);
  if (!record) throw new KaituError("找不到方向或尝试记录", "NOT_FOUND");
  if (revision !== undefined && (!Number.isInteger(revision) || revision !== (record.rev ?? 1)))
    throw new KaituError("记录已经更新，请重新读取后修改", "CONFLICT");
  return record;
}
function references(ws: Workspace, items: ExplorationReference[] | undefined) {
  if (items === undefined) return;
  if (!Array.isArray(items)) throw new KaituError("关联资料必须是列表", "BAD_ARGS");
  for (const item of items) {
    if (!item || typeof item.ref !== "string") throw new KaituError("关联资料不完整", "BAD_ARGS");
    if (item.kind === "project") assertPublicProject(ws, item.ref);
    else if (item.kind === "decision") {
      if (!/^decisions\/[a-z0-9-]+\/decision\.md$/.test(item.ref) || !ws.exists(item.ref))
        throw new KaituError("找不到关联决策", "NOT_FOUND");
    } else if (item.kind === "source") {
      if (/^https?:\/\//.test(item.ref)) {
        const url = new URL(item.ref);
        if (url.username || url.password) throw new KaituError("来源链接不能含登录信息", "BAD_ARGS");
      } else {
        const file = item.ref.split("#")[0] ?? item.ref;
        if (isAbsolute(file) || file.split(/[\\/]/).some((p) => p.startsWith(".")))
          throw new KaituError("关联来源超出范围", "OUT_OF_SCOPE");
        ws.resolve(file);
        const project = /^projects\/([^/]+)\//.exec(file)?.[1];
        if (project) assertPublicProject(ws, project);
      }
    } else throw new KaituError("未知的关联资料类型", "BAD_ARGS");
  }
}
export async function writeExploration(
  ws: Workspace,
  input: ExplorationCommand,
  by: "user" | "agent" = "user",
) {
  const command = explorationCommandSchema.parse(input);
  const data = command.data as unknown as Record<string, unknown>;
  const now = isoInZone(new Date(), ws.timeZone());
  let result: ReturnType<typeof addRecord>;
  let message: string;
  switch (command.operation) {
    case "create_direction":
      references(ws, command.data.references);
      result = addRecord(
        ws,
        "direction",
        { ...data, status: by === "agent" ? "suggested" : "active", favorite: false, updated_at: now },
        { by },
      );
      message = by === "agent" ? "AI 提出了一个探索方向" : "你记下了一个探索方向";
      break;
    case "update_direction": {
      const old = current<Direction>(ws, "direction", command.id, command.expected_revision);

      if (by !== "user") throw new KaituError("方向调整由用户决定，AI 可追加依据或建议", "USER_DECISION");
      references(ws, command.data.references);
      result = updateRecord(ws, "direction", old.id, { ...data, updated_at: now }, { by });
      message = "你更新了探索方向";
      break;
    }
    case "create_experiment": {
      const direction = current<Direction>(ws, "direction", command.data.direction_id);
      if (direction.status !== "active")
        throw new KaituError("先采纳或恢复方向，再安排新尝试", "DIRECTION_INACTIVE");
      result = addRecord(
        ws,
        "exploration_experiment",
        { ...data, status: "planned", conclusion: "unassessed", updated_at: now },
        { by },
      );
      message = "记录了一个方向尝试";
      break;
    }
    case "update_experiment": {
      const old = current<ExplorationExperiment>(
        ws,
        "exploration_experiment",
        command.id,
        command.expected_revision,
      );

      const next = { ...old, ...data };
      if (
        (next.status === "completed" || next.conclusion !== "unassessed") &&
        (typeof next.result !== "string" || !next.result.trim())
      )
        throw new KaituError("先记录实际观察结果，再判断尝试或假设", "RESULT_REQUIRED");
      result = updateRecord(ws, "exploration_experiment", old.id, { ...data, updated_at: now }, { by });
      message = next.status === "completed" ? "记录了尝试结果" : "更新了方向尝试";
      break;
    }
    case "add_note": {
      const direction = current<Direction>(ws, "direction", command.data.direction_id);
      let question = direction.hypothesis || direction.title;
      if (command.data.experiment_id) {
        const experiment = current<ExplorationExperiment>(
          ws,
          "exploration_experiment",
          command.data.experiment_id,
        );
        if (experiment.direction_id !== command.data.direction_id)
          throw new KaituError("尝试不属于这个方向", "BAD_REFERENCE");
        question = experiment.question;
      }
      references(ws, command.data.references);
      result = addRecord(ws, "direction_note", { ...data, question, updated_at: now }, { by });
      message = "补充了方向依据与认识";
      break;
    }
    case "update_note": {
      const old = current<DirectionNote>(ws, "direction_note", command.id, command.expected_revision);

      references(ws, command.data.references);
      result = updateRecord(ws, "direction_note", old.id, { ...data, updated_at: now }, { by });
      message = "修正了方向资料";
      break;
    }
    default:
      throw new KaituError("未知探索操作", "BAD_ARGS");
  }
  return { id: result.record.id, record: result.record, version: await snapshot(ws, message) };
}

export function readExploration(ws: Workspace) {
  const directions = rows<Direction>(ws, "direction").sort(
    (a, b) =>
      Number(b.favorite) - Number(a.favorite) || (b.updated_at ?? b.ts).localeCompare(a.updated_at ?? a.ts),
  );
  const experiments = rows<ExplorationExperiment>(ws, "exploration_experiment");
  const notes = rows<DirectionNote>(ws, "direction_note");
  const timeline: {
    id: string;
    record_id: string;
    direction_id: string;
    kind: string;
    at: string;
    by: string;
    text: string;
    before?: string;
    after?: string;
  }[] = [];
  for (const type of types) {
    if (!listRecordTypes(ws).some((r) => r.type === type)) continue;
    const previous = new Map<string, StoredRecord>();
    for (const record of readRecordRevisions(ws, type).sort((a, b) => (a.rev ?? 1) - (b.rev ?? 1))) {
      if (record.deleted) continue;
      const old = previous.get(record.id);
      const id = type === "direction" ? record.id : String(record.direction_id);
      let text: string;
      if (type === "direction")
        text = !old
          ? record.status === "suggested"
            ? "AI 提议方向"
            : "建立方向"
          : old.status !== record.status
            ? `方向状态：${({ suggested: "AI 建议", active: "进行中", paused: "暂停", archived: "归档", dismissed: "已忽略" } as Record<string, string>)[String(record.status)]}`
            : old.favorite !== record.favorite
              ? record.favorite
                ? "收藏方向"
                : "取消收藏"
              : "调整方向";
      else if (type === "exploration_experiment")
        text = !old
          ? `安排尝试：${String(record.action)}`
          : old.conclusion !== record.conclusion
            ? `假设判断：${({ unassessed: "暂不判断", supports: "支持假设", refutes: "反驳假设", inconclusive: "证据还不足" } as Record<string, string>)[String(record.conclusion)]}`
            : record.status === "completed"
              ? `尝试结果：${String(record.result)}`
              : `尝试状态：${({ planned: "计划中", active: "进行中", completed: "已完成", cancelled: "已取消" } as Record<string, string>)[String(record.status)]}`;
      else text = String(record.text);
      timeline.push({
        id: `${record.id}:${record.rev ?? 1}`,
        record_id: record.id,
        direction_id: id,
        kind: type,
        at: String(record.updated_at ?? record.ts),
        by: record.by,
        text,
        ...(type === "direction" && old?.hypothesis !== record.hypothesis
          ? { before: old ? String(old.hypothesis) : undefined, after: String(record.hypothesis) }
          : {}),
      });
      previous.set(record.id, record);
    }
  }
  return {
    references: {
      projects: listProjects(ws, { publicOnly: true }).map((p) => ({ id: p.slug, title: p.title })),
      decisions: readDoing(ws)
        .decisions.map((d) => ({ path: d.file.replace(/STATUS\.md$/, "decision.md"), title: d.title }))
        .filter((d) => ws.exists(d.path)),
    },
    directions,
    experiments,
    notes,
    timeline: timeline.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id)),
  };
}
export type ExplorationData = ReturnType<typeof readExploration>;
export async function readExplorationSource(
  ws: Workspace,
  owner: "direction" | "direction_note" | "exploration_experiment",
  id: string,
  reference?: number,
): Promise<ExperienceSource> {
  if (!["direction", "direction_note", "exploration_experiment"].includes(owner))
    throw new KaituError("资料类型不合法", "BAD_ARGS");
  const record = current<Direction | DirectionNote | ExplorationExperiment>(ws, owner, id);
  const items = "references" in record ? record.references : undefined;
  let locator: string;
  if (reference !== undefined) {
    if (!Number.isInteger(reference) || reference < 0 || !items?.[reference])
      throw new KaituError("找不到关联资料", "NOT_FOUND");
    const item = items[reference];
    if (item.kind === "project") {
      assertPublicProject(ws, item.ref);
      locator = `${projectDirectory(ws, item.ref)}/STATUS.md`;
    } else locator = item.ref;
  } else locator = "source" in record ? String(record.source ?? "") : "";
  if (!locator) return { kind: "unavailable", locator, reason: "这条资料没有附来源链接" };
  return readSourceContent(ws, locator);
}
