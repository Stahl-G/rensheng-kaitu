import { createHash, randomUUID } from "node:crypto";
import {
  constants,
  closeSync,
  fstatSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { stateBinding } from "../state-binding.js";
import { Workspace } from "../workspace.js";

export const library = "资料";
export const incoming = "收件箱";
const marker = "RELAY.txt";
const temporaryName = /^\.baidu-[a-f0-9-]{36}\.tmp$/;
export const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";

function inside(root: string, file: string) {
  const rel = relative(root, file);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}

// The caller supplies fixed directory components, or a slug validated by projectDirectory.
export function directory(root: string, parts: string[], create = false) {
  let current = root;
  for (const part of parts) {
    current = join(current, part);
    if (create) {
      try {
        mkdirSync(current, { mode: 0o700 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
    if (!lstatSync(current).isDirectory()) throw new Error("所选路径包含链接或非目录项");
  }
  return current;
}

export function openRelay(workspace: string, relay: string) {
  const root = realpathSync.native(workspace);
  const sync = realpathSync.native(relay);
  if (inside(root, sync) || inside(sync, root)) throw new Error("请分别选择开图工作区与独立的网盘接力目录");
  const config = join(directory(root, [".kaitu"]), "config.json");
  const configStat = lstatSync(config);
  if (!configStat.isFile() || configStat.nlink !== 1) throw new Error("请选择已有开图工作区");
  const ws = new Workspace(root, { maintain: false });
  const identity = stateBinding(root).id;
  if (!identity) throw new Error("工作区缺少本机登记");
  // An opaque per-provider pairing prevents routing another workspace's replies here.
  const markerText = `开图 · 百度网盘接力 v1\n${hash(`baidu-netdisk\0${identity}`)}\n`;
  const markerFile = join(sync, marker);
  const paired = Boolean(lstatSync(markerFile, { throwIfNoEntry: false }));
  if (paired && plainFile(markerFile, 512, sync) !== markerText)
    throw new Error("此接力目录属于另一工作区或配对文件已变化");
  const systemFiles = [".DS_Store", "desktop.ini", "Thumbs.db"];
  for (const entry of readdirSync(sync, { withFileTypes: true })) {
    if (entry.isFile() && systemFiles.includes(entry.name)) continue;
    if (entry.name === marker && paired) continue;
    if (entry.isFile() && temporaryName.test(entry.name)) continue;
    if (!paired || !entry.isDirectory() || ![library, incoming].includes(entry.name))
      throw new Error("请选择空的专用目录，或已有的百度网盘接力目录");
  }
  return { ws, sync, markerFile, markerText };
}
export type Relay = ReturnType<typeof openRelay>;

// Never follow a link or read a device/pipe. Compare the open handle to the checked file,
// including on Windows where O_NOFOLLOW may be unavailable.
export function plainFile(file: string, maxBytes: number, staging?: string) {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.size > maxBytes) throw new Error("文件须为限定大小内的独立普通文件");
  // A stopped local writer may leave its temporary link alongside a completed
  // destination. Accept exactly that pair on retries; external inputs still require one link.
  if (stat.nlink !== 1) {
    const ownPair =
      stat.nlink === 2 &&
      staging &&
      readdirSync(staging).some((name) => {
        if (!temporaryName.test(name)) return false;
        const temp = lstatSync(join(staging, name), { throwIfNoEntry: false });
        return temp?.isFile() && temp.dev === stat.dev && temp.ino === stat.ino;
      });
    if (!ownPair && lstatSync(file).nlink !== 1) throw new Error("文件含其他硬链接");
  }
  const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const opened = fstatSync(fd);
    if (
      opened.dev !== stat.dev ||
      opened.ino !== stat.ino ||
      opened.size !== stat.size ||
      (!staging && opened.ctimeMs !== stat.ctimeMs)
    )
      throw new Error("文件正在变化，请稍后重试");
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, null);
      if (!count) break;
      offset += count;
    }
    const after = fstatSync(fd);
    if (
      offset !== stat.size ||
      after.size !== stat.size ||
      after.mtimeMs !== opened.mtimeMs ||
      (!staging && after.ctimeMs !== opened.ctimeMs)
    )
      throw new Error("文件正在变化，请稍后重试");
    if (bytes.includes(0)) throw new Error("需要 UTF-8 文本");
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } finally {
    closeSync(fd);
  }
}

// Same-volume, create-only publication, also used by core's memory capture. A crash
// can leave an ignored temporary file. Never replace or remove a destination.
export function appendFile(file: string, content: string) {
  const match = () => {
    if (plainFile(file, Buffer.byteLength(content), dirname(file)) !== content)
      throw new Error("同名文件内容不同，请保留原件并使用新的交接编号");
    return false;
  };
  try {
    return match();
  } catch (error) {
    if (!missing(error)) throw error;
  }
  const temp = join(dirname(file), `.baidu-${randomUUID()}.tmp`);
  const fd = openSync(temp, "wx", 0o600);
  try {
    try {
      writeFileSync(fd, content);
    } finally {
      closeSync(fd);
    }
    try {
      linkSync(temp, file);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      return match();
    }
  } finally {
    unlinkSync(temp);
  }
}
