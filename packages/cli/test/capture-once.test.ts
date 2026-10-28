import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inboxNotes, initWorkspace } from "@kaitu/core";
import { expect, it } from "vitest";
import { startUi } from "../src/ui/server.js";

it("a repeated capture operation returns the same saved path through the local API", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-capture-api-"));
  const ws = await initWorkspace(root);
  const ui = await startUi(ws, { port: 0, open: false });
  try {
    const post = async (method: string, args: unknown[]) => {
      const response = await fetch(`${ui.url}/api/product/${method}`, {
        method: "POST",
        headers: { "X-Kaitu": "1", Origin: ui.url },
        body: JSON.stringify(args),
      });
      expect(response.status).toBe(200);
      return response.json();
    };
    const operation = randomUUID();
    const first = await post("captureOnce", ["合成内容", operation]);
    const receipt = await post("captureReceipt", [operation]);
    const again = await post("captureOnce", ["合成内容", operation]);
    expect(first.status).toBe("saved");
    expect(receipt).toEqual({ status: "saved", path: first.path });
    expect(again).toMatchObject({ status: "saved", path: first.path });
    expect(inboxNotes(ws).filter((note) => note.kind === "capture")).toHaveLength(1);
  } finally {
    await ui.close();
    rmSync(root, { recursive: true, force: true });
  }
});
