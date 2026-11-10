import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Service } from "@deepseek-ai/cordis";
import ScheduleService from "@deepseek-ai/dsh-schedule";
import Storage from "@deepseek-ai/dsh-storage";
import { DomainFacility } from "@deepseek-ai/dsh-storage-domain";
import { JsonStorageBackend } from "@deepseek-ai/dsh-storage-json";
import { Workspace, configureAutomation, readAutomation } from "@kaitu/core";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clonedWorkspace } from "../../core/test/helpers.js";
import { type ScheduleContext, setupSchedules } from "../src/schedules.js";

const roots: string[] = [];
const contexts: Context[] = [];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime("2030-01-01T00:00:00Z");
});
afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose();
  vi.useRealTimers();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function temporary() {
  const root = mkdtempSync(join(tmpdir(), "kaitu-schedules-"));
  roots.push(root);
  return root;
}
async function workspace() {
  return clonedWorkspace("Asia/Shanghai", join(temporary(), "workspace"));
}
// Real RC1 management, validation, revision checks and JSON storage. Only Session activation
// is a fixture: no model is run and every target must have a persisted synthetic header.
async function host(root = temporary(), sessions = new Map<string, string>()) {
  const ctx = new Context();
  contexts.push(ctx);
  await ctx.plugin(Storage);
  const backend = new JsonStorageBackend(root);
  ctx.storage.backend.register("fixture", backend);
  const facility = new DomainFacility(ctx, { backend: "fixture" });
  ctx.provide("storageDomain", facility);
  ctx.effect(() => async () => {
    await facility.closeAll();
    await backend.close();
  });
  ctx.provide("agents", {
    get: () => undefined,
    withoutInitiator: (work: () => Promise<unknown>) => work(),
  } as never);
  ctx.provide("sessionPersistence", {
    stat: async (id: string) => (sessions.has(id) ? { header: { id, cwd: sessions.get(id) } } : undefined),
  } as never);
  const live = new Map<string, string>();
  const create = vi.fn(async (input: { sessionId: string; cwd: string }) => {
    live.set(input.sessionId, input.cwd);
    return input;
  });
  const lifecycle: Omit<ScheduleContext, "schedule"> = {
    sessionController: {
      create,
      resolveAgent: async (sessionId) =>
        sessions.has(sessionId) || live.has(sessionId)
          ? {
              agent: {
                session: { header: { id: sessionId, cwd: live.get(sessionId) ?? sessions.get(sessionId) } },
              },
            }
          : { error: { code: "session/not-found" } },
    },
    sessions: {
      flush: async (session) => {
        const { id, cwd } = (session as { header: { id: string; cwd: string } }).header;
        sessions.set(id, cwd);
        return true;
      },
    },
  };
  ctx.provide("sessions", lifecycle.sessions as never);
  const service = new ScheduleService(ctx, {});
  await service[Service.init]();
  return {
    root,
    sessions,
    service,
    create,
    close: () => ctx.fiber.dispose(),
    ctx: { ...lifecycle, schedule: service } satisfies ScheduleContext,
  };
}
function receipt(ws: Workspace) {
  return ws.readJson<{ sessionId: string; tasks: Record<string, string>; applied?: Record<string, boolean> }>(
    ".kaitu/dsh-setup.json",
  );
}
async function task(service: ScheduleService, id: string | undefined) {
  const entry = (await service.catalog()).find((row) => row.id === id);
  if (!entry) throw new Error(`Missing task ${id}`);
  return entry;
}

