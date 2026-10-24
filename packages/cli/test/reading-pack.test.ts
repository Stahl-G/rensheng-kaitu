import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addRecord, deleteRecord, handoverPack, history, initWorkspace, setFinanceAccess } from "@kaitu/core";
import { expect, it } from "vitest";

it("CLI 阅读包按本机权限现取删除后的正本，与交接包一致且不写历史", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-reading-pack-"));
  try {
    const ws = await initWorkspace(root);
    const task = addRecord(ws, "task", { title: "合成当前下一步", status: "open" }, { by: "user" });
    addRecord(ws, "finance_account", {
      name: "Synthetic wallet",
      kind: "wallet",
      source: "manual",
      currency: "CNY",
    });
    const before = await history(ws);
    const run = () =>
      JSON.parse(
        execFileSync(
          process.execPath,
          ["packages/cli/dist/main.js", "reading-pack", "--dir", root, "--locale", "en", "--json-out"],
          { encoding: "utf8" },
        ),
      );
    for (const allowed of [true, false]) {
      setFinanceAccess(ws, "local-mcp", allowed);
      expect(run()).toEqual(handoverPack(ws, "en", new Date(), allowed));
    }
    deleteRecord(ws, "task", task.record.id, { by: "user" });
    expect(run().text).not.toContain("合成当前下一步");
    expect(await history(ws)).toEqual(before);
    expect(ws.exists("USER.md")).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
