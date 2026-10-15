import { AsyncLocalStorage } from "node:async_hooks";
import { join, normalize } from "node:path";
import { KaituError } from "./errors.js";
import { schemas } from "./schema.js";
import { type Workspace, stateDirectory } from "./workspace.js";

export interface LeaseLock {
  holder: string;
  purpose: string;
  acquired_at: string;
  expires_at: string;
}

export function readLock(ws: Workspace): LeaseLock | null {
  if (!ws.exists("LOCK.json")) return null;
  try {
    const lock = ws.readJson<LeaseLock>("LOCK.json");
    if (!schemas().builtin("lock.schema.json")(lock)) throw new Error();
    if (Date.parse(lock.expires_at) < Date.parse(lock.acquired_at)) throw new Error();
    return lock;
  } catch {
    throw new KaituError("LOCK.json 格式错误，请先检查", "INVALID_LOCK");
  }
}

function driveMode(ws: Workspace): boolean {
  return stateDirectory(ws.root) !== join(ws.root, ".kaitu");
}

function busy(holder: string): never {
  throw new KaituError(`${holder} 正在更新，稍后再试`, "LOCK_BUSY");
}

export function acquireLock(ws: Workspace, holder: string, purpose: string): LeaseLock | null {
  if (!driveMode(ws)) return null;
  const previous = readLock(ws);
  if (previous && Date.parse(previous.expires_at) > Date.now()) busy(previous.holder);
  const now = Date.now();
  const lock = {
    holder,
    purpose,
    acquired_at: new Date(now).toISOString(),
    expires_at: new Date(now + 15 * 60000).toISOString(),
  };
  if (!schemas().builtin("lock.schema.json")(lock))
    throw new KaituError("锁的 holder 和 purpose 不能为空", "INVALID_LOCK");
  ws.writeJson("LOCK.json", lock);
  // 本机重读只能发现本机其他进程；云端改动要等 Drive 同步，等待也看不到，所以不阻塞。
  const confirmed = readLock(ws);
  if (!sameLease(confirmed, lock) || Date.parse(confirmed?.expires_at ?? "") <= Date.now())
    busy(confirmed?.holder ?? "其他 Agent");
  return lock;
}

function sameLease(current: LeaseLock | null, own: LeaseLock): boolean {
  return current?.holder === own.holder && current.acquired_at === own.acquired_at;
}

export function releaseLock(ws: Workspace, lock: LeaseLock | null): void {
  if (!lock) return;
  const current = readLock(ws);
  if (sameLease(current, lock))
    ws.writeJson("LOCK.json", { ...current, expires_at: new Date().toISOString() });
}

const active = new AsyncLocalStorage<{ ws: Workspace; lock: LeaseLock | null }>();

/** 在整个读、改、写期间持锁；嵌套写入复用当前操作的租约。 */
export function withStateLock<T>(ws: Workspace, purpose: string, operation: () => T): T {
  if (!driveMode(ws)) return operation();
  const context = active.getStore();
  if (context?.ws === ws && context.lock) {
    const current = readLock(ws);
    if (!sameLease(current, context.lock) || Date.parse(current?.expires_at ?? "") <= Date.now())
      busy(current?.holder ?? "其他 Agent");
    if (Date.now() - Date.parse(context.lock.acquired_at) > 10 * 60000) {
      context.lock.expires_at = new Date(Date.now() + 15 * 60000).toISOString();
      ws.writeJson("LOCK.json", context.lock);
    }
    return operation();
  }
  const lock = acquireLock(ws, "kaitu-local", purpose);
  return active.run({ ws, lock }, () => {
    try {
      const result = operation();
      if (result instanceof Promise) return result.finally(() => releaseLock(ws, lock)) as T;
      releaseLock(ws, lock);
      return result;
    } catch (error) {
      releaseLock(ws, lock);
      throw error;
    }
  });
}

export function isStateFile(file: string): boolean {
  const path = normalize(file).replace(/\\/g, "/");
  return path === "NOW.md" || path === "STATUS.md" || path.endsWith("/STATUS.md");
}

export function lockUnavailable(error: unknown): boolean {
  return error instanceof KaituError && ["LOCK_BUSY", "INVALID_LOCK"].includes(error.code);
}
