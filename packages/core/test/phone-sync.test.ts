import { rmSync } from "node:fs";
import { basename, join } from "node:path";
import { expect, it } from "vitest";
import { assertAgentWrite } from "../src/agent-file-policy.js";
import { parseFrontmatter, stringifyFrontmatter } from "../src/frontmatter.js";
import {
  Workspace,
  addMemory,
  addRecord,
  buildPhoneMap,
  buildPhoneToday,
  buildPhoneWeek,
  calendarPushEntries,
  editCalendarBlock,
  inboxNoteDone,
  lifeMap,
  listModules,
  pendingWorkspaceFiles,
  phoneReceipts,
  processInbox,
  readExploration,
  readOverviewPage,
  readRecords,
  schemas,
  snapshot,
  writePhoneSnapshots,
} from "../src/index.js";
import { ulid } from "../src/ulid.js";
import {
  type BackupFiles,
  type BackupRemote,
  connectWorkspaceBackup,
  syncWorkspaceBackup,
} from "../src/workspace-backup.js";
import { freshWorkspace, workout } from "./helpers.js";

const phoneFile = (suffix: string) => `inbox/agents/ios-3fa9c1d2-${ulid()}.${suffix}`;
function remoteMock() {
  let files: BackupFiles = {};
  const remote: BackupRemote = {
    async inspect() {
      return { private: true, branch: "main" };
    },
    async read() {
      return { head: "synthetic", files: { ...files } };
    },
    async push(_repo, _branch, _head, next) {
      files = { ...next };
      return "synthetic";
    },
  };
  return {
    remote,
    files: () => files,
    deliver: (path: string, text: string) => {
      files[path] = text;
    },
  };
}

it("快照投影符合手机契约且不带原文、凭据、链接路径或财务明细；生成目录不可被 Agent 改写或进历史", async () => {
  const ws = await freshWorkspace();
  const now = new Date("2026-10-18T12:00:00Z");
  ws.writeText(
    "projects/synthetic/STATUS.md",
    stringifyFrontmatter(
      {
        title: "合成项目",
        kind: "work",
        stage: "active",
        links: [{ path: join(ws.root, "private-manuscript"), role: "manuscript" }],
        updated: now.toISOString(),
        next: [{ id: "next-map", title: "合成下一步", status: "todo" }],
      },
      "PRIVATE_PROJECT_BODY",
    ),
  );
  addRecord(ws, "workout", { ...workout, ts: now.toISOString() });
  await addMemory(ws, {
    type: "fact",
    name: "PRIVATE_MEMORY_NAME",
    text: "PRIVATE_MEMORY_BODY",
    sensitive: true,
  });
  const data = await readOverviewPage(ws, now);
  const map = lifeMap(ws, now);
  const from = { name: "合成甲", lat: 10, lng: 170, precision: "city" as const };
  const to = { name: "合成乙", lat: 20, lng: -170, precision: "city" as const };
  map.features = [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [170, 10] },
      properties: { place: from, layer: "now", experiences: [] },
    },
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [-170, 20] },
      properties: { place: to, layer: "planned", experiences: [] },
    },
  ];
  const snapshots = {
    today: buildPhoneToday(data, now.toISOString()),
    week: buildPhoneWeek(data, now.toISOString()),
    map: buildPhoneMap(data, map, readExploration(ws), now.toISOString()),
  };
  for (const [name, value] of Object.entries(snapshots)) {
    const validate = schemas().builtin(`phone-${name}.schema.json`);
    expect(validate(value), JSON.stringify(validate.errors)).toBe(true);
  }
  expect(snapshots.map.routes.planned).toHaveLength(2);
  expect(snapshots.week.projects[0]?.kind).toBe("work");
  expect(snapshots.week.health.workouts).toBe(1);
  expect(snapshots.map.rows[0]?.ahead).toBe("planned");
  expect(JSON.stringify(snapshots)).not.toContain(ws.root);
  expect(JSON.stringify(snapshots)).not.toContain("PRIVATE_");
  expect(await writePhoneSnapshots(ws, now)).toBe(0);
  const m = remoteMock();
  await connectWorkspaceBackup(ws, { repo: "synthetic/phone", text: false, records: false }, m.remote);
  await writePhoneSnapshots(ws, now);
  expect(await writePhoneSnapshots(ws, new Date(now.getTime() + 1000))).toBe(0);
  expect(listModules(ws).some((m) => m.dir === "phone")).toBe(false);
  expect(() => assertAgentWrite(ws.root, "phone/today.json")).toThrow();
  await snapshot(ws, "合成版本");
  expect((await pendingWorkspaceFiles(ws)).some((p) => p.startsWith("phone/"))).toBe(false);
  const validate = schemas().builtin("phone-receipts.schema.json");
  expect(validate(ws.readJson("phone/receipts.json"))).toBe(true);
});

