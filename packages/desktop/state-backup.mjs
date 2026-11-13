import { execFileSync } from "node:child_process";
// Fixed-host preflight. Never load a feature payload or DSH before this completes.
import { createHash, randomUUID } from "node:crypto";
import {
  constants,
  chmodSync,
  closeSync,
  copyFileSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const within = (root, path) => {
  const part = relative(root, path);
  return part === "" || (!isAbsolute(part) && part !== ".." && !part.startsWith(`..${sep}`));
};

const receiptName = "dsh-upgrade.json";
const digest = (value) => createHash("sha256").update(value).digest("hex");
const failure = (message) =>
  Object.assign(new Error(message), { name: "KaituError", code: "DSH_STATE_UNSAFE" });
const present = (path) => {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
};

export function scheduleVersion(home) {
  for (const path of [home, join(home, "storages")])
    if (present(path)?.isSymbolicLink())
      throw failure("日程目录不能是链接 / Schedule directory cannot be a symbolic link");
  const path = join(home, "storages/schedule.json");
  if (!present(path)) return null;
  if (!lstatSync(path).isFile()) throw failure("日程文件不可读取 / Schedule storage is not a regular file");
  let value;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw failure("日程文件已损坏，请恢复备份 / Schedule file is damaged. Restore a backup.");
  }
  if (
    value?.unit?.name !== "schedule" ||
    ![1, 2].includes(value.unit.version) ||
    !value.tables ||
    typeof value.tables !== "object" ||
    Array.isArray(value.tables)
  )
    throw failure("日程格式无法识别 / Unrecognized schedule storage version");
  return value.unit.version;
}

export function assertScheduleCompatible(home, version) {
  const [major, minor, patch] = version.split(/[.-]/).map(Number);
  const supported = major > 0 || minor > 2 || (minor === 2 && patch >= 2) ? 2 : 1;
  const stored = scheduleVersion(home);
  if (stored !== null && stored > supported)
    throw failure(
      "自动任务不能读取新版日程。请使用新版开图，或恢复升级前备份 / Automation cannot read newer schedules. Use the newer Kaitu or restore the pre-upgrade backup.",
    );
}

// Do not follow links: dependency links and user links must retain their exact targets.
export function stateInventory(root) {
  const result = [];
  const buffer = Buffer.alloc(1024 * 1024);
  const visit = (relative) => {
    const path = join(root, relative);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      result.push({
        path: relative,
        type: "link",
        target: readlinkSync(path),
        ...(process.platform === "win32" ? { directory: statSync(path).isDirectory() } : {}),
      });
    } else if (stat.isDirectory()) {
      result.push({ path: relative, type: "directory", mode: stat.mode & 0o777 });
      for (const name of readdirSync(path).sort()) visit(relative ? `${relative}/${name}` : name);
    } else if (stat.isFile()) {
      const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const opened = fstatSync(fd);
        if (opened.ino !== stat.ino || opened.size !== stat.size)
          throw failure("备份时文件发生变化 / State changed during backup");
        const hash = createHash("sha256");
        for (;;) {
          const bytes = readSync(fd, buffer, 0, buffer.length, null);
          if (!bytes) break;
          hash.update(buffer.subarray(0, bytes));
        }
        result.push({
          path: relative,
          type: "file",
          mode: stat.mode & 0o777,
          size: stat.size,
          sha256: hash.digest("hex"),
        });
      } finally {
        closeSync(fd);
      }
    } else
      throw failure(
        "状态目录仍有运行中的文件。请退出其他开图和 DSH 后重试 / State contains runtime files. Quit other Kaitu and DSH processes and retry.",
      );
  };
  if (present(root)) visit("");
  return result;
}

