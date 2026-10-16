import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export class LocalStore {
  constructor(readonly root: string) {}
  read<T>(key: string, fallback: T): T {
    const file = join(this.root, `${hash(key)}.json`);
    return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : fallback;
  }
  write(key: string, value: unknown): void {
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    chmodSync(this.root, 0o700);
    const file = join(this.root, `${hash(key)}.json`);
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temp, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: "wx" });
      renameSync(temp, file);
    } finally {
      rmSync(temp, { force: true });
    }
  }
  remove(key: string): void {
    rmSync(join(this.root, `${hash(key)}.json`), { force: true });
  }
  lock(key: string): (() => void) | undefined {
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const file = join(this.root, `${hash(key)}.lock`);
    if (existsSync(file)) {
      const pid = Number(readFileSync(file, "utf8"));
      if (!Number.isSafeInteger(pid) || pid <= 0) return;
      try {
        process.kill(pid, 0);
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") return;
        rmSync(file, { force: true });
      }
    }
    let fd: number;
    try {
      fd = openSync(file, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return;
      throw error;
    }
    writeFileSync(fd, String(process.pid));
    return () => {
      closeSync(fd);
      rmSync(file, { force: true });
    };
  }
}
