import { join } from "node:path";
import { type Workspace, localStateRoot } from "@kaitu/core";
import type { AskService } from "./ask.js";

/** CLI/Web 自带 Node 引擎，配置和会话保存在本机状态目录。 */
export async function browserAsk(ws: Workspace): Promise<AskService> {
  const entry = new URL("../engine/service.mjs", import.meta.url).href;
  const { createWebAsk } = await import(entry);
  return createWebAsk(ws, join(localStateRoot(), "web-ai"));
}
