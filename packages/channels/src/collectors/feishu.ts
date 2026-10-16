// Adapted from OpenClaw (MIT), Copyright (c) 2026 OpenClaw Foundation
import { KaituError } from "@kaitu/core";
import { EventDispatcher, LoggerLevel, WSClient } from "@larksuiteoapi/node-sdk";
import { plain, receiveMessage } from "./inbox.js";
import type { Collector, CollectorContext, CollectorProvider } from "./types.js";

export interface FeishuEvent {
  sender: { sender_id?: { open_id?: string; user_id?: string }; sender_type?: string; tenant_key?: string };
  message: {
    message_id: string;
    chat_id: string;
    chat_type: string;
    message_type: string;
    content: string;
    create_time: string;
    mentions?: { key: string; name: string }[];
  };
}
interface FeishuConfig {
  appId: string;
  appSecret: string;
}
type ConnectionState = (connected: boolean, terminal?: boolean) => void;
export interface FeishuTransport {
  start(receive: (event: FeishuEvent) => Promise<void>, state: ConnectionState): Promise<void>;
  stop(): void;
}
export type FeishuFactory = (config: FeishuConfig) => FeishuTransport;
const createTransport: FeishuFactory = (config) => {
  const logger = { error() {}, warn() {}, info() {}, debug() {}, trace() {} };
  let client: WSClient | undefined;
  let cancel: (() => void) | undefined;
  return {
    start(receive, state) {
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("飞书长连接启动超时")), 45000);
        const ready = () => {
          clearTimeout(timer);
          state(true);
          resolve();
        };
        const fail = () => {
          clearTimeout(timer);
          state(false, true);
          reject(new Error("飞书长连接不可用"));
        };
        cancel = () => {
          clearTimeout(timer);
          reject(new Error("飞书连接已停止"));
        };
        client = new WSClient({
          ...config,
          logger,
          loggerLevel: LoggerLevel.error,
          handshakeTimeoutMs: 20000,
          wsConfig: { pingTimeout: 30 },
          autoReconnect: true,
          onReady: ready,
          onError: fail,
          onReconnecting: () => state(false),
          onReconnected: () => state(true),
        });
        void client
          .start({
            eventDispatcher: new EventDispatcher({ logger }).register({
              "im.message.receive_v1": async (event) => receive(event),
            }),
          })
          .catch(fail);
      });
    },
    stop() {
      cancel?.();
      client?.close({ force: true });
    },
  };
};
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function str(value: unknown) {
  return typeof value === "string" ? value : "";
}
function postText(input: unknown): string {
  const root = record(input);
  const wrapper = record(root.post ?? root);
  const localized = record(
    wrapper.zh_cn ??
      wrapper.en_us ??
      Object.values(wrapper).find((value) => Array.isArray(record(value).content)),
  );
  const post = Array.isArray(wrapper.content) ? wrapper : localized;
  const lines = Array.isArray(post.content) ? post.content : [];
  return [
    str(post.title),
    ...lines.map((line) =>
      (Array.isArray(line) ? line : [line])
        .map((item) => {
          const element = record(item);
          switch (element.tag) {
            case "at":
              return `@${str(element.user_name) || str(element.user_id) || str(element.open_id)}`;
            case "a":
              return str(element.text) || str(element.href);
            case "img":
              return "[图片]";
            case "media":
              return "[视频]";
            default:
              return str(element.text) || str(element.content);
          }
        })
        .join(""),
    ),
  ]
    .filter(Boolean)
    .join("\n");
}
export function feishuText(event: FeishuEvent): string {
  const { message } = event;
  let text: string;
  if (message.content.length > 1_048_576) return "[消息过长，请查看原文]";
  if (message.message_type === "text" || message.message_type === "post") {
    const value: unknown = JSON.parse(message.content);
    text = message.message_type === "post" ? postText(value) : str(record(value).text);
  } else text = `[${message.message_type} 消息]`;
  for (const mention of message.mentions ?? []) text = text.replaceAll(mention.key, `@${mention.name}`);
  return text || `[${message.message_type} 消息]`;
}
export class FeishuCollector implements Collector {
  private config: FeishuConfig;
  private transport?: FeishuTransport;
  private stopped = false;
  private connecting?: Promise<void>;
  private queue: Promise<void> = Promise.resolve();
  private timer?: NodeJS.Timeout;
  private failures = 0;
  private seen: string[];
  constructor(
    private context: CollectorContext,
    private factory = createTransport,
  ) {
    this.config = normalize(context.account.settings);
    this.seen = context.store.read(`${context.account.id}:feishu-state`, []);
  }
  start() {
    if (this.stopped || this.connecting) return;
    this.transport = this.factory(this.config);
    this.connecting = this.transport
      .start(
        (event) => this.receive(event),
        (connected, terminal) => {
          if (this.stopped) return;
          this.context.status({ connected, error: connected ? "" : "飞书长连接断开，正在重连" });
          if (connected) this.failures = 0;
          if (terminal) this.retry();
        },
      )
      .catch(() => {
        if (!this.stopped) {
          this.context.status({
            connected: false,
            error: "飞书连接失败，请检查凭据、应用发布、权限和事件订阅",
          });
          this.retry();
        }
      })
      .finally(() => {
        this.connecting = undefined;
      });
  }
  private retry() {
    if (this.stopped || this.timer) return;
    this.transport?.stop();
    this.timer = setTimeout(
      () => {
        this.timer = undefined;
        this.start();
      },
      Math.min(1000 * 2 ** Math.min(this.failures++, 6), 60000),
    );
    this.timer.unref();
  }
  receive(event: FeishuEvent): Promise<void> {
    const task = this.queue.then(() => {
      if (this.stopped) return;
      const { message, sender } = event;
      if (
        !["group", "p2p"].includes(message.chat_type) ||
        !message.message_id ||
        this.seen.includes(message.message_id)
      )
        return;
      const text = feishuText(event);
      const time = new Date(Number(message.create_time));
      if (!Number.isFinite(time.getTime())) throw new KaituError("飞书消息时间无效", "CHANNEL");
      receiveMessage(this.context.ws, {
        source: "feishu",
        account: this.context.account.label,
        channel: message.chat_id,
        sender: sender.sender_id?.open_id ?? sender.sender_id?.user_id ?? sender.sender_type ?? "未知发件人",
        time: time.toISOString(),
        title: plain(text, 80),
        excerpt: text,
        externalId: `${sender.tenant_key ?? ""}/${message.message_id}`,
        url: `https://applink.feishu.cn/client/chat/open?openChatId=${encodeURIComponent(message.chat_id)}`,
      });
      this.seen = [...this.seen, message.message_id].slice(-2000);
      this.context.store.write(`${this.context.account.id}:feishu-state`, this.seen);
      this.context.status({ lastFetch: new Date().toISOString(), error: "" });
    });
    this.queue = task.catch(() => {
      if (!this.stopped) this.context.status({ error: "飞书消息读取或保存失败，等待平台重试" });
    });
    return task;
  }
  async test() {
    const transport = this.factory(this.config);
    try {
      await transport.start(
        (event) => this.receive(event),
        () => {},
      );
    } finally {
      transport.stop();
      await this.queue;
    }
  }
  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.transport?.stop();
    await this.connecting;
    await this.queue;
  }
}
function normalize(input: Record<string, unknown>): FeishuConfig {
  if (
    typeof input.appId !== "string" ||
    !/^cli_[a-zA-Z0-9]+$/.test(input.appId) ||
    typeof input.appSecret !== "string" ||
    !input.appSecret
  )
    throw new KaituError("请填写飞书 App ID 与 App Secret", "CHANNEL");
  return { appId: input.appId, appSecret: input.appSecret };
}
export const feishuProvider: CollectorProvider = {
  normalize: (input) => ({ ...normalize(input) }),
  identity: (settings) => String(settings.appId),
  create: (context) => new FeishuCollector(context),
};
