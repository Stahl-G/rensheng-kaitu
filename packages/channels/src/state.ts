import { createHash, randomInt } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Workspace } from "@kaitu/core";
import { type ChannelName, channelNames } from "./channel.js";

export interface Credentials {
  telegram: { token: string };
  feishu: { appId: string; appSecret: string };
  qq: { appId: string; appSecret: string };
  weixin: { token: string; baseUrl: string; accountId: string };
}

interface Pairing {
  owner?: string;
  code?: string;
  expires?: number;
}

export function readState<T>(ws: Workspace, path: string, fallback: T): T {
  return ws.exists(path) ? ws.readJson<T>(path) : fallback;
}

export function writeState(ws: Workspace, path: string, data: unknown): void {
  ws.writeJson(path, data, { internal: true, mode: 0o600 });
}

export function credentials(ws: Workspace): Partial<Credentials> {
  const secrets = readState<{ channels?: Partial<Credentials> }>(ws, ".kaitu/secrets.json", {});
  return secrets.channels ?? {};
}

export function saveCredentials<N extends ChannelName>(ws: Workspace, name: N, value: Credentials[N]): void {
  const secrets = readState<Record<string, unknown>>(ws, ".kaitu/secrets.json", {});
  writeState(ws, ".kaitu/secrets.json", { ...secrets, channels: { ...credentials(ws), [name]: value } });
  chmodSync(ws.resolve(".kaitu/secrets.json", { internal: true }), 0o600);
}

function pairingPath(name: ChannelName): string {
  return `.kaitu/channels/${name}/pairing.json`;
}

export function pair(ws: Workspace, name: ChannelName, now = Date.now()): { code: string; expires: number } {
  if (readState<Pairing>(ws, pairingPath(name), {}).owner) throw new Error(`${name} 已配对`);
  const pending = { code: randomInt(0, 1_000_000).toString().padStart(6, "0"), expires: now + 600_000 };
  writeState(ws, pairingPath(name), pending);
  return pending;
}

export function authorize(
  ws: Workspace,
  name: ChannelName,
  userId: string,
  text: string,
): "owner" | "paired" | "ignore" {
  const state = readState<Pairing>(ws, pairingPath(name), {});
  if (state.owner) return state.owner === userId ? "owner" : "ignore";
  if (!userId || !state.code || !state.expires || Date.now() >= state.expires || text.trim() !== state.code) {
    return "ignore";
  }
  writeState(ws, pairingPath(name), { owner: userId });
  return "paired";
}

export function sessionPath(name: ChannelName, chatId: string): string {
  const key = createHash("sha256").update(chatId).digest("hex");
  return `.kaitu/channels/${name}/sessions/${key}.json`;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function channelStatus(ws: Workspace) {
  const configured = credentials(ws);
  return channelNames.map((name) => {
    const state = readState<Pairing>(ws, pairingPath(name), {});
    const run = readState<{ pid?: number }>(ws, `.kaitu/channels/${name}/run.json`, {});
    return {
      name,
      configured: Boolean(configured[name]),
      paired: Boolean(state.owner),
      pairingPending: Boolean(state.code && state.expires && Date.now() < state.expires),
      running: Boolean(run.pid && alive(run.pid)),
    };
  });
}

export function acquireChannel(ws: Workspace, name: ChannelName): () => void {
  const path = ws.resolve(`.kaitu/channels/${name}/run.json`, { internal: true });
  mkdirSync(join(path, ".."), { recursive: true });
  try {
    const old = JSON.parse(readFileSync(path, "utf8")) as { pid: number };
    if (alive(old.pid)) throw new Error(`${name} 已在进程 ${old.pid} 运行`);
    rmSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  writeFileSync(path, JSON.stringify({ pid: process.pid }), { flag: "wx", mode: 0o600 });
  return () => rmSync(path, { force: true });
}
