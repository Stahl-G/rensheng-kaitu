import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { history, initWorkspace, pendingWorkspaceFiles } from "@kaitu/core";
import { expect, it, vi } from "vitest";
import { startUi } from "../src/ui/server.js";

vi.mock("node:fs", async (original) => ({
  ...(await original<typeof import("node:fs")>()),
  watch: () => {
    throw Object.assign(new Error("Synthetic native watch unavailable"), { code: "EMFILE" });
  },
}));

it("原生监听不可用时，启动前改动与后续外部编辑、删除仍在后台保存，敏感状态不入历史", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-ui-polling-"));
  let ui: Awaited<ReturnType<typeof startUi>> | undefined;
  try {
    const ws = await initWorkspace(root);
    const before = (await history(ws)).length;
    writeFileSync(join(root, "me/synthetic.md"), "before\n");
    ui = await startUi(ws, {
      port: 0,
      open: false,
      snapshotDelayMs: 80,
      refreshDelayMs: 10,
      inboxStableMs: 30,
    });
    expect((await fetch(ui.url)).status).toBe(200);
    await expect.poll(async () => (await history(ws)).length).toBe(before + 1);
    const old = new Date(Date.now() - 10000);
    writeFileSync(join(root, "me/synthetic.md"), "after!\n");
    utimesSync(join(root, "me/synthetic.md"), old, old);
    await expect.poll(async () => (await history(ws)).length).toBe(before + 2);
    rmSync(join(root, "me/synthetic.md"));
    ws.writeJson(".kaitu/secrets.json", { synthetic: "never-version-this" }, { internal: true });
    await expect.poll(async () => (await history(ws)).length).toBe(before + 3);
    expect(await pendingWorkspaceFiles(ws)).toEqual([]);
  } finally {
    await ui?.close();
    rmSync(root, { recursive: true, force: true });
  }
});
