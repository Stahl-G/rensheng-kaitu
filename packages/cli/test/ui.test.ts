import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import {
  type Workspace,
  createHomeCache,
  history,
  localDate,
  localStateRoot,
  parseFrontmatter,
  readRecords,
  snapshot,
  stringifyFrontmatter,
} from "@kaitu/core";
import { afterEach, expect, it, onTestFailed, vi } from "vitest";
import { appleHealthZip, clonedWorkspace } from "../../core/test/helpers.js";
import { type UiOptions, startUi } from "../src/ui/server.js";

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
    enableSync: (...args: Parameters<typeof core.enableSync>) =>
      call("enableSync", args[0], () => core.enableSync(...args)),
    disableSync: (...args: Parameters<typeof core.disableSync>) =>
      call("disableSync", args[0], () => core.disableSync(...args)),
    snapshotNow: (...args: Parameters<typeof core.snapshotNow>) =>
      call("snapshotNow", args[0], () => core.snapshotNow(...args)),
    pauseNoteIndex: (...args: Parameters<typeof core.pauseNoteIndex>) =>
      call("pauseNoteIndex", args[0], () => core.pauseNoteIndex(...args)),
  };
});

const cleanup: (() => Promise<void>)[] = [];
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
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
async function setup(
  prepareHome = false,
  hooks: Pick<UiOptions, "onWorkspaceChanging" | "onWorkspaceChanged"> = {},
) {
  const root = mkdtempSync(join(tmpdir(), "kaitu-ui-"));
  cleanup.push(async () => rmSync(root, { recursive: true, force: true }));
  const ws = await clonedWorkspace(undefined, root);
  ws.writeText(
    "NOW.md",
    stringifyFrontmatter(
      {
        date: "2026-10-15",
        blocks: [
          { id: "p1", title: "腿部训练", kind: "proposal", status: "pending", start: "18:00", end: "19:00" },
        ],
      },
      "正文\n",
    ),
  );
  await snapshot(ws, "计划");
  if (prepareHome) {
    const home = createHomeCache(ws, () => {});
    try {
      await expect.poll(() => home.read().loading, { timeout: 15000 }).toBe(false);
      expect(home.read().error).toBeNull();
    } finally {
      await home.close();
    }
  }
  const ui = await startUi(ws, {
    port: 0,
    open: false,
    snapshotDelayMs: 80,
    refreshDelayMs: 10,
    inboxStableMs: 30,
    ...hooks,
  });
  cleanup.push(ui.close);
  return { ws, ui };
}
it("拒绝错误 Host、缺少 X-Kaitu 或非本机 Origin 的写操作", async () => {
  const { ws, ui } = await setup(true);
  const home = await fetch(`${ui.url}/api/product/home`, {
    method: "POST",
    headers: { "X-Kaitu": "1", Origin: ui.url },
    body: "[]",
  });
  expect(home.status).toBe(200);
  expect(await home.json()).toMatchObject({
    loading: false,
    error: null,
    data: { today: expect.any(String) },
  });
  const before = await history(ws);
  const status = await new Promise<number | undefined>((resolve, reject) => {
    const req = httpRequest(`${ui.url}/api/state`, { headers: { Host: "attacker.example" } }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode));
    });
    req.on("error", reject);
    req.end();
  });
  expect(status).toBe(403);
  for (const headers of [
    { Origin: ui.url },
    { "X-Kaitu": "1", Origin: "https://attacker.example" },
    { "X-Kaitu": "1" },
  ]) {
    const response = await fetch(`${ui.url}/api/proposal`, {
      method: "POST",
      headers,
      body: JSON.stringify({ id: "p1", decision: "confirmed" }),
    });
    expect(response.status).toBe(403);
  }
  expect(await history(ws)).toEqual(before);
});
it("外部改动自动生成版本，接口写入不会被监听器重复保存", async () => {
  const { ws, ui } = await setup();
  const before = (await history(ws)).length;
  const overview = ws.readText("OVERVIEW.md");
  const plan = parseFrontmatter<{ date: string; blocks: { title: string }[] }>(ws.readText("NOW.md"));
  if (plan.data.blocks[0]) plan.data.blocks[0].title = "外部改动后的训练";
  writeFileSync(join(ws.root, "NOW.md"), stringifyFrontmatter(plan.data, plan.body));
  await expect
    .poll(async () => ({ versions: (await history(ws)).length, overview: ws.readText("OVERVIEW.md") }), {
      timeout: 15000,
    })
    .toEqual({ versions: before + 1, overview: expect.stringContaining("外部改动后的训练") });
  expect(ws.readText("OVERVIEW.md")).not.toBe(overview);
  const response = await fetch(`${ui.url}/api/proposal`, {
    method: "POST",
    headers: { "X-Kaitu": "1", Origin: ui.url },
    body: JSON.stringify({ id: "p1", decision: "confirmed" }),
  });
  expect(response.status).toBe(200);
  await expect.poll(async () => (await history(ws)).length, { timeout: 15000 }).toBe(before + 2);
  ws.writeJson("inbox/agents/auto.proposal.json", {
    title: "散步",
    start: "20:00",
    end: "20:30",
    agent: "auto-source",
  });
  await expect.poll(async () => (await history(ws)).length, { timeout: 15000 }).toBe(before + 3);
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect((await history(ws)).length).toBe(before + 3);
});

