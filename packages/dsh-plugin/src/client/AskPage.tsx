import { activeAtToken, formatFileMention } from "@deepseek-ai/dsh-file-reference/grammar";
import { openmaicMetaFrom } from "@kaitu/core/teaching-frame";
import { widgetMetaFrom } from "@kaitu/core/teaching-frame";
import {
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { OverviewData } from "../types.js";
import { AiSettings } from "./AiSettings.js";
import css from "./AskPage.module.css";
import { DocumentBody } from "./DocumentBody.js";
import { FilePicker } from "./DshFiles.js";
import filesCss from "./DshFiles.module.css";
import v2 from "./Prototype.module.css";
import type { AskAutoSubmit, AskHandoffStatus } from "./ask-handoff.js";
import { type Locale, useLocale, useT } from "./i18n.js";
import { OpenmaicCard } from "./openmaic/OpenmaicCard.js";
import { WidgetCard } from "./openmaic/WidgetCard.js";

interface Thread {
  handoff?: { requestId: string; phase: "ready" | "started" };
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
  permissionMode?: string;
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
  supportsImages?: boolean;
  providers: Provider[];
  /** 已添加的服务商和模型，存在 DSH 的 profile 里。 */
  saved?: { provider: string; name: string; models: string[]; auth?: "key" | "dsh" }[];
  reasoningEffort?: string;
  modelCapabilityError?: boolean;
  modelCapabilities?: {
    id: string;
    reasoning?: { efforts: { id: string; name?: string }[]; defaultEffort?: string };
  }[];
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
function day(value: string, locale: Locale) {
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return locale === "en" ? "Today" : "今天";
  today.setDate(today.getDate() - 1);
  return date.toDateString() === today.toDateString()
    ? locale === "en"
      ? "Yesterday"
      : "昨天"
    : date.toLocaleDateString(locale);
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
  const t = useT();
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
    kaitu_status: t("你的开图资料", "Your Kaitu files"),
    kaitu_records: t("相关记录", "Related records"),
    kaitu_search_chats: t("历史对话", "Past conversations"),
    kaitu_life_map: t("足迹", "Footprints"),
    kaitu_exploration_read: t("方向与尝试", "Directions and experiments"),
  };
  const target = String(
    args.path ?? args.file_path ?? args.file ?? labels[name] ?? t("开图资料", "Kaitu files"),
  );
  const reading = name in labels || /read|list|search|status|overview|get/.test(name);
  const running = !result && !finished;
  return (
    <details className={css.tool}>
      <summary>
        <span className={`${css.dot} ${running ? css.pulse : ""}`} />
        {running
          ? t(`正在${reading ? "读" : "处理"} ${target}`, `${reading ? "Reading" : "Working on"} ${target}`)
          : message?.isError
            ? t(`未完成 ${target}`, `Couldn’t complete ${target}`)
            : result
              ? t(`${reading ? "读了" : "完成了"} ${target}`, `${reading ? "Read" : "Completed"} ${target}`)
              : t(`已中断 ${target}`, `Stopped ${target}`)}
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
  disabled,
}: { event: ChatEvent; resolution?: ChatEvent; session: string; disabled: boolean }) {
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
    if (disabled || responding || submitted || status) return;
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
        {data.reason || t("本机 Agent 请求批准这一步", "The local Agent requests approval")}
        {status ? ` · ${labels[status]}` : ""}
      </summary>
      <pre>{data.detail}</pre>
      {!status && (
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
            <button
              type="button"
              disabled={disabled || responding || submitted}
              onClick={() => void answer(null)}
            >
              {t("拒绝这一次", "Reject")}
            </button>
            {allow && (
              <button
                type="button"
                disabled={disabled || responding || submitted}
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
  initialPromptNewConversation = false,
  autoSubmit,
  configureRequest = 0,
  configureBuiltin = false,
  onConnections,
  onToday,
  onSettings,
}: {
  workspace: string;
  active?: boolean;
  initialPrompt?: string;
  initialPromptRequest?: number;
  initialPromptNewConversation?: boolean;
  autoSubmit?: AskAutoSubmit;
  configureRequest?: number;
  configureBuiltin?: boolean;
  onConnections?: () => void;
  onToday?: () => void;
  onSettings?: (section: "ai" | "local-ai") => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [agentModels, setAgentModels] = useState<{ id: string; name?: string }[] | string | null>(null);
  const [otherAgentModels, setOtherAgentModels] = useState<Record<string, { id: string; name?: string }[]>>(
    {},
  );
  const [agentModes, setAgentModes] = useState<{ modes: { id: string; name: string }[] } | string | null>(
    null,
  );
  const [modelQuery, setModelQuery] = useState("");
  const modelRequestSeq = useRef(0);
  const modelTrigger = useRef<HTMLButtonElement>(null);
  const [addMenu, setAddMenu] = useState(false);
  const [liveText, setLiveText] = useState("");
  const [threads, setThreads] = useState<Thread[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [events, setEvents] = useState<ChatEvent[]>([]);
  const [draft, setDraft] = useState(initialPrompt);
  useEffect(() => {
    if (!initialPrompt && !initialPromptRequest) return;
    if (initialPromptNewConversation) setSelected(null);
    setDraft(initialPrompt);
    const frame = requestAnimationFrame(() => {
      const field = input.current;
      field?.focus();
      field?.setSelectionRange(field.value.length, field.value.length);
    });
    return () => cancelAnimationFrame(frame);
  }, [initialPrompt, initialPromptRequest, initialPromptNewConversation]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const configurationRequested = useRef(false);
  const [connectionFocus, setConnectionFocus] = useState(0);
  const [connectionLocalOnly, setConnectionLocalOnly] = useState(false);
  useEffect(() => {
    if (configureRequest) {
      configurationRequested.current = true;
      setStep(1);
      setConnectionLocalOnly(false);
      if (configureBuiltin) setConnectionFocus((n) => n + 1);
    }
  }, [configureRequest, configureBuiltin]);
  const [showThreads, setShowThreads] = useState(false);
  const connectKey = () => {
    if (onSettings) return onSettings("ai");
    setConnectionLocalOnly(false);
    setConnectionFocus((n) => n + 1);
    setStep(1);
  };
  const checkLocal = () => {
    if (onSettings) return onSettings("local-ai");
    setConnectionLocalOnly(true);
    setStep(1);
  };
  const [questions, setQuestions] = useState<string[]>([]);
  const [modelMenu, setModelMenu] = useState(false);
  useEffect(() => {
    if (!modelMenu) modelRequestSeq.current++;
  }, [modelMenu]);
  useEffect(
    () => () => {
      modelRequestSeq.current++;
    },
    [],
  );
  const [catalogStatus, setCatalogStatus] = useState<string | null>(null);
  const drafts = useRef(
    new Map<
      string | null,
      {
        text: string;
        attachments: AttachmentInput[];
        sessions: { id: string; title: string; mention: string }[];
        files: { path: string; kind: "file" | "directory"; mention: string }[];
      }
    >(),
  );
  const selectThread = (id: string | null, follow = false) => {
    const current = draftSnapshot.current;
    if (current.selected !== id) {
      drafts.current.set(current.selected, {
        text: current.draft,
        attachments: current.attachments,
        sessions: current.sessions,
        files: current.files,
      });
      const next = drafts.current.get(id);
      setDraft(next?.text ?? "");
      setAttachments(next?.attachments ?? []);
      setSessionReferences(next?.sessions ?? []);
      setFileReferences(next?.files ?? []);
    }
    activeSession.current = id;
    nearBottom.current = !id || follow;
    if (!nearBottom.current && scroll.current) scroll.current.scrollTop = 0;
    setSelected(id);
    setModelMenu(false);
  };
  const localRuntime = settings?.mode ? settings.mode === "full" : !!settings?.fullOnly;
  const runtimeLabel = localRuntime ? t("本机 Agent", "Local Agent") : t("开图资料", "Kaitu files");

  const [attachments, setAttachments] = useState<AttachmentInput[]>([]);
  const [readingFiles, setReadingFiles] = useState(false);
  const [references, setReferences] = useState(false);
  const [referenceKind, setReferenceKind] = useState<"files" | "sessions">("files");
  const [sessionReferences, setSessionReferences] = useState<
    { id: string; title: string; mention: string }[]
  >([]);
  const [fileReferences, setFileReferences] = useState<
    { path: string; kind: "file" | "directory"; mention: string }[]
  >([]);
  const draftSnapshot = useRef({
    selected,
    draft,
    attachments,
    sessions: sessionReferences,
    files: fileReferences,
  });
  draftSnapshot.current = {
    selected,
    draft,
    attachments,
    sessions: sessionReferences,
    files: fileReferences,
  };
  const [atQuery, setAtQuery] = useState<string | undefined>();
  const cursor = useRef(0);
  const upload = useRef<HTMLInputElement>(null);
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
  useEffect(() => {
    const guard = (event: Event) => {
      if (draft.trim() || attachments.length || sessionReferences.length || busy || readingFiles)
        event.preventDefault();
    };
    window.addEventListener("kaitu:before-ask-draft", guard);
    return () => window.removeEventListener("kaitu:before-ask-draft", guard);
  }, [draft, attachments, sessionReferences, busy, readingFiles]);
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
    groups.set(t("置顶", "Pinned"), [...(groups.get(t("置顶", "Pinned")) ?? []), thread]);
  for (const thread of threads.filter((row) => !row.pinned && !row.archived)) {
    const label = day(thread.updated, locale);
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
        const prompts = data.projects
          .slice(0, 2)
          .map((project) =>
            t(`「${project.title}」下一步先做什么？`, `What should I do next for “${project.title}”?`),
          );
        if (data.allNext.length)
          prompts.push(
            t(
              `帮我梳理「${data.allNext[0]?.title}」怎么推进`,
              `Help me work through “${data.allNext[0]?.title}”`,
            ),
          );
        if (data.notes.length) prompts.push(t("帮我回顾最近保存的记录", "Help me review my recent records"));
        setQuestions(prompts.slice(0, 3));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [t]);
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
        disabled={!settings?.configured}
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
    if (!active) return;
    let current = true;
    const fail = (err: Error) => {
      if (current) setError(err.message);
    };
    // 本地对话列表先显示，不等待连接状态或自动整理设置。
    void call<Thread[]>("askList")
      .then((list) => {
        if (current) setThreads(list);
      })
      .catch(fail);
    const ai = call<Settings>("askSettings");
    const auto = call<Automation>("automation");
    void ai.then((value) => {
      if (!current) return;
      setSettings(value);
      setLoaded(true);
    }, fail);
    void auto.then((value) => {
      if (!current) return;
      setAsked(value.asked);
      if (value.asked) setAutomation(value.tasks);
    }, fail);
    void Promise.all([ai, auto]).then(
      ([value, automation]) => {
        if (!current || configurationRequested.current) return;
        if (value.configured && !automation.asked && value.choice !== "local") setStep(2);
      },
      () => {},
    );
    return () => {
      current = false;
    };
  }, [active]);
  useEffect(() => {
    if (!active) return;
    const refresh = () =>
      void call<Settings>("askSettings")
        .then(setSettings)
        .catch((err) => setError(err.message));
    window.addEventListener("kaitu-ai-changed", refresh);
    return () => window.removeEventListener("kaitu-ai-changed", refresh);
  }, [active]);
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
    stream.onerror = () => setError(t("对话连接中断，正在重连…", "Connection lost. Reconnecting…"));
    stream.onopen = () => setError("");
    return () => stream.close();
  }, [selected, refreshThreads, t]);
  useLayoutEffect(() => {
    if (nearBottom.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  });
  const send = async () => {
    const value =
      draft.trim() ||
      (attachments.length
        ? t("请看看这些附件", "Please review these attachments")
        : sessionReferences.length || fileReferences.length
          ? t("参考这些资料帮我继续", "Help me continue using these references")
          : "");
    if (!value || busy || readingFiles || !settings?.configured) return;
    nearBottom.current = true;
    // askSend 要等整轮回复；输入框一点发送就清掉，失败再还原（若用户已另写则不覆盖）。
    const pendingText = value;
    const pendingAttachments = attachments;
    const pendingReferences = sessionReferences;
    const pendingFiles = fileReferences;
    const payload = [
      value,
      ...fileReferences.map((reference) => reference.mention),
      ...sessionReferences.map((reference) => reference.mention),
    ].join("\n");
    draftSnapshot.current = { ...draftSnapshot.current, draft: "", attachments: [], sessions: [], files: [] };
    setDraft("");
    setAttachments([]);
    setSessionReferences([]);
    setFileReferences([]);
    setError("");
    setSending(true);
    let id = selected;
    try {
      if (!id) {
        const thread = await call<Thread>("askCreate");
        id = thread.id;
        if (activeSession.current === null) selectThread(id, true);
      }
      await call("askSend", id, payload, pendingAttachments);
      await refreshThreads();
    } catch (err) {
      if (activeSession.current === id) {
        setDraft((current) => (current.trim() ? current : pendingText));
        setAttachments((current) => (current.length ? current : pendingAttachments));
        setSessionReferences((current) => (current.length ? current : pendingReferences));
        setFileReferences((current) => (current.length ? current : pendingFiles));
      } else {
        const previous = drafts.current.get(id);
        drafts.current.set(id, {
          text: previous?.text.trim() ? previous.text : pendingText,
          attachments: previous?.attachments.length ? previous.attachments : pendingAttachments,
          sessions: previous?.sessions.length ? previous.sessions : pendingReferences,
          files: previous?.files.length ? previous.files : pendingFiles,
        });
      }
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
  const handoffSelect = useRef(selectThread);
  handoffSelect.current = selectThread;
  const handoffAttempt = useRef<string>();
  const [handoffRetry, setHandoffRetry] = useState(0);
  const [handoffState, setHandoffState] = useState<
    "saved" | "sending" | "retry" | "uncertain" | "failed" | null
  >(null);
  const checkHandoff = useCallback(async () => {
    if (!autoSubmit) return;
    const receipt = await call<AskHandoffStatus>("askHandoffStatus", autoSubmit.requestId);
    setHandoffState(
      receipt.status === "completed"
        ? "saved"
        : receipt.status === "running"
          ? "sending"
          : receipt.status === "ready" || receipt.status === "not_found"
            ? "retry"
            : receipt.status,
    );
    return receipt;
  }, [autoSubmit]);
  useEffect(() => {
    if (autoSubmit && events.at(-1)?.type === "session.status")
      void checkHandoff().catch(() => setHandoffState("uncertain"));
  }, [autoSubmit, events, checkHandoff]);
  useEffect(() => {
    if (!autoSubmit || !loaded) return;
    if (!settings?.configured) {
      setHandoffState("retry");
      return;
    }
    const attempt = `${autoSubmit.requestId}:${handoffRetry}`;
    if (handoffAttempt.current === attempt) return;
    handoffAttempt.current = attempt;
    const current = () => handoffAttempt.current === attempt;
    const run = async () => {
      setHandoffState("sending");
      try {
        const thread = await call<Thread>("askCreate", autoSubmit.requestId);
        if (!current()) return;
        handoffSelect.current(thread.id, true);
        await refreshThreads();
        if (thread.handoff && thread.handoff.phase !== "ready") {
          await checkHandoff();
          return;
        }
        const references = autoSubmit.references.flatMap((path) => {
          const mention = formatFileMention({ path, kind: "file" }, false);
          return mention ? [mention] : [];
        });
        await call<{ status?: string }>(
          "askSend",
          thread.id,
          [autoSubmit.text, ...references].join("\n"),
          [],
          autoSubmit.requestId,
        );
        if (current()) await checkHandoff();
      } catch (err) {
        if (!current()) return;
        try {
          await checkHandoff();
        } catch {
          setHandoffState("uncertain");
        }
        setError(err instanceof Error ? err.message : String(err));
      }
    };
    void run();
  }, [autoSubmit, handoffRetry, loaded, settings?.configured, refreshThreads, checkHandoff]);
  const addFiles = async (files: File[]) => {
    if (!settings?.configured) return;
    if (!files.length || busy || readingFiles) return;
    setError("");
    if (attachments.length + files.length > 10 || files.some((file) => file.size > 25 * 1024 * 1024)) {
      setError(
        t("每次最多添加 10 个附件，单个附件不超过 25MB", "Add up to 10 attachments, each up to 25 MB"),
      );
      return;
    }
    setReadingFiles(true);
    try {
      if (files.some((file) => file.type.startsWith("image/"))) {
        const connection =
          settings.supportsImages === undefined ? await call<Settings>("askSettings", true) : settings;
        setSettings(connection);
        if (!connection.supportsImages)
          throw new Error(t("当前模型不支持图片", "This model does not support images"));
      }
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
              reader.onerror = () =>
                reject(
                  new Error(t("附件读取失败，请重新选择", "Couldn’t read the attachment. Choose it again.")),
                );
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
    setDraft(token ? `${draft.slice(0, position - token.prefix.length)}${draft.slice(position)}` : draft);
    setFileReferences((current) =>
      current.some((item) => item.path === path && item.kind === kind)
        ? current
        : [...current, { path, kind, mention }],
    );
    setReferences(false);
    setAtQuery(undefined);
    input.current?.focus();
  };
  const loadSavedModels = () => {
    const request = modelRequestSeq.current;
    setCatalogStatus("");
    void call<Settings>("askSupport", "builtinSettings", { saved: true })
      .then((catalog) => {
        if (request !== modelRequestSeq.current) return;
        setSettings((current) => {
          if (!current) return current;
          const siwc = current.saved?.find((row) => row.provider === "chatgpt-siwc");
          const saved = catalog.saved ?? [];
          return {
            ...current,
            saved: siwc && !saved.some((row) => row.provider === siwc.provider) ? [...saved, siwc] : saved,
            modelCapabilities:
              current.choice !== "local" &&
              catalog.provider === current.provider &&
              catalog.model === current.model
                ? catalog.modelCapabilities
                : undefined,
          };
        });
        setCatalogStatus(
          catalog.modelCapabilityError
            ? t("模型能力读取失败，请重试", "Could not load model capabilities. Try again.")
            : null,
        );
      })
      .catch((err) => {
        if (request === modelRequestSeq.current) setCatalogStatus(err.message);
      });
    if (settings?.provider !== "chatgpt-siwc" || settings?.choice === "local") {
      void call<{ authenticated: boolean; planEnabled: boolean }>("askSupport", "siwc/status", {})
        .then((status) =>
          status.authenticated && status.planEnabled
            ? call<{ id: string }[]>("askSupport", "siwc/models", {})
            : [],
        )
        .then((models) => {
          if (request !== modelRequestSeq.current || !models.length) return;
          setSettings((current) =>
            current
              ? {
                  ...current,
                  saved: [
                    ...(current.saved ?? []).filter((row) => row.provider !== "chatgpt-siwc"),
                    {
                      provider: "chatgpt-siwc",
                      name: t("ChatGPT 计划", "ChatGPT plan"),
                      models: models.map((model) => model.id),
                    },
                  ],
                }
              : current,
          );
        })
        .catch(() => {});
    }
  };
  const openModelMenu = () => {
    if (!settings?.configured || saving || busy) return;
    modelRequestSeq.current++;
    setAddMenu(false);
    setModelQuery("");
    setModelMenu(!modelMenu);
    const agent = settings?.choice === "local" ? settings.localAgent : undefined;
    if (modelMenu) return;
    loadSavedModels();
    setOtherAgentModels({});
    const request = modelRequestSeq.current;
    for (const candidate of settings?.localAgents ?? []) {
      if (candidate.id === agent?.id) continue;
      void call<{ id: string; name?: string }[]>("askModels", { agent: candidate.id, path: candidate.path })
        .then((models) => {
          if (request === modelRequestSeq.current)
            setOtherAgentModels((current) => ({
              ...current,
              [candidate.id]: models.length
                ? models
                : [{ id: "默认模型", name: t("默认模型", "Default model") }],
            }));
        })
        .catch(() => {});
    }
    if (!agent) {
      return;
    }
    setAgentModels(null);
    setAgentModes(null);
    setModelQuery("");
    void call<{ id: string; name?: string }[]>("askModels", { agent: agent.id, path: agent.path })
      .then((models) => {
        if (request === modelRequestSeq.current) setAgentModels(models);
      })
      .catch((err) => {
        if (request === modelRequestSeq.current)
          setAgentModels(err instanceof Error ? err.message : String(err));
      });
    void call<{ modes: { id: string; name: string }[] }>("askSupport", "localAgentModes", {})
      .then((modes) => {
        if (request === modelRequestSeq.current) setAgentModes(modes);
      })
      .catch((err) => {
        if (request === modelRequestSeq.current)
          setAgentModes(err instanceof Error ? err.message : String(err));
      });
  };
  const switchModel = async (
    provider: string,
    id: string,
    permissionMode?: string,
    reasoningEffort?: string | null,
    forceBuiltin = false,
    auth?: "key" | "dsh",
  ) => {
    if (!settings?.configured || saving || busy) return;
    modelRequestSeq.current++;
    setModelMenu(false);
    setSaving(true);
    setError("");
    try {
      const agent = !forceBuiltin && settings?.choice === "local" ? settings.localAgent : undefined;
      setSettings(
        await call<Settings>(
          "askConfigure",
          agent
            ? {
                choice: "local",
                agent: agent.id,
                path: agent.path,
                ...(id !== "默认模型" ? { model: id } : {}),
                ...(permissionMode ? { permissionMode } : {}),
              }
            : {
                choice: "builtin",
                provider,
                model: id,
                ...(auth ? { auth } : {}),
                ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
              },
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      modelRequestSeq.current++;
      setSaving(false);
    }
  };
  const switchToAgent = async (agent: { id: string; path: string }, model: string) => {
    if (saving || busy) return;
    if (attachments.length || fileReferences.length || sessionReferences.length) {
      setError(
        t(
          "本机 Agent 不支持这些附件或引用，请先移除",
          "Remove attachments and references before switching to a local Agent",
        ),
      );
      return;
    }
    modelRequestSeq.current++;
    setModelMenu(false);
    setSaving(true);
    setError("");
    try {
      setSettings(
        await call<Settings>("askConfigure", {
          choice: "local",
          agent: agent.id,
          path: agent.path,
          ...(model !== "默认模型" ? { model } : {}),
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      modelRequestSeq.current++;
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
  const progress = useMemo(() => {
    const resolutions = new Map<unknown, ChatEvent>();
    for (const event of events)
      if (event.type === "approval/resolved" && !resolutions.has(event.data.requestId))
        resolutions.set(event.data.requestId, event);
    const groups = new Map<
      ChatEvent,
      { steps: ChatEvent[]; results: Map<unknown, ChatEvent>; last: boolean }
    >();
    let turn: ChatEvent[] = [];
    const group = (last: boolean) => {
      const results = new Map<unknown, ChatEvent>();
      const teaching = new Set<unknown>();
      for (const event of turn) {
        const callId = (event.data.message as { toolCallId?: string } | undefined)?.toolCallId;
        if (event.type === "tool/result" && !results.has(callId)) results.set(callId, event);
        if (event.type === "tool/result" && teachingResult(event)) teaching.add(callId);
      }
      const steps = turn.filter((event) =>
        event.type === "approval/asked"
          ? typeof event.data.requestId === "string" && resolutions.has(event.data.requestId)
          : event.type === "tool/call" && !teaching.has(event.data.callId),
      );
      if (steps[0]) groups.set(steps[0], { steps, results, last });
    };
    for (const event of events)
      if (event.type === "user/message") {
        group(false);
        turn = [];
      } else turn.push(event);
    group(true);
    return { resolutions, groups };
  }, [events]);
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
          <h1>{t("问问引擎没有载入", "Ask could not load")}</h1>
          {onConnections && (
            <button type="button" onClick={onConnections}>
              {t("打开 AI 与连接", "Open AI & connections")}
            </button>
          )}
        </div>
      </div>
    );
  return (
    <div
      className={`${css.chat} ${loaded && !settings?.configured && !threads.length ? css.noKeyChat : ""} ${showThreads ? css.showThreads : ""}`}
    >
      <nav id="ask-threads" className={css.threads} aria-label={t("对话", "Conversations")}>
        <button
          type="button"
          className={css.newThread}
          onClick={() => {
            selectThread(null);
            setError("");
          }}
        >
          {t("＋ 新对话", "+ New conversation")}
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
      <section className={css.conversation} aria-label={t("问问开图", "Ask Kaitu")}>
        <div className={css.mobileNew}>
          <button
            type="button"
            aria-expanded={showThreads}
            aria-controls="ask-threads"
            onClick={() => setShowThreads((value) => !value)}
          >
            {t("对话", "Conversations")}
          </button>
          <button
            type="button"
            onClick={() => {
              selectThread(null);
            }}
          >
            {t("＋ 新对话", "+ New conversation")}
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
          {loaded && !settings?.configured && !selected ? (
            <div className={css.noKey}>
              <h1>{t("先接上一个 AI。", "Connect an AI first.")}</h1>
              <p>
                {t(
                  "开图本身不带 AI。接上以后，问问只读你允许的那部分资料来回答；每次发出去的内容都写在输入框下面。",
                  "Kaitu does not include an AI. Once connected, Ask reads the data you allow; the details appear below the composer before you send.",
                )}
              </p>
              <section className={css.routes} aria-label={t("接 AI 的方式", "Ways to connect AI")}>
                <div>
                  <span>
                    <strong>{t("填一个 DeepSeek Key", "Add a DeepSeek key")}</strong>{" "}
                    <small>{t("推荐新手", "Good for starters")}</small>
                    <p>
                      {t("用自己的 Key 连接，按用量付费。", "Connect with your own key and pay for usage.")}
                    </p>
                  </span>
                  <button type="button" className={css.routePrimary} onClick={connectKey}>
                    {t("去填 Key", "Add a key")}
                  </button>
                </div>
                <div>
                  <span>
                    <strong>{t("用这台电脑上已经有的 AI", "Use AI already on this computer")}</strong>
                    <p>
                      {t(
                        "装了 Claude Code 或 Codex 的话，可以直接接上。",
                        "Connect an installed Agent such as Claude Code or Codex.",
                      )}
                    </p>
                  </span>
                  <button type="button" onClick={checkLocal}>
                    {t("去设置", "Open settings")}
                  </button>
                </div>
                <div>
                  <span>
                    <strong>{t("先不接", "Not now")}</strong>
                    <p>
                      {t(
                        "记录、原文、日程、足迹、健康都照常能用。",
                        "Notes, originals, calendar, footprints and health remain available.",
                      )}
                    </p>
                  </span>
                  <button type="button" disabled={!onToday} onClick={onToday}>
                    {t("回到今天", "Back to Today")}
                  </button>
                </div>
              </section>
            </div>
          ) : (
            settings?.configured &&
            !events.some((event) => event.type === "user/message") && (
              <div className={css.welcome}>
                <h1>{t("从你正在推进的事聊起", "Start with what you’re working on")}</h1>
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
            )
          )}
          {events.map((event) => {
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
                        <span key={i}> · {block.attachment?.name ?? t("已附文件", "Attached file")}</span>
                      ))}
                  {Array.isArray(data.content) && data.content.some((block) => block.type === "image") && (
                    <span> · {t("已附图片", "Attached image")}</span>
                  )}
                </div>
              );
            if (event.type === "assistant/message" && text(message?.content))
              return (
                <article key={event.id} className={css.assistant}>
                  <DocumentBody content={text(message?.content)} />
                </article>
              );
            if (
              event.type === "tool/call" ||
              (event.type === "approval/asked" && progress.resolutions.has(data.requestId))
            ) {
              const group = progress.groups.get(event);
              if (!group) return null;
              const { steps, results } = group;
              const calls = steps.filter((item) => item.type === "tool/call");
              const running = busy && group.last;
              const active = calls.findLast((item) => !results.has(item.data.callId));
              const name = String(active?.data.name ?? "");
              const activity = !active
                ? t("正在整理回答", "Preparing a response")
                : /search/.test(name)
                  ? t("正在搜索", "Searching")
                  : /read|list|status|overview|get|fetch/.test(name)
                    ? t("正在读取资料", "Reading files")
                    : t("正在调用工具", "Using tools");
              return (
                <details key={event.id} className={css.progress}>
                  <summary>
                    <span className={`${css.dot} ${running ? css.pulse : ""}`} />
                    {running ? activity : t("处理步骤", "Steps")}
                    <span className={css.stepCount}>
                      {t(`${steps.length} 步`, `${steps.length} ${steps.length === 1 ? "step" : "steps"}`)}
                    </span>
                  </summary>
                  {steps.map((item) =>
                    item.type === "approval/asked" ? (
                      <NativeApproval
                        key={item.id}
                        event={item}
                        resolution={progress.resolutions.get(item.data.requestId)}
                        session={selected ?? ""}
                        disabled={!settings?.configured}
                      />
                    ) : (
                      <Tool
                        key={item.id}
                        event={item}
                        session={selected ?? ""}
                        finished={!running}
                        result={results.get(item.data.callId)}
                      />
                    ),
                  )}
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
                  disabled={!settings?.configured}
                  event={event}
                  resolution={progress.resolutions.get(data.requestId)}
                />
              );
            if (event.type === "approval/asked")
              return (
                <details key={event.id} className={css.tool}>
                  <summary>
                    {t("这一步需要更高权限，已跳过", "This step needs additional permission and was skipped")}
                  </summary>
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
              {t("正在准备回答", "Preparing a response")}
            </output>
          )}
        </div>
        {error && !step && (
          <p className={css.notice} role="alert">
            {error}
          </p>
        )}
        {handoffState && (
          <output className={css.notice}>
            {handoffState === "saved"
              ? t("已保存", "Saved")
              : handoffState === "sending"
                ? t("已保存，正在发送…", "Saved, sending…")
                : handoffState === "retry"
                  ? t("已保存，未能发送", "Saved, not sent")
                  : handoffState === "failed"
                    ? t("回复未完成", "Response failed")
                    : t("发送结果未知", "Send status unknown")}
            {(handoffState === "retry" || handoffState === "uncertain" || handoffState === "failed") &&
              autoSubmit && <p>{autoSubmit.text}</p>}
            {(handoffState === "retry" || handoffState === "uncertain" || handoffState === "failed") &&
              autoSubmit && <small>{autoSubmit.capturedPath}</small>}
            {(handoffState === "uncertain" || handoffState === "failed" || handoffState === "sending") && (
              <button
                type="button"
                onClick={() =>
                  void checkHandoff()
                    .then((receipt) => {
                      if (receipt?.sessionId) handoffSelect.current(receipt.sessionId, true);
                    })
                    .catch((err) => setError(String(err)))
                }
              >
                {t("查看对话", "View conversation")}
              </button>
            )}
            {handoffState === "retry" && settings?.configured && (
              <button type="button" onClick={() => setHandoffRetry((n) => n + 1)}>
                {t("重试", "Retry")}
              </button>
            )}
            {(handoffState === "retry" || handoffState === "uncertain" || handoffState === "failed") &&
              autoSubmit && (
                <button
                  type="button"
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(autoSubmit.text)
                      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
                  }
                >
                  {t("复制", "Copy")}
                </button>
              )}
          </output>
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
              setAddMenu(false);
              closeReferences();
            }
          }}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) {
              setModelMenu(false);
              setAddMenu(false);
            }
          }}
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <textarea
            aria-label={t("给开图发消息", "Message Kaitu")}
            ref={input}
            disabled={!settings?.configured}
            rows={2}
            value={draft}
            maxLength={100000}
            placeholder={
              settings?.configured
                ? t("问问开图，或者让它帮你记一件事", "Ask Kaitu or tell it something to remember")
                : t(
                    "接上 AI 之后就能问，比如“我这周在忙什么”",
                    "Once connected, ask something like “What am I working on this week?”",
                  )
            }
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
                aria-label={t(`移除 ${file.name}`, `Remove ${file.name}`)}
              >
                ×
              </button>
            </div>
          ))}
          {sessionReferences.map((reference) => (
            <div key={reference.id} className={css.attachment}>
              <span>
                {t("引用对话", "Referenced conversation")} · {reference.title}
              </span>
              <button
                type="button"
                aria-label={t(`移除引用 ${reference.title}`, `Remove reference ${reference.title}`)}
                onClick={() =>
                  setSessionReferences((current) => current.filter((item) => item.id !== reference.id))
                }
              >
                ×
              </button>
            </div>
          ))}
          {fileReferences.map((reference) => (
            <div key={`${reference.kind}:${reference.path}`} className={css.attachment}>
              <span>{reference.path}</span>
              <button
                type="button"
                aria-label={t(`移除引用 ${reference.path}`, `Remove reference ${reference.path}`)}
                onClick={() =>
                  setFileReferences((current) =>
                    current.filter((item) => item.path !== reference.path || item.kind !== reference.kind),
                  )
                }
              >
                ×
              </button>
            </div>
          ))}
          {readingFiles && <output>{t("正在读取附件…", "Reading attachments…")}</output>}
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
                    {t("文件和文件夹", "Files and folders")}
                  </button>
                  <button
                    type="button"
                    aria-pressed={referenceKind === "sessions"}
                    onClick={() => {
                      setReferenceKind("sessions");
                      setAtQuery(undefined);
                    }}
                  >
                    {t("其他对话", "Other conversations")}
                  </button>
                </div>
              )}
              {references && referenceKind === "sessions" && atQuery === undefined ? (
                <section className={filesCss.picker} aria-label={t("引用对话", "Reference a conversation")}>
                  <header className={filesCss.header}>
                    <span>{t("其他对话", "Other conversations")}</span>
                    <button
                      type="button"
                      onClick={closeReferences}
                      aria-label={t("关闭对话选择", "Close conversation picker")}
                    >
                      ×
                    </button>
                  </header>
                  {!referenceThreads.length && (
                    <p className={filesCss.notice}>
                      {t("还没有其他可引用的对话", "No other conversations to reference yet")}
                    </p>
                  )}
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
              disabled={!settings?.configured}
              onChange={(event) => {
                void addFiles(Array.from(event.target.files ?? []));
                event.target.value = "";
              }}
            />
            <span className={css.addWrap}>
              <button
                type="button"
                className={css.add}
                aria-label={t("添加", "Add")}
                aria-haspopup="dialog"
                aria-expanded={addMenu}
                disabled={busy || readingFiles || !settings?.configured}
                onClick={() => {
                  setAddMenu(!addMenu);
                  setModelMenu(false);
                }}
              >
                ＋
              </button>
              {addMenu && (
                <dialog
                  open
                  className={`${v2["mode-pop"]} ${css.addPopover}`}
                  aria-label={t("添加内容", "Add content")}
                >
                  <button
                    type="button"
                    className={css.menuItem}
                    disabled={settings?.supportsAttachments === false}
                    onClick={() => {
                      setAddMenu(false);
                      upload.current?.click();
                    }}
                  >
                    {t("添加附件", "Add attachments")}
                  </button>
                  {settings?.choice !== "local" &&
                    (["files", "sessions"] as const).map((kind) => (
                      <button
                        type="button"
                        className={css.menuItem}
                        key={kind}
                        onClick={() => {
                          cursor.current = input.current?.selectionStart ?? draft.length;
                          setReferenceKind(kind);
                          setAtQuery(undefined);
                          setReferences(true);
                          setAddMenu(false);
                        }}
                      >
                        {kind === "files"
                          ? t("引用文件或文件夹", "Reference files or folders")
                          : t("引用其他对话", "Reference another conversation")}
                      </button>
                    ))}
                </dialog>
              )}
            </span>
            <span className={css.modelWrap}>
              <button
                type="button"
                className={css.model}
                disabled={busy || saving || !settings?.configured}
                ref={modelTrigger}
                aria-label={t("选择模型", "Choose model")}
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
                    ? `${localRuntime ? `${runtimeLabel} · ` : ""}${settings.providerName} · ${settings.model}${settings.reasoningEffort ? ` · ${settings.reasoningEffort}` : ""}`
                    : t("连接 AI", "Connect AI")}
                </span>
                <span aria-hidden="true">⌄</span>
              </button>
              {modelMenu && (
                <dialog
                  open
                  className={`${v2["mode-pop"]} ${css.modelPopover}`}
                  aria-label={t("当前 AI", "Current AI")}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      event.stopPropagation();
                      setModelMenu(false);
                      modelTrigger.current?.focus();
                      return;
                    }
                    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
                    const items = Array.from(
                      event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
                    );
                    if (!items.length) return;
                    const index = items.indexOf(document.activeElement as HTMLButtonElement);
                    const next =
                      event.key === "ArrowDown"
                        ? (index + 1) % items.length
                        : index <= 0
                          ? items.length - 1
                          : index - 1;
                    event.preventDefault();
                    items[next]?.focus();
                  }}
                >
                  <input
                    className={css.modelSearch}
                    type="search"
                    value={modelQuery}
                    onChange={(event) => setModelQuery(event.target.value)}
                    placeholder={t("搜索模型或服务商…", "Search models or providers…")}
                    // biome-ignore lint/a11y/noAutofocus: 打开模型面板后立即可键盘搜索。
                    autoFocus
                  />
                  {localRuntime && (
                    <p className={v2.small}>
                      {t(
                        "使用所选 Agent 的本机能力，操作审批由 Agent 自己处理。",
                        "Uses the selected Agent's local capabilities and its own approval flow.",
                      )}
                    </p>
                  )}
                  {settings?.choice === "local" && (
                    <section aria-label={t("权限模式", "Permission mode")}>
                      <p>{t("权限模式（下次发送生效）", "Permission mode (next message)")}</p>
                      {agentModes === null ? (
                        <span>{t("正在读取模式…", "Loading modes…")}</span>
                      ) : typeof agentModes === "string" ? (
                        <span role="alert">{agentModes}</span>
                      ) : (
                        <>
                          {agentModes.modes.map((item) => (
                            <button
                              type="button"
                              key={item.id}
                              className={css.model}
                              disabled={busy || saving}
                              aria-pressed={settings.permissionMode === item.id}
                              onClick={() => void switchModel(settings.provider, settings.model, item.id)}
                            >
                              {item.id === "auto"
                                ? t("Auto · 自动审查", "Auto · reviewed actions")
                                : item.name}
                            </button>
                          ))}
                        </>
                      )}
                    </section>
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
                        {agentModels
                          .filter((item) =>
                            `${settings.providerName} ${item.id} ${item.name ?? ""}`
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
                  {catalogStatus !== null && (
                    <p role={catalogStatus ? "alert" : "status"}>
                      {catalogStatus || t("正在读取模型…", "Loading models…")}
                      {catalogStatus && (
                        <button type="button" onClick={loadSavedModels}>
                          {t("重试读取", "Retry loading")}
                        </button>
                      )}
                    </p>
                  )}
                  {settings?.choice !== "local" &&
                  settings?.modelCapabilities?.find((model) => model.id === settings.model)?.reasoning
                    ?.efforts?.length ? (
                    <section aria-label={t("推理强度", "Reasoning effort")}>
                      <p>{t("推理强度（下次发送生效）", "Reasoning effort (next message)")}</p>
                      {settings.modelCapabilities.find((model) => model.id === settings.model)?.reasoning
                        ?.defaultEffort && (
                        <button
                          type="button"
                          className={css.model}
                          disabled={saving || busy}
                          aria-pressed={
                            !settings.reasoningEffort ||
                            settings.reasoningEffort ===
                              settings.modelCapabilities.find((model) => model.id === settings.model)
                                ?.reasoning?.defaultEffort
                          }
                          onClick={() => void switchModel(settings.provider, settings.model, undefined, null)}
                        >
                          {t("默认", "Default")}
                        </button>
                      )}
                      {settings.modelCapabilities
                        .find((model) => model.id === settings.model)
                        ?.reasoning?.efforts.filter(
                          (effort) =>
                            effort.id !==
                            settings.modelCapabilities?.find((model) => model.id === settings.model)
                              ?.reasoning?.defaultEffort,
                        )
                        .map((effort) => (
                          <button
                            type="button"
                            key={effort.id}
                            className={css.model}
                            disabled={saving || busy}
                            aria-pressed={settings.reasoningEffort === effort.id}
                            onClick={() =>
                              void switchModel(settings.provider, settings.model, undefined, effort.id)
                            }
                          >
                            {effort.name ?? effort.id}
                          </button>
                        ))}
                    </section>
                  ) : null}
                  {settings?.saved?.map((row) => {
                    const models = row.models.filter((id) =>
                      `${row.name} ${id}`.toLowerCase().includes(modelQuery.trim().toLowerCase()),
                    );
                    return models.length ? (
                      <section className={css.modelGroup} key={row.provider}>
                        <p>{row.name}</p>
                        {models.map((id) => (
                          <button
                            type="button"
                            key={id}
                            className={css.menuItem}
                            aria-pressed={
                              settings.configured &&
                              settings.choice !== "local" &&
                              settings.provider === row.provider &&
                              settings.model === id
                            }
                            disabled={busy || saving}
                            onClick={() =>
                              void switchModel(row.provider, id, undefined, undefined, true, row.auth)
                            }
                          >
                            {id}
                          </button>
                        ))}
                      </section>
                    ) : null;
                  })}
                  {settings?.localAgents
                    ?.filter((agent) => agent.id !== settings.localAgent?.id)
                    .map((agent) => {
                      const models = (otherAgentModels[agent.id] ?? []).filter((model) =>
                        `${agent.name} ${model.id} ${model.name ?? ""}`
                          .toLowerCase()
                          .includes(modelQuery.trim().toLowerCase()),
                      );
                      return models.length ? (
                        <section className={css.modelGroup} key={agent.id}>
                          <p>{agent.name}</p>
                          {models.map((model) => (
                            <button
                              type="button"
                              className={css.menuItem}
                              key={model.id}
                              disabled={busy || saving}
                              onClick={() => void switchToAgent(agent, model.id)}
                            >
                              {model.name ?? model.id}
                            </button>
                          ))}
                        </section>
                      ) : null;
                    })}
                  <button
                    type="button"
                    className={css.model}
                    onClick={() => {
                      setModelMenu(false);
                      setConnectionLocalOnly(false);
                      setStep(1);
                    }}
                  >
                    {settings?.choice === "local"
                      ? t("换一个 AI", "Switch AI")
                      : t("添加服务商", "Add provider")}
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
                aria-label={t("发送", "Send")}
                disabled={
                  readingFiles ||
                  (!draft.trim() &&
                    !attachments.length &&
                    !sessionReferences.length &&
                    !fileReferences.length) ||
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
            ? localRuntime
              ? t("本机 Agent 按已批准的权限操作", "Local Agent uses the permissions you approve")
              : t(
                  "只读写允许的开图资料，不运行命令",
                  "Reads and writes allowed Kaitu data; cannot run commands",
                )
            : t("接上 AI 后才能发送", "Connect an AI before sending")}
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
      >
        <p className={css.step}>{t(`第 ${step} 步，共 2 步`, `Step ${step} of 2`)}</p>
        {step === 1 ? (
          <>
            <h2 id="ask-connect-title">{t("连接 AI", "Connect AI")}</h2>
            <AiSettings
              focusKey={connectionFocus}
              localOnly={connectionLocalOnly}
              onSaving={setSaving}
              onSaved={async () => {
                modelRequestSeq.current++;
                const ai = await call<Settings>("askSettings");
                setSettings(ai);
                if (ai.supportsImages === false) setAttachments([]);
                setSessionReferences([]);
                setFileReferences([]);
                setStep(ai.choice !== "local" && !asked ? 2 : 0);
              }}
            />
            <button type="button" disabled={saving} onClick={() => setStep(0)}>
              {t("以后再说", "Later")}
            </button>
          </>
        ) : (
          <>
            <h2 id="ask-connect-title">{t("每天自动整理", "Daily automation")}</h2>
            {(
              [
                ["morning", t("每天早上 7:30 排好今天", "Plan today at 7:30 every morning")],
                ["organizer", t("每晚 3:00 整理一遍", "Organize at 3:00 every night")],
                ["news", t("每天早上 8:00 搜索资讯", "Find news at 8:00 every morning")],
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
                {t("都不要", "Skip all")}
              </button>
              <button type="button" disabled={saving} onClick={() => void finish()}>
                {saving ? t("保存中…", "Saving…") : t("开始用", "Start")}
              </button>
            </div>
          </>
        )}
      </dialog>
    </div>
  );
}