it("手机原文保留 capture 和作者，记录 origin 映射 by，操作核对当前状态并跨重开去重", async () => {
  const ws = await freshWorkspace();
  const note = phoneFile("note.md");
  ws.writeText(
    note,
    stringifyFrontmatter(
      {
        agent: "你（iPhone）",
        kind: "capture",
        origin: "user",
        date: "2026-10-18",
        created: new Date().toISOString(),
      },
      "合成手机原文",
    ),
  );
  const records = phoneFile("records.jsonl");
  ws.writeText(
    records,
    ["user", "assistant"]
      .map((origin) => JSON.stringify({ type: "workout", agent: "iPhone", origin, ...workout }))
      .join("\n"),
  );
  const task = addRecord(ws, "task", { title: "合成待办", status: "open" }).record;
  const cancelled = addRecord(ws, "task", { title: "合成取消", status: "open" }).record;
  ws.writeText(
    "me/STATUS.md",
    stringifyFrontmatter(
      { updated: null, next: [{ id: "next-1", title: "合成下一步", status: "todo" }] },
      "正文",
    ),
  );
  ws.writeText(
    "NOW.md",
    stringifyFrontmatter(
      {
        date: "2026-10-18",
        blocks: [
          {
            id: "proposal-1",
            kind: "proposal",
            start: "10:00",
            end: "11:00",
            title: "合成日程",
            status: "pending",
          },
        ],
      },
      "",
    ),
  );
  const action = (op: string, args: object) => ({
    client_id: ulid(),
    at: new Date().toISOString(),
    device: "3fa9c1d2",
    op,
    args,
  });
  const actions = [
    action("complete_next", { file: "me/STATUS.md", id: "next-1" }),
    action("decide_proposal", { id: "proposal-1", decision: "confirmed" }),
    action("complete_task", { id: task.id }),
    action("cancel_task", { id: cancelled.id }),
    action("keep_draft", { source: "synthetic.md" }),
    action("complete_task", { id: task.id }),
  ];
  const file = phoneFile("actions.jsonl");
  ws.writeText(file, actions.map((a) => JSON.stringify(a)).join("\n"));
  const result = await processInbox(ws, { stableMs: 0 });
  expect(result.notes).toHaveLength(1);
  const saved = parseFrontmatter(ws.readText(result.notes[0] as string));
  expect(saved.data.kind).toBe("capture");
  expect(saved.data.agent).toBe("你（iPhone）");
  expect(saved.body.trim()).toBe("合成手机原文");
  await inboxNoteDone(ws, result.notes[0] as string);
  expect(
    buildPhoneWeek(await readOverviewPage(ws, new Date("2026-10-18T12:00:00Z")), new Date().toISOString())
      .notes.captured,
  ).toBe(1);
  expect(
    readRecords(ws, "workout")
      .map((r) => r.by)
      .sort(),
  ).toEqual(["agent", "user"]);
  expect(
    phoneReceipts(ws)
      .filter((r) => r.kind === "action")
      .map((r) => r.status),
  ).toEqual(["applied", "applied", "applied", "applied", "rejected", "conflict"]);
  expect(readRecords(ws, "task").find((r) => r.id === task.id)?.status).toBe("done");
  expect(readRecords(ws, "task").find((r) => r.id === cancelled.id)?.status).toBe("cancelled");
  expect(
    parseFrontmatter<{ next: { status: string }[] }>(ws.readText("me/STATUS.md")).data.next[0]?.status,
  ).toBe("done");
  // 手机确认的日程由手机写进 Apple 日历；电脑只记状态，不再推到系统日历，免得重复。
  expect(
    parseFrontmatter<{ blocks: { status: string; calendar?: string }[] }>(ws.readText("NOW.md")).data
      .blocks[0],
  ).toMatchObject({ status: "confirmed", calendar: "phone" });
  expect(calendarPushEntries(ws)).toEqual([expect.objectContaining({ phone: true })]);
  await expect(editCalendarBlock(ws, "proposal-1", "12:00", "13:00")).rejects.toThrow("iPhone");
  const before = readRecords(ws, "task");
  const receiptFile = ws.readJson<{ items: { ref: string }[] }>("phone/receipts.json");
  receiptFile.items = receiptFile.items.filter((r) => r.ref !== actions[2]?.client_id);
  ws.writeJson("phone/receipts.json", receiptFile);
  const reopened = new Workspace(ws.root);
  reopened.writeText(phoneFile("actions.jsonl"), JSON.stringify(actions[2]));
  await processInbox(reopened, { stableMs: 0 });
  expect(readRecords(reopened, "task")).toEqual(before);
  expect(phoneReceipts(reopened).find((r) => r.ref === actions[2]?.client_id)?.status).toBe("duplicate");
  const validate = schemas().builtin("phone-receipts.schema.json");
  expect(validate(reopened.readJson("phone/receipts.json")), JSON.stringify(validate.errors)).toBe(true);
  // 冲突说明这一项已在电脑上变了，电脑今天页不该一直挂着「需要核对」。
  const review = (await readOverviewPage(reopened)).sync.needsReview;
  reopened.writeJson("phone/receipts.json", {
    ...reopened.readJson<object>("phone/receipts.json"),
    items: [],
  });
  expect((await readOverviewPage(reopened)).sync.needsReview).toBe(review);
});

