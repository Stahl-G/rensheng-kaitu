import type { CalendarPushSettings, HandoverPack, SyncProvider } from "@kaitu/core";
import { useCallback, useEffect, useState } from "react";
import type { AutomationKey, AutomationSettings, SettingsData } from "../types.js";
import { CalendarPushResult, type CalendarPushServices } from "./CalendarPush.js";
import { type ChannelRequest, ChannelSettings } from "./ChannelSettings.js";
import { type FeatureUpdateRequest, FeatureUpdates } from "./FeatureUpdates.js";
import { HandoverPanel } from "./Handover.js";
import { MePage, type MePageProps } from "./MePage.js";
import { PhoneChannels } from "./PhoneChannels.js";
import { PrivacyPage } from "./Privacy.js";
import css from "./Prototype.module.css";
import { aiHandover } from "./connections.js";
import { type Locale, useT } from "./i18n.js";

export interface PersonalServices extends CalendarPushServices {
  desktopUpdate?: FeatureUpdateRequest;
  phoneChannels?: boolean;
  loadSettings: () => Promise<SettingsData>;
  configureAutomation: (
    tasks: Partial<Record<AutomationKey, boolean>>,
    times?: Partial<Record<AutomationKey, string>>,
  ) => Promise<AutomationSettings>;
  exportWorkspace: () => Promise<{ name: string; base64: string }>;
  restoreVersion: (oid: string) => Promise<unknown>;
  moveStorage: (path: string, drive: boolean, provider?: SyncProvider) => Promise<unknown>;
  pickStorageFolder: () => Promise<string | null>;
  loadHandover: (locale?: Locale) => Promise<HandoverPack>;
}
const PROVIDERS: { id: SyncProvider; zh: string; en: string; key?: "icloud" | "drive" | "nutstore" }[] = [
  { id: "local", zh: "这台电脑（不同步）", en: "This computer (no sync)" },
  { id: "icloud", zh: "iCloud 云盘", en: "iCloud Drive", key: "icloud" },
  { id: "nutstore", zh: "坚果云", en: "Nutstore (坚果云)", key: "nutstore" },
  { id: "google-drive", zh: "Google Drive", en: "Google Drive", key: "drive" },
  { id: "folder", zh: "其他同步盘的文件夹", en: "A folder another sync app syncs" },
];
export type PersonalView = "profile" | "connections" | "settings";
export function PersonalPages(
  props: PersonalServices &
    MePageProps & {
      channelSettings?: ChannelRequest;
      channelFocus?: boolean;
      onChannelFocused?: () => void;
      view: PersonalView;
      navigate: (view: PersonalView) => void;
      manageAi: () => void;
      refreshWorkspace: () => Promise<void>;
      subscribe?: (refresh: () => void) => () => void;
      onHandoverAnswer: (answer: string) => Promise<void>;
      locale: Locale;
      followSystem: boolean;
      onLocale: (locale: Locale | null) => Promise<void>;
    },
) {
  const t = useT();
  const [calendarPush, setCalendarPush] = useState<CalendarPushSettings | null>(null);
  const [data, setData] = useState<SettingsData | null>(null);
  const [searchProvider, setSearchProvider] = useState("perplexity");
  const [searchKey, setSearchKey] = useState("");
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState(false);
  const [restore, setRestore] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [pickingFolder, setPickingFolder] = useState(false);
  const [path, setPath] = useState("");
  const [provider, setProvider] = useState<SyncProvider>("local");
  const [privacy, setPrivacy] = useState(false);
  const reading = props.view === "settings" && privacy;
  const refresh = useCallback(async () => {
    try {
      const [settings, calendar] = await Promise.all([props.loadSettings(), props.loadCalendarPush()]);
      setData(settings);
      setCalendarPush(calendar);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [props.loadSettings, props.loadCalendarPush]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => props.subscribe?.(() => void refresh()), [props.subscribe, refresh]);
  const run = async (operation: () => Promise<unknown>, message = t("已保存", "Saved")) => {
    setBusy(true);
    setError("");
    setReceipt("");
    try {
      await operation();
      setReceipt(message);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  const saveAutomation = (
    tasks: Partial<Record<AutomationKey, boolean>>,
    times?: Partial<Record<AutomationKey, string>>,
  ) =>
    run(async () => {
      const automation = await props.configureAutomation(tasks, times);
      setData((current) => (current ? { ...current, automation } : current));
    });
  const search = data?.ai?.search;
  const selectedSearch = search?.providers.find((item) => item.id === searchProvider);
  const saveSearch = (remove = false) =>
    run(
      async () => {
        const response = await fetch("/api/product/askSearchConfigure", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Kaitu": "1" },
          body: JSON.stringify([
            {
              provider: searchProvider,
              ...(remove ? { remove: true } : searchKey ? { apiKey: searchKey } : {}),
            },
          ]),
        });
        const value = await response.json();
        if (!response.ok) throw new Error(value.error ?? "搜索设置未保存，请重试");
        setSearchKey("");
        window.dispatchEvent(new Event("kaitu-ai-changed"));
      },
      remove ? "已移除 Key，下一次搜索生效" : "搜索设置已保存，下一次搜索生效",
    );
  const title =
    props.view === "profile"
      ? t("个人档案", "Profile")
      : props.view === "connections"
        ? t("AI 与连接", "AI & connections")
        : t("设置", "Settings");
  const storageName = (id: SyncProvider | undefined) => {
    const item = PROVIDERS.find((entry) => entry.id === id) ?? PROVIDERS[0];
    return t(item?.zh ?? "", item?.en ?? "");
  };
  const suggestion = (id: SyncProvider) => {
    const key = PROVIDERS.find((entry) => entry.id === id)?.key;
    const folder = key ? data?.storage.suggested?.[key] : null;
    return folder ? `${folder}/kaitu` : "";
  };
  return (
    <div className={css.me}>
      <nav className={css["me-nav"]} aria-label={t("个人", "Personal")}>
        {(
          [
            ["profile", t("个人档案", "Profile")],
            ["connections", t("AI 与连接", "AI & connections")],
            ["settings", t("设置", "Settings")],
          ] as const
        ).map(([id, label]) => (
          <button
            type="button"
            key={id}
            aria-current={props.view === id ? "page" : undefined}
            onClick={() => {
              setPrivacy(false);
              props.navigate(id);
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className={css["me-body"]}>
        {!reading && (
          <div className={css.head}>
            <h1>{title}</h1>
            {props.view === "profile" && (
              <span className={css.sub}>
                {t("开图对你的了解，每条都留着出处", "What Kaitu knows about you, each with its source")}
              </span>
            )}
          </div>
        )}
        {error && (
          <p className={css.error} role="alert">
            {error}
          </p>
        )}
        {receipt && <output className={css.small}>{receipt}</output>}
        {props.view === "profile" ? (
          <MePage {...props} />
        ) : !data ? (
          <p className={css.small}>{t("正在读取设置…", "Loading settings…")}</p>
        ) : props.view === "connections" ? (
          <>
            <section className={css.sec}>
              <div className={css["sec-head"]}>
                <h2 className={css.eyebrow}>{t("资料去向", "Where your data goes")}</h2>
                <button
                  type="button"
                  className={css.link}
                  onClick={() => {
                    setPrivacy(true);
                    props.navigate("settings");
                  }}
                >
                  {t("逐项说明", "Full details")}
                </button>
              </div>
              <dl className={`${css.card} ${css.where}`}>
                <dt>{t("存在", "Stored")}</dt>
                <dd>
                  {data.storage.mode === "local"
                    ? t("这台电脑，不同步", "This computer, not synced")
                    : t(
                        `同步到你的云盘 · ${storageName(data.storage.provider)}`,
                        `Synced to your cloud · ${storageName(data.storage.provider)}`,
                      )}
                  <span className={css.small}>{data.storage.root}</span>
                </dd>
                <dt>{t("发给 AI", "Sent to AI")}</dt>
                <dd>
                  {!data.ai
                    ? t("问问用 DSH 的模型设置", "Ask uses DSH model settings")
                    : data.ai.configured
                      ? t(
                          `问问的对话发给 ${data.ai.providerName ?? "AI"} · ${data.ai.model}`,
                          `Ask conversations go to ${data.ai.providerName ?? "AI"} · ${data.ai.model}`,
                        )
                      : t("问问还没连接 AI", "Ask isn't connected to an AI yet")}
                  <span className={css.small}>
                    {t(
                      "默认只读写开图资料；你接入的外部 AI 各按下面写的范围读取",
                      "By default it only reads and writes your Kaitu notes; AIs you connect below read what each one says",
                    )}
                  </span>
                </dd>
                <dt>{t("留在本机", "Stays here")}</dt>
                <dd>
                  {t(
                    "Key、凭据、版本历史和索引：不进云盘，问问默认读不到",
                    "Keys, credentials, version history and the index: never synced, and Ask can't read them by default",
                  )}
                </dd>
              </dl>
            </section>
            <section className={css.sec}>
              <HandoverPanel loadHandover={props.loadHandover} onAnswer={props.onHandoverAnswer} />
            </section>
            <section className={css.sec}>
              <h2 className={css.eyebrow}>{t("「问问」用的 AI", "The AI behind Ask")}</h2>
              <p className={css.small}>
                {t(
                  "填一个 AI 服务的 API Key（DeepSeek、OpenAI、Claude、Gemini、Kimi、智谱等都可以）",
                  "Paste an API key from an AI service (DeepSeek, OpenAI, Claude, Gemini, Kimi, Zhipu and others)",
                )}
              </p>
              <p className={css.small}>
                {t(
                  "更换服务或模型后，下一条消息生效。",
                  "A new service or model applies from the next message.",
                )}
              </p>
              <div className={`${css.card} ${css["list-card"]}`}>
                <div className={css.conn}>
                  <span className={css.logo} style={{ background: "var(--explore)" }}>
                    AI
                  </span>
                  <b>
                    {data.ai
                      ? `${data.ai.providerName ?? "AI"} · ${data.ai.model}`
                      : t("由 DSH 管理", "Managed by DSH")}
                  </b>
                  <span className={css.small}>
                    {data.ai
                      ? data.ai.configured
                        ? t("已连接 · 凭据只存本机", "Connected · key stays on this computer")
                        : t("还没连接", "Not connected")
                      : t("使用 DSH 的模型设置", "Uses DSH model settings")}
                  </span>
                  <button type="button" className={`${css.btn} ${css["btn-quiet"]}`} onClick={props.manageAi}>
                    {t("管理模型", "Manage model")}
                  </button>
                </div>
              </div>
            </section>
            {search && (
              <section className={css.sec}>
                <h2 className={css.eyebrow}>网络搜索</h2>
                <div className={`${css.card} ${css.sum} ${css["sub-form"]}`}>
                  <b>
                    {search.native?.configured
                      ? `使用 ${search.native.name} 自带搜索`
                      : search.configured
                        ? `当前使用 ${search.name}`
                        : "先连接 AI，就能使用它自带的搜索"}
                  </b>
                  <p className={css.small}>
                    默认把搜索词发给当前对话的服务商，无需另申请搜索 Key，不新增接收方。
                  </p>
                  {search.native && !search.native.supported && (
                    <p className={css.small}>
                      {search.native.reason ?? "当前服务尚未接入自带搜索，可在下面添加专门的搜索服务。"}
                    </p>
                  )}
                  <details>
                    <summary className={css.link}>改用专门的搜索服务</summary>
                    <div className={css["sub-form"]}>
                      <p className={css.small}>
                        没有可用的自带搜索时，使用已添加的 Perplexity、Exa 或 Tavily；搜索词会发给所选服务。
                      </p>
                      <label className={css.small} htmlFor="search-provider">
                        搜索服务
                      </label>
                      <select
                        id="search-provider"
                        value={searchProvider}
                        disabled={busy}
                        onChange={(event) => {
                          setSearchProvider(event.target.value);
                          setSearchKey("");
                        }}
                      >
                        {search.providers.map((item) => (
                          <option value={item.id} key={item.id}>
                            {item.name}
                            {item.configured ? " · 已保存 Key" : ""}
                          </option>
                        ))}
                      </select>
                      <label className={css.small} htmlFor="search-api-key">
                        搜索 API Key
                      </label>
                      <input
                        id="search-api-key"
                        type="password"
                        autoComplete="off"
                        value={searchKey}
                        disabled={busy}
                        placeholder={
                          selectedSearch?.configured ? "留空保留已存 Key" : "粘贴这个搜索服务的 Key"
                        }
                        onChange={(event) => setSearchKey(event.target.value)}
                      />
                      {selectedSearch && (
                        <a className={css.link} href={selectedSearch.keyUrl} target="_blank" rel="noreferrer">
                          去 {selectedSearch.name} 官方申请 Key ↗
                        </a>
                      )}
                      <div className={css["dialog-foot"]}>
                        {selectedSearch?.configured && (
                          <button
                            type="button"
                            className={`${css.btn} ${css["btn-quiet"]}`}
                            disabled={busy}
                            onClick={() => void saveSearch(true)}
                          >
                            移除 Key
                          </button>
                        )}
                        <button
                          type="button"
                          className={`${css.btn} ${css["btn-primary"]}`}
                          disabled={busy}
                          onClick={() => void saveSearch()}
                        >
                          保存搜索设置
                        </button>
                      </div>
                    </div>
                  </details>
                </div>
              </section>
            )}
            <section className={css.sec}>
              <div className={css["sec-head"]}>
                <h2 className={css.eyebrow}>
                  {t("这台电脑上的 AI（进阶）", "AI on this computer (advanced)")}
                </h2>
                <span className={css.small}>
                  {t(
                    "通过 MCP 直接读写，电脑开着时可用",
                    "Reads and writes directly over MCP while this computer is on",
                  )}
                </span>
              </div>
              <div className={`${css.card} ${css.sum}`}>
                <b>{t("接入支持 MCP 的客户端", "Connect an MCP client")}</b>
                <p className={css.small}>
                  {t(
                    "Claude Desktop、Claude Code、Codex 等本机客户端可以直接读写这个开图文件夹",
                    "Local clients such as Claude Desktop, Claude Code and Codex can read and write this Kaitu folder",
                  )}
                </p>
                <details>
                  <summary className={css.link}>{t("查看接入说明", "Setup instructions")}</summary>
                  <p className={`${css.small} ${css.notice}`}>
                    {t(
                      "接入后，这个 AI 能读写开图资料，读到的内容会发给它背后的 AI 服务；经公网连接的读不到财务明细，所有外部 AI 都读不到 Key、凭据和版本历史。",
                      "Once connected, this AI can read and write your Kaitu notes, and what it reads goes to the AI service behind it. Connections over the internet can't read finance details, and no outside AI can read keys, credentials or version history.",
                    )}
                  </p>
                  <pre className={css.detailBody}>{`命令：kaitu mcp\n工作目录：${data.storage.root}`}</pre>
                  <textarea
                    aria-label={t("AI 接手说明", "AI handover instructions")}
                    rows={5}
                    readOnly
                    value={aiHandover(data.storage.root, "")}
                    style={{ width: "100%" }}
                  />
                  <button
                    type="button"
                    className={css.link}
                    onClick={() =>
                      void run(
                        () => navigator.clipboard.writeText(aiHandover(data.storage.root, "")),
                        t("接手说明已复制", "Instructions copied"),
                      )
                    }
                  >
                    {t("复制接手说明", "Copy instructions")}
                  </button>
                </details>
              </div>
            </section>
            <section className={css.sec}>
              <div className={css["sec-head"]}>
                <h2 className={css.eyebrow}>{t("云端的 AI（进阶）", "Cloud AI (advanced)")}</h2>
                <span className={css.small}>
                  {t("通过同步盘里的文件接力", "Relays through files in a synced folder")}
                </span>
              </div>
              <div className={`${css.card} ${css["list-card"]}`}>
                <div className={css["switch-row"]}>
                  <span>
                    <b>{t("同步盘接力", "Synced folder relay")}</b>
                    <br />
                    <span className={css.small}>
                      {data.storage.mode === "drive"
                        ? t(
                            `已开启 · ${storageName(data.storage.provider)}${data.storage.lastInboxProcessed ? ` · 最近处理 ${data.storage.lastInboxProcessed}` : ""}`,
                            `On · ${storageName(data.storage.provider)}${data.storage.lastInboxProcessed ? ` · last processed ${data.storage.lastInboxProcessed}` : ""}`,
                          )
                        : t("还没开启", "Not on")}
                    </span>
                  </span>
                  <button
                    type="button"
                    className={`${css.btn} ${css["btn-quiet"]}`}
                    onClick={() => {
                      props.navigate("settings");
                      setMoving(true);
                      setProvider(data.storage.suggested?.nutstore ? "nutstore" : "google-drive");
                    }}
                  >
                    {t("管理存放位置", "Manage storage")}
                  </button>
                </div>
              </div>
            </section>
            {props.phoneChannels && props.channelSettings && (
              <PhoneChannels request={props.channelSettings} />
            )}
            {props.channelSettings && (
              <ChannelSettings
                request={props.channelSettings}
                focus={props.channelFocus}
                onFocused={props.onChannelFocused}
              />
            )}
          </>
        ) : reading ? (
          <PrivacyPage back={() => setPrivacy(false)} />
        ) : (
          <>
            <section className={css.sec}>
              <h2 className={css.eyebrow}>{t("语言", "Language")}</h2>
              <div className={`${css.card} ${css["list-card"]}`}>
                <div className={css["switch-row"]}>
                  <label htmlFor="ui-language">
                    <b>{t("界面语言", "Interface language")}</b>
                    <span className={css.small}>
                      {t(
                        "只影响这台电脑上的开图界面和给 AI 的提示词",
                        "Applies to Kaitu on this computer and the prompts it gives your AI",
                      )}
                    </span>
                  </label>
                  <select
                    id="ui-language"
                    value={props.followSystem ? "system" : props.locale}
                    disabled={busy}
                    onChange={(event) =>
                      void run(
                        () =>
                          props.onLocale(
                            event.target.value === "system"
                              ? null
                              : event.target.value === "en"
                                ? "en"
                                : "zh-CN",
                          ),
                        "",
                      )
                    }
                  >
                    <option value="system">{t("跟随系统", "System default")}</option>
                    <option value="zh-CN">中文</option>
                    <option value="en">English</option>
                  </select>
                </div>
              </div>
            </section>
            <section className={css.sec}>
              <div className={css["sec-head"]}>
                <h2 className={css.eyebrow}>{t("自动整理", "Automatic organizing")}</h2>
                <span className={css.small}>{t("用「问问」的 AI 运行", "Runs with the AI behind Ask")}</span>
              </div>
              <div className={`${css.card} ${css["list-card"]}`}>
                {(
                  [
                    [
                      "morning",
                      t("早间计划", "Morning plan"),
                      t("排好今天的安排，等你确认", "Plans your day for you to confirm"),
                    ],
                    [
                      "organizer",
                      t("每日整理", "Daily organizer"),
                      t(
                        "把各个 AI 当天留下的记录合并成一份",
                        "Merges what each AI left today into one record",
                      ),
                    ],
                    [
                      "news",
                      t("资讯搜索", "News search"),
                      t("按你关注的方向找新东西", "Finds new things on topics you follow"),
                    ],
                  ] as const
                ).map(([key, label, note]) => (
                  <div className={`${css["switch-row"]} ${css["auto-row"]}`} key={key}>
                    <label htmlFor={`auto-${key}`}>
                      <b>{label}</b>
                      <span className={css.small}>{note}</span>
                    </label>
                    <span className={css["auto-ctl"]}>
                      <input
                        aria-label={t(`${label}的时间`, `${label} time`)}
                        type="time"
                        className={css.time}
                        key={`${key}:${data.automation.times[key]}`}
                        defaultValue={data.automation.times[key]}
                        disabled={busy || !data.automation.tasks[key]}
                        onBlur={(event) => {
                          const time = event.target.value;
                          if (time && time !== data.automation.times[key])
                            void saveAutomation({}, { [key]: time });
                        }}
                      />
                      <span className={css.switch}>
                        <input
                          id={`auto-${key}`}
                          type="checkbox"
                          role="switch"
                          aria-checked={data.automation.tasks[key]}
                          checked={data.automation.tasks[key]}
                          disabled={busy}
                          onChange={(event) => void saveAutomation({ [key]: event.target.checked })}
                        />
                        <i />
                      </span>
                    </span>
                  </div>
                ))}
              </div>
              <p className={css.note}>
                {t(`时间按你的时区（${data.timeZone}）算`, `Times use your time zone (${data.timeZone})`)}
              </p>
            </section>
            <section className={css.sec}>
              <div className={`${css.card} ${css["list-card"]}`}>
                <div className={css["switch-row"]}>
                  <label htmlFor="calendar-push">
                    <b>{t("确认日程时加入系统日历", "Add confirmed time blocks to the system calendar")}</b>
                    <span className={css.small}>
                      {t(
                        "只加入你确认的时间段。关闭后已写入的保持不动。",
                        "Only blocks you confirm are added. Turning this off leaves existing events as they are.",
                      )}
                    </span>
                  </label>
                  <span className={css.switch}>
                    <input
                      aria-checked={calendarPush?.enabled ?? true}
                      id="calendar-push"
                      type="checkbox"
                      role="switch"
                      checked={calendarPush?.enabled ?? true}
                      disabled={busy || !calendarPush}
                      onChange={(event) =>
                        void run(async () => {
                          setCalendarPush(await props.configureCalendarPush(event.target.checked));
                        })
                      }
                    />
                    <i />
                  </span>
                </div>
                {calendarPush && !calendarPush.enabled && (
                  <button
                    type="button"
                    className={css.link}
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const result = await props.removeCalendarPush();
                        setCalendarPush(result);
                        if (Object.values(result.entries).some((receipt) => receipt.status === "error"))
                          throw new Error("部分事件未移除，请查看下方原因并重试");
                      }, "已处理移除请求")
                    }
                  >
                    移除开图已写入的日历事件
                  </button>
                )}
                {calendarPush &&
                  Object.entries(calendarPush.entries)
                    .filter(
                      ([, value]) => value.status === "error" || (value.status === "removed" && value.ics),
                    )
                    .map(([id]) => (
                      <CalendarPushResult
                        key={id}
                        id={id}
                        state={calendarPush}
                        retry={async () => {
                          setCalendarPush(await props.removeCalendarPush());
                        }}
                      />
                    ))}
              </div>
            </section>
            <section className={css.sec}>
              <h2 className={css.eyebrow}>{t("资料", "Data")}</h2>
              <div className={`${css.card} ${css["list-card"]}`}>
                <div className={css["switch-row"]}>
                  <span>
                    <b>{t("导出全部资料", "Export everything")}</b>
                    <br />
                    <span className={css.small}>
                      {t(
                        "Markdown、JSON 和附件，不含本机连接凭据",
                        "Markdown, JSON and attachments, without local connection keys",
                      )}
                    </span>
                  </span>
                  <button
                    type="button"
                    className={`${css.btn} ${css["btn-quiet"]}`}
                    disabled={busy}
                    onClick={() =>
                      void run(
                        async () => {
                          const file = await props.exportWorkspace();
                          const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
                          const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
                          const anchor = document.createElement("a");
                          anchor.href = url;
                          anchor.download = file.name;
                          anchor.click();
                          setTimeout(() => URL.revokeObjectURL(url), 10000);
                        },
                        t("导出文件已生成", "Export ready"),
                      )
                    }
                  >
                    {t("导出", "Export")}
                  </button>
                </div>
                <div className={css["switch-row"]}>
                  <span>
                    <b>{t("版本历史", "Version history")}</b>
                    <br />
                    <span className={css.small}>
                      {t("每次改动都留了版本，可以恢复", "Every change keeps a version you can restore")}
                    </span>
                  </span>
                  <button
                    type="button"
                    className={`${css.btn} ${css["btn-quiet"]}`}
                    onClick={() => setHistory(!history)}
                  >
                    {t("打开", "Open")}
                  </button>
                </div>
                <div className={css["switch-row"]}>
                  <span>
                    <b>{t("换一个存放位置", "Change where notes live")}</b>
                    <br />
                    <span className={css.small}>
                      {storageName(data.storage.provider)} · {data.storage.root}
                    </span>
                  </span>
                  <button
                    type="button"
                    className={`${css.btn} ${css["btn-quiet"]}`}
                    onClick={() => setMoving(!moving)}
                  >
                    {t("更换", "Change")}
                  </button>
                </div>
              </div>
            </section>
            {history && (
              <section className={css.sec}>
                <h2 className={css.eyebrow}>{t("版本历史", "Version history")}</h2>
                {data.versions.map((version) => (
                  <div className={`${css.card} ${css.sum}`} key={version.oid}>
                    <b>{version.message}</b>
                    <time className={css.small}>{version.time}</time>
                    <button type="button" className={css.link} onClick={() => setRestore(version.oid)}>
                      {t("恢复这个版本", "Restore this version")}
                    </button>
                  </div>
                ))}
              </section>
            )}
            {restore && (
              <section className={css.ask}>
                <p>
                  {t(
                    "恢复前会自动保存当前版本，之后可以撤销。",
                    "The current version is saved first, so you can undo this.",
                  )}
                </p>
                <button
                  type="button"
                  className={`${css.btn} ${css["btn-primary"]}`}
                  disabled={busy}
                  onClick={() =>
                    void run(
                      async () => {
                        await props.restoreVersion(restore);
                        setRestore(null);
                        await props.refreshWorkspace();
                      },
                      t("已恢复版本", "Version restored"),
                    )
                  }
                >
                  {t("确认恢复", "Restore")}
                </button>
                <button type="button" className={css.link} onClick={() => setRestore(null)}>
                  {t("取消", "Cancel")}
                </button>
              </section>
            )}
            {moving && (
              <form
                className={`${css.card} ${css["sub-form"]}`}
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(
                    async () => {
                      await props.moveStorage(path, provider !== "local", provider);
                      setMoving(false);
                      await props.refreshWorkspace();
                    },
                    t("资料已迁移", "Notes moved"),
                  );
                }}
              >
                <label>
                  {t("由谁同步", "Synced by")}
                  <select
                    value={provider}
                    onChange={(event) => {
                      const next = event.target.value as SyncProvider;
                      setProvider(next);
                      if (!path.trim() || PROVIDERS.some((item) => suggestion(item.id) === path))
                        setPath(suggestion(next));
                    }}
                  >
                    {PROVIDERS.map((item) => (
                      <option key={item.id} value={item.id}>
                        {t(item.zh, item.en)}
                      </option>
                    ))}
                  </select>
                </label>
                {provider === "nutstore" && (
                  <p className={css.small}>
                    {data.storage.suggested?.nutstore
                      ? t(
                          "已找到坚果云同步文件夹。资料放进去后由坚果云同步到你的其他电脑；版本历史、密钥和索引留在这台电脑。",
                          "Found your Nutstore folder. Nutstore syncs your notes to your other computers; version history, keys and the index stay on this computer.",
                        )
                      : t(
                          "没找到坚果云同步文件夹。先在坚果云客户端里设好一个同步文件夹，再在下面填它里面的新文件夹路径。",
                          "No Nutstore folder found. Set up a synced folder in Nutstore first, then enter a new folder inside it below.",
                        )}
                  </p>
                )}
                {provider !== "local" && (
                  <div className={`${css.small} ${css.notice}`}>
                    <b>
                      {t(
                        `资料会同步到${provider === "folder" ? "那个同步盘" : ` ${storageName(provider)} `}`,
                        `Your notes will sync through ${provider === "folder" ? "that sync app" : storageName(provider)}`,
                      )}
                    </b>
                    <span>
                      {t(
                        "资料文件夹里的全部资料文件，包括财务明细，都由它存放和同步；你授权读取这个云盘的 AI 也能读到。版本历史、Key、凭据和索引留在这台电脑。",
                        "Every file in your notes folder, finance details included, is stored and synced by it, and any AI you let read that cloud folder can read them. Version history, keys, credentials and the index stay on this computer.",
                      )}
                    </span>
                    <span>
                      {t(
                        "不要直接把现在的开图文件夹拖进同步盘，那样会连密钥和版本库一起上传；请用这里迁移。",
                        "Don't drag the current Kaitu folder into a sync app; that would upload keys and history too. Move it here instead.",
                      )}
                    </span>
                  </div>
                )}
                <label>
                  {t("新的文件夹位置", "New folder location")}
                  <input
                    required
                    value={path}
                    placeholder={t("填写新文件夹的完整路径", "Full path of the new folder")}
                    onChange={(event) => setPath(event.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className={`${css.btn} ${css["btn-quiet"]}`}
                  disabled={busy || pickingFolder}
                  onClick={async () => {
                    setPickingFolder(true);
                    setError("");
                    try {
                      const folder = await props.pickStorageFolder();
                      if (folder) {
                        const separator = folder.includes("\\") ? "\\" : "/";
                        setPath(`${folder.replace(/[\\/]+$/, "")}${separator}kaitu`);
                      }
                    } catch (err) {
                      setError(err instanceof Error ? err.message : String(err));
                    } finally {
                      setPickingFolder(false);
                    }
                  }}
                >
                  {pickingFolder ? t("正在选择…", "Choosing…") : t("选择存放文件夹…", "Choose folder…")}
                </button>
                <p className={css.small}>
                  {t(
                    "选择后，资料将放在该位置下新的 kaitu 文件夹中。也可以手动修改上面的路径。",
                    "Your notes will go into a new kaitu folder inside the selected location. You can also edit the path above.",
                  )}
                </p>
                <button
                  type="submit"
                  className={`${css.btn} ${css["btn-primary"]}`}
                  disabled={busy || pickingFolder || !path.trim()}
                >
                  {t("迁移到这里", "Move here")}
                </button>
              </form>
            )}
            <section className={css.sec}>
              <p className={css.small}>
                {t("安装版本", "Installed build")} {data.version ?? t("本地工作台", "local workbench")}
                {data.dshVersion ? ` · Powered by DeepSeek Harness ${data.dshVersion}` : ""} ·{" "}
                {t("时区", "Time zone")} {data.timeZone}
              </p>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
