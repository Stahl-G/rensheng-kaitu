import type {
  AgentConnectionId,
  CalendarPushSettings,
  HandoverPack,
  OrganizerStatus,
  SyncProvider,
} from "@kaitu/core";
import { useCallback, useEffect, useState } from "react";
import type { AutomationKey, AutomationSettings, SettingsData } from "../types.js";
import { AiSettings } from "./AiSettings.js";
import { CalendarPushResult, type CalendarPushServices } from "./CalendarPush.js";
import { type ChannelRequest, ChannelSettings } from "./ChannelSettings.js";
import { CloudOrganizer } from "./CloudOrganizer.js";
import { type FeatureUpdateRequest, FeatureUpdates } from "./FeatureUpdates.js";
import { HandoverPanel } from "./Handover.js";
import { MePage, type MePageProps } from "./MePage.js";
import { type FileImportServices, OnboardingFileImport } from "./OnboardingSources.js";
import { PhoneChannels } from "./PhoneChannels.js";
import { type PluginRequest, Plugins } from "./Plugins.js";
import css from "./Prototype.module.css";
import settingsCss from "./SettingsPage.module.css";
import { PROVIDERS, StorageChoice } from "./StorageChoice.js";
import { WorkspaceBackup, type WorkspaceBackupRequest } from "./WorkspaceBackup.js";
import { aiHandover } from "./connections.js";
import { type Locale, useT, versionText } from "./i18n.js";

