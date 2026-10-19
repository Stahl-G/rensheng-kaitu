import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { inboxNotes, initWorkspace } from "@kaitu/core";
import { expect, test, vi } from "vitest";
import { importFeishuFolder } from "../src/feishu.js";

test("飞书文件夹的云文档存成原文，没改过的不重复，改过的再存一条", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kaitu-feishu-"));
  try {
    const ws = await initWorkspace(join(dir, "workspace"));
    const modified = join(dir, "modified");
    writeFileSync(modified, "1");
    const windows = process.platform === "win32";
    const cli = join(dir, windows ? "lark-cli.cmd" : "lark-cli");
    writeFileSync(
      windows ? join(dir, "lark.cjs") : cli,
      `#!/usr/bin/env node
const { readFileSync } = require("node:fs");
const args = process.argv.slice(2);
const data = args[0] === "drive"
  ? { has_more: false, files: [
      { token: "doc1", name: "合成周报", type: "docx", url: "https://example.feishu.cn/docx/doc1", modified_time: readFileSync(${JSON.stringify(modified)}, "utf8") },
      { token: "sheet1", name: "表格", type: "sheet", url: "https://example.feishu.cn/sheets/sheet1", modified_time: "1" },
    ] }
  : { document: { content: "# 合成周报\\n第 " + readFileSync(${JSON.stringify(modified)}, "utf8") + " 版正文" } };
process.stdout.write(JSON.stringify({ ok: true, data }));
`,
    );
    if (!windows) chmodSync(cli, 0o755);
    if (windows) {
      writeFileSync(join(dir, "lark-cli"), 'exec node "$basedir/lark.cjs" "$@"');
      writeFileSync(cli, '@node "%~dp0lark.cjs" %*\r\n');
    }
    vi.stubEnv("PATH", [dir, process.env.PATH ?? ""].join(delimiter));
    const first = await importFeishuFolder(ws, "folder1");
    expect(first).toMatchObject({ documents: 1, unchanged: 0 });
    expect(inboxNotes(ws)[0]?.content).toContain(
      "# 合成周报\n\nhttps://example.feishu.cn/docx/doc1\n\n第 1 版正文",
    );
    expect((await importFeishuFolder(ws, "folder1", cli)).imported).toEqual([]);
    writeFileSync(modified, "2");
    expect((await importFeishuFolder(ws, "folder1", cli)).imported).toHaveLength(1);
    expect(inboxNotes(ws).map((note) => note.content.includes("第 2 版正文"))).toContain(true);
  } finally {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  }
});
