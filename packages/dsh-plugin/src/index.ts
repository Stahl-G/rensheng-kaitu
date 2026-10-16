import { isAbsolute } from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import type { TypertContribution } from "@deepseek-ai/dsh-typert-registry";
import { Workspace, defaultRoot, initWorkspace, upgradeWorkspace } from "@kaitu/core";
import { TYPERT as contribution } from "../lib/typert.host.js";
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
    await upgradeWorkspace(ws);
  }
  registerSkills(ctx as unknown as SkillContext, ws);
  const queue = applyTools(ctx as unknown as ToolContext, config, ws);
  ctx.typert.register(contribution as TypertContribution);
  new KaituOverviewService(ctx, config, ws, queue);
  new KaituFinanceService(ctx, config, ws, queue);
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
