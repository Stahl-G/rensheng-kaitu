import { useCallback, useEffect, useState } from "react";
import type { AutomationKey, AutomationSettings, SettingsData } from "../types.js";
import { type ChannelRequest, ChannelSettings } from "./ChannelSettings.js";
import { MePage, type MePageProps } from "./MePage.js";
import css from "./Prototype.module.css";
import { aiHandover } from "./connections.js";

export interface PersonalServices {
  loadSettings: () => Promise<SettingsData>;
  configureAutomation: (
    tasks: Partial<Record<AutomationKey, boolean>>,
    times?: Partial<Record<AutomationKey, string>>,
  ) => Promise<AutomationSettings>;
  exportWorkspace: () => Promise<{ name: string; base64: string }>;
  restoreVersion: (oid: string) => Promise<unknown>;
  moveStorage: (path: string, drive: boolean) => Promise<unknown>;
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
    },
) {
  const [data, setData] = useState<SettingsData | null>(null);
  const [searchProvider, setSearchProvider] = useState("deepseek");
  const [searchKey, setSearchKey] = useState("");
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState(false);
  const [restore, setRestore] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [path, setPath] = useState("");
  const [drive, setDrive] = useState(false);
  const refresh = useCallback(async () => {
    try {
      setData(await props.loadSettings());
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [props.loadSettings]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => props.subscribe?.(() => void refresh()), [props.subscribe, refresh]);
  const run = async (operation: () => Promise<unknown>, message = "已保存") => {
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
  const title = props.view === "profile" ? "个人档案" : props.view === "connections" ? "AI 与连接" : "设置";
  return (
    <div className={css.me}>
      <nav className={css["me-nav"]} aria-label="个人">
        {(
          [
            ["profile", "个人档案"],
            ["connections", "AI 与连接"],
            ["settings", "设置"],
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
          {props.view === "profile" && <span className={css.sub}>开图对你的了解，每条都留着出处</span>}
        </div>
        {error && (
          <p className={css.error} role="alert">
            {error}
          </p>
        )}
        {receipt && <output className={css.small}>{receipt}</output>}
        {props.view === "profile" ? (
          <MePage {...props} />
        ) : !data ? (
          <p className={css.small}>正在读取设置…</p>
        ) : props.view === "connections" ? (
          <>
            <section className={css.sec}>
              <h2 className={css.eyebrow}>「问问」用的 AI</h2>
              <p className={css.small}>
                填一个 AI 服务的 API Key（DeepSeek、OpenAI、Claude、Gemini、Kimi、智谱等都可以）
              </p>
              <p className={css.small}>更换服务或模型后，下一条消息生效。</p>
              <div className={`${css.card} ${css["list-card"]}`}>
                <div className={css.conn}>
                  <span className={css.logo} style={{ background: "var(--explore)" }}>
                    AI
                  </span>
                  <b>{data.ai ? `${data.ai.providerName ?? "AI"} · ${data.ai.model}` : "由 DSH 管理"}</b>
                  <span className={css.small}>
                    {data.ai
                      ? data.ai.configured
                        ? "已连接 · 凭据只存本机"
                        : "还没连接"
                      : "使用 DSH 的模型设置"}
                  </span>
                  <button type="button" className={`${css.btn} ${css["btn-quiet"]}`} onClick={props.manageAi}>
                    管理模型
                  </button>
                </div>
              </div>
            </section>
            {search && (
              <section className={css.sec}>
                <h2 className={css.eyebrow}>网络搜索</h2>
                <div className={`${css.card} ${css.sum} ${css["sub-form"]}`}>
                  <b>{search.configured ? `当前使用 ${search.name}` : "还没有网络搜索 Key"}</b>
                  <p className={css.small}>
                    有 DeepSeek Key 时优先使用，否则使用已添加的 Perplexity 或 Exa，与对话模型无关。
                  </p>
                  {!search.configured && (
                    <p className={css.small}>
                      在这里添加一个搜索服务的 Key，就能搜索；不加 Key 也能打开公开网页。
                    </p>
                  )}
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
                    placeholder={selectedSearch?.configured ? "留空保留已存 Key" : "粘贴这个搜索服务的 Key"}
                    onChange={(event) => setSearchKey(event.target.value)}
                  />
                  {selectedSearch && (
                    <a className={css.link} href={selectedSearch.keyUrl} target="_blank" rel="noreferrer">
                      去 {selectedSearch.name} 官方申请 Key ↗
                    </a>
                  )}
                  {searchProvider === "deepseek" && (
                    <p className={css.small}>DeepSeek 的 Key 与 DeepSeek 模型连接共用。</p>
                  )}
                  <div className={css["dialog-foot"]}>
                    {selectedSearch?.configured && (
                      <button
                        type="button"
                        className={`${css.btn} ${css["btn-quiet"]}`}
                        disabled={busy}
                        onClick={() => void saveSearch(true)}
                      >
                        移除{searchProvider === "deepseek" ? "共用 " : " "}Key
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
              </section>
            )}
            <section className={css.sec}>
              <div className={css["sec-head"]}>
                <h2 className={css.eyebrow}>这台电脑上的 AI</h2>
                <span className={css.small}>通过 MCP 直接读写，电脑开着时可用</span>
              </div>
              <div className={`${css.card} ${css.sum}`}>
                <b>接入你正在用的 AI</b>
                <p className={css.small}>在支持 MCP 的 AI 中接入这个开图文件夹</p>
                <details>
                  <summary className={css.link}>查看接入说明</summary>
                  <pre className={css.detailBody}>{`命令：kaitu mcp\n工作目录：${data.storage.root}`}</pre>
                  <textarea
                    aria-label="AI 接手说明"
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
                        "接手说明已复制",
                      )
                    }
                  >
                    复制接手说明
                  </button>
                </details>
              </div>
            </section>
            <section className={css.sec}>
              <div className={css["sec-head"]}>
                <h2 className={css.eyebrow}>云端的 AI</h2>
                <span className={css.small}>通过 Google Drive 文件接力</span>
              </div>
              <div className={`${css.card} ${css["list-card"]}`}>
                <div className={css["switch-row"]}>
                  <span>
                    <b>Google Drive 接力</b>
                    <br />
                    <span className={css.small}>
                      {data.storage.mode === "drive"
                        ? `已开启${data.storage.lastInboxProcessed ? ` · 最近处理 ${data.storage.lastInboxProcessed}` : ""}`
                        : "还没连接"}
                    </span>
                  </span>
                  <button
                    type="button"
                    className={`${css.btn} ${css["btn-quiet"]}`}
                    onClick={() => {
                      props.navigate("settings");
                      setMoving(true);
                      setDrive(true);
                    }}
                  >
                    管理存放位置
                  </button>
                </div>
              </div>
            </section>
            {props.channelSettings && (
              <ChannelSettings
                request={props.channelSettings}
                focus={props.channelFocus}
                onFocused={props.onChannelFocused}
              />
            )}
            <section className={css.sec}>
              <h2 className={css.eyebrow}>资料存在哪里</h2>
              <div className={`${css.card} ${css.sum}`}>
                <b>{data.storage.mode === "drive" ? "Google Drive 文件夹" : "这台电脑"}</b>
                <p className={css.small}>{data.storage.root}</p>
              </div>
            </section>
          </>
        ) : (
          <>
            <section className={css.sec}>
              <div className={css["sec-head"]}>
                <h2 className={css.eyebrow}>自动整理</h2>
                <span className={css.small}>用「问问」的 AI 运行</span>
              </div>
              <div className={`${css.card} ${css["list-card"]}`}>
                {(
                  [
                    ["morning", "早间计划", "排好今天的安排，等你确认"],
                    ["organizer", "每日整理", "把各个 AI 当天留下的记录合并成一份"],
                    ["news", "资讯搜索", "按你关注的方向找新东西"],
                  ] as const
                ).map(([key, label, note]) => (
                  <div className={`${css["switch-row"]} ${css["auto-row"]}`} key={key}>
                    <label htmlFor={`auto-${key}`}>
                      <b>{label}</b>
                      <span className={css.small}>{note}</span>
                    </label>
                    <span className={css["auto-ctl"]}>
                      <input
                        aria-label={`${label}的时间`}
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
              <p className={css.note}>时间按你的时区（{data.timeZone}）算</p>
            </section>
            <section className={css.sec}>
              <h2 className={css.eyebrow}>资料</h2>
              <div className={`${css.card} ${css["list-card"]}`}>
                <div className={css["switch-row"]}>
                  <span>
                    <b>导出全部资料</b>
                    <br />
                    <span className={css.small}>Markdown、JSON 和附件，不含本机连接凭据</span>
                  </span>
                  <button
                    type="button"
                    className={`${css.btn} ${css["btn-quiet"]}`}
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const file = await props.exportWorkspace();
                        const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
                        const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
                        const anchor = document.createElement("a");
                        anchor.href = url;
                        anchor.download = file.name;
                        anchor.click();
                        setTimeout(() => URL.revokeObjectURL(url), 10000);
                      }, "导出文件已生成")
                    }
                  >
                    导出
                  </button>
                </div>
                <div className={css["switch-row"]}>
                  <span>
                    <b>版本历史</b>
                    <br />
                    <span className={css.small}>每次改动都留了版本，可以恢复</span>
                  </span>
                  <button
                    type="button"
                    className={`${css.btn} ${css["btn-quiet"]}`}
                    onClick={() => setHistory(!history)}
                  >
                    打开
                  </button>
                </div>
                <div className={css["switch-row"]}>
                  <span>
                    <b>换一个存放位置</b>
                    <br />
                    <span className={css.small}>{data.storage.root}</span>
                  </span>
                  <button
                    type="button"
                    className={`${css.btn} ${css["btn-quiet"]}`}
                    onClick={() => setMoving(!moving)}
                  >
                    更换
                  </button>
                </div>
              </div>
            </section>
            {history && (
              <section className={css.sec}>
                <h2 className={css.eyebrow}>版本历史</h2>
                {data.versions.map((version) => (
                  <div className={`${css.card} ${css.sum}`} key={version.oid}>
                    <b>{version.message}</b>
                    <time className={css.small}>{version.time}</time>
                    <button type="button" className={css.link} onClick={() => setRestore(version.oid)}>
                      恢复这个版本
                    </button>
                  </div>
                ))}
              </section>
            )}
            {restore && (
              <section className={css.ask}>
                <p>恢复前会自动保存当前版本，之后可以撤销。</p>
                <button
                  type="button"
                  className={`${css.btn} ${css["btn-primary"]}`}
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await props.restoreVersion(restore);
                      setRestore(null);
                      await props.refreshWorkspace();
                    }, "已恢复版本")
                  }
                >
                  确认恢复
                </button>
                <button type="button" className={css.link} onClick={() => setRestore(null)}>
                  取消
                </button>
              </section>
            )}
            {moving && (
              <form
                className={`${css.card} ${css["sub-form"]}`}
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(async () => {
                    await props.moveStorage(path, drive);
                    setMoving(false);
                    await props.refreshWorkspace();
                  }, "资料已迁移");
                }}
              >
                <label>
                  新的文件夹位置
                  <input
                    required
                    value={path}
                    placeholder="填写新文件夹的完整路径"
                    onChange={(event) => setPath(event.target.value)}
                  />
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={drive}
                    onChange={(event) => setDrive(event.target.checked)}
                  />
                  这是 Google Drive 同步目录
                </label>
                <button
                  type="submit"
                  className={`${css.btn} ${css["btn-primary"]}`}
                  disabled={busy || !path.trim()}
                >
                  迁移到这里
                </button>
              </form>
            )}
            <section className={css.sec}>
              <h2 className={css.eyebrow}>关于</h2>
              <p className={css.small}>
                人生开图 · {data.version ?? "本地工作台"}
                {data.dshVersion ? ` · Powered by DSH ${data.dshVersion}` : ""} · 时区 {data.timeZone}
              </p>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
