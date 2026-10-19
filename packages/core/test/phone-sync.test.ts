import { rmSync } from "node:fs";
import { basename, join } from "node:path";
import { expect, it } from "vitest";
import { assertAgentWrite } from "../src/agent-file-policy.js";
import { parseFrontmatter, stringifyFrontmatter } from "../src/frontmatter.js";
import {
  Workspace,
  addMemory,
  addRecord,
  buildPhoneLibrary,
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

it("手机记录同名重投跨重开及回执清理仍只入账一次，新文件仍能记相同内容", async () => {
  const ws = await freshWorkspace();
  const file = phoneFile("records.jsonl");
  const text = JSON.stringify({ type: "task", title: "合成重复投递", status: "open", origin: "user" });
  ws.writeText(file, text);
  await processInbox(ws, { stableMs: 0 });
  const first = readRecords(ws, "task");
  expect(first).toHaveLength(1);
  ws.writeJson("phone/receipts.json", {
    format: "kaitu.phone.receipts",
    version: 1,
    generated_at: new Date().toISOString(),
    items: [],
  });
  const reopened = new Workspace(ws.root);
  reopened.writeText(file, text);
  await processInbox(reopened, { stableMs: 0 });
  expect(readRecords(reopened, "task")).toEqual(first);
  expect(phoneReceipts(reopened)).toContainEqual(
    expect.objectContaining({ ref: basename(file), status: "duplicate" }),
  );
  reopened.writeText(phoneFile("records.jsonl"), text);
  await processInbox(reopened, { stableMs: 0 });
  expect(readRecords(reopened, "task")).toHaveLength(2);
});

it("手机记录撤回及替换后，旧文件去重、陈旧替换拒绝，当前来源可继续替换", async () => {
  for (const withdrawOnly of [true, false]) {
    const ws = await freshWorkspace();
    const row = (title: string) => ({ type: "task", agent: "iPhone", title, status: "open" });
    const original = phoneFile("records.jsonl");
    const text = JSON.stringify(row("合成原任务"));
    ws.writeText(original, text);
    await processInbox(ws, { stableMs: 0 });
    expect(readRecords(ws, "task")).toHaveLength(1);
    const replacement = phoneFile("records.jsonl");
    const replace =
      JSON.stringify({ replaces: basename(original), agent: "iPhone" }) +
      (withdrawOnly ? "" : `\n${JSON.stringify(row("合成替换内容"))}`);
    ws.writeText(replacement, replace);
    await processInbox(ws, { stableMs: 0 });
    const current = readRecords(ws, "task");
    expect(current).toHaveLength(withdrawOnly ? 0 : 1);
    const reopened = new Workspace(ws.root);
    reopened.writeText(original, text);
    await processInbox(reopened, { stableMs: 0 });
    expect(readRecords(reopened, "task")).toEqual(current);
    expect(phoneReceipts(reopened)).toContainEqual(
      expect.objectContaining({ ref: basename(original), status: "duplicate" }),
    );
    const stale = phoneFile("records.jsonl");
    reopened.writeText(
      stale,
      `${JSON.stringify({ replaces: basename(original), agent: "iPhone" })}\n${JSON.stringify(row("陈旧分支内容"))}`,
    );
    await processInbox(reopened, { stableMs: 0 });
    expect(readRecords(reopened, "task")).toEqual(current);
    expect(phoneReceipts(reopened)).toContainEqual(
      expect.objectContaining({ ref: basename(stale), status: "rejected" }),
    );
    const successor = phoneFile("records.jsonl");
    reopened.writeText(
      successor,
      `${JSON.stringify({ replaces: basename(replacement), agent: "iPhone" })}\n${JSON.stringify(row("合成后继内容"))}`,
    );
    await processInbox(reopened, { stableMs: 0 });
    const next = readRecords(reopened, "task");
    expect(next).toHaveLength(1);
    expect(next[0]?.title).toBe("合成后继内容");
    expect(phoneReceipts(reopened)).toContainEqual(
      expect.objectContaining({ ref: basename(successor), status: "applied" }),
    );
    reopened.writeText(replacement, replace);
    await processInbox(reopened, { stableMs: 0 });
    expect(readRecords(reopened, "task")).toEqual(next);
    expect(phoneReceipts(reopened)).toContainEqual(
      expect.objectContaining({ ref: basename(replacement), status: "duplicate" }),
    );
  }
});

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
  addRecord(ws, "finance_transaction", {
    ts: now.toISOString(),
    account: "synthetic-card",
    amount: "-32.00",
    currency: "CNY",
    category: "expense",
    counterparty: null,
    description: "PRIVATE_FINANCE_DESCRIPTION",
    source: "manual",
    source_transaction_id: null,
    related_ids: [],
    reconciliation: "ok",
  });
  await addMemory(ws, {
    type: "fact",
    name: "合成敏感记忆",
    text: "PRIVATE_MEMORY_BODY",
    sensitive: true,
  });
  await addMemory(ws, { type: "preference", name: "合成偏好", text: "合成正文", sensitive: false });
  ws.writeText(
    "inbox/notes/2026-10-18/synthetic.md",
    "---\nkind: capture\n---\n\n合成原文第一行\nPRIVATE_NOTE_SECOND_LINE\n",
  );
  // 写坏的 frontmatter 只影响这一条，不让整份快照停更。
  ws.writeText("inbox/notes/2026-10-17/broken.md", "---\nkind: [capture\n---\n\n写坏的 frontmatter\n");
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
    today: buildPhoneToday(data, now.toISOString(), ws),
    week: buildPhoneWeek(data, now.toISOString()),
    map: buildPhoneMap(data, map, readExploration(ws), now.toISOString()),
    library: buildPhoneLibrary(ws, data, now.toISOString()),
  };
  for (const [name, value] of Object.entries(snapshots)) {
    const validate = schemas().builtin(`phone-${name}.schema.json`);
    expect(validate(value), JSON.stringify(validate.errors)).toBe(true);
  }
  expect(snapshots.map.routes.planned).toHaveLength(2);
  expect(snapshots.week.projects[0]?.kind).toBe("work");
  expect(snapshots.week.health.workouts).toBe(1);
  expect(snapshots.map.rows[0]?.ahead).toBe("planned");
  expect(snapshots.today.generator).toEqual({ kind: "computer" });
  const items = snapshots.library.items;
  expect(items.find((i) => i.kind === "note")).toMatchObject({ title: "合成原文第一行", date: "2026-10-18" });
  expect(items.find((i) => i.kind === "health")?.path).toBe("health/data/workouts/2026-10.jsonl");
  expect(items.find((i) => i.kind === "project")?.path).toBe("projects/synthetic/STATUS.md");
  expect(items.some((i) => i.title === "合成偏好")).toBe(true);
  // 手机是用户自己的设备：财务和标为敏感的记忆也列出，正文仍要点开才读。
  expect(items.find((i) => i.title === "合成敏感记忆")?.subtitle).toBe("标为敏感");
  expect(items.find((i) => i.kind === "finance")?.path).toBe("finance/data/transaction/2026-10.jsonl");
  expect(items.some((i) => i.title === "写坏的 frontmatter")).toBe(true);
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
  ws.writeText(file, text);
  await processInbox(ws, { stableMs: 0 });
  expect(phoneReceipts(ws).find((r) => r.ref === basename(file))?.status).toBe("rejected");
  expect(readRecords(ws, "workout")).toHaveLength(0);
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