export interface PersonalServices extends CalendarPushServices, FileImportServices {
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
  restoreVersion: (oid: string) => Promise<unknown>;
  moveStorage: (path: string, drive: boolean, provider?: SyncProvider) => Promise<unknown>;
  pickStorageFolder: () => Promise<string | null>;
  loadHandover: (locale?: Locale, includeFinance?: boolean) => Promise<HandoverPack>;
  configureFinanceAccess: (id: AgentConnectionId, allowed: boolean) => Promise<unknown>;
}
const settingItems = [
  ["overview", "", "", "概览", "Overview"],
  ["profile", "我", "Me", "个人档案", "Profile"],
  ["ai", "AI", "AI", "问问用的 AI", "AI for Ask"],
  ["local-ai", "AI", "AI", "这台电脑上的 AI", "AI on this computer"],
  ["cloud-organizer", "AI", "AI", "云端整理员", "Cloud organizer"],
  ["channels", "资料从哪来", "Sources", "邮件与聊天", "Email and chat"],
  ["calendar", "资料从哪来", "Sources", "日历", "Calendar"],
  ["phone", "资料从哪来", "Sources", "手机", "Phone"],
  ["storage", "资料放哪", "Storage", "存放位置", "Location"],
  ["backup", "资料放哪", "Storage", "同步与备份", "Sync and backup"],
  ["automation", "自动", "Automatic", "自动整理", "Automatic organizing"],
  ["plugins", "自动", "Automatic", "插件", "Plugins"],
  ["language", "通用", "General", "语言与时区", "Language and time zone"],
  ["about", "通用", "General", "更新与关于", "Updates and about"],
] as const;
export type SettingsSection = (typeof settingItems)[number][0];
export type PersonalView = "profile" | "connections" | "settings";
export function PersonalPages(
  props: PersonalServices &
    MePageProps & {
      channelSettings?: ChannelRequest;
      channelFocus?: boolean;
      section: SettingsSection;
      selectSection: (section: SettingsSection) => void;
      onChannelFocused?: () => void;
      view: PersonalView;
      navigate: (view: PersonalView) => void;
      manageAi: () => void;
      aiKeyRequest?: number;
      restartGuide: () => void;
      refreshWorkspace: () => Promise<void>;
      onWorkspaceCreated: () => Promise<void>;
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
  const [importing, setImporting] = useState(false);
  const [restore, setRestore] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [opening, setOpening] = useState<"activate" | "initialize" | null>(null);
  const [workspacePath, setWorkspacePath] = useState("");
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
  const section = props.view === "profile" ? "profile" : props.section;
  const select = props.selectSection;
  const [query, setQuery] = useState("");
  const item = settingItems.find(([id]) => id === section) ?? settingItems[0];
  const [phones, setPhones] = useState<
    { name: string; configured: boolean; paired: boolean; running: boolean; error?: string }[] | null
  >(null);
  const [phoneError, setPhoneError] = useState("");
  useEffect(() => {
    if (section !== "overview") return;
    let active = true;
    void props
      .channelSettings?.("phone-list")
      .then((value) => {
        if (active) {
          setPhones(value as typeof phones);
          setPhoneError("");
        }
      })
      .catch((err) => {
        if (active) {
          setPhones(null);
          setPhoneError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      active = false;
    };
  }, [section, props.channelSettings]);
  const issues: { section: SettingsSection; text: string }[] = [];
  if (data?.backup.error || data?.backup.conflicts.length)
    issues.push({
      section: "backup",
      text:
        data.backup.error ||
        t(`${data.backup.conflicts.length} 项同步冲突`, `${data.backup.conflicts.length} sync conflicts`),
    });
  for (const phone of phones ?? [])
    if (phone.configured && (phone.error || !phone.paired))
      issues.push({
        section: "phone",
        text: `${phone.name} · ${phone.error || t("等待配对", "Pairing needed")}`,
      });
  const calendarErrors = Object.values(calendarPush?.entries ?? {}).filter(
    (entry) => entry.status === "error",
  ).length;
  if (calendarErrors)
    issues.push({
      section: "calendar",
      text: t(`${calendarErrors} 个日程需要处理`, `${calendarErrors} calendar items need attention`),
    });
  const storageName = (id: SyncProvider | undefined) => {
    const item = PROVIDERS.find((entry) => entry.id === id) ?? PROVIDERS[0];
    return t(item?.zh ?? "", item?.en ?? "");
  };
  return (
    <div className={settingsCss.page}>
      <nav className={settingsCss.navigation} aria-label={t("设置分类", "Settings sections")}>
        <input
          type="search"
          aria-label={t("搜索设置", "Search settings")}
          placeholder={t("搜索设置", "Search settings")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {settingItems
          .filter((entry) => t(entry[3], entry[4]).toLocaleLowerCase().includes(query.toLocaleLowerCase()))
          .map(([id, zhGroup, enGroup, zh, en], index, list) => (
            <div key={id}>
              {zhGroup && (index === 0 || list[index - 1]?.[1] !== zhGroup) && <p>{t(zhGroup, enGroup)}</p>}
              <button
                type="button"
                aria-current={section === id ? "page" : undefined}
                onClick={() => select(id)}
              >
                {t(zh, en)}
                {issues.filter((issue) => id === "overview" || issue.section === id).length > 0 && (
                  <span className={settingsCss.badge}>
                    {issues.filter((issue) => id === "overview" || issue.section === id).length}
                  </span>
                )}
              </button>
            </div>
          ))}
      </nav>
      <div className={settingsCss.body}>
        <h1>{section === "overview" ? t("设置", "Settings") : t(item[3], item[4])}</h1>
        {error && (
          <p role="alert" className={css.error}>
            {error}
          </p>
        )}
        {receipt && <output className={css.small}>{receipt}</output>}
        {section === "profile" ? (
          <MePage {...props} />
        ) : !data ? (
          <p>{t("正在读取设置…", "Loading settings…")}</p>
        ) : (
          <>
            {section === "overview" && (
              <>
                <p>
                  {t(
                    "先看要处理的，其余按用途分好。",
                    "Resolve anything that needs attention, then find settings by purpose.",
                  )}
                </p>
                {!!issues.length && (
                  <section className={settingsCss.attention}>
                    <h2>{t("需要你处理", "Needs attention")}</h2>
                    {issues.map((issue, index) => (
                      <div key={`${issue.section}:${index}`}>
                        <span>{issue.text}</span>
                        <button
                          type="button"
                          className={`${css.btn} ${css["btn-primary"]}`}
                          onClick={() => select(issue.section)}
                        >
                          {t("去处理", "Resolve")}
                        </button>
                      </div>
                    ))}
                  </section>
                )}
                <h2>{t("现在的状态", "Current status")}</h2>
                <div className={settingsCss.cards}>
                  {(
                    [
                      [
                        "ai",
                        data.ai
                          ? data.ai.configured
                            ? `${data.ai.providerName ?? "AI"} · ${data.ai.model}`
                            : t("还没连接", "Not connected")
                          : t("由 DSH 管理", "Managed by DSH"),
                      ],
                      [
                        "phone",
                        !props.channelSettings
                          ? t("由宿主管理", "Managed by the host")
                          : phoneError
                            ? t("状态读取失败", "Could not read status")
                            : !phones
                              ? t("正在读取…", "Loading…")
                              : phones
                                  .filter((phone) => phone.running)
                                  .map((phone) => phone.name)
                                  .join(" · ") || t("还没连接", "Not connected"),
                      ],
                      ["storage", storageName(data.storage.provider)],
                      [
                        "backup",
                        data.backup.running
                          ? t("正在同步", "Syncing")
                          : data.backup.connection
                            ? t("已连接", "Connected")
                            : t("还没连接", "Not connected"),
                      ],
                      [
                        "automation",
                        t(
                          `${Object.values(data.automation.tasks).filter(Boolean).length} 项开启`,
                          `${Object.values(data.automation.tasks).filter(Boolean).length} enabled`,
                        ),
                      ],
                      ["plugins", t("查看已安装插件", "View installed plugins")],
                      ["about", data.version ?? t("本地工作台", "Local workbench")],
                    ] as const
                  ).map(([id, status]) => {
                    const item = settingItems.find(([key]) => key === id) ?? settingItems[0];
                    return (
                      <button type="button" key={id} onClick={() => select(id)}>
                        <span>{t(item[3], item[4])}</span>
                        <strong>{status}</strong>
                      </button>
                    );
                  })}
                </div>
                <button type="button" className={css.link} onClick={props.restartGuide}>
                  {t("重新看一遍开始使用", "See Get started again")}
                </button>
              </>
            )}
            {section === "storage" && (
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
                      onClick={() => {
                        setOpening(null);
                        setMoving(!moving);
                      }}
                    >
                      {t("迁移当前资料…", "Move current notes…")}
                    </button>
                  </div>
                  {props.workspaceBackup && (
                    <button
                      type="button"
                      className={`${css.btn} ${css["btn-quiet"]}`}
                      disabled={busy}
                      onClick={() => {
                        setMoving(false);
                        setWorkspacePath("");
                        setOpening(opening === "initialize" ? null : "initialize");
                      }}
                    >
                      {t("新建空白工作区…", "Create a blank workspace…")}
                    </button>
                  )}
                  {props.workspaceBackup && (
                    <button
                      type="button"
                      className={`${css.btn} ${css["btn-quiet"]}`}
                      disabled={busy}
                      onClick={() => {
                        setMoving(false);
                        setWorkspacePath("");
                        setOpening(opening === "activate" ? null : "activate");
                      }}
                    >
                      {t("打开已有工作区…", "Open an existing workspace…")}
                    </button>
                  )}
                </div>
                {opening && props.workspaceBackup && (
                  <form
                    className={`${css.card} ${css["sub-form"]}`}
                    onSubmit={(event) => {
                      event.preventDefault();
                      void run(
                        async () => {
                          const root = workspacePath.trim();
                          if (opening === "initialize") await props.workspaceBackup?.("initialize", { root });
                          await props.workspaceBackup?.("activate", { root });
                          if (opening === "initialize") await props.onWorkspaceCreated();
                          else await props.refreshWorkspace();
                          setOpening(null);
                        },
                        opening === "initialize"
                          ? t("已创建空白工作区", "Blank workspace created")
                          : t("已打开已有工作区", "Existing workspace opened"),
                      );
                    }}
                  >
                    {opening === "initialize" && (
                      <p className={css.small}>
                        {t(
                          "选择一个空文件夹，生成独立的空白资料；当前资料会保留在原位置。",
                          "Choose an empty folder for separate blank notes. Your current notes stay in their original location.",
                        )}
                      </p>
                    )}
                    <label>
                      {opening === "initialize"
                        ? t("空文件夹路径", "Empty folder path")
                        : t("已有工作区路径", "Existing workspace path")}
                      <input
                        required
                        value={workspacePath}
                        disabled={busy}
                        onChange={(event) => setWorkspacePath(event.target.value)}
                      />
                    </label>
                    <button
                      type="button"
                      className={`${css.btn} ${css["btn-quiet"]}`}
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const folder = await props.pickStorageFolder();
                          if (folder) setWorkspacePath(folder);
                        }, "")
                      }
                    >
                      {opening === "initialize"
                        ? t("选择空文件夹…", "Choose an empty folder…")
                        : t("选择已有文件夹…", "Choose an existing folder…")}
                    </button>
                    <button
                      type="submit"
                      className={`${css.btn} ${css["btn-primary"]}`}
                      disabled={busy || !workspacePath.trim()}
                    >
                      {busy
                        ? t("正在打开…", "Opening…")
                        : opening === "initialize"
                          ? t("新建并打开", "Create and open")
                          : t("打开此工作区", "Open this workspace")}
                    </button>
                  </form>
                )}
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
            {section === "backup" && (
              <>
                {props.workspaceBackup && (
                  <WorkspaceBackup
                    request={props.workspaceBackup}
                    subscribe={props.subscribe}
                    pickFolder={props.pickStorageFolder}
                    onActivated={props.refreshWorkspace}
                  />
                )}
                <section className={css.sec}>
                  <h2 className={css.eyebrow}>{t("资料", "Data")}</h2>
                  <div className={`${css.card} ${css["list-card"]}`}>
                    <div className={css["switch-row"]}>
                      <b>{t("导入文件", "Import a file")}</b>
                      <button
                        type="button"
                        className={`${css.btn} ${css["btn-quiet"]}`}
                        onClick={() => setImporting(!importing)}
                      >
                        {t("打开", "Open")}
                      </button>
                    </div>
                    <div className={css["switch-row"]}>
                      <span>
                        <b>{t("导出全部资料", "Export everything")}</b>
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
                  {importing && (
                    <OnboardingFileImport
                      {...props}
                      onClose={() => setImporting(false)}
                      onDone={async () => {
                        setImporting(false);
                        await props.refreshWorkspace();
                        await refresh();
                      }}
                    />
                  )}
                </section>
                {history && (
                  <section className={css.sec}>
                    <h2 className={css.eyebrow}>{t("版本历史", "Version history")}</h2>
                    {data.versions.map((version) => (
                      <div className={`${css.card} ${css.sum}`} key={version.oid}>
                        <b>{versionText(version.message, props.locale)}</b>
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
              </>
            )}
            {section === "ai" && (
              <>
                {data.ai ? (
                  <AiSettings focusKey={props.aiKeyRequest} onSaved={refresh} />
                ) : (
                  <section className={css.sec}>
                    <h2 className={css.eyebrow}>{t("「问问」用的 AI", "The AI behind Ask")}</h2>
                    <div className={`${css.card} ${css["list-card"]}`}>
                      <div className={css.conn}>
                        <span className={css.logo} style={{ background: "var(--explore)" }}>
                          AI
                        </span>
                        <b>{t("由 DSH 管理", "Managed by DSH")}</b>
                        <span className={css.small}>
                          {t("使用 DSH 的模型设置", "Uses DSH model settings")}
                        </span>
                        <button
                          type="button"
                          className={`${css.btn} ${css["btn-quiet"]}`}
                          onClick={props.manageAi}
                        >
                          {t("管理模型", "Manage model")}
                        </button>
                      </div>
                    </div>
                  </section>
                )}
                {data.ai?.configured && !data.automation.asked && (
                  <p>
                    {t("要让开图每天帮你整理吗？", "Would you like Kaitu to organize each day?")}{" "}
                    <button type="button" className={css.link} onClick={() => select("automation")}>
                      {t("查看自动整理设置", "Review automation settings")}
                    </button>
                  </p>
                )}
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
                            <a
                              className={css.link}
                              href={selectedSearch.keyUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
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
                              className={css.btn}
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
              </>
            )}
            {section === "local-ai" && (
              <>
                {data.ai && <AiSettings localOnly onSaved={refresh} />}
                <section className={css.sec} id="local-ai">
                  <div className={css["sec-head"]}>
                    <h2 className={css.eyebrow}>
                      {t("这台电脑上的 AI（进阶）", "AI on this computer (advanced)")}
                    </h2>
                  </div>
                  <div className={`${css.card} ${css.sum}`}>
                    <b>{t("接入支持 MCP 的客户端", "Connect an MCP client")}</b>
                    <details>
                      <summary className={css.link}>{t("查看接入说明", "Setup instructions")}</summary>
                      <pre
                        className={css.detailBody}
                      >{`命令：kaitu mcp\n工作目录：${data.storage.root}`}</pre>
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
                  <HandoverPanel loadHandover={props.loadHandover} onAnswer={props.onHandoverAnswer} />
                </section>
                <section className={css.sec}>
                  <h2 className={css.eyebrow}>{t("Agent 读取财务", "Agent finance access")}</h2>
                  <div className={`${css.card} ${css["list-card"]}`}>
                    {(
                      [
                        ["local-mcp", t("本机 MCP", "Local MCP")],
                        ["local-ask", t("本机问问", "Local Ask")],
                        ["phone-ask", t("手机问问", "Phone Ask")],
                        ["remote-mcp", t("远程 MCP", "Remote MCP")],
                      ] as const
                    ).map(([id, label]) => (
                      <label key={id} className={css["switch-row"]}>
                        <span>{label}</span>
                        <input
                          type="checkbox"
                          checked={data.financeAccess[id]}
                          disabled={busy}
                          onChange={(event) =>
                            void run(() => props.configureFinanceAccess(id, event.target.checked))
                          }
                        />
                      </label>
                    ))}
                  </div>
                </section>
              </>
            )}
            {section === "cloud-organizer" && (
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
                    if (props.workspaceBackup) select("backup");
                    else {
                      select("storage");
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
                        select("storage");
                        setMoving(true);
                      }}
                    >
                      {t("管理存放位置", "Manage storage")}
                    </button>
                  </div>
                </div>
              </section>
            )}
            {section === "phone" && (
              <section className={css.sec}>
                <h2 className={css.eyebrow}>{t("开图 iPhone App", "Kaitu for iPhone")}</h2>
                <div className={`${css.card} ${css["list-card"]}`}>
                  <div className={css["switch-row"]}>
                    <span>
                      <b>{t("开图 iPhone（测试中）", "Kaitu for iPhone (beta)")}</b>
                      <br />
                      <span className={css.small}>
                        {data.storage.mode === "local"
                          ? t(
                              "手机直接打开和电脑同一个资料文件夹。资料现在只在这台电脑上，先放到 iCloud 云盘或 Google Drive。",
                              "Your iPhone opens the same notes folder as this computer. It is only on this computer now; move it to iCloud Drive or Google Drive first.",
                            )
                          : t(
                              `在 iPhone 上装开图（TestFlight 邀请测试），在「文件」里选中${storageName(data.storage.provider)}的「${data.storage.root.split(/[\\/]/).pop()}」文件夹，就能看今天、记一笔、采纳建议。`,
                              `Install Kaitu on iPhone (TestFlight beta), then pick the “${data.storage.root.split(/[\\/]/).pop()}” folder in ${storageName(data.storage.provider)} from Files to see today, capture and adopt suggestions.`,
                            )}
                      </span>
                    </span>
                    {data.storage.mode === "local" && (
                      <button
                        type="button"
                        className={`${css.btn} ${css["btn-quiet"]}`}
                        onClick={() => {
                          select("storage");
                          setMoving(true);
                        }}
                      >
                        {t("管理存放位置", "Manage storage")}
                      </button>
                    )}
                  </div>
                </div>
              </section>
            )}
            {section === "phone" &&
              (props.phoneChannels && props.channelSettings ? (
                <PhoneChannels request={props.channelSettings} />
              ) : (
                <p>{t("这个宿主不提供手机连接。", "Phone connections are not available in this host.")}</p>
              ))}
            {section === "channels" && props.channelSettings && (
              <ChannelSettings
                request={props.channelSettings}
                focus={props.channelFocus}
                onFocused={props.onChannelFocused}
              />
            )}
            {section === "language" && (
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
                <p>
                  {t("时区", "Time zone")} · {data.timeZone}
                </p>
              </>
            )}
            {section === "automation" && (
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
            )}
            {section === "calendar" && (
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
            )}
            {section === "plugins" &&
              (props.plugins ? (
                <Plugins request={props.plugins} />
              ) : (
                <p>{t("插件由 DSH 管理。", "Plugins are managed by DSH.")}</p>
              ))}
            {section === "about" && (
              <section className={css.sec}>
                <h2 className={css.eyebrow}>{t("关于", "About")}</h2>
                {props.desktopUpdate && <FeatureUpdates request={props.desktopUpdate} />}
                <p className={css.small}>
                  {t("安装版本", "Installed build")} {data.version ?? t("本地工作台", "local workbench")}
                  {data.dshVersion ? ` · Powered by DeepSeek Harness ${data.dshVersion}` : ""} ·{" "}
                  {t("时区", "Time zone")} {data.timeZone}
                </p>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