it("确认、关闭、恢复及重启保留用户周期，不补回手动删除的任务，也不收养同名任务", async () => {
  const ws = await workspace();
  let h = await host();
  await setupSchedules(h.ctx, ws);
  expect(await h.service.catalog()).toEqual([]);
  expect(readAutomation(ws).asked).toBe(false);
  configureAutomation(ws, { morning: true, organizer: true, news: true });
  await setupSchedules(h.ctx, ws);
  const setup = receipt(ws);
  const morning = await task(h.service, setup.tasks.morning);
  const organizer = await task(h.service, setup.tasks.organizer);
  await h.service.edit({
    id: morning.id,
    action: "update",
    patch: {
      title: "我的早间计划",
      prompt: "用户修改的提示",
      timing: { kind: "weekly", weekly: { time: "09:15:00", time_zone: "Europe/Berlin", weekdays: [2, 5] } },
    },
  });
  await h.service.edit({ id: organizer.id, action: "delete" });
  const unrelated = await h.service.create({
    title: organizer.title,
    prompt: "独立任务",
    timing: { kind: "every", every_seconds: 3600 },
    target: morning.target,
  });
  await setupSchedules(h.ctx, ws);
  expect((await h.service.catalog()).map((row) => row.id)).not.toContain(organizer.id);
  configureAutomation(ws, { morning: false });
  await setupSchedules(h.ctx, ws);
  expect(await task(h.service, morning.id)).toMatchObject({
    status: "paused",
    kind: "weekly",
    time: "09:15:00.000",
  });
  await h.close();
  h = await host(h.root, h.sessions);
  configureAutomation(ws, { morning: true }, { morning: "10:20" });
  await setupSchedules(h.ctx, ws);
  expect(await task(h.service, morning.id)).toMatchObject({
    title: "我的早间计划",
    prompt: "用户修改的提示",
    status: "active",
    kind: "weekly",
    time: "10:20:00.000",
    timeZone: "Europe/Berlin",
    weekdays: [2, 5],
  });
  configureAutomation(ws, { organizer: false }, { organizer: "05:45" });
  await setupSchedules(h.ctx, ws);
  expect(readAutomation(ws).times.organizer).toBe("05:45");
  configureAutomation(ws, { organizer: true });
  await setupSchedules(h.ctx, ws);
  expect(receipt(ws).tasks.organizer).not.toBe(unrelated.id);
  expect(await task(h.service, unrelated.id)).toEqual(unrelated);
  const paused = await task(h.service, morning.id);
  await h.service.edit({ id: paused.id, action: "update", patch: { active: false } });
  await setupSchedules(h.ctx, ws);
  expect((await task(h.service, morning.id)).status).toBe("paused");
});

it("读取旧回执和 v1 Host 文件不重写任务，关闭后由 RC1 原生迁移且保留投递历史", async () => {
  const ws = await workspace();
  let h = await host();
  configureAutomation(ws, { morning: true, organizer: false, news: false });
  await setupSchedules(h.ctx, ws);
  const setup = receipt(ws);
  await h.close();
  const file = join(h.root, "schedule.json");
  const stored = JSON.parse(readFileSync(file, "utf8"));
  const morning = setup.tasks.morning;
  if (!morning) throw new Error("Missing morning receipt");
  const row = stored.tables.tasks[morning];
  const record = row.record;
  const delivery = {
    scheduledAt: "2029-12-31T23:30:00.000Z",
    deliveredAt: "2029-12-31T23:30:01.000Z",
    messageId: "synthetic-receipt",
  };
  stored.unit.version = 1;
  stored.tables.tasks[record.id] = { sessionId: setup.sessionId, record, lastDelivery: delivery };
  const bytes = JSON.stringify(stored);
  writeFileSync(file, bytes);
  rmSync(ws.resolve(".kaitu/automation.json", { internal: true }));
  ws.writeJson(
    ".kaitu/dsh-setup.json",
    { sessionId: setup.sessionId, tasks: setup.tasks },
    { internal: true },
  );
  h = await host(h.root, h.sessions);
  await setupSchedules(h.ctx, ws);
  expect(readFileSync(file, "utf8")).toBe(bytes);
  expect(readAutomation(ws).asked).toBe(true);
  configureAutomation(ws, { morning: false });
  await setupSchedules(h.ctx, ws);
  const migrated = JSON.parse(readFileSync(file, "utf8"));
  expect(migrated.unit.version).toBe(2);
  expect(migrated.tables.tasks[record.id]).toMatchObject({
    record,
    status: "paused",
    target: { kind: "session", sessionId: setup.sessionId },
  });
  expect(migrated.tables.tasks[record.id]).not.toHaveProperty("sessionId");
  await h.close();
  h = await host(h.root, h.sessions);
  configureAutomation(ws, { morning: true });
  await setupSchedules(h.ctx, ws);
  expect(h.create).not.toHaveBeenCalled();
  expect(await h.service.history({ id: record.id, limit: 10 })).toMatchObject({
    records: [{ ...delivery, targetSessionId: setup.sessionId }],
  });
});

