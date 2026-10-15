import { type Workspace, snapshot } from "@kaitu/core";
import { AgentRunner } from "./agent.js";
import type { Channel, ChannelError, ChannelMessage } from "./channel.js";
import { acquireChannel, authorize } from "./state.js";

export class ChannelRuntime {
  private queues = new Map<string, Promise<void>>();
  private releases: (() => void)[] = [];
  private agent: AgentRunner;
  private stopped = false;
  private saving: Promise<unknown> = Promise.resolve();

  constructor(
    private ws: Workspace,
    private channels: Channel[],
    private onError: ChannelError = (name, detail) => console.error(`${name}：${detail}`),
  ) {
    this.agent = new AgentRunner(ws);
  }

  async start(): Promise<void> {
    try {
      for (const channel of this.channels) {
        this.releases.push(acquireChannel(this.ws, channel.name));
        await channel.start((message) => this.receive(channel, message));
      }
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  private async receive(channel: Channel, message: ChannelMessage): Promise<void> {
    if (this.stopped || message.channel !== channel.name) return;
    const access = authorize(this.ws, channel.name, message.userId, message.text);
    if (access === "ignore") return;
    if (access === "paired") {
      await channel.send(message.chatId, "配对成功，可以发消息了。");
      return;
    }
    if (!message.text.trim()) {
      await channel.send(message.chatId, "暂不支持，发文字吧");
      return;
    }
    const key = JSON.stringify([channel.name, message.chatId]);
    // 入队前就发回执；发送失败也要保留本条消息的处理顺序。
    const receipt = channel.send(message.chatId, "收到，处理中…").catch(() => {
      this.onError(channel.name, "回执发送失败");
    });
    const previous = this.queues.get(key) ?? Promise.resolve();
    const task = previous
      .then(async () => {
        await receipt;
        if (this.stopped) return;
        let answer: string;
        try {
          answer = await this.agent.answer(message);
        } catch (error) {
          answer = (error as Error).message;
        }
        this.saving = this.saving
          .then(async () => {
            await snapshot(this.ws, `手机 ${channel.name} 消息处理`);
          })
          .catch(() => this.onError(channel.name, "版本保存失败，请在电脑端检查"));
        await this.saving;
        if (this.stopped) return;
        for (const part of splitReply(answer)) await channel.send(message.chatId, part);
      })
      .catch(() => this.onError(channel.name, "消息处理或回复失败，请在电脑端检查"));
    this.queues.set(key, task);
    await task;
    if (this.queues.get(key) === task) this.queues.delete(key);
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.agent.stop();
    await Promise.allSettled(this.channels.map((channel) => channel.stop()));
    await Promise.all(this.queues.values());
    for (const release of this.releases.splice(0)) release();
  }
}

export function splitReply(text: string): string[] {
  const parts: string[] = [];
  let part = "";
  // 按 UTF-8 字节分段，兼容 QQ 字节限制且不拆开 Unicode 字符。
  for (const char of text) {
    if (Buffer.byteLength(part + char) > 1800) {
      parts.push(part);
      part = "";
    }
    part += char;
  }
  if (part) parts.push(part);
  return parts;
}
