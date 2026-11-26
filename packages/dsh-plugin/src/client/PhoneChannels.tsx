import { useCallback, useEffect, useState } from "react";
import type { ChannelRequest } from "./ChannelSettings.js";
import css from "./Prototype.module.css";
import { useT } from "./i18n.js";

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
const names: Record<string, readonly [string, string]> = {
  weixin: ["微信", "WeChat"],
  qq: ["QQ", "QQ"],
  telegram: ["Telegram", "Telegram"],
  feishu: ["飞书", "Feishu"],
};
const guides: Record<string, readonly [string, string, string]> = {
  telegram: [
    "在 BotFather 创建机器人，把它的 Token 填在下面。",
    "Create a bot in BotFather and paste its token below.",
    "https://t.me/BotFather",
  ],
  qq: [
    "在 QQ 开放平台创建机器人，开启私聊并把自己加入测试名单。",
    "Create a bot on the QQ platform, enable direct messages and add yourself to the test list.",
    "https://q.qq.com/",
  ],
  feishu: [
    "在飞书开放平台创建应用，启用机器人和消息接收事件，选择长连接并发布给自己。",
    "Create an app on Feishu Open Platform, enable the bot and message event over a persistent connection, then publish it.",
    "https://open.feishu.cn/",
  ],
};

export function PhoneChannels({ request }: { request: ChannelRequest }) {
  const t = useT();
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
  const label = (id: string) => {
    const pair = names[id];
    return pair ? t(pair[0], pair[1]) : id;
  };
  return (
    <section className={css.sec}>
      <h2 className={css.eyebrow}>{t("在手机上和开图聊", "Chat with Kaitu on your phone")}</h2>
      {error && (
        <p role="alert" className={css.small}>
          {error}
        </p>
      )}
      {receipt && <output className={css.small}>{receipt}</output>}
      {!phones.length && (
        <p className={css.small}>
          {t("还没有手机通道，连接后就能从手机发消息。", "No phone channel connected yet.")}
        </p>
      )}
      <div className={css["sub-form"]}>
        {phones.map((phone) => {
          const isEditing = editing === phone.name;
          const guide = guides[phone.name];
          return (
            <div key={phone.name} className={`${css.card} ${css.sum} ${css["sub-form"]}`}>
              <b>
                {label(phone.name)} ·{" "}
                {phone.error
                  ? t("出错", "Error")
                  : !phone.configured
                    ? t("未配置", "Not configured")
                    : !phone.paired
                      ? t("待配对", "Pairing needed")
                      : phone.running
                        ? t("已连接", "Connected")
                        : t("连接中", "Connecting")}
              </b>
              {phone.error && <p className={css.small}>{phone.error}</p>}
              {phone.code && (
                <p className={css.small}>
                  {t("在手机上向机器人发送配对码：", "Send this pairing code to the bot on your phone: ")}
                  <strong>{phone.code}</strong>（
                  {t(
                    `${new Date(phone.expires ?? 0).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} 前有效`,
                    `valid until ${new Date(phone.expires ?? 0).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
                  )}
                  ）
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
                    {t("打开微信登录链接 ↗", "Open WeChat sign-in link ↗")}
                  </a>
                  <button
                    type="button"
                    className={css.link}
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(phone.link ?? "")
                        .then(() => setReceipt(t("登录链接已复制", "Sign-in link copied")))
                        .catch(() =>
                          setError(
                            t("复制失败，请手动复制登录链接", "Could not copy. Copy the link manually."),
                          ),
                        )
                    }
                  >
                    {t("复制链接", "Copy link")}
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
                    aria-label={t("微信验证码", "WeChat verification code")}
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    autoComplete="off"
                  />
                  <button type="submit" className={css.btn} disabled={busy || !code.trim()}>
                    {t("确认验证码", "Confirm code")}
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
                  {phone.loggingIn
                    ? t("取消登录", "Cancel sign-in")
                    : phone.configured
                      ? t("重新登录微信", "Sign in to WeChat again")
                      : t("登录微信", "Sign in to WeChat")}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className={css.link}
                    aria-expanded={isEditing}
                    onClick={() => {
                      setEditing(isEditing ? "" : phone.name);
                      setToken("");
                      setAppId("");
                      setSecret("");
                    }}
                  >
                    {isEditing
                      ? t("收起", "Close")
                      : phone.configured
                        ? t("更换连接", "Change connection")
                        : t(`连接${label(phone.name)}`, `Connect ${label(phone.name)}`)}
                  </button>
                  {isEditing && (
                    <form
                      className={css["sub-form"]}
                      onKeyDown={(event) => {
                        if (event.key === "Escape" && !event.nativeEvent.isComposing && !busy) {
                          event.preventDefault();
                          setEditing("");
                        }
                      }}
                      onSubmit={(event) => {
                        event.preventDefault();
                        void run("phone-setup", phone.name, { token, appId, appSecret: secret });
                      }}
                    >
                      {guide && <p className={css.small}>{t(guide[0], guide[1])}</p>}
                      {guide && (
                        <a className={css.link} href={guide[2]} target="_blank" rel="noreferrer">
                          {t("去官方平台 ↗", "Open platform ↗")}
                        </a>
                      )}
                      {phone.name === "telegram" ? (
                        <input
                          aria-label={t("机器人 Token", "Bot token")}
                          type="password"
                          autoComplete="off"
                          placeholder={t("机器人 Token", "Bot token")}
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
                        {t("保存并连接", "Save and connect")}
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
                  {t("生成新配对码", "New pairing code")}
                </button>
              )}
              {phone.configured && phone.error && (
                <button
                  type="button"
                  className={css.link}
                  disabled={busy}
                  onClick={() => void run("phone-retry", phone.name)}
                >
                  {t("重试连接", "Retry connection")}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
