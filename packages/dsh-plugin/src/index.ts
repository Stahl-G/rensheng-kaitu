import type { Context } from "@deepseek-ai/cordis";
import type { TypertContribution } from "@deepseek-ai/dsh-typert-registry";
import { TYPERT as contribution } from "../lib/typert.host.js";
import type { Context as ToolContext } from "./dsh.js";
import { KaituOverviewService } from "./overview-service.js";
import { type Config, apply as applyTools } from "./tools.js";

export { KaituOverviewService } from "./overview-service.js";
export type { Config } from "./tools.js";
export const name = "kaitu";
export const inject = ["tools", "systemPrompt", "typert"];

export function apply(ctx: Context, config: Config = {}): void {
  applyTools(ctx as unknown as ToolContext, config);
  ctx.typert.register(contribution as TypertContribution);
  new KaituOverviewService(ctx, config);
}
