import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { KaituError } from "../core/dist/index.js";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const fail = (message) => {
  throw new KaituError(message, "CREATOR");
};
const validPath = (path) =>
  typeof path === "string" &&
  path.length < 240 &&
  path
    .split("/")
    .every(
      (part) =>
        /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(part) &&
        !part.endsWith(".") &&
        part.toLowerCase() !== "node_modules" &&
        !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
    );
const digest = (files) =>
  createHash("sha256")
    .update(
      JSON.stringify(
        Object.keys(files)
          .sort()
          .map((path) => [path, files[path]]),
      ),
    )
    .digest("hex");
const bounded = (files) => {
  const entries = Object.entries(files);
  if (
    !entries.length ||
    entries.length > 100 ||
    entries.some(([path, text]) => !validPath(path) || typeof text !== "string")
  )
    fail("页面源码无效：请使用相对路径和文本文件");
  if (entries.reduce((size, [, text]) => size + Buffer.byteLength(text), 0) > 2 * 1024 * 1024)
    fail("页面源码超过 2 MB，请缩小后重试");
  return files;
};
const readFiles = (directory) => {
  const files = {};
  let size = 0;
  const walk = (prefix = "") => {
    if (!lstatSync(join(directory, prefix)).isDirectory()) fail("页面源码目录无效");
    for (const entry of readdirSync(join(directory, prefix))) {
      const path = prefix ? `${prefix}/${entry}` : entry;
      if (!validPath(path)) fail("页面源码路径无效");
      const stat = lstatSync(join(directory, path));
      if (stat.isSymbolicLink()) fail("页面源码包含符号链接，请移除后重试");
      if (stat.isDirectory()) walk(path);
      else {
        size += stat.size;
        if (!stat.isFile() || Object.keys(files).length >= 100 || size > 2 * 1024 * 1024)
          fail("页面源码过大或包含特殊文件");
        Object.defineProperty(files, path, {
          value: readFileSync(join(directory, path), "utf8"),
          enumerable: true,
        });
      }
    }
  };
  walk();
  return bounded(files);
};
const writeFiles = (directory, files) => {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), text, { flag: "wx" });
  }
};
const ensureDirectories = (...paths) => {
  for (const path of paths) {
    try {
      mkdirSync(path);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    if (!lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink())
      fail("页面源码目录包含符号链接或特殊文件");
  }
};
const manifest = (files) => {
  const pkg = JSON.parse(files["package.json"] ?? "null");
  if (
    !pkg ||
    pkg.type !== "module" ||
    pkg.dsh?.bundle?.patch !== "./cordis.patch.yml" ||
    pkg.dsh?.client?.platform !== "web" ||
    pkg.exports?.["."] !== "./index.js" ||
    pkg.exports?.["./client"] !== "./client.js" ||
    !["cordis.patch.yml", "index.js", "client.js"].every((path) => typeof files[path] === "string") ||
    typeof pkg.kaitu?.explore?.page !== "string" ||
    !pkg.kaitu.explore.page.trim() ||
    typeof pkg.kaitu.explore.title !== "string" ||
    !pkg.kaitu.explore.title.trim() ||
    typeof pkg.kaitu.explore.icon !== "string" ||
    !pkg.kaitu.explore.icon.trim()
  )
    fail("页面包缺少 DSH 页面入口、名称或图标");
  // 第一片只接受自包含 bundle；依赖下载与安装脚本不属于源码审阅的确认范围。
  for (const key of [
    "scripts",
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
    "bundledDependencies",
    "bundleDependencies",
  ])
    if (pkg[key] && Object.keys(pkg[key]).length) fail("页面包含安装脚本或依赖，请改为自包含页面");
  if (Object.keys(files).some((path) => /(^|\/)(?:binding\.gyp|pnpmfile\.cjs)$/.test(path)))
    fail("页面包含构建入口，请改为自包含页面");
  return pkg;
};

/**
 * 内部草稿边界，尚不连接用户入口。生成器只交付文本，不导入或运行候选代码。
 * 安装必须来自主进程中的用户确认操作；不能注册成模型工具。
 * plugins 是现有双 profile 服务，负责停引擎、安装和恢复，失败原样交回。
 */
export function createCreatorService({ directory, plugins }) {
  const drafts = new Map();
  const location = (area, id, revision) => {
    if (!uuid.test(id) || !uuid.test(revision)) fail("页面草稿标识无效");
    const parent = join(directory, area, id);
    for (const path of [directory, join(directory, area), parent])
      if (lstatSync(path).isSymbolicLink()) fail("页面源码目录包含符号链接");
    const path = join(parent, revision);
    if (lstatSync(path).isSymbolicLink()) fail("页面源码目录包含符号链接");
    return path;
  };
  const inspect = (id, revision) => {
    const source = location("drafts", id, revision);
    const files = readFiles(source);
    const pkg = manifest(files);
    if (pkg.name !== `kaitu-created-${id}` || pkg.version !== `0.0.0-${revision}`)
      fail("页面包身份已改变，请重新生成草稿");
    return {
      id,
      revision,
      digest: digest(files),
      source,
      name: pkg.name,
      title: pkg.kaitu.explore.title,
      description: typeof pkg.description === "string" ? pkg.description : "",
      page: pkg.kaitu.explore.page,
      files,
      // 这是普通 DSH bundle。不能把工作区沙箱描述成已安装 Host 代码的权限限制。
      access: "host-process",
    };
  };
  // Recover only the small manifest inventory once at startup; status reads stay in memory.
  const draftRoot = join(directory, "drafts");
  if (
    existsSync(draftRoot) &&
    !lstatSync(directory).isSymbolicLink() &&
    !lstatSync(draftRoot).isSymbolicLink()
  )
    for (const id of readdirSync(draftRoot).filter((id) => uuid.test(id))) {
      try {
        if (lstatSync(join(draftRoot, id)).isSymbolicLink()) continue;
        const revisions = readdirSync(join(draftRoot, id)).filter((revision) => uuid.test(revision));
        revisions.sort(
          (a, b) => lstatSync(join(draftRoot, id, b)).mtimeMs - lstatSync(join(draftRoot, id, a)).mtimeMs,
        );
        for (const revision of revisions) {
          try {
            const source = location("drafts", id, revision);
            const file = join(source, "package.json");
            if (lstatSync(file).isSymbolicLink()) continue;
            const pkg = JSON.parse(readFileSync(file, "utf8"));
            if (
              pkg.name !== `kaitu-created-${id}` ||
              pkg.version !== `0.0.0-${revision}` ||
              typeof pkg.kaitu?.explore?.title !== "string"
            )
              continue;
            drafts.set(id, { id, revision, title: pkg.kaitu.explore.title, name: pkg.name });
            break;
          } catch {
            /* Try an older completed revision. */
          }
        }
      } catch {
        /* An interrupted or externally modified draft does not hide other pages. */
      }
    }
  return {
    list: () => [...drafts.values()],
    identity() {
      const id = randomUUID();
      return { id, name: `kaitu-created-${id}` };
    },
    stage(input) {
      const files = { ...bounded(input) };
      const pkg = manifest(files);
      const id = typeof pkg.name === "string" ? pkg.name.slice("kaitu-created-".length) : "";
      if (!uuid.test(id) || pkg.name !== `kaitu-created-${id}`) fail("页面包名称无效，请使用生成任务的包名");
      const revision = randomUUID();
      // 包名同时是 patch 与 Client factory 的模块标识，不能在这里偷偷改名。
      pkg.version = `0.0.0-${revision}`;
      pkg.private = true;
      // 不信任生成器的打包清单；确认的全部文件才是安装内容。
      pkg.files = Object.keys(files).filter((path) => path !== "package.json");
      files["package.json"] = `${JSON.stringify(pkg, null, 2)}\n`;
      bounded(files);
      const parent = join(directory, "drafts", id);
      ensureDirectories(directory, join(directory, "drafts"), parent);
      const source = join(parent, revision);
      mkdirSync(source);
      writeFiles(source, files);
      const draft = inspect(id, revision);
      drafts.set(id, { id, revision, title: draft.title, name: draft.name });
      return draft;
    },
    inspect,
    async install({ id, revision, digest: approved, confirmed }) {
      if (confirmed !== true) fail("请先确认安装这个页面");
      const review = inspect(id, revision);
      if (review.digest !== approved) fail("页面源码已改变，请重新审阅并确认");
      // 从刚读入的已确认内容做稳定安装副本，后续修改草稿不影响安装内容。
      const target = join(directory, "packages", id, revision);
      ensureDirectories(join(directory, "packages"), join(directory, "packages", id));
      try {
        mkdirSync(target);
        writeFiles(target, review.files);
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
      if (digest(readFiles(location("packages", id, revision))) !== approved)
        fail("安装副本已改变，请重新生成草稿");
      await plugins.install(`file:${target}`, {
        verify: () => {
          if (digest(readFiles(location("packages", id, revision))) !== approved)
            fail("安装源码已改变，请重新生成并确认 / Installation source changed. Regenerate and confirm.");
        },
      });
      // 当前安装服务没有 Client 生效回执，调用方仍须刷新并核对页面。
      return { name: review.name, revision, installation: "completed", activation: "unverified" };
    },
  };
}
