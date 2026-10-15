import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initWorkspace, isTracked } from "@kaitu/core";
import { expect, it, vi } from "vitest";
import type { Channel, OnMessage } from "../src/channel.js";
import { ChannelRuntime } from "../src/runtime.js";
import { channelStatus, pair, saveCredentials } from "../src/state.js";

class FakeChannel implements Channel {
  readonly name = "telegram";
  sent: { chatId: string; text: string }[] = [];
  onMessage!: OnMessage;
  async start(onMessage: OnMessage) {
    this.onMessage = onMessage;
  }
  async stop() {}
  async send(chatId: string, text: string) {
    this.sent.push({ chatId, text });
  }
  receive(userId: string, text: string) {
    return this.onMessage({ channel: this.name, userId, chatId: userId, text, ts: Date.now() });
  }
}

it("一次性配对隔离主人，消息调用本机命令并按会话排队，状态不进历史", async () => {
  const directory = mkdtempSync(join(tmpdir(), "kaitu-channels-"));
  const ws = await initWorkspace(join(directory, "workspace"));
  const script = join(directory, "agent.cjs");
  writeFileSync(
    script,
    `
const fs = require('node:fs');
let input = '';
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', async () => {
  const value = input.trim().split('\\n').at(-1).split('：').at(-1);
  fs.appendFileSync('me/processed.txt', 'start:' + value + '\\n');
  if (value === 'first') {
    while (!fs.existsSync('release')) await new Promise(resolve => setTimeout(resolve, 10));
  }
  fs.appendFileSync('me/processed.txt', 'end:' + value + '\\n');
  process.stdout.write('result:' + value);
});
`,
  );
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  const config = ws.readJson<Record<string, unknown>>(".kaitu/config.json");
  ws.writeJson(
    ".kaitu/config.json",
    {
      ...config,
      channels: { agent_command: `${quote(process.execPath)} ${quote(script)}` },
    },
    { internal: true },
  );
  saveCredentials(ws, "telegram", { token: "synthetic-token" });
  const channel = new FakeChannel();
  const errors: string[] = [];
  const runtime = new ChannelRuntime(ws, [channel], (_name, detail) => errors.push(detail));
  try {
    await runtime.start();
    const expired = pair(ws, "telegram", Date.now() - 601_000);
    await channel.receive("intruder", expired.code);
    await channel.receive("intruder", "wrong");
    expect(channel.sent).toEqual([]);
    const pending = pair(ws, "telegram");
    await channel.receive("owner", pending.code);
    expect(channelStatus(ws).find((item) => item.name === "telegram")?.paired).toBe(true);
    expect(channel.sent).toHaveLength(1);
    channel.sent = [];
    await channel.receive("intruder", pending.code);
    await channel.receive("intruder", "");
    expect(channel.sent).toEqual([]);
    expect(existsSync(join(ws.root, "me/processed.txt"))).toBe(false);

    const first = channel.receive("owner", "first");
    await vi.waitFor(() => expect(existsSync(join(ws.root, "me/processed.txt"))).toBe(true));
    const second = channel.receive("owner", "second");
    expect(channel.sent).toHaveLength(2);
    expect(readFileSync(join(ws.root, "me/processed.txt"), "utf8")).toBe("start:first\n");
    writeFileSync(join(ws.root, "release"), "");
    await Promise.all([first, second]);
    expect(channel.sent).toHaveLength(4);
    expect(channel.sent.slice(2).map((reply) => reply.text)).toEqual(["result:first", "result:second"]);
    expect(readFileSync(join(ws.root, "me/processed.txt"), "utf8")).toBe(
      "start:first\nend:first\nstart:second\nend:second\n",
    );
    expect(await isTracked(ws, "me/processed.txt")).toBe(true);
    expect(await isTracked(ws, ".kaitu/channels/telegram/pairing.json")).toBe(false);
    expect(await isTracked(ws, ".kaitu/secrets.json")).toBe(false);
    expect(statSync(ws.resolve(".kaitu/secrets.json", { internal: true })).mode & 0o777).toBe(0o600);
    expect(errors).toEqual([]);
  } finally {
    await runtime.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});
