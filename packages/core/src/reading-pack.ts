import { type AgentConnectionId, agentCanRead } from "./exposure.js";
import { handoverPack } from "./handover.js";
import type { Locale } from "./locale.js";
import type { Workspace } from "./workspace.js";

/** On-demand handover, with finance decided by the transport's identity, never tool arguments. */
export function agentReadingPack(
  ws: Workspace,
  connection: AgentConnectionId,
  locale?: Locale,
  now = new Date(),
) {
  return handoverPack(ws, locale, now, agentCanRead(ws, "finance", connection));
}
