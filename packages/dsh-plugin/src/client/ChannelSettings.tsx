import { useCallback, useEffect, useRef, useState } from "react";
import css from "./Prototype.module.css";

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
export function ChannelSettings({
  request,
  focus = false,
  onFocused,
}: { request: ChannelRequest; focus?: boolean; onFocused?: () => void }) {
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
    void refresh().catch(() => setError("无法读取连接状态，请稍后重试"));
    const timer = setInterval(() => void refresh().catch(() => {}), 3000);
    return () => clearInterval(timer);
  }, [refresh]);
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
        setError(result.error ?? "连接未完成，请重试");
        return false;
      }
      setReceipt(
        operation === "gmail-login"
          ? "已打开系统浏览器，请完成 Google 登录"
          : operation === "disconnect"
            ? "已断开，本机凭据已删除"
            : operation === "test"
              ? "连接测试通过"
              : "已保存连接设置",
      );
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "连接未完成，请检查网络后重试");
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
      {label}
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
          邮件与聊天
        </h2>
        <span className={css.small}>只读接收摘录 · 凭据存在这台电脑</span>
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
                <span className={css.channelLogo}>{logo}</span>
                <b>{name}</b>
              </div>
              {!settings ? (
                <p className={css.small}>正在读取状态…</p>
              ) : !accounts.length ? (
                <p className={css.small}>未连接 · 上次拉取：尚无</p>
              ) : (
                accounts.map((account) => (
                  <div className={css.channelAccount} key={account.id}>
                    <p className={account.error ? css.channelError : css.small}>
                      {account.error
                        ? `出错 · ${account.error}`
                        : account.connected
                          ? `已连接 · ${account.label}`
                          : `未连接 · ${account.label}`}
                    </p>
                    <p className={css.small}>
                      上次拉取：{account.lastFetch ? new Date(account.lastFetch).toLocaleString() : "尚无"}
                    </p>
                    <div className={css.channelActions}>
                      <button
                        className={`${css.btn} ${css["btn-quiet"]}`}
                        type="button"
                        disabled={busy}
                        onClick={() => void run("test", { id: account.id })}
                      >
                        测试
                      </button>
                      <button
                        className={css.link}
                        type="button"
                        disabled={busy}
                        onClick={() => void run("disconnect", { id: account.id })}
                      >
                        断开
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
                          选择要收的频道
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
              {kind === "gmail" && settings && !settings.gmailConfigured && (
                <p className={css.small}>这个版本还没开通 Google 登录，可以先用应用专用密码</p>
              )}
              <button
                className={`${css.btn} ${css["btn-quiet"]}`}
                type="button"
                disabled={busy || !settings}
                onClick={() => connect(kind ?? "")}
              >
                {accounts.length ? "连接其他账号" : "连接"}
              </button>
            </article>
          );
        })}
      </div>
      <p className={css.note}>摘录进入开图资料，随资料设置同步到你的云盘；整理时会发送给你选择的 AI。</p>
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
                ? "选择要收的频道"
                : `连接${channels.find(([kind]) => kind === dialog)?.[1] ?? ""}`}
            </h2>
            <button className={css.link} type="button" onClick={() => modal.current?.close()}>
              关闭
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
                用 Google 账号登录
              </button>
              <p className={css.small}>只读取邮件，不会发送、删除或标记已读</p>
              {waiting && <output className={css.small}>等待浏览器完成授权…连接结果会自动更新</output>}
              {settings?.accounts
                .filter((a) => a.kind === "gmail")
                .map((a) => (
                  <p className={css.small} key={a.id}>
                    已接入 {a.label}
                    {a.error ? ` · ${a.error}` : ""}
                  </p>
                ))}
              {!settings?.gmailConfigured && (
                <p className={css.small}>这个版本还没开通 Google 登录，可以先用应用专用密码</p>
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
                从 Slack 会话详情底部复制频道 ID，或从浏览器地址复制私信 ID。只接收所选频道的新消息。
              </p>
              {selection?.selected.map((id) => (
                <label className={css.channelCheck} key={id}>
                  <input type="checkbox" name="channel" value={id} defaultChecked />
                  {id}
                </label>
              ))}
              {field("新增频道 ID（多个用空格分开）", "extra", false, false, "C… / G… / D…")}
              <button className={`${css.btn} ${css["btn-primary"]}`} disabled={busy} type="submit">
                保存采集范围
              </button>
            </form>
          ) : (
            <details open={dialog !== "gmail"} className={css.channelFallback}>
              <summary className={css.link}>
                {dialog === "gmail" ? "使用应用专用密码" : "填写连接信息"}
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
                      label: data.user || data.label || data.appId || "飞书",
                    })
                  )
                    modal.current?.close();
                }}
              >
                {dialog === "imap" || dialog === "gmail" ? (
                  <>
                    {dialog === "imap" && (
                      <label>
                        邮箱服务商
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
                                {item.name}
                              </option>
                            ))}
                        </select>
                      </label>
                    )}
                    <ol className={css.channelSteps}>
                      {selectedProvider?.steps.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ol>
                    {selectedProvider?.url && (
                      <a className={css.link} href={selectedProvider.url} target="_blank" rel="noreferrer">
                        查看官方说明 ↗
                      </a>
                    )}
                    {field("邮箱", "user", false, true, "you@example.com")}
                    {preset !== "outlook" && field("授权码 / 应用专用密码", "password", true)}
                    <details key={preset} onToggle={(event) => setAdvanced(event.currentTarget.open)}>
                      <summary className={css.link}>高级</summary>
                      <div className={css.channelForm}>
                        {field("IMAP 服务器", "host", false, preset === "custom", selectedProvider?.host)}
                        <label>
                          端口
                          <input type="number" name="port" min={1} max={65535} placeholder="993" />
                        </label>
                        {field("文件夹", "mailbox", false, false, "INBOX")}
                        {preset === "outlook" &&
                          field("IMAP OAuth access token（需自行取得）", "accessToken", true)}
                      </div>
                    </details>
                    <p className={css.small}>首次连接从新邮件开始。只读收取，不改变已读状态。</p>
                  </>
                ) : dialog === "slack" ? (
                  <>
                    <ol className={css.channelSteps}>
                      <li>在 Slack 点击一键导入，选择工作区，核对只读权限后创建并安装应用。</li>
                      <li>在 OAuth &amp; Permissions 复制 User OAuth Token。</li>
                      <li>连接后选择要收的频道。</li>
                    </ol>
                    <div className={css.channelActions}>
                      <a className={css.link} href={slackManifestUrl} target="_blank" rel="noreferrer">
                        一键导入 Slack 应用 ↗
                      </a>
                      <a
                        className={css.link}
                        href="https://github.com/Stahl-G/rensheng-kaitu/blob/main/docs/slack-app-manifest.json"
                        target="_blank"
                        rel="noreferrer"
                      >
                        查看 manifest ↗
                      </a>
                    </div>
                    {field("账号名称", "label")}
                    {field("User OAuth Token", "token", true, true, "xoxp-…")}
                  </>
                ) : (
                  <>
                    <ol className={css.channelSteps}>
                      <li>创建企业自建应用，启用机器人。</li>
                      <li>开启只读消息权限，使用长连接订阅 im.message.receive_v1，发布应用版本。</li>
                      <li>填入凭据，把机器人加入要接收的群，或直接私聊机器人。</li>
                    </ol>
                    <a
                      className={css.link}
                      href="https://open.feishu.cn/app"
                      target="_blank"
                      rel="noreferrer"
                    >
                      打开飞书开放平台 ↗
                    </a>
                    <p className={css.small}>
                      只能接收机器人所在群与发给机器人的私信；群聊只有 @权限时，需要 @机器人。
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
                  {busy ? "正在连接…" : "连接"}
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
