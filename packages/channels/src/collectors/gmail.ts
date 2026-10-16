import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { KaituError, isBankNotificationMail, receiveBankNotification } from "@kaitu/core";
import { plain, receiveMessage } from "./inbox.js";
import { type LocalStore, hash } from "./store.js";
import type { Collector, CollectorContext, CollectorProvider } from "./types.js";

const scope = "https://www.googleapis.com/auth/gmail.readonly";
export interface GmailOptions {
  clientId?: string;
  clientSecret?: string;
  authUrl?: string;
  tokenUrl?: string;
  revokeUrl?: string;
  apiUrl?: string;
  openBrowser?: (url: string) => Promise<void>;
}
interface Tokens {
  access_token: string;
  refresh_token: string;
  expires: number;
}
interface GmailMessage {
  id: string;
  internalDate: string;
  snippet?: string;
  payload?: { headers?: { name: string; value: string }[] };
}
class GmailFailure extends Error {
  constructor(readonly status: number) {
    super(
      status === 401 || status === 400
        ? "授权过期，请重新登录 Google"
        : "Google 连接失败，请检查网络或稍后重试",
    );
  }
}
async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new GmailFailure(response.status);
  return response.json() as Promise<T>;
}
export function makeGmailProvider(options: GmailOptions = {}): CollectorProvider {
  const clientId = options.clientId ?? process.env.KAITU_GOOGLE_CLIENT_ID;
  const clientSecret = options.clientSecret ?? process.env.KAITU_GOOGLE_CLIENT_SECRET;
  const tokenUrl = options.tokenUrl ?? "https://oauth2.googleapis.com/token";
  const apiUrl = options.apiUrl ?? "https://gmail.googleapis.com/gmail/v1/users/me";
  const openBrowser =
    options.openBrowser ??
    ((url: string) =>
      new Promise<void>((resolve, reject) => {
        const command =
          process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer.exe" : "xdg-open";
        execFile(command, [url], (error) =>
          error ? reject(new KaituError("无法打开系统浏览器", "CHANNEL")) : resolve(),
        );
      }));
  const credentials = () => ({
    client_id: clientId ?? "",
    ...(clientSecret ? { client_secret: clientSecret } : {}),
  });
  async function exchange(body: Record<string, string>): Promise<Tokens> {
    const result = await json<{ access_token: string; refresh_token?: string; expires_in: number }>(
      tokenUrl,
      {
        method: "POST",
        body: new URLSearchParams({ ...credentials(), ...body }),
      },
    );
    if (!result.access_token) throw new GmailFailure(401);
    return {
      access_token: result.access_token,
      refresh_token: result.refresh_token ?? body.refresh_token ?? "",
      expires: Date.now() + result.expires_in * 1000,
    };
  }
  async function access(store: LocalStore, key: string) {
    let tokens = store.read<Tokens | null>(key, null);
    if (!tokens) throw new GmailFailure(401);
    if (tokens.expires < Date.now() + 60000) {
      tokens = await exchange({ grant_type: "refresh_token", refresh_token: tokens.refresh_token });
      store.write(key, tokens);
    }
    return tokens.access_token;
  }
  async function api<T>(store: LocalStore, key: string, path: string): Promise<T> {
    return json<T>(`${apiUrl}/${path}`, { headers: { Authorization: `Bearer ${await access(store, key)}` } });
  }
  class GmailCollector implements Collector {
    private timer?: NodeJS.Timeout;
    private pending?: Promise<void>;
    private stopped = false;
    constructor(private context: CollectorContext) {}
    start() {
      this.poll();
      this.timer = setInterval(() => this.poll(), 60000);
      this.timer.unref();
    }
    private poll() {
      if (this.stopped || this.pending) return;
      this.pending = this.test()
        .catch((error: unknown) => {
          this.context.status({
            connected: false,
            error: error instanceof KaituError ? error.message : "邮件拉取失败，请检查网络后重试",
          });
        })
        .finally(() => {
          this.pending = undefined;
        });
    }
    async test() {
      try {
        await this.sweep();
      } catch (error) {
        throw new KaituError(
          error instanceof GmailFailure ? error.message : "邮件拉取失败，请检查网络后重试",
          "CHANNEL",
        );
      }
    }
    private async sweep() {
      const { store, account, ws } = this.context;
      const tokenKey = String(account.settings.tokenKey);
      const stateKey = `${account.id}:gmail-state`;
      const cursor = store.read<{ historyId?: string }>(stateKey, {});
      const profile = await api<{ historyId: string }>(store, tokenKey, "profile");
      const ids = new Set<string>();
      let page = "";
      let full = !cursor.historyId;
      do {
        if (this.stopped) return;
        if (!full) {
          try {
            const history = await api<{
              nextPageToken?: string;
              history?: { messagesAdded?: { message: { id: string } }[] }[];
            }>(
              store,
              tokenKey,
              `history?startHistoryId=${encodeURIComponent(cursor.historyId ?? "")}&historyTypes=messageAdded&labelId=INBOX${page ? `&pageToken=${encodeURIComponent(page)}` : ""}`,
            );
            for (const entry of history.history ?? [])
              for (const item of entry.messagesAdded ?? []) ids.add(item.message.id);
            page = history.nextPageToken ?? "";
          } catch (error) {
            if (!(error instanceof GmailFailure) || error.status !== 404) throw error;
            full = true;
            page = "";
          }
        }
        if (full) {
          const list = await api<{ nextPageToken?: string; messages?: { id: string }[] }>(
            store,
            tokenKey,
            `messages?labelIds=INBOX&maxResults=100${page ? `&pageToken=${encodeURIComponent(page)}` : ""}`,
          );
          for (const item of list.messages ?? []) ids.add(item.id);
          page = list.nextPageToken ?? "";
        }
      } while (page);
      for (const id of ids) {
        if (this.stopped) return;
        let message: GmailMessage;
        try {
          message = await api<GmailMessage>(
            store,
            tokenKey,
            `messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Authentication-Results`,
          );
        } catch (error) {
          if (error instanceof GmailFailure && error.status === 404) continue;
          throw error;
        }
        if (this.stopped) return;
        const headers = message.payload?.headers ?? [];
        const header = (name: string) =>
          headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
        const time = new Date(Number(message.internalDate)).toISOString();
        const sender = header("From");
        const subject = header("Subject");
        const excerpt = plain(message.snippet ?? "", 280);
        const verified = headers
          .filter((h) => h.name.toLowerCase() === "authentication-results")
          .some((h) => /^mx\.google\.com\s*;/i.test(h.value) && /;\s*dmarc=pass\b/i.test(h.value));
        const bankMail = { sender, subject, text: excerpt, time };
        // 银行动账通知只进本机待核对（SEC-07），不写可同步的普通收件箱。
        if (isBankNotificationMail(bankMail)) {
          if (verified) receiveBankNotification(ws, bankMail);
          else this.context.status({ error: "有银行通知未通过身份核验，请在邮箱核对" });
          continue;
        }
        receiveMessage(ws, {
          source: "gmail",
          account: account.label,
          channel: "INBOX",
          sender,
          time,
          title: subject,
          excerpt,
          externalId: `${account.settings.email}/${id}`,
          url: `https://mail.google.com/mail/u/0/#inbox/${encodeURIComponent(id)}`,
          authentication: verified ? "Google Authentication-Results: DMARC pass" : "未验证",
        });
      }
      store.write(stateKey, { historyId: profile.historyId });
      this.context.status({ connected: true, error: "", lastFetch: new Date().toISOString() });
    }
    async stop() {
      this.stopped = true;
      clearInterval(this.timer);
      await this.pending;
    }
  }
  return {
    configured: !!clientId,
    normalize() {
      throw new KaituError("请使用 Google 登录", "CHANNEL");
    },
    identity: (settings) => String(settings.email),
    create: (context) => new GmailCollector(context),
    async authorize(store, complete, fail) {
      if (!clientId) throw new KaituError("这个版本还没开通 Google 登录，可以先用应用专用密码", "CHANNEL");
      const state = randomBytes(32).toString("base64url");
      const verifier = randomBytes(48).toString("base64url");
      let redirect = "";
      let used = false;
      let timer: NodeJS.Timeout;
      const server = createServer((request, response) => {
        const url = new URL(request.url ?? "/", redirect);
        if (url.pathname !== "/oauth/callback" || url.searchParams.get("state") !== state || used) {
          response.writeHead(400).end("Invalid callback");
          return;
        }
        used = true;
        clearTimeout(timer);
        response
          .writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" })
          .end("已收到 Google 授权，请回到开图查看连接结果。");
        server.close();
        void (async () => {
          if (!url.searchParams.get("code") || url.searchParams.has("error")) throw new GmailFailure(401);
          const tokens = await exchange({
            grant_type: "authorization_code",
            code: url.searchParams.get("code") ?? "",
            redirect_uri: redirect,
            code_verifier: verifier,
          });
          if (!tokens.refresh_token) throw new GmailFailure(401);
          const profile = await json<{ emailAddress: string }>(`${apiUrl}/profile`, {
            headers: { Authorization: `Bearer ${tokens.access_token}` },
          });
          const tokenKey = `gmail-token:${hash(profile.emailAddress)}:${randomBytes(16).toString("hex")}`;
          store.write(tokenKey, tokens);
          try {
            await complete({ email: profile.emailAddress, tokenKey }, profile.emailAddress);
          } catch (error) {
            store.remove(tokenKey);
            throw error;
          }
        })().catch(() => fail("Google 授权未完成，请重新登录或检查网络"));
      });
      await new Promise<void>((resolve, reject) => {
        server.once("error", () => reject(new KaituError("无法启动本机 Google 登录回调", "CHANNEL")));
        server.listen(0, "127.0.0.1", resolve);
      });
      const address = server.address();
      if (!address || typeof address === "string") throw new GmailFailure(500);
      redirect = `http://127.0.0.1:${address.port}/oauth/callback`;
      timer = setTimeout(() => {
        server.close();
        fail("Google 登录超时，请重新登录");
      }, 180000);
      timer.unref();
      const url = new URL(options.authUrl ?? "https://accounts.google.com/o/oauth2/v2/auth");
      url.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirect,
        response_type: "code",
        scope,
        access_type: "offline",
        prompt: "consent",
        state,
        code_challenge: createHash("sha256").update(verifier).digest("base64url"),
        code_challenge_method: "S256",
      }).toString();
      try {
        await openBrowser(url.toString());
      } catch (error) {
        clearTimeout(timer);
        server.close();
        throw error;
      }
      return () => {
        clearTimeout(timer);
        server.close();
      };
    },
    async disconnect(context) {
      const key = String(context.account.settings.tokenKey);
      const tokens = context.store.read<Tokens | null>(key, null);
      try {
        if (tokens) {
          const response = await fetch(options.revokeUrl ?? "https://oauth2.googleapis.com/revoke", {
            method: "POST",
            body: new URLSearchParams({ token: tokens.refresh_token || tokens.access_token }),
            signal: AbortSignal.timeout(20000),
          });
          if (!response.ok && response.status !== 400) throw new GmailFailure(response.status);
        }
      } finally {
        context.store.remove(key);
      }
    },
  };
}
