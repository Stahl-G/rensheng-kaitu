import { LogLevel, WebClient } from "@slack/web-api";
import { plain, receiveMessage } from "./inbox.js";
import type { Collector, CollectorContext, CollectorProvider } from "./types.js";

interface SlackMessage {
  type?: string;
  subtype?: string;
  ts?: string;
  user?: string;
  bot_id?: string;
  text?: string;
  latest_reply?: string;
  reply_count?: number;
}
interface SlackPage {
  messages: SlackMessage[];
  cursor?: string;
}
interface PageInput {
  channel: string;
  latest: string;
  cursor?: string;
  oldest?: string;
  ts?: string;
}
export interface SlackTransport {
  authenticate(): Promise<{ team: string; user: string }>;
  history(input: PageInput): Promise<SlackPage>;
  replies(input: PageInput & { ts: string }): Promise<SlackPage>;
  user(id: string): Promise<string>;
  permalink(channel: string, ts: string): Promise<string>;
}
export type SlackFactory = (token: string) => SlackTransport;
const createTransport: SlackFactory = (token) => {
  const client = new WebClient(token, {
    logLevel: LogLevel.ERROR,
    logger: {
      debug() {},
      info() {},
      warn() {},
      error() {},
      setLevel() {},
      getLevel() {
        return LogLevel.ERROR;
      },
      setName() {},
    },
    retryConfig: { retries: 0 },
    rejectRateLimitedCalls: true,
    timeout: 20000,
    maxRequestConcurrency: 1,
  });
  return {
    async authenticate() {
      const result = await client.auth.test();
      if (!result.team_id || !result.user_id) throw new Error("Slack 账号不可用");
      return { team: result.team_id, user: result.user_id };
    },
    async history(input) {
      const result = await client.conversations.history({ ...input, limit: 100 });
      return { messages: result.messages ?? [], cursor: result.response_metadata?.next_cursor || undefined };
    },
    async replies(input) {
      const result = await client.conversations.replies({ ...input, limit: 100 });
      return { messages: result.messages ?? [], cursor: result.response_metadata?.next_cursor || undefined };
    },
    async user(id) {
      const result = await client.users.info({ user: id });
      return result.user?.profile?.display_name || result.user?.real_name || result.user?.name || id;
    },
    async permalink(channel, ts) {
      const result = await client.chat.getPermalink({ channel, message_ts: ts });
      if (!result.permalink) throw new Error("Slack 原文链接不可用");
      return result.permalink;
    },
  };
};
interface SlackConfig {
  token: string;
  team: string;
  user: string;
  channels: string[];
  since: Record<string, string>;
  intervalMinutes: number;
}
interface Scan {
  latest: string;
  cursor?: string;
  doneThreads: string[];
  reply?: { root: string; cursor: string };
}
interface ChannelCursor {
  since: string;
  scan?: Scan;
}
const timestamp = () => (Date.now() / 1000).toFixed(6);
function apiCode(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const data = "data" in error && error.data && typeof error.data === "object" ? error.data : {};
  return "error" in data && typeof data.error === "string"
    ? data.error
    : "code" in error
      ? String(error.code)
      : "";
}
function slackError(error: unknown): string {
  switch (apiCode(error)) {
    case "slack_webapi_rate_limited_error":
    case "ratelimited":
      return "Slack 请求限流，将在下轮重试";
    case "invalid_auth":
    case "token_revoked":
    case "account_inactive":
      return "Slack token 已失效，请重新添加账号";
    case "missing_scope":
      return "Slack 权限不足，请核对应用的 user scopes";
    case "channel_not_found":
    case "not_in_channel":
      return "Slack 会话不存在或用户无访问权限，请检查所选 ID";
    default:
      return "Slack 读取失败，请检查网络、token 与会话权限，将在下轮重试";
  }
}
function channelIds(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length > 100 ||
    value.some((id) => typeof id !== "string" || !/^[CGD][A-Z0-9]+$/.test(id))
  )
    throw new Error("请填写有效的 Slack 会话 ID（最多 100 个）");
  return [...new Set(value)] as string[];
}

