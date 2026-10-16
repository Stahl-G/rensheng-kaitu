import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inboxNotes, initWorkspace, processInbox } from "@kaitu/core";
import { expect, it, vi } from "vitest";
import { CollectorService } from "../src/collectors/service.js";
import { SlackCollector, type SlackTransport, makeSlackProvider } from "../src/collectors/slack.js";
import type { CollectorProvider } from "../src/collectors/types.js";

function contents(root: string): string {
  return readdirSync(root, { withFileTypes: true })
    .map((entry) => {
      const path = join(root, entry.name);
      return entry.isDirectory() ? contents(path) : readFileSync(path, "utf8");
    })
    .join("\n");
}
it("Slack 只拉所选会话和旧线程新回复，分页中断后重复不重写，user token 留本机", async () => {
  const directory = mkdtempSync(join(tmpdir(), "kaitu-slack-"));
  const ws = await initWorkspace(join(directory, "workspace"));
  const root = join(directory, "local");
  const clock = vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
  const token = "xoxp-synthetic-local-token";
  const text = "<@UADA> *review* &amp; confirm";
  const message = { type: "message", ts: "1800000030.000001", user: "UADA", text };
  const reply = { ...message, ts: "1800000031.000001", text: "Thread follow-up" };
  let fail = true;
  const read = new Set<string>();
  const api: SlackTransport = {
    authenticate: async () => ({ team: "TTEST", user: "UME" }),
    user: async () => "Ada",
    permalink: async (channel, ts) => `https://test.slack.com/archives/${channel}/p${ts.replace(".", "")}`,
    async history(input) {
      read.add(input.channel);
      if (!input.cursor)
        return {
          messages: [
            message,
            { type: "message", ts: "1700000000.000001", reply_count: 1, latest_reply: reply.ts },
          ],
          cursor: "next",
        };
      if (fail) throw new Error("synthetic transport interruption");
      return { messages: [message] };
    },
    replies: async () => ({ messages: [reply] }),
  };
  let collector: SlackCollector | undefined;
  const base = makeSlackProvider(() => api);
  const provider: CollectorProvider = {
    ...base,
    create(context) {
      const instance = new SlackCollector(context, () => api);
      collector = instance;
      return { start() {}, stop: () => instance.stop(), test: () => instance.test() };
    },
  };
  const service = new CollectorService(ws, root, { slack: provider });
  try {
    const { id } = (await service.request("add", { kind: "slack", label: "合成 Slack", token })) as {
      id: string;
    };
    await service.request("select", { id, ids: ["CSELECT"] });
    clock.mockReturnValue(1_800_000_060_000);
    if (!collector) throw new Error("采集器未创建");
    await collector.poll();
    await processInbox(ws, { stableMs: 0 });
    const notes = inboxNotes(ws);
    expect(notes).toHaveLength(2);
    expect(notes.some((note) => note.content.includes("@Ada review & confirm"))).toBe(true);
    expect(notes.some((note) => note.content.includes(reply.text))).toBe(true);
    const replay = notes[0];
    if (!replay) throw new Error("没有 Slack 笔记");
    writeFileSync(ws.resolve(`inbox/agents/${replay.path.split("/").at(-1)}`), replay.content);
    await processInbox(ws, { stableMs: 0 });
    expect(inboxNotes(ws)).toHaveLength(2);
    const before = notes.map((note) => statSync(ws.resolve(note.path)).mtimeMs);
    fail = false;
    await collector.poll();
    expect(inboxNotes(ws).map((note) => statSync(ws.resolve(note.path)).mtimeMs)).toEqual(before);
    expect(readdirSync(ws.resolve("inbox/agents"))).toHaveLength(0);
    expect([...read]).toEqual(["CSELECT"]);
    expect(contents(ws.root)).not.toContain(token);
    expect(JSON.stringify(await service.request("list"))).not.toContain(token);
    expect(
      readdirSync(root).some(
        (file) => file.endsWith(".json") && readFileSync(join(root, file), "utf8").includes(token),
      ),
    ).toBe(true);
  } finally {
    await service.stop();
    clock.mockRestore();
    rmSync(directory, { recursive: true, force: true });
  }
});
