import { mkdtempSync, rmSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { history, initWorkspace, snapshot, stringifyFrontmatter } from "@kaitu/core";
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
  const ui = await startUi(ws, { port: 0, open: false, snapshotDelayMs: 80, refreshDelayMs: 10 });
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
  ws.writeText("me/profile.md", "# 外部更新\n");
  await expect.poll(async () => (await history(ws)).length, { timeout: 3000 }).toBe(before + 1);
  const response = await fetch(`${ui.url}/api/proposal`, {
    method: "POST",
    headers: { "X-Kaitu": "1", Origin: ui.url },
    body: JSON.stringify({ id: "p1", decision: "confirmed" }),
  });
  expect(response.status).toBe(200);
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect((await history(ws)).length).toBe(before + 2);
});
