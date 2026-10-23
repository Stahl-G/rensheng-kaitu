import type { CalendarPushSettings, OnboardingMatter as Matter, OnboardingStatus } from "@kaitu/core";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { CalendarData, LibraryData, MeData, OverviewData } from "../types.js";
import { KaituMark } from "./Brand.js";
import { Agenda, CalendarPage, type CalendarPageProps } from "./CalendarPage.js";
import { CalendarPushResult, CalendarSlotForm } from "./CalendarPush.js";
import type { ChannelRequest } from "./ChannelSettings.js";
import { DirectionsPage, type DirectionsPageProps } from "./DirectionsPage.js";
import type { DoingPageProps } from "./DoingPage.js";
import { ExploreNavigation } from "./ExploreNavigation.js";
import { FeatureUpdates } from "./FeatureUpdates.js";
import { FinancePage, type FinancePageProps } from "./FinancePage.js";
import { HealthPage, type HealthPageProps } from "./HealthPage.js";
import { JobsPage, type JobsPageProps } from "./JobsPage.js";
import type { LearningSource } from "./LearningPage.js";
import { InboxPage, LibraryPage, type LibraryProps, NotesPage } from "./LibraryPage.js";
import { HealthLibrary, ProjectsLibrary } from "./LibrarySummaries.js";
import { MapPage, type MapPageProps } from "./MapPage.js";
import type { MePageProps } from "./MePage.js";
import { NavigationIcon, SettingsIcon } from "./NavigationIcon.js";
import { NewsPage, type NewsPageProps } from "./NewsPage.js";
import { OnboardingMatter, OnboardingNextCard } from "./OnboardingMatter.js";
import { OnboardingPage, STORAGE_STEP } from "./OnboardingPage.js";
import { OnboardingFileImport } from "./OnboardingSources.js";
import { PersonalPages, type PersonalServices, type SettingsSection } from "./PersonalPages.js";
import { PlansCard } from "./Plans.js";
import { ProgressMap } from "./ProgressMap.js";
import css from "./Prototype.module.css";
import { TodayStart, TodayTasks, TodayWeather } from "./TodayPage.js";
import todayCss from "./TodayPage.module.css";
import { type ExploreModule, defaultExploreEntries, exploreModules } from "./explore-modules.js";
import { footprintAnchor } from "./footprint-state.js";
import { type Locale, LocaleContext, browserLocale, dateFormat } from "./i18n.js";
import type { OnboardingServices } from "./onboarding-services.js";

