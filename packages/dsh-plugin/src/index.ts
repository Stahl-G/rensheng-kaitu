import { isAbsolute } from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import type { TypertContribution } from "@deepseek-ai/dsh-typert-registry";
import { CollectorService } from "@kaitu/channels/collectors";
import { startPhoneSnapshots } from "@kaitu/core";
import {
  KaituError,
  Workspace,
  defaultRoot,
  initWorkspace,
  startProjectGithubSync,
  startWeatherSync,
  startWorkspaceBackup,
  upgradeWorkspace,
} from "@kaitu/core";
import { TYPERT as contribution } from "../lib/typert.host.js";
import { startCalendarLoop } from "./calendar-loop.js";
import type { SkillContext, Context as ToolContext } from "./dsh.js";
import { KaituFinanceService } from "./finance-service.js";
import { startInboxLoop } from "./inbox-loop.js";
import { KaituOverviewService } from "./overview-service.js";
import { setupSchedules } from "./schedules.js";
import { registerSkills } from "./skills.js";
import { type Config, apply as applyTools } from "./tools.js";

export { KaituFinanceService } from "./finance-service.js";
export { KaituOverviewService } from "./overview-service.js";
export type { Config } from "./tools.js";
export const name = "kaitu";
export const inject = ["tools", "systemPrompt", "skills", "typert"];

export async function apply(ctx: Context, config: Config = {}): Promise<void> {
  if (config.workspace !== undefined && !isAbsolute(config.workspace))
    throw new Error("workspace 必须是绝对路径");
  let ws = new Workspace(config.workspace ?? defaultRoot());
  if (!ws.exists(".kaitu/config.json") && ws.exists("WORKSPACE-MOVED.md")) {
    const target = /^当前位置：(.+)$/m.exec(ws.readText("WORKSPACE-MOVED.md"))?.[1];
    if (target && isAbsolute(target)) ws = new Workspace(target);
  }
  if (!ws.exists(".kaitu/config.json")) {
    ws = await initWorkspace(ws.root, { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
  } else {
    await upgradeWorkspace(ws).catch((error: unknown) => {
      // 云盘未下载时推迟迁移，仍启动账号设置和工具；具体文件的读写继续由 Workspace 拒绝。
      if (!(error instanceof KaituError) || error.code !== "CLOUD_UNAVAILABLE") throw error;
    });
  }
  registerSkills(ctx as unknown as SkillContext, ws);
  const queue = applyTools(ctx as unknown as ToolContext, config, ws);
  ctx.effect(() => () => queue(async () => {}));
  ctx.typert.register(contribution as TypertContribution);
  const collectors = new CollectorService(ws);
  new KaituOverviewService(ctx, config, ws, queue, collectors);
  new KaituFinanceService(ctx, config, ws, queue);
  // automation: false 时后台工作（采集、日历推送、收件箱、定时任务）交给开图 App，插件只提供页面和工具。
  if (config.automation === false) return;
  ctx.effect(() => startWorkspaceBackup(ws));
  ctx.effect(() => startProjectGithubSync(ws));
  ctx.effect(() => startWeatherSync().stop);
  ctx.effect(() => startPhoneSnapshots(ws));
  collectors.start();
  ctx.effect(() => () => collectors.stop());
  ctx.effect(() => startCalendarLoop(ws, queue));
  const stop = startInboxLoop(ws, 60000, queue);
  ctx.effect(() => stop);
  ctx.inject(["schedule", "sessionController", "sessions"], (services) => {
    services.effect(() => {
      let pending: Promise<void> | undefined;
      const run = () => {
        if (pending) return;
        pending = setupSchedules(
          services as unknown as Parameters<typeof setupSchedules>[0],
          ws,
          config.enableAutomation,
        )
          .catch((error: unknown) => {
            services.logger.warn(`开图自动化初始化失败：${String(error)}`);
          })
          .finally(() => {
            pending = undefined;
          });
      };
      const timer = setInterval(run, 5000);
      timer.unref();
      run();
      return async () => {
        clearInterval(timer);
        await pending;
      };
    });
  });
}
