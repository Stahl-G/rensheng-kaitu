import { rmSync } from "node:fs";
import type { Context } from "@deepseek-ai/cordis";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import type { CollectorService } from "@kaitu/channels/collectors";
import {
  type AutomationKey,
  type AutomationSettings,
  type CalendarData,
  KaituError,
  type LibraryData,
  type NewsFeedback,
  type SettingsData,
  Workspace,
  addCalendarSubscription,
  type ImportSource,
  KaituError,
  type OnboardingAi,
  type OnboardingChoiceResult,
  type OnboardingChoices,
  type OnboardingImportPreview,
  type OnboardingImportResult,
  type OnboardingMemoryPreview,
  type OnboardingMemoryResult,
  type OnboardingSetupInput,
  type OnboardingSetupPreview,
  type OnboardingSetupResult,
  type OnboardingStatus,
  Workspace,
  cancelOnboardingPreview,
  captureNote,
  changeExperienceBatch,
  completeNext,
  configureAutomation,
  confirmOnboardingImport,
  confirmOnboardingMemory,
  confirmOnboardingSetup,
  decideProposal,
  defaultRoot,
  dismissNews,
  editExperience,
  exportWorkspace,
  hideExperience,
  lifeMap,
  listProjects,
  moveWorkspace,
  onboardingStatus,
  previewExperienceBatch,
  previewOnboardingImport,
  previewOnboardingMemory,
  previewOnboardingSetup,
  readAutomation,
  readAvatar,
  readCalendar,
  readDoing,
  readExperienceImports,
  readExperienceSource,
  readExploration,
  readExplorationSource,
  readHealthPage,
  readLibrary,
  readLibraryDocument,
  readNews,
  readOverviewPage,
  readPhoto,
  readSettings,
  recoverExperienceImports,
  removeAvatar,
  resolveExperience,
  restore,
  saveAvatar,
  saveOnboardingChoices,
  setExperienceSource,
  setNewsFeedback,
  tryNews,
  unhideExperience,
  writeExploration,
} from "@kaitu/core";
import type { MutationQueue } from "./dsh.js";
import { readMe } from "./me-data.js";
import type { Config } from "./tools.js";
import type {
  DoingData,
  DoingProject,
  ExperienceBatchPreview,
  ExperienceChanges,
  ExperienceImportsData,
  ExperienceSource,
  ExplorationCommand,
  ExplorationData,
  HealthData,
  LifeMapData,
  MeData,
  NewsAction,
  NewsData,
  OverviewData,
} from "./types.js";

