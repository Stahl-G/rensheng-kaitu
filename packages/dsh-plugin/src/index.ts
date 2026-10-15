import { isAbsolute } from "node:path";
import {
  Workspace,
  addRecord,
  defaultRoot,
  history,
  listRecordTypes,
  readStatus,
  recordReference,
  snapshot,
  validateWorkspace,
} from "@kaitu/core";
import type { Context } from "./dsh.js";

export const name = "kaitu";
export const inject = ["tools", "systemPrompt"];

export interface Config {
  workspace?: string;
}

const instructions = [
  "这是用户的开图工作区。记录前先调用 kaitu_status，传 type 可查该类型的字段规范。",
  "用户没说的事实字段（时间、数量、重量等）先问，不要猜；session_id 这类编号按规范自己生成，不要问用户。只用开图工具写记录，时间遵守工作区时区，回复要短。",
  "日常记录直接写；外部日历、批量导入、规则与目标变更须确认。本插件仅支持单条记录和查询。",
  "以工具结果确认写入；version 为空时不要声称已保存版本。",
].join("\n");

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("参数必须是对象");
  return value as Record<string, unknown>;
}

function parameters(properties: Record<string, unknown>, required: string[] = []) {
  return { type: "object", properties, required, additionalProperties: false };
}

export function apply(ctx: Context, config: Config = {}): void {
  if (config.workspace !== undefined && !isAbsolute(config.workspace)) {
    throw new Error("workspace 必须是绝对路径");
  }
  const ws = new Workspace(config.workspace ?? defaultRoot());
  if (!ws.exists(".kaitu/config.json")) throw new Error(`${ws.root} 还不是开图工作区，先运行 kaitu init`);
  ctx.systemPrompt?.section({ name: "kaitu:workspace", order: 3000, text: instructions, interpolate: false });

  // 同一插件的调用排队，避免并行写入时争抢版本库。
  let pending: Promise<unknown> = Promise.resolve();
  function register(
    toolName: string,
    description: string,
    schema: ReturnType<typeof parameters>,
    run: (args: Record<string, unknown>) => unknown | Promise<unknown>,
  ) {
    ctx.tools.register({
      name: toolName,
      description,
      parameters: schema,
      output: {
        schema: { type: "object", additionalProperties: true },
        render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }],
      },
      execute(args, exec) {
        const result = pending.then(async () => {
          try {
            exec.signal.throwIfAborted();
            const input = object(args);
            for (const key of Object.keys(input)) {
              if (!Object.hasOwn(schema.properties, key)) throw new Error(`未知参数：${key}`);
            }
            return JSON.parse(JSON.stringify(await run(input)));
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : String(error) };
          }
        });
        pending = result;
        return result;
      },
    });
  }

  register(
    "kaitu_status",
    `查看工作区、今天现状与可用记录类型；传 type 查看字段规范。${ctx.systemPrompt ? "" : instructions}`,
    parameters({ type: { type: "string", minLength: 1, description: "要查看字段规范的记录类型，可省略" } }),
    (args) => {
      if (args.type !== undefined && (typeof args.type !== "string" || !args.type.trim())) {
        throw new Error("type 必须是非空字符串");
      }
      return {
        ok: true,
        workspace: ws.root,
        timeZone: ws.timeZone(),
        summary: readStatus(ws),
        recordTypes: listRecordTypes(ws).map(({ type }) => type),
        ...(typeof args.type === "string" ? { reference: recordReference(ws, args.type) } : {}),
      };
    },
  );
  register(
    "kaitu_add_record",
    "按字段规范新增一条记录并保存版本。先 kaitu_status 查看规范，缺字段问用户，不猜。",
    parameters(
      {
        type: { type: "string", minLength: 1, description: "记录类型，如 workout" },
        fields: {
          type: "object",
          additionalProperties: true,
          description: "该类型的字段；ts 可省略或填带偏移时间，id/by/rev 由开图生成",
        },
      },
      ["type", "fields"],
    ),
    async (args) => {
      if (typeof args.type !== "string" || !args.type.trim()) throw new Error("type 必须是非空字符串");
      const result = addRecord(ws, args.type, object(args.fields), { by: "agent" });
      const saved = { ok: true, id: result.record.id, file: result.file };
      try {
        const version = await snapshot(ws, `DeepSeek 对话写入：${args.type}`);
        return { ...saved, version };
      } catch (error) {
        return { ...saved, version: null, versionError: (error as Error).message };
      }
    },
  );
  register("kaitu_validate", "校验当前工作区，返回问题原文。", parameters({}), () => {
    const issues = validateWorkspace(ws);
    return { ok: issues.length === 0, issues };
  });
  register(
    "kaitu_history",
    "查看最近 N 个版本，默认 10，最多 50。",
    parameters({ limit: { type: "integer", minimum: 1, maximum: 50 } }),
    async (args) => {
      const limit = args.limit === undefined ? 10 : args.limit;
      if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 50) {
        throw new Error("limit 必须是 1 至 50 的整数");
      }
      return { ok: true, versions: await history(ws, { limit }) };
    },
  );
}
