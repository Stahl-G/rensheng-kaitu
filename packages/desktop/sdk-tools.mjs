import { apply as applyTools } from "../dsh-plugin/src/tools.js";

export const name = "kaitu-sdk-tools";
export const inject = ["tools", "systemPrompt"];

// Ask 只需要资料工具；页面、资料迁移和后台采集由主程序负责。
export function apply(ctx, config) {
  const queue = applyTools(ctx, config);
  ctx.effect(() => () => queue(async () => {}));
}