it("本地 GitHub 模拟往返不受备份开关影响，快照只上传，手机文件处理后删除远端", async () => {
  const ws = await freshWorkspace();
  const m = remoteMock();
  await connectWorkspaceBackup(ws, { repo: "synthetic/phone", text: false, records: false }, m.remote);
  await writePhoneSnapshots(ws);
  await syncWorkspaceBackup(ws, m.remote);
  expect(m.files()["phone/today.json"]).toBe(ws.readText("phone/today.json"));
  const file = phoneFile("note.md");
  m.deliver(file, stringifyFrontmatter({ agent: "你（iPhone）", kind: "capture" }, "合成 GitHub 原文"));
  m.deliver("phone/today.json", "远端不能改快照");
  m.deliver("inbox/health/synthetic.health.json", JSON.stringify({ format: "kaitu.health.v1", samples: [] }));
  await syncWorkspaceBackup(ws, m.remote);
  expect(ws.exists(file)).toBe(true);
  expect(ws.exists("inbox/health/synthetic.health.json")).toBe(true);
  expect(m.files()["phone/today.json"]).toBe(ws.readText("phone/today.json"));
  await processInbox(ws, { stableMs: 0 });
  await syncWorkspaceBackup(ws, m.remote);
  expect(m.files()[file]).toBeUndefined();
  expect(m.files()["inbox/health/synthetic.health.json"]).toBeUndefined();
  expect(
    JSON.parse(m.files()["phone/receipts.json"] as string).items.some(
      (r: { ref: string }) => r.ref === basename(file),
    ),
  ).toBe(true);
});

it("手机记录有一条不合格整份不写，重投不重复；冲突操作重投仍回冲突", async () => {
  const ws = await freshWorkspace();
  const file = phoneFile("records.jsonl");
  const text = [
    { type: "workout", origin: "user", exercise: "合成", sets: 3, reps: 12, weight_kg: 60, session_id: "s" },
    { type: "workout", origin: "user", sets: 3 },
  ]
    .map((row) => JSON.stringify(row))
    .join("\n");
  for (let i = 0; i < 2; i++) {
    ws.writeText(file, text);
    await processInbox(ws, { stableMs: 0 });
    expect(phoneReceipts(ws).find((r) => r.ref === basename(file))?.status).toBe("rejected");
    expect(readRecords(ws, "workout")).toHaveLength(0);
  }
  const action = JSON.stringify({
    client_id: ulid(),
    at: new Date().toISOString(),
    device: "3fa9c1d2",
    op: "complete_task",
    args: { id: ulid() },
  });
  for (let i = 0; i < 2; i++) {
    const reopened = new Workspace(ws.root);
    reopened.writeText(phoneFile("actions.jsonl"), action);
    await processInbox(reopened, { stableMs: 0 });
    expect(phoneReceipts(reopened).find((r) => r.kind === "action")?.status).toBe("conflict");
  }
});
