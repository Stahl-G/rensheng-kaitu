import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { history, initWorkspace, parseFrontmatter, snapshot, stringifyFrontmatter } from "@kaitu/core";
import { afterEach, expect, it } from "vitest";
import { startUi } from "../src/ui/server.js";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
async function setup() {
  const root = mkdtempSync(join(tmpdir(), "kaitu-ui-"));
  cleanup.push(async () => rmSync(root, { recursive: true, force: true }));
  const ws = await initWorkspace(root);
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
  await expect.poll(async () => (await history(ws)).length, { timeout: 3000 }).toBe(before + 1);
  expect(ws.readText("OVERVIEW.md")).not.toBe(overview);
  const response = await fetch(`${ui.url}/api/proposal`, {
    method: "POST",
    headers: { "X-Kaitu": "1", Origin: ui.url },
    body: JSON.stringify({ id: "p1", decision: "confirmed" }),
  });
  expect(response.status).toBe(200);
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect((await history(ws)).length).toBe(before + 2);
  ws.writeJson("inbox/agents/auto.proposal.json", {
    title: "散步",
    start: "20:00",
    end: "20:30",
    agent: "auto-source",
  });
  await expect.poll(async () => (await history(ws)).length, { timeout: 3000 }).toBe(before + 3);
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
