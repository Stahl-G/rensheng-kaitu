import { rmSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { parseFrontmatter, stringifyFrontmatter } from "../src/frontmatter.js";
import { applyPhoneActions } from "../src/phone-actions.js";
import type { PhoneReceipt } from "../src/phone-receipts.js";
import { phoneReceipts } from "../src/phone-receipts.js";
import type { ResultEffect } from "../src/results.js";
import { applyResultAction } from "../src/results.js";
import { ulid } from "../src/ulid.js";
import type { BackupRemote } from "../src/workspace-backup.js";
import {
  connectWorkspaceBackup,
  syncWorkspaceBackup,
  workspaceBackupStatus,
} from "../src/workspace-backup.js";
import type { Workspace } from "../src/workspace.js";
import { clonedWorkspace } from "./helpers.js";
const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
it.each(["none", "conflict", "rejected", "expired"] as const)(
  "shared success survives a local %s retry receipt and prevents replay after undo",
  async (localReceipt) => {
    const a = await clonedWorkspace();
    const b = await clonedWorkspace();
    roots.push(a.root, b.root);
    const file = "me/STATUS.md";
    const before = { id: "one", title: "Synthetic sync review", status: "todo" };
    const doc = stringifyFrontmatter({ updated: null, next: [before] }, "# Synthetic\n");
    a.writeText(file, doc);
    b.writeText(file, doc);
    let files: Record<string, string> = {};
    let head: string | null = null;
    let count = 0;
    const remote: BackupRemote = {
      async inspect() {
        return { private: true, branch: "main" };
      },
      async read() {
        return { head, files: { ...files } };
      },
      async push(_r, _b, expected, incoming) {
        if (expected !== head) throw Error("Remote changed");
        files = { ...incoming };
        head = String(++count);
        return head;
      },
    };
    await connectWorkspaceBackup(b, { repo: "synthetic/receipt-review", text: true, records: true }, remote);
    await syncWorkspaceBackup(b, remote);
    expect(workspaceBackupStatus(b).conflicts).toEqual([]);
    expect(workspaceBackupStatus(b).error).toBeNull();
    const request = {
      client_id: ulid(),
      op: "complete_next_result" as const,
      args: { file, id: "one", expected_next: before, result_text: "Done" },
    };
    const action = { ...request, device: "12345678", at: new Date().toISOString() };
    const send = (ws: Workspace, act: unknown) =>
      applyPhoneActions(ws, "synthetic.actions.jsonl", JSON.stringify(act));
    const path = `.kaitu/result-actions/${request.client_id}.json`;
    const write = b.writeJson.bind(b);
    const spy = vi.spyOn(b, "writeJson").mockImplementation((p, v, o) => {
      const r = write(p, v, o);
      if (p === path) throw Error("Interrupted after initial journal");
      return r;
    });
    await expect(applyResultAction(b, request)).rejects.toThrow("Interrupted after initial journal");
    spy.mockRestore();
    if (localReceipt === "conflict" || localReceipt === "expired") {
      await send(b, { ...action, args: { ...request.args, result_text: "Changed payload" } });
      expect(phoneReceipts(b).find((x) => x.ref === request.client_id)?.status).toBe("conflict");
    }
    if (localReceipt === "rejected") {
      await applyPhoneActions(
        b,
        "synthetic.actions.jsonl",
        [JSON.stringify(action), JSON.stringify(action)].join("\n"),
      );
      expect(phoneReceipts(b).find((x) => x.ref === request.client_id)?.status).toBe("rejected");
    }
    await send(a, action);
    const applied = phoneReceipts(a).find((x) => x.ref === request.client_id);
    if (!applied?.effect) throw new Error("Expected completion effect");
    const e = applied.effect as Extract<ResultEffect, { expected_next: unknown }>;
    await send(a, {
      client_id: ulid(),
      op: "restore_next",
      args: { file, id: "one", expected_next: e.expected_next, prior_next: e.prior_next },
      device: "12345678",
      at: new Date().toISOString(),
    });
    expect(parseFrontmatter<{ next: { status: string }[] }>(a.readText(file)).data.next[0].status).toBe(
      "todo",
    );
    // The stub carries actual artifacts produced by A; all network endpoints are mocked.
    files = { ...files, [file]: a.readText(file), "phone/receipts.json": a.readText("phone/receipts.json") };
    head = String(++count);
    if (localReceipt === "expired") {
      const value = JSON.parse(files["phone/receipts.json"]);
      value.items = value.items.map((r: PhoneReceipt) => ({
        ...r,
        at: new Date(Date.now() - 15 * 86400000).toISOString(),
      }));
      files["phone/receipts.json"] = JSON.stringify(value);
    }
    const remoteBefore = JSON.parse(files["phone/receipts.json"]).items.find(
      (x: PhoneReceipt) => x.ref === request.client_id,
    )?.status;
    await syncWorkspaceBackup(b, remote);
    const sync = workspaceBackupStatus(b);
    expect(sync.conflicts).toEqual([]);
    expect(sync.error).toBeNull();
    const afterSync = phoneReceipts(b).find((x) => x.ref === request.client_id)?.status;
    const remoteAfter = JSON.parse(files["phone/receipts.json"]).items.find(
      (x: PhoneReceipt) => x.ref === request.client_id,
    )?.status;
    expect(b.readText(file)).toBe(a.readText(file));
    if (localReceipt === "expired") {
      expect(afterSync).toBe("conflict");
      expect(remoteAfter).toBe("conflict");
      return;
    }
    await send(b, action);
    const result = {
      remoteBefore,
      afterSync,
      remoteAfter,
      status: parseFrontmatter<{ next: { status: string }[] }>(b.readText(file)).data.next[0].status,
      receipt: phoneReceipts(b).find((x) => x.ref === request.client_id)?.status,
    };
    expect(result).toEqual({
      remoteBefore: "applied",
      afterSync: "applied",
      remoteAfter: "applied",
      status: "todo",
      receipt: "duplicate",
    });
    // A later negative remote receipt must not downgrade the confirmed local result.
    const receiptFile = JSON.parse(files["phone/receipts.json"]);
    receiptFile.items = receiptFile.items.map((r: PhoneReceipt) =>
      r.ref === request.client_id
        ? { ref: r.ref, kind: "action", status: "conflict", at: new Date().toISOString() }
        : r,
    );
    files = { ...files, "phone/receipts.json": JSON.stringify(receiptFile) };
    head = String(++count);
    await syncWorkspaceBackup(b, remote);
    expect(workspaceBackupStatus(b).error).toBeNull();
    expect(phoneReceipts(b).find((x) => x.ref === request.client_id)?.status).toBe("duplicate");
    await send(b, action);
    expect(parseFrontmatter<{ next: { status: string }[] }>(b.readText(file)).data.next[0].status).toBe(
      "todo",
    );
  },
);
