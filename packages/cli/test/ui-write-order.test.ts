import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addTask, history, initWorkspace, listTasks, readRecords } from "@kaitu/core";
import { afterEach, expect, it, vi } from "vitest";
import { fetchCalendar } from "../../core/src/calendar-fetch.js";
import type { AskService } from "../src/ui/ask.js";
import { startUi } from "../src/ui/server.js";

vi.mock("../../core/src/calendar-fetch.js", () => ({ fetchCalendar: vi.fn() }));
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.resetAllMocks();
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
async function setup(ask?: AskService) {
  const root = mkdtempSync(join(tmpdir(), "kaitu-ui-order-"));
  cleanup.push(async () => rmSync(root, { recursive: true, force: true }));
  const ws = await initWorkspace(root);
  const task = await addTask(ws, { title: "合成任务" });
  const other = await addTask(ws, { title: "合成待取消" });
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
