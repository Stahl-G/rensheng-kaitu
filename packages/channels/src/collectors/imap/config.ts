// Adapted from OpenClaw (MIT), Copyright (c) 2026 OpenClaw Foundation
export type IdentifierAuthentication = "mutable" | "unverified" | "asserted" | "verified";
export interface ImapAccountConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  accessToken?: string;
  mailbox: string;
  watch: { mode: "auto" | "idle" | "interval"; pollSeconds: number };
  allowedSenders: string[];
  senderAuth: {
    min: IdentifierAuthentication;
    trustedAuthservIds: string[];
    acceptTrustedAuthservId: boolean;
  };
  addressTokens: Array<{ token: string; senders: string[] }>;
}
export const imapPresets = [
  {
    id: "gmail",
    name: "Gmail",
    host: "imap.gmail.com",
    help: "Google 账户 → 安全 → 两步验证 → 应用专用密码",
  },
  { id: "icloud", name: "iCloud", host: "imap.mail.me.com", help: "Apple 账户 → 登录和安全 → App 专用密码" },
  {
    id: "outlook",
    name: "Outlook",
    host: "outlook.office365.com",
    help: "Microsoft 要求 OAuth2；请填入 IMAP access token，应用密码不可用",
  },
  {
    id: "qq",
    name: "QQ 邮箱",
    host: "imap.qq.com",
    help: "网页版邮箱 → 设置 → 账号与安全 → 开启 IMAP → 生成授权码",
  },
  {
    id: "163",
    name: "163 邮箱",
    host: "imap.163.com",
    help: "网页版邮箱 → 设置 → POP3/SMTP/IMAP → 开启 IMAP → 获取授权码",
  },
];
export function filterStringEntries(input: unknown): string[] {
  return Array.isArray(input) ? input.filter((v): v is string => typeof v === "string" && !!v.trim()) : [];
}
export function resolveImapAccount(input: Record<string, unknown>): ImapAccountConfig {
  const preset = imapPresets.find((p) => p.id === input.preset);
  const host = input.host || preset?.host;
  const { user, password, accessToken } = input;
  if (
    typeof host !== "string" ||
    !/^[a-zA-Z0-9.-]+$/.test(host) ||
    typeof user !== "string" ||
    !user.trim() ||
    user.length > 320 ||
    !((typeof password === "string" && password) || (typeof accessToken === "string" && accessToken))
  ) {
    throw new Error("请填写服务器、邮箱账号与应用专用密码或 OAuth2 token");
  }
  const port = input.port ?? 993;
  if (!Number.isInteger(port) || Number(port) < 1 || Number(port) > 65535) throw new Error("IMAP 端口无效");
  const watch = input.watch as Partial<ImapAccountConfig["watch"]> | undefined;
  return {
    host: host.toLowerCase(),
    user: user.trim(),
    password: typeof password === "string" ? password : "",
    ...(typeof accessToken === "string" && accessToken ? { accessToken } : {}),
    port: Number(port),
    secure: true,
    mailbox: typeof input.mailbox === "string" && input.mailbox.trim() ? input.mailbox.trim() : "INBOX",
    watch: {
      mode: watch?.mode === "interval" ? "interval" : "auto",
      pollSeconds: Math.max(15, Math.min(900, Number(watch?.pollSeconds) || 60)),
    },
    allowedSenders: filterStringEntries(input.allowedSenders),
    senderAuth: { min: "unverified", trustedAuthservIds: [], acceptTrustedAuthservId: false },
    addressTokens: [],
  };
}
