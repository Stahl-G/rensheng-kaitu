import { EventEmitter } from "node:events";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Workspace, bankNotificationCandidates, initWorkspace, restore, snapshot } from "@kaitu/core";
import { expect, it, vi } from "vitest";
import { quarantineBankNotes } from "../../core/src/bank-mail.js";
import type { MailAuthenticator } from "../src/collectors/imap/sender-gate.js";
import { ImapCollector, type ImapTransport, imapProvider } from "../src/collectors/imap/watcher.js";
import { receiveMessage } from "../src/collectors/inbox.js";
import { CollectorService } from "../src/collectors/service.js";

it("银行邮件先进入本机隔离，只有完整对齐签名可生成候选，旧共享摘录打开时迁回本机", async () => {
  const temp = mkdtempSync(join(tmpdir(), "kaitu-bank-route-"));
  const ws = await initWorkspace(join(temp, "workspace"));
  let uid = 0;
  let signed = true;
  let body = "招商银行 尾号1234 消费人民币12.00元 商户：synthetic-private-bank-741";
  let subject = "交易通知";
  let sender = "notice@cmbchina.com";
  let duplicateFrom = false;
  const transport = new EventEmitter() as EventEmitter & Record<string, unknown>;
  Object.assign(transport, {
    capabilities: new Set(["IDLE"]),
    connect: async () => {},
    close: () => transport.emit("close"),
    mailboxOpen: async () => ({ uidValidity: 7n, uidNext: 10 }),
    fetch: async function* () {
      if (uid) yield { uid };
    },
    fetchAll: async () => [
      {
        uid,
        internalDate: new Date(),
        source: Buffer.from(
          [
            `From: ${sender}`,
            ...(duplicateFrom ? ["From: attacker@example.test"] : []),
            "To: me@example.test",
            `Subject: ${subject}`,
            `Message-ID: <synthetic-${uid}@example.test>`,
            "Authentication-Results: forged.test; dmarc=pass",
            "Content-Type: text/plain; charset=utf-8",
            "",
            body,
          ].join("\r\n"),
        ),
      },
    ],
  });
  const authenticator = vi.fn(async () => ({
    dmarc: {
      status: { result: signed ? "pass" : "fail" },
      alignment: { dkim: { result: signed ? "cmbchina.com" : false } },
    },
  })) as unknown as MailAuthenticator;
  const service = new CollectorService(ws, join(temp, "state"), {
    imap: {
      ...imapProvider,
      create: (context) =>
        new ImapCollector(context, () => transport as unknown as ImapTransport, authenticator),
    },
  });
  try {
    await service.request("add", {
      kind: "imap",
      label: "Synthetic",
      preset: "gmail",
      user: "me@example.test",
      password: "synthetic",
      allowedSenders: ["notice@cmbchina.com", "sender@example.test"],
    });
    const fetchNext = async () => {
      uid = Math.max(10, uid + 1);
      transport.emit("exists");
      await vi.waitFor(() =>
        expect(
          readdirSync(ws.resolve(".kaitu/bank-mail-archive", { internal: true })).length,
        ).toBeGreaterThanOrEqual(uid - 9),
      );
    };
    await vi.waitFor(async () => {
      const value = (await service.request("list")) as { accounts: { lastFetch?: string }[] };
      expect(value.accounts[0]?.lastFetch).toBeTruthy();
    });
    await fetchNext();
    expect(bankNotificationCandidates(ws)).toHaveLength(1);
    signed = false;
    await fetchNext();
    expect(bankNotificationCandidates(ws)).toHaveLength(1);
    duplicateFrom = true;
    await fetchNext();
    expect(bankNotificationCandidates(ws)).toHaveLength(1);
    duplicateFrom = false;
    sender = "blocked@cmbchina.com";
    await fetchNext();
    expect(bankNotificationCandidates(ws)).toHaveLength(1);
    expect(readdirSync(ws.resolve("inbox/agents"))).toHaveLength(0);
    receiveMessage(ws, {
      source: "imap",
      account: "Synthetic",
      channel: "INBOX",
      sender: "notice@cmbchina.com",
      time: new Date().toISOString(),
      title: subject,
      excerpt: body,
      externalId: "legacy",
      url: "",
    });
    const legacyAgent = `inbox/agents/${readdirSync(ws.resolve("inbox/agents"))[0]}`;
    const legacyNote = legacyAgent.replace("inbox/agents/", "inbox/notes/");
    const legacyBytes = ws.readBytes(legacyAgent);
    ws.writeText(legacyNote, legacyBytes);
    rmSync(ws.resolve(legacyAgent));
    const legacyVersion = await snapshot(ws, "synthetic-legacy-bank-note");
    new Workspace(ws.root);
    expect(ws.exists(legacyNote)).toBe(false);
    ws.writeText(legacyNote, legacyBytes);
    await restore(ws, legacyVersion as string);
    expect(ws.exists(legacyNote)).toBe(false);
    expect(readdirSync(ws.resolve("inbox/agents"))).toHaveLength(0);
    expect(
      readdirSync(ws.resolve(".kaitu/bank-mail-archive", { internal: true }))
        .map((name) =>
          readFileSync(ws.resolve(`.kaitu/bank-mail-archive/${name}`, { internal: true }), "utf8"),
        )
        .join("\n"),
    ).toContain("synthetic-private-bank-741");
    signed = true;
    sender = "sender@example.test";
    subject = "Ordinary synthetic message";
    body = "synthetic-normal-815";
    uid++;
    transport.emit("exists");
    await vi.waitFor(() => expect(readdirSync(ws.resolve("inbox/agents"))).toHaveLength(1));
    expect(ws.readText(`inbox/agents/${readdirSync(ws.resolve("inbox/agents"))[0]}`)).toContain(body);
    await service.stop();
    const outside = join(temp, "outside");
    mkdirSync(outside);
    const name = `channel-${"a".repeat(64)}.note.md`;
    const external = join(outside, name);
    const original =
      "来源：imap\n发件人：notice@cmbchina.com\n标题：交易通知\n时间：2026-10-19\n外部合成原文\n";
    writeFileSync(external, original);
    for (const folder of ["agents", "notes", "processed"]) {
      const root = ws.resolve(`inbox/${folder}`);
      const saved = join(temp, `saved-${folder}`);
      const existed = existsSync(root);
      if (existed) renameSync(root, saved);
      symlinkSync(outside, root, process.platform === "win32" ? "junction" : "dir");
      const reads = vi.spyOn(ws, "readBytes");
      try {
        quarantineBankNotes(ws);
        expect(reads.mock.calls.some(([path]) => path.startsWith(`inbox/${folder}/`))).toBe(false);
        expect(readFileSync(external, "utf8")).toBe(original);
      } finally {
        reads.mockRestore();
        unlinkSync(root);
        if (existed) renameSync(saved, root);
      }
    }
  } finally {
    await service.stop();
    rmSync(temp, { recursive: true, force: true });
  }
});
