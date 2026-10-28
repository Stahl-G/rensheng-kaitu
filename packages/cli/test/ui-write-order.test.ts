import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Workspace,
  addTask,
  createProject,
  history,
  initWorkspace,
  isTracked,
  listTasks,
  readOnboardingMatter,
  readRecords,
  saveOnboardingMatter,
  setProject,
  workspaceBackupStatus,
} from "@kaitu/core";
import { afterEach, expect, it, vi } from "vitest";
import { fetchCalendar } from "../../core/src/calendar-fetch.js";
import type { AskService } from "../src/ui/ask.js";
import { startUi } from "../src/ui/server.js";

vi.mock("../../core/src/calendar-fetch.js", () => ({ fetchCalendar: vi.fn() }));
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

it("同时保存的原文都进入真实版本，搬往同步目录期间的写入排在搬迁后", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-ui-snapshot-move-"));
  cleanup.push(async () => rmSync(root, { recursive: true, force: true }));
  const ws = await initWorkspace(join(root, "source"));
  const entered = gate<void>();
  const resume = gate<void>();
  const ui = await startUi(ws, {
    port: 0,
    open: false,
    versionDelayMs: 20,
    snapshotDelayMs: 20,
    onWorkspaceChanging: async () => {
      entered.resolve();
      await resume.promise;
    },
  });
  cleanup.push(ui.close);
  const post = (method: string, args: unknown[]) =>
    fetch(`${ui.url}/api/product/${method}`, {
      method: "POST",
      headers: { "X-Kaitu": "1", Origin: ui.url },
      body: JSON.stringify(args),
    });
  const captures = await Promise.all(
    Array.from({ length: 12 }, async (_, i) => {
      const response = await post("capture", [`合成并发原文 ${i}`]);
      expect(response.status).toBe(200);
      return ((await response.json()) as { path: string }).path;
    }),
  );
  await expect.poll(() => isTracked(ws, captures.at(-1) as string)).toBe(true);
  for (const file of captures) expect(await isTracked(ws, file)).toBe(true);
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

it("日历网络未返回时任务可完成和存版本，恢复后不应用旧拉取", async () => {
  const fetched = gate<Buffer>();
  const started = gate<void>();
  vi.mocked(fetchCalendar).mockImplementation(() => {
    started.resolve();
    return fetched.promise;
  });
  const { ws, task, before, post } = await setup();
  const calendar = post("product/addCalendarSubscription", ["https://calendar.example/test.ics", "测试"]);
  try {
    await started.promise;
    // 不释放网络 gate：旧的全局队列在这里无法完成。
    const done = await post("tasks/done", { id: task.record.id });
    expect(done.status).toBe(200);
    expect(listTasks(ws, { status: "all" }).find((row) => row.id === task.record.id)?.status).toBe("done");
    await expect.poll(async () => (await history(ws))[0]?.oid).not.toBe(before);
    expect((await post("restore", { version: before })).status).toBe(200);
  } finally {
    fetched.resolve(
      Buffer.from(
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:old-fetch\r\nDTSTART:20261023T120000Z\r\nDTEND:20261023T130000Z\r\nSUMMARY:Synthetic\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n",
      ),
    );
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
