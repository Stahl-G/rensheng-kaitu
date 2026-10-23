import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initWorkspace } from "@kaitu/core";
import { expect, it, vi } from "vitest";
import type { AskService } from "../src/ui/ask.js";
import { productRequest } from "../src/ui/product.js";

it.each(["pending", "rejected"])("基础设置不等待 %s 的 AI 状态", async (mode) => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-settings-"));
  try {
    const ws = await initWorkspace(root);
    const settings = vi.fn(() =>
      mode === "pending"
        ? new Promise<never>(() => {})
        : Promise.reject(new Error("synthetic AI unavailable")),
    );
    const data = await productRequest(ws, "settings", [true], { settings } as unknown as AskService);
    expect(data).toHaveProperty("storage");
    expect(data).toHaveProperty("ai", null);
    expect(settings).not.toHaveBeenCalled();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("完整设置保留 AI 配置成功与失败的原始结果", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-settings-"));
  try {
    const ws = await initWorkspace(root);
    const ai = { configured: true, model: "synthetic" };
    const settings = vi
      .fn()
      .mockResolvedValueOnce(ai)
      .mockRejectedValueOnce(new Error("synthetic AI unavailable"));
    const ask = { settings } as unknown as AskService;
    expect(await productRequest(ws, "settings", [], ask)).toHaveProperty("ai", ai);
    await expect(productRequest(ws, "settings", [], ask)).rejects.toThrow("synthetic AI unavailable");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
