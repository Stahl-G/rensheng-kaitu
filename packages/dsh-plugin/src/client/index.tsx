import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-api-remotes/client";
import type { MainPanelId } from "@deepseek-ai/dsh-client-ui-layout/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-sidebar/client";
import type {} from "@deepseek-ai/dsh-client-ui-tool/client";
import type {
  AgentConnectionId,
  FileImportSource,
  LearningCheckinInput,
  OnboardingAi,
  OnboardingChoices,
  OnboardingMatterDraft,
  OnboardingPath,
  OnboardingSetupInput,
  OnboardingTarget,
  Preferences,
  StartLearningInput,
  SyncProvider,
} from "@kaitu/core";
import contribution from "../../lib/typert.remote-client.js";
import type {
  AutomationKey,
  FinanceRemoteCommitOptions,
  FinanceRemoteImportOptions,
  FinanceRemoteViewOptions,
  NewsFeedback,
} from "../types.js";
import { HiddenHeroMark, KaituMark, KaituName, PoweredByDsh } from "./Brand.js";
import { registerExplorePluginRoute } from "./ExplorePluginRoute.js";
import { AskChat, type PluginAskServices } from "./PluginAsk.js";
import { SessionPage } from "./SessionPage.js";
import { type KaituSessionServices, openKaituSession } from "./agent-prompt.js";
import { OpenmaicCard } from "./openmaic/OpenmaicCard.js";
import { WidgetCard } from "./openmaic/WidgetCard.js";

export const inject = ["slots", "remote", "layout"];
const panel = "kaitu-overview" as MainPanelId;

