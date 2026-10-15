import { Client, EventDispatcher, LoggerLevel, WSClient } from "@larksuiteoapi/node-sdk";
import type { Channel, ChannelError, OnMessage } from "./channel.js";

export class FeishuChannel implements Channel {
  readonly name = "feishu";
  private client: Client;
  private ws: WSClient;
  private seen = new Set<string>();
  private ready?: () => void;
  private cancelStart?: () => void;

  constructor(
    appId: string,
    appSecret: string,
    private onError: ChannelError,
  ) {
    if (!/^cli_[0-9a-fA-F]{16}$/.test(appId)) throw new Error("飞书 App ID 格式不正确");
    const logger = { error() {}, warn() {}, info() {}, debug() {}, trace() {} };
    this.client = new Client({ appId, appSecret, logger });
    this.ws = new WSClient({
      appId,
      appSecret,
      logger,
      loggerLevel: LoggerLevel.error,
      handshakeTimeoutMs: 30_000,
      onReady: () => this.ready?.(),
      onError: () => {
        this.onError(this.name, "长连接失败，请检查凭据、应用发布和事件订阅");
        this.cancelStart?.();
      },
    });
  }

  async start(onMessage: OnMessage): Promise<void> {
    const connected = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("飞书长连接启动超时"));
      }, 45_000);
      this.ready = () => {
        clearTimeout(timer);
        this.cancelStart = undefined;
        resolve();
      };
      this.cancelStart = () => {
        clearTimeout(timer);
        reject(new Error("飞书长连接启动已停止"));
      };
    });
    void this.ws
      .start({
        eventDispatcher: new EventDispatcher({}).register({
          "im.message.receive_v1": (event) => {
            const { message, sender } = event;
            const userId = sender.sender_id?.open_id;
            if (message.chat_type !== "p2p" || sender.sender_type !== "user" || !userId) return;
            if (this.seen.has(message.message_id)) return;
            this.seen.add(message.message_id);
            if (this.seen.size > 1000) this.seen.delete(this.seen.values().next().value as string);
            let text = "";
            if (message.message_type === "text") {
              try {
                const content = JSON.parse(message.content) as { text?: string };
                if (typeof content.text === "string") text = content.text;
              } catch {
                return;
              }
            }
            void onMessage({
              channel: this.name,
              chatId: message.chat_id,
              userId,
              text,
              ts: Number(message.create_time),
            }).catch(() => this.onError(this.name, "消息处理失败"));
          },
        }),
      })
      .catch(() => this.cancelStart?.());
    await connected;
  }

  async stop(): Promise<void> {
    this.cancelStart?.();
    this.ws.close({ force: true });
  }

  async send(chatId: string, text: string): Promise<void> {
    const response = await this.client.im.message.create({
      params: { receive_id_type: "chat_id" },
      data: { receive_id: chatId, msg_type: "text", content: JSON.stringify({ text }) },
    });
    if (response.code !== 0) throw new Error("飞书发送失败");
  }
}
