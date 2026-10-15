import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { localStateRoot } from "./drive.js";
import { KaituError } from "./errors.js";
import type { Workspace } from "./workspace.js";

function mediaType(bytes: Uint8Array): string {
  const b = Buffer.from(bytes);
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  throw new KaituError("请选择 JPG、PNG 或 WebP 图片", "INVALID_AVATAR");
}

function avatarPath(ws: Workspace, create = false): string | null {
  const file = ".kaitu/secrets.json";
  const secrets = ws.exists(file) ? ws.readJson<Record<string, unknown>>(file) : {};
  let id = secrets.avatar_id;
  if (id === undefined && create) {
    id = randomUUID();
    ws.writeJson(file, { ...secrets, avatar_id: id }, { internal: true, mode: 0o600 });
  }
  if (id === undefined) return null;
  if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id))
    throw new KaituError("头像存储位置不合法", "INVALID_AVATAR");
  return join(localStateRoot(), "avatars", id, "avatar.jpg");
}

export function readAvatar(ws: Workspace): string | null {
  const path = avatarPath(ws);
  if (!path || !existsSync(path)) return null;
  const bytes = readFileSync(path);
  return `data:${mediaType(bytes)};base64,${bytes.toString("base64")}`;
}

export function saveAvatar(ws: Workspace, bytes: Uint8Array): void {
  if (bytes.byteLength > 2 * 1024 * 1024) throw new KaituError("头像不能超过 2MB", "INVALID_AVATAR");
  mediaType(bytes);
  const path = avatarPath(ws, true) as string;
  mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 });
  const temp = `${path}.tmp`;
  writeFileSync(temp, bytes, { mode: 0o600 });
  renameSync(temp, path);
}

export function removeAvatar(ws: Workspace): void {
  const path = avatarPath(ws);
  if (path) rmSync(path, { force: true });
}