it("图片接口只返回有记录的照片，拒绝任意路径和 ..", async () => {
  const { ws, ui } = await setup();
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aR1sAAAAASUVORK5CYII=",
    "base64",
  );
  const response = await fetch(`${ui.url}/api/photos/add?pose=side`, {
    method: "POST",
    headers: { "X-Kaitu": "1", Origin: ui.url },
    body: bytes,
  });
  expect(response.status).toBe(200);
  const { record } = await response.json();
  const photo = await fetch(`${ui.url}/api/photos/${record.id}`);
  expect(photo.headers.get("content-type")).toBe("image/png");
  expect(Buffer.from(await photo.arrayBuffer())).toEqual(bytes);
  ws.writeText("health/files/photos/unregistered.png", bytes);
  for (const path of [
    "health/files/photos/unregistered.png",
    "../me/profile.md",
    "files/photos/../../me/profile.md",
  ]) {
    expect((await fetch(`${ui.url}/api/photos/${encodeURIComponent(path)}`)).status).not.toBe(200);
  }
  ws.appendLine(
    "health/data/photos/2026-10.jsonl",
    JSON.stringify({
      ...record,
      file: "files/photos/../secret.png",
      rev: 2,
    }),
  );
  expect((await fetch(`${ui.url}/api/photos/${record.id}`)).status).toBe(400);
});

it("工作台自动导入健康 zip 并归档原件", async () => {
  const { ws } = await setup();
  const before = (await history(ws)).length;
  const zip = appleHealthZip();
  const incoming = "inbox/health/export.zip";
  ws.writeText(incoming, zip);
  await expect.poll(() => readRecords(ws, "metric").length, { timeout: 5000 }).toBe(6);
  await expect.poll(async () => (await history(ws)).length, { timeout: 5000 }).toBe(before + 1);
  expect(readRecords(ws, "workout")).toMatchObject([
    { exercise: "跑步", modality: "cardio", duration_min: 60 },
  ]);
  const archived = `inbox/processed/${localDate(new Date(), ws.timeZone())}/export.zip`;
  expect(ws.exists(archived)).toBe(true);
  expect(ws.exists(incoming)).toBe(false);
});

it("独立资料接口无需 AI，JSON 空选项可读取财务，原文回读后才主动开启 AI", async () => {
  const { ws } = await setup();
  let launches = 0;
  const ui = await startUi(ws, {
    port: 0,
    open: false,
    openAi: async () => {
      launches++;
      return {};
    },
  });
  cleanup.push(ui.close);
  const call = async (method: string, args: unknown[] = []) => {
    const response = await fetch(`${ui.url}/api/product/${method}`, {
      method: "POST",
      headers: { "X-Kaitu": "1", Origin: ui.url },
      body: JSON.stringify(args),
    });
    expect(response.status).toBe(200);
    return response.json();
  };
  const initial = await call("overview");
  expect(initial.metrics.every((metric: { target: unknown }) => metric.target === null)).toBe(true);
  const finance = await call("financeOverview", [null]);
  expect(finance.currencies).toEqual([]);
  expect(finance.records).toEqual([]);
  for (const method of ["financeAccounts", "financeInvestments"]) await call(method, [null]);
  await call("capture", ["今天散步四十分钟。"]);
  const overview = await call("overview");
  expect(overview.notes.some((note: { text: string }) => note.text.includes("今天散步四十分钟。"))).toBe(
    true,
  );
  expect(overview.sync.received).toBe(1);
  await call("decideProposal", ["p1", "confirmed"]);
  const plan = parseFrontmatter<{ blocks: { id: string; status: string }[] }>(ws.readText("NOW.md"));
  expect(plan.data.blocks.find((block) => block.id === "p1")?.status).toBe("confirmed");
  expect(launches).toBe(0);
  await call("openAi", ["一起回顾我的近期目标"]);
  expect(launches).toBe(1);
  expect(ws.readJson(".kaitu/cache/ai-draft.json", { internal: true })).toEqual({
    id: expect.any(String),
    text: "一起回顾我的近期目标",
  });
});

it("开启同步后用原来的 {to} 关闭同步，两个关闭接口都能回到本机", async () => {
  const { ws, ui } = await setup(false, {
    onWorkspaceChanging: async () => diagnostic.mark("prepared"),
    onWorkspaceChanged: async () => diagnostic.mark("watchers-restored"),
  });
  const diagnostic = observeMigration(ws);
  const post = (path: string, body: unknown, target: string) => {
    diagnostic.begin(path, target);
    return fetch(`${ui.url}${path}`, {
      method: "POST",
      headers: { "X-Kaitu": "1", Origin: ui.url },
      body: JSON.stringify(body),
    }).then((response) => {
      diagnostic.mark(`http:${response.status}`);
      return response;
    });
  };
  for (const [enable, disable, body] of [
    ["/api/sync/enable", "/api/sync/disable", { mode: "drive" }],
    ["/api/drive/enable", "/api/drive/disable", {}],
  ] as const) {
    const folder = mkdtempSync(join(tmpdir(), "kaitu-ui-sync-"));
    const back = mkdtempSync(join(tmpdir(), "kaitu-ui-back-"));
    // 放到最前面：先关掉服务（后台存版本），再删目录。
    cleanup.unshift(async () => {
      rmSync(folder, { recursive: true, force: true });
      rmSync(back, { recursive: true, force: true });
    });
    const enabled = await post(enable, { ...body, dir: folder }, join(folder, "kaitu-ai-memory"));
    const enabledBody = await enabled.json();
    expect(enabled.status, JSON.stringify({ route: enable, response: enabledBody })).toBe(200);
    expect(enabledBody.mode).toBe("drive");
    const disabled = await post(disable, { to: join(back, "kaitu") }, join(back, "kaitu"));
    const disabledBody = await disabled.json();
    expect(disabled.status, JSON.stringify({ route: disable, response: disabledBody })).toBe(200);
    expect(disabledBody.mode).toBe("local");
    expect(ws.root).toBe(join(back, "kaitu"));
  }
});
