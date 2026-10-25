import type { CalendarPushSettings, OnboardingMatter as Matter, OnboardingStatus } from "@kaitu/core";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { CalendarData, InboxEntry, LibraryData, MeData, OverviewData } from "../types.js";
import { KaituMark } from "./Brand.js";
import { Agenda, CalendarPage, type CalendarPageProps } from "./CalendarPage.js";
import { CalendarPushResult, CalendarSlotForm } from "./CalendarPush.js";
import type { ChannelRequest } from "./ChannelSettings.js";
import { DirectionMap } from "./DirectionMap.js";
import { DirectionsPage, type DirectionsPageProps } from "./DirectionsPage.js";
import type { DoingPageProps } from "./DoingPage.js";
import { ExploreModulesPage, ExploreNavigation } from "./ExploreNavigation.js";
import { ExplorePluginFrame } from "./ExplorePluginFrame.js";
import { FeatureUpdates } from "./FeatureUpdates.js";
import { FinancePage, type FinancePageProps } from "./FinancePage.js";
import { HandoverPanel } from "./Handover.js";
import { HealthPage, type HealthPageProps } from "./HealthPage.js";
import { JobsPage, type JobsPageProps } from "./JobsPage.js";
import { type LearningDraft, type LearningSource, emptyLearningDraft } from "./LearningPage.js";
import { LibraryFileImport } from "./LibraryFileImport.js";
import { InboxPage, LibraryPage, type LibraryProps, NotesPage } from "./LibraryPage.js";
import { HealthLibrary, ProjectsLibrary } from "./LibrarySummaries.js";
import { MapPage, type MapPageProps } from "./MapPage.js";
import type { MePageProps } from "./MePage.js";
import { NavigationIcon, SettingsIcon } from "./NavigationIcon.js";
import { NewsPage, type NewsPageProps } from "./NewsPage.js";
import { OnboardingMatter, OnboardingNextCard } from "./OnboardingMatter.js";
import { OnboardingPage, STORAGE_STEP } from "./OnboardingPage.js";
import { PersonalPages, type PersonalServices } from "./PersonalPages.js";
import { PlansCard } from "./Plans.js";
import { Plugins } from "./Plugins.js";
import { ProgressMap } from "./ProgressMap.js";
import css from "./Prototype.module.css";
import { LifeHome, TodayTasks } from "./TodayPage.js";
import todayCss from "./TodayPage.module.css";
import { TodayWeather } from "./Weather.js";
import {
  type ExploreModule,
  defaultExploreEntries,
  exploreDestination,
  exploreModules,
} from "./explore-modules.js";
import { type Locale, LocaleContext, browserLocale, dateFormat } from "./i18n.js";
import type { OnboardingServices } from "./onboarding-services.js";
import { type PanelNavigation, type View, usePanelNavigation } from "./panel-navigation.js";

