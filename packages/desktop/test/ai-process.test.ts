import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createAiProcess } from "../ai-process.mjs";

// Kaitu.app 只在 macOS 打包。
it.skipIf(process.platform === "win32")(
  "并发打开复用同一 AI 子进程，主窗口退出要求子进程保存后结束且不能重新启动",
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "kaitu-ai-process-"));
    const worker = join(directory, "worker.mjs");
    const receipt = join(directory, "stopped.txt");
    writeFileSync(
      worker,
      `#!${process.execPath}
import { writeFileSync } from 'node:fs';
process.on('message', message => {
  if (message.type === 'kaitu:quit') {
    writeFileSync(process.env.KAITU_TEST_RECEIPT, 'saved');
    process.exit(0);
  }
});
process.send({ type: "kaitu:web", url: "http://127.0.0.1:12345/?token=synthetic-process-access" });
setInterval(() => {}, 1000);
`,
      { mode: 0o700 },
    );
    const ai = createAiProcess(worker, { ...process.env, KAITU_TEST_RECEIPT: receipt });
    try {
      const opened = await Promise.all([ai.open(), ai.open(), ai.open({ background: true })]);
      const pid = opened[0].pid;
      expect(opened.every((result) => result.pid === pid)).toBe(true);
      expect(pid).toBeGreaterThan(0);
      expect(await ai.open({ background: true, waitForUrl: true })).toEqual({
        pid,
        url: "http://127.0.0.1:12345/?token=synthetic-process-access",
      });
      expect(process.kill(pid, 0)).toBe(true);
      await ai.close();
      expect(readFileSync(receipt, "utf8")).toBe("saved");
      expect(() => process.kill(pid, 0)).toThrow();
      await expect(ai.open()).rejects.toThrow();
    } finally {
      await ai.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
