import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { createSpeech } from "../speech.mjs";

test.skipIf(process.platform !== "darwin")(
  "speech session transfers a synthetic result, and cancellation cannot leave it running",
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "kaitu-speech-test-"));
    const helper = join(dir, "fixture");
    writeFileSync(
      helper,
      `#!/bin/sh\nprintf '%s\\n' '{"state":"recording","text":""}'\nread command\nif [ "$command" = stop ]; then printf '%s\\n' '{"state":"done","text":"合成文字"}'; fi\n`,
    );
    chmodSync(helper, 0o755);
    const speech = createSpeech(helper);
    try {
      expect((await speech.request("status")).available).toBe(true);
      expect((await speech.request("start")).state).toBe("starting");
      await vi.waitFor(async () => expect((await speech.request("status")).state).toBe("recording"));
      await speech.request("stop");
      await vi.waitFor(async () =>
        expect(await speech.request("status")).toMatchObject({ state: "done", text: "合成文字" }),
      );
      await speech.request("start");
      expect((await speech.request("cancel")).state).toBe("cancelled");
    } finally {
      speech.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test.skipIf(process.platform !== "darwin")(
  "permission denial and timeout remain visible without opening a microphone",
  async () => {
    for (const result of ["denied", "unavailable", "timeout"]) {
      const dir = mkdtempSync(join(tmpdir(), "kaitu-speech-state-"));
      const helper = join(dir, "fixture");
      writeFileSync(helper, `#!/bin/sh\nprintf '%s\\n' '{"state":"${result}","text":""}'\n`);
      chmodSync(helper, 0o755);
      const speech = createSpeech(helper);
      try {
        await speech.request("start");
        await vi.waitFor(async () => expect((await speech.request("status")).state).toBe(result));
      } finally {
        speech.close();
        rmSync(dir, { recursive: true, force: true });
      }
    }
  },
);
