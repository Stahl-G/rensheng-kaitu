import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Context } from "@deepseek-ai/cordis";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import type { CollectorService } from "@kaitu/channels/collectors";
import {
  type AutomationKey,
  type AutomationSettings,
  type CalendarData,
  CalendarPush,
  type CalendarPushResult,
  type CalendarPushSettings,
  type City,
  type HandoverPack,
  type Hometown,
  type ImportSource,
  KaituError,
  type LearningCheckinInput,
  type LearningTopic,
  type LibraryData,
  type NewsFeedback,
  type OnboardingAi,
  type OnboardingChoiceResult,
  type OnboardingChoices,
  type OnboardingImportPreview,
  type OnboardingImportResult,
  type OnboardingMatter,
  type OnboardingMatterDraft,
  type OnboardingMatterSuggestion,
  type OnboardingMemoryPreview,
  type OnboardingMemoryResult,
  type OnboardingNext,
  type OnboardingPath,
  type OnboardingSetupInput,
  type OnboardingSetupPreview,
  type OnboardingSetupResult,
  type OnboardingStatus,
  type OnboardingTarget,
  type OrganizerStatus,
  type Preferences,
  type ProjectGoal,
  type SettingsData,
  type StartLearningInput,
  type SyncProvider,
  Workspace,
  addCalendarSubscription,
  addGoalNext,
  adoptOnboardingMatter,
  bindGithub,
  calendarPushEntries,
  calendarPushStore,
  cancelOnboardingPreview,
  captureNote,
  changeExperienceBatch,
  changeOnboardingNext,
  completeNext,
  configureAutomation,
  confirmOnboardingImport,
  confirmOnboardingMemory,
  confirmOnboardingSetup,
  createProject,
  decideProposal,
  defaultRoot,
  directionsPrompt,
  dismissNews,
  draftOnboardingMatter,
  dshFiles,
  editCalendarBlock,
  editExperience,
  handoverPack,
  hideExperience,
  keepOnboardingMatter,
  lifeMap,
  listLearning,
  markOrganizerSeen,
  matterPrompt,
  moveWorkspace,
  normalizeLocale,
  onboardingStatus,
  pasteDirections,
  pasteOnboardingMatter,
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
  readLearning,
  readLibrary,
  readLibraryDocument,
  readNews,
  readOnboardingMatter,
  readOverviewPage,
  readPhoto,
  readProjectPage,
  readProjectsPage,
  readSettings,
  recoverExperienceImports,
  removeAvatar,
  resolveExperience,
  resolvePlace,
  resolvePreferences,
  restore,
  saveAvatar,
  saveHometown,
  saveLearningCheckin,
  saveNewsKeywords,
  saveOnboardingChoices,
  saveOnboardingMatter,
  savePreferences,
  saveProjectGoal,
  scheduleNext,
  serveWorkspaceExport,
  setExperienceSource,
  setNewsFeedback,
  snapshot,
  startLearning,
  startWorkspaceExportDownloads,
  syncProject,
  tryNews,
  unhideExperience,
  workspaceBackupRequest,
  workspaceBackupStatus,
  workspaceExportRequest,
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
  LibraryQuery,
  LifeMapData,
  MeData,
  NewsAction,
  NewsData,
  OverviewData,
  ProjectDetailData,
  WorkspaceExportState,
} from "./types.js";

declare module "@deepseek-ai/cordis" {
  interface Context {
    kaitu: KaituOverviewService;
  }
}

/** 工作区页面数据、资讯与地点核对、本机头像。 */
interface ExportWebServer {
  register(route: {
    kind: "prefix";
    path: string;
    handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  }): () => void;
}
export class KaituOverviewService extends TypertRemoteService {
  private readonly workspace: Workspace;
  private readonly exportContext: Context;
  private exportRoute?: () => void;
  private exportBase?: string;
  private exportDownloads?: Promise<Awaited<ReturnType<typeof startWorkspaceExportDownloads>>>;
  private readonly files: ReturnType<typeof dshFiles>;
  private readonly scheduleLearningVersion: (message: string) => void;

  constructor(
    ctx: Context,
    private readonly config: Config = {},
    workspace?: Workspace,
    private readonly write: MutationQueue = (run) => run(),
    private readonly collectors?: CollectorService,
  ) {
    super(ctx, "kaitu");
    this.exportContext = ctx;
    this.workspace = workspace ?? new Workspace(config.workspace ?? defaultRoot());
    this.files = dshFiles(this.workspace);
    ctx.effect(() => async () => {
      this.files.dispose();
      this.exportRoute?.();
      await workspaceExportRequest(this.workspace, "cancel");
      if (this.exportDownloads) await (await this.exportDownloads).close();
    });
    this.scheduleLearningVersion = (message) => {
      setImmediate(() => {
        void this.write(() => snapshot(this.workspace, message)).catch((error) =>
          ctx.logger.warn(`学习资料已保存，后台版本记录未完成：${String(error)}`),
        );
      });
    };
    const performWrite = this.write;
    this.write = async (operation) => {
      try {
        return await performWrite(operation);
      } finally {
        this.files.invalidate();
      }
    };
  }

