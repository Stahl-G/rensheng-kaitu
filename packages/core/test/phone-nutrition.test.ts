import { basename } from "node:path";
import { expect, it } from "vitest";
import { processInbox } from "../src/inbox.js";
import { readOverviewPage } from "../src/overview-page.js";
import { buildPhoneToday } from "../src/phone-projections.js";
import { phoneRecordLedger } from "../src/phone-records.js";
import { writePhoneSnapshots } from "../src/phone-snapshots.js";
import { deleteRecord, readRecordRevisions, readRecords, updateRecord } from "../src/records.js";
import { schemas } from "../src/schema.js";
import { ulid } from "../src/ulid.js";
import { Workspace } from "../src/workspace.js";
import { freshWorkspace } from "./helpers.js";

const file = () => `inbox/agents/ios-3fa9c1d2-${ulid()}.records.jsonl`;
const meal = {
  type: "meal",
  origin: "user",
  agent: "iPhone",
  ts: "2026-10-18T23:40:00-07:00",
  meal: "午",
  items: [{ name: "合成饭" }],
  kcal: 720,
  protein_g: 38,
  source: "manual",
};

it("确认餐按快照日期和时区汇总最新修订，删除和改日期保留覆盖，缺/未知能力可降级", async () => {
  const ws = await freshWorkspace("America/Los_Angeles");
  const first = file();
  ws.writeText(first, JSON.stringify(meal));
  await processInbox(ws, { stableMs: 0 });
  const now = new Date("2026-10-19T06:50:00Z");
  await writePhoneSnapshots(ws, now, { force: true });
  let today = ws.readJson<{ nutrition: object; generated_at: string }>("phone/today.json");
  expect(today.nutrition).toEqual({
    version: 1,
    kcal: 720,
    protein_g: 38,
    accounted_refs: [basename(first)],
  });
  const overview = await readOverviewPage(ws, now);
  expect(
    buildPhoneToday({ ...overview, today: "2026-10-19", timeZone: "Asia/Shanghai" }, now.toISOString(), ws)
      .nutrition,
  ).toMatchObject({ kcal: 720, protein_g: 38 });
  const id = String(readRecords(ws, "meal")[0]?.id);
  updateRecord(ws, "meal", id, { kcal: 500, protein_g: 30 });
  await writePhoneSnapshots(ws, now, { force: true });
  const revised = ws.readJson<typeof today>("phone/today.json");
  expect(Date.parse(revised.generated_at)).toBeGreaterThan(Date.parse(today.generated_at));
  expect(revised.nutrition).toMatchObject({ kcal: 500, protein_g: 30 });
  updateRecord(ws, "meal", id, { ts: "2026-10-19T00:10:00-07:00" });
  await writePhoneSnapshots(ws, now, { force: true });
  today = ws.readJson<typeof today>("phone/today.json");
  expect(today.nutrition).toMatchObject({ kcal: 0, accounted_refs: [basename(first)] });
  deleteRecord(ws, "meal", id);
  const afterDelete = buildPhoneToday(await readOverviewPage(ws, now), now.toISOString(), ws);
  expect(afterDelete.nutrition).toMatchObject({ kcal: 0, accounted_refs: [basename(first)] });
  const validate = schemas().builtin("phone-today.schema.json");
  const { nutrition: _, ...without } = afterDelete;
  expect(validate(without)).toBe(true);
  expect(validate({ ...without, nutrition: { version: 2 } })).toBe(true);
  expect(
    validate({ ...without, nutrition: { version: 1, kcal: -1, protein_g: 0, accounted_refs: [] } }),
  ).toBe(false);
  expect(validate({ ...without, nutrition: { version: 1 } })).toBe(true);
  expect(validate({ ...without, nutrition: {} })).toBe(true);
});

it("records/ledger 各中断点重开复用准备 ID，恢复前不发布营养能力", async () => {
  for (const stage of ["before-records", "after-records", "before-consumed"]) {
    const ws = await freshWorkspace();
    const ref = file();
    ws.writeText(ref, JSON.stringify(meal));
    const write = ws.writeJson.bind(ws);
    const append = ws.appendLine.bind(ws);
    let interrupted = false;
    ws.appendLine = (path, line) => {
      if (!interrupted && path.startsWith("health/data/meals/") && stage !== "before-consumed") {
        interrupted = true;
        if (stage === "after-records") append(path, line);
        throw new Error("synthetic interruption");
      }
      return append(path, line);
    };
    ws.writeJson = (path, value, options) => {
      if (
        !interrupted &&
        path === ".kaitu/phone-records.json" &&
        stage === "before-consumed" &&
        Object.values(value as object).some((plan) => plan.consumed)
      ) {
        interrupted = true;
        throw new Error("synthetic interruption");
      }
      return write(path, value, options);
    };
    await expect(processInbox(ws, { stableMs: 0 })).rejects.toThrow("synthetic interruption");
    expect(interrupted).toBe(true);
    const pending = phoneRecordLedger(ws)[basename(ref)];
    if (!pending) throw new Error("missing prepared record");
    expect(pending.consumed).toBeUndefined();
    expect(
      buildPhoneToday(await readOverviewPage(ws), new Date().toISOString(), ws).nutrition,
    ).toBeUndefined();
    const reopened = new Workspace(ws.root);
    await processInbox(reopened, { stableMs: 0 });
    expect(phoneRecordLedger(reopened)[basename(ref)]?.consumed).toBe(true);
    expect(readRecordRevisions(reopened, "meal")).toHaveLength(1);
    expect(readRecords(reopened, "meal")[0]?.id).toBe(pending.entries[0]?.record.id);
    expect(reopened.exists(ref)).toBe(false);
  }
});
