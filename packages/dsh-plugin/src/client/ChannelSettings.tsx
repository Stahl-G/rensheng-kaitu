import { useCallback, useEffect, useState } from "react";

export type ChannelRequest = (operation: string, input?: Record<string, unknown>) => Promise<unknown>;
interface Account {
  id: string;
  kind: string;
  label: string;
  connected: boolean;
  lastFetch?: string;
  error?: string;
  selected: string[];
}
interface Settings {
  kinds: string[];
  presets: { id: string; name: string; host: string; help: string }[];
  accounts: Account[];
}
export function ChannelSettings({ request }: { request: ChannelRequest }) {
  const [settings, setSettings] = useState<Settings>();
  const [kind, setKind] = useState("imap");
  const [preset, setPreset] = useState("gmail");
  const [receipt, setReceipt] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => setSettings((await request("list")) as Settings), [request]);
  useEffect(() => {
    void refresh().catch(() => setReceipt("无法读取采集设置"));
    const timer = setInterval(() => void refresh().catch(() => {}), 10000);
    return () => clearInterval(timer);
  }, [refresh]);
  const run = async (operation: string, input: Record<string, unknown>) => {
    setBusy(true);
    setReceipt("");
    try {
      const result = (await request(operation, input)) as { ok?: boolean; error?: string };
      setReceipt(result.ok === false ? (result.error ?? "连接失败") : "已完成");
      await refresh();
      return result.ok !== false;
    } catch {
      setReceipt("操作未完成，请检查填写内容、凭据和网络");
      return false;
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-label="邮件与聊天收件箱">
      <h2>邮件与聊天收件箱</h2>
      <p>只读接收摘录和链接，之后由收件箱整理为待确认建议。凭据只存在这台电脑。</p>
      {settings?.accounts.map((account) => (
        <article key={account.id}>
          <h3>
            {account.label} · {account.kind}
          </h3>
          <p>
            {account.connected ? "已连接" : "未连接"} · 上次拉取：
            {account.lastFetch ? new Date(account.lastFetch).toLocaleString() : "尚无"}
          </p>
          {account.error && <p>{account.error}</p>}
          <button type="button" disabled={busy} onClick={() => void run("test", { id: account.id })}>
            测试连接
          </button>
          <button type="button" disabled={busy} onClick={() => void run("disconnect", { id: account.id })}>
            断开并删除本机凭据
          </button>
          {account.kind === "slack" && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                const ids = [...data.getAll("channel"), String(data.get("extra") ?? "").trim()].filter(
                  Boolean,
                );
                void run("select", { id: account.id, ids });
              }}
            >
              <p>只采集勾选的会话。Slack 会话详情底部可复制频道 ID；私信可从浏览器链接取得 D 开头的 ID。</p>
              {account.selected.map((id) => (
                <label key={id}>
                  <input key={`${id}-selected`} type="checkbox" name="channel" value={id} defaultChecked />
                  {id}
                </label>
              ))}
              <label>
                新增会话 ID
                <input name="extra" placeholder="C… / G… / D…" />
              </label>
              <button disabled={busy} type="submit">
                保存采集范围
              </button>
            </form>
          )}
        </article>
      ))}
      <details>
        <summary>添加只读账号</summary>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data: Record<string, string> = {};
            new FormData(form).forEach((value, key) => {
              if (typeof value === "string") data[key] = value;
            });
            if (await run("add", { ...data, kind })) form.reset();
          }}
        >
          <label>
            来源
            <select value={kind} onChange={(event) => setKind(event.target.value)}>
              {settings?.kinds.map((value) => (
                <option key={value} value={value}>
                  {value === "imap" ? "IMAP 邮件" : value === "feishu" ? "飞书" : "Slack"}
                </option>
              ))}
            </select>
          </label>
          <label>
            账号名称
            <input name="label" required maxLength={80} autoComplete="off" />
          </label>
          {kind === "imap" && (
            <>
              <label>
                邮箱服务
                <select name="preset" value={preset} onChange={(event) => setPreset(event.target.value)}>
                  {settings?.presets.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                  <option value="custom">其他 IMAP</option>
                </select>
              </label>
              <p>{settings?.presets.find((item) => item.id === preset)?.help}</p>
              <label>
                服务器（可覆盖预置）
                <input name="host" placeholder={settings?.presets.find((item) => item.id === preset)?.host} />
              </label>
              <label>
                邮箱账号
                <input name="user" required autoComplete="off" />
              </label>
              <label>
                邮箱文件夹
                <input name="mailbox" placeholder="INBOX" />
              </label>
              <label>
                应用专用密码 / 授权码
                <input type="password" name="password" autoComplete="new-password" />
              </label>
              <label>
                OAuth2 access token（Outlook 必填）
                <input type="password" name="accessToken" autoComplete="new-password" />
              </label>
              <p>首次连接只建立当前位置，之后采集新邮件。大于 1 MiB 的邮件暂不采集。</p>
            </>
          )}
          {kind === "slack" && (
            <>
              <label>
                User OAuth Token
                <input
                  type="password"
                  name="token"
                  required
                  autoComplete="new-password"
                  placeholder="xoxp-…"
                />
              </label>
              <p>
                创建内部应用并导入 docs/slack-app-manifest.json，安装后使用 User OAuth
                Token。添加后选择会话，每 5 分钟拉取。
              </p>
            </>
          )}
          {kind === "feishu" && (
            <>
              <label>
                App ID
                <input name="appId" required autoComplete="off" />
              </label>
              <label>
                App Secret
                <input type="password" name="appSecret" required autoComplete="new-password" />
              </label>
              <p>
                企业自建应用需启用机器人和长连接事件
                im.message.receive_v1。仅能收到机器人所在群及发给机器人的私信，无法读取个人其他聊天。
              </p>
            </>
          )}
          <button disabled={busy} type="submit">
            添加并开始采集
          </button>
        </form>
      </details>
      {receipt && <output>{receipt}</output>}
    </section>
  );
}
