import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inboxNoteDone, inboxNotes, initWorkspace, processInbox } from "@kaitu/core";
import { expect, it, vi } from "vitest";
import type { MailAuthenticator } from "../src/collectors/imap/sender-gate.js";
import { ImapCollector, type ImapTransport, imapProvider } from "../src/collectors/imap/watcher.js";
import { CollectorService } from "../src/collectors/service.js";

function contents(root: string): string {
  return readdirSync(root, { withFileTypes: true })
    .map((entry) => {
      const path = join(root, entry.name);
      return entry.isDirectory() ? contents(path) : readFileSync(path, "utf8");
    })
    .join("\n");
}
it("IMAP 只读拉取新邮件，归档后重投不重写，凭据和游标留本机且同账号不重复启动", async () => {
  const directory = mkdtempSync(join(tmpdir(), "kaitu-imap-"));
  const ws = await initWorkspace(join(directory, "workspace"));
  const root = join(directory, "local");
  const password = "synthetic-imap-secret-42";
  let uid = 0;
  let connects = 0;
  const transport = new EventEmitter() as EventEmitter & Record<string, unknown>;
  Object.assign(transport, {
    capabilities: new Set(["IDLE"]),
    connect: async () => {
      connects++;
    },
    close: () => transport.emit("close"),
    mailboxOpen: async (_name: string, options: { readOnly: boolean }) => {
      if (!options.readOnly) throw new Error("writable mailbox");
      return { uidValidity: 7n, uidNext: 10 };
    },
    fetch: async function* () {
      if (uid) yield { uid };
    },
    fetchAll: async () => [
      {
        uid,
        internalDate: new Date("2026-10-16T05:00:00Z"),
        source: Buffer.from(
          [
            "From: sender@example.test",
            "To: me@example.test",
            "Subject: Review tomorrow",
            "Message-ID: <synthetic-1@example.test>",
            "Content-Type: text/plain; charset=utf-8",
            "",
            "Please review tomorrow.",
          ].join("\r\n"),
        ),
      },
    ],
  });
  const authenticator = vi.fn(async () => ({
    dmarc: { status: { result: "pass" } },
  })) as unknown as MailAuthenticator;
  const provider = {
    ...imapProvider,
    create: (context: ConstructorParameters<typeof ImapCollector>[0]) =>
      new ImapCollector(context, () => transport as unknown as ImapTransport, authenticator),
  };
  const service = new CollectorService(ws, root, { imap: provider });
  const second = new CollectorService(ws, root, { imap: provider });
  try {
    const { id } = (await service.request("add", {
      kind: "imap",
      label: "测试邮箱",
      preset: "gmail",
      user: "me@example.test",
      password,
    })) as { id: string };
    await vi.waitFor(async () => {
      const result = (await service.request("list")) as { accounts: { lastFetch?: string }[] };
      expect(result.accounts[0]?.lastFetch).toBeTruthy();
    });
    second.start();
    await second.request("list");
    expect(connects).toBe(1);
    uid = 10;
    transport.emit("exists");
    await vi.waitFor(() => expect(readdirSync(ws.resolve("inbox/agents"))).toHaveLength(1));
    const file = readdirSync(ws.resolve("inbox/agents"))[0] as string;
    const note = ws.readText(`inbox/agents/${file}`);
    expect(note).toContain("Please review tomorrow.");
    await processInbox(ws, { stableMs: 0 });
    const saved = inboxNotes(ws)[0];
    if (!saved) throw new Error("没有收到邮件笔记");
    const before = statSync(ws.resolve(saved.path)).mtimeMs;
    uid = 11;
    transport.emit("exists");
    await vi.waitFor(() => expect(authenticator).toHaveBeenCalledTimes(2));
    expect(JSON.stringify(await service.request("list"))).not.toContain(password);
    await service.stop();
    expect(inboxNotes(ws)).toHaveLength(1);
    expect(statSync(ws.resolve(saved.path)).mtimeMs).toBe(before);
    expect(readdirSync(ws.resolve("inbox/agents"))).toHaveLength(0);
    await inboxNoteDone(ws, saved.path);
    await second.stop();
    const restarted = new CollectorService(ws, root, { imap: provider });
    restarted.start();
    await vi.waitFor(() => expect(connects).toBe(2));
    await restarted.stop();
    const local = readdirSync(root).filter((file) => file.endsWith(".json"));
    expect(local.some((file) => readFileSync(join(root, file), "utf8").includes(password))).toBe(true);
    if (process.platform !== "win32")
      for (const file of local) expect(statSync(join(root, file)).mode & 0o777).toBe(0o600);
    expect(contents(ws.root)).not.toContain(password);
    expect(id).toBeDefined();
  } finally {
    await service.stop();
    await second.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});
