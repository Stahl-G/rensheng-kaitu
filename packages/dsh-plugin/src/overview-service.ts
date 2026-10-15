import type { Context } from "@deepseek-ai/cordis";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import {
  KaituError,
  Workspace,
  defaultRoot,
  dismissNews,
  lifeMap,
  listProjects,
  readAvatar,
  readDoing,
  readHealthPage,
  readNews,
  readOverviewPage,
  readPhoto,
  removeAvatar,
  resolveExperience,
  saveAvatar,
  tryNews,
} from "@kaitu/core";
import type { MutationQueue } from "./dsh.js";
import { readMe } from "./me-data.js";
import type { Config } from "./tools.js";
import type {
  DoingData,
  DoingProject,
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

  @Remote("lifeMap")
  async lifeMap(): Promise<LifeMapData> {
    return lifeMap(this.workspace);
  }

  @Remote("resolveExperience")
  async resolveExperience(id: string, geonameid: number): Promise<{ id: string; version: string | null }> {
    const result = await this.write(() => resolveExperience(this.workspace, id, geonameid));
    return { id: result.record.id, version: result.version };
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
