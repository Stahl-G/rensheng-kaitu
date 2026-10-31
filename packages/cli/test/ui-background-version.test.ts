import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHomeCache, initWorkspace, isTracked, snapshotNow } from "@kaitu/core";
import { expect, it, vi } from "vitest";
import { startUi } from "../src/ui/server.js";

vi.mock("@kaitu/core", async (original) => {
  const core = await original<typeof import("@kaitu/core")>();
  return { ...core, snapshotNow: vi.fn(core.snapshotNow) };
});

it("saving a version does not delay a new capture, and closing flushes both originals", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-background-version-"));
  const ws = await initWorkspace(root);
  const original = await vi.importActual<typeof import("@kaitu/core")>("@kaitu/core");
  let entered!: () => void;
  let resume!: () => void;
  const saving = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    resume = resolve;
  });
  vi.mocked(snapshotNow).mockImplementationOnce(async (...args) => {
    entered();
    await waiting;
    return original.snapshotNow(...args);
  });
  const ui = await startUi(ws, { port: 0, open: false, versionDelayMs: 20 });
  let closing: Promise<void> | undefined;
  const capture = async (text: string) => {
    const response = await fetch(`${ui.url}/api/product/capture`, {
      method: "POST",
      headers: { "X-Kaitu": "1", Origin: ui.url },
      body: JSON.stringify([text]),
    });
    expect(response.status).toBe(200);
    return (await response.json()) as { path: string };
  };
  try {
    await expect
      .poll(
        async () => {
          const response = await fetch(`${ui.url}/api/product/home`, {
            method: "POST",
            headers: { "X-Kaitu": "1", Origin: ui.url },
            body: "[]",
          });
          return ((await response.json()) as { loading: boolean }).loading;
        },
        { timeout: 15000 },
      )
      .toBe(false);
    const first = await capture("Synthetic original A");
    await saving;
    let saved = false;
    const capturing = capture("Synthetic original B").then((result) => {
      saved = true;
      return result;
    });
    await expect.poll(() => saved).toBe(true);
    const second = await capturing;
    expect(ws.readText(second.path)).toContain("Synthetic original B");
    let closed = false;
    closing = ui.close().then(() => {
      closed = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(closed).toBe(false);
    resume();
    await closing;
    for (const file of [first.path, second.path]) expect(await isTracked(ws, file)).toBe(true);
    const reopened = createHomeCache(ws, () => {});
    try {
      expect(reopened.read()).toMatchObject({ loading: false, error: null });
    } finally {
      await reopened.close();
    }
  } finally {
    resume();
    await (closing ?? ui.close());
    vi.mocked(snapshotNow).mockReset();
    rmSync(root, { recursive: true, force: true });
  }
});
