import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  history,
  localDate,
  parseFrontmatter,
  readRecords,
  snapshot,
  stringifyFrontmatter,
} from "@kaitu/core";
import { afterEach, expect, it } from "vitest";
import { appleHealthZip, clonedWorkspace } from "../../core/test/helpers.js";
import { startUi } from "../src/ui/server.js";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
async function setup() {
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
  const ui = await startUi(ws, {
    port: 0,
    open: false,
    snapshotDelayMs: 80,
    refreshDelayMs: 10,
    inboxStableMs: 30,
  });
  cleanup.push(ui.close);
  return { ws, ui };
}
it("拒绝错误 Host、缺少 X-Kaitu 或非本机 Origin 的写操作", async () => {
  const { ws, ui } = await setup();
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
  const { ws, ui } = await setup();
  const post = (path: string, body: unknown) =>
    fetch(`${ui.url}${path}`, {
      method: "POST",
      headers: { "X-Kaitu": "1", Origin: ui.url },
      body: JSON.stringify(body),
    });
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
    const enabled = await post(enable, { ...body, dir: folder });
    expect(enabled.status).toBe(200);
    expect((await enabled.json()).mode).toBe("drive");
    const disabled = await post(disable, { to: join(back, "kaitu") });
    expect(disabled.status).toBe(200);
    expect((await disabled.json()).mode).toBe("local");
    expect(ws.root).toBe(join(back, "kaitu"));
  }
});
