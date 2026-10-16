import { readdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { expect, it } from "vitest";
import { confirmOnboardingImport, previewOnboardingImport, readRecords } from "../src/index.js";
import { freshWorkspace } from "./helpers.js";

it("文件预览绑定原字节，同记录数替换不能确认，合法令牌仅能确认一次", async () => {
  const ws = await freshWorkspace();
  try {
    const ics = (title: string) =>
      Buffer.from(
        `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:synthetic-token\r\nDTSTART:20261016T090000Z\r\nDTEND:20261016T100000Z\r\nSUMMARY:${title}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`,
      );
    const preview = await previewOnboardingImport(ws, "ics", "synthetic.ics", ics("previewed"));
    const upload = readdirSync(ws.resolve(".kaitu/cache/uploads", { internal: true })).find((file) =>
      file.endsWith(".ics"),
    );
    ws.writeText(`.kaitu/cache/uploads/${upload}`, ics("replaced"), { internal: true });
    await expect(confirmOnboardingImport(ws, preview.token)).rejects.toThrow();
    expect(readRecords(ws, "event")).toHaveLength(0);
    const next = await previewOnboardingImport(ws, "ics", "synthetic.ics", ics("approved"));
    await confirmOnboardingImport(ws, next.token);
    expect(readRecords(ws, "event").map((row) => row.title)).toEqual(["approved"]);
    await expect(confirmOnboardingImport(ws, next.token)).rejects.toThrow();
  } finally {
    rmSync(dirname(ws.root), { recursive: true, force: true });
  }
});