export async function apply(ctx: Context) {
  registerExplorePluginRoute(ctx);
  ctx.slots.inject("tool.call.toolview", () =>
    ctx.slots.register({ name: "tool.call.toolview", key: "kaitu_learning_card" }, OpenmaicCard),
  );
  ctx.slots.inject("tool.call.toolview", () =>
    ctx.slots.register({ name: "tool.call.toolview", key: "kaitu_learning_widget" }, WidgetCard),
  );
  const unmount = await ctx.remote.$mount(contribution);
  ctx.effect(() => unmount);
  ctx.plugin({
    inject: [
      "slots",
      "remote.kaitu",
      "remote.kaituFinance",
      "layout",
      "sessions",
      "conversation",
      "workspaces",
      "uiWorkspace",
    ],
    apply(ctx: Context) {
      let opening: Promise<boolean> | undefined;
      const open = (text?: string) => {
        if (opening) return opening;
        opening = (async () => {
          const result = await ctx.remote.kaitu.workspacePath();
          if (!result.ok) throw new Error(result.error.message);
          return openKaituSession(
            {
              workspaces: ctx.get("workspaces"),
              sessions: ctx.get("sessions"),
              uiWorkspace: ctx.get("uiWorkspace"),
              conversation: ctx.get("conversation"),
              layout: ctx.layout,
            } as KaituSessionServices,
            result.value,
            text,
          );
        })().finally(() => {
          opening = undefined;
        });
        return opening;
      };
      ctx.effect(() => {
        let checking = false;
        const check = async () => {
          if (checking || opening) return;
          checking = true;
          try {
            const draftId =
              new URLSearchParams(window.location.hash.slice(1)).get("kaitu-draft") ?? undefined;
            const draft = await ctx.remote.kaitu.aiDraft(draftId);
            if (draft.ok && draft.value && (await open(draft.value.text))) {
              await ctx.remote.kaitu.ackAiDraft(draft.value.id);
              if (draftId)
                window.history.replaceState(null, "", window.location.pathname + window.location.search);
            }
          } catch {
            /* Host 重新连接后继续读取尚未领取的草稿。 */
          } finally {
            checking = false;
          }
        };
        const timer = setInterval(() => void check(), 3000);
        void check();
        return () => clearInterval(timer);
      });
      // 问问在开图页里就地对话；服务对象只建一次，页面重绘不会重开会话。
      const askServices: PluginAskServices = {
        sessions: ctx.get("sessions") as PluginAskServices["sessions"],
        workspaces: ctx.get("workspaces") as PluginAskServices["workspaces"],
        conversation: ctx.get("conversation") as PluginAskServices["conversation"],
        workspacePath: async () => {
          const result = await ctx.remote.kaitu.workspacePath();
          if (!result.ok) throw new Error(result.error.message);
          return result.value;
        },
      };
      ctx.slots.inject("kaitu.ask.chat", () => ctx.slots.register({ name: "kaitu.ask.chat" }, AskChat));
      const loadVersion = async () => {
        const result = await ctx.remote.kaitu.dshVersion();
        if (!result.ok) throw new Error(result.error.message);
        return result.value;
      };
      // 只有开图 App 换品牌；装进 DSH 当插件时保留 DSH 自己的标志和名字。
      void ctx.remote.kaitu.brand().then((result) => {
        if (!result.ok || !result.value) return;
        ctx.slots.inject("sidebar.brand.mark", () =>
          ctx.slots.inject("sidebar.brand.name", function* () {
            yield ctx.slots.register({ name: "sidebar.brand.mark" }, KaituMark);
            yield ctx.slots.register({ name: "sidebar.brand.name" }, KaituName);
          }),
        );
        ctx.slots.inject("conversation.hero.brand.mark", () =>
          ctx.slots.register({ name: "conversation.hero.brand.mark" }, HiddenHeroMark),
        );
        ctx.slots.inject("sidebar.footer.action", () =>
          ctx.slots.register(
            { name: "sidebar.footer.action", id: "kaitu-powered-by", inject: () => ({ load: loadVersion }) },
            PoweredByDsh,
          ),
        );
      });
      ctx.slots.inject("main", () =>
        ctx.slots.register(
          {
            name: "main",
            key: panel,
            children: { "kaitu.ask.chat": { kind: "single", scope: "session" } },
            inject: () => ({
              askServices,
              fileServices: {
                pickDirectory: () => ctx.get("uiWorkspace").pickDirectory(),
                findFiles: async (query: string) => {
                  const result = await ctx.remote.kaitu.findWorkspaceFiles(query);
                  if (!result.ok) throw new Error(result.error.message);
                  return result.value;
                },
                openPath: async (path: string, action: "open" | "reveal") => {
                  const result = await ctx.remote.kaitu.openWorkspacePath(path, action);
                  if (!result.ok) throw new Error(result.error.message);
                  return result.value;
                },
              },
              subscribe: (refresh: () => void) => {
                const update = () => {
                  if (document.visibilityState === "visible") refresh();
                };
                const timer = setInterval(update, 5000);
                document.addEventListener("visibilitychange", update);
                return () => {
                  clearInterval(timer);
                  document.removeEventListener("visibilitychange", update);
                };
              },
              load: async () => {
                const result = await ctx.remote.kaitu.overview();
                if (!result.ok) throw new Error(result.error.message);
                return result.value;
              },
              keepOnboardingMatter: async (source: string) => {
                const r = await ctx.remote.kaitu.onboardingMatterKeep(source);
                if (!r.ok) throw new Error(r.error.message);
                return r.value;
              },
              saveOnboardingMatter: async (text: string) => {
                const r = await ctx.remote.kaitu.onboardingMatterSave(text);
                if (!r.ok) throw new Error(r.error.message);
                return r.value;
              },
              readOnboardingMatter: async (source: string) => {
                const r = await ctx.remote.kaitu.onboardingMatterRead(source);
                if (!r.ok) throw new Error(r.error.message);
                return r.value;
              },
              organizeOnboardingMatter: async (source: string) => {
                const r = await ctx.remote.kaitu.onboardingMatterOrganize(source);
                if (!r.ok) throw new Error(r.error.message);
                return r.value;
              },
              promptOnboardingMatter: async (source: string, locale?: string) => {
                const r = await ctx.remote.kaitu.onboardingMatterPrompt(source, locale);
                if (!r.ok) throw new Error(r.error.message);
                return r.value;
              },
              pasteOnboardingMatter: async (source: string, answer: string, locale?: string) => {
                const r = await ctx.remote.kaitu.onboardingMatterPaste(source, answer, locale);
                if (!r.ok) throw new Error(r.error.message);
                return r.value;
              },
              addGoalNext: async (goalId: string, title: string) => {
                const r = await ctx.remote.kaitu.goalNextAdd(goalId, title);
                if (!r.ok) throw new Error(r.error.message);
                return r.value;
              },
              loadHandover: async (locale?: string, includeFinance?: boolean) => {
                const r = await ctx.remote.kaitu.handoverPack(locale, includeFinance);
                if (!r.ok) throw new Error(r.error.message);
                return r.value;
              },
              configureFinanceAccess: async (id: AgentConnectionId, allowed: boolean) => {
                const r = await ctx.remote.kaitu.setFinanceAccess(id, allowed);
                if (!r.ok) throw new Error(r.error.message);
                return r.value;
              },
              loadPreferences: async (hint?: string) => {
                const r = await ctx.remote.kaitu.preferences(hint);
                if (!r.ok) throw new Error(r.error.message);
                return r.value;
              },
              savePreferences: async (input: Preferences) => {
                const r = await ctx.remote.kaitu.savePreferences(input);
                if (!r.ok) throw new Error(r.error.message);
                return r.value;
              },
              directionsPrompt: async (locale?: string) => {
                const r = await ctx.remote.kaitu.directionsPrompt(locale);
                if (!r.ok) throw new Error(r.error.message);
                return r.value;
              },
              pasteDirections: async (answer: string, locale?: string) => {
                const r = await ctx.remote.kaitu.directionsPaste(answer, locale);
                if (!r.ok) throw new Error(r.error.message);
                return r.value;
              },
              adoptOnboardingMatter: async (
                source: string,
                draft: OnboardingMatterDraft,
                path: OnboardingPath | null = null,
              ) => {
                const r = await ctx.remote.kaitu.onboardingMatterAdopt(source, draft, path);
                if (!r.ok) throw new Error(r.error.message);
                return r.value;
              },
              changeOnboardingNext: async (id: string, rev: number, action: string, value: string) => {
                const r = await ctx.remote.kaitu.onboardingNextChange(id, rev, action, value);
                if (!r.ok) throw new Error(r.error.message);
                return r.value;
              },
              loadOnboarding: async (locale?: string) => {
                const r = await ctx.remote.kaitu.onboarding(locale);
                if (!r.ok) throw new Error(r.error.message);
                return r.value;
              },
              chooseOnboarding: async (choices: OnboardingChoices) => {
                const r = await ctx.remote.kaitu.onboardingChoose(choices);
                if (!r.ok) throw new Error(r.error.message);
                return r.value;
              },
              previewOnboardingMemory: async (text: string, ai: OnboardingAi, locale?: string) => {
                const r = await ctx.remote.kaitu.onboardingMemoryPreview(text, ai, locale);
                if (!r.ok) throw new Error(r.error.message);
                return r.value;
              },
              confirmOnboardingMemory: async (
                token: string,
                selected: string[],
                targets?: Record<string, OnboardingTarget>,
              ) => {
                const r = await ctx.remote.kaitu.onboardingMemoryConfirm(token, selected, targets);
                if (!r.ok) throw new Error(r.error.message);
                return r.value;
              },
              cancelOnboarding: async (token: string) => {
                const r = await ctx.remote.kaitu.onboardingCancel(token);
                if (!r.ok) throw new Error(r.error.message);
                return r.value;
              },
              previewOnboardingImport: async (source: FileImportSource, name: string, base64: string) => {
                const r = await ctx.remote.kaitu.onboardingImportPreview(source, name, base64);
                if (!r.ok) throw new Error(r.error.message);
                return r.value;
              },
              confirmOnboardingImport: async (token: string) => {
                const r = await ctx.remote.kaitu.onboardingImportConfirm(token);
                if (!r.ok) throw new Error(r.error.message);
                return r.value;
              },
              previewOnboardingSetup: async (input: OnboardingSetupInput) => {
                const r = await ctx.remote.kaitu.onboardingSetupPreview(input);
                if (!r.ok) throw new Error(r.error.message);
                return r.value;
              },
              confirmOnboardingSetup: async (token: string) => {
                const r = await ctx.remote.kaitu.onboardingSetupConfirm(token);
                if (!r.ok) throw new Error(r.error.message);
                return r.value;
              },
              loadCalendarPush: async () => {
                const r = await ctx.remote.kaitu.calendarPush();
                if (!r.ok) throw new Error(r.error.message);
                return r.value;
              },
              retryCalendarPush: async (id: string) => {
                const r = await ctx.remote.kaitu.retryCalendarPush(id);
                if (!r.ok) throw new Error(r.error.message);
                return r.value;
              },
              configureCalendarPush: async (enabled: boolean) => {
                const r = await ctx.remote.kaitu.configureCalendarPush(enabled);
                if (!r.ok) throw new Error(r.error.message);
                return r.value;
              },
              removeCalendarPush: async () => {
                const r = await ctx.remote.kaitu.removeCalendarPush();
                if (!r.ok) throw new Error(r.error.message);
                return r.value;
              },
              scheduleNext: async (file: string, id: string, start: string, end: string) => {
                const r = await ctx.remote.kaitu.scheduleNext(file, id, start, end);
                if (!r.ok) throw new Error(r.error.message);
                return r.value;
              },
              editCalendarBlock: async (id: string, start: string, end: string) => {
                const r = await ctx.remote.kaitu.editCalendarBlock(id, start, end);
                if (!r.ok) throw new Error(r.error.message);
                return r.value;
              },
              workspaceBackup: async (operation: string, input: Record<string, unknown> = {}) => {
                const r = await ctx.remote.kaitu.workspaceBackup(operation, JSON.stringify(input));
                if (!r.ok) throw new Error(r.error.message);
                return JSON.parse(r.value);
              },
              loadSettings: async () => {
                const r = await ctx.remote.kaitu.settings();
                if (!r.ok) throw new Error(r.error.message);
                return r.value;
              },
              organizerSeen: async () => {
                const r = await ctx.remote.kaitu.organizerSeen();
                if (!r.ok) throw new Error(r.error.message);
                return r.value;
              },
              configureAutomation: async (
                tasks: Partial<Record<AutomationKey, boolean>>,
                times?: Partial<Record<AutomationKey, string>>,
              ) => {
                const r = await ctx.remote.kaitu.configureAutomation(tasks, times);
                if (!r.ok) throw new Error(r.error.message);
                return r.value;
              },
              exportWorkspace: async () => {
                const r = await ctx.remote.kaitu.exportWorkspace();
                if (!r.ok) throw new Error(r.error.message);
                return r.value;
              },
              restoreVersion: async (oid: string) => {
                const r = await ctx.remote.kaitu.restoreVersion(oid);
                if (!r.ok) throw new Error(r.error.message);
                return r.value;
              },
              moveStorage: async (path: string, drive: boolean, provider?: SyncProvider) => {
                const r = await ctx.remote.kaitu.moveStorage(path, drive, provider);
                if (!r.ok) throw new Error(r.error.message);
                return r.value;
              },
              pickStorageFolder: () => ctx.get("uiWorkspace").pickDirectory(),
              loadCalendar: async () => {
                const r = await ctx.remote.kaitu.calendar();
                if (!r.ok) throw new Error(r.error.message);
                return r.value;
              },
              addCalendar: async (url: string, name: string) => {
                const r = await ctx.remote.kaitu.addCalendarSubscription(url, name);
                if (!r.ok) throw new Error(r.error.message);
                return r.value;
              },
              loadLearning: async (topic: string) => {
                const r = await ctx.remote.kaitu.learningRead(topic);
                if (!r.ok) throw new Error(r.error.message);
                return r.value;
              },
              startLearning: async (input: StartLearningInput) => {
                const r = await ctx.remote.kaitu.learningStart(input);
                if (!r.ok) throw new Error(r.error.message);
                return r.value;
              },
              saveLearning: async (input: LearningCheckinInput) => {
                const r = await ctx.remote.kaitu.learningSave(input);
                if (!r.ok) throw new Error(r.error.message);
                return r.value;
              },
              loadLibrary: async (query?: import("@kaitu/core").LibraryQuery) => {
                const r = await ctx.remote.kaitu.library(query);
                if (!r.ok) throw new Error(r.error.message);
                return r.value;
              },
              loadLibraryDocument: async (file: string) => {
                const r = await ctx.remote.kaitu.libraryDocument(file);
                if (!r.ok) throw new Error(r.error.message);
                return r.value;
              },
              adoptTask: async (id: string) => {
                const result = await ctx.remote.kaitu.adoptTask(id);
                if (!result.ok) throw new Error(result.error.message);
                return result.value;
              },
              searchLibraryNotes: async (query: string) => {
                const result = await ctx.remote.kaitu.searchLibraryNotes(query);
                if (!result.ok) throw new Error(result.error.message);
                return result.value;
              },
              cancelTask: async (id: string) => {
                const result = await ctx.remote.kaitu.cancelTask(id);
                if (!result.ok) throw new Error(result.error.message);
                return result.value;
              },
              completeNext: async (file: string, id: string) => {
                const r = await ctx.remote.kaitu.completeNext(file, id);
                if (!r.ok) throw new Error(r.error.message);
                return r.value;
              },
              decideProposal: async (id: string, decision: "confirmed" | "rejected") => {
                const result = await ctx.remote.kaitu.decideProposal(id, decision);
                if (!result.ok) throw new Error(result.error.message);
              },
              capture: async (text: string) => {
                const result = await ctx.remote.kaitu.capture(text);
                if (!result.ok) throw new Error(result.error.message);
                return result.value;
              },
              channelSettings: async (operation: string, input: Record<string, unknown> = {}) => {
                const result = await ctx.remote.kaitu.channelSettings(operation, JSON.stringify(input));
                if (!result.ok) throw new Error(result.error.message);
                return JSON.parse(result.value);
              },
              onAdvanced: () => ctx.layout.selectPanel("plugins" as MainPanelId),
              loadJobs: async () => {
                const result = await ctx.remote.kaitu.jobs();
                if (!result.ok) throw new Error(result.error.message);
                return result.value;
              },
              loadNews: async () => {
                const result = await ctx.remote.kaitu.news();
                if (!result.ok) throw new Error(result.error.message);
                return result.value;
              },
              saveNewsKeywords: async (keywords: string[]) => {
                const result = await ctx.remote.kaitu.saveNewsKeywords(keywords);
                if (!result.ok) throw new Error(result.error.message);
                return result.value;
              },
              feedbackNews: async (id: string, value: NewsFeedback | null) => {
                const r = await ctx.remote.kaitu.feedbackNews(id, value);
                if (!r.ok) throw new Error(r.error.message);
                return r.value;
              },
              tryNews: async (id: string) => {
                const result = await ctx.remote.kaitu.tryNews(id);
                if (!result.ok) throw new Error(result.error.message);
                return result.value;
              },
              dismissNews: async (id: string) => {
                const result = await ctx.remote.kaitu.dismissNews(id);
                if (!result.ok) throw new Error(result.error.message);
                return result.value;
              },
              loadFinanceOverview: async (options?: FinanceRemoteViewOptions) => {
                const result = await ctx.remote.kaituFinance.financeOverview(options);
                if (!result.ok) throw new Error(result.error.message);
                return result.value;
              },
              loadFinanceCashflow: async (from: string, to: string, options?: FinanceRemoteViewOptions) => {
                const result = await ctx.remote.kaituFinance.financeCashflow(from, to, options);
                if (!result.ok) throw new Error(result.error.message);
                return result.value;
              },
              loadFinanceInvestments: async (options?: FinanceRemoteViewOptions) => {
                const result = await ctx.remote.kaituFinance.financeInvestments(options);
                if (!result.ok) throw new Error(result.error.message);
                return result.value;
              },
              loadFinanceAccounts: async (options?: FinanceRemoteViewOptions) => {
                const result = await ctx.remote.kaituFinance.financeAccounts(options);
                if (!result.ok) throw new Error(result.error.message);
                return result.value;
              },
              previewFinanceImport: async (
                name: string,
                base64: string,
                options?: FinanceRemoteImportOptions,
              ) => {
                const result = await ctx.remote.kaituFinance.financeImportPreview(name, base64, options);
                if (!result.ok) throw new Error(result.error.message);
                return result.value;
              },
              commitFinanceImport: async (file: string, options: FinanceRemoteCommitOptions) => {
                const result = await ctx.remote.kaituFinance.financeImportCommit(file, options);
                if (!result.ok) throw new Error(result.error.message);
                return result.value;
              },
              discardFinanceImport: async (file: string) => {
                const result = await ctx.remote.kaituFinance.financeImportDiscard(file);
                if (!result.ok) throw new Error(result.error.message);
              },
              loadMe: async () => {
                const result = await ctx.remote.kaitu.me();
                if (!result.ok) throw new Error(result.error.message);
                return result.value;
              },
              archiveMemory: async (file: string, expected: import("./MePage.js").MemoryExpectation) => {
                const result = await ctx.remote.kaitu.archiveMemory(file, expected);
                if (!result.ok) throw new Error(result.error.message);
              },
              replaceMemory: async (
                file: string,
                candidate: import("../types.js").MeData["memoryReplacements"][number]["candidate"],
                expected: import("./MePage.js").MemoryExpectation,
              ) => {
                const result = await ctx.remote.kaitu.replaceMemory(file, candidate, expected);
                if (!result.ok) throw new Error(result.error.message);
              },
              loadExperienceSource: async (id: string) => {
                const result = await ctx.remote.kaitu.experienceSource(id);
                if (!result.ok) throw new Error(result.error.message);
                return result.value;
              },
              loadExploration: async () => {
                const result = await ctx.remote.kaitu.exploration();
                if (!result.ok) throw new Error(result.error.message);
                return result.value;
              },
              writeExploration: async (command: import("../types.js").ExplorationCommand) => {
                const result = await ctx.remote.kaitu.explorationWrite(command);
                if (!result.ok) throw new Error(result.error.message);
                return result.value;
              },
              loadExplorationSource: async (
                owner: "direction" | "direction_note" | "exploration_experiment",
                id: string,
                reference?: number,
              ) => {
                const result = await ctx.remote.kaitu.explorationSource(owner, id, reference);
                if (!result.ok) throw new Error(result.error.message);
                return result.value;
              },
              hometownCities: async (name: string) => {
                const result = await ctx.remote.kaitu.hometownCities(name);
                if (!result.ok) throw new Error(result.error.message);
                return result.value;
              },
              saveHometown: async (name: string, id: number) => {
                const result = await ctx.remote.kaitu.saveHometown(name, id);
                if (!result.ok) throw new Error(result.error.message);
                return result.value;
              },
              loadWeather: async () => {
                const result = await ctx.remote.kaitu.weather();
                if (!result.ok) throw new Error(result.error.message);
                return result.value;
              },
              setWeatherPlace: async (
                name: string,
                latitude?: number,
                longitude?: number,
                source?: "manual" | "footprints",
              ) => {
                const result = await ctx.remote.kaitu.weatherPlace(name, latitude, longitude, source);
                if (!result.ok) throw new Error(result.error.message);
                return result.value;
              },
              loadLifeMap: async () => {
                const result = await ctx.remote.kaitu.lifeMap();
                if (!result.ok) throw new Error(result.error.message);
                return result.value;
              },
              loadExperienceImports: async () => {
                const result = await ctx.remote.kaitu.experienceImports();
                if (!result.ok) throw new Error(result.error.message);
                return result.value;
              },
              previewExperienceBatch: async (id: string, operation: "confirm" | "undo" | "restore") => {
                const result = await ctx.remote.kaitu.experienceBatchPreview(id, operation);
                if (!result.ok) throw new Error(result.error.message);
                return result.value;
              },
              setExperienceSource: async (locator: string, excluded: boolean, revision: number) => {
                const result = await ctx.remote.kaitu.setExperienceSource(locator, excluded, revision);
                if (!result.ok) throw new Error(result.error.message);
              },
              changeExperienceBatch: async (
                id: string,
                operation: "confirm" | "undo" | "restore",
                revision: number,
              ) => {
                const result = await ctx.remote.kaitu.changeExperienceBatch(id, operation, revision);
                if (!result.ok) throw new Error(result.error.message);
                return result.value;
              },
              recoverExperienceImports: async () => {
                const result = await ctx.remote.kaitu.recoverExperienceImports();
                if (!result.ok) throw new Error(result.error.message);
                return result.value;
              },
              resolveExperience: async (id: string, geonameid: number) => {
                const result = await ctx.remote.kaitu.resolveExperience(id, geonameid);
                if (!result.ok) throw new Error(result.error.message);
                return result.value;
              },
              editExperience: async (
                id: string,
                changes: import("../types.js").ExperienceChanges,
                revision: number,
              ) => {
                const result = await ctx.remote.kaitu.editExperience(id, changes, revision);
                if (!result.ok) throw new Error(result.error.message);
              },
              hideExperience: async (id: string, revision: number) => {
                const result = await ctx.remote.kaitu.hideExperience(id, revision);
                if (!result.ok) throw new Error(result.error.message);
                return result.value;
              },
              unhideExperience: async (id: string, revision: number) => {
                const result = await ctx.remote.kaitu.unhideExperience(id, revision);
                if (!result.ok) throw new Error(result.error.message);
              },
              loadProject: async (slug: string) => {
                const result = await ctx.remote.kaitu.projectDetail(slug);
                if (!result.ok) throw new Error(result.error.message);
                return result.value;
              },
              createProject: async (title: string) => {
                const result = await ctx.remote.kaitu.projectCreate(title);
                if (!result.ok) throw new Error(result.error.message);
                return result.value;
              },
              bindProjectGithub: async (slug: string, repo: string) => {
                const result = await ctx.remote.kaitu.projectBindGithub(slug, repo);
                if (!result.ok) throw new Error(result.error.message);
                return result.value;
              },
              saveProjectGoal: async (slug: string, goal: import("@kaitu/core").ProjectGoal) => {
                const result = await ctx.remote.kaitu.projectGoalSave(slug, goal);
                if (!result.ok) throw new Error(result.error.message);
                return result.value;
              },
              projectMemoryPrompt: async (slug: string, locale: string) => {
                const result = await ctx.remote.kaitu.projectMemoryPrompt(slug, locale);
                if (!result.ok) throw new Error(result.error.message);
                return result.value;
              },
              projectArchitecturePrompt: async (slug: string, locale: string) => {
                const result = await ctx.remote.kaitu.projectArchitecturePrompt(slug, locale);
                if (!result.ok) throw new Error(result.error.message);
                return result.value;
              },
              loadProjectArchitecture: async (slug: string) => {
                const result = await ctx.remote.kaitu.projectArchitecture(slug);
                if (!result.ok) throw new Error(result.error.message);
                return result.value;
              },
              installProjectMemory: async (slug: string, directory: string) => {
                const result = await ctx.remote.kaitu.projectMemoryInstall(slug, directory);
                if (!result.ok) throw new Error(result.error.message);
                return result.value;
              },
              syncProject: async (slug: string) => {
                const result = await ctx.remote.kaitu.projectSync(slug);
                if (!result.ok) throw new Error(result.error.message);
              },
              loadProjects: async () => {
                const result = await ctx.remote.kaitu.projects();
                if (!result.ok) throw new Error(result.error.message);
                return result.value;
              },
              loadDoing: async () => {
                const result = await ctx.remote.kaitu.doing();
                if (!result.ok) throw new Error(result.error.message);
                return result.value;
              },
              loadHealth: async () => {
                const result = await ctx.remote.kaitu.health();
                if (!result.ok) throw new Error(result.error.message);
                return result.value;
              },
              loadHealthPhoto: async (id: string) => {
                const result = await ctx.remote.kaitu.healthPhoto(id);
                if (!result.ok) throw new Error(result.error.message);
                return result.value;
              },
              setAvatar: async (base64: string) => {
                const result = await ctx.remote.kaitu.setAvatar(base64);
                if (!result.ok) throw new Error(result.error.message);
                return result.value;
              },
              removeAvatar: async () => {
                const result = await ctx.remote.kaitu.removeAvatar();
                if (!result.ok) throw new Error(result.error.message);
              },
              onPrompt: async (text: string) => {
                await open(text);
              },
              onAgent: async () => {
                await open();
              },
            }),
          },
          SessionPage,
        ),
      );
      ctx.slots.inject("sidebar.panellist", () =>
        ctx.slots.register(
          {
            name: "sidebar.panellist",
            id: panel,
            order: 20,
            label: () => "开图",
          },
          KaituMark,
        ),
      );
    },
  });
}
