import { rmSync } from "node:fs";
import type { Context } from "@deepseek-ai/cordis";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import {
  type AutomationKey,
  type AutomationSettings,
  KaituError,
  Workspace,
  captureNote,
  changeExperienceBatch,
  configureAutomation,
  decideProposal,
  defaultRoot,
  dismissNews,
  editExperience,
  hideExperience,
  lifeMap,
  listProjects,
  previewExperienceBatch,
  readAutomation,
  readAvatar,
  readDoing,
  readExperienceImports,
  readExperienceSource,
  readExploration,
  readExplorationSource,
  readHealthPage,
  readNews,
  readOverviewPage,
  readPhoto,
  recoverExperienceImports,
  removeAvatar,
  resolveExperience,
  saveAvatar,
  setExperienceSource,
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
  ) {
    super(ctx, "kaitu");
    this.workspace = workspace ?? new Workspace(config.workspace ?? defaultRoot());
  }

  /** Desktop passes its installed release version to the running Host (apps/desktop/src/main.ts). */
  @Remote("dshVersion")
  async dshVersion(): Promise<string | null> {
    return process.env.DSH_CLIENT_VERSION?.trim() || null;
  }

  @Remote("automation")
  async automation(): Promise<AutomationSettings> {
    return readAutomation(this.workspace);
  }

  @Remote("configureAutomation")
  async configureAutomation(tasks: Partial<Record<AutomationKey, boolean>>): Promise<AutomationSettings> {
    return this.write(async () => configureAutomation(this.workspace, tasks));
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
