import { randomBytes } from "node:crypto";
import { chmodSync } from "node:fs";
import { KaituError } from "./errors.js";
import type { Workspace } from "./workspace.js";

export function mcpToken(ws: Workspace, rotate = false): string {
  const file = ".kaitu/secrets.json";
  const secrets = ws.exists(file) ? ws.readJson<Record<string, unknown>>(file) : {};
  if (!secrets || typeof secrets !== "object" || Array.isArray(secrets)) {
    throw new KaituError("密钥文件格式不合法", "INVALID_SECRETS");
  }
  if (rotate || typeof secrets.mcp_token !== "string" || !secrets.mcp_token) {
    secrets.mcp_token = randomBytes(32).toString("base64url");
    ws.writeJson(file, secrets, { internal: true, mode: 0o600 });
  }
  chmodSync(ws.resolve(file, { internal: true }), 0o600);
  return secrets.mcp_token as string;
}