it("恢复旧版已删除任务的 saved 周期，RC1 RRULE 关闭恢复无损，不能用钟点覆盖自定义周期", async () => {
  const ws = await workspace();
  const h = await host();
  ws.writeJson(
    ".kaitu/dsh-setup.json",
    {
      sessionId: "legacy",
      tasks: { morning: "deleted" },
      applied: { morning: false, organizer: false, news: false },
      saved: {
        morning: { title: "自定义", prompt: "用户提示", cron: { expression: "0 9 * * 1", time_zone: "UTC" } },
      },
    },
    { internal: true },
  );
  configureAutomation(ws, { morning: true, organizer: false, news: false });
  await setupSchedules(h.ctx, ws);
  const restored = await task(h.service, receipt(ws).tasks.morning);
  expect(restored).toMatchObject({
    kind: "cron",
    expression: "0 9 * * 1",
    title: "自定义",
    prompt: "用户提示",
  });
  await h.service.edit({
    id: restored.id,
    action: "update",
    patch: { timing: { kind: "rrule", rrule: "DTSTART:20300102T090000Z\nRRULE:FREQ=DAILY;INTERVAL=2" } },
  });
  configureAutomation(ws, { morning: false });
  await setupSchedules(h.ctx, ws);
  expect((await task(h.service, restored.id)).status).toBe("paused");
  configureAutomation(ws, { morning: true });
  await setupSchedules(h.ctx, ws);
  const rrule = await task(h.service, restored.id);
  expect(rrule).toMatchObject({ kind: "rrule", status: "active" });
  configureAutomation(ws, {}, { morning: "11:00" });
  await expect(setupSchedules(h.ctx, ws)).rejects.toThrow();
  expect(await task(h.service, restored.id)).toEqual(rrule);
  configureAutomation(ws, { morning: false });
  await setupSchedules(h.ctx, ws);
  expect(await task(h.service, restored.id)).toMatchObject({ kind: "rrule", status: "paused" });
});

it("迁址重试保留 ID、暂停和周期，不移动已改投递目标的任务", async () => {
  const ws = await workspace();
  const h = await host();
  configureAutomation(ws, { morning: true, organizer: true, news: true });
  await setupSchedules(h.ctx, ws);
  const setup = receipt(ws);
  const morning = await task(h.service, setup.tasks.morning);
  const news = await task(h.service, setup.tasks.news);
  await h.service.edit({
    id: morning.id,
    action: "update",
    patch: { active: false, timing: { kind: "every", every_seconds: 7200 } },
  });
  h.sessions.set("other-owner", "/synthetic/other-owner");
  await h.service.edit({
    id: news.id,
    action: "update",
    patch: { target: { kind: "session", sessionId: "other-owner" as never } },
  });
  const independent = await task(h.service, news.id);
  const beforeMove = await task(h.service, morning.id);
  ws.writeJson(
    ".kaitu/dsh-setup.json",
    { ...ws.readJson<object>(".kaitu/dsh-setup.json"), root: "/synthetic/old-location" },
    { internal: true },
  );
  const fail = vi.spyOn(h.service, "edit").mockImplementationOnce(async (request) => {
    fail.mockRestore();
    await h.service.edit(request);
    throw new Error("Synthetic interruption after commit");
  });
  await expect(setupSchedules(h.ctx, ws)).rejects.toThrow("Synthetic interruption");
  await setupSchedules(h.ctx, ws);
  const moved = receipt(ws);
  expect(moved.sessionId).not.toBe(setup.sessionId);
  expect(moved.tasks).toEqual(setup.tasks);
  expect(await task(h.service, morning.id)).toMatchObject({
    id: morning.id,
    kind: "every",
    everySeconds: 7200,
    scheduledAt: beforeMove.scheduledAt,
    status: "paused",
    target: { kind: "session", sessionId: moved.sessionId },
  });
  expect(await task(h.service, news.id)).toEqual(independent);
  expect(await h.service.catalog()).toHaveLength(3);
});

it("修改冲突及会话持久化失败不覆盖外部修改、不确认完成或误建任务", async () => {
  const ws = await workspace();
  const h = await host();
  configureAutomation(ws, { morning: true, organizer: false, news: false });
  const flush = h.ctx.sessions.flush;
  h.ctx.sessions.flush = async () => false;
  await expect(setupSchedules(h.ctx, ws)).rejects.toThrow();
  expect(await h.service.catalog()).toEqual([]);
  h.ctx.sessions.flush = flush;
  await setupSchedules(h.ctx, ws);
  const before = await task(h.service, receipt(ws).tasks.morning);
  configureAutomation(ws, { morning: false });
  const conflict = vi.spyOn(h.service, "edit").mockImplementationOnce(async (request) => {
    conflict.mockRestore();
    await h.service.edit({ id: before.id, action: "update", patch: { prompt: "并发修改" } });
    return h.service.edit(request);
  });
  await expect(setupSchedules(h.ctx, ws)).rejects.toThrow();
  expect(await task(h.service, before.id)).toMatchObject({ prompt: "并发修改", status: "active" });
  expect(receipt(ws).applied?.morning).toBe(true);
  await setupSchedules(h.ctx, ws);
  expect(await task(h.service, before.id)).toMatchObject({ prompt: "并发修改", status: "paused" });
});

