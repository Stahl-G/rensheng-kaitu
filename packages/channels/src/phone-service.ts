import { KaituError, type Workspace } from "@kaitu/core";
import type { ChannelAnswer } from "./agent.js";
import { type ChannelName, channelName, channelNames } from "./channel.js";
import { configuredChannels } from "./index.js";
import { ChannelRuntime } from "./runtime.js";
import { channelStatus, credentials, pair, readState, saveCredentials } from "./state.js";
import { loginWeixin } from "./weixin/login.js";

type PhoneStatus = ReturnType<typeof channelStatus>[number] & {
  error?: string;
  code?: string;
  expires?: number;
  link?: string;
  verifying?: boolean;
  loggingIn?: boolean;
};

export class PhoneService {
  private runtimes = new Map<ChannelName, ChannelRuntime>();
  private errors = new Map<ChannelName, string>();
  private starting = new Map<ChannelName, Promise<void>>();
  private login?: AbortController;
  private link?: string;
  private verify?: (code: string) => void;
  private closed = false;

  constructor(
    private ws: Workspace,
    private answer?: ChannelAnswer,
  ) {}

  start(): void {
    this.closed = false;
    for (const name of channelNames) if (credentials(this.ws)[name]) this.connect(name);
  }

  private connect(name: ChannelName): void {
    if (this.closed || this.runtimes.has(name) || this.starting.has(name)) return;
    this.errors.delete(name);
    let runtime: ChannelRuntime;
    try {
      runtime = new ChannelRuntime(
        this.ws,
        configuredChannels(this.ws, name, (channel, error) => {
          this.errors.set(channel, error);
        }),
        (channel, error) => this.errors.set(channel, error),
        this.answer,
      );
    } catch {
      this.errors.set(name, "通道配置不正确，请检查后重试");
      return;
    }
    this.runtimes.set(name, runtime);
    const pending = runtime
      .start()
      .catch(() => {
        this.errors.set(name, "连接失败，请检查登录与通道配置后重试");
        this.runtimes.delete(name);
      })
      .finally(() => this.starting.delete(name));
    this.starting.set(name, pending);
  }

  private async disconnect(name: ChannelName): Promise<void> {
    await this.runtimes.get(name)?.stop();
    await this.starting.get(name);
    this.runtimes.delete(name);
  }

  async request(operation: string, input: Record<string, unknown>): Promise<PhoneStatus[]> {
    if (operation === "phone-list")
      return channelStatus(this.ws).map((item) => {
        const pairing = readState<{ code?: string; expires?: number }>(
          this.ws,
          `.kaitu/channels/${item.name}/pairing.json`,
          {},
        );
        return {
          ...item,
          running: item.running && !this.starting.has(item.name),
          error: this.errors.get(item.name),
          code: item.pairingPending ? pairing.code : undefined,
          expires: pairing.expires,
          ...(item.name === "weixin"
            ? { link: this.link, verifying: Boolean(this.verify), loggingIn: Boolean(this.login) }
            : {}),
        };
      });
    if (this.closed) throw new KaituError("手机通道正在停止，请稍后重试", "CHANNEL");
    if (!channelNames.includes(input.name as ChannelName))
      throw new KaituError("请选择有效的手机通道", "BAD_ARGS");
    const name = channelName(typeof input.name === "string" ? input.name : undefined);
    if (operation === "phone-login" && name === "weixin") {
      if (this.login) return this.request("phone-list", {});
      const abort = new AbortController();
      this.login = abort;
      this.link = undefined;
      this.errors.delete(name);
      void loginWeixin({
        signal: abort.signal,
        existing: credentials(this.ws).weixin,
        display: (link) => {
          this.link = link;
        },
        verify: () =>
          new Promise<string>((resolve, reject) => {
            this.verify = resolve;
            abort.signal.addEventListener("abort", () => reject(abort.signal.reason), { once: true });
          }),
      })
        .then(async (value) => {
          if (abort.signal.aborted) return;
          await this.disconnect(name);
          if (abort.signal.aborted) return;
          saveCredentials(this.ws, name, value);
          if (!channelStatus(this.ws).find((item) => item.name === name)?.paired) pair(this.ws, name);
          this.connect(name);
        })
        .catch(() => {
          if (!abort.signal.aborted) this.errors.set(name, "微信登录失败，请重新登录");
        })
        .finally(() => {
          this.login = undefined;
          this.link = undefined;
          this.verify = undefined;
        });
    } else if (
      operation === "phone-verify" &&
      this.verify &&
      typeof input.code === "string" &&
      input.code.trim()
    ) {
      this.verify(input.code.trim());
      this.verify = undefined;
    } else if (operation === "phone-cancel") {
      this.login?.abort();
    } else if (operation === "phone-setup" && name !== "weixin") {
      const field = (key: string) => {
        const value = input[key];
        if (typeof value !== "string" || !value.trim()) throw new KaituError("请填完整通道凭据", "BAD_ARGS");
        return value.trim();
      };
      if (name === "feishu" && !/^cli_[0-9a-fA-F]{16}$/.test(field("appId")))
        throw new KaituError("飞书 App ID 格式不正确", "BAD_ARGS");
      const value =
        name === "telegram"
          ? { token: field("token") }
          : { appId: field("appId"), appSecret: field("appSecret") };
      await this.disconnect(name);
      this.runtimes.delete(name);
      if (name === "telegram") saveCredentials(this.ws, name, value as { token: string });
      else saveCredentials(this.ws, name, value as { appId: string; appSecret: string });
      if (!channelStatus(this.ws).find((item) => item.name === name)?.paired) pair(this.ws, name);
      this.connect(name);
    } else if (operation === "phone-pair") {
      pair(this.ws, name);
      this.connect(name);
    } else if (operation === "phone-retry") {
      await this.disconnect(name);
      this.runtimes.delete(name);
      this.connect(name);
    } else throw new KaituError("手机通道操作无效", "BAD_ARGS");
    return this.request("phone-list", {});
  }

  async stop(): Promise<void> {
    this.closed = true;
    this.login?.abort();
    await Promise.allSettled([...this.runtimes.keys()].map((name) => this.disconnect(name)));
    this.runtimes.clear();
  }
}
