import { rmSync } from "node:fs";
import { Context } from "@deepseek-ai/cordis";
import {
  Workspace,
  addTask,
  buildPhoneToday,
  completeNext,
  draftOnboardingMatter,
  history,
  listTasks,
  onboardingStatus,
  phoneReceipts,
  processInbox,
  readOverviewPage,
  readRecords,
  readStatus,
  saveOnboardingMatter,
  schemas,
  ulid,
  validateWorkspace,
} from "@kaitu/core";
import { expect, it } from "vitest";
import { productRequest } from "../../cli/src/ui/product.js";
import { freshWorkspace } from "../../core/test/helpers.js";
import type { ToolDefinition } from "../src/dsh.js";
import { KaituOverviewService } from "../src/overview-service.js";
import { apply } from "../src/tools.js";

it("Agent 工具只能提出待办，桌面用户采纳才进入今天，重复采纳不重复；用户直接新增不受限", async () => {
  const ws = await freshWorkspace();
  const ctx = new Context();
  try {
    const tools = new Map<string, ToolDefinition>();
    apply(
      {
        tools: {
          register: (tool) => {
            tools.set(tool.name, tool);
            return () => {};
          },
        },
      },
      { workspace: ws.root },
    );
    const exec = { signal: new AbortController().signal };
    const call = (name: string, args: object) => tools.get(name)?.execute(args, exec);
    const matter = await saveOnboardingMatter(ws, "合成原文");
    await call("kaitu_add_record", {
      type: "task",
      fields: {
        title: "伪装成已确认",
        status: "open",
        by: "user",
        confirmed: true,
        source: matter.source,
        notes: "当前目标：合成目标\n",
        due: "2020-01-01",
      },
    });
    await call("kaitu_tasks", { operation: "add", task: { title: "工具建议" } });
    const service = new KaituOverviewService(ctx, { workspace: ws.root });
    const plugin = await service.proposeTask({ title: "插件建议" });
    const tasks = readRecords(ws, "task");
    expect(tasks).toHaveLength(3);
    expect(tasks.every((task) => task.status === "proposed" && task.by === "agent")).toBe(true);
    const id = tasks[0]?.id;
    if (!id) throw new Error("Missing proposal");
    expect(
      await call("kaitu_records", {
        operation: "update",
        type: "task",
        id,
        fields: { status: "open", source: "manual", confirmed: true, by: "user" },
      }),
    ).toMatchObject({ ok: false });
    expect(await call("kaitu_tasks", { operation: "done", id })).toMatchObject({ ok: false });
    expect(await call("kaitu_tasks", { operation: "cancel", id })).toMatchObject({ ok: false });
    expect(readStatus(ws).tasks).toEqual([]);
    let today = await service.overview();
    expect(today.allNext).toEqual([]);
    expect(today.proposedTasks.map((task) => task.id)).toEqual(tasks.map((task) => task.id));
    expect(today.plans.sources).toEqual({});
    expect(onboardingStatus(ws).next).toBeNull();
    await draftOnboardingMatter(ws, matter.source, {
      goal: "合成目标",
      current: "合成现状",
      next: "用户仍可核对",
    });
    expect(
      await call("kaitu_records", {
        operation: "update",
        type: "task",
        id,
        fields: { title: "修订建议文字" },
      }),
    ).toMatchObject({ ok: true });
    const before = await history(ws);
    await service.adoptTask(plugin.id);
    const adopted = readRecords(ws, "task").find((task) => task.id === plugin.id);
    if (!adopted) throw new Error("Missing adopted task");
    expect(adopted).toMatchObject({ status: "open", by: "user", rev: 2 });
    expect(
      await call("kaitu_records", {
        operation: "update",
        type: "task",
        id: plugin.id,
        fields: { title: "借旧 open 塞入的新建议", status: "open", source: "manual", by: "user" },
      }),
    ).toMatchObject({ ok: false });
    expect(readRecords(ws, "task").find((task) => task.id === plugin.id)).toEqual(adopted);
    await productRequest(ws, "adoptTask", [plugin.id]);
    expect(readRecords(ws, "task").find((task) => task.id === plugin.id)).toEqual(adopted);
    expect(await history(ws)).toHaveLength(before.length + 1);
    today = await service.overview();
    expect(today.allNext.filter((task) => task.id === plugin.id)).toHaveLength(1);
    expect(today.proposedTasks.map((task) => task.id)).not.toContain(plugin.id);
    await completeNext(ws, "task", plugin.id);
    expect(listTasks(ws, { status: "done" }).map((task) => task.id)).toContain(plugin.id);
    // 原有用户 UI 的引导采纳直接创建 open；core 用户路径仍保持可用。
    const direct = (await productRequest(ws, "onboardingMatterAdopt", [
      matter.source,
      { goal: "合成目标", current: "合成现状", next: "用户决定" },
      null,
    ])) as { id: string };
    expect(readRecords(ws, "task").find((task) => task.id === direct.id)).toMatchObject({
      status: "open",
      by: "user",
    });
    const user = await addTask(ws, { title: "已有用户事项", due: "2020-01-01" });
    expect(readStatus(ws).tasks.map((task) => task.id)).toContain(user.record.id);
    expect(validateWorkspace(ws)).toEqual([]);
  } finally {
    await ctx.fiber.dispose();
    rmSync(ws.root, { recursive: true, force: true });
  }
});