// Scan only process names and ancestry, never arguments, environment or credentials.
export function assertHostsStopped(progressPid) {
  let rows;
  if (process.platform === "win32") {
    const raw = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress",
      ],
      { encoding: "utf8" },
    );
    rows = JSON.parse(raw);
    if (!Array.isArray(rows)) rows = [rows];
    rows = rows.map((row) => ({ pid: row.ProcessId, parent: row.ParentProcessId, name: row.Name }));
  } else {
    rows = execFileSync("/bin/ps", ["-axo", "pid=,ppid=,comm="], { encoding: "utf8" })
      .trim()
      .split("\n")
      .map((line) => {
        const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
        if (!match) throw failure("无法检查运行中的宿主 / Cannot inspect running hosts");
        return { pid: Number(match[1]), parent: Number(match[2]), name: basename(match[3]) };
      });
  }
  const ancestors = new Set([process.pid]);
  let pid = process.pid;
  while (pid > 1) {
    const row = rows.find((entry) => entry.pid === pid);
    if (!row || ancestors.has(row.parent)) break;
    ancestors.add(row.parent);
    pid = row.parent;
  }
  const progressProcesses = new Set(progressPid ? [progressPid] : []);
  for (let size = -1; size !== progressProcesses.size; ) {
    size = progressProcesses.size;
    for (const row of rows) if (progressProcesses.has(row.parent)) progressProcesses.add(row.pid);
  }
  if (
    rows.some(
      (row) =>
        !ancestors.has(row.pid) &&
        !progressProcesses.has(row.pid) &&
        /^(?:Kaitu|DSH|DeepSeek Harness)(?: Helper.*)?(?:\.exe)?$/.test(row.name),
    )
  )
    throw failure(
      "请退出其他开图和 DeepSeek Harness 后重试升级 / Quit other Kaitu and DeepSeek Harness processes before retrying the upgrade.",
    );
}

