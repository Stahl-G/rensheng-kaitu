import { relative, resolve, sep } from "node:path";
import { agentRelativePath } from "./agent-file-policy.js";
import { KaituError } from "./errors.js";
import { normalizedMemory } from "./memory.js";
import type { Workspace } from "./workspace.js";

export const agentConnections = ["local-mcp", "remote-mcp", "local-ask", "phone-ask"] as const;
export type AgentConnectionId = (typeof agentConnections)[number];
export type AgentConnection = AgentConnectionId | { id: "handover"; finance: boolean };
export type FinanceAccess = Record<AgentConnectionId, boolean>;

const file = ".kaitu/exposure.json";
const defaults: FinanceAccess = {
  "local-mcp": true,
  "remote-mcp": false,
  "local-ask": true,
  "phone-ask": true,
};

export function readFinanceAccess(ws: Workspace): FinanceAccess {
  if (!ws.exists(file)) return { ...defaults };
  const saved = ws.readJson<Partial<FinanceAccess>>(file);
  if (
    !saved ||
    typeof saved !== "object" ||
    Array.isArray(saved) ||
    Object.entries(saved).some(
      ([id, value]) => !agentConnections.includes(id as AgentConnectionId) || typeof value !== "boolean",
    )
  )
    throw new KaituError("Agent 读取设置不合法", "INVALID_CONFIG");
  return { ...defaults, ...saved };
}

export function setFinanceAccess(ws: Workspace, id: AgentConnectionId, allowed: boolean): FinanceAccess {
  if (!agentConnections.includes(id) || typeof allowed !== "boolean")
    throw new KaituError("Agent 读取设置不合法", "BAD_ARGS");
  const next = { ...readFinanceAccess(ws), [id]: allowed };
  ws.writeJson(file, next, { internal: true });
  return next;
}

/** The same file boundary is used by MCP, Ask and the user-built handover pack. */
export function agentCanRead(ws: Workspace, path: string, connection: AgentConnection): boolean {
  let relative: string;
  try {
    relative = agentRelativePath(ws.root, path);
  } catch {
    return false;
  }
  const physical = relative;
  const lexical = relativePath(ws.root, path);
  return (lexical === physical ? [physical] : [lexical, physical]).every((value) =>
    allowedPath(ws, value, connection),
  );
}

function relativePath(root: string, path: string): string {
  return relative(root, resolve(root, path)).split(sep).join("/");
}

function allowedPath(ws: Workspace, relative: string, connection: AgentConnection): boolean {
  const parts = relative.split("/");
  const name = parts.at(-1)?.toLowerCase() ?? "";
  if (
    parts.some((part) => part === ".kaitu" || part === ".git") ||
    name === ".env" ||
    name.startsWith(".env.") ||
    /^(?:id_(?:rsa|dsa|ecdsa|ed25519)(?:_sk)?|credentials|secrets)(?:\.|$)/i.test(name) ||
    /\.(?:key|pem|p8|p12|pfx|ppk|jks|keystore)$/i.test(name)
  )
    return false;
  if (parts[0] === "memory" && parts.length === 2 && name.endsWith(".md") && name !== "memory.md") {
    try {
      if (normalizedMemory(ws, parts[1] ?? "")?.sensitive !== false) return false;
    } catch {
      return false;
    }
  }
  if (parts[0] !== "finance") return true;
  return typeof connection === "string" ? readFinanceAccess(ws)[connection] : connection.finance;
}
