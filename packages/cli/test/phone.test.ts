import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { schemas } from "@kaitu/core";
import { expect, it } from "vitest";

it("phone run 预览隔离工作区和状态，正式运行得到相同操作结果，重复运行不写入", async () => {
  const temp = mkdtempSync(join(tmpdir(), "kaitu-phone-command-"));
  const env = {
    ...process.env,
    KAITU_LOCAL_STATE_DIR: join(temp, "state"),
    KAITU_APP_HOME: join(temp, "app"),
  };
  const root = join(temp, "GoogleDrive-synthetic", "kaitu");
  const run = async (...args: string[]) => {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      ["packages/cli/dist/main.js", ...args, "--dir", root, "--json-out"],
      { env },
    );
    return JSON.parse(stdout);
  };
  const files = () =>
    Object.fromEntries(
      readdirSync(temp, { recursive: true, withFileTypes: true }).map((entry) => {
        const path = join(entry.parentPath, entry.name);
        const stat = statSync(path);
        return [
          path,
          { mtime: stat.mtimeMs, body: entry.isFile() ? readFileSync(path).toString("base64") : null },
        ];
      }),
    );
  try {
    await run("init");
    const note = "ios-3fa9c1d2-01K7M8BG000000000000000001.note.md";
    const actions = "ios-3fa9c1d2-01K7M8BG000000000000000002.actions.jsonl";
    writeFileSync(join(root, "inbox/agents", note), "---\nkind: capture\nagent: iPhone\n---\n合成手机原文\n");
    writeFileSync(
      join(root, "me/STATUS.md"),
      "---\nupdated: null\nnext:\n  - id: synthetic-next\n    title: 合成下一步\n    status: todo\n---\n",
    );
    writeFileSync(
      join(root, "inbox/agents", actions),
      JSON.stringify({
        client_id: "01K7M8BG000000000000000003",
        at: new Date().toISOString(),
        device: "3fa9c1d2",
        op: "complete_next",
        args: { file: "me/STATUS.md", id: "synthetic-next" },
      }),
    );
    const before = files();
    const preview = await run("phone", "run", "--as", "Dot", "--dry-run");
    expect(files()).toEqual(before);
    expect(preview.receipts.map((r: { status: string }) => r.status)).toEqual(["applied", "applied"]);
    const todayChange = preview.changes.find((c: { path: string }) => c.path === "phone/today.json");
    expect(JSON.parse(todayChange.after).next).toEqual([]);
    const actual = await run("phone", "run", "--as", "Dot");
    expect(actual.inbox).toEqual(preview.inbox);
    expect(actual.receipts.map((r: { ref: string; status: string }) => [r.ref, r.status])).toEqual(
      preview.receipts.map((r: { ref: string; status: string }) => [r.ref, r.status]),
    );
    for (const name of ["today", "week", "map", "library", "receipts"]) {
      const value = JSON.parse(readFileSync(join(root, `phone/${name}.json`), "utf8"));
      const validate = schemas().builtin(`phone-${name}.schema.json`);
      expect(validate(value), JSON.stringify(validate.errors)).toBe(true);
      if (name !== "receipts") expect(value.generator).toEqual({ kind: "agent", name: "Dot", spec: 1 });
    }
    expect(existsSync(join(root, "inbox/agents", note))).toBe(false);
    const after = files();
    expect((await run("phone", "run", "--as", "Dot")).snapshots).toBe(0);
    expect(files()).toEqual(after);
    expect((await run("phone", "run", "--as", "Dot", "--dry-run")).changes).toEqual([]);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