export interface OverviewPageProps
  extends Omit<MePageProps, "onImportMemory">,
    PersonalServices,
    JobsPageProps,
    OnboardingServices,
    Omit<NewsPageProps, "onPrompt" | "onLearn">,
    Omit<DoingPageProps, "onPrompt">,
    Omit<DirectionsPageProps, "onPrompt" | "goals" | "onConnect">,
    Omit<MapPageProps, "onPrompt">,
    Omit<HealthPageProps, "onPrompt" | "selectedTab" | "onSelectTab">,
    Omit<FinancePageProps, "onPrompt" | "today" | "timeZone">,
    CalendarPageProps,
    LibraryProps {
  /** 方向页「我在推进什么」：开图 App 提供；宿主没有时仍显示原来的进度图。 */
  loadDirectionMap?: (locale: Locale) => Promise<import("@kaitu/core").DirectionMapState>;
  generateDirectionMap?: (locale: Locale) => Promise<import("@kaitu/core").DirectionMapState>;
  dismissDirectionLink?: (goal: string, project: string) => Promise<import("@kaitu/core").DirectionMapState>;
  /** 今天页天气：读本机缓存、设城市；宿主没提供时不显示天气。 */
  loadWeather?: () => Promise<import("@kaitu/core").WeatherState>;
  setWeatherPlace?: (
    name: string,
    latitude?: number,
    longitude?: number,
    source?: "manual" | "footprints",
  ) => Promise<import("@kaitu/core").WeatherState>;
  initialChatDraft?: string;
  hosted?: boolean;
  navigation?: PanelNavigation;
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
  const [pluginModules, setPluginModules] = useState<ExploreModule[]>([]);
  const [preferencesFailed, setPreferencesFailed] = useState(false);
  const [preferencesAttempt, setPreferencesAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Explicit retry starts a fresh read and cancels the previous effect.
  useEffect(() => {
    let active = true;
    // 自动语言不写入偏好，只有用户明确选定的语言才固定下来。
    const load = async () => {
      const modules = props.plugins
        ? ((await props.plugins("explore").catch(() => [])) as ExploreModule[])
        : [];
      if (!active) return null;
      setPluginModules(modules);
      const value = await props.loadPreferences(browserLocale());
      const fresh = modules.filter(({ id }) => !value.explorePlugins?.includes(id)).map(({ id }) => id);
      if (!fresh.length || !active) return value;
      const saved = await props.savePreferences({
        locale: value.followSystem ? null : value.locale,
        exploreEntries: [...(value.exploreEntries ?? defaultExploreEntries), ...fresh],
        explorePlugins: [...(value.explorePlugins ?? []), ...fresh],
      });
      return { ...saved, followSystem: value.followSystem };
    };
    void load()
      .then((value) => {
        if (!active || !value) return;
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
    function retry() {
      setPreferencesAttempt((attempt) => attempt + 1);
    }
    window.addEventListener("kaitu:plugins-changed", retry);
    return () => {
      active = false;
      window.removeEventListener("kaitu:plugins-changed", retry);
    };
  }, [props.loadPreferences, props.plugins, preferencesAttempt]);
  return (
    <LocaleContext.Provider value={locale ?? "zh-CN"}>
      <Overview
        {...props}
        pluginModules={pluginModules}
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
  pluginModules,
  locale,
  setLocale,
  followSystem,
  setFollowSystem,
  exploreEntries,
  setExploreEntries,
  retryPreferences,
  ...props
}: OverviewPageProps & {
  pluginModules: ExploreModule[];
  locale: Locale | null;
  setLocale: (locale: Locale) => void;
  followSystem: boolean;
  setFollowSystem: (value: boolean) => void;
  exploreEntries: string[] | null;
  setExploreEntries: (value: string[]) => void;
  retryPreferences?: () => void;
}) {
  const t = (zh: string, en: string) => (locale === "en" ? en : zh);
  const builtinAi = !!props.renderAsk && !props.hosted;
  const [onboarding, setOnboarding] = useState<OnboardingStatus | null>(null);
  const [guide, setGuide] = useState<number | null>();
  const [guideKey, setGuideKey] = useState(0);
  const [guideSource, setGuideSource] = useState<string>();
  const [guideText, setGuideText] = useState("");
  const [adoptedTasks, setAdoptedTasks] = useState<{ day: string; ids: string[] }>({ day: "", ids: [] });
  const [calendarAdding, setCalendarAdding] = useState(false);
  const [financeImporting, setFinanceImporting] = useState(false);
  const [channelFocus, setChannelFocus] = useState(false);
  const [importFile, setImportFile] = useState<File | null>();
  const [importAttempt, setImportAttempt] = useState(0);
  const openFileImport = (file: File | null) => {
    setImportFile(file);
    setImportAttempt((value) => value + 1);
  };
  const [reviewMatter, setReviewMatter] = useState<Matter | null>(null);
  const askPanel = useRef<HTMLDivElement>(null);
  const [aiKeyRequest, setAiKeyRequest] = useState(0);
  const guideVisible = guide !== undefined && guide !== null;
  const {
    view,
    setView,
    record,
    setRecord,
    explore,
    setExplore,
    healthTab,
    setHealthTab,
    connectionSection,
    setConnectionSection,
  } = usePanelNavigation(props.navigation, !!props.initialChatDraft);
  const [openedPlugins, setOpenedPlugins] = useState<string[]>([]);
  const pluginRemoved = useCallback(
    (id: string) => {
      setExplore((current) => (current === id ? "footprints" : current));
      setOpenedPlugins((current) => current.filter((opened) => opened !== id));
      window.dispatchEvent(new Event("kaitu:plugins-changed"));
    },
    [setExplore],
  );
  useEffect(() => {
    setOpenedPlugins((current) => {
      const installed = current.filter((id) => pluginModules.some((entry) => entry.id === id));
      return view === "explore" &&
        pluginModules.some((entry) => entry.id === explore) &&
        !installed.includes(explore)
        ? [...installed, explore]
        : installed;
    });
  }, [view, explore, pluginModules]);
  const availableModules = [...exploreModules, ...pluginModules];
  const firstExplore =
    exploreEntries?.find((id) => availableModules.some((entry) => entry.id === id)) ?? "modules";
  useEffect(() => {
    if (exploreEntries)
      setExplore((current) =>
        current.startsWith("plugin:") && !pluginModules.some((entry) => entry.id === current)
          ? "footprints"
          : current === "modules" || current === "loading" || exploreEntries.includes(current)
            ? current
            : firstExplore,
      );
  }, [exploreEntries, firstExplore, pluginModules, setExplore]);
  const [data, setData] = useState<OverviewData | null>(null);
  const workspaceRoot = data?.root;
  const [exploreFacts, setExploreFacts] = useState<{
    root: string;
    hometown?: boolean;
    experiences?: number;
    newsTopics?: number;
    directions?: number;
  } | null>(null);
  const [exploreError, setExploreError] = useState("");
  const [exploreAttempt, setExploreAttempt] = useState(0);
  const planning = useRef<HTMLDivElement>(null);
  // Read only on entering Explore or an explicit retry, never on unrelated workspace notifications.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Explicit retry refreshes failed projections.
  useEffect(() => {
    let active = true;
    setExploreFacts(null);
    setExploreError("");
    if (!workspaceRoot || view !== "explore") return;
    void Promise.allSettled([props.loadLifeMap(), props.loadNews(), props.loadExploration()]).then(
      ([map, news, directions]) => {
        if (!active) return;
        setExploreFacts({
          root: workspaceRoot,
          ...(map.status === "fulfilled"
            ? {
                hometown: !!map.value.hometown && map.value.hometown.status !== "missing",
                experiences: map.value.experiences.length,
              }
            : {}),
          ...(news.status === "fulfilled" ? { newsTopics: news.value.keywords?.length ?? 0 } : {}),
          ...(directions.status === "fulfilled" ? { directions: directions.value.directions.length } : {}),
        });
        setExploreError(
          [map, news, directions]
            .filter((result) => result.status === "rejected")
            .map((result) => String(result.reason))
            .join(" · "),
        );
      },
    );
    return () => {
      active = false;
    };
  }, [view, workspaceRoot, props.loadLifeMap, props.loadNews, props.loadExploration, exploreAttempt]);
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
  // Navigation owns unsaved input; no files, query results or whole pages are retained.
  const [libraryQueries, setLibraryQueries] = useState<Record<string, string>>({});
  const [learningTopics, setLearningTopics] = useState<Record<string, string>>({});
  const [learningDrafts, setLearningDrafts] = useState<Record<string, LearningDraft>>({});
  const learningSaves = useRef(new Map<string, ReturnType<LibraryProps["saveLearning"]>>());
  const learningTopic = learningTopics[workspaceRoot ?? ""] ?? "";
  const draftKey = JSON.stringify([workspaceRoot, learningTopic]);
  const setLearningTopic = (topic: string) => {
    if (workspaceRoot) setLearningTopics((current) => ({ ...current, [workspaceRoot]: topic }));
  };
  const updateLearningDraft = (key: string, draft: LearningDraft | null) => {
    setLearningDrafts((current) => {
      const next = { ...current };
      if (draft) next[key] = draft;
      else delete next[key];
      return next;
    });
  };
  const loadLearning = useCallback(
    async (topic: string) => {
      // Reopening during a save waits for that write, then reads its actual result.
      await learningSaves.current.get(JSON.stringify([workspaceRoot, topic]))?.catch(() => {});
      return props.loadLearning(topic);
    },
    [workspaceRoot, props.loadLearning],
  );
  const saveLearning: LibraryProps["saveLearning"] = (input) => {
    const key = JSON.stringify([workspaceRoot, input.topic]);
    const pending = learningSaves.current.get(key);
    if (pending) return pending;
    setLearningDrafts((current) => ({
      ...current,
      [key]: { ...(current[key] ?? emptyLearningDraft), saving: true },
    }));
    const saving = Promise.resolve()
      .then(() => props.saveLearning(input))
      .then((value) => {
        setLearningDrafts((current) => {
          if (current[key]?.operationId !== input.operationId) return current;
          const next = { ...current };
          delete next[key];
          return next;
        });
        return value;
      })
      .finally(() => {
        learningSaves.current.delete(key);
        setLearningDrafts((current) =>
          current[key] ? { ...current, [key]: { ...current[key], saving: false } } : current,
        );
      });
    learningSaves.current.set(key, saving);
    return saving;
  };
  const [learningSource, setLearningSource] = useState<LearningSource>();
  const [libraryEntry, setLibraryEntry] = useState<InboxEntry>();
  const [libraryFile, setLibraryFile] = useState<string>();
  const [libraryGoal, setLibraryGoal] = useState<string>();
  const [projectFocus, setProjectFocus] = useState<string>();
  useEffect(() => {
    if (view !== "records" || record !== "projects" || !libraryGoal) return;
    const target = document.getElementById(`plan-${libraryGoal}`);
    if (!target) return;
    const details = target.closest("details");
    if (details) details.open = true;
    target.tabIndex = -1;
    target.focus();
    target.scrollIntoView({ block: "center" });
  }, [view, record, libraryGoal]);
  const [libraryState, setLibraryState] = useState<{ root: string | undefined; data: LibraryData } | null>(
    null,
  );
  const library = libraryState?.root === workspaceRoot ? (libraryState?.data ?? null) : null;
  const currentWorkspace = useRef(workspaceRoot);
  currentWorkspace.current = workspaceRoot;
  const setLibrary = useCallback(
    (value: LibraryData) => {
      if (currentWorkspace.current === workspaceRoot) setLibraryState({ root: workspaceRoot, data: value });
    },
    [workspaceRoot],
  );
  useEffect(() => {
    if (!workspaceRoot) return;
    setLearningSource(undefined);
    setLibraryFile(undefined);
    setLibraryEntry(undefined);
  }, [workspaceRoot]);
  const [personal, setPersonal] = useState<MeData | null>(null);
  const exploreContent =
    data &&
    personal &&
    exploreFacts &&
    exploreFacts.root === workspaceRoot &&
    exploreFacts.hometown !== undefined &&
    exploreFacts.experiences !== undefined &&
    exploreFacts.newsTopics !== undefined &&
    exploreFacts.directions !== undefined
      ? {
          ...exploreFacts,
          hometown: exploreFacts.hometown,
          experiences: exploreFacts.experiences,
          newsTopics: exploreFacts.newsTopics,
          directions: exploreFacts.directions,
          healthRecords: data.sections.find((section) => section.id === "health")?.count ?? 0,
          goals: personal.goals.length,
        }
      : null;
  const exploreEmpty =
    !!exploreContent &&
    !exploreContent.hometown &&
    exploreContent.experiences +
      exploreContent.healthRecords +
      exploreContent.newsTopics +
      exploreContent.goals +
      exploreContent.directions ===
      0;
  const exploreStart =
    exploreContent && exploreEntries
      ? exploreDestination(
          exploreEntries,
          exploreContent,
          availableModules.map(({ id }) => id),
        )
      : exploreError
        ? firstExplore
        : null;
  useEffect(() => {
    if (exploreStart) setExplore((current) => (current === "loading" ? exploreStart : current));
  }, [exploreStart, setExplore]);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [captureOpen, setCaptureOpen] = useState(false);
  const [handoverOpen, setHandoverOpen] = useState(false);
  useEffect(() => {
    if (handoverOpen) {
      const panel = document.getElementById("home-handover");
      panel?.focus();
      panel?.scrollIntoView({ block: "start" });
    }
  }, [handoverOpen]);
  useEffect(() => {
    if (captureOpen && view === "overview") document.getElementById("capture-text")?.focus();
  }, [captureOpen, view]);
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
    if (view !== "records" || !workspaceRoot) return;
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
  }, [view, record, workspaceRoot, props.loadLibrary, props.subscribe, setLibrary]);
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
  }, [props.hosted, props.renderAsk, setConnectionSection, setView]);
  const run = async (operation: () => Promise<unknown>) => {
    if (writing.current) return;
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
    setLibraryEntry(undefined);
    setLibraryFile(undefined);
    setLibraryGoal(undefined);
    setProjectFocus(undefined);
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
              ? (exploreStart ?? "loading")
              : "health",
      );
      setView("explore");
    } else openRecord(["learning", "decisions"].includes(id) ? "notes" : id);
  };
  const manageAi = (builtin = false) => {
    if (props.hosted) {
      setView("ask");
      return;
    }
    if (props.renderAsk) {
      setConfigureBuiltin(builtin);
      setConfigureRequest((n) => n + 1);
      setView("ask");
    } else setView("connections");
  };
  const openAskSettings = (section: "ai" | "local-ai") => {
    setConnectionSection(section);
    if (section === "ai") setAiKeyRequest((n) => n + 1);
    setView("settings");
  };
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
  const closeCapture = () => {
    setCaptureOpen(false);
    requestAnimationFrame(() => document.getElementById("life-capture-start")?.focus());
  };
  const capture = (
    <section
      className={todayCss.capture}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) {
          event.preventDefault();
          closeCapture();
        }
      }}
    >
      <h2>{t("随手记", "Quick note")}</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.trim() || writing.current) return;
          void run(async () => {
            await props.capture(draft.trim());
            setDraft("");
            setReceipt(
              data?.sync.organizer
                ? t("已收到，会在每日整理时处理", "Received; the daily organizer will process it")
                : t("已保存原文，可在资料里回看", "Original saved. You can find it in Library"),
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
        <button
          type="submit"
          className={`${css.btn} ${captureOpen ? css["btn-strong"] : ""}`}
          disabled={busy || !draft.trim()}
        >
          {busy ? t("正在保存…", "Saving…") : t("记下", "Add note")}
        </button>
        {captureOpen && (
          <button type="button" className={css.link} disabled={busy} onClick={closeCapture}>
            {t("收起，保留草稿", "Close, keep draft")}
          </button>
        )}
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
  const selectedExplore = availableModules.find((entry) => entry.id === explore);
  const explorePages: Record<ExploreModule["id"], ReactNode> = {
    health: (
      <HealthPage
        {...child}
        {...(props.navigation ? { selectedTab: healthTab, onSelectTab: setHealthTab } : {})}
      />
    ),
    jobs: <JobsPage {...child} />,
    footprints: <MapPage {...child} />,
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
      <DirectionsPage
        {...child}
        goals={personal?.goals}
        onConnect={() => openAskSettings("ai")}
        planningContent={
          <>
            <div ref={planning} id="direction-plans" tabIndex={-1}>
              {plansCard}
            </div>
            {props.loadDirectionMap && props.generateDirectionMap && props.dismissDirectionLink ? (
              <DirectionMap
                load={props.loadDirectionMap}
                generate={props.generateDirectionMap}
                dismiss={props.dismissDirectionLink}
                onConnect={() => openAskSettings("ai")}
                openProject={(slug) => {
                  openRecord("projects");
                  setProjectFocus(slug);
                }}
              />
            ) : (
              <ProgressMap
                plans={data?.plans}
                projects={data?.projects ?? []}
                loadExploration={props.loadExploration}
                subscribe={props.subscribe}
                open={(section) => {
                  if (section === "projects") openRecord("projects");
                  else if (section === "plans") {
                    planning.current?.scrollIntoView({ block: "start" });
                    planning.current?.focus({ preventScroll: true });
                  } else setExplore("directions");
                }}
              />
            )}
            {!data?.plans.goals.length && (
              <button type="button" className={css.btn} onClick={() => startMatter("")}>
                {t("写下想做成的事", "Write down a goal")}
              </button>
            )}
          </>
        }
      />
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
            ...(props.renderAsk ? [["ask", t("问问", "Ask")]] : []),
          ].map(([id, label]) => (
            <button
              type="button"
              key={id}
              title={
                id === "overview"
                  ? t(
                      "看看最近的自己，挑一件此刻想做的事",
                      "See how you have been and pick one thing for now",
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
                if (id === "explore") setExplore(exploreStart ?? "loading");
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
              builtin={builtinAi}
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
            <LifeHome
              data={data}
              firstVisit={data.empty && !onboarding?.hasUserData}
              writing={captureOpen}
              capture={capture}
              start={() => setCaptureOpen(true)}
              library={() => openRecord(data.notes.length ? "inbox" : "")}
              addNext={() => (data.plans.goals.length ? openRecord("projects") : startMatter(""))}
              busy={busy}
              loadProjects={props.loadProjects}
              openProject={(slug) => {
                openRecord("projects");
                setProjectFocus(slug);
              }}
              loadLibrary={props.loadLibrary}
              save={async (text) => {
                const saved = await props.capture(text);
                await refresh();
                return saved;
              }}
              complete={async (item) => {
                await props.completeNext(item.file, item.id);
                await refresh();
              }}
              source={(entry) => {
                openRecord("inbox");
                setLibraryEntry({
                  ...entry,
                  source: "me",
                  originalSource: entry.file,
                  date: data.today,
                  status: "raw",
                  destination: null,
                });
              }}
              adopt={(id) => void run(() => props.adoptTask(id))}
              dismiss={(id) => void run(() => props.cancelTask(id))}
              handover={() => setHandoverOpen(true)}
              memory={() => startGuide(5)}
            />
            {handoverOpen && (
              <section id="home-handover" tabIndex={-1} className={css.sec}>
                <button
                  type="button"
                  className={css.link}
                  onClick={() => {
                    setHandoverOpen(false);
                    requestAnimationFrame(() => document.getElementById("life-handover-start")?.focus());
                  }}
                >
                  {t("← 返回首页", "← Back to home")}
                </button>
                <HandoverPanel loadHandover={props.loadHandover} onAnswer={handoverAnswer} />
              </section>
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
            {!record && importFile !== undefined && (
              <LibraryFileImport
                key={importAttempt}
                {...props}
                initialFile={importFile ?? undefined}
                onDone={async () => {
                  setLibrary(await props.loadLibrary({}));
                  await refresh();
                  setImportFile(undefined);
                }}
                onClose={() => setImportFile(undefined)}
              />
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
                  builtin={builtinAi}
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
                key={workspaceRoot}
                query={libraryQueries[workspaceRoot ?? ""] ?? ""}
                onQuery={(query) => {
                  if (workspaceRoot) setLibraryQueries((current) => ({ ...current, [workspaceRoot]: query }));
                }}
                searchLibraryNotes={props.searchLibraryNotes}
                data={library}
                open={openRecord}
                onOpenOriginal={(entry) => {
                  openRecord("inbox");
                  setLibraryEntry(entry);
                }}
                onOpenGoal={(id) => {
                  openRecord("projects");
                  setLibraryGoal(id);
                }}
                onOpenNote={(file) => {
                  openRecord("notes");
                  setLearningTopic(file.startsWith("learning/") ? (file.split("/")[1] ?? "") : "");
                  setLibraryFile(file.startsWith("learning/") ? undefined : file);
                }}
                overview={data}
                capture={async (text) => {
                  await props.capture(text);
                  const value = await props.loadLibrary({});
                  setLibrary(value);
                  await refresh();
                }}
                onFile={openFileImport}
                onAdd={(kind) => {
                  if (kind === "file") openFileImport(null);
                  else if (kind === "category") {
                    setExplore("modules");
                    setView("explore");
                  } else {
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
                <ProjectsLibrary {...child} timeZone={data?.timeZone} initialProject={projectFocus} />
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
                  loadMediaImage={props.loadMediaImage}
                  initialEntry={libraryEntry}
                  overview={data}
                  review={{
                    readOnboardingMatter: props.readOnboardingMatter,
                    adoptOnboardingMatter: async (...args) => {
                      const result = await props.adoptOnboardingMatter(...args);
                      setLibraryEntry(undefined);
                      await refresh();
                      return result;
                    },
                    keepOnboardingMatter: async (file) => {
                      const result = await props.keepOnboardingMatter(file);
                      setLibraryEntry(undefined);
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
                    if (goalId) openSection("directions");
                    else setView("overview");
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
                loadMediaImage={props.loadMediaImage}
                key={workspaceRoot}
                draft={learningDrafts[draftKey] ?? emptyLearningDraft}
                onDraft={(draft) => updateLearningDraft(draftKey, draft)}
                initialFile={libraryFile}
                data={library}
                loadLibraryDocument={props.loadLibraryDocument}
                loadLearning={loadLearning}
                startLearning={props.startLearning}
                saveLearning={saveLearning}
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
                modules={availableModules}
                entries={exploreEntries}
                current={explore}
                open={setExplore}
              />
            </section>
            <div className={css.child}>
              {explore === "modules" ? (
                <ExploreModulesPage
                  modules={availableModules}
                  entries={exploreEntries}
                  current={explore}
                  open={setExplore}
                  empty={exploreEmpty}
                  summaries={
                    exploreContent
                      ? {
                          footprints: t(
                            `${exploreContent.hometown ? "已有家乡 · " : ""}${exploreContent.experiences} 段经历`,
                            `${exploreContent.hometown ? "Hometown recorded · " : ""}${exploreContent.experiences} experiences`,
                          ),
                          health: t(
                            `${exploreContent.healthRecords} 条记录`,
                            `${exploreContent.healthRecords} records`,
                          ),
                          news: t(
                            `${exploreContent.newsTopics} 个关键词`,
                            `${exploreContent.newsTopics} keywords`,
                          ),
                          directions: t(
                            `${exploreContent.goals} 个目标 · ${exploreContent.directions} 个方向`,
                            `${exploreContent.goals} goals · ${exploreContent.directions} directions`,
                          ),
                        }
                      : {}
                  }
                  save={async (entries) => {
                    const saved = await props.savePreferences({
                      locale: followSystem ? null : locale,
                      exploreEntries: entries,
                    });
                    setExploreEntries(saved.exploreEntries ?? [...defaultExploreEntries]);
                  }}
                />
              ) : selectedExplore ? (
                (explorePages[selectedExplore.id] ?? null)
              ) : (
                <output>{t("正在读取模块…", "Loading modules…")}</output>
              )}
              {explore === "modules" && props.plugins && (
                <Plugins request={props.plugins} openLabel={props.pluginOpenLabel} />
              )}
              {exploreError && (
                <p role="alert">
                  {exploreError}{" "}
                  <button type="button" className={css.link} onClick={() => setExploreAttempt((n) => n + 1)}>
                    {t("重试读取", "Retry loading")}
                  </button>
                </p>
              )}
            </div>
          </>
        )}
        {pluginModules
          .filter((entry) => openedPlugins.includes(entry.id))
          .map((entry) => (
            <div key={entry.id} className={css.child} hidden={view !== "explore" || explore !== entry.id}>
              <ExplorePluginFrame
                id={entry.id}
                title={t(entry.title[0] ?? "", entry.title[1] ?? "")}
                plugins={props.plugins}
                onRemoved={pluginRemoved}
              />
            </div>
          ))}
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
            builtinAi={builtinAi}
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
            aiKeyRequest={aiKeyRequest}
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
