// Adapted from OpenClaw (MIT), Copyright (c) 2026 OpenClaw Foundation

import { KaituError, receiveBankNotification } from "@kaitu/core";
import { type FetchMessageObject, ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { receiveMessage } from "../inbox.js";
import type { Collector, CollectorContext, CollectorProvider } from "../types.js";
import { type ImapAccountConfig, resolveImapAccount } from "./config.js";
import { type MailAuthenticator, evaluateImapSender } from "./sender-gate.js";
import { ImapStateStore } from "./state.js";

const MAX_SOURCE_BYTES = 1_048_576;
export type ImapTransport = Pick<
  ImapFlow,
  "connect" | "close" | "mailboxOpen" | "fetch" | "fetchAll" | "capabilities" | "on" | "once"
>;
export type ImapFactory = (config: ImapAccountConfig) => ImapTransport;
const createTransport: ImapFactory = (account) =>
  new ImapFlow({
    host: account.host,
    port: account.port,
    secure: true,
    auth: account.accessToken
      ? { user: account.user, accessToken: account.accessToken }
      : { user: account.user, pass: account.password },
    logger: false,
    maxIdleTime: 4 * 60_000,
    socketTimeout: 3 * 60_000,
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    missingIdleCommand: "NOOP",
    disableAutoIdle: account.watch.mode === "interval",
    maxLiteralSize: MAX_SOURCE_BYTES + 8192,
    maxResponseSize: MAX_SOURCE_BYTES + 32768,
  });

export class ImapCollector implements Collector {
  private client?: ImapTransport;
  private state: ImapStateStore;
  private config: ImapAccountConfig;
  private stopped = false;
  private timer?: NodeJS.Timeout;
  private reconnect?: NodeJS.Timeout;
  private connecting?: Promise<void>;
  private sweeping?: Promise<void>;
  private again = false;
  private failures = 0;
  private authFailures = 0;
  constructor(
    private context: CollectorContext,
    private factory = createTransport,
    private authenticator?: MailAuthenticator,
  ) {
    this.config = resolveImapAccount(context.account.settings);
    this.state = new ImapStateStore(context.store, `${context.account.id}:imap-state`);
  }
  start() {
    this.beginConnect();
  }
  private beginConnect() {
    if (this.stopped || this.connecting || this.authFailures >= 3) return;
    this.connecting = this.connect()
      .catch((error: unknown) => {
        const auth =
          !!error &&
          typeof error === "object" &&
          "authenticationFailed" in error &&
          error.authenticationFailed;
        if (auth) this.authFailures++;
        this.context.status({
          connected: false,
          error: auth
            ? "密码或授权码错误，请重新填写；也请确认邮箱已开启 IMAP"
            : "网络连接失败，请检查网络及 IMAP 是否开启，将自动重试",
        });
        const client = this.client;
        this.client = undefined;
        client?.close();
      })
      .finally(() => {
        this.connecting = undefined;
        if (!this.client) this.scheduleReconnect();
      });
  }
  private scheduleReconnect() {
    if (this.stopped || this.reconnect || this.authFailures >= 3) return;
    clearInterval(this.timer);
    const delay = Math.min(1000 * 2 ** Math.min(this.failures++, 6), 60000);
    this.reconnect = setTimeout(
      () => {
        this.reconnect = undefined;
        this.beginConnect();
      },
      delay + (Math.random() * delay) / 4,
    );
    this.reconnect.unref();
  }
  private async connect() {
    await this.sweeping;
    if (this.stopped) return;
    const client = this.factory(this.config);
    this.client = client;
    client.on("error", () => {
      if (this.client !== client || this.stopped) return;
      this.context.status({ connected: false, error: "邮件连接中断，将自动重连" });
      client.close();
    });
    client.once("close", () => {
      if (this.client !== client || this.stopped) return;
      this.client = undefined;
      this.context.status({ connected: false, error: "邮件连接中断，将自动重连" });
      this.scheduleReconnect();
    });
    await client.connect();
    if (this.stopped || this.client !== client) {
      client.close();
      return;
    }
    const mailbox = await client.mailboxOpen(this.config.mailbox, { readOnly: true });
    if (this.stopped || this.client !== client) return;
    this.state.initialize(String(mailbox.uidValidity), mailbox.uidNext);
    this.failures = 0;
    this.authFailures = 0;
    this.context.status({ connected: true, error: "" });
    if (this.config.watch.mode !== "interval" && client.capabilities.has("IDLE"))
      client.on("exists", () => this.requestSweep());
    this.timer = setInterval(() => this.requestSweep(), this.config.watch.pollSeconds * 1000);
    this.timer.unref();
    this.requestSweep();
  }
  private requestSweep() {
    if (this.stopped || !this.client) return;
    if (this.sweeping) {
      this.again = true;
      return;
    }
    this.sweeping = this.sweep(this.client)
      .catch(() => {
        this.context.status({ error: "邮件拉取或保存失败，将重试" });
      })
      .finally(() => {
        this.sweeping = undefined;
        if (this.again) {
          this.again = false;
          this.requestSweep();
        }
      });
  }
  async sweep(client: ImapTransport) {
    const cursor = this.state.cursor;
    if (!cursor || this.stopped) return;
    this.context.status({ error: "" });
    const uids: number[] = [];
    for await (const message of client.fetch(`${cursor.lastSeenUid + 1}:*`, { uid: true }, { uid: true })) {
      if (message.uid > cursor.lastSeenUid) uids.push(message.uid);
    }
    uids.sort((a, b) => a - b);
    for (let offset = 0; offset < uids.length; offset += 20) {
      if (this.stopped) return;
      const batch = await client.fetchAll(
        uids.slice(offset, offset + 20),
        {
          uid: true,
          internalDate: true,
          size: true,
          source: { maxLength: MAX_SOURCE_BYTES },
        },
        { uid: true },
      );
      batch.sort((a, b) => a.uid - b.uid);
      for (const message of batch) {
        if (this.stopped || !(await this.process(message, cursor.uidValidity))) return;
        this.state.advance(message.uid);
      }
    }
    this.context.status({ lastFetch: new Date().toISOString() });
  }
  private async process(message: FetchMessageObject, validity: string): Promise<boolean> {
    if (!message.source || (message.size ?? 0) > MAX_SOURCE_BYTES) {
      this.context.status({ error: "有邮件超过 1 MiB 或缺少正文，已跳过" });
      return true;
    }
    const mail = await simpleParser(message.source, { skipImageLinks: true, skipTextToHtml: true });
    const date = message.internalDate instanceof Date ? message.internalDate : new Date();
    const verdict = await evaluateImapSender({
      mail,
      raw: message.source,
      internalDate: date,
      account: this.config,
      authenticator: this.authenticator,
    });
    if (!verdict.accepted) {
      if (verdict.transient && this.state.attempt(message.uid) < 3) return false;
      return true;
    }
    if (mail.messageId && this.state.seen(mail.messageId)) return true;
    if (this.stopped) return false;
    const scope = `${this.config.host}/${this.config.user}/${this.config.mailbox}`;
    const externalId = `${scope}/${mail.messageId ?? `${validity}:${message.uid}`}`;
    receiveMessage(this.context.ws, {
      source: "imap",
      account: this.context.account.label,
      channel: this.config.mailbox,
      sender: verdict.sender,
      time: date.toISOString(),
      title: mail.subject ?? (mail.text ?? "").split("\n")[0] ?? "邮件",
      excerpt: mail.text ?? "",
      externalId,
      url: mail.messageId
        ? `message://${encodeURIComponent(mail.messageId)}`
        : `imap://${encodeURIComponent(this.config.user)}@${this.config.host}/${encodeURIComponent(this.config.mailbox)};UIDVALIDITY=${validity}/;UID=${message.uid}`,
      authentication: verdict.reason,
    });
    // 只认 DMARC 通过的银行动账通知，识别出的交易进本机待核对，不直接记账。
    if ("strength" in verdict && verdict.strength === "verified" && mail.text)
      receiveBankNotification(this.context.ws, {
        sender: verdict.sender,
        subject: mail.subject ?? "",
        text: mail.text,
        time: date.toISOString(),
      });
    if (mail.messageId) this.state.remember(mail.messageId);
    return true;
  }
  async test() {
    const client = this.factory(this.config);
    client.on("error", () => {});
    try {
      await client.connect();
      await client.mailboxOpen(this.config.mailbox, { readOnly: true });
    } catch (error) {
      const auth =
        !!error && typeof error === "object" && "authenticationFailed" in error && error.authenticationFailed;
      throw new KaituError(
        auth
          ? "密码或授权码错误，请重新填写；也请确认邮箱已开启 IMAP"
          : "无法连接邮箱，请检查网络、服务器和 IMAP 是否开启",
        "CHANNEL",
      );
    } finally {
      client.close();
    }
  }
  async stop() {
    this.stopped = true;
    clearInterval(this.timer);
    clearTimeout(this.reconnect);
    this.client?.close();
    await this.connecting;
    await this.sweeping;
  }
}
export const imapProvider: CollectorProvider = {
  normalize: (input) => ({ ...resolveImapAccount(input) }),
  identity: (input) => {
    const config = resolveImapAccount(input);
    return `${config.host}:${config.port}:${config.user.toLowerCase()}`;
  },
  create: (context) => new ImapCollector(context),
};
