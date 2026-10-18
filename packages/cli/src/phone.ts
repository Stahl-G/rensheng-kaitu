import { execFile } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import {
  KaituError,
  type PhoneGenerator,
  Workspace,
  externalHealthPaths,
  phoneReceipts,
  processInbox,
  stateDirectory,
  writePhoneSnapshots,
} from "@kaitu/core";

export function phoneGenerator(name?: string): PhoneGenerator {
  if (name === undefined) return { kind: "computer" };
  if (!name.trim() || [...name].length > 32)
    throw new KaituError("--as 需要 1–32 个字的整理员名字", "BAD_ARGS");
  return { kind: "agent", name, spec: 1 };
}

function hasInboxFiles(ws: Workspace) {
  return (
    ["inbox/agents", "inbox/health", "inbox/rejected"].some(
      (dir) =>
        ws.exists(dir) &&
        readdirSync(ws.resolve(dir), { withFileTypes: true }).some(
          (e) => e.isFile() && !e.name.endsWith(".tmp") && e.name !== ".DS_Store",
        ),
    ) ||
    externalHealthPaths(ws).some(
      (dir) => existsSync(dir) && readdirSync(dir).some((f) => f.endsWith(".health.json")),
    )
  );
}

export async function runPhone(root: string, generator: PhoneGenerator) {
  const ws = new Workspace(root, { maintain: false });
  if (!ws.exists(".kaitu/config.json")) throw new KaituError("先运行 kaitu init", "NOT_INITIALIZED");
  const inbox = hasInboxFiles(ws) ? await processInbox(ws) : { processed: [], notes: [], pending: [] };
  const snapshots = await writePhoneSnapshots(ws, new Date(), { force: true, generator });
  return { inbox, snapshots, receipts: phoneReceipts(ws) };
}

function copy(source: string, target: string) {
  cpSync(source, target, {
    recursive: true,
    preserveTimestamps: true,
    filter: (path) => {
      if (relative(source, path).split(/[\\/]/).includes(".git")) return false;
      if (lstatSync(path).isSymbolicLink())
        throw new KaituError(`预览不跟随符号链接：${path}`, "OUT_OF_SCOPE");
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
    copy(root, target);
    const state = stateDirectory(root, undefined, false);
    if (state !== join(root, ".kaitu") && existsSync(state)) copy(state, join(target, ".kaitu"));
    const configFile = join(target, ".kaitu/config.json");
    const config = JSON.parse(readFileSync(join(root, ".kaitu/config.json"), "utf8"));
    config.state_dir = undefined;
    config.health_inbox_external = (config.health_inbox_external ?? []).map(
      (source: string, index: number) => {
        const dest = join(temp, `health-${index}`);
        if (existsSync(source)) copy(source, dest);
        return dest;
      },
    );
    writeFileSync(configFile, JSON.stringify(config));
    const contents = () =>
      new Map(
        readdirSync(target, { recursive: true, withFileTypes: true })
          .filter((e) => e.isFile())
          .map((e) => {
            const file = relative(target, join(e.parentPath, e.name));
            return [file, readFileSync(join(target, file))] as const;
          }),
      );
    const before = contents();
    const args = [process.argv[1] as string, "phone", "run", "--dir", target, "--json-out"];
    if (generator.kind === "agent") args.push("--as", generator.name);
    const { stdout } = await promisify(execFile)(process.execPath, args, {
      env: { ...process.env, KAITU_LOCAL_STATE_DIR: join(temp, "state"), KAITU_APP_HOME: join(temp, "app") },
      maxBuffer: 32 * 1024 * 1024,
    });
    const after = contents();
    const changes = [...new Set([...before.keys(), ...after.keys()])].sort().flatMap((path) => {
      const old = before.get(path);
      const next = after.get(path);
      if (old && next && old.equals(next)) return [];
      // 状态和版本对象只列路径，不打印可能包含凭据的本机内容。
      return [
        {
          path,
          ...(path.startsWith(".kaitu/")
            ? {}
            : { before: old?.toString("utf8") ?? null, after: next?.toString("utf8") ?? null }),
        },
      ];
    });
    return { ...JSON.parse(stdout), changes };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

export function phonePreviewText(result: Awaited<ReturnType<typeof previewPhone>>) {
  return result.changes
    .map((change: { path: string; before?: string | null; after?: string | null }) => {
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
      return `--- ${change.path}\n+++ ${change.path}${diff ? `\n${diff}` : ""}`;
    })
    .join("\n\n");
}
