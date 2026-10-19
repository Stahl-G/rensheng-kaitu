import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
// All data, application state and HOME live under a new temporary directory.
// Usage: node measure.mjs <repository> <seed|http|cli|profile|background|file-import> <result-dir> [fixture]
import fs from "node:fs";
import inspector from "node:inspector";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const [repo, mode, output, fixture] = process.argv.slice(2);
if (!repo || !mode || !output) throw new Error("repository, mode, output required");
fs.mkdirSync(output, { recursive: true });
const base = fs.mkdtempSync(path.join(os.tmpdir(), "kaitu-v2-run-"));
for (const [key, folder] of Object.entries({
  HOME: "home",
  KAITU_APP_HOME: "app",
  KAITU_LOCAL_STATE_DIR: "state",
  XDG_STATE_HOME: "xdg",
  LOCALAPPDATA: "local",
  KAITU_DIR: "workspace",
})) {
  process.env[key] = path.join(base, folder);
  fs.mkdirSync(process.env[key], { recursive: true });
}
const load = (file) => import(pathToFileURL(path.join(repo, file)).href);
const core = await load("packages/core/dist/index.js");
const { ulid } = await load("packages/core/dist/ulid.js");
const { stringifyFrontmatter } = await load("packages/core/dist/frontmatter.js");
const { snapshotNow } = await load("packages/core/dist/history.js");
const { localMonth } = await load("packages/core/dist/time.js");
const root = process.env.KAITU_DIR;
const result = {
  mode,
  at: new Date().toISOString(),
  repo,
  base,
  node: process.version,
  platform: `${os.platform()} ${os.release()} ${os.arch()}`,
  cpu: os.cpus()[0].model,
  cpus: os.cpus().length,
  totalMemory: os.totalmem(),
  samples: [],
  head: spawnSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim(),
  productPatch: spawnSync(
    "git",
    [
      "-C",
      repo,
      "diff",
      "--",
      "packages/core/src/health-page.ts",
      "packages/dsh-plugin/src/client/OverviewPage.tsx",
    ],
    {
      encoding: "utf8",
    },
  ).stdout,
};
const put = (file, text) => {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text);
};
async function measure(name, operation) {
  let last = performance.now();
  let maxGap = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    maxGap = Math.max(maxGap, now - last);
    last = now;
  }, 5);
  const start = performance.now();
  try {
    const value = await operation();
    await new Promise(setImmediate);
    maxGap = Math.max(maxGap, performance.now() - last);
    const row = { name, ms: performance.now() - start, maxEventLoopGapMs: maxGap };
    result.samples.push(row);
    console.log(JSON.stringify(row));
    return value;
  } finally {
    clearInterval(timer);
  }
}
let ui;
try {
  if (mode === "seed") {
    const now = new Date();
    const ws = await core.initWorkspace(root, { timeZone: "Asia/Bangkok" });
    const records = Array.from({ length: 19900 }, (_, i) => ({
      id: ulid(),
      ts: new Date(now.getTime() - (i % 730) * 86400000).toISOString(),
      by: "user",
      exercise: "合成深蹲",
      sets: 3,
      reps: 10,
      weight_kg: 30,
      session_id: `session-${i}`,
    }));
    const monthRows = new Map();
    for (const row of records) {
      const month = localMonth(new Date(row.ts), "Asia/Bangkok");
      if (!monthRows.has(month)) monthRows.set(month, []);
      monthRows.get(month).push(row);
    }
    for (const [month, rows] of monthRows)
      put(`health/data/workouts/${month}.jsonl`, `${rows.map(JSON.stringify).join("\n")}\n`);
    const tasks = Array.from({ length: 100 }, (_, i) => ({
      id: ulid(),
      ts: now.toISOString(),
      by: "user",
      title: `合成待办 ${i}`,
      status: "open",
    }));
    put(
      `me/data/tasks/${localMonth(now, "Asia/Bangkok")}.jsonl`,
      `${tasks.map(JSON.stringify).join("\n")}\n`,
    );
    for (let i = 0; i < 300; i++)
      put(
        `projects/synthetic-${i}/STATUS.md`,
        stringifyFrontmatter(
          {
            title: `合成项目 ${i}`,
            kind: "personal",
            stage: "active",
            links: [],
            updated: now.toISOString(),
            next: [{ id: `next-${i}`, title: `推进合成项目 ${i}`, status: "todo" }],
          },
          "# 合成项目\n",
        ),
      );
    for (let i = 0; i < 2000; i++) {
      const date = new Date(now.getTime() - (i % 180) * 86400000).toISOString().slice(0, 10);
      put(
        `inbox/notes/${date}/synthetic-${i}.md`,
        stringifyFrontmatter(
          { kind: "capture", agent: "你", date },
          `合成原文 ${i}。${"仅供性能验证，无真实资料。".repeat(50)}`,
        ),
      );
    }
    for (let i = 0; i < 1000; i++) {
      const id = ulid();
      put(
        `chats/${localMonth(now, "Asia/Bangkok").replace("-", "/")}/${id}.jsonl`,
        `${JSON.stringify({ type: "chat", id, title: `合成对话 ${i}`, source: "chatgpt", created: now.toISOString(), updated: now.toISOString() })}\n${JSON.stringify({ type: "message", id: ulid(), role: "user", ts: now.toISOString(), text: `合成检索标记 ${i} ${"合成对话正文。".repeat(100)}` })}\n`,
      );
    }
    result.validation = core.validateWorkspace(ws);
    if (result.validation.length) throw new Error(JSON.stringify(result.validation.slice(0, 10)));
    await measure("seed-real-snapshot", () => snapshotNow(ws, "合成性能夹具"));
    result.scale = { records: 20000, notes: 2000, projects: 300, chats: 1000 };
    result.fixture = root;
  } else {
    if (!fixture?.startsWith(os.tmpdir() + path.sep)) throw new Error("temporary fixture required");
    fs.cpSync(fixture, root, { recursive: true });
    // Let real mtimes age beyond Workspace.stableStamp's 2 s recent-edit guard.
    await delay(2100);
    result.cacheCondition = "new process, OS page cache not dropped; copied fixture mtimes aged 2.1 s";
    if (mode === "cli") {
      const command = async (name, args) =>
        measure(
          name,
          () =>
            new Promise((resolve, reject) => {
              const child = spawn(
                process.execPath,
                [path.join(repo, "packages/cli/dist/main.js"), ...args, "--dir", root, "--json-out"],
                { env: process.env },
              );
              let stdout = "";
              let stderr = "";
              child.stdout.on("data", (chunk) => {
                stdout += chunk;
              });
              child.stderr.on("data", (chunk) => {
                stderr += chunk;
              });
              child.on("error", reject);
              child.on("exit", (code) =>
                code === 0 ? resolve(JSON.parse(stdout)) : reject(new Error(`${name}: ${code} ${stderr}`)),
              );
            }),
        );
      const first = await command("cli-search-first", ["chats", "search", "合成检索标记 999"]);
      if (first.length !== 1 || first[0].title !== "合成对话 999")
        throw new Error("search missed final conversation");
      result.searchFirst = first;
      result.searchWarm = await command("cli-search-indexed", ["chats", "search", "合成检索标记 999"]);
      result.phone = await command("cli-phone-run-first", ["phone", "run", "--as", "合成性能验证"]);
      await command("cli-phone-run-repeat", ["phone", "run", "--as", "合成性能验证"]);
      result.phoneSchemas = Object.fromEntries(
        ["today", "week", "map", "library"].map((name) => {
          const data = JSON.parse(fs.readFileSync(path.join(root, `phone/${name}.json`)));
          const validate = core.schemas().builtin(`phone-${name}.schema.json`);
          if (!validate(data)) throw new Error(JSON.stringify(validate.errors));
          return [name, { bytes: fs.statSync(path.join(root, `phone/${name}.json`)).size, valid: true }];
        }),
      );
    } else {
      const ws = await measure(
        "workspace-open-new-process",
        async () => new core.Workspace(root, { deferOverview: mode !== "profile" }),
      );
      if (mode === "profile") {
        const session = new inspector.Session();
        session.connect();
        const post = (method) =>
          new Promise((resolve, reject) =>
            session.post(method, (error, value) => (error ? reject(error) : resolve(value))),
          );
        await core.readOverviewPage(ws);
        await post("Profiler.enable");
        await post("Profiler.start");
        for (let i = 0; i < 5; i++) await measure("health-profile-warm", () => core.readHealthPage(ws));
        const { profile } = await post("Profiler.stop");
        fs.writeFileSync(path.join(output, "health.cpuprofile"), JSON.stringify(profile));
        session.disconnect();
      } else {
        const { startUi } = await load("packages/cli/dist/ui/server.js");
        ui = await measure("ui-listen-local", () =>
          startUi(ws, { port: 0, open: false, versionDelayMs: 2000 }),
        );
        const origin = ui.url ?? `http://127.0.0.1:${ui.port}`;
        result.origin = origin;
        async function product(method, args = []) {
          const response = await fetch(`${origin}/api/product/${method}`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Kaitu": "1", Origin: origin },
            body: JSON.stringify(args),
          });
          const text = await response.text();
          if (!response.ok) throw new Error(`${method}: ${response.status} ${text}`);
          return JSON.parse(text);
        }
        if (mode === "file-import" || mode === "file-profile") {
          const now = Date.now() / 1000;
          const exports = Array.from({ length: 100 }, (_, i) => ({
            id: `v2-import-${i}`,
            title: `合成文件导入 ${i}`,
            create_time: now,
            update_time: now,
            current_node: "node-19",
            mapping: Object.fromEntries(
              Array.from({ length: 20 }, (_, j) => [
                `node-${j}`,
                {
                  id: `node-${j}`,
                  parent: j ? `node-${j - 1}` : null,
                  message: {
                    id: `message-${i}-${j}`,
                    author: { role: j % 2 ? "assistant" : "user" },
                    create_time: now,
                    content: {
                      content_type: "text",
                      parts: [`V2-IMPORT-END-${i}-${j} ${"仅供性能验收的合成对话。".repeat(10)}`],
                    },
                  },
                },
              ]),
            ),
          }));
          const bytes = Buffer.from(JSON.stringify(exports));
          result.importScale = { conversations: 100, messages: 2000, bytes: bytes.length };
          const { readChat } = await load("packages/core/dist/chats.js");
          await measure("file-import-background-end-to-end", async () => {
            const preview = await measure("http-file-import-preview", () =>
              product("onboardingImportPreview", [
                "chatgpt-conversations",
                "conversations.json",
                bytes.toString("base64"),
              ]),
            );
            const session = mode === "file-profile" ? new inspector.Session() : undefined;
            const post = (method) =>
              new Promise((resolve, reject) =>
                session.post(method, (error, value) => (error ? reject(error) : resolve(value))),
              );
            if (session) {
              session.connect();
              await post("Profiler.enable");
              await post("Profiler.start");
            }
            result.fileImport = await measure("http-file-import-confirm", () =>
              product("onboardingImportConfirm", [preview.token]),
            );
            if (session) {
              const { profile } = await post("Profiler.stop");
              fs.writeFileSync(path.join(output, "file-import.cpuprofile"), JSON.stringify(profile));
              session.disconnect();
            }
            if (result.fileImport.result.added !== 100) throw new Error("file import count mismatch");
            for (let i = 0; i < 100; i++) {
              const entry = result.fileImport.result.entries.find((entry) => entry.id === `v2-import-${i}`);
              const chat = readChat(ws, entry.file);
              if (
                chat.messages.length !== 20 ||
                chat.messages.some(
                  (message, j) => message.text !== exports[i].mapping[`node-${j}`].message.content.parts[0],
                )
              )
                throw new Error("file import message mismatch");
            }
            const deadline = performance.now() + 30000;
            while (performance.now() < deadline) {
              const version = (await core.history(ws, { limit: 1 }))[0];
              const child = spawnSync(
                "git",
                [
                  "--git-dir",
                  ws.resolve(".kaitu/history.git", { internal: true }),
                  "ls-tree",
                  "-r",
                  version.oid,
                  "chats",
                ],
                { encoding: "utf8", env: process.env },
              );
              const files = new Map(
                child.stdout
                  .trim()
                  .split("\n")
                  .flatMap((line) => {
                    const match = /^100644 blob ([0-9a-f]+)\t(.+)$/.exec(line);
                    return match ? [[match[2], match[1]]] : [];
                  }),
              );
              if (
                result.fileImport.result.entries.every((entry) => {
                  if (!files.has(entry.file)) return false;
                  const value = fs.readFileSync(path.join(root, entry.file));
                  return (
                    files.get(entry.file) ===
                    createHash("sha1").update(`blob ${value.length}\0`).update(value).digest("hex")
                  );
                })
              ) {
                result.fileImportVersion = version.oid;
                break;
              }
              await delay(100);
            }
            if (!result.fileImportVersion) throw new Error("file import not completely versioned");
          });
          result.importedMessagesVerified = 2000;
        } else if (mode === "background") {
          const readVersion = (oid, file) => {
            const child = spawnSync(
              "git",
              ["--git-dir", ws.resolve(".kaitu/history.git", { internal: true }), "show", `${oid}:${file}`],
              { encoding: "utf8", env: process.env },
            );
            return child.status === 0 ? child.stdout : "";
          };
          const waitVersion = async (accept) => {
            const deadline = performance.now() + 30000;
            while (performance.now() < deadline) {
              const latest = (await core.history(ws, { limit: 1 }))[0];
              if (latest && accept(latest.oid)) return latest.oid;
              await delay(100);
            }
            throw new Error("background version did not contain all written data");
          };
          await measure("write-background-end-to-end", async () => {
            result.capture = await measure("http-capture-return", () =>
              product("capture", ["V2 合成后台版本标记"]),
            );
            await measure("http-complete-return", () =>
              product("completeNext", ["projects/synthetic-0/STATUS.md", "next-0"]),
            );
            result.writeVersion = await waitVersion(
              (oid) =>
                readVersion(oid, result.capture.path).includes("V2 合成后台版本标记") &&
                readVersion(oid, "projects/synthetic-0/STATUS.md").includes("status: done"),
            );
          });
          await measure("import-background-end-to-end", async () => {
            const text = Array.from({ length: 100 }, (_, i) => `合成后台导入 ${i}`).join("\n");
            const preview = await measure("http-import-preview-100", () =>
              product("onboardingMemoryPreview", [text, "chatgpt"]),
            );
            const imported = await measure("http-import-confirm-100", () =>
              product("onboardingMemoryConfirm", [
                preview.token,
                preview.candidates.map((entry) => entry.id),
              ]),
            );
            if (imported.entries.length !== 100) throw new Error("import incomplete");
            // Compare every imported file against its real Git blob identity.
            result.importVersion = await waitVersion((oid) => {
              const child = spawnSync(
                "git",
                [
                  "--git-dir",
                  ws.resolve(".kaitu/history.git", { internal: true }),
                  "ls-tree",
                  "-r",
                  oid,
                  "memory",
                ],
                { encoding: "utf8", env: process.env },
              );
              const files = new Map(
                child.stdout
                  .trim()
                  .split("\n")
                  .flatMap((line) => {
                    const match = /^100644 blob ([0-9a-f]+)\t(.+)$/.exec(line);
                    return match ? [[match[2], match[1]]] : [];
                  }),
              );
              return imported.entries.every((entry) => {
                const file = `memory/${entry.file}`;
                if (!files.has(file)) return false;
                const bytes = fs.readFileSync(path.join(root, file));
                const hash = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
                return files.get(file) === hash;
              });
            });
            result.imported = imported.entries.length;
          });
        } else {
          result.firstOverview = await measure("http-overview-first", () => product("overview"));
          for (const method of ["health", "library", "me"])
            await measure(`http-${method}-first`, () => product(method));
          result.healthDigest = createHash("sha256")
            .update(JSON.stringify(await product("health")))
            .digest("hex");
          for (let i = 0; i < 5; i++)
            for (const method of ["overview", "health", "library", "me"])
              await measure(`http-${method}-warm`, () => product(method));
          result.capture = await measure("http-capture-return", () =>
            product("capture", ["V2 合成写入回读标记"]),
          );
          if (!fs.readFileSync(path.join(root, result.capture.path), "utf8").includes("V2 合成写入回读标记"))
            throw new Error("capture not persisted");
          await measure("http-complete-return", () =>
            product("completeNext", ["projects/synthetic-0/STATUS.md", "next-0"]),
          );
          if (
            !fs
              .readFileSync(path.join(root, "projects/synthetic-0/STATUS.md"), "utf8")
              .includes("status: done")
          )
            throw new Error("completion not persisted");
          result.fileSearchFirst = await measure("http-search-files-first", () =>
            product("findWorkspaceFiles", ["synthetic-1999"]),
          );
          result.fileSearchWarm = await measure("http-search-files-warm", () =>
            product("findWorkspaceFiles", ["synthetic-1999"]),
          );
          if (
            !result.fileSearchFirst.some((row) => row.path.endsWith("synthetic-1999.md")) ||
            JSON.stringify(result.fileSearchFirst) !== JSON.stringify(result.fileSearchWarm)
          )
            throw new Error("file search result mismatch");
          await measure("write-full-snapshot-drain", () => snapshotNow(ws, "合成写入完整结束"));
          const text = Array.from({ length: 100 }, (_, i) => `- 合成导入记忆 ${i}: 独立合成内容 ${i}`).join(
            "\n",
          );
          const preview = await measure("http-import-preview-100", () =>
            product("onboardingMemoryPreview", [text, "chatgpt"]),
          );
          result.importPreview = preview;
          const entries = preview.candidates ?? preview.entries;
          result.importResult = await measure("http-import-confirm-100", () =>
            product("onboardingMemoryConfirm", [preview.token, entries.map((entry) => entry.id)]),
          );
          await measure("import-full-snapshot-drain", () => snapshotNow(ws, "合成导入完整结束"));
          result.captureReadback = true;
          result.completeReadback = true;
          result.firstOverview = {
            notes: result.firstOverview.notes.length,
            projects: result.firstOverview.projects.length,
            warnings: result.firstOverview.warnings,
          };
        }
      }
    }
  }
} finally {
  if (ui) await ui.close();
  fs.writeFileSync(path.join(output, `${mode}.json`), `${JSON.stringify(result, null, 2)}\n`);
  console.log(`RESULT ${path.join(output, `${mode}.json`)}`);
}
