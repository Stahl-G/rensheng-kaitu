import { activeAtToken, formatFileMention } from "@deepseek-ai/dsh-file-reference/grammar";
import { openmaicMetaFrom } from "@kaitu/core/teaching-frame";
import { widgetMetaFrom } from "@kaitu/core/teaching-frame";
import { Fragment, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { OverviewData } from "../types.js";
import css from "./AskPage.module.css";
import { DocumentBody } from "./DocumentBody.js";
import { DshAuthorization } from "./DshAuthorization.js";
import { FilePicker } from "./DshFiles.js";
import filesCss from "./DshFiles.module.css";
import v2 from "./Prototype.module.css";
import { useT } from "./i18n.js";
import { OpenmaicCard } from "./openmaic/OpenmaicCard.js";
import { WidgetCard } from "./openmaic/WidgetCard.js";

interface Thread {
  id: string;
  title: string;
  created: string;
  updated: string;
  workspace?: string;
  pinned?: boolean;
  archived?: boolean;
}
interface ChatEvent {
  id: number;
  type: string;
  data: Record<string, unknown>;
}
interface Provider {
  id: string;
  name: string;
  recommended?: boolean;
  keyUrl?: string;
  api?: string;
  authKey?: string;
  authMethods?: { id: string; label: string }[];
}
interface AttachmentInput {
  kind: "image" | "file";
  data: string;
  mimeType: string;
  name: string;
}
interface Settings {
  /** 本机没有可用的问问引擎时为 false。 */
  available?: boolean;
  configured: boolean;
  choice?: "builtin" | "external" | "local";
  fullOnly?: boolean;
  mode?: "full" | "scoped";
  supportsAttachments?: boolean;
  localAgent?: { id: string; name: string; path?: string; status: string };
  /** 本机装好的 ACP agent CLI。 */
  localAgents?: { id: string; name: string; path: string }[];
  model: string;
  provider: string;
  providerName: string;
  auth?: "dsh" | "key";
  baseURL?: string;
  api?: string;
  protocols: { id: string; name: string }[];
  supportsImages: boolean;
  providers: Provider[];
  /** 已添加的服务商和模型，存在 DSH 的 profile 里。 */
  saved?: { provider: string; name: string; models: string[] }[];
}
interface Automation {
  asked: boolean;
  tasks: { morning: boolean; organizer: boolean; news: boolean };
}
async function call<T>(method: string, ...args: unknown[]): Promise<T> {
  const response = await fetch(`/api/product/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Kaitu": "1" },
    body: JSON.stringify(args),
  });
  const value = await response.json();
  if (!response.ok) throw Object.assign(new Error(value.error ?? "操作未完成，请重试"), { code: value.code });
  return value;
}
function text(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}
function day(value: string) {
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return "今天";
  today.setDate(today.getDate() - 1);
  return date.toDateString() === today.toDateString() ? "昨天" : date.toLocaleDateString("zh-CN");
}
function teachingResult(event: ChatEvent | undefined) {
  return (
    event &&
    !(event.data.message as { isError?: boolean } | undefined)?.isError &&
    (openmaicMetaFrom(event.data.meta) || widgetMetaFrom(event.data.meta))
  );
}
function Tool({
  event,
  result,
  finished,
  session,
}: { event: ChatEvent; result?: ChatEvent; finished: boolean; session: string }) {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(String(event.data.arguments ?? "{}"));
  } catch {
    /* Raw arguments remain in details. */
  }
  const message = result?.data.message as { content?: unknown; isError?: boolean } | undefined;
  const name = String(event.data.name);
  const meta = result?.data.meta;
  const card = openmaicMetaFrom(meta) ? OpenmaicCard : widgetMetaFrom(meta) ? WidgetCard : undefined;
  if (card && !message?.isError) {
    const Card = card;
    return (
      <Card
        callId={String(event.data.callId)}
        frameUrl={`/api/ask/teaching-frame?session=${encodeURIComponent(session)}&call=${encodeURIComponent(String(event.data.callId))}`}
        block={{ kind: "tool-result", content: [], meta }}
      />
    );
  }
  const labels: Record<string, string> = {
    kaitu_status: "你的开图资料",
    kaitu_records: "相关记录",
    kaitu_search_chats: "历史对话",
    kaitu_life_map: "足迹",
    kaitu_exploration_read: "方向与尝试",
  };
  const target = String(args.path ?? args.file_path ?? args.file ?? labels[name] ?? "开图资料");
  const reading = name in labels || /read|list|search|status|overview|get/.test(name);
  const running = !result && !finished;
  return (
    <details className={css.tool}>
      <summary>
        <span className={`${css.dot} ${running ? css.pulse : ""}`} />
        {running
          ? `正在${reading ? "读" : "处理"} ${target}`
          : message?.isError
            ? `未完成 ${target}`
            : result
              ? `${reading ? "读了" : "完成了"} ${target}`
              : `已中断 ${target}`}
      </summary>
      <pre>
        {name} {String(event.data.arguments ?? "")} {message && `\n${text(message.content)}`}
      </pre>
    </details>
  );
}

function NativeApproval({
  event,
  resolution,
  session,
}: { event: ChatEvent; resolution?: ChatEvent; session: string }) {
  const t = useT();
  const [responding, setResponding] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const data = event.data as {
    requestId: string;
    reason: string;
    detail: string;
    options: { optionId: string; kind: string; name: string }[];
  };
  const allow = data.options.find(
    (option) => option.kind === "allow_once" || (option.kind === "allow" && option.optionId === "allow_once"),
  );
  const status = resolution?.data.status as string | undefined;
  const labels: Record<string, string> = {
    approved: t("已批准这一次", "Approved once"),
    rejected: t("已拒绝这一次", "Rejected"),
    expired: t("请求已过期，未批准", "Request expired without approval"),
    cancelled: t("请求已取消，未批准", "Request cancelled without approval"),
  };
  const answer = async (optionId: string | null) => {
    if (responding || submitted || status) return;
    setResponding(true);
    setError("");
    try {
      await call("askPermission", session, data.requestId, optionId);
      setSubmitted(true);
    } catch (err) {
      if (err && typeof err === "object" && "code" in err && err.code === "CONFLICT") setSubmitted(true);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setResponding(false);
    }
  };
  return (
    <details open={!status} className={css.tool}>
      <summary>
        {status
          ? labels[status]
          : data.reason || t("本机 Agent 请求批准这一步", "The local Agent requests approval")}
      </summary>
      <pre>{data.detail}</pre>
      {status ? (
        <output className={css.approvalStatus}>{labels[status]}</output>
      ) : (
        <>
          {error && (
            <p role="alert" className={css.approvalStatus}>
              {error}
            </p>
          )}
          {submitted && !error && (
            <output className={css.approvalStatus}>
              {t("已回复，等待 Agent 继续…", "Response sent. Waiting for the Agent…")}
            </output>
          )}
          <div className={`${css.actions} ${css.approvalActions}`}>
            <button type="button" disabled={responding || submitted} onClick={() => void answer(null)}>
              {t("拒绝这一次", "Reject")}
            </button>
            {allow && (
              <button
                type="button"
                disabled={responding || submitted}
                title={allow.name}
                onClick={() => void answer(allow.optionId)}
              >
                {responding ? t("正在回复…", "Responding…") : t("批准这一次", "Approve once")}
              </button>
            )}
          </div>
        </>
      )}
    </details>
  );
}

export function AskPage({
  workspace,
  active = true,
  initialPrompt = "",
  initialPromptRequest = 0,
  configureRequest = 0,
  configureBuiltin = false,
  onConnections,
}: {
  workspace: string;
  active?: boolean;
  initialPrompt?: string;
  initialPromptRequest?: number;
  configureRequest?: number;
  configureBuiltin?: boolean;
  onConnections?: () => void;
}) {
  const t = useT();
  const [cliPath, setCliPath] = useState("");
  const [agentId, setAgentId] = useState("codebuddy");
  const [agentModels, setAgentModels] = useState<{ id: string; name?: string }[] | string | null>(null);
  const [modelQuery, setModelQuery] = useState("");
  const [liveText, setLiveText] = useState("");
  const [threads, setThreads] = useState<Thread[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [events, setEvents] = useState<ChatEvent[]>([]);
  const [draft, setDraft] = useState(initialPrompt);
  useEffect(() => {
    if (initialPrompt || initialPromptRequest) setDraft(initialPrompt);
  }, [initialPrompt, initialPromptRequest]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const configurationRequested = useRef(false);
  useEffect(() => {
    if (configureRequest) {
      configurationRequested.current = true;
      setStep(1);
      if (configureBuiltin) setChoice("builtin");
    }
  }, [configureRequest, configureBuiltin]);
  const [questions, setQuestions] = useState<string[]>([]);
  const [modelMenu, setModelMenu] = useState(false);
  const selectThread = (id: string | null, follow = false) => {
    nearBottom.current = !id || follow;
    if (!nearBottom.current && scroll.current) scroll.current.scrollTop = 0;
    setSelected(id);
    setModelMenu(false);
  };
  const localRuntime = settings?.mode ? settings.mode === "full" : !!settings?.fullOnly;
  const runtimeLabel = localRuntime ? t("本机 Agent", "Local Agent") : t("开图资料", "Kaitu files");

  const [choice, setChoice] = useState<"builtin" | "local">("local");
  const [key, setKey] = useState("");
  const [provider, setProvider] = useState("deepseek-official");
  const [model, setModel] = useState("");
  const [availableModels, setAvailableModels] = useState<{ id: string; name?: string; image?: boolean }[]>(
    [],
  );
  const [loadingModels, setLoadingModels] = useState(false);
  const [manualModel, setManualModel] = useState(false);
  const modelRequest = useRef(0);
  const [modelNotice, setModelNotice] = useState("");
  const [baseURL, setBaseURL] = useState("");
  const [api, setApi] = useState("openai-completions");
  const [attachments, setAttachments] = useState<AttachmentInput[]>([]);
  const [readingFiles, setReadingFiles] = useState(false);
  const [references, setReferences] = useState(false);
  const [referenceKind, setReferenceKind] = useState<"files" | "sessions">("files");
  const [sessionReferences, setSessionReferences] = useState<
    { id: string; title: string; mention: string }[]
  >([]);
  const [atQuery, setAtQuery] = useState<string | undefined>();
  const [auth, setAuth] = useState<"dsh" | "key">("key");
  const cursor = useRef(0);
  const upload = useRef<HTMLInputElement>(null);
  const selectedProvider = settings?.providers.find((item) => item.id === provider);
  const custom = provider === "kaitu-custom";
  const authMethods = selectedProvider?.authMethods ?? [];
  const nativeLoginOnly =
    authMethods.length > 0 &&
    (authMethods.every((method) => method.id === "oauth") ||
      !settings?.protocols.some((protocol) => protocol.id === selectedProvider?.api));
  const [automation, setAutomation] = useState({ morning: true, organizer: true, news: false });
  const [asked, setAsked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const composing = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const activeSession = useRef<string | null>(null);
  const lastStatus = events.filter((event) => event.type === "session.status").at(-1);
  const busy = sending || lastStatus?.data.status === "running";
  const referenceThreads = threads.filter(
    (thread) =>
      thread.id !== selected &&
      thread.title !== "新对话" &&
      (!thread.workspace || thread.workspace === workspace),
  );
  const closeReferences = () => {
    setReferences(false);
    setAtQuery(undefined);
    input.current?.focus();
  };
  const [threadMenu, setThreadMenu] = useState<{ id: string; confirm?: boolean } | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const groups = new Map<string, Thread[]>();
  for (const thread of threads.filter((row) => row.pinned && !row.archived))
    groups.set("置顶", [...(groups.get("置顶") ?? []), thread]);
  for (const thread of threads.filter((row) => !row.pinned && !row.archived)) {
    const label = day(thread.updated);
    groups.set(label, [...(groups.get(label) ?? []), thread]);
  }
  const archived = threads.filter((row) => row.archived);
  useLayoutEffect(() => {
    if (!input.current) return;
    input.current.style.height = draft ? "auto" : "48px";
    input.current.style.height = `${Math.min(input.current.scrollHeight, 200)}px`;
  }, [draft]);
  useEffect(() => {
    let active = true;
    void call<OverviewData>("overview")
      .then((data) => {
        if (!active) return;
        const prompts = data.projects.slice(0, 2).map((project) => `「${project.title}」下一步先做什么？`);
        if (data.allNext.length) prompts.push(`帮我梳理「${data.allNext[0]?.title}」怎么推进`);
        if (data.notes.length) prompts.push("帮我回顾最近保存的记录");
        setQuestions(prompts.slice(0, 3));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  const refreshThreads = useCallback(
    () =>
      call<Thread[]>("askList").then((list) => {
        setThreads(list);
        setSelected((id) => (id && !list.some((row) => row.id === id) ? null : id));
      }),
    [],
  );
  const organize = (id: string, change: Partial<Pick<Thread, "title" | "pinned" | "archived">>) => {
    setThreadMenu(null);
    setRenaming(null);
    void call("askOrganize", id, change)
      .then(refreshThreads)
      .catch((err) => setError(err.message));
  };
  const removeThread = (id: string) => {
    setThreadMenu(null);
    void call("askRemove", id)
      .then(() => {
        if (selected === id) selectThread(null);
        return refreshThreads();
      })
      .catch((err) => setError(err.message));
  };
  useEffect(() => {
    if (!threadMenu) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(`.${css.threadMenu}`) || target.closest(`.${css.threadMore}`)) return;
      setThreadMenu(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setThreadMenu(null);
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [threadMenu]);
  const threadRow = (thread: Thread) => (
    <div key={thread.id} className={css.threadRow}>
      {renaming?.id === thread.id ? (
        <input
          className={css.rename}
          value={renaming.title}
          // biome-ignore lint/a11y/noAutofocus: 点了重命名就是要输入。
          autoFocus
          onChange={(event) => setRenaming({ id: thread.id, title: event.target.value })}
          onBlur={() => organize(thread.id, { title: renaming.title })}
          onKeyDown={(event) => {
            if (event.key === "Enter") organize(thread.id, { title: renaming.title });
            if (event.key === "Escape") setRenaming(null);
          }}
        />
      ) : (
        <button
          type="button"
          aria-current={thread.id === selected ? "true" : undefined}
          onClick={() => {
            selectThread(thread.id);
            setError("");
          }}
        >
          {thread.title}
        </button>
      )}
      <button
        type="button"
        className={css.threadMore}
        aria-label={t("更多", "More")}
        aria-expanded={threadMenu?.id === thread.id}
        onClick={() => setThreadMenu(threadMenu?.id === thread.id ? null : { id: thread.id })}
      >
        ⋯
      </button>
      {threadMenu?.id === thread.id && (
        <div className={css.threadMenu} role="menu">
          {threadMenu.confirm ? (
            <>
              <button type="button" role="menuitem" onClick={() => removeThread(thread.id)}>
                {t("确认删除", "Confirm delete")}
              </button>
              <button type="button" role="menuitem" onClick={() => setThreadMenu(null)}>
                {t("取消", "Cancel")}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => organize(thread.id, { pinned: !thread.pinned })}
              >
                {thread.pinned ? t("取消置顶", "Unpin") : t("置顶", "Pin")}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setThreadMenu(null);
                  setRenaming({ id: thread.id, title: thread.title });
                }}
              >
                {t("重命名", "Rename")}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => organize(thread.id, { archived: !thread.archived })}
              >
                {thread.archived ? t("取消归档", "Unarchive") : t("归档", "Archive")}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => setThreadMenu({ id: thread.id, confirm: true })}
              >
                {t("删除", "Delete")}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
  useEffect(() => {
    let active = true;
    void Promise.all([
      call<Settings>("askSettings"),
      call<Automation>("automation"),
      call<Thread[]>("askList"),
    ])
      .then(([ai, auto, list]) => {
        if (!active) return;
        setSettings(ai);
        setAuth(ai.auth ?? "key");
        setProvider(ai.provider);
        setModel(ai.model);
        setCliPath(ai.localAgent?.path ?? "");
        setAgentId(ai.localAgent?.id ?? ai.localAgents?.[0]?.id ?? "codebuddy");
        setBaseURL(ai.baseURL ?? "");
        setApi(ai.api ?? "openai-completions");
        if (!configurationRequested.current) setChoice(ai.choice === "builtin" ? "builtin" : "local");
        setAsked(auto.asked);
        if (auto.asked) setAutomation(auto.tasks);
        setThreads(list);
        setLoaded(true);
        if (!configurationRequested.current) {
          if (!ai.choice && !ai.configured) setStep(1);
          else if (ai.configured && !auto.asked && ai.choice !== "local") setStep(2);
        }
      })
      .catch((err) => {
        if (active) setError(err.message);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    const refresh = () =>
      void call<Settings>("askSettings")
        .then(setSettings)
        .catch((err) => setError(err.message));
    window.addEventListener("kaitu-ai-changed", refresh);
    return () => window.removeEventListener("kaitu-ai-changed", refresh);
  }, []);
  useEffect(() => {
    if (step && active) dialog.current?.showModal();
    else dialog.current?.close();
  }, [step, active]);
  useEffect(() => {
    activeSession.current = selected;
    setEvents([]);
    setLiveText("");
    if (!selected) return;
    const stream = new EventSource(`/api/ask/events?session=${encodeURIComponent(selected)}`);
    stream.onmessage = (message) => {
      const event = JSON.parse(message.data) as ChatEvent;
      if (event.type === "assistant/delta") {
        setLiveText(String(event.data.text ?? ""));
        return;
      }
      if (
        event.type === "assistant/message" ||
        (event.type === "session.status" && event.data.status === "idle")
      )
        setLiveText("");
      setEvents((previous) =>
        previous.some((item) => item.id === event.id) ? previous : [...previous, event],
      );
      if (
        event.type === "user/message" ||
        (event.type === "session.status" && event.data.status === "idle")
      ) {
        void refreshThreads().catch((err) => setError(err.message));
      }
    };
    stream.onerror = () => setError("对话连接中断，正在重连…");
    stream.onopen = () => setError("");
    return () => stream.close();
  }, [selected, refreshThreads]);
  useLayoutEffect(() => {
    if (nearBottom.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  });
  const send = async () => {
    const value =
      draft.trim() ||
      (attachments.length ? "请看看这些附件" : sessionReferences.length ? "参考这些对话帮我继续" : "");
    if (!value || busy || readingFiles || !settings?.configured) return;
    nearBottom.current = true;
    // askSend 要等整轮回复；输入框一点发送就清掉，失败再还原（若用户已另写则不覆盖）。
    const pendingText = value;
    const pendingAttachments = attachments;
    const pendingReferences = sessionReferences;
    const payload = [value, ...sessionReferences.map((reference) => reference.mention)].join("\n");
    setDraft("");
    setAttachments([]);
    setSessionReferences([]);
    setError("");
    setSending(true);
    try {
      let id = selected;
      if (!id) {
        const thread = await call<Thread>("askCreate");
        id = thread.id;
        activeSession.current = id;
        selectThread(id, true);
      }
      await call("askSend", id, payload, pendingAttachments);
      await refreshThreads();
    } catch (err) {
      setDraft((current) => (current.trim() ? current : pendingText));
      setAttachments((current) => (current.length ? current : pendingAttachments));
      setSessionReferences((current) => (current.length ? current : pendingReferences));
      try {
        await refreshThreads();
      } catch {
        // 刷新列表失败时保留原始发送错误，避免覆盖真正的失败原因。
      }
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };
  const addFiles = async (files: File[]) => {
    if (!files.length || busy || readingFiles) return;
    setError("");
    if (attachments.length + files.length > 10 || files.some((file) => file.size > 25 * 1024 * 1024)) {
      setError("每次最多添加 10 个附件，单个附件不超过 25MB");
      return;
    }
    if (
      files.some((file) => file.type.startsWith("image/")) &&
      settings?.configured &&
      !settings.supportsImages
    ) {
      setError("当前模型不支持图片");
      return;
    }
    setReadingFiles(true);
    try {
      const added = await Promise.all(
        files.map(
          (file) =>
            new Promise<AttachmentInput>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () =>
                resolve({
                  kind: file.type.startsWith("image/") ? "image" : "file",
                  data: String(reader.result).split(",")[1] ?? "",
                  mimeType: file.type,
                  name: file.name,
                });
              reader.onerror = () => reject(new Error("附件读取失败，请重新选择"));
              reader.readAsDataURL(file);
            }),
        ),
      );
      setAttachments((current) => [...current, ...added]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setReadingFiles(false);
    }
  };
  const insertReference = (path: string, kind: "file" | "directory" = "file") => {
    const position = cursor.current;
    const token = atQuery === undefined ? undefined : activeAtToken(draft, position);
    let mention = formatFileMention({ path, kind }, false);
    if (!mention) return;
    if (kind === "directory" && mention.startsWith('@"')) mention += '"';
    setDraft(
      token
        ? `${draft.slice(0, position - token.prefix.length)}${mention} ${draft.slice(position)}`
        : `${draft}${draft && !/\s$/.test(draft) ? " " : ""}${mention} `,
    );
    setReferences(false);
    setAtQuery(undefined);
    input.current?.focus();
  };
  // 服务、接口或 Key 变了，之前获取的模型和还没回来的请求都作废。
  const dropModels = () => {
    modelRequest.current++;
    setLoadingModels(false);
    setAvailableModels([]);
    setModelNotice("");
  };
  const loadModels = async () => {
    const request = ++modelRequest.current;
    setLoadingModels(true);
    setModelNotice("");
    try {
      const models = await call<typeof availableModels>("askModels", {
        provider,
        auth,
        ...(custom ? { baseURL, api } : {}),
        ...(key.trim() ? { apiKey: key.trim() } : {}),
      });
      if (request !== modelRequest.current) return;
      setAvailableModels(models);
      if (models.length) {
        setModel((current) =>
          models.some((item) => item.id === current) ? current : (models[0]?.id ?? current),
        );
        setManualModel(false);
      }
      setModelNotice(models.length ? `${models.length} 个模型` : "服务没有返回模型");
    } catch (err) {
      if (request !== modelRequest.current) return;
      setAvailableModels([]);
      setModelNotice(err instanceof Error ? err.message : String(err));
    } finally {
      if (request === modelRequest.current) setLoadingModels(false);
    }
  };
  const next = async () => {
    setSaving(true);
    setError("");
    try {
      const ai = await call<Settings>("askConfigure", {
        choice,
        ...(choice === "local"
          ? { agent: agentId, ...(cliPath.trim() ? { path: cliPath.trim() } : {}) }
          : {}),
        ...(choice === "builtin"
          ? {
              provider,
              model,
              auth,
              ...(availableModels.find((item) => item.id === model)?.image === undefined
                ? {}
                : { supportsImages: availableModels.find((item) => item.id === model)?.image }),
              ...(custom ? { baseURL, api } : {}),
              ...(key ? { apiKey: key } : {}),
            }
          : {}),
      });
      setKey("");
      setSettings(ai);
      // 换 AI 留在当前对话；后端会把对方没看过的记录带进提示词。
      setAuth(ai.auth ?? "key");
      if (!ai.supportsImages) setAttachments([]);
      setSessionReferences([]);
      if (choice === "builtin" && !asked) setStep(2);
      else setStep(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };
  const openModelMenu = () => {
    setModelMenu(!modelMenu);
    const agent = settings?.choice === "local" ? settings.localAgent : undefined;
    if (modelMenu || !agent) return;
    setAgentModels(null);
    setModelQuery("");
    void call<{ id: string; name?: string }[]>("askModels", { agent: agent.id, path: agent.path })
      .then(setAgentModels)
      .catch((err) => setAgentModels(err instanceof Error ? err.message : String(err)));
  };
  const switchModel = async (provider: string, id: string) => {
    setModelMenu(false);
    setSaving(true);
    setError("");
    try {
      const agent = settings?.choice === "local" ? settings.localAgent : undefined;
      setSettings(
        await call<Settings>(
          "askConfigure",
          agent
            ? { choice: "local", agent: agent.id, path: agent.path, model: id }
            : { choice: "builtin", provider, model: id },
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };
  const finish = async (off = false) => {
    setSaving(true);
    setError("");
    try {
      await call("configureAutomation", off ? { morning: false, organizer: false, news: false } : automation);
      setAsked(true);
      setStep(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };
  const lastUser = events.findLastIndex((event) => event.type === "user/message");
  const waiting =
    busy &&
    !events
      .slice(lastUser + 1)
      .some((event) => event.type === "assistant/message" || event.type === "tool/call");
  if (settings?.available === false)
    return (
      <div className={css.unavailable}>
        <div className={css.welcome}>
          <h1>问问引擎没有载入</h1>
          {onConnections && (
            <button type="button" onClick={onConnections}>
              打开 AI 与连接
            </button>
          )}
        </div>
      </div>
    );
  return (
    <div className={css.chat}>
      <nav className={css.threads} aria-label="对话">
        <button
          type="button"
          className={css.newThread}
          onClick={() => {
            selectThread(null);
            setDraft("");
            setAttachments([]);
            setSessionReferences([]);
            setError("");
          }}
        >
          ＋ 新对话
        </button>
        {[...groups].map(([label, rows]) => (
          <Fragment key={label}>
            <h2>{label}</h2>
            {rows.map(threadRow)}
          </Fragment>
        ))}
        {!!archived.length && (
          <>
            <button
              type="button"
              className={css.archivedToggle}
              onClick={() => setShowArchived(!showArchived)}
            >
              {t("已归档", "Archived")} {archived.length} {showArchived ? "⌃" : "⌄"}
            </button>
            {showArchived && archived.map(threadRow)}
          </>
        )}
      </nav>
      <section className={css.conversation} aria-label="问问开图">
        <div className={css.mobileNew}>
          <button
            type="button"
            onClick={() => {
              selectThread(null);
              setDraft("");
              setAttachments([]);
              setSessionReferences([]);
            }}
          >
            ＋ 新对话
          </button>
        </div>
        <div
          className={css.messages}
          ref={scroll}
          onScroll={() => {
            const element = scroll.current;
            if (element)
              nearBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight <= 40;
          }}
        >
          {!events.some((event) => event.type === "user/message") && (
            <div className={css.welcome}>
              <h1>从你正在推进的事聊起</h1>
              <div className={css.suggestions}>
                {questions.map((question) => (
                  <button
                    type="button"
                    key={question}
                    onClick={() => {
                      setDraft(question);
                      input.current?.focus();
                    }}
                  >
                    {question}
                  </button>
                ))}
              </div>
            </div>
          )}
          {events.map((event, index) => {
            const data = event.data;
            const message = data.message as { content?: unknown } | undefined;
            if (event.type === "user/message")
              return (
                <div key={event.id} className={css.user}>
                  {text(data.content)}
                  {Array.isArray(data.content) &&
                    data.content
                      .filter((block) => block.type === "file")
                      .map((block, i) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: attachments of one sent message never reorder.
                        <span key={i}> · {block.attachment?.name ?? "已附文件"}</span>
                      ))}
                  {Array.isArray(data.content) && data.content.some((block) => block.type === "image") && (
                    <span> · 已附图片</span>
                  )}
                </div>
              );
            if (event.type === "assistant/message" && text(message?.content))
              return (
                <article key={event.id} className={css.assistant}>
                  <DocumentBody content={text(message?.content)} />
                </article>
              );
            if (event.type === "tool/call") {
              const start = events.slice(0, index).findLastIndex((item) => item.type === "user/message");
              if (events.slice(start + 1, index).some((item) => item.type === "tool/call")) return null;
              const next = events.findIndex((item, i) => i > index && item.type === "user/message");
              const turn = events.slice(start + 1, next < 0 ? undefined : next);
              const calls = turn.filter(
                (item) =>
                  item.type === "tool/call" &&
                  !turn.some(
                    (result) =>
                      result.type === "tool/result" &&
                      (result.data.message as { toolCallId?: string })?.toolCallId === item.data.callId &&
                      teachingResult(result),
                  ),
              );
              if (!calls.length) return null;
              const running = busy && next < 0;
              const active = calls.findLast(
                (item) =>
                  !turn.some(
                    (result) =>
                      result.type === "tool/result" &&
                      (result.data.message as { toolCallId?: string })?.toolCallId === item.data.callId,
                  ),
              );
              const name = String(active?.data.name ?? "");
              const activity = !active
                ? "正在整理回答"
                : /search/.test(name)
                  ? "正在搜索"
                  : /read|list|status|overview|get|fetch/.test(name)
                    ? "正在读取资料"
                    : "正在调用工具";
              return (
                <details key={event.id} className={css.progress}>
                  <summary>
                    <span className={`${css.dot} ${running ? css.pulse : ""}`} />
                    {running ? activity : "处理步骤"}
                    <span className={css.stepCount}>{calls.length} 步</span>
                  </summary>
                  {calls.map((item) => (
                    <Tool
                      key={item.id}
                      event={item}
                      session={selected ?? ""}
                      finished={!running}
                      result={turn.find(
                        (result) =>
                          result.type === "tool/result" &&
                          (result.data.message as { toolCallId?: string })?.toolCallId === item.data.callId,
                      )}
                    />
                  ))}
                </details>
              );
            }
            if (event.type === "tool/result" && teachingResult(event)) {
              const call = events.find(
                (item) =>
                  item.type === "tool/call" &&
                  item.data.callId === (event.data.message as { toolCallId?: string })?.toolCallId,
              );
              if (call)
                return <Tool key={event.id} event={call} session={selected ?? ""} result={event} finished />;
            }
            if (event.type === "approval/asked" && typeof data.requestId === "string")
              return (
                <NativeApproval
                  key={`${selected}:${event.id}`}
                  session={selected ?? ""}
                  event={event}
                  resolution={events.find(
                    (item) => item.type === "approval/resolved" && item.data.requestId === data.requestId,
                  )}
                />
              );
            if (event.type === "approval/asked")
              return (
                <details key={event.id} className={css.tool}>
                  <summary>这一步需要更高权限，已跳过</summary>
                  <pre>{String(data.reason ?? data.callId ?? "")}</pre>
                </details>
              );
            if (event.type === "session.status" && data.error)
              return (
                <output key={event.id} className={css.notice}>
                  {String(data.error)}
                </output>
              );
            return null;
          })}
          {liveText && (
            <article className={css.assistant} aria-live="polite">
              <DocumentBody content={liveText} />
            </article>
          )}
          {waiting && !liveText && (
            <output className={css.progress}>
              <span className={`${css.dot} ${css.pulse}`} />
              正在准备回答
            </output>
          )}
        </div>
        {error && !step && (
          <p className={css.notice} role="alert">
            {error}
          </p>
        )}
        {loaded && !settings?.configured && (
          <div className={css.connect}>
            <span>连接 AI，就能在这里聊。</span>
            <button type="button" onClick={() => setStep(1)}>
              连接 AI
            </button>
          </div>
        )}
        <form
          className={css.composer}
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes("Files")) event.preventDefault();
          }}
          onDrop={(event) => {
            event.preventDefault();
            void addFiles(Array.from(event.dataTransfer.files));
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setModelMenu(false);
              closeReferences();
            }
          }}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) {
              setModelMenu(false);
            }
          }}
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <textarea
            aria-label="给开图发消息"
            ref={input}
            rows={2}
            value={draft}
            maxLength={100000}
            placeholder="问问开图，或者让它帮你记一件事"
            onChange={(event) => {
              setDraft(event.target.value);
              cursor.current = event.target.selectionStart;
              setAtQuery(activeAtToken(event.target.value, event.target.selectionStart)?.query);
            }}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData.files);
              if (files.length) {
                event.preventDefault();
                void addFiles(files);
              }
            }}
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={() => {
              composing.current = false;
            }}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing &&
                !composing.current &&
                event.keyCode !== 229
              ) {
                event.preventDefault();
                void send();
              }
            }}
          />
          {attachments.map((file, index) => (
            <div className={css.attachment} key={`${index}:${file.name}`}>
              {file.kind === "image" && (
                <img src={`data:${file.mimeType};base64,${file.data}`} alt={file.name} />
              )}
              <span>{file.name}</span>
              <button
                type="button"
                onClick={() => setAttachments((current) => current.filter((_, i) => i !== index))}
                aria-label={`移除 ${file.name}`}
              >
                ×
              </button>
            </div>
          ))}
          {sessionReferences.map((reference) => (
            <div key={reference.id} className={css.attachment}>
              <span>引用对话 · {reference.title}</span>
              <button
                type="button"
                aria-label={`移除引用 ${reference.title}`}
                onClick={() =>
                  setSessionReferences((current) => current.filter((item) => item.id !== reference.id))
                }
              >
                ×
              </button>
            </div>
          ))}
          {readingFiles && <output>正在读取附件…</output>}
          {(references || atQuery !== undefined) && (
            <div className={css.referencePanel}>
              {references && (
                <div className={css.referenceTabs}>
                  <button
                    type="button"
                    aria-pressed={referenceKind === "files"}
                    onClick={() => {
                      setReferenceKind("files");
                      setAtQuery(undefined);
                    }}
                  >
                    文件和文件夹
                  </button>
                  <button
                    type="button"
                    aria-pressed={referenceKind === "sessions"}
                    onClick={() => {
                      setReferenceKind("sessions");
                      setAtQuery(undefined);
                    }}
                  >
                    其他对话
                  </button>
                </div>
              )}
              {references && referenceKind === "sessions" && atQuery === undefined ? (
                <section className={filesCss.picker} aria-label="引用对话">
                  <header className={filesCss.header}>
                    <span>其他对话</span>
                    <button type="button" onClick={closeReferences} aria-label="关闭对话选择">
                      ×
                    </button>
                  </header>
                  {!referenceThreads.length && <p className={filesCss.notice}>还没有其他可引用的对话</p>}
                  <div className={filesCss.list}>
                    {referenceThreads.map((thread) => (
                      <button
                        type="button"
                        className={filesCss.row}
                        key={thread.id}
                        onClick={async () => {
                          try {
                            const mention = await call<string>("askSupport", "sessionMention", {
                              sessionId: thread.id,
                              label: thread.title,
                            });
                            setSessionReferences((current) =>
                              current.some((item) => item.id === thread.id)
                                ? current
                                : [...current, { id: thread.id, title: thread.title, mention }],
                            );
                            closeReferences();
                          } catch (err) {
                            setError(err instanceof Error ? err.message : String(err));
                          }
                        }}
                      >
                        <span className={filesCss.path} title={thread.title}>
                          {thread.title}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              ) : (
                <FilePicker query={atQuery} select={insertReference} close={closeReferences} />
              )}
            </div>
          )}
          <div className={css.composerRow}>
            <input
              ref={upload}
              type="file"
              multiple
              hidden
              onChange={(event) => {
                void addFiles(Array.from(event.target.files ?? []));
                event.target.value = "";
              }}
            />
            <button
              type="button"
              className={css.add}
              aria-label="添加附件"
              disabled={busy || readingFiles || settings?.supportsAttachments === false}
              onClick={() => upload.current?.click()}
            >
              ＋
            </button>
            <button
              type="button"
              className={css.model}
              disabled={busy || settings?.choice === "local"}
              onClick={() => {
                cursor.current = input.current?.selectionStart ?? draft.length;
                setAtQuery(undefined);
                if (settings?.choice === "local") return;
                setReferences(!references);
                setModelMenu(false);
              }}
            >
              引用资料
            </button>
            <span className={css.modelWrap}>
              <button
                type="button"
                className={css.model}
                disabled={busy}
                aria-haspopup="dialog"
                aria-expanded={modelMenu}
                title={
                  settings?.configured
                    ? `${runtimeLabel} · ${settings.providerName} · ${settings.model}`
                    : undefined
                }
                onClick={openModelMenu}
              >
                <span className={css.modelName}>
                  {settings?.configured
                    ? `${localRuntime ? `${runtimeLabel} · ` : ""}${settings.providerName} · ${settings.model}`
                    : t("连接 AI", "Connect AI")}
                </span>
                <span aria-hidden="true">⌄</span>
              </button>
              {modelMenu && (
                <dialog open className={`${v2["mode-pop"]} ${css.modelPopover}`} aria-label="当前 AI">
                  {localRuntime && (
                    <p className={v2.small}>
                      {t(
                        "使用所选 Agent 的本机能力，操作审批由 Agent 自己处理。",
                        "Uses the selected Agent's local capabilities and its own approval flow.",
                      )}
                    </p>
                  )}
                  {settings?.choice === "local" &&
                    (agentModels === null ? (
                      <span className={css.model}>{t("正在读取模型…", "Loading models…")}</span>
                    ) : typeof agentModels === "string" ? (
                      <span className={css.model}>{agentModels}</span>
                    ) : !agentModels.length ? (
                      <span className={css.model}>{settings.model}</span>
                    ) : (
                      <>
                        {agentModels.length > 8 && (
                          <input
                            className={css.modelSearch}
                            type="search"
                            value={modelQuery}
                            onChange={(event) => setModelQuery(event.target.value)}
                            placeholder={t("搜索模型…", "Search models…")}
                            // biome-ignore lint/a11y/noAutofocus: 打开菜单就是为了挑模型。
                            autoFocus
                          />
                        )}
                        {agentModels
                          .filter((item) =>
                            `${item.id} ${item.name ?? ""}`
                              .toLowerCase()
                              .includes(modelQuery.trim().toLowerCase()),
                          )
                          .map((item) => (
                            <button
                              type="button"
                              key={item.id}
                              className={css.model}
                              aria-pressed={settings.model === item.id}
                              disabled={busy || saving}
                              onClick={() => void switchModel(settings.provider, item.id)}
                            >
                              {item.name ?? item.id}
                            </button>
                          ))}
                      </>
                    ))}
                  {settings?.choice !== "local" &&
                    settings?.saved?.flatMap((row) =>
                      row.models.map((id) => (
                        <button
                          type="button"
                          key={`${row.provider}/${id}`}
                          className={css.model}
                          aria-pressed={
                            settings.configured && settings.provider === row.provider && settings.model === id
                          }
                          disabled={busy || saving}
                          onClick={() => void switchModel(row.provider, id)}
                        >
                          {row.name} · {id}
                        </button>
                      )),
                    )}
                  <button
                    type="button"
                    className={css.model}
                    onClick={() => {
                      setModelMenu(false);
                      setStep(1);
                    }}
                  >
                    {settings?.choice === "local" ? t("换一个 AI", "Switch AI") : "添加服务商"}
                  </button>
                </dialog>
              )}
            </span>
            {busy ? (
              <button
                type="button"
                className={css.send}
                aria-label={t("停止", "Stop")}
                onClick={() => {
                  if (selected) void call("askCancel", selected).catch((err) => setError(err.message));
                }}
              >
                <span className={css.stopIcon} aria-hidden="true" />
              </button>
            ) : (
              <button
                type="submit"
                className={css.send}
                aria-label="发送"
                disabled={
                  readingFiles ||
                  (!draft.trim() && !attachments.length && !sessionReferences.length) ||
                  !settings?.configured
                }
              >
                ↑
              </button>
            )}
          </div>
        </form>
        <p className={css.scope}>
          {settings?.configured
            ? `${settings.providerName} · ${runtimeLabel}`
            : "Enter 发送 · Shift + Enter 换行"}
        </p>
      </section>
      <dialog
        ref={dialog}
        className={css.dialog}
        aria-labelledby="ask-connect-title"
        onCancel={(event) => {
          if (saving) event.preventDefault();
          else setStep(0);
        }}
        onClose={() => {
          setKey("");
        }}
      >
        <p className={css.step}>第 {step} 步，共 2 步</p>
        {step === 1 ? (
          <>
            <h2 id="ask-connect-title">连接 AI</h2>
            <button
              type="button"
              className={css.choice}
              aria-pressed={choice === "local"}
              disabled={saving}
              onClick={() => setChoice("local")}
            >
              <b>{t("用本机 Agent", "Use a local agent")}</b>
              <span>
                {t(
                  "使用 CodeBuddy、Claude Code、Kimi 等 CLI 的账号和本机能力，操作审批由 Agent 自己处理。",
                  "Uses the accounts and local capabilities of CodeBuddy, Claude Code, Kimi and other CLIs, with the Agent's own approval flow.",
                )}
              </span>
            </button>
            <button
              type="button"
              className={css.choice}
              aria-pressed={choice === "builtin"}
              disabled={saving}
              onClick={() => {
                setChoice("builtin");
                if (settings?.choice === "local")
                  void call<Settings>("askSupport", "builtinSettings", {})
                    .then((ai) => {
                      setSettings((current) =>
                        current
                          ? { ...current, providers: ai.providers, protocols: ai.protocols, saved: ai.saved }
                          : ai,
                      );
                      setProvider(ai.provider);
                      setModel(ai.model);
                    })
                    .catch((err) => setError(err.message));
              }}
            >
              <b>用开图里的 AI</b>
              <span>用 API Key 连接，或使用服务商提供的账号登录。</span>
            </button>
            {choice === "local" && (
              <div className={css.fields}>
                {!!settings?.localAgents?.length && (
                  <label className={css.key}>
                    Agent
                    <select
                      value={agentId}
                      onChange={(event) => {
                        setAgentId(event.target.value);
                        setCliPath("");
                      }}
                    >
                      {settings.localAgents.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className={css.key}>
                  {t("CLI 路径（可选，留空自动检测）", "CLI path (optional; auto-detect when empty)")}
                  <input
                    value={cliPath}
                    onChange={(event) => setCliPath(event.target.value)}
                    placeholder={settings?.localAgents?.find((item) => item.id === agentId)?.path}
                  />
                </label>
              </div>
            )}
            {choice === "builtin" ? (
              <fieldset className={css.fields} disabled={saving}>
                <label className={css.key}>
                  AI 服务
                  <select
                    value={provider}
                    onChange={(event) => {
                      const id = event.target.value;
                      dropModels();
                      setManualModel(false);
                      setProvider(id);
                      setAuth(settings?.provider === id ? (settings.auth ?? "key") : "key");
                      setModel(settings?.provider === id ? settings.model : "");
                      setKey("");
                      setError("");
                    }}
                  >
                    {settings?.providers.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                        {item.recommended ? "（推荐）" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                {custom && (
                  <label className={css.key}>
                    协议
                    <select
                      value={api}
                      onChange={(event) => {
                        dropModels();
                        setApi(event.target.value);
                      }}
                    >
                      {settings?.protocols.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {custom && (
                  <label className={css.key}>
                    Base URL
                    <input
                      type="url"
                      value={baseURL}
                      placeholder="https://api.example.com/v1"
                      onChange={(event) => {
                        dropModels();
                        setBaseURL(event.target.value);
                      }}
                    />
                  </label>
                )}
                {selectedProvider?.authKey && (
                  <DshAuthorization
                    provider={selectedProvider}
                    onAuthorized={() => {
                      setAuth("dsh");
                      setKey("");
                      setModelNotice("账号已授权");
                    }}
                  />
                )}
                {!nativeLoginOnly && (
                  <label className={css.key}>
                    API Key
                    <input
                      type="password"
                      autoComplete="off"
                      value={key}
                      placeholder={
                        settings?.configured && settings.provider === provider
                          ? "已连接，留空保留"
                          : "粘贴这个 AI 服务的 API Key"
                      }
                      onChange={(event) => {
                        dropModels();
                        setKey(event.target.value);
                        setAuth("key");
                      }}
                      onBlur={() => {
                        if (key.trim()) void loadModels();
                      }}
                    />
                  </label>
                )}
                {availableModels.length > 0 && (
                  <label className={css.key}>
                    模型
                    <select
                      value={manualModel ? "" : model}
                      onChange={(event) => {
                        setManualModel(!event.target.value);
                        setModel(event.target.value);
                      }}
                    >
                      {availableModels.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name && item.name !== item.id ? `${item.name} · ${item.id}` : item.id}
                        </option>
                      ))}
                      <option value="">手动填写模型 ID</option>
                    </select>
                  </label>
                )}
                {(!availableModels.length || manualModel) && (
                  <label className={css.key} htmlFor="ask-model">
                    {availableModels.length ? "模型 ID" : "模型"}
                    <input
                      id="ask-model"
                      value={model}
                      placeholder="从服务获取后选择，或填写模型 ID"
                      onChange={(event) => setModel(event.target.value)}
                    />
                  </label>
                )}
                <button type="button" onClick={() => void loadModels()} disabled={loadingModels}>
                  {loadingModels ? "正在获取模型…" : "从服务获取模型列表"}
                </button>
                {modelNotice && <output>{modelNotice}</output>}
                {selectedProvider?.keyUrl ? (
                  <a href={selectedProvider.keyUrl} target="_blank" rel="noreferrer">
                    去 {selectedProvider.name} 官方申请 API Key ↗
                  </a>
                ) : null}
              </fieldset>
            ) : null}
            {error && <p role="alert">{error}</p>}
            <div className={css.actions}>
              <button type="button" disabled={saving} onClick={() => setStep(0)}>
                以后再说
              </button>
              <button
                type="button"
                disabled={saving || loadingModels || (choice === "builtin" && !model.trim())}
                onClick={() => void next()}
              >
                {saving ? "连接中…" : "下一步"}
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 id="ask-connect-title">每天自动整理</h2>
            {(
              [
                ["morning", "每天早上 7:30 排好今天"],
                ["organizer", "每晚 3:00 整理一遍"],
                ["news", "每天早上 8:00 搜索资讯"],
              ] as const
            ).map(([id, label]) => (
              <label className={css.toggle} key={id}>
                <input
                  type="checkbox"
                  checked={automation[id]}
                  onChange={(event) => setAutomation({ ...automation, [id]: event.target.checked })}
                />
                {label}
              </label>
            ))}
            {error && <p role="alert">{error}</p>}
            <div className={css.actions}>
              <button type="button" disabled={saving} onClick={() => void finish(true)}>
                都不要
              </button>
              <button type="button" disabled={saving} onClick={() => void finish()}>
                {saving ? "保存中…" : "开始用"}
              </button>
            </div>
          </>
        )}
      </dialog>
    </div>
  );
}
