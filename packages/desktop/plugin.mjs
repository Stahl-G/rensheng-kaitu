import * as plugin from "../dsh-plugin/dist/index.js";

export * from "../dsh-plugin/dist/index.js";
export const inject = [...plugin.inject, "workspaceRegistry", "sessions"];

export async function apply(ctx, config) {
  // 在浏览器的首次会话恢复之前，用 DSH 自己的注册接口建立默认工作区。
  await ctx.workspaceRegistry.initializeDefault(async () => config.workspace);
  await plugin.apply(ctx, config);
}