it("云端整理员写的回执并进本机，手机重投不再执行；待整理原文随 GitHub 双向同步", async () => {
  const ws = await freshWorkspace();
  const m = remoteMock();
  await connectWorkspaceBackup(ws, { repo: "synthetic/phone", text: false, records: false }, m.remote);
  await writePhoneSnapshots(ws);
  await syncWorkspaceBackup(ws, m.remote);
  const clientId = ulid();
  const remote = JSON.parse(m.files()["phone/receipts.json"] as string);
  remote.items.push({ ref: clientId, kind: "action", status: "applied", at: new Date().toISOString() });
  m.deliver("phone/receipts.json", JSON.stringify(remote));
  const agentNote = `inbox/notes/2026-10-18/ios-3fa9c1d2-${ulid()}.note.md`;
  m.deliver(agentNote, stringifyFrontmatter({ agent: "你（iPhone）", kind: "capture" }, "整理员移来的原文"));
  ws.writeText("inbox/notes/2026-10-18/local.md", "电脑上的待整理原文");
  await syncWorkspaceBackup(ws, m.remote);
  expect(phoneReceipts(ws).some((r) => r.ref === clientId)).toBe(true);
  expect(m.files()["phone/receipts.json"]).toBe(ws.readText("phone/receipts.json"));
  expect(ws.exists(agentNote)).toBe(true);
  expect(m.files()["inbox/notes/2026-10-18/local.md"]).toBe("电脑上的待整理原文");

  // 待办不存在：没有回执去重时会回 conflict。
  const action = {
    client_id: clientId,
    at: new Date().toISOString(),
    device: "3fa9c1d2",
    op: "complete_task",
  };
  ws.writeText(phoneFile("actions.jsonl"), JSON.stringify({ ...action, args: { id: ulid() } }));
  await processInbox(ws, { stableMs: 0 });
  expect(phoneReceipts(ws).find((r) => r.ref === clientId)?.status).toBe("duplicate");
});

