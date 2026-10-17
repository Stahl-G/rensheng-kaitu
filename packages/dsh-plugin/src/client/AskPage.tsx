import { activeAtToken, formatFileMention } from "@deepseek-ai/dsh-file-reference/grammar";
import { Fragment, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { OverviewData } from "../types.js";
import css from "./AskPage.module.css";
import { DshAuthorization } from "./DshAuthorization.js";
import { FilePicker } from "./DshFiles.js";
import filesCss from "./DshFiles.module.css";
import v2 from "./Prototype.module.css";
import { aiHandover } from "./connections.js";

type AskMode = "scoped" | "full";
interface Thread {
  mode?: AskMode;
  id: string;
  title: string;
  created: string;
  updated: string;
  workspace?: string;
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
  choice?: "builtin" | "external";
  model: string;
  provider: string;
  providerName: string;
  auth?: "dsh" | "key";
  baseURL?: string;
  api?: string;
  protocols: { id: string; name: string }[];
  supportsImages: boolean;
  providers: Provider[];
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
  if (!response.ok) throw new Error(value.error ?? "操作未完成，请重试");
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
function Body({ content }: { content: string }) {
  // Render text as React nodes; model output never enters HTML.
  return (
    <>
      {content.split(/\n\n+/).map((part, index) => {
        const lines = part.split("\n");
        if (lines.every((line) => /^[-*] /.test(line)))
          return (
            <ul key={`${index}:${part}`}>
              {lines.map((line, i) => (
                <li key={`${i}:${line}`}>{line.slice(2)}</li>
              ))}
            </ul>
          );
        if (/^#{1,3} /.test(part)) return <h3 key={`${index}:${part}`}>{part.replace(/^#{1,3} /, "")}</h3>;
        return (
          <p key={`${index}:${part}`}>
            {part
              .split(/(\*\*[^*]+\*\*)/g)
              .map((piece, i) =>
                piece.startsWith("**") ? <strong key={`${i}:${piece}`}>{piece.slice(2, -2)}</strong> : piece,
              )}
          </p>
        );
      })}
    </>
  );
}
function Tool({ event, result, finished }: { event: ChatEvent; result?: ChatEvent; finished: boolean }) {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(String(event.data.arguments ?? "{}"));
  } catch {
    /* Raw arguments remain in details. */
  }
  const message = result?.data.message as { content?: unknown; isError?: boolean } | undefined;
  const name = String(event.data.name);
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

export function AskPage({
  workspace,
  initialPrompt = "",
  configureRequest = 0,
  configureBuiltin = false,
  onConnections,
}: {
  workspace: string;
  initialPrompt?: string;
  configureRequest?: number;
  configureBuiltin?: boolean;
  onConnections?: () => void;
}) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [events, setEvents] = useState<ChatEvent[]>([]);
  const [draft, setDraft] = useState(initialPrompt);
  useEffect(() => {
    if (initialPrompt) setDraft(initialPrompt);
  }, [initialPrompt]);
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
  const [modeMenu, setModeMenu] = useState<"select" | "confirm" | null>(null);
  const [modeSaving, setModeSaving] = useState(false);
  const selectThread = (id: string | null) => {
    setSelected(id);
    setModeMenu(null);
    setModelMenu(false);
  };
  const mode = threads.find((thread) => thread.id === selected)?.mode ?? "scoped";

  const [choice, setChoice] = useState<"builtin" | "external">("external");
  const [key, setKey] = useState("");
  const [provider, setProvider] = useState("deepseek-official");
  const [model, setModel] = useState("");
  const [availableModels, setAvailableModels] = useState<{ id: string; name?: string; image?: boolean }[]>(
    [],
  );
  const [loadingModels, setLoadingModels] = useState(false);
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
  const groups = new Map<string, Thread[]>();
  for (const thread of threads) {
    const label = day(thread.updated);
    groups.set(label, [...(groups.get(label) ?? []), thread]);
  }
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
  const refreshThreads = useCallback(() => call<Thread[]>("askList").then(setThreads), []);
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
        setBaseURL(ai.baseURL ?? "");
        setApi(ai.api ?? "openai-completions");
        if (!configurationRequested.current) setChoice(ai.choice ?? "external");
        setAsked(auto.asked);
        if (auto.asked) setAutomation(auto.tasks);
        setThreads(list);
        setLoaded(true);
        if (!configurationRequested.current) {
          if (!ai.choice && !ai.configured) setStep(1);
          else if (ai.configured && !auto.asked) setStep(2);
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
    if (step) dialog.current?.showModal();
    else dialog.current?.close();
  }, [step]);
  useEffect(() => {
    activeSession.current = selected;
    setEvents([]);
    nearBottom.current = true;
    if (!selected) return;
    const stream = new EventSource(`/api/ask/events?session=${encodeURIComponent(selected)}`);
    stream.onmessage = (message) => {
      const event = JSON.parse(message.data) as ChatEvent;
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
    setError("");
    setSending(true);
    try {
      let id = selected;
      if (!id) {
        const thread = await call<Thread>("askCreate");
        id = thread.id;
        activeSession.current = id;
        selectThread(id);
        await refreshThreads();
      }
      await call(
        "askSend",
        id,
        [value, ...sessionReferences.map((reference) => reference.mention)].join("\n"),
        attachments,
      );
      if (activeSession.current === id) {
        setDraft("");
        setAttachments([]);
        setSessionReferences([]);
      }
    } catch (err) {
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
  const changeMode = async (value: AskMode) => {
    if (busy || modeSaving) return;
    setModeSaving(true);
    setError("");
    try {
      let id = selected;
      if (!id) {
        const thread = await call<Thread>("askCreate");
        id = thread.id;
        selectThread(id);
      }
      await call("askSetMode", id, value, value === "full");
      await refreshThreads();
      setModeMenu(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setModeSaving(false);
    }
  };
  const loadModels = async () => {
    setLoadingModels(true);
    setModelNotice("");
    try {
      const models = await call<typeof availableModels>("askModels", {
        provider,
        auth,
        ...(custom ? { baseURL, api } : {}),
        ...(key ? { apiKey: key } : {}),
      });
      setAvailableModels(models);
      setModelNotice(models.length ? `${models.length} 个模型` : "服务没有返回模型");
    } catch (err) {
      setAvailableModels([]);
      setModelNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingModels(false);
    }
  };
  const next = async () => {
    setSaving(true);
    setError("");
    try {
      const ai = await call<Settings>("askConfigure", {
        choice,
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
  const handover = aiHandover(workspace, draft);
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
            {rows.map((thread) => (
              <button
                type="button"
                key={thread.id}
                aria-current={thread.id === selected ? "true" : undefined}
                onClick={() => {
                  selectThread(thread.id);
                  setError("");
                }}
              >
                {thread.title}
              </button>
            ))}
          </Fragment>
        ))}
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
                  <Body content={text(message?.content)} />
                </article>
              );
            if (event.type === "tool/call") {
              const start = events.slice(0, index).findLastIndex((item) => item.type === "user/message");
              if (events.slice(start + 1, index).some((item) => item.type === "tool/call")) return null;
              const next = events.findIndex((item, i) => i > index && item.type === "user/message");
              const turn = events.slice(start + 1, next < 0 ? undefined : next);
              const calls = turn.filter((item) => item.type === "tool/call");
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
          {waiting && (
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
            <span>
              {settings?.choice === "external"
                ? "你选择了已有 AI；需要内置 AI 才能在这里聊。"
                : "连接内置 AI，就能在这里聊。"}
            </span>
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
              setModeMenu(null);
              setModelMenu(false);
              closeReferences();
            }
          }}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) {
              setModeMenu(null);
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
              disabled={busy || readingFiles}
              onClick={() => upload.current?.click()}
            >
              ＋
            </button>
            <button
              type="button"
              className={css.model}
              disabled={busy}
              onClick={() => {
                cursor.current = input.current?.selectionStart ?? draft.length;
                setAtQuery(undefined);
                setReferences(!references);
                setModeMenu(null);
                setModelMenu(false);
              }}
            >
              引用资料
            </button>
            <span className={v2["mode-wrap"]}>
              <button
                type="button"
                className={`${css.model} ${mode === "full" ? v2["is-full"] : ""}`}
                disabled={busy || modeSaving}
                aria-haspopup="dialog"
                aria-expanded={modeMenu !== null}
                onClick={() => {
                  setModelMenu(false);
                  setModeMenu(modeMenu ? null : "select");
                }}
              >
                {mode === "full" ? "完整 Agent" : "开图资料"}
                <span aria-hidden="true">⌄</span>
              </button>
              {modeMenu && (
                <dialog
                  open
                  className={v2["mode-pop"]}
                  aria-label={modeMenu === "confirm" ? "开启完整 Agent" : "这个对话能做什么"}
                >
                  {modeMenu === "confirm" ? (
                    <>
                      <b>给这个对话开启完整 Agent？</b>
                      <div className={v2["dialog-foot"]}>
                        <button
                          type="button"
                          className={`${v2.btn} ${v2["btn-quiet"]}`}
                          disabled={modeSaving}
                          onClick={() => setModeMenu(null)}
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          className={`${v2.btn} ${v2["btn-strong"]}`}
                          disabled={modeSaving}
                          onClick={() => void changeMode("full")}
                        >
                          开启
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className={v2["mode-opt"]}
                        aria-pressed={mode === "scoped"}
                        onClick={() => void changeMode("scoped")}
                      >
                        <b>只读写开图资料</b>
                        <span>只读写开图资料，可以搜索和打开网页；不能运行命令</span>
                      </button>
                      <button
                        type="button"
                        className={v2["mode-opt"]}
                        aria-pressed={mode === "full"}
                        onClick={() => (mode === "full" ? setModeMenu(null) : setModeMenu("confirm"))}
                      >
                        <b>完整 Agent</b>
                        <span>
                          开图背后就是完整的 DSH：能运行命令、读写电脑上的文件、上网，适合让它帮你干活。
                        </span>
                      </button>
                    </>
                  )}
                </dialog>
              )}
            </span>
            <span className={css.modelWrap}>
              <button
                type="button"
                className={css.model}
                disabled={busy}
                aria-haspopup="dialog"
                aria-expanded={modelMenu}
                onClick={() => {
                  setModeMenu(null);
                  setModelMenu(!modelMenu);
                }}
              >
                <span className={css.modelName}>
                  {settings?.configured ? `${settings.providerName} · ${settings.model}` : "连接 AI"}
                </span>
                <span aria-hidden="true">⌄</span>
              </button>
              {modelMenu && (
                <dialog open className={`${v2["mode-pop"]} ${css.modelPopover}`} aria-label="当前 AI">
                  <b>{settings?.configured ? settings.providerName : "连接内置 AI"}</b>
                  <p className={v2.small}>{settings?.configured ? settings.model : ""}</p>
                  <button
                    type="button"
                    className={css.model}
                    onClick={() => {
                      setModelMenu(false);
                      if (settings?.configured && onConnections) onConnections();
                      else setStep(1);
                    }}
                  >
                    AI 与连接
                  </button>
                </dialog>
              )}
            </span>
            <button
              type="submit"
              className={css.send}
              aria-label="发送"
              disabled={
                busy ||
                readingFiles ||
                (!draft.trim() && !attachments.length && !sessionReferences.length) ||
                !settings?.configured
              }
            >
              ↑
            </button>
          </div>
        </form>
        <p className={css.scope}>
          {settings?.configured
            ? `${settings.providerName} · ${mode === "full" ? "完整 Agent" : "开图资料"}`
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
              aria-pressed={choice === "external"}
              disabled={saving}
              onClick={() => setChoice("external")}
            >
              <b>用你已经在用的 AI</b>
              <span>复制资料包给豆包、Kimi、ChatGPT 等任意 AI，再把回答贴回来，不用 API Key</span>
            </button>
            <button
              type="button"
              className={css.choice}
              aria-pressed={choice === "builtin"}
              disabled={saving}
              onClick={() => setChoice("builtin")}
            >
              <b>用开图里的 AI</b>
              <span>用 API Key 连接，或使用服务商提供的账号登录。</span>
            </button>
            {choice === "builtin" ? (
              <fieldset className={css.fields} disabled={saving || loadingModels}>
                <label className={css.key}>
                  AI 服务
                  <select
                    value={provider}
                    onChange={(event) => {
                      const id = event.target.value;
                      setProvider(id);
                      setAuth(settings?.provider === id ? (settings.auth ?? "key") : "key");
                      setModel(settings?.provider === id ? settings.model : "");
                      setAvailableModels([]);
                      setModelNotice("");
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
                    <select value={api} onChange={(event) => setApi(event.target.value)}>
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
                      onChange={(event) => setBaseURL(event.target.value)}
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
                        setKey(event.target.value);
                        setAuth("key");
                      }}
                      onBlur={() => {
                        if (key.trim()) void loadModels();
                      }}
                    />
                  </label>
                )}
                <label className={css.key} htmlFor="ask-model">
                  模型
                  <input
                    id="ask-model"
                    list="ask-model-options"
                    value={model}
                    placeholder="从接口获取后选择，或填写模型 ID"
                    onChange={(event) => setModel(event.target.value)}
                  />
                  <datalist id="ask-model-options">
                    {availableModels.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </datalist>
                </label>
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
            ) : (
              <div className={css.external}>
                {onConnections && (
                  <button type="button" onClick={onConnections}>
                    去复制资料包
                  </button>
                )}
                <details>
                  <summary>进阶：本机支持 MCP 的客户端（Claude Desktop、Claude Code、Codex）</summary>
                  <textarea aria-label="AI 接手说明" readOnly rows={4} value={handover} />
                  <button
                    type="button"
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(handover)
                        .catch(() => setError("请选中并复制接手说明"))
                    }
                  >
                    复制连接说明
                  </button>
                </details>
              </div>
            )}
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
                {saving ? "连接中…" : choice === "external" ? "使用已有 AI" : "下一步"}
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
