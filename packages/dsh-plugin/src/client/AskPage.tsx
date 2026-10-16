import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import css from "./AskPage.module.css";
import v2 from "./Prototype.module.css";
import { aiHandover } from "./connections.js";

type AskMode = "scoped" | "full";
interface Thread {
  mode?: AskMode;
  id: string;
  title: string;
  created: string;
  updated: string;
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
  models: { id: string; image: boolean }[];
}
interface ImageInput {
  data: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  name: string;
}
interface Settings {
  configured: boolean;
  choice?: "builtin" | "external";
  model: string;
  provider: string;
  providerName: string;
  baseURL?: string;
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
  const [modeMenu, setModeMenu] = useState<"select" | "confirm" | null>(null);
  const [modeSaving, setModeSaving] = useState(false);
  const selectThread = (id: string | null) => {
    setSelected(id);
    setModeMenu(null);
  };
  const mode = threads.find((thread) => thread.id === selected)?.mode ?? "scoped";

  const [choice, setChoice] = useState<"builtin" | "external">("external");
  const [key, setKey] = useState("");
  const [provider, setProvider] = useState("deepseek-official");
  const [model, setModel] = useState("deepseek-flash");
  const [baseURL, setBaseURL] = useState("");
  const [image, setImage] = useState<ImageInput | null>(null);
  const upload = useRef<HTMLInputElement>(null);
  const selectedProvider = settings?.providers.find((item) => item.id === provider);
  const custom = provider === "kaitu-custom";
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
  const groups = new Map<string, Thread[]>();
  for (const thread of threads) {
    const label = day(thread.updated);
    groups.set(label, [...(groups.get(label) ?? []), thread]);
  }
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
        setProvider(ai.provider);
        setModel(ai.model);
        setBaseURL(ai.baseURL ?? "");
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
    const value = draft.trim() || (image ? "请看看这张图片" : "");
    if (!value || busy || !settings?.configured) return;
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
      await call("askSend", id, value, image ? [{ data: image.data, mimeType: image.mimeType }] : []);
      if (activeSession.current === id) {
        setDraft("");
        setImage(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
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
              ...(custom ? { baseURL } : {}),
              ...(key ? { apiKey: key } : {}),
            }
          : {}),
      });
      setKey("");
      setSettings(ai);
      if (!ai.supportsImages) setImage(null);
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
  const waiting = busy && !events.slice(lastUser + 1).some((event) => event.type === "assistant/message");
  return (
    <div className={css.chat}>
      <nav className={css.threads} aria-label="对话">
        <button
          type="button"
          className={css.newThread}
          onClick={() => {
            selectThread(null);
            setDraft("");
            setImage(null);
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
              setImage(null);
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
              <h1>想问开图什么？</h1>
              <p>它会先读你的开图资料再回答。</p>
              <div className={css.suggestions}>
                {["这周我练得够吗？", "帮我排一下明天", "最近钱都花在哪了", "我上次去东京是什么时候"].map(
                  (question) => (
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
                  ),
                )}
              </div>
            </div>
          )}
          {events.map((event) => {
            const data = event.data;
            const message = data.message as { content?: unknown } | undefined;
            if (event.type === "user/message")
              return (
                <div key={event.id} className={css.user}>
                  {text(data.content)}
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
            if (event.type === "tool/call")
              return (
                <Tool
                  key={event.id}
                  event={event}
                  finished={!busy}
                  result={events.find(
                    (item) =>
                      item.type === "tool/result" &&
                      (item.data.message as { toolCallId?: string })?.toolCallId === data.callId,
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
          {waiting && <output className={css.thinking}>正在看你的资料…</output>}
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
        {settings?.configured && !settings.supportsImages && (
          <p id="ask-image-hint" className={css.scope}>
            {settings.provider === "kaitu-custom"
              ? "自定义模型尚未确认图片能力，当前仅支持文字。"
              : "当前模型仅支持文字，可在 AI 与连接中切换图片模型。"}
          </p>
        )}
        <form
          className={css.composer}
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
              event.target.style.height = "auto";
              event.target.style.height = `${Math.min(event.target.scrollHeight, 200)}px`;
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
          {image && (
            <div className={css.attachment}>
              <img src={`data:${image.mimeType};base64,${image.data}`} alt={image.name} />
              <span>{image.name}</span>
              <button type="button" onClick={() => setImage(null)} aria-label="移除图片">
                ×
              </button>
            </div>
          )}
          <div className={css.composerRow}>
            <input
              ref={upload}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                if (
                  file.size > 2 * 1024 * 1024 ||
                  !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)
                ) {
                  setError("请选择一张不超过 2MB 的 JPG、PNG、WebP 或 GIF 图片");
                  return;
                }
                const reader = new FileReader();
                reader.onload = () =>
                  setImage({
                    data: String(reader.result).split(",")[1] ?? "",
                    mimeType: file.type as ImageInput["mimeType"],
                    name: file.name,
                  });
                reader.onerror = () => setError("图片读取失败，请重新选择");
                reader.readAsDataURL(file);
              }}
            />
            <span
              title={
                !settings?.configured
                  ? "请先连接 AI"
                  : !settings.supportsImages
                    ? "当前模型不支持图片，请在 AI 与连接中切换模型"
                    : "上传一张图片（最多 2MB）"
              }
            >
              <button
                type="button"
                className={css.model}
                aria-label="上传图片"
                aria-describedby={
                  settings?.configured && !settings.supportsImages ? "ask-image-hint" : undefined
                }
                disabled={busy || !settings?.configured || !settings.supportsImages}
                onClick={() => upload.current?.click()}
              >
                ＋ 图片
              </button>
            </span>
            <span className={v2["mode-wrap"]}>
              <button
                type="button"
                className={`${v2["c-btn"]} ${mode === "full" ? v2["is-full"] : ""}`}
                disabled={busy || modeSaving}
                aria-haspopup="dialog"
                aria-expanded={modeMenu !== null}
                onClick={() => setModeMenu(modeMenu ? null : "select")}
              >
                {mode === "full" ? "完整 Agent" : "只读写开图资料"}
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
                      <p className={v2.small}>
                        它可以运行命令、读写这台电脑上的任何文件、上网。资讯、邮件或网页里的内容可能诱导它做你不想做的事，只在你信任这次任务时开启。
                      </p>
                      <p className={v2.small}>只对这个对话生效，新对话仍是只读写开图资料。</p>
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
                        <span>默认。只能读写你的开图资料，不能运行命令、不能上网。</span>
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
            <button
              type="button"
              className={css.model}
              disabled={busy}
              title="在设置 → AI 与连接中切换，下一条消息生效"
              onClick={() => (settings?.configured && onConnections ? onConnections() : setStep(1))}
            >
              {settings?.configured ? `${settings.providerName} · ${settings.model}` : "连接 AI"}
            </button>
            <button
              type="submit"
              className={css.send}
              aria-label="发送"
              disabled={busy || (!draft.trim() && !image) || !settings?.configured}
            >
              ↑
            </button>
          </div>
        </form>
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
            <h2 id="ask-connect-title">问问开图，需要先连接一个 AI</h2>
            <p>连接之后，开图可以帮你整理记录、排日程、回答关于你自己的问题。</p>
            <button
              type="button"
              className={css.choice}
              aria-pressed={choice === "external"}
              disabled={saving}
              onClick={() => setChoice("external")}
            >
              <b>用你已经在用的 AI</b>
              <span>把开图接到 Claude / ChatGPT / Grok</span>
            </button>
            <button
              type="button"
              className={css.choice}
              aria-pressed={choice === "builtin"}
              disabled={saving}
              onClick={() => setChoice("builtin")}
            >
              <b>用开图里的 AI</b>
              <span>填一个 AI 服务的 API Key（DeepSeek、OpenAI、Claude、Gemini、Kimi、智谱等都可以）</span>
            </button>
            {choice === "builtin" ? (
              <fieldset className={css.fields} disabled={saving}>
                <label className={css.key}>
                  AI 服务
                  <select
                    value={provider}
                    onChange={(event) => {
                      const id = event.target.value;
                      const next = settings?.providers.find((item) => item.id === id);
                      setProvider(id);
                      setModel(next?.models[0]?.id ?? "");
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
                    Base URL
                    <input
                      type="url"
                      value={baseURL}
                      placeholder="https://api.example.com/v1"
                      onChange={(event) => setBaseURL(event.target.value)}
                    />
                  </label>
                )}
                <label className={css.key} htmlFor="ask-model">
                  {custom ? "模型 ID" : "模型"}
                  {custom ? (
                    <input
                      id="ask-model"
                      value={model}
                      placeholder="服务提供的模型 ID"
                      onChange={(event) => setModel(event.target.value)}
                    />
                  ) : (
                    <select id="ask-model" value={model} onChange={(event) => setModel(event.target.value)}>
                      {selectedProvider?.models.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.id}
                          {item.image ? " · 支持图片" : " · 仅文字"}
                        </option>
                      ))}
                    </select>
                  )}
                </label>
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
                    onChange={(event) => setKey(event.target.value)}
                  />
                </label>
                {selectedProvider?.keyUrl ? (
                  <a href={selectedProvider.keyUrl} target="_blank" rel="noreferrer">
                    去 {selectedProvider.name} 官方申请 API Key ↗
                  </a>
                ) : (
                  <p>
                    请从你的 OpenAI 兼容服务获取 Base URL、模型 ID 和 API Key。自定义模型当前按仅文字连接。
                  </p>
                )}
                <p>下一步会发送一次最小请求验证连接。切换后下一条消息生效。</p>
              </fieldset>
            ) : (
              <div className={css.external}>
                <p>
                  在能访问此文件夹的 Claude、ChatGPT 或 Grok 中，复制下面的接手说明。云端 AI 可通过已有的
                  Drive 或 MCP 连接读取资料。
                </p>
                <textarea aria-label="AI 接手说明" readOnly rows={4} value={handover} />
                <button
                  type="button"
                  onClick={() =>
                    void navigator.clipboard.writeText(handover).catch(() => setError("请选中并复制接手说明"))
                  }
                >
                  复制连接说明
                </button>
              </div>
            )}
            {error && <p role="alert">{error}</p>}
            <div className={css.actions}>
              <button type="button" disabled={saving} onClick={() => setStep(0)}>
                以后再说
              </button>
              <button type="button" disabled={saving} onClick={() => void next()}>
                {saving ? "连接中…" : choice === "external" ? "使用已有 AI" : "下一步"}
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 id="ask-connect-title">要开图每天自动帮你整理吗？</h2>
            <p>会用你刚连接的 AI 来跑，不开也能手动问。</p>
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
            <p>以后可在开图菜单 → 设置中随时调整。</p>
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
