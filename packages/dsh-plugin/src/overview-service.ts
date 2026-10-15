import type { Context } from "@deepseek-ai/cordis";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import {
  KaituError,
  Workspace,
  defaultRoot,
  listProjects,
  readAvatar,
  readOverviewPage,
  removeAvatar,
  saveAvatar,
} from "@kaitu/core";
import { readMe } from "./me-data.js";
import type { Config } from "./tools.js";
import type { DoingProject, MeData, OverviewData } from "./types.js";

declare module "@deepseek-ai/cordis" {
  interface Context {
    kaitu: KaituOverviewService;
  }
}

/** 工作区页面与本机头像，不激活 Agent 或触发同步。 */
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

  @Remote("me")
  async me(): Promise<MeData> {
    return readMe(this.workspace);
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
