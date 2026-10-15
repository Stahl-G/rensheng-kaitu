import { Bot } from "grammy";
import type { Channel, ChannelError, OnMessage } from "./channel.js";

export class TelegramChannel implements Channel {
  readonly name = "telegram";
  private bot: Bot;
  private polling?: Promise<void>;
  private stopped = false;
  private abort = new AbortController();

  private get signal(): NonNullable<Parameters<Bot["init"]>[0]> {
    // grammY 的声明仍引用旧 AbortSignal shim；运行时支持 Node 原生信号。
    return this.abort.signal as unknown as NonNullable<Parameters<Bot["init"]>[0]>;
  }

  constructor(
    token: string,
    private onError: ChannelError,
  ) {
    this.bot = new Bot(token);
  }

  async start(onMessage: OnMessage): Promise<void> {
    this.bot.on("message", (ctx) => {
      if (ctx.chat.type !== "private" || !ctx.from || ctx.from.is_bot) return;
      void onMessage({
        channel: this.name,
        chatId: String(ctx.chat.id),
        userId: String(ctx.from.id),
        text: ctx.message.text ?? "",
        ts: ctx.message.date * 1000,
      }).catch(() => this.onError(this.name, "消息处理失败"));
    });
    this.bot.catch(() => this.onError(this.name, "接收消息失败"));
    try {
      await this.bot.init(this.signal);
    } catch {
      throw new Error("Telegram 启动失败，请检查 token 和网络");
    }
    this.polling = this.bot.start({ allowed_updates: ["message"] }).catch(() => {
      if (!this.stopped) this.onError(this.name, "长轮询已停止，请检查凭据和网络后重新启动");
    });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.abort.abort();
    if (this.bot.isRunning()) await this.bot.stop();
    await this.polling;
  }

  async send(chatId: string, text: string): Promise<void> {
    await this.bot.api.sendMessage(chatId, text, undefined, this.signal);
  }
}
