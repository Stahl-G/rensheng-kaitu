import { createHash, verify } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { unzipSync } from "fflate";
import semver from "semver";
import { DSH_VERSION, HOST_API, activate, rollback, selection, updateRoot } from "./payload-loader.mjs";

const MAX_PACKAGE = 64 * 1024 * 1024;
const requiredFiles = [
  "payload.json",
  "dist/local.mjs",
  "dist/initialize.mjs",
  "dist/index.js",
  "dist/sdk-plugin.mjs",
  "web/index.html",
];

class UpdateHttpError extends Error {
  constructor(status) {
    super(`HTTP ${status}`);
    this.status = status;
  }
}

async function download(url, limit) {
  let parsed = new URL(url);
  const secure = parsed.protocol === "https:";
  const signal = AbortSignal.timeout(120000);
  let response;
  for (let redirects = 0; ; redirects++) {
    if (
      parsed.username ||
      parsed.password ||
      (parsed.protocol !== "https:" &&
        !(parsed.protocol === "http:" && !secure && ["127.0.0.1", "localhost"].includes(parsed.hostname)))
    )
      throw new Error("更新地址必须使用 HTTPS");
    response = await fetch(parsed, { signal, redirect: "manual" });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    await response.body?.cancel();
    if (redirects >= 5 || !response.headers.get("location")) throw new Error("更新下载重定向无效");
    parsed = new URL(response.headers.get("location"), parsed);
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new UpdateHttpError(response.status);
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw new Error("更新包超过大小限制");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function verifyRelease(envelope, publicKey) {
  if (
    typeof envelope?.manifest !== "string" ||
    typeof envelope.signature !== "string" ||
    !verify(null, Buffer.from(envelope.manifest), publicKey, Buffer.from(envelope.signature, "base64"))
  )
    throw new Error("更新签名不正确，未安装");
  const release = JSON.parse(envelope.manifest);
  if (
    !semver.valid(release.version) ||
    release.version.includes("+") ||
    typeof release.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(release.sha256) ||
    !Number.isSafeInteger(release.size) ||
    release.size <= 0 ||
    release.size > MAX_PACKAGE
  )
    throw new Error("更新清单无效");
  if (release.dshVersion !== DSH_VERSION || release.hostApi !== HOST_API)
    throw new Error("此版本需要重新适配内核，请等待对应的开图版本；当前版本保持不变");
  return release;
}

export async function installPayload({ state, resources, release, bytes }) {
  if (bytes.length !== release.size || createHash("sha256").update(bytes).digest("hex") !== release.sha256)
    throw new Error("更新包不完整，未安装");
  let total = 0;
  const files = unzipSync(bytes, {
    filter: (entry) => {
      const parts = entry.name.split("/");
      if (
        entry.name.includes("\\") ||
        parts.some((part) => part === ".." || part === ".") ||
        !["dist", "web", "schemas", "templates", "data", "licenses", "package.json", "payload.json"].includes(
          parts[0],
        )
      )
        throw new Error("更新包包含功能目录之外的文件");
      total += entry.originalSize;
      if (total > 256 * 1024 * 1024) throw new Error("更新包展开后过大");
      return !entry.name.endsWith("/");
    },
  });
  for (const file of requiredFiles) if (!files[file]) throw new Error(`更新包缺少 ${file}`);
  const metadata = JSON.parse(Buffer.from(files["payload.json"]).toString());
  if (
    metadata.version !== release.version ||
    metadata.dshVersion !== DSH_VERSION ||
    metadata.hostApi !== HOST_API
  )
    throw new Error("更新包与发布清单不一致");
  const root = updateRoot(state);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const target = join(root, release.version);
  if (existsSync(target)) {
    // A previously installed, immutable release can be selected again after rollback.
    const installed = JSON.parse(readFileSync(join(target, "payload.json"), "utf8"));
    if (
      installed.version !== release.version ||
      installed.dshVersion !== DSH_VERSION ||
      installed.hostApi !== HOST_API
    )
      throw new Error("本机保留的功能包版本不匹配");
    activate(state, release.version, selection(state).current);
    return;
  }
  const staging = await mkdtemp(join(root, ".install-"));
  try {
    for (const [file, content] of Object.entries(files)) {
      await mkdir(dirname(join(staging, file)), { recursive: true });
      await writeFile(join(staging, file), content);
    }
    // DSH protocol bridges stay in the signed host. No engine dependencies arrive in updates.
    await symlink(
      join(resources, "kaitu/node_modules"),
      join(staging, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await rename(staging, target);
    const previous = selection(state).current;
    activate(state, release.version, previous);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export function createPayloadUpdater({ state, resources, payload, restart }) {
  const configFile = join(resources, "kaitu-update.json");
  const config = existsSync(configFile) ? JSON.parse(readFileSync(configFile, "utf8")) : {};
  const current = JSON.parse(readFileSync(join(payload, "payload.json"), "utf8"));
  const preferencesFile = join(state, "updates", "preferences.json");
  const preferences = existsSync(preferencesFile) ? JSON.parse(readFileSync(preferencesFile, "utf8")) : {};
  let status = {
    version: current.version,
    dshVersion: DSH_VERSION,
    configured: Boolean(config.feedUrl && config.publicKey),
    automatic: preferences.automatic !== false,
    phase: "idle",
    availableVersion: null,
    notes: "",
    error: "",
    canRollback: selection(state).current !== null,
  };
  let candidate;
  let operation;
  const run = (phase, work) => {
    status = {
      ...status,
      phase,
      error: "",
      ...(phase === "checking" ? { availableVersion: null, notes: "" } : {}),
    };
    operation = work()
      .catch((error) => {
        const unavailable = phase === "checking" && error instanceof UpdateHttpError && error.status === 404;
        const label =
          phase === "checking"
            ? "检查更新清单失败"
            : error instanceof UpdateHttpError
              ? "更新包下载失败"
              : "下载或安装更新失败";
        status = {
          ...status,
          phase: unavailable ? "unavailable" : "error",
          error: unavailable ? "" : `${label}：${error.message}`,
        };
      })
      .finally(() => {
        operation = undefined;
      });
  };
  const updater = {
    async checkAutomatically() {
      if (!status.automatic || !status.configured || operation || status.phase === "ready") return;
      await updater.request("check");
      await operation;
    },
    async request(action = "status") {
      if (action === "status") return { ...status };
      if (action === "automatic:on" || action === "automatic:off") {
        const automatic = action === "automatic:on";
        await mkdir(dirname(preferencesFile), { recursive: true, mode: 0o700 });
        await writeFile(`${preferencesFile}.tmp`, JSON.stringify({ automatic }), { mode: 0o600 });
        await rename(`${preferencesFile}.tmp`, preferencesFile);
        status = { ...status, automatic };
        return { ...status };
      }
      if (operation) return { ...status };
      if (action === "restart") {
        if (status.phase !== "ready") throw new Error("没有等待重启的更新");
        restart();
      } else if (action === "rollback") {
        rollback(state);
        status = { ...status, phase: "ready", canRollback: false, availableVersion: null };
      } else if (action === "check") {
        if (status.phase === "ready") return { ...status };
        if (!status.configured) throw new Error("此测试版本尚未配置更新发布源");
        candidate = undefined;
        run("checking", async () => {
          const envelope = JSON.parse((await download(config.feedUrl, 1024 * 1024)).toString());
          candidate = verifyRelease(envelope, config.publicKey);
          const newer = semver.gt(candidate.version, current.version);
          status = {
            ...status,
            phase: newer ? "available" : "current",
            availableVersion: newer ? candidate.version : null,
            notes: newer ? String(candidate.notes ?? "") : "",
          };
        });
      } else if (action === "install") {
        if (!candidate || status.phase !== "available") throw new Error("请先检查更新");
        run("downloading", async () => {
          const bytes = await download(candidate.url, MAX_PACKAGE);
          await installPayload({ state, resources, release: candidate, bytes });
          status = { ...status, phase: "ready", canRollback: true };
        });
      } else throw new Error("未知更新操作");
      return { ...status };
    },
  };
  return updater;
}
