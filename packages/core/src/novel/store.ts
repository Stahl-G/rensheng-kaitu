import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { dirname, join } from "node:path";

export const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
export const id = () => randomUUID();
export function readStore<T>(file: string, initial: () => T): { value: T; revision: string } {
  const raw = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  return { value: raw ? (JSON.parse(raw) as T) : initial(), revision: hash(raw) };
}
// A single sidecar contains the data and its undo log, so a rename commits both.
export function changeStore<T, R>(
  file: string,
  initial: () => T,
  revision: string,
  edit: (value: T) => R,
): R {
  fs.mkdirSync(dirname(file), { recursive: true });
  const lock = `${file}.lock`;
  let fd: number;
  try {
    fd = fs.openSync(lock, "wx", 0o600);
  } catch {
    throw new Error("资料正在修改，请刷新后重试");
  }
  const temp = join(dirname(file), `.${id()}.tmp`);
  try {
    const current = readStore(file, initial);
    if (current.revision !== revision) throw new Error("资料已变化，请刷新后核对差异");
    const result = edit(current.value);
    fs.writeFileSync(temp, `${JSON.stringify(current.value, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temp, file);
    return result;
  } finally {
    fs.closeSync(fd);
    fs.unlinkSync(lock);
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}
