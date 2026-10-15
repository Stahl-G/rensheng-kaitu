import type { Context } from "@deepseek-ai/cordis";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { Workspace, defaultRoot, readOverviewPage } from "@kaitu/core";
import type { Config } from "./tools.js";
import type { OverviewData } from "./types.js";

declare module "@deepseek-ai/cordis" {
  interface Context {
    kaitu: KaituOverviewService;
  }
}

/** 工作区只读总览，不激活 Agent 或触发同步。 */
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

  /** 返回当前工作区的计划、历史、项目与带记录覆盖信息的指标。 */
  @Remote("overview")
  async overview(): Promise<OverviewData> {
    return readOverviewPage(this.workspace);
  }
}
