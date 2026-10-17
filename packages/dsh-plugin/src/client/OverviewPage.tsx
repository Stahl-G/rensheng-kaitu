import type { CalendarPushSettings, OnboardingStatus } from "@kaitu/core";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { CalendarData, LibraryData, MeData, OverviewData } from "../types.js";
import { KaituMark } from "./Brand.js";
import { Agenda, CalendarPage, type CalendarPageProps } from "./CalendarPage.js";
import type { ChannelRequest } from "./ChannelSettings.js";
import { DirectionsPage, type DirectionsPageProps } from "./DirectionsPage.js";
import type { DoingPageProps } from "./DoingPage.js";
import { FinancePage, type FinancePageProps } from "./FinancePage.js";
import { HealthPage, type HealthPageProps } from "./HealthPage.js";
import { InboxPage, LibraryPage, type LibraryProps, NotesPage } from "./LibraryPage.js";
import { HealthLibrary, ProjectsLibrary } from "./LibrarySummaries.js";
import { MapPage, type MapPageProps } from "./MapPage.js";
import type { MePageProps } from "./MePage.js";
import { NewsPage, type NewsPageProps } from "./NewsPage.js";
import { OnboardingNextCard } from "./OnboardingMatter.js";
import { OnboardingChecklist, OnboardingPage } from "./OnboardingPage.js";
import { PersonalPages, type PersonalServices } from "./PersonalPages.js";
import { PlansCard } from "./Plans.js";
import css from "./Prototype.module.css";
import { CalendarPushResult, CalendarSlotForm, DataSummaries, TodayFinance } from "./TodayPage.js";
import { type Locale, LocaleContext, browserLocale, dateFormat } from "./i18n.js";
import type { OnboardingServices } from "./onboarding-services.js";

export interface OverviewPageProps
  extends MePageProps,
    PersonalServices,
    OnboardingServices,
    Omit<NewsPageProps, "onPrompt">,
    Omit<DoingPageProps, "onPrompt">,
    Omit<DirectionsPageProps, "onPrompt" | "goals" | "onConnect">,
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
  channelSettings?: ChannelRequest;
  renderAsk?: (
    prompt: string,
    configureRequest: number,
    configureBuiltin: boolean,
    onConnections: () => void,
  ) => ReactNode;
}
type View = "overview" | "explore" | "records" | "ask" | "profile" | "connections" | "settings";
const modules = [
  ["calendar", "日程", "Schedule"],
  ["projects", "在做的事", "Projects"],
  ["health", "健康", "Health"],
  ["finance", "财务", "Finance"],
  ["notes", "笔记与决策", "Notes and decisions"],
  ["inbox", "收件箱", "Inbox"],
];
/** 先读本机语言偏好（第一次打开时由服务端决定一次），再用它渲染整个应用。 */
export function OverviewPage(props: OverviewPageProps) {
  const [locale, setLocale] = useState<Locale | null>(null);
  const [followSystem, setFollowSystem] = useState(true);
  useEffect(() => {
    let active = true;
    // 自动语言不写入偏好，只有用户明确选定的语言才固定下来。
    void props
      .loadPreferences(browserLocale())
      .then((value) => {
        if (!active) return;
        setLocale(value.locale === "en" ? "en" : "zh-CN");
        setFollowSystem(value.followSystem ?? false);
      })
      .catch(() => active && setLocale("zh-CN"));
    return () => {
      active = false;
    };
  }, [props.loadPreferences]);
  return (
    <LocaleContext.Provider value={locale ?? "zh-CN"}>
      <Overview
        {...props}
        locale={locale}
        setLocale={setLocale}
        followSystem={followSystem}
        setFollowSystem={setFollowSystem}
      />
    </LocaleContext.Provider>
  );
}