function recentLog(log: string, date: string | null) {
  const section = log
    .split(/^##[ \t]+/m)
    .slice(1)
    .find((part) => part.split(/\r?\n/)[0]?.trim() === date);
  const text = section
    ?.split(/\r?\n/)
    .slice(1)
    .map((line) =>
      line
        .replace(/<!--.*?-->/g, "")
        .replace(/^\s*[-*+]\s+/, "")
        .trim(),
    )
    .find(Boolean);
  return date && text ? { date, text } : null;
}

declare module "@deepseek-ai/cordis" {
  interface Context {
    kaitu: KaituOverviewService;
  }
}

/** 工作区页面数据、资讯与地点核对、本机头像。 */
export class KaituOverviewService extends TypertRemoteService {
  private readonly workspace: Workspace;

  constructor(
    ctx: Context,
    config: Config = {},
    workspace?: Workspace,
    private readonly write: MutationQueue = (run) => run(),
    private readonly collectors?: CollectorService,
  ) {
    super(ctx, "kaitu");
    this.workspace = workspace ?? new Workspace(config.workspace ?? defaultRoot());
  }

  @Remote("channelSettings")
  async channelSettings(operation: string, input: string): Promise<string> {
    if (!this.collectors) throw new Error("采集服务未启动");
    const parsed: unknown = JSON.parse(input);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("采集参数必须是对象");
    return JSON.stringify(await this.collectors.request(operation, parsed as Record<string, unknown>));
  }

  @Remote("onboarding")
  async onboarding(): Promise<OnboardingStatus> {
    return this.write(async () => onboardingStatus(this.workspace));
  }

  @Remote("onboardingMemoryPreview")
  async onboardingMemoryPreview(text: string, ai: OnboardingAi): Promise<OnboardingMemoryPreview> {
    return this.write(async () => previewOnboardingMemory(this.workspace, text, ai));
  }

  @Remote("onboardingMemoryConfirm")
  async onboardingMemoryConfirm(token: string, selected: string[]): Promise<OnboardingMemoryResult> {
    return this.write(() => confirmOnboardingMemory(this.workspace, token, selected));
  }

  @Remote("onboardingCancel")
  async onboardingCancel(token: string): Promise<void> {
    await this.write(async () => cancelOnboardingPreview(this.workspace, token));
  }

  @Remote("onboardingSetupPreview")
  async onboardingSetupPreview(input: OnboardingSetupInput): Promise<OnboardingSetupPreview> {
    return this.write(async () => previewOnboardingSetup(this.workspace, input));
  }

  @Remote("onboardingSetupConfirm")
  async onboardingSetupConfirm(token: string): Promise<OnboardingSetupResult> {
    return this.write(() => confirmOnboardingSetup(this.workspace, token));
  }

  @Remote("onboardingChoose")
  async onboardingChoose(choices: OnboardingChoices): Promise<OnboardingChoiceResult> {
    return this.write(() => saveOnboardingChoices(this.workspace, choices));
  }

  @Remote("onboardingImportPreview")
  async onboardingImportPreview(
    source: ImportSource,
    name: string,
    base64: string,
  ): Promise<OnboardingImportPreview> {
    if (
      typeof base64 !== "string" ||
      base64.length > 48 * 1024 * 1024 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)
    )
      throw new KaituError("文件过大或格式不合法", "BAD_ARGS");
    return this.write(() =>
      previewOnboardingImport(this.workspace, source, name, Buffer.from(base64, "base64")),
    );
  }

  @Remote("onboardingImportConfirm")
  async onboardingImportConfirm(token: string): Promise<OnboardingImportResult> {
    return this.write(() => confirmOnboardingImport(this.workspace, token));
  }

  /** Desktop passes its installed release version to the running Host (apps/desktop/src/main.ts). */
  @Remote("dshVersion")
  async dshVersion(): Promise<string | null> {
    return process.env.DSH_CLIENT_VERSION?.trim() || null;
  }

  @Remote("library")
  async library(): Promise<LibraryData> {
    return readLibrary(this.workspace);
  }

  @Remote("libraryDocument")
  async libraryDocument(file: string): Promise<string> {
    return readLibraryDocument(this.workspace, file);
  }

  @Remote("calendar")
  async calendar(): Promise<CalendarData> {
    return readCalendar(this.workspace);
  }

  @Remote("addCalendarSubscription")
  async addCalendarSubscription(url: string, name: string): Promise<CalendarData> {
    return this.write(() => addCalendarSubscription(this.workspace, url, name));
  }

  @Remote("completeNext")
  async completeNext(file: string, id: string): Promise<{ version: string | null }> {
    return this.write(() => completeNext(this.workspace, file, id));
  }

  @Remote("settings")
  async settings(): Promise<SettingsData> {
    return readSettings(this.workspace);
  }

  @Remote("exportWorkspace")
  async exportWorkspace(): Promise<{ name: string; base64: string }> {
    return exportWorkspace(this.workspace);
  }

  @Remote("restoreVersion")
  async restoreVersion(oid: string): Promise<{ oid: string | null; changed: number }> {
    return this.write(() => restore(this.workspace, oid));
  }

  @Remote("moveStorage")
  async moveStorage(path: string, drive: boolean): Promise<SettingsData["storage"]> {
    return this.write(() => moveWorkspace(this.workspace, path, drive));
  }

  @Remote("automation")
  async automation(): Promise<AutomationSettings> {
    return readAutomation(this.workspace);
  }

  @Remote("configureAutomation")
  async configureAutomation(
    tasks: Partial<Record<AutomationKey, boolean>>,
    times?: Partial<Record<AutomationKey, string>>,
  ): Promise<AutomationSettings> {
    return this.write(async () => configureAutomation(this.workspace, tasks, times));
  }

  @Remote("workspacePath")
  async workspacePath(): Promise<string> {
    return this.workspace.root;
  }

  @Remote("aiDraft")
  async aiDraft(id?: string): Promise<{ id: string; text: string } | null> {
    return this.write(async () => {
      const file = ".kaitu/cache/ai-draft.json";
      if (!this.workspace.exists(file)) return null;
      const draft = this.workspace.readJson<{ id?: string; text?: unknown }>(file);
      if (id ? draft.id !== id : !process.env.DSH_CLIENT_VERSION) return null;
      const value = draft.text;
      if (typeof draft.id !== "string" || typeof value !== "string" || value.length > 100000)
        throw new KaituError("会话草稿不合法", "BAD_ARGS");
      return { id: draft.id, text: value };
    });
  }

  @Remote("ackAiDraft")
  async ackAiDraft(id: string): Promise<void> {
    await this.write(async () => {
      const file = ".kaitu/cache/ai-draft.json";
      if (this.workspace.exists(file) && this.workspace.readJson<{ id?: string }>(file).id === id)
        rmSync(this.workspace.resolve(file, { internal: true }));
    });
  }

  @Remote("decideProposal")
  async decideProposal(id: string, decision: "confirmed" | "rejected"): Promise<{ version: string | null }> {
    return this.write(() => decideProposal(this.workspace, id, decision));
  }

  @Remote("capture")
  async capture(text: string): Promise<{ path: string; version: string | null }> {
    return this.write(() => captureNote(this.workspace, text));
  }

  @Remote("news")
  async news(): Promise<NewsData> {
    return readNews(this.workspace);
  }

  @Remote("feedbackNews")
  async feedbackNews(id: string, value: NewsFeedback | null): Promise<Record<string, NewsFeedback>> {
    return this.write(() => setNewsFeedback(this.workspace, id, value));
  }

  @Remote("tryNews")
  async tryNews(id: string): Promise<NewsAction> {
    const result = await this.write(() => tryNews(this.workspace, id));
    return { id: result.record.id, status: "tried", version: result.version };
  }

  @Remote("dismissNews")
  async dismissNews(id: string): Promise<NewsAction> {
    const result = await this.write(() => dismissNews(this.workspace, id));
    return { id: result.record.id, status: "dismissed", version: result.version };
  }

  @Remote("exploration")
  async exploration(): Promise<ExplorationData> {
    return readExploration(this.workspace);
  }
  @Remote("explorationWrite")
  async explorationWrite(command: ExplorationCommand): Promise<{ id: string; version: string | null }> {
    return this.write(async () => {
      const { id, version } = await writeExploration(this.workspace, command, "user");
      return { id, version };
    });
  }
  @Remote("explorationSource")
  async explorationSource(
    owner: "direction" | "direction_note" | "exploration_experiment",
    id: string,
    reference?: number,
  ): Promise<ExperienceSource> {
    return readExplorationSource(this.workspace, owner, id, reference);
  }

  @Remote("experienceSource")
  async experienceSource(id: string): Promise<ExperienceSource> {
    return readExperienceSource(this.workspace, id);
  }

  @Remote("lifeMap")
  async lifeMap(): Promise<LifeMapData> {
    return lifeMap(this.workspace);
  }

  @Remote("experienceImports")
  async experienceImports(): Promise<ExperienceImportsData> {
    return readExperienceImports(this.workspace);
  }
  @Remote("experienceBatchPreview")
  async experienceBatchPreview(id: string, operation: "undo" | "restore"): Promise<ExperienceBatchPreview> {
    return previewExperienceBatch(this.workspace, id, operation);
  }
  @Remote("setExperienceSource")
  async setExperienceSource(locator: string, excluded: boolean, revision: number): Promise<void> {
    await this.write(() => setExperienceSource(this.workspace, locator, excluded, revision));
  }
  @Remote("changeExperienceBatch")
  async changeExperienceBatch(
    id: string,
    operation: "undo" | "restore",
    revision: number,
  ): Promise<{ affected: number; preserved: number; version: string | null }> {
    return this.write(() => changeExperienceBatch(this.workspace, id, operation, revision));
  }
  @Remote("recoverExperienceImports")
  async recoverExperienceImports(): Promise<{ recovered: number }> {
    return this.write(async () => ({ recovered: (await recoverExperienceImports(this.workspace)).length }));
  }

  @Remote("resolveExperience")
  async resolveExperience(id: string, geonameid: number): Promise<{ id: string; version: string | null }> {
    const result = await this.write(() => resolveExperience(this.workspace, id, geonameid));
    return { id: result.record.id, version: result.version };
  }

  @Remote("editExperience")
  async editExperience(id: string, changes: ExperienceChanges, revision: number): Promise<void> {
    await this.write(() => editExperience(this.workspace, id, changes, revision));
  }

  @Remote("hideExperience")
  async hideExperience(id: string, revision: number): Promise<number> {
    const result = await this.write(() => hideExperience(this.workspace, id, revision));
    return result.record.rev as number;
  }

  @Remote("unhideExperience")
  async unhideExperience(id: string, revision: number): Promise<void> {
    await this.write(() => unhideExperience(this.workspace, id, revision));
  }

  @Remote("me")
  async me(): Promise<MeData> {
    return readMe(this.workspace);
  }

  @Remote("health")
  async health(): Promise<HealthData> {
    return readHealthPage(this.workspace);
  }

  @Remote("healthPhoto")
  async healthPhoto(id: string): Promise<string> {
    const photo = readPhoto(this.workspace, id);
    return `data:${photo.contentType};base64,${photo.bytes.toString("base64")}`;
  }

  @Remote("setAvatar")
  async setAvatar(base64: string): Promise<string | null> {
    if (
      base64.length > Math.ceil((2 * 1024 * 1024) / 3) * 4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)
    )
      throw new KaituError("头像数据不合法或超过 2MB", "INVALID_AVATAR");
    saveAvatar(this.workspace, Buffer.from(base64, "base64"));
    return readAvatar(this.workspace);
  }

  @Remote("removeAvatar")
  async removeAvatar(): Promise<void> {
    removeAvatar(this.workspace);
  }

  @Remote("projects")
  async projects(): Promise<DoingProject[]> {
    return listProjects(this.workspace).map(
      ({ slug, title, stage, kind, next, completion, github, links, log, lastLogDate, recent7 }) => ({
        slug,
        title,
        stage,
        kind,
        next,
        completion,
        links,
        recentLog: recentLog(log, lastLogDate),
        recent7: {
          words: recent7.words,
          commits: recent7.commitsRecorded ? recent7.commits : null,
          daily: recent7.daily,
        },
        github: github
          ? {
              repo: github.repo,
              url: github.url,
              stale: github.stale,
              problem: github.problem,
              ok_at: github.ok_at,
              since: github.since,
              history: github.history,
              latest: github.latest
                ? {
                    stars: github.latest.stars,
                    forks: github.latest.forks,
                    open_issues: github.latest.open_issues,
                    open_prs: github.latest.open_prs,
                    default_branch: github.latest.default_branch,
                    archived: github.latest.archived,
                    pushed_at: github.latest.pushed_at,
                    latest_release: github.latest.latest_release,
                    commits: github.latest.commits,
                    ci: github.latest.ci,
                    ts: github.latest.ts,
                  }
                : null,
            }
          : null,
      }),
    );
  }

  @Remote("doing")
  async doing(): Promise<DoingData> {
    return readDoing(this.workspace);
  }

  /** 返回当前工作区的计划、历史、项目与带记录覆盖信息的指标。 */
  @Remote("overview")
  async overview(): Promise<OverviewData> {
    return readOverviewPage(this.workspace);
  }
}