it("继续旧版复制后未删除的迁址回执，只删除登记的旧任务且保留目标会话同名任务", async () => {
  const ws = await workspace();
  const h = await host();
  configureAutomation(ws, { morning: true, organizer: false, news: false });
  await setupSchedules(h.ctx, ws);
  const setup = receipt(ws);
  const prior = await task(h.service, setup.tasks.morning);
  h.sessions.set("legacy-moved", ws.root);
  const copy = await h.service.create({
    title: prior.title,
    prompt: prior.prompt,
    timing: { kind: "daily", daily: { time: "09:30:00", time_zone: "UTC" } },
    target: { kind: "session", sessionId: "legacy-moved" as never },
  });
  const other = await h.service.create({
    title: prior.title,
    prompt: "不属于开图回执",
    timing: { kind: "every", every_seconds: 3600 },
    target: copy.target,
  });
  ws.writeJson(
    ".kaitu/dsh-setup.json",
    {
      ...ws.readJson<object>(".kaitu/dsh-setup.json"),
      root: "/synthetic/old-location",
      tasks: { morning: copy.id },
      relocation: {
        oldSession: setup.sessionId,
        sessionId: "legacy-moved",
        oldTasks: setup.tasks,
        inputs: {
          morning: {
            title: prior.title,
            prompt: prior.prompt,
            daily: { time: "09:30:00", time_zone: "UTC" },
          },
        },
      },
    },
    { internal: true },
  );
  await setupSchedules(h.ctx, ws);
  expect(await h.service.view({ id: prior.id })).toMatchObject({ code: "schedule_not_found" });
  expect(await task(h.service, copy.id)).toEqual(copy);
  expect(await task(h.service, other.id)).toEqual(other);
  expect(receipt(ws).sessionId).toBe("legacy-moved");
  await setupSchedules(h.ctx, ws);
  expect(await h.service.catalog()).toHaveLength(2);
});

function relocate(ws: Workspace) {
  const root = join(temporary(), "workspace");
  cpSync(ws.root, root, { recursive: true });
  return new Workspace(root);
}

it("连续迁址中断后拒绝复用前一个目录的会话，保留未完成回执和任务目标", async () => {
  const first = await workspace();
  const h = await host();
  configureAutomation(first, { morning: true, organizer: false, news: false });
  await setupSchedules(h.ctx, first);
  const second = relocate(first);
  const persist = h.ctx.sessions.flush;
  const interrupted = vi.spyOn(h.ctx.sessions, "flush").mockImplementationOnce(async (session) => {
    await persist(session);
    throw new Error("Interrupted after session persistence");
  });
  await expect(setupSchedules(h.ctx, second)).rejects.toThrow("Interrupted");
  interrupted.mockRestore();
  const checkpoint = second.readJson<{ relocation: { sessionId: string } }>(".kaitu/dsh-setup.json");
  const before = await h.service.catalog();
  const third = relocate(second);
  h.create.mockClear();
  const flush = vi.spyOn(h.ctx.sessions, "flush");
  await expect(setupSchedules(h.ctx, third)).rejects.toThrow("其他目录");
  expect(third.readJson(".kaitu/dsh-setup.json")).toEqual(checkpoint);
  expect(await h.service.catalog()).toEqual(before);
  expect(h.sessions.get(checkpoint.relocation.sessionId)).toBe(second.root);
  expect(flush).not.toHaveBeenCalled();
  expect(h.create).not.toHaveBeenCalled();
  await setupSchedules(h.ctx, second);
  expect(h.create).not.toHaveBeenCalled();
  expect((await h.service.catalog())[0]?.target).toEqual({
    kind: "session",
    sessionId: checkpoint.relocation.sessionId,
  });
});

it("无 root 旧回执在异址恢复时不确认新 root、不保存会话或改任务", async () => {
  const first = await workspace();
  const h = await host();
  configureAutomation(first, { morning: true, organizer: false, news: false });
  await setupSchedules(h.ctx, first);
  const { sessionId, tasks } = receipt(first);
  first.writeJson(".kaitu/dsh-setup.json", { sessionId, tasks }, { internal: true });
  const moved = relocate(first);
  const before = await h.service.catalog();
  h.create.mockClear();
  const flush = vi.spyOn(h.ctx.sessions, "flush");
  await expect(setupSchedules(h.ctx, moved)).rejects.toThrow("其他目录");
  expect(moved.readJson(".kaitu/dsh-setup.json")).toEqual({ sessionId, tasks });
  expect(await h.service.catalog()).toEqual(before);
  expect(h.sessions.get(sessionId)).toBe(first.root);
  expect(flush).not.toHaveBeenCalled();
  expect(h.create).not.toHaveBeenCalled();
});
