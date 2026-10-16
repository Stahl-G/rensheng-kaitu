import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type AskEventType =
  | "user/message"
  | "assistant/message"
  | "tool/call"
  | "tool/result"
  | "approval/asked"
  | "session.status";
export interface AskEvent {
  id: number;
  type: AskEventType;
  data: Record<string, unknown>;
}
export type AskMode = "scoped" | "full";
export interface AskThread {
  mode?: AskMode;
  workspace?: string;
  id: string;
  title: string;
  created: string;
  updated: string;
}
export interface AskRuntime {
  request(method: string, params: Record<string, unknown>): Promise<unknown>;
  onNotification(listener: (method: string, params: Record<string, unknown>) => void): () => void;
  close(): Promise<void>;
}
export interface AskService {
  list(): AskThread[];
  create(): AskThread;
  events(id: string): AskEvent[];
  subscribe(id: string, listener: (event: AskEvent) => void): () => void;
  send(id: string, text: string): Promise<unknown>;
  settings(): Promise<{
    configured: boolean;
    choice?: "builtin" | "external";
    provider: string;
    model: string;
  }>;
  configure(input: Record<string, unknown>): Promise<unknown>;
  setMode(id: string, mode: AskMode, confirmed: boolean): Promise<AskMode>;
  prepareRelocation(): Promise<void>;
  relocate(workspace: string): void;
  close(): Promise<void>;
}
const visible = new Set<AskEventType>([
  "user/message",
  "assistant/message",
  "tool/call",
  "tool/result",
  "approval/asked",
]);

