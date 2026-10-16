import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { CalendarData, LibraryData, MeData, OverviewData } from "../types.js";
import { Agenda, CalendarPage, type CalendarPageProps } from "./CalendarPage.js";
import { DirectionsPage, type DirectionsPageProps } from "./DirectionsPage.js";
import type { DoingPageProps } from "./DoingPage.js";
import { FinancePage, type FinancePageProps } from "./FinancePage.js";
import type { HealthPageProps } from "./HealthPage.js";
import { InboxPage, LibraryPage, type LibraryProps, NotesPage } from "./LibraryPage.js";
import { HealthLibrary, ProjectsLibrary } from "./LibrarySummaries.js";
import { MapPage, type MapPageProps } from "./MapPage.js";
import type { MePageProps } from "./MePage.js";
import { NewsPage, type NewsPageProps } from "./NewsPage.js";
import { PersonalPages, type PersonalServices } from "./PersonalPages.js";
import css from "./Prototype.module.css";
import { DataSummaries, TodayFinance } from "./TodayPage.js";

export interface OverviewPageProps
  extends MePageProps,
    PersonalServices,
    Omit<NewsPageProps, "onPrompt">,
    Omit<DoingPageProps, "onPrompt">,
    Omit<DirectionsPageProps, "onPrompt" | "goals">,
    Omit<MapPageProps, "onPrompt">,
    Omit<HealthPageProps, "onPrompt">,
    Omit<FinancePageProps, "onPrompt" | "today" | "timeZone">,
    CalendarPageProps,
    LibraryProps {
  load: () => Promise<OverviewData>;
  subscribe?: (refresh: () => void) => () => void;
  capture: (text: string) => Promise<unknown>;
  completeNext: (file: string, id: string) => Promise<unknown>;
  onAgent: () => void;
  onAdvanced?: () => void;
  renderAsk?: (prompt: string, configureRequest: number) => ReactNode;
}
type View = "overview" | "explore" | "records" | "ask" | "profile" | "connections" | "settings";
const modules = [
  ["calendar", "日程"],
  ["projects", "在做的事"],
  ["health", "健康"],
  ["finance", "财务"],
  ["notes", "笔记与决策"],
  ["inbox", "收件箱"],
];
export function OverviewPage(props: OverviewPageProps) {
  const [view, setView] = useState<View>("overview");
  const [record, setRecord] = useState("");
  const [explore, setExplore] = useState("directions");
  const [data, setData] = useState<OverviewData | null>(null);
  const [calendar, setCalendar] = useState<CalendarData | null>(null);
  const [library, setLibrary] = useState<LibraryData | null>(null);
  const [personal, setPersonal] = useState<MeData | null>(null);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [promptDraft, setPromptDraft] = useState("");
  const [receipt, setReceipt] = useState("");
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const [askVisited, setAskVisited] = useState(false);
  const [configureRequest, setConfigureRequest] = useState(0);
  const [theme, setTheme] = useState("light");
  const account = useRef<HTMLDivElement>(null);
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const seq = ++sequence.current;
    try {
      const [overview, agenda, files, me] = await Promise.all([
        props.load(),
        props.loadCalendar(),
        props.loadLibrary(),
        props.loadMe(),
      ]);
      if (seq !== sequence.current) return;
      setData(overview);
      setCalendar(agenda);
      setLibrary(files);
      setPersonal(me);
      setError("");
    } catch (err) {
      if (seq === sequence.current) setError(err instanceof Error ? err.message : String(err));
    }
  }, [props.load, props.loadCalendar, props.loadLibrary, props.loadMe]);
  useEffect(() => {
    void refresh();
    return () => {
      sequence.current++;
    };
  }, [refresh]);
  useEffect(() => props.subscribe?.(() => void refresh()), [props.subscribe, refresh]);
  useEffect(() => {
    if (view === "ask") setAskVisited(true);
  }, [view]);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () =>
      setTheme(document.body.hasAttribute("data-ds-dark-theme") || media.matches ? "dark" : "light");
    update();
    media.addEventListener("change", update);
    const observer = new MutationObserver(update);
    observer.observe(document.body, { attributes: true, attributeFilter: ["data-ds-dark-theme"] });
    return () => {
      media.removeEventListener("change", update);
      observer.disconnect();
    };
  }, []);
  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && !account.current?.contains(event.target)) setMenu(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menu]);
  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await operation();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  const openRecord = (id: string) => {
    setRecord(modules.some(([key]) => key === id) ? id : "");
    setView("records");
  };
  const prompt = (text: string) => {
    setPromptDraft(text);
    if (props.renderAsk) setView("ask");
    else props.onPrompt(text);
  };
  const openSection = (id: string) => {
    if (id === "me") setView("profile");
    else if (id === "explore" || id === "feed") {
      setExplore(id === "feed" ? "news" : "directions");
      setView("explore");
    } else openRecord(["learning", "decisions"].includes(id) ? "notes" : id);
  };
  const child = {
    ...props,
    onPrompt: prompt,
    setAvatar: async (base64: string) => {
      const avatar = await props.setAvatar(base64);
      setPersonal((me) => (me ? { ...me, avatar } : me));
      return avatar;
    },
    removeAvatar: async () => {
      await props.removeAvatar();
      setPersonal((me) => (me ? { ...me, avatar: null } : me));
    },
  };
  const stamp = (value: string) =>
    new Intl.DateTimeFormat("zh-CN", {
      timeZone: data?.timeZone,
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(value));
  const capture = (
    <div className={css.sec}>
      <form
        className={css.capture}
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await props.capture(draft);
            setDraft("");
            setReceipt("已收到");
          });
        }}
      >
        <label className={css.sr} htmlFor="capture-text">
          随手记一句
        </label>
        <input
          id="capture-text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={100000}
          placeholder="随手记一句，比如「今晚跑了 5 公里，有点累」"
          disabled={busy}
        />
        <button type="submit" className={`${css.btn} ${css["btn-strong"]}`} disabled={busy || !draft.trim()}>
          记下
        </button>
      </form>
      {receipt && (
        <output className={css.saved}>
          {receipt}
          <button type="button" className={css.link} onClick={() => openRecord("inbox")}>
            去收件箱看
          </button>
        </output>
      )}
    </div>
  );
  const focus = data?.next[0];
  return (
    <div className={css.app} data-theme={theme}>
      <header className={css.top}>
        <div className={css.brand}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M12 3.2 19.6 7.6v8.8L12 20.8 4.4 16.4V7.6z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
            <path
              d="M4.9 7.9 10.3 11M19.1 7.9 13.7 11M12 13.9v6.4"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
            <circle cx="12" cy="12" r="2.1" fill="var(--explore)" />
          </svg>
          人生开图
        </div>
        <nav className={css.tabs} aria-label="主要导航">
          {[
            ...[
              ["overview", "今天"],
              ["explore", "开图"],
              ["records", "资料"],
            ],
            ...(props.renderAsk ? [["ask", "问问"]] : []),
          ].map(([id, label]) => (
            <button
              type="button"
              key={id}
              aria-current={view === id ? "page" : undefined}
              onClick={() => {
                setView(id as View);
                setRecord("");
                setMenu(false);
              }}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className={css.tools}>
          <button type="button" className={`${css.link} ${css.sync}`} onClick={() => void refresh()}>
            <i className={css.dot} style={{ background: error ? "var(--news)" : "var(--health)" }} />
            {error
              ? "读取失败"
              : !data
                ? "正在读取…"
                : data.sync.needsReview
                  ? `${data.sync.needsReview} 条要核对`
                  : data.sync.received
                    ? "已收到，等待整理"
                    : data.sync.updatedAt
                      ? `已更新 ${stamp(data.sync.updatedAt)}`
                      : "本机资料"}
          </button>
          <div className={css.account} ref={account}>
            <button
              type="button"
              className={css.avatar}
              aria-label="个人档案、AI 与连接、设置"
              aria-haspopup="menu"
              aria-expanded={menu}
              onClick={() => setMenu(!menu)}
            >
              {personal?.avatar ? (
                <img src={personal.avatar} alt="" />
              ) : (
                Array.from(personal?.name || "我")[0]
              )}
            </button>
            {menu && (
              <div className={css.menu} role="menu">
                {[
                  ["profile", "个人档案"],
                  ["connections", "AI 与连接"],
                  ["settings", "设置"],
                ].map(([id, title]) => (
                  <button
                    type="button"
                    role="menuitem"
                    key={id}
                    onClick={() => {
                      setView(id as View);
                      setMenu(false);
                    }}
                  >
                    {title}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>
      <main className={`${css.content} ${view === "ask" ? css.askContent : ""}`}>
        {error && (
          <p className={css.error} role="alert">
            {error}
          </p>
        )}
        {data?.warnings.length ? (
          <details className={css.small}>
            <summary>{data.warnings.length} 项资料需要检查</summary>
            {data.warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </details>
        ) : null}
        {view === "overview" &&
          data &&
          (data.empty ? (
            <>
              <section className={css.welcome}>
                <span className={css.eyebrow}>欢迎</span>
                <h1>先记下一句，开图就开始认识你</h1>
                <p>你的记录都存在你自己的文件夹里，换哪个 AI 都能接着用。现在不用设置任何东西。</p>
              </section>
              {capture}
              <section className={css.sec}>
                <h2 className={css.eyebrow}>也可以从这里开始</h2>
                <div className={css.starts}>
                  <button type="button" className={`${css.start} ${css.card}`} onClick={() => openRecord("")}>
                    <h3>导入已有资料</h3>
                    <p>健康、日历、账单和已有记录，先从资料入口选一类。</p>
                  </button>
                  <button
                    type="button"
                    className={`${css.start} ${css.card}`}
                    onClick={() => setView("connections")}
                  >
                    <h3>连接一个 AI</h3>
                    <p>连上后，它能读写你的开图，帮你整理。</p>
                    <span className={css.chip}>可选</span>
                  </button>
                  <button
                    type="button"
                    className={`${css.start} ${css.card}`}
                    onClick={() => {
                      setView("explore");
                      setExplore("directions");
                    }}
                  >
                    <h3>写下一个想试的方向</h3>
                    <p>比如「要不要搬去别的城市住三个月」。先写问题，别的以后再补。</p>
                  </button>
                </div>
              </section>
            </>
          ) : (
            <>
              <div className={css.sec}>
                <div className={css.head}>
                  <h1>
                    {new Intl.DateTimeFormat("zh-CN", {
                      timeZone: "UTC",
                      month: "long",
                      day: "numeric",
                      weekday: "long",
                    }).format(new Date(`${data.today}T12:00:00Z`))}
                  </h1>
                  <span className={css.sub}>今天的事，一件一件来</span>
                </div>
                {capture}
              </div>
              <section className={css.sec}>
                <h2 className={css.eyebrow}>现在最该做的</h2>
                <div className={`${css.focus} ${css.card}`}>
                  <div className={css["focus-body"]}>
                    <h2 className={css["focus-title"]}>{focus?.title ?? "今天，留一点空间给下一步"}</h2>
                    <p className={css.small}>
                      {focus
                        ? `来自 ${focus.module}${focus.proposed ? " · 建议，待确认" : ""}`
                        : "看看最近的变化，或记下一件值得跟进的事。"}
                    </p>
                  </div>
                  {focus && (
                    <>
                      {!focus.proposed && (
                        <button
                          type="button"
                          className={`${css.btn} ${css["btn-strong"]} ${css["btn-big"]}`}
                          disabled={busy}
                          onClick={() => void run(() => props.completeNext(focus.file, focus.id))}
                        >
                          完成
                        </button>
                      )}
                      <button
                        type="button"
                        className={`${css.btn} ${css["btn-quiet"]}`}
                        onClick={() => openSection(focus.section)}
                      >
                        查看相关资料
                      </button>
                    </>
                  )}
                </div>
                {data.next.slice(1, 3).map((item) => (
                  <div className={`${css.row} ${css.card}`} key={item.id}>
                    <button
                      type="button"
                      className={css.check}
                      aria-label={`完成：${item.title}`}
                      disabled={busy || item.proposed}
                      onClick={() => void run(() => props.completeNext(item.file, item.id))}
                    >
                      ✓
                    </button>
                    <span className={css["row-title"]}>{item.title}</span>
                    <span className={css.chip}>
                      {item.module}
                      {item.proposed ? " · 待确认" : ""}
                    </span>
                    <button type="button" className={css.link} onClick={() => openSection(item.section)}>
                      查看
                    </button>
                  </div>
                ))}
                {data.allNext.length > 3 && (
                  <details>
                    <summary className={css.link}>全部 {data.allNext.length} 条下一步</summary>
                    {data.allNext.map((item) => (
                      <div className={css.row} key={item.id}>
                        <span className={css["row-title"]}>{item.title}</span>
                        <button type="button" className={css.link} onClick={() => openSection(item.section)}>
                          查看
                        </button>
                      </div>
                    ))}
                  </details>
                )}
              </section>
              <Agenda data={calendar} open={() => openRecord("calendar")} />
              {data.blocks
                .filter((b) => b.status === "pending" && b.kind === "proposal")
                .map((b) => (
                  <section className={css.ask} key={b.id}>
                    <h2 className={css.eyebrow}>要你确认</h2>
                    <p>
                      {b.title} · {b.start}
                      {b.end ? `–${b.end}` : ""}
                    </p>
                    <button
                      type="button"
                      className={`${css.btn} ${css["btn-primary"]}`}
                      disabled={busy}
                      onClick={() => void run(() => props.decideProposal(b.id, "confirmed"))}
                    >
                      放进日程
                    </button>
                    <button
                      type="button"
                      className={`${css.btn} ${css["btn-quiet"]}`}
                      disabled={busy}
                      onClick={() => void run(() => props.decideProposal(b.id, "rejected"))}
                    >
                      不用
                    </button>
                  </section>
                ))}
              {data.sync.needsReview > 0 && (
                <section className={css.ask}>
                  <b>要你确认</b>
                  {data.sync.directionSuggestions > 0 && (
                    <button type="button" className={css.link} onClick={() => openSection("explore")}>
                      {data.sync.directionSuggestions} 个方向建议
                    </button>
                  )}
                  {(data.sync.mapNeedsReview > 0 || data.sync.mapPendingImports > 0) && (
                    <button
                      type="button"
                      className={css.link}
                      onClick={() => {
                        setView("explore");
                        setExplore("footprints");
                      }}
                    >
                      足迹需要核对
                    </button>
                  )}
                  {data.inboxNotes > 0 && (
                    <button type="button" className={css.link} onClick={() => openRecord("inbox")}>
                      {data.inboxNotes} 条原文需要核对
                    </button>
                  )}
                </section>
              )}
              <DataSummaries data={data} open={openSection} />
              {data.sections.some((section) => section.id === "finance") && (
                <TodayFinance {...props} today={data.today} open={() => openRecord("finance")} />
              )}
              <section className={css.sec}>
                <div className={css["sec-head"]}>
                  <h2 className={css.eyebrow}>最近的变化</h2>
                  {data.daily && (
                    <details>
                      <summary className={css.link}>近期回顾 · {data.daily.date}</summary>
                      <div className={css.detailBody}>{data.daily.body}</div>
                    </details>
                  )}
                </div>
                {data.versions.slice(0, 3).map((version) => (
                  <div className={css["feed-row"]} key={version.oid}>
                    <span className={css.ini}>
                      {version.source === "user" ? "我" : (version.actor?.[0] ?? "图")}
                    </span>
                    <p>{version.text}</p>
                    <time className={css.small}>{stamp(version.time)}</time>
                  </div>
                ))}
                {!data.versions.length && <p className={css.small}>还没有新的变化</p>}
              </section>
            </>
          ))}
        {view === "records" && (
          <>
            <div className={css.sec}>
              {record && (
                <button type="button" className={css.link} onClick={() => setRecord("")}>
                  ← 资料
                </button>
              )}
              <div className={css.head}>
                <h1>{modules.find(([id]) => id === record)?.[1] ?? "资料"}</h1>
                <span className={css.sub}>
                  {record ? "完整的记录和来源" : "开图里的全部资料，都存在你自己的文件夹"}
                </span>
              </div>
            </div>
            {!record ? (
              <LibraryPage data={library} open={openRecord} />
            ) : record === "calendar" ? (
              <CalendarPage {...props} />
            ) : record === "projects" ? (
              <ProjectsLibrary {...child} timeZone={data?.timeZone} />
            ) : record === "health" ? (
              <HealthLibrary
                {...child}
                sources={library?.sections.find((s) => s.id === "health")?.sources ?? []}
              />
            ) : record === "finance" ? (
              <FinancePage {...child} today={data?.today} timeZone={data?.timeZone} />
            ) : record === "inbox" ? (
              <InboxPage data={library} />
            ) : (
              <NotesPage data={library} loadLibraryDocument={props.loadLibraryDocument} />
            )}
          </>
        )}
        {view === "explore" && (
          <>
            <div className={css.sec}>
              <div className={css.head}>
                <h1>开图</h1>
                <span className={css.sub}>想试的方向、走过的地方、值得看的新东西</span>
              </div>
              <div className={css.subtabs} role="toolbar" aria-label="开图里的内容">
                {[
                  ["directions", "方向"],
                  ["footprints", "足迹"],
                  ["news", "资讯"],
                ].map(([id, title]) => (
                  <button
                    type="button"
                    key={id}
                    aria-pressed={explore === id}
                    onClick={() => setExplore(id as string)}
                  >
                    {title}
                  </button>
                ))}
              </div>
            </div>
            <div className={css.child}>
              {explore === "directions" ? (
                <DirectionsPage {...child} goals={personal?.goals} />
              ) : explore === "footprints" ? (
                <MapPage {...child} />
              ) : (
                <NewsPage {...child} />
              )}
            </div>
          </>
        )}
        {(view === "ask" || askVisited) && props.renderAsk && (
          <div hidden={view !== "ask"}>{props.renderAsk(promptDraft, configureRequest)}</div>
        )}
        {["profile", "connections", "settings"].includes(view) && (
          <PersonalPages
            {...child}
            view={view as "profile" | "connections" | "settings"}
            navigate={setView}
            refreshWorkspace={refresh}
            manageAi={() => {
              if (props.renderAsk) {
                setConfigureRequest((n) => n + 1);
                setView("ask");
              } else props.onAgent();
            }}
          />
        )}
      </main>
    </div>
  );
}