it("手机 records 不能伪装采纳；create_task 直接可用，adopt_task 与重投沿用回执且保留旧记录", async () => {
  const ws = await freshWorkspace();
  try {
    const file = `inbox/agents/ios-3fa9c1d2-${ulid()}.records.jsonl`;
    ws.writeText(
      file,
      JSON.stringify({
        type: "task",
        title: "Agent 冒用手机来源",
        status: "open",
        origin: "user",
        by: "user",
        confirmed: true,
        source: "manual",
      }),
    );
    await processInbox(ws, { stableMs: 0 });
    const proposed = readRecords(ws, "task")[0];
    if (!proposed) throw new Error("Missing proposal");
    expect(proposed).toMatchObject({ status: "proposed", by: "agent" });
    const now = new Date().toISOString();
    const action = (op: string, args: object) => ({
      client_id: ulid(),
      at: now,
      device: "3fa9c1d2",
      op,
      args,
    });
    const userId = ulid();
    const create = action("create_task", { id: userId, expected_rev: 0, title: "手机用户亲自新增" });
    const adopt = action("adopt_task", { id: proposed.id });
    const submit = async (actions: object[]) => {
      ws.writeText(
        `inbox/agents/ios-3fa9c1d2-${ulid()}.actions.jsonl`,
        actions.map((a) => JSON.stringify(a)).join("\n"),
      );
      await processInbox(ws, { stableMs: 0 });
    };
    const before = buildPhoneToday(await readOverviewPage(ws), now, ws);
    expect(before.mobile.tasks).toEqual([]);
    expect(schemas().builtin("phone-today.schema.json")(before)).toBe(true);
    await submit([create, adopt]);
    const rows = readRecords(ws, "task");
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: userId, status: "open", by: "user", rev: 1 }),
        expect.objectContaining({ id: proposed.id, status: "open", by: "user", rev: 2 }),
      ]),
    );
    const bytes = ws.readText(`me/data/tasks/${proposed.ts.slice(0, 7)}.jsonl`);
    await submit([create, adopt, action("adopt_task", { id: proposed.id })]);
    expect(readRecords(ws, "task")).toEqual(rows);
    expect(ws.readText(`me/data/tasks/${proposed.ts.slice(0, 7)}.jsonl`)).toBe(bytes);
    expect(phoneReceipts(ws).find((receipt) => receipt.ref === adopt.client_id)?.status).toBe("duplicate");
    const today = buildPhoneToday(await readOverviewPage(ws), now, ws);
    expect(today.mobile.tasks.map((task) => task.id)).toEqual(expect.arrayContaining([userId, proposed.id]));
    expect(schemas().builtin("phone-today.schema.json")(today)).toBe(true);
    // 同一批的旧式完成操作会缓存 open 任务；采纳新建议后须立刻看到它。
    const batch = await addTask(ws, { title: "合成同批建议" }, { by: "agent" });
    const finish = action("complete_task", { id: batch.record.id });
    await submit([
      action("complete_task", { id: userId }),
      action("adopt_task", { id: batch.record.id }),
      finish,
    ]);
    expect(listTasks(ws, { status: "done" }).map((task) => task.id)).toEqual(
      expect.arrayContaining([userId, batch.record.id]),
    );
    expect(phoneReceipts(ws).find((receipt) => receipt.ref === finish.client_id)?.status).toBe("applied");
    // 旧格式中即使由 Agent 写成 open/done，也按历史状态读取，不猜测迁移。
    const legacy = ["open", "done"].map((status) => ({
      id: ulid(),
      ts: now,
      by: "agent",
      title: "旧任务",
      status,
    }));
    for (const row of legacy)
      ws.appendLine(`me/data/tasks/${proposed.ts.slice(0, 7)}.jsonl`, JSON.stringify(row));
    const oldBytes = ws.readText(`me/data/tasks/${proposed.ts.slice(0, 7)}.jsonl`);
    const reopened = new Workspace(ws.root);
    expect(listTasks(reopened).map((task) => task.id)).toContain(legacy[0]?.id);
    expect(listTasks(reopened, { status: "done" }).map((task) => task.id)).toContain(legacy[1]?.id);
    expect(ws.readText(`me/data/tasks/${proposed.ts.slice(0, 7)}.jsonl`)).toBe(oldBytes);
    expect(validateWorkspace(ws)).toEqual([]);
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});