  @Remote("findWorkspaceFiles")
  async findWorkspaceFiles(query: string): Promise<{ path: string; kind: "file" | "directory" }[]> {
    if (!query) this.files.invalidate();
    return this.files.find(query);
  }

  @Remote("openWorkspacePath")
  async openWorkspacePath(path: string, action: "open" | "reveal"): Promise<{ opened: boolean }> {
    return this.files.open(path, action);
  }

  @Remote("channelSettings")
  async channelSettings(operation: string, input: string): Promise<string> {
    if (!this.collectors) throw new Error("采集服务未启动");
    const parsed: unknown = JSON.parse(input);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("采集参数必须是对象");
    return JSON.stringify(await this.collectors.request(operation, parsed as Record<string, unknown>));
  }

  @Remote("onboardingMatterKeep")
  async onboardingMatterKeep(source: string): Promise<OnboardingMatter> {
    return this.write(() => keepOnboardingMatter(this.workspace, source));
  }
  @Remote("onboardingMatterSave")
  async onboardingMatterSave(text: string): Promise<OnboardingMatter> {
    return this.write(() => saveOnboardingMatter(this.workspace, text));
  }
  @Remote("onboardingMatterRead")
  async onboardingMatterRead(source: string): Promise<OnboardingMatter> {
    return readOnboardingMatter(this.workspace, source);
  }
  @Remote("onboardingMatterOrganize")
  async onboardingMatterOrganize(source: string): Promise<OnboardingMatter> {
    return readOnboardingMatter(this.workspace, source);
  }
  @Remote("onboardingMatterPrompt")
  async onboardingMatterPrompt(source: string, locale?: string): Promise<string> {
    return matterPrompt(readOnboardingMatter(this.workspace, source).text, normalizeLocale(locale));
  }
  @Remote("onboardingMatterPaste")
  async onboardingMatterPaste(source: string, answer: string, locale?: string): Promise<OnboardingMatter> {
    return this.write(() =>
      pasteOnboardingMatter(this.workspace, source, answer, { locale: normalizeLocale(locale) }),
    );
  }
  @Remote("goalNextAdd")
  async goalNextAdd(goalId: string, title: string): Promise<OnboardingNext> {
    return this.write(() => addGoalNext(this.workspace, goalId, title));
  }
  @Remote("handoverPack")
  async handoverPack(locale?: string): Promise<HandoverPack> {
    return handoverPack(this.workspace, normalizeLocale(locale));
  }
  @Remote("directionsPrompt")
  async directionsPrompt(locale?: string): Promise<string> {
    return directionsPrompt(this.workspace, normalizeLocale(locale));
  }
  @Remote("directionsPaste")
  async directionsPaste(answer: string, locale?: string): Promise<{ ids: string[]; skipped: number }> {
    return this.write(() => pasteDirections(this.workspace, answer, { locale: normalizeLocale(locale) }));
  }
  @Remote("preferences")
  async preferences(hint?: string): Promise<Preferences> {
    return resolvePreferences(this.workspace, hint);
  }
  @Remote("savePreferences")
  async savePreferences(input: Preferences): Promise<Preferences> {
    return savePreferences(input);
  }
  @Remote("onboardingMatterDraft")
  async onboardingMatterDraft(source: string, input: OnboardingMatterSuggestion): Promise<OnboardingMatter> {
    return this.write(() => draftOnboardingMatter(this.workspace, source, input));
  }
  @Remote("onboardingMatterAdopt")
  async onboardingMatterAdopt(
    source: string,
    input: OnboardingMatterDraft,
    path: OnboardingPath | null,
  ): Promise<OnboardingNext> {
    return this.write(() => adoptOnboardingMatter(this.workspace, source, input, path));
  }
  @Remote("onboardingNextChange")
  async onboardingNextChange(
    id: string,
    rev: number,
    action: string,
    value: string,
  ): Promise<OnboardingNext> {
    return this.write(() => changeOnboardingNext(this.workspace, id, rev, action, value));
  }

  @Remote("onboarding")
  async onboarding(locale?: string): Promise<OnboardingStatus> {
    return onboardingStatus(this.workspace, { locale: normalizeLocale(locale) });
  }

  @Remote("onboardingMemoryPreview")
  async onboardingMemoryPreview(
    text: string,
    ai: OnboardingAi,
    locale?: string,
  ): Promise<OnboardingMemoryPreview> {
    return this.write(async () =>
      previewOnboardingMemory(this.workspace, text, ai, { locale: normalizeLocale(locale) }),
    );
  }

