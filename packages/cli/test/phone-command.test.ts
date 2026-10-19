import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { history, initWorkspace, stringifyFrontmatter, writePhoneSnapshots } from "@kaitu/core";
import { expect, it } from "vitest";

function contents(root: string): Record<string, Buffer | null> {
  const result: Record<string, Buffer | null> = {};
  function walk(dir: string) {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const file = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        result[`${file}/`] = null;
        walk(file);
      } else result[file] = readFileSync(join(root, file));
    }
  }
  if (existsSync(root)) walk("");
  return result;
}

it("phone run 的旧 dry-run 拒绝且不写入，正常处理与受支持的 upgrade 预览保留", async () => {
  const temp = mkdtempSync(join(tmpdir(), "kaitu-phone-command-"));
  const root = join(temp, "workspace");
  const cli = (...args: string[]) =>
    spawnSync(process.execPath, ["packages/cli/dist/main.js", ...args, "--json-out"], {
      encoding: "utf8",
    });
  try {
    const ws = await initWorkspace(root);
    await writePhoneSnapshots(ws);
    const inbox = "inbox/agents/ios-1234abcd-01ARZ3NDEKTSV4RRFFQ69G5FAV.note.md";
    const body = "合成原文，拒绝旧选项时必须留在收件箱。\n";
    ws.writeText(inbox, stringifyFrontmatter({ agent: "synthetic", kind: "capture" }, body));
    const old = new Date(Date.now() - 10000);
    utimesSync(join(root, inbox), old, old);
    ws.writeText(".gitignore", "synthetic-user-rule\n");
    const before = contents(root);
    const home = process.env.HOME as string;
    const state = contents(home);
    const head = (await history(ws))[0]?.oid;
    const rejected = cli("phone", "run", "--dry-run", "--dir", root);
    expect(rejected.status).toBe(2);
    expect(contents(root)).toEqual(before);
    expect(contents(home)).toEqual(state);
    expect((await history(ws))[0]?.oid).toBe(head);
    const missing = join(temp, "missing");
    expect(cli("phone", "run", "--dry-run", "--dir", missing).status).toBe(2);
    expect(existsSync(missing)).toBe(false);
    expect(contents(home)).toEqual(state);

    const preview = cli("upgrade", "--dry-run", "--dir", root);
    expect(preview.status).toBe(0);
    expect(contents(root)).toEqual(before);
    const applied = cli("phone", "run", "--dir", root);
    expect(applied.status).toBe(0);
    const result = JSON.parse(applied.stdout);
    expect(result.inbox.notes).toHaveLength(1);
    expect(ws.readText(result.inbox.notes[0])).toContain(body);
    expect(ws.exists(inbox)).toBe(false);
    expect(result.receipts.some((receipt: { status: string }) => receipt.status === "applied")).toBe(true);
    expect((await history(ws))[0]?.oid).not.toBe(head);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
