import { useCallback, useEffect, useState } from "react";
import type { ChannelRequest } from "./ChannelSettings.js";
import css from "./Prototype.module.css";

interface Phone {
  name: string;
  configured: boolean;
  paired: boolean;
  running: boolean;
  error?: string;
  code?: string;
  expires?: number;
  link?: string;
  verifying?: boolean;
  loggingIn?: boolean;
}
const names: Record<string, string> = { weixin: "微信", qq: "QQ", telegram: "Telegram", feishu: "飞书" };
const guides: Record<string, [string, string]> = {
  telegram: ["在 BotFather 创建机器人，把它的 Token 填在下面。", "https://t.me/BotFather"],
  qq: ["在 QQ 开放平台创建机器人，开启私聊并把自己加入测试名单。", "https://q.qq.com/"],
  feishu: [
    "在飞书开放平台创建应用，启用机器人和消息接收事件，选择长连接并发布给自己。",
    "https://open.feishu.cn/",
  ],
};

export function PhoneChannels({ request }: { request: ChannelRequest }) {
  const [phones, setPhones] = useState<Phone[]>([]);
  const [editing, setEditing] = useState("");
  const [token, setToken] = useState("");
  const [appId, setAppId] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState("");
  const refresh = useCallback(async () => {
    try {
      setPhones((await request("phone-list")) as Phone[]);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [request]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => clearInterval(timer);
  }, [refresh]);
  const run = async (operation: string, name: string, extra = {}) => {
    setBusy(true);
    setError("");
    setReceipt("");
    try {
      setPhones((await request(operation, { name, ...extra })) as Phone[]);
      if (operation === "phone-setup") {
        setEditing("");
        setToken("");
        setAppId("");
        setSecret("");
      }
      setCode("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={css.sec}>
      <h2 className={css.eyebrow}>在手机上和开图聊</h2>
      <p className={css.small}>
        电脑开着时可用，只回复与你配对的账号。消息和回答会经过所选平台，由问问当前连接的模型回答；它只读写开图资料，能搜索和读网页。
      </p>
      {error && (
        <p role="alert" className={css.small}>
          {error}
        </p>
      )}
      {receipt && <output className={css.small}>{receipt}</output>}
      {!phones.length && <p className={css.small}>还没有手机通道，连接后就能从手机发消息。</p>}
      <div className={css["sub-form"]}>
        {phones.map((phone) => (
          <div key={phone.name} className={`${css.card} ${css.sum} ${css["sub-form"]}`}>
            <b>
              {names[phone.name]} ·{" "}
              {phone.error
                ? "出错"
                : !phone.configured
                  ? "未配置"
                  : !phone.paired
                    ? "待配对"
                    : phone.running
                      ? "已连接"
                      : "连接中"}
            </b>
            {phone.error && <p className={css.small}>{phone.error}</p>}
            {phone.code && (
              <p className={css.small}>
                在手机上向机器人发送配对码：<strong>{phone.code}</strong>（
                {new Date(phone.expires ?? 0).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}{" "}
                前有效）
              </p>
            )}
            {phone.link && (
              <>
                <a
                  className={css.link}
                  href={phone.link}
                  target="_blank"
                  rel="noreferrer"
                  style={{ overflowWrap: "anywhere" }}
                >
                  打开微信登录链接 ↗
                </a>
                <button
                  type="button"
                  className={css.link}
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(phone.link ?? "")
                      .then(() => setReceipt("登录链接已复制"))
                      .catch(() => setError("复制失败，请手动复制登录链接"))
                  }
                >
                  复制链接
                </button>
              </>
            )}
            {phone.verifying && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void run("phone-verify", phone.name, { code });
                }}
              >
                <input
                  aria-label="微信验证码"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  autoComplete="off"
                />
                <button type="submit" className={css.btn} disabled={busy || !code.trim()}>
                  确认验证码
                </button>
              </form>
            )}
            {phone.name === "weixin" ? (
              <button
                type="button"
                className={css.btn}
                disabled={busy}
                onClick={() => void run(phone.loggingIn ? "phone-cancel" : "phone-login", phone.name)}
              >
                {phone.loggingIn ? "取消登录" : phone.configured ? "重新登录微信" : "登录微信"}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className={css.link}
                  onClick={() => {
                    setEditing(editing === phone.name ? "" : phone.name);
                    setToken("");
                    setAppId("");
                    setSecret("");
                  }}
                >
                  {phone.configured ? "更换连接" : `连接${names[phone.name]}`}
                </button>
                {editing === phone.name && (
                  <form
                    className={css["sub-form"]}
                    onSubmit={(event) => {
                      event.preventDefault();
                      void run("phone-setup", phone.name, { token, appId, appSecret: secret });
                    }}
                  >
                    <p className={css.small}>{guides[phone.name]?.[0]}</p>
                    <a className={css.link} href={guides[phone.name]?.[1]} target="_blank" rel="noreferrer">
                      去官方平台 ↗
                    </a>
                    {phone.name === "telegram" ? (
                      <input
                        aria-label="机器人 Token"
                        type="password"
                        autoComplete="off"
                        placeholder="机器人 Token"
                        value={token}
                        onChange={(event) => setToken(event.target.value)}
                        required
                      />
                    ) : (
                      <>
                        <input
                          aria-label="App ID"
                          placeholder="App ID"
                          value={appId}
                          onChange={(event) => setAppId(event.target.value)}
                          required
                        />
                        <input
                          aria-label="App Secret"
                          type="password"
                          autoComplete="off"
                          placeholder="App Secret"
                          value={secret}
                          onChange={(event) => setSecret(event.target.value)}
                          required
                        />
                      </>
                    )}
                    <button type="submit" className={`${css.btn} ${css["btn-primary"]}`} disabled={busy}>
                      保存并连接
                    </button>
                  </form>
                )}
              </>
            )}
            {phone.configured && !phone.paired && (
              <button
                type="button"
                className={css.link}
                disabled={busy}
                onClick={() => void run("phone-pair", phone.name)}
              >
                生成新配对码
              </button>
            )}
            {phone.configured && phone.error && (
              <button
                type="button"
                className={css.link}
                disabled={busy}
                onClick={() => void run("phone-retry", phone.name)}
              >
                重试连接
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
