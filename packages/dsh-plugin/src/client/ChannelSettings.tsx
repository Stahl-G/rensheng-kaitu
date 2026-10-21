import { useCallback, useEffect, useRef, useState } from "react";
import css from "./Prototype.module.css";
import { useLocale, useT } from "./i18n.js";

export type ChannelRequest = (operation: string, input?: Record<string, unknown>) => Promise<unknown>;
export interface ChannelAccount {
  id: string;
  kind: string;
  label: string;
  connected: boolean;
  lastFetch?: string;
  error?: string;
  selected: string[];
}
export interface ChannelState {
  accounts: ChannelAccount[];
  gmailConfigured: boolean;
  oauthError?: string;
}
const slackManifest = [
  "display_information:",
  "  name: Kaitu Inbox",
  "  description: Read selected conversations into your local Kaitu inbox",
  "oauth_config:",
  "  scopes:",
  "    user:",
  ...["channels:history", "groups:history", "im:history", "mpim:history", "users:read"].map(
    (scope) => `      - ${scope}`,
  ),
  "settings:",
  "  org_deploy_enabled: false",
  "  socket_mode_enabled: false",
  "  token_rotation_enabled: false",
].join("\n");
const slackManifestUrl = `https://api.slack.com/apps?new_app=1&manifest_yaml=${encodeURIComponent(slackManifest)}`;
const channels = [
  ["gmail", "Gmail", "G"],
  ["imap", "其他邮箱", "邮"],
  ["slack", "Slack", "S"],
  ["feishu", "飞书", "飞"],
];
const providers: Record<string, { name: string; host: string; steps: string[]; url: string }> = {
  icloud: {
    name: "iCloud",
    host: "imap.mail.me.com",
    steps: ["登录 Apple 账户，打开「登录和安全」", "选择「App 专用密码」，生成一个密码后填在下面"],
    url: "https://support.apple.com/102654",
  },
  qq: {
    name: "QQ 邮箱",
    host: "imap.qq.com",
    steps: ["打开网页版邮箱 → 设置 → 账号与安全", "开启 IMAP，按提示生成授权码"],
    url: "https://service.mail.qq.com/detail/0/75",
  },
  "163": {
    name: "163 邮箱",
    host: "imap.163.com",
    steps: ["打开网页版邮箱 → 设置 → POP3/SMTP/IMAP", "开启 IMAP，按提示获取授权码"],
    url: "https://mail.163.com/",
  },
  outlook: {
    name: "Outlook",
    host: "outlook.office365.com",
    steps: [
      "Outlook 需要 Microsoft OAuth 登录，这一版暂不支持",
      "可以先连接其他邮箱，或由熟悉配置的人展开高级设置",
    ],
    url: "https://support.microsoft.com/en-us/outlook/pop-imap-and-smtp-settings-for-outlook-com",
  },
  gmail: {
    name: "Gmail（应用专用密码）",
    host: "imap.gmail.com",
    steps: ["Google 账户 → 安全 → 开启两步验证", "生成应用专用密码，将它填在下面"],
    url: "https://support.google.com/mail/answer/185833",
  },
  custom: {
    name: "自定义 IMAP",
    host: "",
    steps: ["在邮箱服务商处开启 IMAP，取得授权码或应用专用密码", "展开高级设置，填写服务商提供的服务器地址"],
    url: "",
  },
};
const CHANNEL_EN: Record<string, string> = {
  其他邮箱: "Other email",
  飞书: "Feishu",
  "QQ 邮箱": "QQ Mail",
  "163 邮箱": "163 Mail",
  "Gmail（应用专用密码）": "Gmail (app password)",
  "自定义 IMAP": "Custom IMAP",
  "登录 Apple 账户，打开「登录和安全」": "Sign in to your Apple Account and open Sign-In and Security",
  "选择「App 专用密码」，生成一个密码后填在下面":
    "Choose App-Specific Passwords, generate a password and enter it below",
  "打开网页版邮箱 → 设置 → 账号与安全": "Open webmail → Settings → Account and security",
  "开启 IMAP，按提示生成授权码": "Enable IMAP and follow the instructions to generate an authorization code",
  "打开网页版邮箱 → 设置 → POP3/SMTP/IMAP": "Open webmail → Settings → POP3/SMTP/IMAP",
  "开启 IMAP，按提示获取授权码": "Enable IMAP and follow the instructions to obtain an authorization code",
  "Outlook 需要 Microsoft OAuth 登录，这一版暂不支持":
    "Outlook requires Microsoft OAuth, which this version does not support",
  "可以先连接其他邮箱，或由熟悉配置的人展开高级设置":
    "Connect another mailbox or use Advanced if you already have the required settings",
  "Google 账户 → 安全 → 开启两步验证": "Google Account → Security → Turn on 2-Step Verification",
  "生成应用专用密码，将它填在下面": "Generate an app password and enter it below",
  "在邮箱服务商处开启 IMAP，取得授权码或应用专用密码":
    "Enable IMAP with your email provider and obtain an authorization code or app password",
  "展开高级设置，填写服务商提供的服务器地址": "Open Advanced and enter the server address from your provider",
  "无法读取连接状态，请稍后重试": "Couldn’t load connection status. Try again later.",
  "连接未完成，请重试": "Couldn’t connect. Try again.",
  "已打开系统浏览器，请完成 Google 登录": "Complete Google sign-in in the browser",
  "已断开，本机凭据已删除": "Disconnected; local credentials deleted",
  连接测试通过: "Connection test passed",
  已保存连接设置: "Connection settings saved",
  "连接未完成，请检查网络后重试": "Couldn’t connect. Check your network and try again.",
  邮件与聊天: "Email and chat",
  "只读接收摘录 · 凭据存在这台电脑": "Read-only excerpts · Credentials stay on this computer",
  "正在读取状态…": "Loading status…",
  "未连接 · 上次拉取：尚无": "Not connected · No fetch yet",
  尚无: "None yet",
  测试: "Test",
  断开: "Disconnect",
  选择要收的频道: "Choose channels to receive",
  "这个版本还没开通 Google 登录，可以先用应用专用密码":
    "Google sign-in is unavailable in this version. Use an app password instead.",
  连接其他账号: "Connect another account",
  连接: "Connect",
  "摘录进入开图资料，随资料设置同步到你的云盘；整理时会发送给你选择的 AI。":
    "Excerpts enter your Kaitu workspace and follow its cloud sync settings. Organizing sends them to the AI you choose.",
  关闭: "Close",
  "用 Google 账号登录": "Sign in with Google",
  "等待浏览器完成授权…连接结果会自动更新":
    "Finish authorization in the browser. Connection status updates automatically.",
  "从 Slack 会话详情底部复制频道 ID，或从浏览器地址复制私信 ID。只接收所选频道的新消息。":
    "Copy the channel ID from Slack conversation details or the DM ID from its browser URL. Only new messages from selected conversations are collected.",
  "新增频道 ID（多个用空格分开）": "Add channel IDs (separate with spaces)",
  保存采集范围: "Save collection scope",
  使用应用专用密码: "Use an app password",
  填写连接信息: "Enter connection details",
  邮箱服务商: "Email provider",
  "查看官方说明 ↗": "Official instructions ↗",
  邮箱: "Email",
  "授权码 / 应用专用密码": "Authorization code / app password",
  高级: "Advanced",
  "IMAP 服务器": "IMAP server",
  端口: "Port",
  文件夹: "Folder",
  "IMAP OAuth access token（需自行取得）": "IMAP OAuth access token (bring your own)",
  "在 Slack 点击一键导入，选择工作区，核对只读权限后创建并安装应用。":
    "Import the Slack app, choose a workspace, review the read-only permissions, then create and install it.",
  "在 OAuth & Permissions 复制 User OAuth Token。": "Copy the User OAuth Token from OAuth & Permissions.",
  "连接后选择要收的频道。": "After connecting, choose the conversations to receive.",
  "一键导入 Slack 应用 ↗": "Import Slack app ↗",
  "查看 manifest ↗": "View manifest ↗",
  账号名称: "Account name",
  "创建企业自建应用，启用机器人。": "Create an internal app and enable its bot.",
  "开启只读消息权限，使用长连接订阅 im.message.receive_v1，发布应用版本。":
    "Enable read-only message permissions, subscribe to im.message.receive_v1 over a persistent connection, and publish the app version.",
  "填入凭据，把机器人加入要接收的群，或直接私聊机器人。":
    "Enter its credentials, then add the bot to a group or message it directly.",
  "打开飞书开放平台 ↗": "Open Feishu developer platform ↗",
  "只能接收机器人所在群与发给机器人的私信；群聊只有 @权限时，需要 @机器人。":
    "Receives messages from groups containing the bot and direct messages to it. If group access is mention-only, mention the bot.",
  "账号名称（可选）": "Account name (optional)",
  "正在连接…": "Connecting…",
};
export function ChannelSettings({
  request,
  focus = false,
  onFocused,
}: { request: ChannelRequest; focus?: boolean; onFocused?: () => void }) {
  const t = useT();
  const locale = useLocale();
  const caption = (value: string) => t(value, CHANNEL_EN[value] ?? value);
  const [settings, setSettings] = useState<ChannelState>();
  const [dialog, setDialog] = useState<string | null>(null);
  const [selection, setSelection] = useState<ChannelAccount>();
  const [preset, setPreset] = useState("icloud");
  const [advanced, setAdvanced] = useState(false);
  const [receipt, setReceipt] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const section = useRef<HTMLElement>(null);
  const modal = useRef<HTMLDialogElement>(null);
  const refresh = useCallback(async () => {
    const next = (await request("list")) as ChannelState;
    setSettings(next);
    if (next.oauthError) {
      setError(next.oauthError);
      setWaiting(false);
    }
    if (next.accounts.some((a) => a.kind === "gmail")) setWaiting(false);
  }, [request]);
  useEffect(() => {
    void refresh().catch(() =>
      setError(t("无法读取连接状态，请稍后重试", "Couldn’t load connection status. Try again later.")),
    );
    const timer = setInterval(() => void refresh().catch(() => {}), 3000);
    return () => clearInterval(timer);
  }, [refresh, t]);
  useEffect(() => {
    if (focus) {
      section.current?.scrollIntoView({ block: "start" });
      onFocused?.();
    }
  }, [focus, onFocused]);
  useEffect(() => {
    if (dialog) modal.current?.showModal();
  }, [dialog]);
  const run = async (operation: string, input: Record<string, unknown> = {}) => {
    setBusy(true);
    setReceipt("");
    setError("");
    try {
      const result = (await request(operation, input)) as { ok?: boolean; error?: string };
      await refresh();
      if (result.ok === false) {
        setError(result.error ?? caption("连接未完成，请重试"));
        return false;
      }
      setReceipt(
        operation === "gmail-login"
          ? caption("已打开系统浏览器，请完成 Google 登录")
          : operation === "disconnect"
            ? caption("已断开，本机凭据已删除")
            : operation === "test"
              ? caption("连接测试通过")
              : caption("已保存连接设置"),
      );
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : caption("连接未完成，请检查网络后重试"));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const connect = (kind: string) => {
    setDialog(kind);
    setSelection(undefined);
    setAdvanced(false);
    setPreset(kind === "gmail" ? "gmail" : "icloud");
    setError("");
    setReceipt("");
  };
  const field = (label: string, name: string, secret = false, required = true, placeholder = "") => (
    <label>
      {caption(label)}
      <input
        name={name}
        type={secret ? "password" : "text"}
        required={required}
        autoComplete={secret ? "new-password" : "off"}
        placeholder={placeholder}
      />
    </label>
  );
  const selectedProvider = providers[preset];
  return (
    <section ref={section} className={css.sec} aria-labelledby="channel-heading">
      <div className={css["sec-head"]}>
        <h2 id="channel-heading" className={css.eyebrow}>
          {caption("邮件与聊天")}
        </h2>
        <span className={css.small}>{caption("只读接收摘录 · 凭据存在这台电脑")}</span>
      </div>
      <div className={css.channelGrid}>
        {channels.map(([kind, name, logo]) => {
          const accounts =
            settings?.accounts.filter(
              (a) =>
                (a.kind === kind && !(kind === "imap" && a.label.toLowerCase().endsWith("@gmail.com"))) ||
                (kind === "gmail" && a.kind === "imap" && a.label.toLowerCase().endsWith("@gmail.com")),
            ) ?? [];
          return (
            <article className={`${css.card} ${css.sum}`} key={kind}>
              <div className={css.channelTitle}>
                <span className={css.channelLogo}>
                  {t(logo ?? "", kind === "imap" ? "@" : kind === "feishu" ? "F" : (logo ?? ""))}
                </span>
                <b>{caption(name ?? "")}</b>
              </div>
              {!settings ? (
                <p className={css.small}>{caption("正在读取状态…")}</p>
              ) : !accounts.length ? (
                <p className={css.small}>{caption("未连接 · 上次拉取：尚无")}</p>
              ) : (
                accounts.map((account) => (
                  <div className={css.channelAccount} key={account.id}>
                    <p className={account.error ? css.channelError : css.small}>
                      {account.error
                        ? t(`出错 · ${account.error}`, `Error · ${account.error}`)
                        : account.connected
                          ? t(`已连接 · ${account.label}`, `Connected · ${account.label}`)
                          : t(`未连接 · ${account.label}`, `Not connected · ${account.label}`)}
                    </p>
                    <p className={css.small}>
                      {t("上次拉取：", "Last fetch: ")}
                      {account.lastFetch
                        ? new Date(account.lastFetch).toLocaleString(locale)
                        : caption("尚无")}
                    </p>
                    <div className={css.channelActions}>
                      <button
                        className={`${css.btn} ${css["btn-quiet"]}`}
                        type="button"
                        disabled={busy}
                        onClick={() => void run("test", { id: account.id })}
                      >
                        {caption("测试")}
                      </button>
                      <button
                        className={css.link}
                        type="button"
                        disabled={busy}
                        onClick={() => void run("disconnect", { id: account.id })}
                      >
                        {caption("断开")}
                      </button>
                      {kind === "slack" && (
                        <button
                          className={css.link}
                          type="button"
                          onClick={() => {
                            setSelection(account);
                            setDialog("select");
                          }}
                        >
                          {caption("选择要收的频道")}
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
              {kind === "gmail" && settings && !settings.gmailConfigured && (
                <p className={css.small}>{caption("这个版本还没开通 Google 登录，可以先用应用专用密码")}</p>
              )}
              <button
                className={`${css.btn} ${css["btn-quiet"]}`}
                type="button"
                disabled={busy || !settings}
                onClick={() => connect(kind ?? "")}
              >
                {accounts.length ? caption("连接其他账号") : caption("连接")}
              </button>
            </article>
          );
        })}
      </div>
      <p className={css.note}>
        {caption("摘录进入开图资料，随资料设置同步到你的云盘；整理时会发送给你选择的 AI。")}
      </p>
      {receipt && (
        <output className={css.small} aria-live="polite">
          {receipt}
        </output>
      )}
      {error && !dialog && (
        <p className={css.error} role="alert">
          {error}
        </p>
      )}
      {dialog && (
        <dialog
          ref={modal}
          className={`${css.dialog} ${css.channelDialog}`}
          onCancel={() => setDialog(null)}
          onClose={() => setDialog(null)}
          aria-labelledby="channel-dialog-title"
        >
          <div className={css["sec-head"]}>
            <h2 id="channel-dialog-title">
              {dialog === "select"
                ? caption("选择要收的频道")
                : t(
                    `连接${channels.find(([kind]) => kind === dialog)?.[1] ?? ""}`,
                    `Connect ${caption(channels.find(([kind]) => kind === dialog)?.[1] ?? "")}`,
                  )}
            </h2>
            <button className={css.link} type="button" onClick={() => modal.current?.close()}>
              {caption("关闭")}
            </button>
          </div>
          {dialog === "gmail" && (
            <>
              <button
                className={`${css.btn} ${css["btn-primary"]}`}
                type="button"
                disabled={busy || waiting || !settings?.gmailConfigured}
                onClick={async () => {
                  if (await run("gmail-login")) setWaiting(true);
                }}
              >
                {caption("用 Google 账号登录")}
              </button>
              <p className={css.small}>
                {t("只读收取邮件，保留已读状态。", "Read-only email collection, preserving read status.")}
              </p>
              {waiting && (
                <output className={css.small}>{caption("等待浏览器完成授权…连接结果会自动更新")}</output>
              )}
              {settings?.accounts
                .filter((a) => a.kind === "gmail")
                .map((a) => (
                  <p className={css.small} key={a.id}>
                    {t("已接入", "Connected")} {a.label}
                    {a.error ? ` · ${a.error}` : ""}
                  </p>
                ))}
              {!settings?.gmailConfigured && (
                <p className={css.small}>{caption("这个版本还没开通 Google 登录，可以先用应用专用密码")}</p>
              )}
            </>
          )}
          {dialog === "select" ? (
            <form
              className={css.channelForm}
              onSubmit={async (event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                const ids = [
                  ...data.getAll("channel"),
                  ...String(data.get("extra") ?? "").split(/[\s,，]+/),
                ].filter(Boolean);
                if (await run("select", { id: selection?.id, ids })) modal.current?.close();
              }}
            >
              <p className={css.small}>
                {caption(
                  "从 Slack 会话详情底部复制频道 ID，或从浏览器地址复制私信 ID。只接收所选频道的新消息。",
                )}
              </p>
              {selection?.selected.map((id) => (
                <label className={css.channelCheck} key={id}>
                  <input type="checkbox" name="channel" value={id} defaultChecked />
                  {id}
                </label>
              ))}
              {field("新增频道 ID（多个用空格分开）", "extra", false, false, "C… / G… / D…")}
              <button className={`${css.btn} ${css["btn-primary"]}`} disabled={busy} type="submit">
                {caption("保存采集范围")}
              </button>
            </form>
          ) : (
            <details open={dialog !== "gmail"} className={css.channelFallback}>
              <summary className={css.link}>
                {dialog === "gmail" ? caption("使用应用专用密码") : caption("填写连接信息")}
              </summary>
              <form
                className={css.channelForm}
                onSubmit={async (event) => {
                  event.preventDefault();
                  const data: Record<string, unknown> = {};
                  new FormData(event.currentTarget).forEach((value, key) => {
                    data[key] = value;
                  });
                  if (data.port) data.port = Number(data.port);
                  else data.port = undefined;
                  if (!data.host) data.host = undefined;
                  const kind = dialog === "gmail" ? "imap" : dialog;
                  if (
                    await run("add", {
                      ...data,
                      kind,
                      preset,
                      label: data.user || data.label || data.appId || caption("飞书"),
                    })
                  )
                    modal.current?.close();
                }}
              >
                {dialog === "imap" || dialog === "gmail" ? (
                  <>
                    {dialog === "imap" && (
                      <label>
                        {caption("邮箱服务商")}
                        <select
                          value={preset}
                          onChange={(event) => {
                            setPreset(event.target.value);
                            setAdvanced(false);
                          }}
                        >
                          {Object.entries(providers)
                            .filter(([id]) => id !== "gmail")
                            .map(([id, item]) => (
                              <option value={id} key={id}>
                                {caption(item.name)}
                              </option>
                            ))}
                        </select>
                      </label>
                    )}
                    <ol className={css.channelSteps}>
                      {selectedProvider?.steps.map((step) => (
                        <li key={step}>{caption(step)}</li>
                      ))}
                    </ol>
                    {selectedProvider?.url && (
                      <a className={css.link} href={selectedProvider.url} target="_blank" rel="noreferrer">
                        {caption("查看官方说明 ↗")}
                      </a>
                    )}
                    {field("邮箱", "user", false, true, "you@example.com")}
                    {preset !== "outlook" && field("授权码 / 应用专用密码", "password", true)}
                    <details key={preset} onToggle={(event) => setAdvanced(event.currentTarget.open)}>
                      <summary className={css.link}>{caption("高级")}</summary>
                      <div className={css.channelForm}>
                        {field("IMAP 服务器", "host", false, preset === "custom", selectedProvider?.host)}
                        <label>
                          {caption("端口")}
                          <input type="number" name="port" min={1} max={65535} placeholder="993" />
                        </label>
                        {field("文件夹", "mailbox", false, false, "INBOX")}
                        {preset === "outlook" &&
                          field("IMAP OAuth access token（需自行取得）", "accessToken", true)}
                      </div>
                    </details>
                    <p className={css.small}>
                      {t(
                        "首次连接从新邮件开始。只读收取，保留已读状态。",
                        "Starts with new messages. Read-only collection preserves read status.",
                      )}
                    </p>
                  </>
                ) : dialog === "slack" ? (
                  <>
                    <ol className={css.channelSteps}>
                      <li>{caption("在 Slack 点击一键导入，选择工作区，核对只读权限后创建并安装应用。")}</li>
                      <li>{caption("在 OAuth & Permissions 复制 User OAuth Token。")}</li>
                      <li>{caption("连接后选择要收的频道。")}</li>
                    </ol>
                    <div className={css.channelActions}>
                      <a className={css.link} href={slackManifestUrl} target="_blank" rel="noreferrer">
                        {caption("一键导入 Slack 应用 ↗")}
                      </a>
                      <a
                        className={css.link}
                        href="https://github.com/Stahl-G/rensheng-kaitu/blob/main/docs/slack-app-manifest.json"
                        target="_blank"
                        rel="noreferrer"
                      >
                        {caption("查看 manifest ↗")}
                      </a>
                    </div>
                    {field("账号名称", "label")}
                    {field("User OAuth Token", "token", true, true, "xoxp-…")}
                  </>
                ) : (
                  <>
                    <ol className={css.channelSteps}>
                      <li>{caption("创建企业自建应用，启用机器人。")}</li>
                      <li>
                        {caption("开启只读消息权限，使用长连接订阅 im.message.receive_v1，发布应用版本。")}
                      </li>
                      <li>{caption("填入凭据，把机器人加入要接收的群，或直接私聊机器人。")}</li>
                    </ol>
                    <a
                      className={css.link}
                      href="https://open.feishu.cn/app"
                      target="_blank"
                      rel="noreferrer"
                    >
                      {caption("打开飞书开放平台 ↗")}
                    </a>
                    <p className={css.small}>
                      {caption("只能接收机器人所在群与发给机器人的私信；群聊只有 @权限时，需要 @机器人。")}
                    </p>
                    {field("账号名称（可选）", "label", false, false)}
                    {field("App ID", "appId", false, true, "cli_…")}
                    {field("App Secret", "appSecret", true)}
                  </>
                )}
                <button
                  className={`${css.btn} ${css["btn-primary"]}`}
                  disabled={busy || (preset === "outlook" && !advanced)}
                  type="submit"
                >
                  {busy ? caption("正在连接…") : caption("连接")}
                </button>
              </form>
            </details>
          )}
          {receipt && (
            <output className={css.small} aria-live="polite">
              {receipt}
            </output>
          )}
          {error && (
            <p className={css.error} role="alert">
              {error}
            </p>
          )}
        </dialog>
      )}
    </section>
  );
}
