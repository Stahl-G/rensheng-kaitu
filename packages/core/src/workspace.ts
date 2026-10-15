import { randomBytes } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { ScopeError } from "./errors.js";
import { parseFrontmatter } from "./frontmatter.js";
import { assertTimeZone } from "./time.js";

export const STATE_DIR = ".kaitu";

/** 默认数据目录：--dir > KAITU_DIR > ~/kaitu */
export function defaultRoot(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(env.KAITU_DIR || join(homedir(), "kaitu"));
}

function isSymlink(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

/**
 * 工作区：所有读写都经过这里，保证不会写出 root。
 * `.kaitu/` 只允许程序内部通过 { internal: true } 写入。
 */
export class Workspace {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  /** 把相对路径解析为绝对路径，并检查是否在工作区内（含符号链接逃逸）。 */
  resolve(rel: string, opts: { internal?: boolean } = {}): string {
    if (isAbsolute(rel)) throw new ScopeError(`只接受工作区内的相对路径：${rel}`);
    const abs = resolve(this.root, rel);
    if (!isInside(this.root, abs)) throw new ScopeError(`路径超出工作区：${rel}`);
    const top = relative(this.root, abs).split(sep)[0];
    if (top === STATE_DIR && !opts.internal) throw new ScopeError(`.kaitu/ 由程序管理，不能直接写入：${rel}`);
    if (top === ".git") throw new ScopeError(`不能写入版本库目录：${rel}`);
    this.assertNoSymlinkEscape(abs);
    return abs;
  }

  /** 从目标向上找到第一个已存在的路径，确认其真实位置仍在工作区内。 */
  private assertNoSymlinkEscape(abs: string): void {
    if (!existsSync(this.root)) return;
    const realRoot = realpathSync(this.root);
    let probe = abs;
    while (!existsSync(probe) && !isSymlink(probe)) {
      const parent = dirname(probe);
      if (parent === probe) return;
      probe = parent;
    }
    const real = isSymlink(probe) && !existsSync(probe) ? null : realpathSync(probe);
    if (real === null || !isInside(realRoot, real)) {
      throw new ScopeError(`路径经符号链接指向工作区外：${relative(this.root, abs)}`);
    }
  }

  exists(rel: string): boolean {
    return existsSync(join(this.root, rel));
  }

  readText(rel: string): string {
    return readFileSync(this.resolve(rel, { internal: true }), "utf8");
  }

  readJson<T = unknown>(rel: string): T {
    return JSON.parse(this.readText(rel)) as T;
  }

  /** 原子写入：先写临时文件再改名。 */
  writeText(
    rel: string,
    content: string | Uint8Array,
    opts: { internal?: boolean; mode?: number } = {},
  ): void {
    const abs = this.resolve(rel, opts);
    mkdirSync(dirname(abs), { recursive: true });
    const tmp = `${abs}.${randomBytes(4).toString("hex")}.tmp`;
    writeFileSync(tmp, content, { mode: opts.mode ?? 0o644 });
    renameSync(tmp, abs);
  }

  writeJson(rel: string, value: unknown, opts: { internal?: boolean; mode?: number } = {}): void {
    this.writeText(rel, `${JSON.stringify(value, null, 2)}\n`, opts);
  }

  appendLine(rel: string, line: string): void {
    const abs = this.resolve(rel);
    mkdirSync(dirname(abs), { recursive: true });
    appendFileSync(abs, `${line}\n`);
  }

  /** 用户时区：me/rules.md 的 timezone，缺省用系统时区。 */
  timeZone(): string {
    if (this.exists("me/rules.md")) {
      const tz = parseFrontmatter<{ timezone?: unknown }>(this.readText("me/rules.md")).data.timezone;
      if (typeof tz === "string" && tz) {
        assertTimeZone(tz);
        return tz;
      }
    }
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  }
}
