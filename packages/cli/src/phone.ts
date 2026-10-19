import { isUtf8 } from "node:buffer";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  type Stats,
  cpSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { runPhone } from "@kaitu/core/phone-run";
export { runPhone };
import { KaituError, type PhoneGenerator, phoneHistoryMetadata, stateDirectory } from "@kaitu/core/phone-run";

const stamp = (s: Stats) => `${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`;
const digest = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
type Original = { path: string; stamp: string; digest?: string };

function derivedFile(path: string) {
  return (
    path === "OVERVIEW.md" ||
    path === ".kaitu/inbox-state.json" ||
    path === ".kaitu/organizer.json" ||
    /^phone\/(week|map|library)\.json$/.test(path)
  );
}

function computerToday(path: string) {
  try {
    return JSON.parse(readFileSync(path, "utf8")).generator?.kind !== "agent";
  } catch {
    return false;
  }
}

export function phoneGenerator(name?: string): PhoneGenerator {
  if (name === undefined) return { kind: "computer" };
  if (!name.trim() || [...name].length > 32)
    throw new KaituError("--as 需要 1–32 个字的整理员名字", "BAD_ARGS");
  return { kind: "agent", name, spec: 1 };
}

function copy(
  source: string,
  target: string,
  originals: Map<string, Original>,
  scope: "workspace" | "state" | "inbox" = "workspace",
) {
  const stateName = /^(config|phone-actions|inbox-records|inbox-state|organizer|automation|dsh-setup)\.json$/;
  cpSync(source, target, {
    recursive: true,
    preserveTimestamps: true,
    filter: (path, destination) => {
      const rel = relative(source, path).replaceAll("\\", "/");
      if (rel.split("/").includes(".git")) return false;
      const info = lstatSync(path);
      if (info.isSymbolicLink()) throw new KaituError(`预览不跟随符号链接：${path}`, "OUT_OF_SCOPE");
      if (scope === "state" && rel && (!info.isFile() || !stateName.test(rel))) return false;
      if (scope === "workspace") {
        if (rel.startsWith(".kaitu/") && (!info.isFile() || !stateName.test(rel.slice(7)))) return false;
        // 仅排除内置健康照片目录和根依赖；合法模块、项目以及收件箱里的同名目录照常复制。
        if (rel === "health/files" || rel.startsWith("health/files/") || rel === "node_modules") return false;
      }
      if (info.isFile()) originals.set(destination, { path, stamp: stamp(info) });
      return true;
    },
  });
}

