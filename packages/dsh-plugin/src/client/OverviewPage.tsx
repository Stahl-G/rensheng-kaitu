import type { CalendarPushSettings, OnboardingStatus } from "@kaitu/core";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { CalendarData, LibraryData, MeData, OverviewData } from "../types.js";
import { KaituMark } from "./Brand.js";
import { Agenda, CalendarPage, type CalendarPageProps } from "./CalendarPage.js";
import type { ChannelRequest } from "./ChannelSettings.js";
import { DirectionsPage, type DirectionsPageProps } from "./DirectionsPage.js";
import type { DoingPageProps } from "./DoingPage.js";
import { ExploreNavigation } from "./ExploreNavigation.js";
import { FeatureUpdates } from "./FeatureUpdates.js";
import { FinancePage, type FinancePageProps } from "./FinancePage.js";
import { HealthPage, type HealthPageProps } from "./HealthPage.js";
import type { LearningSource } from "./LearningPage.js";
import { InboxPage, LibraryPage, type LibraryProps, NotesPage } from "./LibraryPage.js";
import { HealthLibrary, ProjectsLibrary } from "./LibrarySummaries.js";
import { MapPage, type MapPageProps } from "./MapPage.js";
import type { MePageProps } from "./MePage.js";
import { NewsPage, type NewsPageProps } from "./NewsPage.js";
import { OnboardingNextCard } from "./OnboardingMatter.js";
import { OnboardingChecklist, OnboardingPage, STORAGE_STEP } from "./OnboardingPage.js";
import { PersonalPages, type PersonalServices } from "./PersonalPages.js";
import { PlansCard } from "./Plans.js";
import { ProgressMap } from "./ProgressMap.js";
import css from "./Prototype.module.css";
import {
  CalendarPushResult,
  CalendarSlotForm,
  DataSummaries,
  TodayFinance,
  TodayStart,
  TodayTasks,
} from "./TodayPage.js";
import todayCss from "./TodayPage.module.css";
import { type ExploreModule, defaultExploreEntries, exploreModules } from "./explore-modules.js";
import { type Locale, LocaleContext, browserLocale, dateFormat } from "./i18n.js";
import type { OnboardingServices } from "./onboarding-services.js";

export interface OverviewPageProps
  extends Omit<MePageProps, "onImportMemory">,
    PersonalServices,
    OnboardingServices,
    Omit<NewsPageProps, "onPrompt" | "onLearn">,
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
    promptRequest: number,
    active: boolean,
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
  const [exploreEntries, setExploreEntries] = useState<string[] | null>(null);
  const [preferencesFailed, setPreferencesFailed] = useState(false);
  const [preferencesAttempt, setPreferencesAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Explicit retry starts a fresh read and cancels the previous effect.
  useEffect(() => {
    let active = true;
    // 自动语言不写入偏好，只有用户明确选定的语言才固定下来。
    void props
      .loadPreferences(browserLocale())
      .then((value) => {
        if (!active) return;
        setLocale(value.locale === "en" ? "en" : "zh-CN");
        setFollowSystem(value.followSystem ?? false);
        setExploreEntries(value.exploreEntries ?? [...defaultExploreEntries]);
        setPreferencesFailed(false);
      })
      .catch(() => {
        if (!active) return;
        setLocale("zh-CN");
        setPreferencesFailed(true);
      });
    return () => {
      active = false;
    };
  }, [props.loadPreferences, preferencesAttempt]);
  return (
    <LocaleContext.Provider value={locale ?? "zh-CN"}>
      <Overview
        {...props}
        locale={locale}
        setLocale={setLocale}
        followSystem={followSystem}
        setFollowSystem={setFollowSystem}
        exploreEntries={exploreEntries}
        setExploreEntries={setExploreEntries}
        retryPreferences={
          preferencesFailed && exploreEntries === null
            ? () => {
                setPreferencesFailed(false);
                setPreferencesAttempt((attempt) => attempt + 1);
              }
            : undefined
        }
      />
    </LocaleContext.Provider>
  );
}