it("同目录 Agent 快照覆盖前保存来源与离线回执，已读记录在重开后保留", async () => {
  const { markOrganizerSeen, organizerStatus, writePhoneReceipts } = await import("../src/index.js");
  const ws = await freshWorkspace();
  const now = new Date();
  await writePhoneSnapshots(ws, now, { force: true });
  const today = ws.readJson<Record<string, unknown>>("phone/today.json");
  const generatedAt = new Date(now.getTime() + 2000).toISOString();
  ws.writeJson("phone/today.json", {
    ...today,
    generated_at: generatedAt,
    generator: { kind: "agent", name: "Dot", spec: 1 },
  });
  const at = new Date(now.getTime() + 1000).toISOString();
  writePhoneReceipts(
    ws,
    [
      { ref: "computer-action", kind: "action", status: "applied", at },
      { ref: "remote-action", kind: "action", status: "applied", at },
      { ref: "remote-review", kind: "action", status: "conflict", at },
    ],
    now,
  );
  ws.writeJson(".kaitu/phone-actions.json", { "computer-action": { status: "applied" } }, { internal: true });
  await writePhoneSnapshots(ws, new Date(now.getTime() + 3000), { force: true });
  expect(ws.readJson<{ generator: unknown }>("phone/today.json").generator).toEqual({ kind: "computer" });
  expect(organizerStatus(ws)).toMatchObject({
    agent: { name: "Dot", generatedAt },
    unread: true,
    away: { actions: 2, needsReview: 1 },
  });
  markOrganizerSeen(ws);
  const reopened = new Workspace(ws.root);
  expect(organizerStatus(reopened)).toMatchObject({
    agent: { name: "Dot" },
    unread: false,
    away: { actions: 2 },
  });
  expect(await writePhoneSnapshots(reopened, new Date(now.getTime() + 4000), { force: true })).toBe(0);
  expect(organizerStatus(reopened).unread).toBe(false);
  await snapshot(ws, "合成整理员状态");
  const versions = await import("../src/history.js");
  expect(await versions.isTracked(ws, ".kaitu/organizer.json")).toBe(false);
});

it("GitHub 在回写电脑快照之前记住远端整理员和新回执，重复同步不重复计数", async () => {
  const { markOrganizerSeen, organizerStatus } = await import("../src/index.js");
  const ws = await freshWorkspace();
  const m = remoteMock();
  await connectWorkspaceBackup(ws, { repo: "synthetic/organizer", text: true, records: false }, m.remote);
  await writePhoneSnapshots(ws);
  await syncWorkspaceBackup(ws, m.remote);
  const today = JSON.parse(m.files()["phone/today.json"] as string);
  m.deliver(
    "phone/today.json",
    JSON.stringify({ ...today, generator: { kind: "agent", name: "Dot", spec: 1 } }),
  );
  const receipts = JSON.parse(m.files()["phone/receipts.json"] as string);
  receipts.items.push({ ref: ulid(), kind: "action", status: "rejected", at: new Date().toISOString() });
  m.deliver("phone/receipts.json", JSON.stringify(receipts));
  await syncWorkspaceBackup(ws, m.remote);
  expect(JSON.parse(m.files()["phone/today.json"] as string).generator).toEqual({ kind: "computer" });
  expect(organizerStatus(ws)).toMatchObject({
    agent: { name: "Dot" },
    unread: true,
    away: { actions: 1, needsReview: 1 },
  });
  markOrganizerSeen(ws);
  await syncWorkspaceBackup(ws, m.remote);
  expect(organizerStatus(ws)).toMatchObject({ unread: false, away: { actions: 1, needsReview: 1 } });
});