export class SlackCollector implements Collector {
  private config: SlackConfig;
  private api: SlackTransport;
  private state: Record<string, ChannelCursor>;
  private stopped = false;
  private pending?: Promise<void>;
  private timer?: NodeJS.Timeout;
  private users = new Map<string, string>();
  constructor(
    private context: CollectorContext,
    factory = createTransport,
  ) {
    this.config = context.account.settings as unknown as SlackConfig;
    this.api = factory(this.config.token);
    this.state = context.store.read(`${context.account.id}:slack-state`, {});
  }
  private save() {
    this.context.store.write(`${this.context.account.id}:slack-state`, this.state);
  }
  start() {
    this.run();
  }
  private run() {
    if (this.stopped || this.pending) return;
    this.pending = this.poll()
      .catch((error: unknown) => {
        if (!this.stopped)
          this.context.status({
            connected: false,
            error: slackError(error),
          });
      })
      .finally(() => {
        this.pending = undefined;
        if (!this.stopped) {
          this.timer = setTimeout(() => this.run(), this.config.intervalMinutes * 60000);
          this.timer.unref();
        }
      });
  }
  async test() {
    const identity = await this.api.authenticate();
    if (identity.team !== this.config.team || identity.user !== this.config.user)
      throw new Error("Slack 账号身份改变");
  }
  private async user(id: string) {
    if (!this.users.has(id)) {
      const name = await this.api.user(id).catch(() => id);
      this.users.set(id, name);
      if (this.users.size > 1000) this.users.delete(this.users.keys().next().value as string);
    }
    return this.users.get(id) ?? id;
  }
  private async text(value: string) {
    let text = value;
    for (const match of value.matchAll(/<@([A-Z0-9]+)(?:\|[^>]+)?>/g))
      text = text.replaceAll(match[0], `@${await this.user(match[1] as string)}`);
    return text
      .replace(/<#([A-Z0-9]+)(?:\|([^>]+))?>/g, (_all, id, name) => `#${name || id}`)
      .replace(/<(https?:[^>|]+)(?:\|([^>]+))?>/g, (_all, url, label) => label || url)
      .replace(/<!([^>|^]+)(?:\^[^>|]+)?(?:\|([^>]+))?>/g, (_all, id, label) => `@${label || id}`)
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/[*_~`]/g, "");
  }
  private async receive(channel: string, message: SlackMessage, oldest: string, latest: string) {
    if (
      !message.ts ||
      Number(message.ts) <= Number(oldest) ||
      Number(message.ts) > Number(latest) ||
      message.type !== "message" ||
      ["message_changed", "message_deleted"].includes(message.subtype ?? "")
    )
      return;
    const excerpt = await this.text(message.text || "[非文本消息]");
    if (this.stopped) return;
    const sender = message.user ? await this.user(message.user) : (message.bot_id ?? "未知发件人");
    if (this.stopped) return;
    const url = await this.api.permalink(channel, message.ts);
    if (this.stopped) return;
    receiveMessage(this.context.ws, {
      source: "slack",
      account: this.context.account.label,
      channel,
      sender,
      time: new Date(Number(message.ts) * 1000).toISOString(),
      title: plain(excerpt, 80),
      excerpt,
      url,
      externalId: `${this.config.team}/${channel}/${message.ts}`,
    });
  }
  async poll() {
    await this.test();
    if (this.stopped) return;
    this.context.status({ connected: true, error: "" });
    let error = "";
    for (const channel of this.config.channels) {
      if (this.stopped) return;
      try {
        await this.pollChannel(channel);
      } catch (failure) {
        error = slackError(failure);
        if (apiCode(failure) === "invalid_cursor" && this.state[channel]?.scan) {
          this.state[channel].scan = undefined;
          this.save();
        }
      }
    }
    if (!this.stopped) this.context.status({ lastFetch: new Date().toISOString(), error });
  }
  private async pollChannel(channel: string) {
    if (this.stopped) return;
    const since = this.config.since[channel] ?? timestamp();
    const current = this.state[channel];
    const state = current && Number(current.since) >= Number(since) ? current : { since };
    this.state[channel] = state;
    state.scan ??= { latest: timestamp(), doneThreads: [] };
    const scan = state.scan;
    for (let pageIndex = 0; pageIndex < 10 && !this.stopped; pageIndex++) {
      const page = await this.api.history({ channel, latest: scan.latest, cursor: scan.cursor });
      for (const message of page.messages) {
        if (this.stopped) return;
        await this.receive(channel, message, state.since, scan.latest);
        if (
          !message.ts ||
          !message.reply_count ||
          Number(message.latest_reply ?? 0) <= Number(state.since) ||
          scan.doneThreads.includes(message.ts)
        )
          continue;
        let cursor = scan.reply?.root === message.ts ? scan.reply.cursor : undefined;
        do {
          const replies = await this.api.replies({
            channel,
            ts: message.ts,
            oldest: state.since,
            latest: scan.latest,
            cursor,
          });
          for (const reply of replies.messages) {
            if (this.stopped) return;
            await this.receive(channel, reply, state.since, scan.latest);
          }
          if (replies.cursor && replies.cursor === cursor) throw new Error("Slack 分页未前进");
          cursor = replies.cursor;
          scan.reply = cursor ? { root: message.ts, cursor } : undefined;
          this.save();
        } while (cursor && !this.stopped);
        scan.doneThreads.push(message.ts);
        this.save();
      }
      if (this.stopped) return;
      if (!page.cursor) {
        state.since = scan.latest;
        state.scan = undefined;
        this.save();
        break;
      }
      if (page.cursor === scan.cursor) throw new Error("Slack 分页未前进");
      scan.cursor = page.cursor;
      scan.doneThreads = [];
      this.save();
    }
  }
  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.pending;
  }
}
export function makeSlackProvider(factory = createTransport): CollectorProvider {
  return {
    async normalize(input) {
      if (typeof input.token !== "string" || !/^xoxp-[A-Za-z0-9-]+$/.test(input.token))
        throw new Error("请填写 Slack user token");
      const identity = await factory(input.token)
        .authenticate()
        .catch(() => {
          throw new Error("Slack 连接失败，请检查 user token 与网络");
        });
      return {
        token: input.token,
        ...identity,
        channels: [],
        since: {},
        intervalMinutes: Math.max(5, Math.min(15, Number(input.intervalMinutes) || 5)),
      };
    },
    identity: (settings) => `${settings.team}:${settings.user}`,
    create: (context) => new SlackCollector(context, factory),
    selection: (settings) => channelIds(settings.channels),
    select(settings, ids) {
      const channels = channelIds(ids);
      const previous = settings as unknown as SlackConfig;
      return {
        ...settings,
        channels,
        since: Object.fromEntries(
          channels.map((id) => [
            id,
            previous.channels.includes(id) ? (previous.since[id] ?? timestamp()) : timestamp(),
          ]),
        ),
      };
    },
  };
}
