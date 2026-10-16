import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-api-remotes/client";
import type { MainPanelId } from "@deepseek-ai/dsh-client-ui-layout/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-sidebar/client";
import contribution from "../../lib/typert.remote-client.js";
import type {
  AutomationKey,
  FinanceRemoteCommitOptions,
  FinanceRemoteImportOptions,
  FinanceRemoteViewOptions,
  NewsFeedback,
} from "../types.js";
import { KaituMark, KaituName, PoweredByDsh } from "./Brand.js";
import { SessionPage } from "./SessionPage.js";
import { type KaituSessionServices, openKaituSession } from "./agent-prompt.js";

export const inject = ["slots", "remote", "layout"];
const panel = "kaitu-overview" as MainPanelId;

export async function apply(ctx: Context) {
  ctx.slots.inject("sidebar.brand.mark", () =>
    ctx.slots.inject("sidebar.brand.name", function* () {
      yield ctx.slots.register({ name: "sidebar.brand.mark" }, KaituMark);
      yield ctx.slots.register({ name: "sidebar.brand.name" }, KaituName);
    }),
  );
  ctx.slots.inject("conversation.hero.brand.mark", () =>
    ctx.slots.register({ name: "conversation.hero.brand.mark" }, KaituMark),
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
      const loadVersion = async () => {
        const result = await ctx.remote.kaitu.dshVersion();
        if (!result.ok) throw new Error(result.error.message);
        return result.value;
      };
      ctx.slots.inject("sidebar.footer.action", () =>
        ctx.slots.register(
          { name: "sidebar.footer.action", id: "kaitu-powered-by", inject: () => ({ load: loadVersion }) },
          PoweredByDsh,
        ),
      );
      ctx.slots.inject("main", () =>
        ctx.slots.register(
          {
            name: "main",
            key: panel,
            inject: () => ({
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
              loadSettings: async () => {
                const r = await ctx.remote.kaitu.settings();
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
              moveStorage: async (path: string, drive: boolean) => {
                const r = await ctx.remote.kaitu.moveStorage(path, drive);
                if (!r.ok) throw new Error(r.error.message);
                return r.value;
              },
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
              loadLibrary: async () => {
                const r = await ctx.remote.kaitu.library();
                if (!r.ok) throw new Error(r.error.message);
                return r.value;
              },
              loadLibraryDocument: async (file: string) => {
                const r = await ctx.remote.kaitu.libraryDocument(file);
                if (!r.ok) throw new Error(r.error.message);
                return r.value;
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
              onAdvanced: () => ctx.layout.selectPanel("plugins" as MainPanelId),
              loadNews: async () => {
                const result = await ctx.remote.kaitu.news();
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
              previewExperienceBatch: async (id: string, operation: "undo" | "restore") => {
                const result = await ctx.remote.kaitu.experienceBatchPreview(id, operation);
                if (!result.ok) throw new Error(result.error.message);
                return result.value;
              },
              setExperienceSource: async (locator: string, excluded: boolean, revision: number) => {
                const result = await ctx.remote.kaitu.setExperienceSource(locator, excluded, revision);
                if (!result.ok) throw new Error(result.error.message);
              },
              changeExperienceBatch: async (id: string, operation: "undo" | "restore", revision: number) => {
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
              onPrompt: (text: string) => open(text),
              onAgent: () => open(),
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