function Overview({
  locale,
  setLocale,
  followSystem,
  setFollowSystem,
  ...props
}: OverviewPageProps & {
  locale: Locale | null;
  setLocale: (locale: Locale) => void;
  followSystem: boolean;
  setFollowSystem: (value: boolean) => void;
}) {
  const t = (zh: string, en: string) => (locale === "en" ? en : zh);
  const [onboarding, setOnboarding] = useState<OnboardingStatus | null>(null);
  const [guide, setGuide] = useState<number | null>();
  const [guideKey, setGuideKey] = useState(0);
  const [guideSource, setGuideSource] = useState<string>();
  const [calendarAdding, setCalendarAdding] = useState(false);
  const [financeImporting, setFinanceImporting] = useState(false);
  const [channelFocus, setChannelFocus] = useState(false);
  const guideVisible = guide !== undefined && guide !== null;
  const [view, setView] = useState<View>("overview");
  const [record, setRecord] = useState("");
  // 开图默认先看健康，然后是足迹、资讯、方向（2026-10-17 用户决定）。
  const [explore, setExplore] = useState("health");
  const [data, setData] = useState<OverviewData | null>(null);
  const pendingProposals = data?.blocks.filter((b) => b.status === "pending" && b.kind === "proposal") ?? [];
  const [push, setPush] = useState<CalendarPushSettings | null>(null);
  const [slot, setSlot] = useState<{ file: string; id: string } | null>(null);
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
  const [configureBuiltin, setConfigureBuiltin] = useState(false);
  const [theme, setTheme] = useState("light");
  const account = useRef<HTMLDivElement>(null);
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    if (!locale) return;
    const seq = ++sequence.current;
    try {
      const [overview, agenda, files, me, introduction, calendarPush] = await Promise.all([
        props.load(),
        props.loadCalendar(),
        props.loadLibrary(),
        props.loadMe(),
        props.loadOnboarding(locale),
        props.loadCalendarPush(),
      ]);
      if (seq !== sequence.current) return;
      setData(overview);
      setPush(calendarPush);
      setCalendar(agenda);
      setLibrary(files);
      setPersonal(me);
      setOnboarding(introduction);
      setGuide((current) => (current === undefined ? (introduction.showGuide ? 0 : null) : current));
      setError("");
    } catch (err) {
      if (seq === sequence.current) setError(err instanceof Error ? err.message : String(err));
    }
  }, [
    locale,
    props.load,
    props.loadCalendar,
    props.loadLibrary,
    props.loadMe,
    props.loadOnboarding,
    props.loadCalendarPush,
  ]);
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
    setCalendarAdding(false);
    setFinanceImporting(false);
    setRecord(modules.some(([key]) => key === id) ? id : "");
    setView("records");
  };
  const prompt = (text: string) => {
    setPromptDraft(text);
    if (props.renderAsk) setView("ask");
    else props.onPrompt(text);
  };
  const askNext = (item: { title: string; module: string }) =>
    prompt(
      t(
        `帮我完成「${item.title}」（来自${item.module}）。先看开图里相关的已有资料，缺少的信息一次问我一个问题。根据我的回答补全并写回对应资料，最后简短告诉我更新了什么。`,
        `Help me with “${item.title}” from ${item.module}. Read the related Kaitu notes first. Ask one question at a time for missing information, update the relevant notes from my answers, then briefly tell me what changed.`,
      ),
    );
  const openSection = (id: string) => {
    if (id === "me") setView("profile");
    else if (["explore", "health", "feed", "directions"].includes(id)) {
      setExplore(id === "feed" ? "news" : id === "directions" ? "directions" : "health");
      setView("explore");
    } else openRecord(["learning", "decisions"].includes(id) ? "notes" : id);
  };
  const manageAi = (builtin = false) => {
    if (props.renderAsk) {
      setConfigureBuiltin(builtin);
      setConfigureRequest((n) => n + 1);
      setView("ask");
    } else setView("connections");
  };
  const openSource = (source: string) => {
    if (source === "calendar" || source === "finance") {
      openRecord(source);
      setCalendarAdding(source === "calendar");
      setFinanceImporting(source === "finance");
    } else if (source === "mail") {
      setChannelFocus(true);
      setView("connections");
    }
  };
  const startGuide = (step = 0, source?: string) => {
    setGuideKey((current) => current + 1);
    setGuideSource(source);
    setGuide(step);
    setView("overview");
    setMenu(false);
    if (source) openSource(source);
  };
  const checklistAction = (item: OnboardingStatus["checklist"]["items"][number]) => {
    if (item.disabled) return;
    if (item.id === "matter") startGuide(1);
    else if (item.id === "memory") startGuide(5);
    else if (item.id === "starts") startGuide(2);
    else if (item.id === "sources") startGuide(3);
    else if (item.id === "ai") startGuide(4);
    else if (item.id === "plan")
      prompt(
        t(
          "请根据我的现状、日程和下一步，帮我安排今天，先提出待确认的计划。",
          "Based on where I am, my schedule and my next steps, plan my day. Propose a plan for me to confirm first.",
        ),
      );
  };
  /** 「在原来的 AI 里继续」贴回的回答：先存原文，再读成待核对草稿，打开核对页。 */
  const handoverAnswer = async (answer: string) => {
    const matter = await props.saveOnboardingMatter(answer);
    await props.pasteOnboardingMatter(matter.source, answer, locale ?? "zh-CN");
    await refresh();
    startGuide(1);
  };
  const changeLocale = async (next: Locale | null) => {
    await props.savePreferences({ locale: next });
    const resolved = await props.loadPreferences(browserLocale());
    setLocale(resolved.locale === "en" ? "en" : "zh-CN");
    setFollowSystem(resolved.followSystem ?? false);
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
    dateFormat(locale ?? "zh-CN", {
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
            setReceipt(
              data?.sync.organizer
                ? t("已收到，会在每日整理时处理", "Received; the daily organizer will process it")
                : t("已保存原文", "Saved"),
            );
          });
        }}
      >
        <label className={css.sr} htmlFor="capture-text">
          {t("随手记一句", "Quick note")}
        </label>
        <input
          id="capture-text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={100000}
          placeholder={t(
            "随手记一句，比如「今晚跑了 5 公里，有点累」",
            'A quick note, like "Ran 5 km tonight, a bit tired"',
          )}
          disabled={busy}
        />
        <button type="submit" className={`${css.btn} ${css["btn-strong"]}`} disabled={busy || !draft.trim()}>
          {t("记下", "Add note")}
        </button>
      </form>
      {receipt && (
        <output className={css.saved}>
          {receipt}
          <button type="button" className={css.link} onClick={() => openRecord("inbox")}>
            {t("去收件箱看", "Open inbox")}
          </button>
        </output>
      )}
    </div>
  );
  const focus = data?.next[0];
  // 规划放在「现在最该做的」之后：先看今天，再看各个目标。
  const plansCard = data?.plans && (
    <PlansCard
      plans={data.plans}
      addGoalNext={props.addGoalNext}
      changeNext={props.changeOnboardingNext}
      refresh={refresh}
      open={(section) => (section === "projects" ? openRecord("projects") : openSection("directions"))}
    />
  );
  const savedOnly = !!data && data.sync.received > 0 && !data.sync.organizer && !data.sync.needsReview;
  return (
    <div className={css.app} data-theme={theme} lang={locale === "en" ? "en" : "zh-CN"}>
      <header className={css.top}>
        <div className={css.brand}>
          <KaituMark size={26} />
          {t("人生开图", "Kaitu")}
        </div>
        <nav className={css.tabs} aria-label={t("主要导航", "Main navigation")}>
          {[
            ...[
              ["overview", t("今天", "Today")],
              ["explore", t("开图", "Explore")],
              ["records", t("资料", "Library")],
            ],
            ...(props.renderAsk ? [["ask", t("问问", "Ask")]] : []),
          ].map(([id, label]) => (
            <button
              type="button"
              key={id}
              aria-current={view === id ? "page" : undefined}
              onClick={() => {
                setView(id as View);
                if (id === "overview") void refresh();
                if (id === "explore") setExplore("health");
                setRecord("");
                setMenu(false);
              }}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className={css.tools}>
          <button
            type="button"
            className={`${css.link} ${css.sync}`}
            onClick={() => (savedOnly ? openRecord("inbox") : void refresh())}
          >
            <i className={css.dot} style={{ background: error ? "var(--news)" : "var(--health)" }} />
            {error
              ? t("读取失败", "Couldn't load")
              : !data
                ? t("正在读取…", "Loading…")
                : data.sync.needsReview
                  ? t(`${data.sync.needsReview} 条要核对`, `${data.sync.needsReview} to review`)
                  : data.sync.received
                    ? data.sync.organizer
                      ? t("已收到，等待每日整理", "Received; waiting for the daily organizer")
                      : t(
                          `已保存 ${data.sync.received} 条原文`,
                          `${data.sync.received} saved note${data.sync.received > 1 ? "s" : ""}`,
                        )
                    : data.sync.updatedAt
                      ? t(`已更新 ${stamp(data.sync.updatedAt)}`, `Updated ${stamp(data.sync.updatedAt)}`)
                      : t("本机资料", "On this computer")}
          </button>
          <div className={css.account} ref={account}>
            <button
              type="button"
              className={css.avatar}
              aria-label={t("个人档案、AI 与连接、设置", "Profile, AI & connections, settings")}
              aria-haspopup="menu"
              aria-expanded={menu}
              onClick={() => setMenu(!menu)}
            >
              {personal?.avatar ? (
                <img src={personal.avatar} alt="" />
              ) : (
                Array.from(personal?.name || t("我", "Me"))[0]
              )}
            </button>
            {menu && (
              <div className={css.menu} role="menu">
                {[
                  ["profile", t("个人档案", "Profile")],
                  ["connections", t("AI 与连接", "AI & connections")],
                  ["settings", t("设置", "Settings")],
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
                <button type="button" role="menuitem" onClick={() => startGuide()}>
                  {t("开始使用", "Get started")}
                </button>
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
            <summary>
              {t(`${data.warnings.length} 项资料需要检查`, `${data.warnings.length} items need checking`)}
            </summary>
            {data.warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </details>
        ) : null}
        {guide === undefined && !error && (
          <output className={css.small}>{t("正在读取开图…", "Loading Kaitu…")}</output>
        )}
        {guideVisible && view !== "overview" && (
          <div className={css["sec-head"]}>
            <button
              type="button"
              className={css.link}
              onClick={() => {
                setGuide(null);
                setView("overview");
                void refresh();
              }}
            >
              {t("← 回到今天", "← Back to Today")}
            </button>
          </div>
        )}
        {onboarding && guideVisible && (
          <div hidden={!guideVisible || view !== "overview"}>
            <OnboardingPage
              {...props}
              key={guideKey}
              status={onboarding}
              step={guide ?? 0}
              builtin={!!props.renderAsk}
              initialSource={guideSource}
              setStep={setGuide}
              onStatus={setOnboarding}
              refresh={refresh}
              openSource={openSource}
              onPrompt={prompt}
              onComplete={(destination) => {
                setGuide(null);
                if (destination === "ask") manageAi(true);
                else setView(destination === "connections" ? "connections" : "overview");
                void refresh();
              }}
            />
          </div>
        )}
        {view === "overview" && !guideVisible && guide !== undefined && onboarding && (
          <>
            {onboarding.next && (
              <OnboardingNextCard
                {...props}
                key={`${onboarding.next.id}-${onboarding.next.rev}`}
                next={onboarding.next}
                onSchedule={() => setSlot({ file: "task", id: onboarding.next?.id ?? "" })}
                refresh={refresh}
              />
            )}
            <OnboardingChecklist status={onboarding} restart={() => startGuide()} go={checklistAction} />
          </>
        )}
        {view === "overview" && slot && (
          <CalendarSlotForm
            date={calendar?.planDate ?? calendar?.today ?? t("今天", "Today")}
            close={() => setSlot(null)}
            save={async (start, end) => {
              await props.scheduleNext(slot.file, slot.id, start, end);
              await refresh();
            }}
          />
        )}
        {view === "overview" &&
          !guideVisible &&
          guide !== undefined &&
          data &&
          (data.empty ? (
            <>
              <div className={css.head}>
                <h1>{t("今天", "Today")}</h1>
                <span className={css.sub}>
                  {t("先记下一句，开图就开始认识你", "Write one line and Kaitu starts getting to know you")}
                </span>
              </div>
              {capture}
              <p className={css.small}>
                {t(
                  "有了真实记录后，你的数据和最近变化会出现在这里。",
                  "Once you have real notes, your data and recent changes show up here.",
                )}
              </p>
              {plansCard}
            </>
          ) : (
            <>
              <div className={css.sec}>
                <div className={css.head}>
                  <h1>
                    {dateFormat(locale ?? "zh-CN", {
                      timeZone: "UTC",
                      month: "long",
                      day: "numeric",
                      weekday: "long",
                    }).format(new Date(`${data.today}T12:00:00Z`))}
                  </h1>
                  <span className={css.sub}>{t("今天的事，一件一件来", "One thing at a time today")}</span>
                </div>
                {capture}
              </div>
              {(!onboarding?.next || focus) && (
                <section className={css.sec}>
                  <h2 className={css.eyebrow}>{t("现在最该做的", "Most important now")}</h2>
                  <div className={`${css.focus} ${css.card}`}>
                    <div className={css["focus-body"]}>
                      <h2 className={css["focus-title"]}>
                        {focus?.title ??
                          t("今天，留一点空间给下一步", "Leave some room today for a next step")}
                      </h2>
                      <p className={css.small}>
                        {focus
                          ? t(
                              `来自 ${focus.module}${focus.proposed ? " · 建议，待确认" : ""}`,
                              `From ${focus.module}${focus.proposed ? " · suggestion, needs confirming" : ""}`,
                            )
                          : t(
                              "看看最近的变化，或记下一件值得跟进的事。",
                              "Look at recent changes, or note something worth following up.",
                            )}
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
                            {t("完成", "Done")}
                          </button>
                        )}
                        {!focus.proposed && (
                          <button
                            type="button"
                            className={css.link}
                            onClick={() => setSlot({ file: focus.file, id: focus.id })}
                          >
                            {t("安排时间段", "Schedule a time")}
                          </button>
                        )}
                        <button
                          type="button"
                          className={`${css.btn} ${css["btn-strong"]}`}
                          onClick={() => askNext(focus)}
                        >
                          {t("让问问帮我", "Ask for help")}
                        </button>
                      </>
                    )}
                  </div>
                  {data.next.slice(1, 3).map((item) => (
                    <div className={`${css.row} ${css.card}`} key={item.id}>
                      <button
                        type="button"
                        className={css.check}
                        aria-label={t(`完成：${item.title}`, `Done: ${item.title}`)}
                        disabled={busy || item.proposed}
                        onClick={() => void run(() => props.completeNext(item.file, item.id))}
                      >
                        ✓
                      </button>
                      <span className={css["row-title"]}>{item.title}</span>
                      <span className={css.chip}>
                        {item.module}
                        {item.proposed ? t(" · 待确认", " · to confirm") : ""}
                      </span>
                      {!item.proposed && (
                        <button
                          type="button"
                          className={css.link}
                          onClick={() => setSlot({ file: item.file, id: item.id })}
                        >
                          {t("安排时间段", "Schedule a time")}
                        </button>
                      )}
                      <button type="button" className={css.link} onClick={() => askNext(item)}>
                        {t("让问问帮我", "Ask for help")}
                      </button>
                    </div>
                  ))}
                  {data.allNext.length > 3 && (
                    <details>
                      <summary className={css.link}>
                        {t(`全部 ${data.allNext.length} 条下一步`, `All ${data.allNext.length} next steps`)}
                      </summary>
                      {data.allNext.map((item) => (
                        <div className={css.row} key={item.id}>
                          <span className={css["row-title"]}>{item.title}</span>
                          <button type="button" className={css.link} onClick={() => askNext(item)}>
                            {t("让问问帮我", "Ask for help")}
                          </button>
                        </div>
                      ))}
                    </details>
                  )}
                </section>
              )}
              {plansCard}
              <Agenda
                data={calendar}
                open={() => openRecord("calendar")}
                proposals={pendingProposals}
                busy={busy}
                decide={(id, decision) => void run(() => props.decideProposal(id, decision))}
              />
              {push &&
                data.blocks
                  .filter((block) => block.status === "confirmed" && block.start && block.end)
                  .map((block) => (
                    <div className={css.row} key={block.id}>
                      <span>{block.title}</span>
                      <CalendarPushResult
                        id={block.id}
                        state={push}
                        retry={async (id) => {
                          setPush(
                            await (push?.enabled ? props.retryCalendarPush(id) : props.removeCalendarPush()),
                          );
                        }}
                      />
                    </div>
                  ))}
              {data.sync.needsReview > 0 && (
                <div className={css.reviewLinks}>
                  <span className={css.small}>{t("要你核对：", "To review:")}</span>
                  {data.sync.directionSuggestions > 0 && (
                    <button type="button" className={css.link} onClick={() => openSection("directions")}>
                      {t(
                        `${data.sync.directionSuggestions} 个方向建议`,
                        `${data.sync.directionSuggestions} direction suggestions`,
                      )}
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
                      {t("足迹需要核对", "Footprints to review")}
                    </button>
                  )}
                  {data.inboxNotes > 0 && (
                    <button type="button" className={css.link} onClick={() => openRecord("inbox")}>
                      {t(`${data.inboxNotes} 条原文需要核对`, `${data.inboxNotes} notes to review`)}
                    </button>
                  )}
                </div>
              )}
              <DataSummaries data={data} open={openSection} />
              {data.sections.some((section) => section.id === "finance") && (
                <TodayFinance {...props} today={data.today} open={() => openRecord("finance")} />
              )}
              <section className={css.sec}>
                <div className={css["sec-head"]}>
                  <h2 className={css.eyebrow}>{t("最近的变化", "Recent changes")}</h2>
                  {data.daily && (
                    <details>
                      <summary className={css.link}>
                        {t("近期回顾", "Recent review")} · {data.daily.date}
                      </summary>
                      <div className={css.detailBody}>{data.daily.body}</div>
                    </details>
                  )}
                </div>
                {data.versions.slice(0, 3).map((version) => (
                  <div className={css["feed-row"]} key={version.oid}>
                    <span className={css.ini}>
                      {version.source === "user" ? t("我", "Me") : (version.actor?.[0] ?? t("图", "K"))}
                    </span>
                    <p>{version.text}</p>
                    <time className={css.small}>{stamp(version.time)}</time>
                  </div>
                ))}
                {!data.versions.length && (
                  <p className={css.small}>{t("还没有新的变化", "No changes yet")}</p>
                )}
              </section>
            </>
          ))}
        {view === "records" && (
          <>
            <div className={css.sec}>
              {record && (
                <button type="button" className={css.link} onClick={() => setRecord("")}>
                  {t("← 资料", "← Library")}
                </button>
              )}
              <div className={css.head}>
                <h1>
                  {(() => {
                    const item = modules.find(([id]) => id === record);
                    return item ? t(item[1] as string, item[2] as string) : t("资料", "Library");
                  })()}
                </h1>
                <span className={css.sub}>
                  {record
                    ? t("完整的记录和来源", "Full records and sources")
                    : t(
                        "开图里的全部资料，都存在你自己的文件夹",
                        "Everything in Kaitu, kept in your own folder",
                      )}
                </span>
              </div>
            </div>
            {!record ? (
              <LibraryPage data={library} open={openRecord} />
            ) : record === "calendar" ? (
              <CalendarPage {...props} initialAdding={calendarAdding} />
            ) : record === "projects" ? (
              <ProjectsLibrary {...child} timeZone={data?.timeZone} />
            ) : record === "health" ? (
              <HealthLibrary
                {...child}
                sources={library?.sections.find((s) => s.id === "health")?.sources ?? []}
              />
            ) : record === "finance" ? (
              <FinancePage
                {...child}
                initialImport={financeImporting}
                today={data?.today}
                timeZone={data?.timeZone}
              />
            ) : record === "inbox" ? (
              <InboxPage
                data={library}
                channelSettings={props.channelSettings}
                connect={() => {
                  setView("connections");
                  setChannelFocus(true);
                }}
              />
            ) : (
              <NotesPage data={library} loadLibraryDocument={props.loadLibraryDocument} />
            )}
          </>
        )}
        {view === "explore" && (
          <>
            <div className={css.sec}>
              <div className={css.head}>
                <h1>{t("开图", "Explore")}</h1>
                <span className={css.sub}>
                  {t(
                    "身体和饮食、走过的地方、值得看的新东西、想试的方向",
                    "Your health, places you've been, new things worth a look, directions to try",
                  )}
                </span>
              </div>
              <div className={css.subtabs} role="toolbar" aria-label={t("开图里的内容", "Explore sections")}>
                {[
                  ["health", t("健康", "Health")],
                  ["footprints", t("足迹", "Footprints")],
                  ["news", t("资讯", "News")],
                  ["directions", t("方向", "Directions")],
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
              {explore === "health" ? (
                <HealthPage {...child} />
              ) : explore === "footprints" ? (
                <MapPage {...child} />
              ) : explore === "news" ? (
                <NewsPage {...child} />
              ) : (
                <DirectionsPage {...child} goals={personal?.goals} onConnect={() => setView("connections")} />
              )}
            </div>
          </>
        )}
        {(view === "ask" || askVisited) && props.renderAsk && (
          <div hidden={view !== "ask"}>
            {props.renderAsk(promptDraft, configureRequest, configureBuiltin, () => setView("connections"))}
          </div>
        )}
        {["profile", "connections", "settings"].includes(view) && (
          <PersonalPages
            {...child}
            view={view as "profile" | "connections" | "settings"}
            navigate={setView}
            refreshWorkspace={refresh}
            channelSettings={props.channelSettings}
            channelFocus={channelFocus}
            onChannelFocused={() => setChannelFocus(false)}
            manageAi={props.renderAsk ? manageAi : props.onAgent}
            onHandoverAnswer={handoverAnswer}
            locale={locale ?? "zh-CN"}
            followSystem={followSystem}
            onLocale={changeLocale}
          />
        )}
        {guideVisible && view !== "overview" && (
          <div className={css["sec-head"]}>
            <span />
            <button
              type="button"
              className={`${css.btn} ${css["btn-primary"]}`}
              onClick={() => {
                setGuide(null);
                setView("overview");
                void refresh();
              }}
            >
              {t("完成", "Done")}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