/** 预览在独立进程中使用相同的正式命令；所有工作区、本机状态和外部收件箱写入都留在临时目录。 */
export async function previewPhone(directory: string, generator: PhoneGenerator) {
  const root = resolve(directory);
  const temp = mkdtempSync(join(tmpdir(), "kaitu-phone-preview-"));
  try {
    const target = join(temp, "workspace");
    const originals = new Map<string, Original>();
    copy(root, target, originals);
    const state = stateDirectory(root, undefined, false);
    if (state !== join(root, ".kaitu") && existsSync(state))
      copy(state, join(target, ".kaitu"), originals, "state");
    const configFile = join(target, ".kaitu/config.json");
    const config = JSON.parse(readFileSync(join(root, ".kaitu/config.json"), "utf8"));
    const originalConfig = originals.get(configFile);
    if (originalConfig) originalConfig.digest = digest(originalConfig.path);
    config.state_dir = undefined;
    config.health_inbox_external = (config.health_inbox_external ?? []).map(
      (source: string, index: number) => {
        const dest = join(temp, `health-${index}`);
        if (existsSync(source)) copy(source, dest, originals, "inbox");
        return dest;
      },
    );
    writeFileSync(configFile, JSON.stringify(config));
    const contents = () =>
      new Map(
        readdirSync(target, { recursive: true, withFileTypes: true })
          .filter(
            (e) =>
              e.isFile() && !relative(target, join(e.parentPath, e.name)).startsWith(".kaitu/history.git/"),
          )
          .map((e) => {
            const abs = join(e.parentPath, e.name);
            return [relative(target, abs), stamp(statSync(abs))] as const;
          }),
      );
    const before = contents();
    const history = await phoneHistoryMetadata(root, state);
    const input = join(temp, "input.json");
    const inputs = Object.fromEntries([...originals.keys()].map((path) => [path, stamp(statSync(path))]));
    const wasComputerToday =
      existsSync(join(target, "phone/today.json")) && computerToday(join(target, "phone/today.json"));
    writeFileSync(input, JSON.stringify({ root: target, generator, history, inputs }));
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [fileURLToPath(new URL("./phone-worker.js", import.meta.url)), input],
      {
        env: {
          ...process.env,
          KAITU_LOCAL_STATE_DIR: join(temp, "state"),
          KAITU_APP_HOME: join(temp, "app"),
        },
        maxBuffer: 32 * 1024 * 1024,
      },
    );
    const { readDependencies, ...result } = JSON.parse(stdout);
    const after = contents();
    // 保护实际读过的输入和将要覆盖的原件。派生刷新不使预览失效，Agent today 仍是来源输入。
    const checked = new Set<string>([
      ...Object.keys(readDependencies),
      ...[...before.keys()]
        .filter((path) => before.get(path) !== after.get(path))
        .map((path) => join(target, path)),
    ]);
    for (const path of checked) {
      const original = originals.get(path);
      if (!original) continue;
      const rel = relative(target, path).replaceAll("\\", "/");
      if (derivedFile(rel)) continue;
      if (rel === "phone/today.json" && wasComputerToday && computerToday(original.path)) continue;
      const current = statSync(original.path, { throwIfNoEntry: false });
      if (
        !current ||
        (original.stamp !== stamp(current) &&
          (original.digest ?? readDependencies[path]) !== digest(original.path))
      )
        throw new KaituError("预览期间原资料变化，请重新预览", "CONFLICT");
    }
    const changes = [...new Set([...before.keys(), ...after.keys()])].sort().flatMap((path) => {
      if (before.get(path) === after.get(path)) return [];
      const source = originals.get(join(target, path))?.path;
      const old = source ? readFileSync(source) : undefined;
      const next = after.has(path) ? readFileSync(join(target, path)) : undefined;
      if (old && next && old.equals(next)) return [];
      // 状态和版本对象只列路径，不打印可能包含凭据的本机内容。
      return [
        {
          path,
          ...(path.startsWith(".kaitu/")
            ? {}
            : [old, next].some((bytes) => bytes && (!isUtf8(bytes) || bytes.includes(0)))
              ? { beforeBytes: old?.length ?? null, afterBytes: next?.length ?? null }
              : { before: old?.toString("utf8") ?? null, after: next?.toString("utf8") ?? null }),
        },
      ];
    });
    if (result.historyChanged) changes.push({ path: ".kaitu/history.git" });
    return { ...result, changes };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

export function phonePreviewText(result: Awaited<ReturnType<typeof previewPhone>>) {
  return result.changes
    .map(
      (change: {
        path: string;
        before?: string | null;
        after?: string | null;
        beforeBytes?: number | null;
        afterBytes?: number | null;
      }) => {
        const diff = [
          change.before
            ?.split("\n")
            .map((line) => `-${line}`)
            .join("\n"),
          change.after
            ?.split("\n")
            .map((line) => `+${line}`)
            .join("\n"),
        ]
          .filter(Boolean)
          .join("\n");
        const binary =
          "afterBytes" in change ? `\n${change.beforeBytes ?? 0} → ${change.afterBytes ?? 0} bytes` : "";
        return `--- ${change.path}\n+++ ${change.path}${diff ? `\n${diff}` : binary}`;
      },
    )
    .join("\n\n");
}
