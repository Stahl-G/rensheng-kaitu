import { createHash, randomUUID } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { type AgentConnectionId, KaituError, type NetworkSearchSettings } from "@kaitu/core";

export type AskEventType =
  | "user/message"
  | "assistant/delta"
  | "assistant/message"
  | "tool/call"
  | "tool/result"
  | "approval/asked"
  | "approval/resolved"
  | "session.status";
export interface AskEvent {
  id: number;
  type: AskEventType;
  data: Record<string, unknown>;
}
export type AskMode = "scoped" | "full";
export function effectiveAskMode(settings: { fullOnly?: boolean }, connection = "local-ask"): AskMode {
  return settings.fullOnly && connection === "local-ask" ? "full" : "scoped";
}
export interface AskThread {
  mode?: AskMode;
  backend?: string;
  /** 每个 AI 连接看过的事件数；换回来时只补它没看过的部分。 */
  seen?: Record<string, number>;
  pinned?: boolean;
  archived?: boolean;
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
export interface AskImage {
  data: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
}
export type AskAttachment = AskImage | { kind: "file"; data: string; mimeType: string; name: string };
export interface AskService {
  support?(method: string, input: Record<string, unknown>): Promise<unknown>;
  /** 后台一次性对话：不进问问历史。textOnly 时只收发文字，执行层拒绝工具调用。 */
  background(connection?: AgentConnectionId, options?: { textOnly?: boolean }): AskService;
  list(): AskThread[];
  create(): Promise<AskThread>;
  organize(id: string, change: { title?: unknown; pinned?: unknown; archived?: unknown }): AskThread;
  remove(id: string): void;
  events(id: string): AskEvent[];
  subscribe(id: string, listener: (event: AskEvent) => void): () => void;
  send(id: string, text: string, images?: AskAttachment[]): Promise<unknown>;
  settings(): Promise<{
    configured: boolean;
    search?: NetworkSearchSettings;
    supportsImages?: boolean;
    providerName?: string;
    choice?: "builtin" | "external" | "local";
    backend?: string;
    supportsAttachments?: boolean;
    fullOnly?: boolean;
    mode?: AskMode;
    provider: string;
    model: string;
  }>;
  configure(input: Record<string, unknown>): Promise<unknown>;
  models(input: Record<string, unknown>): Promise<{ id: string; name?: string; image?: boolean }[]>;
  cancel(id: string): Promise<unknown>;
  permission(id: string, requestId: string, optionId: string | null): Promise<unknown>;
  setMode(id: string, mode: AskMode, confirmed: boolean): Promise<AskMode>;
  prepareRelocation(workspace?: string): Promise<void>;
  relocate(workspace: string): void;
  close(): Promise<void>;
}
/** 换 AI 时交给新 AI 的文字记录，只取最近三万字。 */
function transcript(rows: AskEvent[]) {
  return rows
    .flatMap((row) => {
      if (row.type !== "user/message" && row.type !== "assistant/message") return [];
      const blocks = (
        row.type === "user/message" ? row.data.content : (row.data.message as { content?: unknown })?.content
      ) as { type: string; text?: string }[] | undefined;
      const text = blocks
        ?.filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim();
      return text ? [`${row.type === "user/message" ? "用户" : "AI"}：${text}`] : [];
    })
    .join("\n\n")
    .slice(-30000);
}
const visible = new Set<AskEventType>([
  "user/message",
  "assistant/message",
  "tool/call",
  "tool/result",
  "approval/asked",
  "approval/resolved",
]);

export function createAskService(options: {
  transient?: boolean;
  textOnly?: boolean;
  state: string;
  workspace: string;
  workspaceKey?: string;
  workspaceKeyFor?: (workspace: string) => string;
  connection?: AgentConnectionId;
  runtime: (mode: AskMode, connection: AgentConnectionId, textOnly?: boolean) => Promise<AskRuntime>;
  settings: AskService["settings"];
  configure: AskService["configure"];
  models: AskService["models"];
  support?: AskService["support"];
  dispose?: () => Promise<void>;
}): AskService {
  const loadStore = (workspace: string, key: string) => {
    const directory = join(options.state, "ask", createHash("sha256").update(key).digest("hex").slice(0, 20));
    const index = join(directory, "index.json");
    const threads: AskThread[] =
      !options.transient && existsSync(index) ? JSON.parse(readFileSync(index, "utf8")) : [];
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    return { workspace, key, directory, index, threads };
  };
  let {
    key: workspaceKey,
    directory,
    index,
    threads,
  } = loadStore(options.workspace, options.workspaceKey ?? options.workspace);
  let pendingStore: ReturnType<typeof loadStore> | undefined;
  const temporaryEvents = new Map<string, AskEvent[]>();
  // 换了 AI 时提示词里带着之前的记录；对话里只显示用户原话。
  const echoes = new Map<string, unknown>();
  const backgrounds = new Set<AskService>();
  const listeners = new Map<string, Set<(event: AskEvent) => void>>();
  const busy = new Set<string>();
  let runtime: AskRuntime | undefined;
  let runtimeMode: AskMode | undefined;
  let starting: Promise<AskRuntime> | undefined;
  let closed = false;
  let changing = false;
  let relocating = false;
  let generation = 0;
  const clients = new Set<AskRuntime>();
  const ready = () => {
    if (closed || changing || relocating)
      throw new KaituError("AI 正在切换或搬迁，请稍后重试", "AI_CONNECTION");
  };
  const thread = (id: string) => {
    const value = threads.find((item) => item.id === id);
    if (!value) throw new KaituError("对话不存在", "AI_CONNECTION");
    return value;
  };
  const saveIndex = () => {
    if (options.transient) return;
    writeFileSync(`${index}.tmp`, JSON.stringify(threads), { mode: 0o600 });
    renameSync(`${index}.tmp`, index);
  };
  const events = (id: string): AskEvent[] => {
    thread(id);
    if (options.transient) return temporaryEvents.get(id) ?? [];
    const file = join(directory, `${id}.jsonl`);
    return existsSync(file)
      ? readFileSync(file, "utf8")
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line))
      : [];
  };
  const discardEmptyThread = (id: string) => {
    if (busy.has(id) || events(id).some((event) => event.type !== "session.status")) return;
    threads.splice(
      threads.findIndex((row) => row.id === id),
      1,
    );
    saveIndex();
    listeners.delete(id);
    if (options.transient) temporaryEvents.delete(id);
    else rmSync(join(directory, `${id}.jsonl`), { force: true });
  };
  const append = (id: string, type: AskEventType, data: Record<string, unknown>) => {
    const row = thread(id);
    const previous = events(id);
    const event = { id: (previous.at(-1)?.id ?? 0) + 1, type, data };
    if (options.transient) temporaryEvents.set(id, [...previous, event]);
    else appendFileSync(join(directory, `${id}.jsonl`), `${JSON.stringify(event)}\n`, { mode: 0o600 });
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
    generation++;
    const pending = starting;
    runtime = undefined;
    starting = undefined;
    runtimeMode = undefined;
    await pending?.catch(() => {});
    for (const client of clients) {
      await client.close();
      clients.delete(client);
    }
  };
  const start = async (mode: AskMode) => {
    if (closed) throw new KaituError("开图正在退出", "AI_CONNECTION");
    if ((runtimeMode && runtimeMode !== mode) || (!runtime && clients.size)) {
      changing = true;
      try {
        await stopRuntime();
      } finally {
        changing = false;
      }
    }
    runtimeMode = mode;
    const epoch = generation;
    starting ??= options
      .runtime(mode, options.connection ?? "local-ask", options.textOnly)
      .then(async (value) => {
        clients.add(value);
        if (epoch !== generation || closed) {
          await value.close();
          clients.delete(value);
          throw new KaituError("AI 状态已变化", "AI_CONNECTION");
        }
        runtime = value;
        value.onNotification((method, params) => {
          if (epoch !== generation) return;
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
            if (event?.type === "assistant/delta") {
              // Transient chunks go to SSE only; persist the final message once.
              for (const listener of listeners.get(id) ?? [])
                listener({ id: -event.seq, type: "assistant/delta", data: event.data });
              return;
            }
            if (!event || !visible.has(event.type)) return;
            if (options.textOnly && (event.type === "tool/call" || event.type === "approval/asked")) {
              // 只收发文字的对话：模型一伸手调工具就停下这次回答，审批一律拒绝。
              if (!busy.delete(id)) return;
              const requestId = event.data.requestId;
              if (event.type === "approval/asked" && typeof requestId === "string")
                void value
                  .request("session/permission", { sessionId: id, requestId, optionId: null })
                  .catch(() => {});
              void value.request("session/cancel", { sessionId: id }).catch(() => {});
              append(id, "session.status", {
                status: "idle",
                error: "这次只收发文字，AI 想调用工具，开图已停下",
              });
              return;
            }
            if (
              event.type === "user/message" &&
              (event.data.source as { kind?: string } | undefined)?.kind !== "user"
            )
              return;
            if (events(id).some((row) => row.data.sdkSeq === event.seq)) return;
            const { stream: _stream, ...data } = event.data;
            if (event.type === "user/message" && echoes.has(id)) {
              data.content = echoes.get(id);
              echoes.delete(id);
            }
            append(id, event.type, { ...data, sdkSeq: event.seq });
          }
        });
        return value;
      })
      .catch((error) => {
        if (epoch !== generation) throw new KaituError("AI 状态已变化", "AI_CONNECTION");
        starting = undefined;
        if (error instanceof KaituError) throw error;
        throw new KaituError("内置 AI 未能启动，请检查 AI 连接后重试", "AI_CONNECTION");
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
    background(connection = options.connection, extra = {}) {
      ready();
      const service = createAskService({
        ...options,
        workspaceKey,
        connection,
        transient: true,
        textOnly: extra.textOnly ?? false,
      });
      backgrounds.add(service);
      const close = service.close.bind(service);
      service.close = async () => {
        try {
          await close();
        } finally {
          backgrounds.delete(service);
        }
      };
      return service;
    },
    list() {
      // 只读内存：不在刷新列表时删对话或写磁盘（见 AGENTS.md）。
      return [...threads].sort((a, b) => b.updated.localeCompare(a.updated));
    },
    organize(id, change) {
      const row = thread(id);
      if (typeof change.title === "string" && change.title.trim())
        row.title = change.title.trim().slice(0, 80);
      if (typeof change.pinned === "boolean") row.pinned = change.pinned || undefined;
      if (typeof change.archived === "boolean") row.archived = change.archived || undefined;
      saveIndex();
      return row;
    },
    remove(id) {
      thread(id);
      if (busy.has(id)) throw new KaituError("请等这次回复完成", "AI_CONNECTION");
      threads.splice(
        threads.findIndex((row) => row.id === id),
        1,
      );
      saveIndex();
      listeners.delete(id);
      if (options.transient) temporaryEvents.delete(id);
      else rmSync(join(directory, `${id}.jsonl`), { force: true });
    },
    async create() {
      ready();
      const settings = await options.settings();
      ready();
      if (!settings.configured) throw new KaituError("请先连接 AI，再开始对话", "AI_CONNECTION");
      const mode = effectiveAskMode(settings, options.connection);
      if (settings.fullOnly && mode !== "full")
        throw new KaituError("当前入口只支持开图资料权限，请使用支持该范围的 AI", "AI_CONNECTION");
      // 不做空对话复用：资讯/引导等会 create()，复用会占到用户侧栏里的空「新对话」。
      // 避免堆积靠前端 pendingMode，以及发送后再 refreshThreads。
      const now = new Date().toISOString();
      const row: AskThread = {
        id: `session-${randomUUID()}`,
        title: "新对话",
        created: now,
        updated: now,
        mode,
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
    async send(id, text, images = []) {
      ready();
      const row = thread(id);
      if ((row.workspace ?? workspaceKey) !== options.workspace)
        throw new KaituError("资料已迁移，请新建对话继续；原对话记录仍可查看", "AI_CONNECTION");
      const epoch = generation;
      const connection = await options.settings();
      ready();
      if (epoch !== generation) throw new KaituError("AI 连接已改变，请重新发送", "AI_CONNECTION");
      const backend = connection.backend ?? "dsh";
      const previousBackend = row.backend ?? (events(id).length ? "dsh" : undefined);
      const mode = effectiveAskMode(connection, options.connection);
      if (!connection.configured) {
        discardEmptyThread(id);
        throw new KaituError("请先连接 AI，再发送消息", "AI_CONNECTION");
      }
      if (connection.fullOnly && mode !== "full")
        throw new KaituError(
          "此资料连接不支持本机 Agent 完整能力；请用普通模型或在本机问问继续",
          "AI_CONNECTION",
        );
      if (images.length && connection.supportsAttachments === false)
        throw new KaituError("本机 Agent 只接收文字", "AI_ATTACHMENT");
      if (busy.size && runtimeMode !== mode)
        throw new KaituError("请等当前回复完成后切换模式", "AI_CONNECTION");
      if (typeof text !== "string" || (!text.trim() && !images.length) || text.length > 100000) {
        discardEmptyThread(id);
        throw new KaituError("请输入有效消息（最多十万字）", "AI_CONNECTION");
      }
      if (busy.has(id)) throw new KaituError("请等这次回复完成", "AI_CONNECTION");
      if (
        !Array.isArray(images) ||
        images.length > 10 ||
        images.some((file) => !file || typeof file.data !== "string" || file.data.length > 40 * 1024 * 1024)
      )
        throw new KaituError("每次最多添加 10 个附件，单个附件不超过 25MB", "AI_ATTACHMENT");
      if (images.some((file) => !("kind" in file && file.kind === "file")) && !connection.supportsImages)
        throw new KaituError("当前连接未启用图片，请切换模型后重试", "AI_IMAGE");
      ready();
      const blocks = [
        { type: "text", text: text.trim() },
        ...images.map((file) => ({
          ...file,
          type: "kind" in file && file.kind === "file" ? "file" : "image",
        })),
      ];
      let history = "";
      let fresh = false;
      // 连接成功前不改 backend/seen：失败后重试还要能带上换 AI 时的上下文。
      let nextSeen = row.seen;
      if (previousBackend && previousBackend !== backend) {
        const all = events(id);
        nextSeen = { ...row.seen, [previousBackend]: all.length };
        fresh = nextSeen[backend] === undefined;
        history = transcript(all.slice(nextSeen[backend] ?? 0));
      }
      busy.add(id);
      row.mode = mode;
      append(id, "session.status", { status: "running" });
      try {
        const client = await start(mode);
        if (history) echoes.set(id, blocks);
        const result = await client.request("session/prompt", {
          sessionId: id,
          fresh,
          contentBlocks: history
            ? [
                {
                  type: "text",
                  text: `（这段对话中途换了 AI。下面是你还没看到的对话记录，接着回答最后的问题，不用复述）\n\n${history}\n\n用户：${text.trim()}`,
                },
                ...blocks.slice(1),
              ]
            : blocks,
        });
        row.backend = backend;
        row.seen = nextSeen;
        saveIndex();
        return result;
      } catch (error) {
        busy.delete(id);
        echoes.delete(id);
        if (error instanceof KaituError) {
          append(id, "session.status", { status: "idle", error: error.message });
          discardEmptyThread(id);
          throw error;
        }
        append(id, "session.status", { status: "idle", error: "消息未发送，请检查 AI 连接后重试" });
        discardEmptyThread(id);
        throw new KaituError("消息未发送，请检查 AI 连接后重试", "AI_CONNECTION");
      }
    },
    async permission(id, requestId, optionId) {
      ready();
      thread(id);
      if (!runtime || !busy.has(id)) throw new KaituError("操作审批已处理或过期", "CONFLICT");
      return runtime.request("session/permission", { sessionId: id, requestId, optionId });
    },
    async cancel(id) {
      ready();
      thread(id);
      const client = runtime ?? (starting ? await starting : undefined);
      if (!client || !busy.has(id)) return {};
      return client.request("session/cancel", { sessionId: id });
    },
    async setMode(id, mode, _confirmed) {
      ready();
      const row = thread(id);
      if (mode !== "scoped" && mode !== "full") throw new KaituError("无效模式", "AI_CONNECTION");
      const selected = effectiveAskMode(await options.settings(), options.connection);
      ready();
      if (mode !== selected)
        throw new KaituError("对话能力由所选 AI 连接决定，请切换 AI 连接", "AI_CONNECTION");
      if (busy.size) throw new KaituError("请等回复完成后切换模式", "AI_CONNECTION");
      changing = true;
      try {
        row.mode = "scoped";
        saveIndex();
        if (runtimeMode !== mode || (clients.size && !runtime)) await stopRuntime();
        row.mode = mode;
        saveIndex();
        return mode;
      } finally {
        changing = false;
      }
    },
    async prepareRelocation(workspace) {
      ready();
      if (busy.size || backgrounds.size)
        throw new KaituError("请等回复完成后更换资料位置或恢复版本", "AI_CONNECTION");
      relocating = true;
      try {
        pendingStore = workspace
          ? loadStore(workspace, options.workspaceKeyFor?.(workspace) ?? workspace)
          : undefined;
        await stopRuntime();
        await options.dispose?.();
      } catch (error) {
        pendingStore = undefined;
        relocating = false;
        throw error;
      }
    },
    relocate(workspace) {
      if (pendingStore?.workspace === workspace) {
        ({ key: workspaceKey, directory, index, threads } = pendingStore);
        temporaryEvents.clear();
        echoes.clear();
        listeners.clear();
      }
      pendingStore = undefined;
      options.workspace = workspace;
      relocating = false;
    },
    settings: async () => {
      const settings = await options.settings();
      return { ...settings, mode: effectiveAskMode(settings, options.connection) };
    },
    support: options.support,
    models: options.models,
    async configure(input) {
      ready();
      if (busy.size || backgrounds.size) throw new KaituError("请等回复完成后修改连接", "AI_CONNECTION");
      changing = true;
      try {
        await stopRuntime();
        return await options.configure(input);
      } finally {
        changing = false;
      }
    },
    async close() {
      closed = true;
      if (backgrounds.size) await Promise.all([...backgrounds].map((service) => service.close()));
      await stopRuntime();
      listeners.clear();
      await options.dispose?.();
    },
  };
}