function copyInventory(source, destination, entries, progress = () => {}) {
  let completed = 0;
  for (const entry of entries) {
    progress({ phase: "copy", completed: completed++, total: entries.length });
    const target = join(destination, entry.path);
    if (entry.type === "directory") mkdirSync(target, { mode: 0o700 });
    else if (entry.type === "link")
      symlinkSync(
        entry.target,
        target,
        process.platform === "win32"
          ? entry.directory
            ? isAbsolute(entry.target)
              ? "junction"
              : "dir"
            : "file"
          : undefined,
      );
    else {
      copyFileSync(join(source, entry.path), target, constants.COPYFILE_EXCL);
      // Preserve mode for executable payloads; the enclosing snapshot directory stays private (0700).
      chmodSync(target, 0o600);
      const fd = openSync(target, "r+");
      try {
        chmodSync(target, entry.mode);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
    }
  }
  for (const entry of [...entries].reverse())
    if (entry.type === "directory") {
      chmodSync(join(destination, entry.path), entry.mode);
      syncDirectory(join(destination, entry.path));
    }
}

function syncDirectory(path) {
  // Windows does not expose directory fsync through Node; file flushes still precede publication.
  if (process.platform === "win32") return;
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function writeJson(path, value) {
  const fd = openSync(path, "wx", 0o600);
  try {
    writeFileSync(fd, JSON.stringify(value));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function readManifest(backup) {
  const manifest = JSON.parse(readFileSync(join(backup, "manifest.json"), "utf8"));
  if (manifest.version !== 1 || !Array.isArray(manifest.entries) || !isAbsolute(manifest.source))
    throw failure("备份清单无效 / Invalid backup manifest");
  if (JSON.stringify(stateInventory(join(backup, "state"))) !== JSON.stringify(manifest.entries))
    throw failure("备份校验失败 / Backup verification failed");
  return manifest;
}

function assertDefaultStorage(root) {
  // Inspect profile configuration only, not installed plugin dependency trees.
  for (const home of [root, join(root, "ai")]) {
    const profiles = join(home, "profiles");
    if (!present(profiles)) continue;
    if (!lstatSync(profiles).isDirectory())
      throw failure("配置目录不可备份 / Profile directory cannot be backed up");
    for (const name of readdirSync(profiles)) {
      const profile = join(profiles, name);
      const type = lstatSync(profile);
      if (type.isSymbolicLink())
        throw failure(
          "自定义配置链接不支持自动升级 / Linked profiles are not supported by automatic upgrade",
        );
      if (!type.isDirectory()) continue;
      for (const config of ["cordis.yml", "cordis.patch.yml"]) {
        const path = join(profile, config);
        if (!present(path)) continue;
        if (!lstatSync(path).isFile())
          throw failure(
            "自定义配置链接不支持自动升级 / Linked profiles are not supported by automatic upgrade",
          );
        if (/(?:storage-json|dsh-storage|id["']?\s*:\s*["']?storage\b)/i.test(readFileSync(path, "utf8")))
          throw failure(
            "自定义存储配置不支持自动升级，请先导出状态 / Custom storage configuration requires a separate state export before upgrade",
          );
      }
    }
  }
}

export function backupStateRoot(state, parent) {
  if (!parent) return state;
  if (!isAbsolute(parent) || ![resolve(parent), join(resolve(parent), "ai")].includes(resolve(state)))
    throw failure("后台宿主状态位置不属于备份目录 / Background host state is outside the protected root");
  return parent;
}

export function prepareDshState(state, version, { progress = () => {}, progressPid } = {}) {
  progress({ phase: "check" });
  if (!isAbsolute(state)) throw failure("状态位置必须是绝对路径 / State path must be absolute");
  const root = present(state) ? realpathSync(state) : resolve(realpathSync(dirname(state)), basename(state));
  if (present(state)?.isSymbolicLink())
    throw failure("状态根目录不能是链接 / State root cannot be a symbolic link");
  assertScheduleCompatible(root, version);
  if (present(join(root, "ai"))) assertScheduleCompatible(join(root, "ai"), version);
  // Older signed hosts may reuse this guard; they must not create a v2 upgrade receipt.
  if (!/^0\.2\.(?:[2-9]|\d{2,})(?:-|$)/.test(version)) return null;
  assertDefaultStorage(root);
  const receipt = join(root, receiptName);
  const backups = `${root}.backups`;
  if (present(receipt)) {
    const saved = JSON.parse(readFileSync(receipt, "utf8"));
    if (saved.version !== 1 || typeof saved.backup !== "string" || !/^before-dsh-[\w.-]+$/.test(saved.backup))
      throw failure("升级备份记录无效 / Invalid upgrade backup receipt");
    const backup = join(backups, saved.backup);
    if (digest(readFileSync(join(backup, "manifest.json"))) !== saved.sha256)
      throw failure("升级备份记录校验失败 / Upgrade backup receipt verification failed");
    const manifest = readManifest(backup);
    if (
      manifest.source !== root ||
      manifest.targetDshVersion !== version ||
      [join(backup, "state"), join(backup, "state/ai")].some((home) => scheduleVersion(home) === 2)
    )
      throw failure("备份不是此状态的升级前副本 / Backup is not this state's pre-upgrade snapshot");
    return backup;
  }
  if ([root, join(root, "ai")].some((home) => scheduleVersion(home) === 2))
    throw failure(
      "此状态已被新版写入，缺少升级前备份。请先恢复可验证的旧版备份 / This state already uses the newer format without a pre-upgrade backup. Restore a verified older backup first.",
    );
  assertHostsStopped(progressPid);
  if (present(backups)?.isSymbolicLink())
    throw failure("备份目录不能是链接 / Backup directory cannot be a symbolic link");
  mkdirSync(backups, { recursive: true, mode: 0o700 });
  syncDirectory(dirname(backups));
  const lock = join(backups, "upgrade.lock");
  // Never take over a stale lock automatically: its owner may still be writing.
  const fd = openSync(lock, "wx", 0o600);
  const name = `before-dsh-${version}-${Date.now()}-${randomUUID()}`;
  const temporary = join(backups, `.${name}.tmp`);
  const backup = join(backups, name);
  try {
    closeSync(fd);
    writeFileSync(lock, String(process.pid));
    mkdirSync(temporary, { mode: 0o700 });
    // A second launch may have completed while this process was acquiring the lock.
    if (present(receipt)) return prepareDshState(state, version, { progress, progressPid });
    if ([root, join(root, "ai")].some((home) => scheduleVersion(home) === 2))
      throw failure("状态在等待备份时已被新版写入 / State upgraded while waiting for the backup lock");
    progress({ phase: "scan" });
    const entries = stateInventory(root);
    for (const entry of entries) {
      if (entry.type !== "link") continue;
      const target = resolve(root, dirname(entry.path), entry.target);
      const internal = within(root, target);
      if (internal && isAbsolute(entry.target))
        throw failure(
          "状态含内部绝对链接，无法安全恢复到新位置 / State has absolute internal links that cannot be safely restored to a new location",
        );
      const runtime =
        /(?:^|\/)updates\/.*\/node_modules$/.test(entry.path) ||
        /(?:^|\/)Singleton(?:Lock|Cookie|Socket)$/.test(entry.path);
      if (!internal && !runtime)
        throw failure(
          "状态含外部资料链接，升级前无法完整备份 / State links to external data that cannot be fully backed up for this upgrade",
        );
    }
    if (entries.length) copyInventory(root, join(temporary, "state"), entries, progress);
    else mkdirSync(join(temporary, "state"), { mode: 0o700 });
    progress({ phase: "verify" });
    const copied = stateInventory(join(temporary, "state"));
    const expected = entries.length
      ? entries
      : [{ path: "", type: "directory", mode: lstatSync(join(temporary, "state")).mode & 0o777 }];
    if (
      JSON.stringify(copied) !== JSON.stringify(expected) ||
      JSON.stringify(stateInventory(root)) !== JSON.stringify(entries)
    )
      throw failure(
        "备份期间状态发生变化，请退出其他开图和 DSH 后重试 / State changed during backup. Quit other Kaitu and DSH processes and retry.",
      );
    assertHostsStopped(progressPid);
    writeJson(join(temporary, "manifest.json"), {
      version: 1,
      source: root,
      targetDshVersion: version,
      createdAt: new Date().toISOString(),
      entries: expected,
    });
    readManifest(temporary);
    syncDirectory(temporary);
    progress({ phase: "publish" });
    renameSync(temporary, backup);
    syncDirectory(backups);
    mkdirSync(root, { recursive: true, mode: 0o700 });
    syncDirectory(dirname(root));
    const pendingReceipt = join(root, `${receiptName}.${process.pid}.tmp`);
    writeJson(pendingReceipt, {
      version: 1,
      backup: name,
      sha256: digest(readFileSync(join(backup, "manifest.json"))),
    });
    renameSync(pendingReceipt, receipt);
    syncDirectory(root);
    return backup;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
    rmSync(lock, { force: true });
  }
}

// Recovery is deliberately offline and non-destructive: only create a new destination.
export function restoreDshState(backup, destination) {
  if (!isAbsolute(destination) || present(destination))
    throw failure("恢复位置必须是尚不存在的绝对路径 / Restore to a new absolute path");
  const manifest = readManifest(backup);
  if (
    manifest.entries.some(
      (entry) => entry.type === "link" && isAbsolute(entry.target) && within(manifest.source, entry.target),
    )
  )
    throw failure(
      "备份含指向原状态目录的绝对链接，不能恢复到新位置 / Backup has absolute links into its original state and cannot be restored to a new location",
    );
  const target = resolve(realpathSync(dirname(destination)), basename(destination));
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    mkdirSync(temporary, { mode: 0o700 });
    const restored = join(temporary, "state");
    copyInventory(join(backup, "state"), restored, manifest.entries);
    if (JSON.stringify(stateInventory(restored)) !== JSON.stringify(manifest.entries))
      throw failure("恢复校验失败 / Restore verification failed");
    if (present(target)) throw failure("恢复位置已存在 / Restore destination already exists");
    renameSync(restored, target);
    syncDirectory(dirname(target));
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
  return target;
}