export interface OverviewPageProps
  extends Omit<MePageProps, "onImportMemory">,
    PersonalServices,
    JobsPageProps,
    OnboardingServices,
    Omit<NewsPageProps, "onPrompt" | "onLearn">,
    Omit<DoingPageProps, "onPrompt">,
    Omit<DirectionsPageProps, "onPrompt" | "goals" | "onConnect">,
    Omit<MapPageProps, "onPrompt">,
    Omit<HealthPageProps, "onPrompt">,
    Omit<FinancePageProps, "onPrompt" | "today" | "timeZone">,
    CalendarPageProps,
    LibraryProps {
  initialChatDraft?: string;
  hosted?: boolean;
  load: () => Promise<OverviewData>;
  subscribe?: (refresh: () => void) => () => void;
  capture: (text: string) => Promise<unknown>;
  adoptTask: (id: string) => Promise<unknown>;
  cancelTask: (id: string) => Promise<unknown>;
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
    onToday: () => void,
    onSettings: (section: "ai" | "local-ai") => void,
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
  const [residenceCity, setResidenceCity] = useState("");
  const [weatherCity, setWeatherCity] = useState("");
  const [adoptedTasks, setAdoptedTasks] = useState<{ day: string; ids: string[] }>({ day: "", ids: [] });
  useEffect(() => {
    let active = true;
    void props
      .loadPreferences()
      .then((value) => {
        if (active) {
          setWeatherCity(value.weatherCity ?? "");
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [props.loadPreferences]);
  const [calendarAdding, setCalendarAdding] = useState(false);
  const [financeImporting, setFinanceImporting] = useState(false);
  const [channelFocus, setChannelFocus] = useState(false);
  const [connectionSection, setConnectionSection] = useState<SettingsSection>("overview");
  const [importSource, setImportSource] = useState<
    "choose" | "apple-health" | "chatgpt-conversations" | null
  >(null);
  const [reviewMatter, setReviewMatter] = useState<Matter | null>(null);
  const askPanel = useRef<HTMLDivElement>(null);
  const guideVisible = guide !== undefined && guide !== null;
  const [view, setView] = useState<View>(props.initialChatDraft ? "ask" : "overview");
  const [record, setRecord] = useState("");
  const [explore, setExplore] = useState("footprints");
  const firstExplore = exploreEntries?.find((id) => exploreModules.some((entry) => entry.id === id)) ?? "";
  useEffect(() => {
    if (exploreEntries) setExplore((current) => (exploreEntries.includes(current) ? current : firstExplore));
  }, [exploreEntries, firstExplore]);
  const [data, setData] = useState<OverviewData | null>(null);
  const workspaceRoot = data?.root;
  const [hasWrittenMatter, setHasWrittenMatter] = useState(false);
  const emptyWorkspace = data?.empty;
  const hasUserData = onboarding?.hasUserData;
  useEffect(() => {
    let active = true;
    setHasWrittenMatter(false);
    if (workspaceRoot && emptyWorkspace && hasUserData) {
      void props
        .loadLibrary({ section: "inbox", source: "me" })
        .then((value) => {
          if (active) setHasWrittenMatter(value.inbox.length > 0);
        })
        .catch(() => {});
    }
    return () => {
      active = false;
    };
  }, [workspaceRoot, emptyWorkspace, hasUserData, props.loadLibrary]);
  useEffect(() => {
    let active = true;
    if (workspaceRoot)
      void props
        .loadLifeMap()
        .then((map) => {
          if (active) setResidenceCity(footprintAnchor(map.experiences, map.asOf)?.name ?? "");
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [workspaceRoot, props.loadLifeMap]);
  useEffect(() => {
    let active = true;
    void props
      .loadPreferences()
      .then((value) => {
        if (active)
          setAdoptedTasks(
            value.todayAdoptions && value.todayAdoptions.workspace === workspaceRoot
              ? value.todayAdoptions
              : { day: "", ids: [] },
          );
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [workspaceRoot, props.loadPreferences]);
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
  const [promptDraft, setPromptDraft] = useState(props.initialChatDraft ?? "");
  const [promptRequest, setPromptRequest] = useState(props.initialChatDraft ? 1 : 0);
  const [receipt, setReceipt] = useState("");
  const [busy, setBusy] = useState(false);
  const [askVisited, setAskVisited] = useState(false);
  const [configureRequest, setConfigureRequest] = useState(0);
  const [configureBuiltin, setConfigureBuiltin] = useState(false);
  const [theme, setTheme] = useState("light");
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
            setGuide((current) => (current === undefined ? null : current));
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
          section: record === "notes" || record === "health" ? record : record ? "summary" : undefined,
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
    // The DSH plugin leaves the host's Settings shortcut untouched.
    if (props.hosted || !props.renderAsk) return;
    const openSettings = () => {
      setConnectionSection("overview");
      setView("settings");
    };
    const shortcut = (event: KeyboardEvent) => {
      if (event.metaKey && !event.ctrlKey && !event.altKey && event.key === ",") {
        event.preventDefault();
        openSettings();
      }
    };
    document.addEventListener("keydown", shortcut);
    window.addEventListener("kaitu:settings", openSettings);
    return () => {
      document.removeEventListener("keydown", shortcut);
      window.removeEventListener("kaitu:settings", openSettings);
    };
  }, [props.hosted, props.renderAsk]);
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
  const openAskSettings = (section: "ai" | "local-ai") => {
    if (section === "local-ai") {
      setConnectionSection(section);
      setView("connections");
    } else manageAi(true);
  };
  useEffect(() => {
    if (!configureRequest || !configureBuiltin || view !== "ask") return;
    const panel = askPanel.current;
    if (!panel) return;
    const focus = () => {
      const input = panel.querySelector<HTMLInputElement>('dialog[open] input[type="password"]');
      if (!input) return false;
      input.focus();
      return true;
    };
    if (focus()) return;
    const observer = new MutationObserver(() => {
      if (focus()) observer.disconnect();
    });
    observer.observe(panel, { childList: true, subtree: true, attributes: true, attributeFilter: ["open"] });
    return () => observer.disconnect();
  }, [configureRequest, configureBuiltin, view]);
  const openSource = (source: string) => {
    if (source === "calendar" || source === "finance") {
      openRecord(source);
      setCalendarAdding(source === "calendar");
      setFinanceImporting(source === "finance");
    } else if (source === "mail") {
      setConnectionSection("channels");
      setChannelFocus(true);
      setView("connections");
    }
  };
  const startGuide = (step = 0, source?: string) => {
    setGuideKey((current) => current + 1);
    setGuideSource(source);
    setGuide(step);
    setView("overview");
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
  const capture = (
    <section className={todayCss.capture}>
      <h2>{t("随手记", "Quick note")}</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.trim()) return;
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
        <textarea
          rows={3}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          id="capture-text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={100000}
          placeholder={
            data?.empty
              ? t(
                  "想到什么，先记下。开图会先存原文，不改你的字。",
                  "Write a thought. Kaitu keeps your original words.",
                )
              : t("想到什么，先记下", "Write a thought")
          }
          disabled={busy}
        />
        <button type="submit" className={css.btn} disabled={busy || !draft.trim()}>
          {t("记下", "Add note")}
        </button>
        <button
          type="button"
          className={css.link}
          onClick={() => {
            document.getElementById("capture-text")?.focus();
            setReceipt(t("可用系统听写输入，再点记下", "Use your system dictation, then save the note"));
          }}
        >
          {t("说一段", "Dictate")}
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
    </section>
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
  const renderTasks = (showAll = false) =>
    data && (
      <TodayTasks
        data={data}
        showAll={showAll}
        busy={busy}
        complete={(item) => void run(() => props.completeNext(item.file, item.id))}
        ask={askNext}
        schedule={(item) => setSlot({ file: item.file, id: item.id })}
        review={() => startGuide(1)}
        focusCard={adoptedCard}
        focusTaskId={onboarding?.next?.id}
        adopted={adoptedTasks.day === data.today ? adoptedTasks.ids : []}
        all={() => openRecord("projects")}
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
  const selectedExplore = exploreModules.find((entry) => entry.id === explore);
  const explorePages: Record<ExploreModule["id"], ReactNode> = {
    health: <HealthPage {...child} />,
    jobs: <JobsPage {...child} />,
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
          <span className={css.brandName}>{t("开图", "Kaitu")}</span>
        </div>
        <nav className={css.tabs} aria-label={t("主要导航", "Main navigation")}>
          {[
            ...[
              ["overview", t("今天", "Today")],
              ["explore", t("开图", "Explore")],
              ["records", t("资料", "Library")],
            ],
            ...(props.renderAsk && !props.hosted ? [["ask", t("问问", "Ask")]] : []),
          ].map(([id, label]) => (
            <button
              type="button"
              key={id}
              title={
                id === "overview"
                  ? t(
                      "现在要做的一件事、接下来的安排，以及等你决定的 AI 建议",
                      "Your current focus, upcoming plans, and AI suggestions awaiting your decision",
                    )
                  : id === "explore"
                    ? t("你的足迹、健康，还有装上的插件", "Your places, health, and installed plugins")
                    : id === "records"
                      ? t(
                          "你留下的每一条原文，以及从中整理出的笔记、日程、健康、财务",
                          "Your originals, and the notes, schedule, health and finances organized from them",
                        )
                      : t(
                          "和 AI 聊你的资料；每次只发送你允许的那部分",
                          "Chat with AI about your notes; only the parts you allow are sent",
                        )
              }
              aria-current={view === id ? "page" : undefined}
              onClick={() => {
                setView(id as View);
                if (id === "overview") void refresh();
                if (id === "explore") setExplore(firstExplore);
                setRecord("");
              }}
            >
              <NavigationIcon page={id} />
              <span>{label}</span>
              {id === "records" && !!data?.inboxNotes && (
                <span
                  className={css.reviewBadge}
                  aria-label={t(`${data.inboxNotes} 条要你核对`, `${data.inboxNotes} to review`)}
                >
                  {data.inboxNotes}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className={css.tools}>
          <button
            type="button"
            className={css.settingsButton}
            aria-label={t("设置", "Settings")}
            aria-current={view === "settings" ? "page" : undefined}
            onClick={() => {
              setConnectionSection("overview");
              setView("settings");
            }}
          >
            <SettingsIcon />
            <span className={css.settingsLabel}>{t("设置", "Settings")}</span>
          </button>
          <button
            type="button"
            className={css.avatar}
            aria-label={t("个人档案", "Profile")}
            onClick={() => setView("profile")}
          >
            {personal?.avatar ? (
              <img src={personal.avatar} alt="" />
            ) : (
              Array.from(personal?.name || t("我", "Me"))[0]
            )}
          </button>
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
        {view === "overview" && !guideVisible && guide !== undefined && data && (
          <>
            <TodayWeather
              city={residenceCity || weatherCity}
              saveCity={async (city) => {
                const preferences = await props.loadPreferences();
                await props.savePreferences({
                  locale: preferences.followSystem ? null : preferences.locale,
                  weatherCity: city,
                });
                setWeatherCity(city);
              }}
            />
            <div className={todayCss.layout}>
              <div className={todayCss.left}>
                {data.empty ? (
                  <TodayStart
                    start={startMatter}
                    memory={() => startGuide(5)}
                    status={onboarding}
                    hasWrittenMatter={hasWrittenMatter}
                    connect={() => {
                      setGuide(null);
                      if (props.renderAsk) setView("ask");
                      else props.onAgent();
                    }}
                    openModule={(id) => {
                      setView("explore");
                      setExplore(id);
                    }}
                  />
                ) : (
                  renderTasks()
                )}
                {!data.empty && !focus && !adoptedCard && (
                  <section className={todayCss.focusSection}>
                    <button type="button" className={css.btn} onClick={() => startMatter("")}>
                      {t("从一件事开始", "Start with one thing")}
                    </button>
                  </section>
                )}
                {!!data.proposedTasks.length && (
                  <section className={todayCss.suggestions}>
                    <h2>
                      {t(
                        `AI 建议 · ${data.proposedTasks.length}`,
                        `AI suggestions · ${data.proposedTasks.length}`,
                      )}
                    </h2>
                    {data.proposedTasks.map((task) => (
                      <div className={css.row} key={task.id}>
                        <span className={todayCss.grow}>{task.title}</span>
                        <button
                          type="button"
                          className={css.btn}
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await props.adoptTask(task.id);
                              const preferences = await props.loadPreferences();
                              const previous = preferences.todayAdoptions;
                              const next = {
                                workspace: data.root,
                                day: data.today,
                                ids: [
                                  ...(previous?.workspace === data.root && previous.day === data.today
                                    ? previous.ids
                                    : []),
                                  task.id,
                                ],
                              };
                              setAdoptedTasks(next);
                              await props.savePreferences({
                                locale: preferences.followSystem ? null : preferences.locale,
                                todayAdoptions: next,
                              });
                            })
                          }
                        >
                          {t("采纳", "Adopt")}
                        </button>
                        <button
                          type="button"
                          className={css.link}
                          disabled={busy}
                          onClick={() => void run(() => props.cancelTask(task.id))}
                        >
                          {t("不用了", "Not needed")}
                        </button>
                      </div>
                    ))}
                  </section>
                )}
              </div>
              <aside className={todayCss.right}>
                {capture}
                {!data.empty && (
                  <section className={todayCss.agenda}>
                    <Agenda
                      data={calendar}
                      open={() => openRecord("calendar")}
                      proposals={pendingProposals}
                      busy={busy}
                      decide={(id, decision) => void run(() => props.decideProposal(id, decision))}
                    />
                    {push &&
                      data.blocks
                        .filter((block) => ["error", "file"].includes(push.entries[block.id]?.status ?? ""))
                        .map((block) => (
                          <div className={css.row} key={block.id}>
                            <span>{block.title}</span>
                            <CalendarPushResult
                              id={block.id}
                              state={push}
                              retry={async (id) => {
                                setPush(
                                  await (push.enabled
                                    ? props.retryCalendarPush(id)
                                    : props.removeCalendarPush()),
                                );
                              }}
                            />
                          </div>
                        ))}
                  </section>
                )}
                {(data.inboxNotes > 0 ||
                  data.sync.mapNeedsReview > 0 ||
                  data.sync.mapPendingImports > 0 ||
                  data.sync.directionSuggestions > 0) && (
                  <section className={todayCss.review}>
                    <h2>{t("要你核对", "To review")}</h2>
                    {data.inboxNotes > 0 && (
                      <button type="button" className={css.link} onClick={() => openRecord("inbox")}>
                        {t(`${data.inboxNotes} 条原文需要核对`, `${data.inboxNotes} notes to review`)}
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
                        {t(
                          `足迹里有 ${data.sync.mapNeedsReview + data.sync.mapPendingImports} 段经历待确认`,
                          `${data.sync.mapNeedsReview + data.sync.mapPendingImports} footprints to review`,
                        )}
                      </button>
                    )}
                    {data.sync.directionSuggestions > 0 && (
                      <button type="button" className={css.link} onClick={() => openSection("directions")}>
                        {t(
                          `${data.sync.directionSuggestions} 个方向建议`,
                          `${data.sync.directionSuggestions} direction suggestions`,
                        )}
                      </button>
                    )}
                  </section>
                )}
                {data.empty && (
                  <section className={todayCss.storage}>
                    <h2>{t("你的资料在哪", "Where your data lives")}</h2>
                    <p>
                      {data.drive
                        ? t(
                            "都存在你的云盘文件夹里，是普通文件，随时可以带走。",
                            "Ordinary files in your cloud folder, ready to take with you.",
                          )
                        : t(
                            "都存在这台电脑上你选的文件夹里，是普通文件，随时可以带走。",
                            "Ordinary files in your chosen local folder, ready to take with you.",
                          )}
                    </p>
                    <button type="button" className={css.link} onClick={() => startGuide(STORAGE_STEP)}>
                      {t("换个位置", "Change location")}
                    </button>
                  </section>
                )}
              </aside>
            </div>
            {!data.empty && (
              <details className={todayCss.secondary}>
                <summary>{t("你带来的规划", "Your plans")}</summary>
                {plansCard}
              </details>
            )}
          </>
        )}

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
            {!record && importSource && (
              <section className={css.sec} aria-label={t("导入已有导出文件", "Import an existing export")}>
                {importSource === "choose" ? (
                  <>
                    <p>{t("选择导出文件的来源", "Choose the export source")}</p>
                    <button type="button" className={css.btn} onClick={() => setImportSource("apple-health")}>
                      Apple Health
                    </button>
                    <button
                      type="button"
                      className={css.btn}
                      onClick={() => setImportSource("chatgpt-conversations")}
                    >
                      ChatGPT
                    </button>
                    <button type="button" className={css.link} onClick={() => setImportSource(null)}>
                      {t("取消", "Cancel")}
                    </button>
                  </>
                ) : (
                  <OnboardingFileImport
                    {...props}
                    key={importSource}
                    source={importSource}
                    onDone={async () => {
                      setImportSource(null);
                      setLibrary(await props.loadLibrary({}));
                      await refresh();
                    }}
                    onClose={() => setImportSource(null)}
                  />
                )}
              </section>
            )}
            {record === "inbox" && reviewMatter && onboarding && (
              <section className={css.sec} aria-label={t("核对这条原文", "Review this original")}>
                <button
                  type="button"
                  className={css.link}
                  disabled={busy}
                  onClick={() => setReviewMatter(null)}
                >
                  {t("回到收件箱", "Back to inbox")}
                </button>
                <OnboardingMatter
                  {...props}
                  key={reviewMatter.source}
                  initial={reviewMatter}
                  content={onboarding.content.matter}
                  builtin={!!props.renderAsk}
                  onPrompt={prompt}
                  onBusy={setBusy}
                  onDone={async () => {
                    setReviewMatter(null);
                    await refresh();
                  }}
                />
              </section>
            )}
            {!record ? (
              <LibraryPage
                data={library}
                open={openRecord}
                overview={data}
                capture={async (text) => {
                  await props.capture(text);
                  const value = await props.loadLibrary({});
                  setLibrary(value);
                  await refresh();
                }}
                onAdd={(kind) => {
                  if (kind === "file") setImportSource("choose");
                  else if (kind === "category") setView("explore");
                  else {
                    setConnectionSection(kind === "organizer" ? "cloud-organizer" : "phone");
                    setChannelFocus(false);
                    setView("connections");
                  }
                }}
              />
            ) : record === "calendar" ? (
              <CalendarPage {...props} initialAdding={calendarAdding} />
            ) : record === "projects" ? (
              <>
                {plansCard}
                {renderTasks(true)}
                <ProjectsLibrary {...child} timeZone={data?.timeZone} />
              </>
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
              reviewMatter ? null : (
                <InboxPage
                  overview={data}
                  review={{
                    readOnboardingMatter: props.readOnboardingMatter,
                    adoptOnboardingMatter: async (...args) => {
                      const result = await props.adoptOnboardingMatter(...args);
                      await refresh();
                      return result;
                    },
                    keepOnboardingMatter: async (file) => {
                      const result = await props.keepOnboardingMatter(file);
                      await refresh();
                      return result;
                    },
                  }}
                  onReview={(file) => {
                    void props
                      .readOnboardingMatter(file)
                      .then(setReviewMatter)
                      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
                  }}
                  sources={data?.plans.sources}
                  openNext={(id, goalId) => {
                    setGuide(null);
                    setView("overview");
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
                    setConnectionSection("channels");
                    setView("settings");
                    setChannelFocus(true);
                  }}
                />
              )
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
                    .loadLibrary({})
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
          <div ref={askPanel} className={css.askPanel} hidden={view !== "ask"}>
            {props.renderAsk(
              promptDraft,
              configureRequest,
              configureBuiltin,
              () => setView("connections"),
              promptRequest,
              view === "ask",
              () => {
                setGuide(null);
                setView("overview");
              },
              openAskSettings,
            )}
          </div>
        )}
        {["profile", "connections", "settings"].includes(view) && (
          <PersonalPages
            {...child}
            view={view as "profile" | "connections" | "settings"}
            navigate={setView}
            restartGuide={() => startGuide()}
            onImportMemory={() => startGuide(5)}
            refreshWorkspace={refresh}
            onWorkspaceCreated={async () => {
              await props.chooseOnboarding({ storage: true });
              await refresh();
              startGuide();
            }}
            channelSettings={props.channelSettings}
            section={connectionSection}
            selectSection={(section) => {
              setConnectionSection(section);
              setView("settings");
            }}
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