  @Remote("onboardingMemoryConfirm")
  async onboardingMemoryConfirm(
    token: string,
    selected: string[],
    targets?: Record<string, OnboardingTarget>,
  ): Promise<OnboardingMemoryResult> {
    return this.write(() => confirmOnboardingMemory(this.workspace, token, selected, { targets }));
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

  @Remote("brand")
  async brand(): Promise<boolean> {
    return this.config.brand === true;
  }

  /** Desktop passes its installed release version to the running Host (apps/desktop/src/main.ts). */
  @Remote("dshVersion")
  async dshVersion(): Promise<string | null> {
    return process.env.DSH_CLIENT_VERSION?.trim() || null;
  }

  @Remote("library")
  async library(query?: LibraryQuery): Promise<LibraryData> {
    return readLibrary(this.workspace, query);
  }

  @Remote("libraryDocument")
  async libraryDocument(file: string): Promise<string> {
    return readLibraryDocument(this.workspace, file);
  }

  @Remote("learningList")
  async learningList(): Promise<{ topic: string; title: string; next: string | null }[]> {
    return listLearning(this.workspace);
  }

  @Remote("learningRead")
  async learningRead(topic: string): Promise<LearningTopic> {
    return readLearning(this.workspace, topic);
  }

  @Remote("learningStart")
  async learningStart(
    input: StartLearningInput,
  ): Promise<LearningTopic & { version: string | null; versionError?: string }> {
    return this.write(() => startLearning(this.workspace, input, new Date(), this.scheduleLearningVersion));
  }

  @Remote("learningSave")
  async learningSave(
    input: LearningCheckinInput,
  ): Promise<LearningTopic & { version: string | null; versionError?: string; replayed?: boolean }> {
    return this.write(() =>
      saveLearningCheckin(this.workspace, input, new Date(), this.scheduleLearningVersion),
    );
  }

  @Remote("calendar")
  async calendar(): Promise<CalendarData> {
    return readCalendar(this.workspace);
  }

  @Remote("addCalendarSubscription")
  async addCalendarSubscription(url: string, name: string): Promise<CalendarData> {
    return addCalendarSubscription(this.workspace, url, name, this.write);
  }

  @Remote("completeNext")
  async completeNext(file: string, id: string): Promise<{ version: string | null }> {
    return this.write(() => completeNext(this.workspace, file, id));
  }

  @Remote("workspaceBackup")
  async workspaceBackup(operation: string, input: string): Promise<string> {
    return JSON.stringify(await workspaceBackupRequest(this.workspace, operation, JSON.parse(input)));
  }

  @Remote("settings")
  async settings(): Promise<SettingsData> {
    return readSettings(this.workspace);
  }

  @Remote("organizerSeen")
  async organizerSeen(): Promise<OrganizerStatus> {
    return markOrganizerSeen(this.workspace);
  }

  @Remote("exportWorkspaceRequest")
  async exportWorkspaceRequest(
    action: "start" | "status" | "cancel" | "result",
  ): Promise<WorkspaceExportState> {
    if (action !== "result") return workspaceExportRequest(this.workspace, action);
    if (!this.exportBase) {
      // dsh-host-webserver 0.2.1-rc.2 的已安装公开 register 接口；Electron IPC 没有该服务。
      const web = (this.exportContext as unknown as { get(name: string): ExportWebServer | undefined }).get(
        "webServer",
      );
      if (web) {
        const path = `/kaitu-export-${randomUUID()}`;
        this.exportRoute = web.register({
          kind: "prefix",
          path,
          handler: async (req, res) => {
            const token = new URL(req.url ?? "/", "http://localhost").pathname.slice(path.length + 1);
            if (req.method !== "GET" || !/^[a-f0-9-]+$/.test(token)) {
              res.writeHead(404);
              res.end();
              return;
            }
            await serveWorkspaceExport(this.workspace, token, res);
          },
        });
        this.exportBase = `${path}/`;
      }
    }
    if (this.exportBase) return workspaceExportRequest(this.workspace, action, this.exportBase);
    this.exportDownloads ??= startWorkspaceExportDownloads(this.workspace).catch((error) => {
      this.exportDownloads = undefined;
      throw error;
    });
    return workspaceExportRequest(this.workspace, action, (await this.exportDownloads).base);
  }

  @Remote("restoreVersion")
  async restoreVersion(oid: string): Promise<{ oid: string | null; changed: number }> {
    return this.write(() => restore(this.workspace, oid));
  }

  @Remote("moveStorage")
  async moveStorage(path: string, drive: boolean, provider?: SyncProvider): Promise<SettingsData["storage"]> {
    return this.write(() => {
      if (workspaceBackupStatus(this.workspace).running)
        throw new KaituError("备份或恢复进行中，请先取消或等候完成", "CONFLICT");
      return moveWorkspace(this.workspace, path, drive, provider);
    });
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
    const file = ".kaitu/cache/ai-draft.json";
    if (!this.workspace.exists(file)) return null;
    const draft = this.workspace.readJson<{ id?: string; text?: unknown }>(file);
    if (id ? draft.id !== id : !process.env.DSH_CLIENT_VERSION) return null;
    const value = draft.text;
    if (typeof draft.id !== "string" || typeof value !== "string" || value.length > 100000)
      throw new KaituError("会话草稿不合法", "BAD_ARGS");
    return { id: draft.id, text: value };
  }

  @Remote("ackAiDraft")
  async ackAiDraft(id: string): Promise<void> {
    await this.write(async () => {
      const file = ".kaitu/cache/ai-draft.json";
      if (this.workspace.exists(file) && this.workspace.readJson<{ id?: string }>(file).id === id)
        rmSync(this.workspace.resolve(file, { internal: true }));
    });
  }

  private get calendarWriter() {
    return new CalendarPush(calendarPushStore(this.workspace));
  }

  @Remote("calendarPush")
  async calendarPush(): Promise<CalendarPushSettings> {
    return this.calendarWriter.settings();
  }

  @Remote("configureCalendarPush")
  async configureCalendarPush(enabled: boolean): Promise<CalendarPushSettings> {
    if (typeof enabled !== "boolean") throw new KaituError("缺少开关状态", "BAD_ARGS");
    return this.write(async () => this.calendarWriter.configure(enabled));
  }

  @Remote("retryCalendarPush")
  async retryCalendarPush(id: string): Promise<CalendarPushSettings> {
    return this.write(() => this.calendarWriter.sync(calendarPushEntries(this.workspace), id));
  }

  @Remote("removeCalendarPush")
  async removeCalendarPush(): Promise<CalendarPushSettings> {
    return this.write(() => this.calendarWriter.removeAll());
  }

  @Remote("editCalendarBlock")
  async editCalendarBlock(id: string, start: string, end: string): Promise<CalendarPushResult> {
    return this.write(async () => {
      const result = await editCalendarBlock(this.workspace, id, start, end, this.calendarWriter.located(id));
      return { ...result, calendarPush: await this.calendarWriter.sync(calendarPushEntries(this.workspace)) };
    });
  }

  @Remote("scheduleNext")
  async scheduleNext(file: string, id: string, start: string, end: string): Promise<CalendarPushResult> {
    return this.write(async () => {
      const result = await scheduleNext(this.workspace, file, id, start, end);
      return { ...result, calendarPush: await this.calendarWriter.sync(calendarPushEntries(this.workspace)) };
    });
  }

  @Remote("decideProposal")
  async decideProposal(id: string, decision: "confirmed" | "rejected"): Promise<CalendarPushResult> {
    return this.write(async () => {
      const result = await decideProposal(this.workspace, id, decision);
      return { ...result, calendarPush: await this.calendarWriter.sync(calendarPushEntries(this.workspace)) };
    });
  }

  @Remote("capture")
  async capture(text: string): Promise<{ path: string; version: string | null }> {
    return this.write(() => captureNote(this.workspace, text));
  }

  @Remote("news")
  async news(): Promise<NewsData> {
    return readNews(this.workspace);
  }

  @Remote("saveNewsKeywords")
  async saveNewsKeywords(keywords: string[]): Promise<string[]> {
    return this.write(() => saveNewsKeywords(this.workspace, keywords));
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

  @Remote("hometownCities")
  async hometownCities(name: string): Promise<City[]> {
    return resolvePlace(name);
  }

  @Remote("saveHometown")
  async saveHometown(name: string, geonameid: number): Promise<Hometown> {
    return this.write(() => saveHometown(this.workspace, name, geonameid));
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
    return readProjectsPage(this.workspace);
  }

  @Remote("projectDetail")
  async projectDetail(slug: string): Promise<ProjectDetailData> {
    return readProjectPage(this.workspace, slug);
  }

  @Remote("projectCreate")
  async projectCreate(title: string): Promise<{ slug: string }> {
    return this.write(() => createProject(this.workspace, { title, kind: "personal" }));
  }

  @Remote("projectGoalSave")
  async projectGoalSave(slug: string, goal: ProjectGoal): Promise<ProjectDetailData> {
    return this.write(() => saveProjectGoal(this.workspace, slug, goal));
  }

  @Remote("projectBindGithub")
  async projectBindGithub(slug: string, repo: string): Promise<ProjectDetailData> {
    await bindGithub(this.workspace, slug, repo);
    return readProjectPage(this.workspace, slug);
  }

  @Remote("projectSync")
  async projectSync(slug: string): Promise<void> {
    await syncProject(this.workspace, slug);
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