export function createAskService(options: {
  state: string;
  workspace: string;
  workspaceKey?: string;
  runtime: (mode: AskMode) => Promise<AskRuntime>;
  settings: AskService["settings"];
  configure: AskService["configure"];
}): AskService {
  const directory = join(
    options.state,
    "ask",
    createHash("sha256")
      .update(options.workspaceKey ?? options.workspace)
      .digest("hex")
      .slice(0, 20),
  );
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const index = join(directory, "index.json");
  const threads: AskThread[] = existsSync(index) ? JSON.parse(readFileSync(index, "utf8")) : [];
  const listeners = new Map<string, Set<(event: AskEvent) => void>>();
  const busy = new Set<string>();
  let runtime: AskRuntime | undefined;
  let runtimeMode: AskMode | undefined;
  let starting: Promise<AskRuntime> | undefined;
  let closed = false;
  const thread = (id: string) => {
    const value = threads.find((item) => item.id === id);
    if (!value) throw new Error("对话不存在");
    return value;
  };
  const saveIndex = () => {
    writeFileSync(`${index}.tmp`, JSON.stringify(threads), { mode: 0o600 });
    renameSync(`${index}.tmp`, index);
  };
  const events = (id: string): AskEvent[] => {
    thread(id);
    const file = join(directory, `${id}.jsonl`);
    return existsSync(file)
      ? readFileSync(file, "utf8")
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line))
      : [];
  };
  const append = (id: string, type: AskEventType, data: Record<string, unknown>) => {
    const row = thread(id);
    const previous = events(id);
    const event = { id: (previous.at(-1)?.id ?? 0) + 1, type, data };
    appendFileSync(join(directory, `${id}.jsonl`), `${JSON.stringify(event)}\n`, { mode: 0o600 });
    row.updated = new Date().toISOString();
    if (type === "user/message" && row.title === "新对话") {
      const content = data.content as { type: string; text?: string }[] | undefined;
      row.title =
        content
          ?.filter((block) => block.type === "text")
          .map((block) => block.text)
          .join(" ")
          .slice(0, 40) || "新对话";
    }
    saveIndex();
    for (const listener of listeners.get(id) ?? []) listener(event);
  };
  const stopRuntime = async () => {
    await starting?.catch(() => {});
    await runtime?.close();
    runtime = undefined;
    starting = undefined;
    runtimeMode = undefined;
  };
  const start = async (mode: AskMode) => {
    if (closed) throw new Error("开图正在退出");
    if (runtimeMode && runtimeMode !== mode) await stopRuntime();
    runtimeMode = mode;
    starting ??= options
      .runtime(mode)
      .then((value) => {
        runtime = value;
        value.onNotification((method, params) => {
          const id = params.sessionId;
          if (typeof id !== "string" || !threads.some((row) => row.id === id)) return;
          if (method === "session.status") {
            if (params.status === "idle") busy.delete(id);
            if (params.error) {
              runtime = undefined;
              starting = undefined;
            }
            append(id, "session.status", { status: params.status, error: params.error });
          } else if (method === "session.event") {
            const event = params.event as {
              type: AskEventType | "turn/end";
              data: Record<string, unknown>;
              seq: number;
            };
            if (event?.type === "turn/end") {
              const reason = event.data.reason as { kind?: string } | undefined;
              if (reason?.kind === "error" || reason?.kind === "blocked") {
                busy.delete(id);
                append(id, "session.status", {
                  status: "idle",
                  error: "这次回复未完成，请检查 AI 连接后重试",
                });
              }
              return;
            }
            if (!event || !visible.has(event.type)) return;
            if (
              event.type === "user/message" &&
              (event.data.source as { kind?: string } | undefined)?.kind !== "user"
            )
              return;
            if (events(id).some((row) => row.data.sdkSeq === event.seq)) return;
            const { stream: _stream, ...data } = event.data;
            append(id, event.type, { ...data, sdkSeq: event.seq });
          }
        });
        return value;
      })
      .catch(() => {
        starting = undefined;
        throw new Error("内置 AI 未能启动，请检查 AI 连接后重试");
      });
    return starting;
  };
  // The SDK process is gone after an app restart; persisted turns must become sendable again.
  for (const row of threads) {
    const last = events(row.id)
      .filter((event) => event.type === "session.status")
      .at(-1);
    if (last?.data.status === "running")
      append(row.id, "session.status", { status: "idle", error: "上次对话已中断，可以继续发送" });
  }
  return {
    list: () => [...threads].sort((a, b) => b.updated.localeCompare(a.updated)),
    create() {
      const now = new Date().toISOString();
      const row: AskThread = {
        id: `session-${randomUUID()}`,
        title: "新对话",
        created: now,
        updated: now,
        mode: "scoped",
        workspace: options.workspace,
      };
      threads.push(row);
      saveIndex();
      return row;
    },
    events,
    subscribe(id, listener) {
      thread(id);
      const group = listeners.get(id) ?? new Set();
      group.add(listener);
      listeners.set(id, group);
      return () => {
        group.delete(listener);
      };
    },
    async send(id, text) {
      const row = thread(id);
      if ((row.workspace ?? options.workspaceKey ?? options.workspace) !== options.workspace)
        throw new Error("资料已迁移，请新建对话继续；原对话记录仍可查看");
      const mode = row.mode ?? "scoped";
      if (busy.size && runtimeMode !== mode) throw new Error("请等当前回复完成后切换模式");
      if (typeof text !== "string" || !text.trim() || text.length > 100000)
        throw new Error("请输入有效消息（最多十万字）");
      if (busy.has(id)) throw new Error("请等这次回复完成");
      busy.add(id);
      append(id, "session.status", { status: "running" });
      try {
        const client = await start(mode);
        return await client.request("session/prompt", {
          sessionId: id,
          contentBlocks: [{ type: "text", text: text.trim() }],
        });
      } catch {
        busy.delete(id);
        append(id, "session.status", { status: "idle", error: "消息未发送，请检查 AI 连接后重试" });
        throw new Error("消息未发送，请检查 AI 连接后重试");
      }
    },
    async setMode(id, mode, confirmed) {
      const row = thread(id);
      if (mode !== "scoped" && mode !== "full") throw new Error("无效模式");
      if (mode === "full" && confirmed !== true) throw new Error("开启完整 Agent 需要确认");
      if (busy.size) throw new Error("请等回复完成后切换模式");
      if (runtimeMode !== mode) await stopRuntime();
      row.mode = mode;
      saveIndex();
      return mode;
    },
    async prepareRelocation() {
      if (busy.size) throw new Error("请等回复完成后更换资料位置或恢复版本");
      await stopRuntime();
    },
    relocate(workspace) {
      options.workspace = workspace;
    },
    settings: options.settings,
    async configure(input) {
      if (busy.size) throw new Error("请等回复完成后修改连接");
      await stopRuntime();
      return options.configure(input);
    },
    async close() {
      closed = true;
      await starting?.catch(() => {});
      await runtime?.close();
      listeners.clear();
    },
  };
}