function Overview({
  locale,
  setLocale,
  followSystem,
  setFollowSystem,
  exploreEntries,
  setExploreEntries,
  retryPreferences,
  ...props
}: OverviewPageProps & {
  locale: Locale | null;
  setLocale: (locale: Locale) => void;
  followSystem: boolean;
  setFollowSystem: (value: boolean) => void;
  exploreEntries: string[] | null;
  setExploreEntries: (value: string[]) => void;
  retryPreferences?: () => void;
}) {
  const t = (zh: string, en: string) => (locale === "en" ? en : zh);
  const [onboarding, setOnboarding] = useState<OnboardingStatus | null>(null);
  const [guide, setGuide] = useState<number | null>();
  const [guideKey, setGuideKey] = useState(0);
  const [guideSource, setGuideSource] = useState<string>();
  const [guideText, setGuideText] = useState("");
  const [todayDetails, setTodayDetails] = useState(false);
  const [calendarAdding, setCalendarAdding] = useState(false);
  const [financeImporting, setFinanceImporting] = useState(false);
  const [channelFocus, setChannelFocus] = useState(false);
  const guideVisible = guide !== undefined && guide !== null;
  const [view, setView] = useState<View>("overview");
  const [record, setRecord] = useState("");
  const [explore, setExplore] = useState("footprints");
  const firstExplore = exploreEntries?.find((id) => exploreModules.some((entry) => entry.id === id)) ?? "";
  useEffect(() => {
    if (exploreEntries) setExplore((current) => (exploreEntries.includes(current) ? current : firstExplore));
  }, [exploreEntries, firstExplore]);
  const [data, setData] = useState<OverviewData | null>(null);
  const pendingProposals = data?.blocks.filter((b) => b.status === "pending" && b.kind === "proposal") ?? [];
  const [push, setPush] = useState<CalendarPushSettings | null>(null);
  const [slot, setSlot] = useState<{ file: string; id: string } | null>(null);
  const [calendar, setCalendar] = useState<CalendarData | null>(null);
  const [learningTopic, setLearningTopic] = useState("");
  const [learningSource, setLearningSource] = useState<LearningSource>();
  const [library, setLibrary] = useState<LibraryData | null>(null);
  const [personal, setPersonal] = useState<MeData | null>(null);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [promptDraft, setPromptDraft] = useState("");
  const [promptRequest, setPromptRequest] = useState(0);
  const [receipt, setReceipt] = useState("");
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const [askVisited, setAskVisited] = useState(false);
  const [configureRequest, setConfigureRequest] = useState(0);
  const [configureBuiltin, setConfigureBuiltin] = useState(false);
  const [theme, setTheme] = useState("light");
  const account = useRef<HTMLDivElement>(null);
  const sequence = useRef(0);
  const writing = useRef(false);
  const refreshPending = useRef(false);
  const refresh = useCallback(async () => {
    if (!locale) return;
    const seq = ++sequence.current;
    try {
      setError("");
      const update = <T,>(load: () => Promise<T>, apply: (value: T) => void) =>
        load().then((value) => {
          if (seq === sequence.current) apply(value);
        });
      await Promise.all([
        update(props.load, setData),
        update(props.loadCalendar, setCalendar),
        update(props.loadMe, setPersonal),
        update(
          () => props.loadOnboarding(locale),
          (introduction) => {
            setOnboarding(introduction);
            setGuide((current) => (current === undefined ? (introduction.showGuide ? 0 : null) : current));
          },
        ),
        update(props.loadCalendarPush, setPush),
      ]);
    } catch (err) {
      if (seq === sequence.current) setError(err instanceof Error ? err.message : String(err));
    }
  }, [locale, props.load, props.loadCalendar, props.loadMe, props.loadOnboarding, props.loadCalendarPush]);
  useEffect(() => {
    void refresh();
    return () => {
      sequence.current++;
    };
  }, [refresh]);
  useEffect(
    () =>
      props.subscribe?.(() => {
        // 本机写入的通知由 run 的写后刷新接住，不同时发起另一整组读取。
        if (writing.current) refreshPending.current = true;
        else void refresh();
      }),
    [props.subscribe, refresh],
  );
  // 资料只在进入资料页时读；今天页不等待归档原文、财务和全部笔记。
  useEffect(() => {
    if (view !== "records") return;
    let sequence = 0;
    const load = async () => {
      const seq = ++sequence;
      try {
        const value = await props.loadLibrary({
          section: record === "notes" || record === "health" ? record : "summary",
        });
        if (seq === sequence) setLibrary(value);
      } catch (err) {
        if (seq === sequence) setError(err instanceof Error ? err.message : String(err));
      }
    };
    void load();
    const off = props.subscribe?.(() => void load());
    return () => {
      sequence++;
      off?.();
    };
  }, [view, record, props.loadLibrary, props.subscribe]);
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
    writing.current = true;
    setBusy(true);
    setError("");
    try {
      await operation();
      // 到这里之前的通知已被本次读取覆盖；读取期间的新变化仍要补读，不能丢外部编辑。
      refreshPending.current = false;
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      writing.current = false;
      setBusy(false);
      if (refreshPending.current) {
        refreshPending.current = false;
        void refresh();
      }
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
    setPromptRequest((id) => id + 1);
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
      setExplore(
        id === "feed"
          ? "news"
          : id === "directions"
            ? "directions"
            : id === "explore"
              ? firstExplore
              : "health",
      );
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
    if (item.id === "storage") startGuide(STORAGE_STEP);
    else if (item.id === "matter") startGuide(1);
    else if (item.id === "memory") startGuide(5);
    else if (item.id === "starts") startGuide(2);
    else if (item.id === "sources") startGuide(item.action.target === "starts" ? 2 : 3);
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
    setExploreEntries(resolved.exploreEntries ?? [...defaultExploreEntries]);
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
          placeholder={t("随手记一句", "A quick note")}
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
  const startMatter = (text: string) => {
    setGuideText(text);
    startGuide(1);
  };
  const adoptedCard = onboarding?.next && (
    <OnboardingNextCard
      {...props}
      key={`${onboarding.next.id}-${onboarding.next.rev}`}
      next={onboarding.next}
      onPrompt={() => askNext({ title: onboarding.next?.next ?? "", module: onboarding.next?.goal ?? "" })}
      onSchedule={() => setSlot({ file: "task", id: onboarding.next?.id ?? "" })}
      refresh={refresh}
    />
  );
  // 所有目标与结果仍可展开查看，首屏只突出当前的一步。
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
  const selectedExplore = exploreModules.find((entry) => entry.id === explore);
  const explorePages: Record<ExploreModule["id"], ReactNode> = {
    health: <HealthPage {...child} />,
    footprints: (
      <>
        <MapPage {...child} />
        <ProgressMap
          plans={data?.plans}
          projects={data?.projects ?? []}
          loadExploration={props.loadExploration}
          subscribe={props.subscribe}
          open={(section) => {
            if (section === "directions") setExplore("directions");
            else if (section === "plans") setView("overview");
            else openSection("projects");
          }}
        />
      </>
    ),
    news: (
      <NewsPage
        {...child}
        onLearn={(item) => {
          setLearningSource({
            title: item.title,
            ...(item.url ? { url: item.url } : {}),
            ...(item.summary ? { text: `已有资讯摘要（非原文）：\n${item.summary}` } : {}),
          });
          openRecord("notes");
        }}
      />
    ),
    directions: (
      <DirectionsPage {...child} goals={personal?.goals} onConnect={() => setView("connections")} />
    ),
  };

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
                if (id === "explore") setExplore(firstExplore);
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
            onClick={() =>
              data?.sync.cloudOrganizer?.unread
                ? setView("connections")
                : savedOnly
                  ? openRecord("inbox")
                  : void refresh()
            }
          >
            <i className={css.dot} style={{ background: error ? "var(--news)" : "var(--health)" }} />
            {error
              ? t("读取失败", "Couldn't load")
              : !data
                ? t("正在读取…", "Loading…")
                : data.sync.cloudOrganizer?.unread && data.sync.cloudOrganizer.away
                  ? t(
                      `电脑不在时 ${data.sync.cloudOrganizer.away.agent.name} 处理了 ${data.sync.cloudOrganizer.away.actions} 条`,
                      `${data.sync.cloudOrganizer.away.agent.name} handled ${data.sync.cloudOrganizer.away.actions} while away`,
                    )
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
                        ? t(
                            `已存版本 ${stamp(data.sync.updatedAt)}`,
                            `Version saved ${stamp(data.sync.updatedAt)}`,
                          )
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
      <main
        className={`${css.content} ${view === "ask" ? css.askContent : ""} ${view === "explore" ? css.exploreContent : ""} ${view === "overview" ? todayCss.page : ""}`}
      >
        {props.desktopUpdate && view !== "settings" && (
          <FeatureUpdates request={props.desktopUpdate} compact />
        )}
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
              initialText={guideText}
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
            <TodayStart start={startMatter} memory={() => startGuide(5)} />
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
                </div>
                {capture}
              </div>
              <TodayTasks
                data={data}
                busy={busy}
                complete={(item) => void run(() => props.completeNext(item.file, item.id))}
                ask={askNext}
                schedule={(item) => setSlot({ file: item.file, id: item.id })}
                review={() => startGuide(1)}
                focusCard={adoptedCard}
              />
              {!focus && !adoptedCard && (
                <button type="button" className={css.link} onClick={() => startMatter("")}>
                  {t("整理一件事", "Think through one thing")}
                </button>
              )}
              <Agenda
                data={calendar}
                open={() => openRecord("calendar")}
                proposals={pendingProposals}
                busy={busy}
                decide={(id, decision) => void run(() => props.decideProposal(id, decision))}
              />
              {push &&
                data.blocks
                  // 加入日历成功不再列一遍；只有失败或需要手动导入的才显示。
                  .filter((block) => ["error", "file"].includes(push.entries[block.id]?.status ?? ""))
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
              <details
                className={todayCss.secondary}
                open={todayDetails}
                onToggle={(event) => setTodayDetails(event.currentTarget.open)}
              >
                <summary>{t("目标、资料与近期变化", "Goals, notes and recent changes")}</summary>
                {todayDetails && (
                  <div>
                    {plansCard}
                    {onboarding && (
                      <OnboardingChecklist
                        status={onboarding}
                        restart={() => startGuide()}
                        go={checklistAction}
                      />
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
                  </div>
                )}
              </details>
              {data.sync.needsReview > 0 && (
                <div className={todayCss.review}>
                  <span className={css.small}>{t("待核对资料", "Notes to review")}</span>
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
              </div>
            </div>
            {!record ? (
              <LibraryPage
                data={library}
                open={openRecord}
                inboxCount={data ? data.sync.received + data.inboxNotes : undefined}
              />
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
                sources={data?.plans.sources}
                openNext={(id, goalId) => {
                  setGuide(null);
                  setView("overview");
                  setTodayDetails(true);
                  setTimeout(
                    () =>
                      (
                        document.getElementById(`next-${id}`) ?? document.getElementById(`plan-${goalId}`)
                      )?.scrollIntoView({ block: "center" }),
                    0,
                  );
                }}
                loadLibrary={props.loadLibrary}
                subscribe={props.subscribe}
                channelSettings={props.channelSettings}
                connect={() => {
                  setView("connections");
                  setChannelFocus(true);
                }}
              />
            ) : (
              <NotesPage
                data={library}
                loadLibraryDocument={props.loadLibraryDocument}
                loadLearning={props.loadLearning}
                startLearning={props.startLearning}
                saveLearning={props.saveLearning}
                topic={learningTopic}
                onTopic={setLearningTopic}
                source={learningSource}
                onSourceConsumed={() => setLearningSource(undefined)}
                onPrompt={prompt}
                onSaved={() => {
                  void props
                    .loadLibrary()
                    .then(setLibrary)
                    .catch((err) => setError(String(err)));
                }}
              />
            )}
          </>
        )}
        {view === "explore" && (
          <>
            <section className={css.sec} aria-label={t("开图", "Explore")}>
              <h1 className={css.sr}>{t("开图", "Explore")}</h1>
              {retryPreferences && (
                <div className={css.exploreManage} role="alert">
                  <span>{t("入口布局读取失败。", "Could not load your entry layout.")}</span>
                  <button type="button" onClick={retryPreferences}>
                    {t("重试读取", "Retry loading")}
                  </button>
                </div>
              )}
              <ExploreNavigation
                entries={exploreEntries}
                current={explore}
                open={setExplore}
                save={async (entries) => {
                  const saved = await props.savePreferences({
                    locale: followSystem ? null : locale,
                    exploreEntries: entries,
                  });
                  setExploreEntries(saved.exploreEntries ?? [...defaultExploreEntries]);
                }}
              />
            </section>
            <div className={css.child}>
              {selectedExplore ? (
                explorePages[selectedExplore.id]
              ) : (
                <p>{t("从添加模块开始安排这张开图。", "Use Add modules to arrange your Explore page.")}</p>
              )}
            </div>
          </>
        )}
        {(view === "ask" || askVisited) && props.renderAsk && (
          <div className={css.askPanel} hidden={view !== "ask"}>
            {props.renderAsk(
              promptDraft,
              configureRequest,
              configureBuiltin,
              () => setView("connections"),
              promptRequest,
              view === "ask",
            )}
          </div>
        )}
        {["profile", "connections", "settings"].includes(view) && (
          <PersonalPages
            {...child}
            view={view as "profile" | "connections" | "settings"}
            navigate={setView}
            onImportMemory={() => startGuide(5)}
            refreshWorkspace={refresh}
            onWorkspaceCreated={async () => {
              await props.chooseOnboarding({ storage: true });
              await refresh();
              startGuide();
            }}
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
