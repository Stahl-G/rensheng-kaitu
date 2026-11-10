import fs, { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import {
  type Workspace,
  addTask,
  createProject,
  history,
  historyDirectory,
  initWorkspace,
  isTracked,
  listTasks,
  localStateRoot,
  readOnboardingMatter,
  readRecords,
  saveOnboardingMatter,
  setProject,
  snapshotNow,
  workspaceBackupStatus,
} from "@kaitu/core";
import { afterEach, expect, it, onTestFailed, vi } from "vitest";
import { fetchCalendar } from "../../core/src/calendar-fetch.js";
import type { AskService } from "../src/ui/ask.js";
import { startUi } from "../src/ui/server.js";

vi.mock("../../core/src/calendar-fetch.js", () => ({ fetchCalendar: vi.fn() }));
const git = createRequire(new URL("../../core/package.json", import.meta.url))("isomorphic-git");
const migration = vi.hoisted(() => ({
  observe: null as null | (<T>(name: string, ws: Workspace, run: () => Promise<T>) => Promise<T>),
  rename: null as null | ((error: unknown, source: unknown, target: unknown) => void),
}));
// Observe Vitest's named fs import, not the default object's unrelated ESM binding.
vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return {
    ...fs,
    renameSync: (...args: Parameters<typeof fs.renameSync>) => {
      try {
        return fs.renameSync(...args);
      } catch (error) {
        migration.rename?.(error, ...args);
        throw error;
      }
    },
  };
});
vi.mock("@kaitu/core", async (original) => {
  const core = await original<typeof import("@kaitu/core")>();
  const call = <T>(name: string, ws: Workspace, run: () => Promise<T>) =>
    migration.observe ? migration.observe(name, ws, run) : run();
  return {
    ...core,
    snapshotNow: vi.fn((...args: Parameters<typeof core.snapshotNow>) =>
      call("snapshotNow", args[0], () => core.snapshotNow(...args)),
    ),
    moveWorkspace: (...args: Parameters<typeof core.moveWorkspace>) =>
      call("moveWorkspace", args[0], () => core.moveWorkspace(...args)),
    pauseNoteIndex: (...args: Parameters<typeof core.pauseNoteIndex>) =>
      call("pauseNoteIndex", args[0], () => core.pauseNoteIndex(...args)),
  };
});
const cleanup: (() => Promise<unknown>)[] = [];
const beforeClose: (() => void)[] = [];
function observeMigration(ws: Workspace) {
  type Trace = {
    route: string;
    phase: string;
    events: unknown[];
    record(step: string, error?: unknown, source?: unknown, target?: unknown): void;
  };
  const reports: Trace[] = [];
  let active: Trace | undefined;
  onTestFailed(() => console.error("migration-failure", JSON.stringify(reports)));
  migration.rename = (error, source, target) => active?.record("rename:error", error, source, target);
  migration.observe = <T>(name: string, workspace: Workspace, run: () => Promise<T>): Promise<T> => {
    const request = active;
    if (!request || workspace !== ws) return run();
    request.record(`${name}:enter`);
    const settled = (status: string, error?: unknown) => {
      request.record(`${name}:${status}`, error);
      if (["enableSync", "disableSync", "moveWorkspace"].includes(name)) request.phase = "finalize";
    };
    try {
      const result = run();
      void result.then(
        () => settled("return"),
        (error) => settled("error", error),
      );
      return result;
    } catch (error) {
      settled("throw", error);
      throw error;
    }
  };
  return {
    begin(route: string, target: string) {
      const roots = [
        ["source", ws.root],
        ["target", target],
        ["state", localStateRoot()],
      ] as const;
      const role = (value: unknown) => {
        if (typeof value === "string" && isAbsolute(value)) {
          for (const [name, root] of roots) {
            const path = relative(root, value);
            if (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`))
              return `${name}/${path.split(sep).join("/") || "."}`;
          }
        }
        return "redacted";
      };
      const detail = (error: unknown, seen = new Set<object>()): unknown => {
        if (!error || typeof error !== "object") return { type: typeof error };
        if (seen.has(error)) return { repeated: true };
        seen.add(error);
        const value = error as Record<string, unknown>;
        const token = (field: unknown) =>
          typeof field === "string" && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(field) ? field : undefined;
        return {
          name: token(value.name),
          code: token(value.code),
          syscall: token(value.syscall),
          path: role(value.path),
          dest: role(value.dest),
          ...(value.cause === undefined ? {} : { cause: detail(value.cause, seen) }),
          ...(Array.isArray(value.errors) ? { errors: value.errors.map((item) => detail(item, seen)) } : {}),
        };
      };
      const request: Trace = {
        route,
        phase: "prepare",
        events: [],
        record(step, error, source, destination) {
          request.events.push({
            step,
            phase: request.phase,
            root: role(ws.root),
            ...(error === undefined ? {} : { error: detail(error) }),
            ...(source === undefined ? {} : { path: role(source), dest: role(destination) }),
          });
        },
      };
      reports.push(request);
      active = request;
      request.record("http:send");
    },
    mark(step: string) {
      if (!active) return;
      if (step === "prepared") active.phase = "core";
      if (step === "watchers-restored") active.phase = "finalize";
      active.record(step);
      if (step.startsWith("http:")) active = undefined;
    },
  };
}
afterEach(async () => {
  migration.observe = null;
  migration.rename = null;
  const errors: unknown[] = [];
  try {
    // Vitest timeout does not unwind a test suspended on a promise.
    for (const release of beforeClose.splice(0).reverse()) {
      try {
        release();
      } catch (error) {
        errors.push(error);
      }
    }
  } finally {
    vi.restoreAllMocks();
    vi.resetAllMocks();
  }
  for (const close of cleanup.splice(0).reverse()) {
    try {
      await close();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "UI cleanup failed");
});

it("同时保存的原文都进入真实版本，搬往同步目录期间的写入排在搬迁后", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-ui-snapshot-move-"));
  cleanup.push(async () => rmSync(root, { recursive: true, force: true }));
  const ws = await initWorkspace(join(root, "source"));
  const diagnostic = observeMigration(ws);
  const snapshots: Promise<string | null>[] = [];
  let snapshotStarted = gate<void>();
  const original = await vi.importActual<typeof import("@kaitu/core")>("@kaitu/core");
  vi.mocked(snapshotNow).mockImplementation((...args) => {
    const result = migration.observe
      ? migration.observe("snapshotNow", args[0], () => original.snapshotNow(...args))
      : original.snapshotNow(...args);
    if (args[0] === ws) {
      snapshots.push(result);
      snapshotStarted.resolve();
    }
    return result;
  });
  const entered = gate<void>();
  const resume = gate<void>();
  const ui = await startUi(ws, {
    port: 0,
    open: false,
    versionDelayMs: 20,
    snapshotDelayMs: 20,
    onWorkspaceChanging: async () => {
      diagnostic.mark("prepared");
      entered.resolve();
      await resume.promise;
    },
    onWorkspaceChanged: async () => diagnostic.mark("watchers-restored"),
  });
  cleanup.push(ui.close);
  const post = (method: string, args: unknown[]) => {
    if (method === "moveStorage") diagnostic.begin(`/api/product/${method}`, String(args[0]));
    return fetch(`${ui.url}/api/product/${method}`, {
      method: "POST",
      headers: { "X-Kaitu": "1", Origin: ui.url },
      body: JSON.stringify(args),
    }).then((response) => {
      if (method === "moveStorage") diagnostic.mark(`http:${response.status}`);
      return response;
    });
  };
  const originals = new Map<string, string>();
  const captures = await Promise.all(
    Array.from({ length: 12 }, async (_, i) => {
      const response = await post("capture", [`合成并发原文 ${i}`]);
      expect(response.status).toBe(200);
      const { path } = (await response.json()) as { path: string };
      const originalText = ws.readText(path);
      expect(originalText).toContain(`合成并发原文 ${i}`);
      originals.set(path, originalText);
      return path;
    }),
  );
  // Observe the scheduled commit itself; never flush or request an extra snapshot.
  let version: string | undefined;
  for (let index = 0; !version; index++) {
    if (index === snapshots.length) {
      snapshotStarted = gate<void>();
      await snapshotStarted.promise;
    }
    const oid = await snapshots[index];
    if (!oid) continue;
    const files: string[] = await git.listFiles({
      fs,
      dir: ws.root,
      gitdir: historyDirectory(ws),
      ref: oid,
    });
    if (!captures.every((file) => files.includes(file))) continue;
    for (const file of captures) {
      const { blob } = await git.readBlob({
        fs,
        dir: ws.root,
        gitdir: historyDirectory(ws),
        oid,
        filepath: file,
      });
      expect(Buffer.from(blob).toString(), `${oid}:${file}`).toBe(originals.get(file));
    }
    version = oid;
  }
  expect(originals.size).toBe(12);
  const target = join(root, "sync");
  const moving = post("moveStorage", [target, true, "nutstore"]);
  await entered.promise;
  let saved = false;
  const saving = post("capture", ["合成搬迁期间原文"]).then((response) => {
    saved = true;
    return response;
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(saved).toBe(false);
  } finally {
    resume.resolve();
  }
  expect((await moving).status).toBe(200);
  expect(ws.root).toBe(target);
  const response = await saving;
  expect(response.status).toBe(200);
  const { path } = (await response.json()) as { path: string };
  expect(ws.readText(path)).toContain("合成搬迁期间原文");
  const returning = await post("moveStorage", [join(root, "back"), false, "local"]);
  const returningBody = await returning.json();
  expect(returning.status, JSON.stringify(returningBody)).toBe(200);
  for (const file of [...captures, path]) {
    expect(ws.exists(file)).toBe(true);
    expect(await isTracked(ws, file)).toBe(true);
  }
});
function gate<T>() {
  let resolve!: (value: T) => void;
  return {
    promise: new Promise<T>((done) => {
      resolve = done;
    }),
    resolve: (value: T) => resolve(value),
  };
}
async function setup(ask?: AskService, prepare?: (ws: Workspace) => Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), "kaitu-ui-order-"));
  cleanup.push(async () => rmSync(root, { recursive: true, force: true }));
  const ws = await initWorkspace(root);
  const task = await addTask(ws, { title: "合成任务" });
  const other = await addTask(ws, { title: "合成待取消" });
  await prepare?.(ws);
  const before = (await history(ws))[0]?.oid;
  const ui = await startUi(ws, { port: 0, open: false, ask, versionDelayMs: 20, snapshotDelayMs: 20 });
  cleanup.push(ui.close);
  const post = (path: string, data: unknown) =>
    fetch(`${ui.url}/api/${path}`, {
      method: "POST",
      headers: { "X-Kaitu": "1", Origin: ui.url },
      body: JSON.stringify(data),
    });
  return { ws, task, other, before, post };
}

it("日历网络未返回时任务可完成和存版本，恢复后不应用旧拉取", async ({ signal }) => {
  const fetched = gate<Buffer>();
  const started = gate<void>();
  vi.mocked(fetchCalendar).mockImplementation(() => {
    started.resolve();
    return fetched.promise;
  });
  const release = () =>
    fetched.resolve(
      Buffer.from(
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:old-fetch\r\nDTSTART:20261023T120000Z\r\nDTEND:20261023T130000Z\r\nSUMMARY:Synthetic\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n",
      ),
    );
  beforeClose.push(release);
  const snapshots: Promise<string | null>[] = [];
  let snapshotStarted = gate<void>();
  const abortObservation = () => snapshotStarted.resolve();
  signal.addEventListener("abort", abortObservation, { once: true });
  beforeClose.push(() => signal.removeEventListener("abort", abortObservation));
  const original = await vi.importActual<typeof import("@kaitu/core")>("@kaitu/core");
  // Observe original background promises before startUi can begin saving.
  const { ws, task, before, post } = await setup(undefined, async (workspace) => {
    vi.mocked(snapshotNow).mockImplementation((...args) => {
      const result = original.snapshotNow(...args);
      if (args[0] === workspace) {
        snapshots.push(result);
        snapshotStarted.resolve();
      }
      return result;
    });
  });
  signal.throwIfAborted();
  const calendar = post("product/addCalendarSubscription", ["https://calendar.example/test.ics", "测试"]);
  try {
    await started.promise;
    signal.throwIfAborted();
    // 不释放网络 gate：旧的全局队列在这里无法完成。
    const done = await post("tasks/done", { id: task.record.id });
    signal.throwIfAborted();
    expect(done.status).toBe(200);
    expect(listTasks(ws, { status: "all" }).find((row) => row.id === task.record.id)?.status).toBe("done");
    const completed = ws.readText(task.file);
    // A no-op can follow a commit already containing this write. Check its immutable tree.
    let saved: string | undefined;
    for (let index = 0; !saved; index++) {
      signal.throwIfAborted();
      if (index === snapshots.length) {
        snapshotStarted = gate<void>();
        await snapshotStarted.promise;
        signal.throwIfAborted();
      }
      let oid = await snapshots[index];
      signal.throwIfAborted();
      if (!oid) {
        oid = await git.resolveRef({ fs, dir: ws.root, gitdir: historyDirectory(ws), ref: "HEAD" });
        signal.throwIfAborted();
      }
      const { blob } = await git.readBlob({
        fs,
        dir: ws.root,
        gitdir: historyDirectory(ws),
        oid,
        filepath: task.file,
      });
      signal.throwIfAborted();
      if (Buffer.from(blob).toString() === completed) saved = oid;
    }
    signal.throwIfAborted();
    expect(saved).not.toBe(before);
    expect((await post("restore", { version: before })).status).toBe(200);
  } finally {
    release();
  }
  expect((await calendar).status).toBe(409);
  expect(readRecords(ws, "event")).toHaveLength(0);
  expect(listTasks(ws, { status: "all" }).find((row) => row.id === task.record.id)?.status).toBe("open");
});

it("恢复期间的旧接口和产品接口写入排在恢复后，不被覆盖", async () => {
  const entered = gate<void>();
  const resume = gate<void>();
  const ask = {
    prepareRelocation: async () => {
      entered.resolve();
      await resume.promise;
    },
    relocate: () => {},
    close: async () => {},
  } as unknown as AskService;
  const { ws, task, other, before, post } = await setup(ask);
  const restoring = post("product/restoreVersion", [before]);
  await entered.promise;
  let writesDone = false;
  const writes = Promise.all([
    post("tasks/done", { id: task.record.id }),
    post("product/cancelTask", [other.record.id]),
  ]).then((results) => {
    writesDone = true;
    return results;
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(writesDone).toBe(false);
  } finally {
    resume.resolve();
  }
  expect((await restoring).status).toBe(200);
  expect((await writes).map((response) => response.status)).toEqual([200, 200]);
  expect(listTasks(ws, { status: "all" }).map(({ id, status }) => ({ id, status }))).toEqual(
    expect.arrayContaining([
      { id: task.record.id, status: "done" },
      { id: other.record.id, status: "cancelled" },
    ]),
  );
});

it.each(["projectBindGithub", "projectSync", "workspaceBackup"])(
  "%s 网络等待不挡任务，恢复丢弃迟到成功/失败，重试可读回",
  async (method) => {
    let slug = "";
    const { ws, task, before, post } = await setup(undefined, async (ws) => {
      ({ slug } = await createProject(ws, { title: "合成项目", kind: "personal" }));
      if (method === "projectSync") await setProject(ws, slug, { github: { repo: "Owner/demo" } });
    });
    const args =
      method === "workspaceBackup"
        ? ["connect", { repo: "Owner/demo", text: true, records: false }]
        : method === "projectSync"
          ? [slug]
          : [slug, "Owner/demo"];
    const originalFetch = globalThis.fetch;
    let waiting = gate<void>();
    let started = gate<void>();
    let fail = false;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (!url.startsWith("https://api.github.com/")) return originalFetch(input, init);
      started.resolve();
      await waiting.promise;
      if (fail) throw new Error("synthetic network failure");
      if (url.includes("/pulls?") || url.includes("/commits?")) return Response.json([]);
      if (url.includes("/actions/runs?")) return Response.json({ total_count: 0, workflow_runs: [] });
      if (url.endsWith("/releases/latest")) return new Response(null, { status: 404 });
      return Response.json({
        full_name: "Owner/demo",
        private: false,
        default_branch: "main",
        stargazers_count: 1,
        forks_count: 0,
        open_issues_count: 0,
        archived: false,
        pushed_at: null,
      });
    });
    for (fail of [false, true]) {
      waiting = gate<void>();
      started = gate<void>();
      const pending = post(`product/${method}`, args);
      try {
        await started.promise;
        expect((await post("tasks/done", { id: task.record.id })).status).toBe(200);
        expect((await post("restore", { version: before })).status).toBe(200);
      } finally {
        waiting.resolve();
      }
      expect((await pending).status).not.toBe(200);
      expect(ws.exists(".kaitu/github-state.json")).toBe(false);
      expect(workspaceBackupStatus(ws).connection).toBeNull();
      expect(readRecords(ws, "github_snapshot")).toHaveLength(0);
    }
    fail = false;
    expect((await post(`product/${method}`, args)).status).toBe(200);
    if (method === "workspaceBackup") expect(workspaceBackupStatus(ws).connection?.repo).toBe("Owner/demo");
    else expect(readRecords(ws, "github_snapshot")[0]?.repo).toBe("Owner/demo");
  },
);

it("AI整理等待不挡任务，恢复后旧草稿不落盘，重试草稿可读回", async () => {
  let source = "";
  const waiting = gate<void>();
  const started = gate<void>();
  let listener: (event: { type: string; data: Record<string, unknown> }) => void = () => {};
  const answer = { goal: "合成目标", current: "准备中", next: "完成合成第一步" };
  const close = vi.fn(async () => {});
  const service = {
    create: async () => ({ id: "synthetic" }),
    subscribe: (_: string, callback: typeof listener) => {
      listener = callback;
      return () => {};
    },
    events: () => [
      {
        type: "assistant/message",
        data: { message: { content: [{ type: "text", text: JSON.stringify(answer) }] } },
      },
    ],
    send: async () => {
      started.resolve();
      await waiting.promise;
      listener({ type: "session.status", data: { status: "idle" } });
    },
    close,
  };
  const ask = {
    settings: async () => ({ configured: true }),
    background: () => service,
    prepareRelocation: async () => {},
    relocate: () => {},
    close: async () => {},
  } as unknown as AskService;
  const { ws, task, before, post } = await setup(ask, async (ws) => {
    source = (await saveOnboardingMatter(ws, "合成原文")).source;
  });
  const pending = post("product/onboardingMatterOrganize", [source]);
  try {
    await started.promise;
    expect((await post("tasks/done", { id: task.record.id })).status).toBe(200);
    expect((await post("restore", { version: before })).status).toBe(200);
  } finally {
    waiting.resolve();
  }
  expect((await pending).status).toBe(409);
  expect(readOnboardingMatter(ws, source).draft).toBeNull();
  expect((await post("product/onboardingMatterOrganize", [source])).status).toBe(200);
  expect(readOnboardingMatter(ws, source).draft).toMatchObject(answer);
  expect(close).toHaveBeenCalledTimes(2);
});
