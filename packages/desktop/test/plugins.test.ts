import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
// @ts-expect-error Desktop adapters are native ESM.
import { createPluginService } from "../plugins.mjs";

test("catalog transport failure keeps its cause and reports a network error without installing", async () => {
  const home = mkdtempSync(join(tmpdir(), "kaitu-plugin-network-"));
  const cause = Object.assign(new TypeError("fetch failed"), { code: "ECONNRESET" });
  const fetchIndex = vi.fn().mockRejectedValue(cause);
  const beforeChange = vi.fn();
  const onChanged = vi.fn();
  try {
    const service = createPluginService({
      archive: home,
      runtime: home,
      home,
      beforeChange,
      onChanged,
      fetchIndex,
    });
    await expect(service.list()).rejects.toMatchObject({
      code: "PLUGIN_NETWORK",
      message: "无法连接插件目录，请检查网络后重试",
      cause,
    });
    expect(fetchIndex).toHaveBeenCalledExactlyOnceWith(
      "https://kaitu.si/plugins/index.json",
      expect.objectContaining({ credentials: "omit", signal: expect.any(AbortSignal) }),
    );
    expect(beforeChange).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
