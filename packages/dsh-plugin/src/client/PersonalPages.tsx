import type { CalendarPushSettings, HandoverPack, OrganizerStatus, SyncProvider } from "@kaitu/core";
import { useCallback, useEffect, useState } from "react";
import type { AutomationKey, AutomationSettings, SettingsData } from "../types.js";
import { CalendarPushResult, type CalendarPushServices } from "./CalendarPush.js";
import { type ChannelRequest, ChannelSettings } from "./ChannelSettings.js";
import { CloudOrganizer } from "./CloudOrganizer.js";
import { type FeatureUpdateRequest, FeatureUpdates } from "./FeatureUpdates.js";
import { HandoverPanel } from "./Handover.js";
import { MePage, type MePageProps } from "./MePage.js";
import { PhoneChannels } from "./PhoneChannels.js";
import { type PluginRequest, Plugins } from "./Plugins.js";
import css from "./Prototype.module.css";
import { PROVIDERS, StorageChoice } from "./StorageChoice.js";
import { WorkspaceBackup, type WorkspaceBackupRequest } from "./WorkspaceBackup.js";
import { WorkspaceExport } from "./WorkspaceExport.js";
import { aiHandover } from "./connections.js";
import { type Locale, useT } from "./i18n.js";

export interface PersonalServices extends CalendarPushServices {
  desktopUpdate?: FeatureUpdateRequest;
  /** 只有开图 App 有；DSH 插件版用 DSH 自己的插件管理。 */
  plugins?: PluginRequest;
  phoneChannels?: boolean;
  loadSettings: () => Promise<SettingsData>;
  organizerSeen?: () => Promise<OrganizerStatus>;
  workspaceBackup?: WorkspaceBackupRequest;
  configureAutomation: (
    tasks: Partial<Record<AutomationKey, boolean>>,
    times?: Partial<Record<AutomationKey, string>>,
  ) => Promise<AutomationSettings>;
  exportWorkspace: () => Promise<{ name: string; base64: string }>;
  exportWorkspaceRequest: (
    action: "start" | "status" | "cancel" | "result",
  ) => Promise<import("@kaitu/core").WorkspaceExportState>;
  restoreVersion: (oid: string) => Promise<unknown>;
  moveStorage: (path: string, drive: boolean, provider?: SyncProvider) => Promise<unknown>;
  pickStorageFolder: () => Promise<string | null>;
  loadHandover: (locale?: Locale) => Promise<HandoverPack>;
}
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
  useEffect(() => {
    if (props.view === "connections" && data?.organizer.unread)
      document.getElementById("cloud-organizer")?.scrollIntoView({ block: "center" });
  }, [props.view, data?.organizer.unread]);
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
            onClick={() => props.navigate(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className={css["me-body"]}>
        <div className={css.head}>
          <h1>{title}</h1>
        </div>
        {error && (
          <p className={css.error} role="alert">
            {error}
          </p>
        )}
        {receipt && <output className={css.small}>{receipt}</output>}
        {data && props.view === "settings" && (
          <section className={css.sec}>
            <h2 className={css.eyebrow}>{t("资料位置", "Workspace location")}</h2>
            <div className={`${css.card} ${css["list-card"]}`}>
              <div className={css["switch-row"]}>
                <span>
                  <b>{storageName(data.storage.provider)}</b>
                  <br />
                  <span className={css.small}>{data.storage.root}</span>
                </span>
                <button
                  type="button"
                  className={`${css.btn} ${css["btn-quiet"]}`}
                  onClick={() => setMoving(!moving)}
                >
                  {t("更换本地文件夹", "Change local folder")}
                </button>
              </div>
            </div>
            {moving && (
              <StorageChoice
                storage={{ ...data.storage, github: !!data.backup.connection }}
                moveStorage={props.moveStorage}
                pickStorageFolder={props.pickStorageFolder}
                submitLabel={t("迁移到这里", "Move here")}
                onDone={async (moved) => {
                  setMoving(false);
                  if (moved) {
                    await props.refreshWorkspace();
                    setReceipt(t("资料已迁移", "Notes moved"));
                  }
                }}
              />
            )}
          </section>
        )}
        {data && props.view !== "profile" && props.workspaceBackup && (
          <WorkspaceBackup
            request={props.workspaceBackup}
            subscribe={props.subscribe}
            pickFolder={props.pickStorageFolder}
            onActivated={props.refreshWorkspace}
          />
        )}
        {props.view === "profile" ? (
          <MePage {...props} />
        ) : !data ? (
          <p className={css.small}>{t("正在读取设置…", "Loading settings…")}</p>
        ) : props.view === "connections" ? (
          <>
            <section className={css.sec}>
              <HandoverPanel loadHandover={props.loadHandover} onAnswer={props.onHandoverAnswer} />
            </section>
            <section className={css.sec}>
              <h2 className={css.eyebrow}>{t("「问问」用的 AI", "The AI behind Ask")}</h2>
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
                        ? t("已连接", "Connected")
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
                  {search.native && !search.native.supported && (
                    <p className={css.small}>{search.native.reason ?? "当前服务没有自带搜索"}</p>
                  )}
                  <details>
                    <summary className={css.link}>改用专门的搜索服务</summary>
                    <div className={css["sub-form"]}>
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
              </div>
              <div className={`${css.card} ${css.sum}`}>
                <b>{t("接入支持 MCP 的客户端", "Connect an MCP client")}</b>
                <details>
                  <summary className={css.link}>{t("查看接入说明", "Setup instructions")}</summary>
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
                <h2 className={css.eyebrow}>{t("云端整理员", "Cloud organizer")}</h2>
              </div>
              <CloudOrganizer
                data={data}
                copy={(text) =>
                  run(() => navigator.clipboard.writeText(text), t("说明已复制", "Instructions copied"))
                }
                seen={() =>
                  run(async () => {
                    const organizer = await props.organizerSeen?.();
                    if (organizer) setData((current) => (current ? { ...current, organizer } : current));
                  })
                }
                setup={() => {
                  if (props.workspaceBackup)
                    document.getElementById("workspace-backup")?.scrollIntoView({ block: "center" });
                  else {
                    props.navigate("settings");
                    setMoving(true);
                  }
                }}
              />
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
        ) : (
          <>
            <section className={css.sec}>
              <h2 className={css.eyebrow}>{t("语言", "Language")}</h2>
              <div className={`${css.card} ${css["list-card"]}`}>
                <div className={css["switch-row"]}>
                  <label htmlFor="ui-language">
                    <b>{t("界面语言", "Interface language")}</b>
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
              </div>
              <div className={`${css.card} ${css["list-card"]}`}>
                {(
                  [
                    [
                      "morning",
                      t("早间计划", "Morning plan"),
                      t("排好今天的安排，等你确认", "Plans your day for you to confirm"),
                    ],
                    ["organizer", t("每日整理", "Daily organizer")],
                    [
                      "news",
                      t("资讯搜索", "News search"),
                      t("按你关注的方向找新东西", "Finds new things on topics you follow"),
                    ],
                  ] as const
                ).map(([key, label]) => (
                  <div className={`${css["switch-row"]} ${css["auto-row"]}`} key={key}>
                    <label htmlFor={`auto-${key}`}>
                      <b>{label}</b>
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
            </section>
            <section className={css.sec}>
              <div className={`${css.card} ${css["list-card"]}`}>
                <div className={css["switch-row"]}>
                  <label htmlFor="calendar-push">
                    <b>{t("确认日程时加入系统日历", "Add confirmed time blocks to the system calendar")}</b>
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
                <WorkspaceExport request={props.exportWorkspaceRequest} />
                <div className={css["switch-row"]}>
                  <span>
                    <b>{t("版本历史", "Version history")}</b>
                  </span>
                  <button
                    type="button"
                    className={`${css.btn} ${css["btn-quiet"]}`}
                    onClick={() => setHistory(!history)}
                  >
                    {t("打开", "Open")}
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
                <p>{t("恢复到这个版本？", "Restore this version?")}</p>
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
            {props.plugins && <Plugins request={props.plugins} />}
            <section className={css.sec}>
              <h2 className={css.eyebrow}>{t("关于", "About")}</h2>
              {props.desktopUpdate && <FeatureUpdates request={props.desktopUpdate} />}
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
