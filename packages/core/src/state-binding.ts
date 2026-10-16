import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { KaituError } from "./errors.js";
import { localStateRoot } from "./local-state.js";
import { readWorkspaceConfig } from "./sync-files.js";

interface Binding {
  id: string;
  state: string;
  mode: "local" | "drive" | "icloud";
}
function bindingFile(root: string): string {
  const identity = existsSync(root) ? realpathSync(root) : resolve(root);
  return join(localStateRoot(), "workspaces", `${createHash("sha256").update(identity).digest("hex")}.json`);
}
export function setStateBinding(
  root: string,
  state: string,
  mode: Binding["mode"],
  identity?: string,
): Binding {
  const file = bindingFile(root);
  const old = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Binding) : undefined;
  const binding = { id: identity ?? old?.id ?? randomUUID(), state, mode };
  mkdirSync(join(localStateRoot(), "workspaces"), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(binding), { mode: 0o600 });
  renameSync(temp, file);
  return binding;
}
export function stateBinding(root: string, icloud?: boolean): Binding {
  const file = bindingFile(root);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as Binding;
  const fallback: Binding = { id: "", state: join(root, ".kaitu"), mode: "local" };
  if (!existsSync(join(root, ".kaitu/config.json"))) return fallback;
  const config = join(root, ".kaitu/config.json");
  const rel = relative(realpathSync(root), realpathSync(config));
  if (rel === ".." || rel.startsWith("../") || isAbsolute(rel))
    throw new KaituError("工作区配置不能指向外部文件", "OUT_OF_SCOPE");
  const legacy = readWorkspaceConfig(root, icloud).state_dir;
  if (legacy !== undefined) {
    if (typeof legacy !== "string" || !isAbsolute(legacy))
      throw new KaituError("state_dir 必须是本机绝对路径", "INVALID_STATE_DIR");
    const rel = relative(localStateRoot(), legacy);
    if (rel === ".." || rel.startsWith("../") || isAbsolute(rel))
      throw new KaituError("旧状态目录不在本机状态根目录下，请先迁移资料", "INVALID_STATE_DIR");
    fallback.state = legacy;
    const marker = join(legacy, "sync-location.json");
    const mode = existsSync(marker) ? JSON.parse(readFileSync(marker, "utf8")).mode : "drive";
    fallback.mode = mode === "icloud" ? "icloud" : "drive";
  }
  return setStateBinding(root, fallback.state, fallback.mode);
}
