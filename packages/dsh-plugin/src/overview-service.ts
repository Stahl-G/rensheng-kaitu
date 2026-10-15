import type { Context } from "@deepseek-ai/cordis";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import {
  Workspace,
  defaultRoot,
  dismissNews,
  listProjects,
  readNews,
  readOverviewPage,
  tryNews,
} from "@kaitu/core";
import type { Config } from "./tools.js";
import type { DoingProject, NewsAction, NewsData, OverviewData } from "./types.js";

declare module "@deepseek-ai/cordis" {
  interface Context {
    kaitu: KaituOverviewService;
  }
}

/** 工作区页面数据与资讯操作。 */
export class KaituOverviewService extends TypertRemoteService {
  private readonly workspace: Workspace;

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, "kaitu");
    this.workspace = new Workspace(config.workspace ?? defaultRoot());
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
    const result = await tryNews(this.workspace, id);
    return { id: result.record.id, status: "tried", version: result.version };
  }

  @Remote("dismissNews")
  async dismissNews(id: string): Promise<NewsAction> {
    const result = await dismissNews(this.workspace, id);
    return { id: result.record.id, status: "dismissed", version: result.version };
  }

  @Remote("projects")
  async projects(): Promise<DoingProject[]> {
    return listProjects(this.workspace).map(({ slug, title, stage, kind, next, completion, github }) => ({
      slug,
      title,
      stage,
      kind,
      next,
      completion,
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
    }));
  }

  /** 返回当前工作区的计划、历史、项目与带记录覆盖信息的指标。 */
  @Remote("overview")
  async overview(): Promise<OverviewData> {
    return readOverviewPage(this.workspace);
  }
}
