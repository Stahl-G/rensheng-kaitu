import { QQBot, type ReplyTarget } from "@tencent-connect/qqbot-nodejs";
import type { Channel, ChannelError, OnMessage } from "./channel.js";

export class QqChannel implements Channel {
  readonly name = "qq";
  private bot: QQBot;
  private running?: Promise<void>;
  private targets = new Map<string, ReplyTarget>();
  private seen = new Set<string>();
  private cancelStart?: () => void;

  constructor(
    appId: string,
    appSecret: string,
    private onError: ChannelError,
  ) {
    this.bot = new QQBot({ appId, appSecret, transport: "websocket", intents: 1 << 25 });
  }

  async start(onMessage: OnMessage): Promise<void> {
    this.bot.on("message", (_ctx, message) => {
      if (message.kind !== "c2c" || message.senderIsBot || !message.senderId) return;
      if (this.seen.has(message.messageId)) return;
      this.seen.add(message.messageId);
      if (this.seen.size > 1000) this.seen.delete(this.seen.values().next().value as string);
      this.targets.set(message.senderId, message.replyTarget);
      void onMessage({
        channel: this.name,
        chatId: message.senderId,
        userId: message.senderId,
        text:
          message.attachments?.length || (message.msgType !== undefined && message.msgType !== 0)
            ? ""
            : message.content,
        ts: Date.parse(message.timestamp),
      }).catch(() => this.onError(this.name, "消息处理失败"));
    });
    this.bot.on("error", () => this.onError(this.name, "连接错误，SDK 将尝试恢复"));
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("QQ 长连接启动超时"));
      }, 45_000);
      const ready = () => {
        clearTimeout(timer);
        this.cancelStart = undefined;
        resolve();
      };
      this.cancelStart = () => {
        clearTimeout(timer);
        reject(new Error("QQ 已停止"));
      };
      this.bot.on("ready", ready);
      this.running = this.bot.start().catch(() => {
        clearTimeout(timer);
        this.onError(this.name, "长连接已停止，请检查应用权限、凭据和网络");
        reject(new Error("QQ 长连接启动失败"));
      });
    });
  }

  async stop(): Promise<void> {
    this.cancelStart?.();
    this.bot.stop();
    await this.running;
  }

  async send(chatId: string, text: string): Promise<void> {
    const target = this.targets.get(chatId);
    if (!target) throw new Error("QQ 缺少私聊回复目标");
    await this.bot.sendText(target, text);
  }
}
