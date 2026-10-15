import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { Workspace } from "@kaitu/core";
import type { Channel, ChannelError, OnMessage } from "../channel.js";
import { type Credentials, readState, writeState } from "../state.js";
import { baseInfo, request } from "./api.js";

interface WeixinMessage {
  message_id?: string;
  from_user_id?: string;
  create_time_ms?: number;
  group_id?: string;
  message_type?: number;
  message_state?: number;
  context_token?: string;
  item_list?: { type?: number; text_item?: { text?: string } }[];
}

interface Updates {
  msgs?: WeixinMessage[];
  get_updates_buf?: string;
  longpolling_timeout_ms?: number;
}

export class WeixinChannel implements Channel {
  readonly name = "weixin";
  private abort = new AbortController();
  private polling?: Promise<void>;
  private contexts = new Map<string, string>();
  private seen = new Set<string>();

  constructor(
    private ws: Workspace,
    private credentials: Credentials["weixin"],
    private onError: ChannelError,
  ) {}

  async start(onMessage: OnMessage): Promise<void> {
    this.polling = this.poll(onMessage).catch(() => {
      if (!this.abort.signal.aborted) this.onError(this.name, "长轮询已停止，请重新登录或启动");
    });
  }

  private async poll(onMessage: OnMessage): Promise<void> {
    const file = ".kaitu/channels/weixin/cursor.json";
    const saved = readState<{ accountId?: string; cursor?: string }>(this.ws, file, {});
    let cursor = saved.accountId === this.credentials.accountId ? (saved.cursor ?? "") : "";
    let timeoutMs = 35_000;
    while (!this.abort.signal.aborted) {
      try {
        const updates = await request<Updates>({
          ...this.credentials,
          endpoint: "ilink/bot/getupdates",
          body: { get_updates_buf: cursor, base_info: baseInfo },
          timeoutMs,
          signal: this.abort.signal,
        });
        for (const message of updates.msgs ?? []) {
          if (message.message_type !== 1 || message.group_id || !message.from_user_id) continue;
          if (message.message_state !== undefined && message.message_state !== 2) continue;
          if (message.message_id) {
            if (this.seen.has(message.message_id)) continue;
            this.seen.add(message.message_id);
            if (this.seen.size > 1000) this.seen.delete(this.seen.values().next().value as string);
          }
          if (message.context_token) this.contexts.set(message.from_user_id, message.context_token);
          const items = message.item_list ?? [];
          const text =
            items.length && items.every((item) => item.type === 1)
              ? items.map((item) => item.text_item?.text ?? "").join("\n")
              : "";
          void onMessage({
            channel: this.name,
            chatId: message.from_user_id,
            userId: message.from_user_id,
            text,
            ts: message.create_time_ms ?? Date.now(),
          }).catch(() => this.onError(this.name, "消息处理失败"));
        }
        if (updates.get_updates_buf) {
          cursor = updates.get_updates_buf;
          writeState(this.ws, file, { accountId: this.credentials.accountId, cursor });
        }
        if (updates.longpolling_timeout_ms && updates.longpolling_timeout_ms > 0) {
          timeoutMs = Math.min(120_000, updates.longpolling_timeout_ms);
        }
      } catch (error) {
        if (this.abort.signal.aborted) return;
        if (error instanceof Error && error.message.includes("登录已失效")) throw error;
        if (!(error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name))) {
          this.onError(this.name, "收消息失败，稍后重试");
          await delay(3000, undefined, { signal: this.abort.signal });
        }
      }
    }
  }

  async stop(): Promise<void> {
    this.abort.abort();
    await this.polling;
  }

  async send(chatId: string, text: string): Promise<void> {
    await request({
      ...this.credentials,
      endpoint: "ilink/bot/sendmessage",
      body: {
        base_info: baseInfo,
        msg: {
          from_user_id: "",
          to_user_id: chatId,
          client_id: `kaitu-${randomUUID()}`,
          message_type: 2,
          message_state: 2,
          context_token: this.contexts.get(chatId),
          item_list: [{ type: 1, text_item: { text } }],
        },
      },
      signal: this.abort.signal,
    });
  }
}
