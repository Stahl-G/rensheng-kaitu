import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Workspace, localStateRoot } from "@kaitu/core";
import type { AskService } from "./ask.js";

/** CLI/Web 自带 Node 引擎，配置和会话保存在本机状态目录。源码直接运行时没有构建引擎，不提供问问。 */
export async function browserAsk(ws: Workspace): Promise<AskService | undefined> {
  const entry = new URL("../engine/service.mjs", import.meta.url);
  if (!existsSync(fileURLToPath(entry))) return undefined;
  const { createWebAsk } = await import(entry.href);
  return createWebAsk(ws, join(localStateRoot(), "web-ai"));
}
