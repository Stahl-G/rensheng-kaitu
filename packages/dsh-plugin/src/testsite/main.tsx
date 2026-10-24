import { useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { KaituMark } from "../client/Brand.js";
import { DirectionsPage } from "../client/DirectionsPage.js";
import { DocumentBody } from "../client/DocumentBody.js";
import { FileServicesContext } from "../client/DshFiles.js";
import { InboxPage, LibraryPage } from "../client/LibraryPage.js";
import { NavigationIcon } from "../client/NavigationIcon.js";
import css from "../client/Prototype.module.css";
import todayCss from "../client/TodayPage.module.css";
import { type Locale, LocaleContext, browserLocale } from "../client/i18n.js";
import type { InboxEntry } from "../types.js";
import { type DemoMode, HomeScenes } from "./HomeScenes.js";
import preview from "./preview.module.css";
import * as store from "./store.js";

const directionData = {
  references: { projects: [], decisions: [] },
  experiments: [],
  checkins: [],
  notes: [],
  timeline: [],
  directions: [
    {
      id: "sample-hangzhou",
      ts: "2026-10-23T09:00:00Z",
      by: "agent",
      rev: 1,
      title: "先去杭州短住一个周末",
      motivation: "小林想换一种生活节奏，但还不确定是否适合搬家。",
      hypothesis: "短住能帮助判断通勤与生活节奏是否合适。",
      unknowns: "预算、通勤时间以及离朋友更远的影响。",
      status: "suggested" as const,
      favorite: false,
    },
  ],
};
const loadDirections = async () => directionData;
const unavailable = async () => {
  throw new Error(
    "此项需要正式 App；本预览不运行 AI、不读取文件，也不保存方向修改。 / This needs the app. No AI, file access or direction edits in this preview.",
  );
};
const files = { pickDirectory: unavailable, findFiles: unavailable, openPath: unavailable };
function App() {
  const state = useSyncExternalStore(store.subscribe, store.snapshot);
  const [locale, setLocale] = useState<Locale>(() =>
    new URLSearchParams(location.search).get("lang") === "en"
      ? "en"
      : new URLSearchParams(location.search).get("lang") === "zh-CN"
        ? "zh-CN"
        : browserLocale().toLowerCase().startsWith("zh")
          ? "zh-CN"
          : "en",
  );
  const t = (zh: string, en: string) => (locale === "en" ? en : zh);
  const [mode, setMode] = useState<DemoMode>(() => {
    const requested = new URLSearchParams(location.search).get("state");
    return requested === "pending" ? "pending" : state.notes.length === 0 ? "new" : "data";
  });
  const [homeKey, setHomeKey] = useState(0);
  const [view, setView] = useState("overview");
  const [query, setQuery] = useState("");
  const [section, setSection] = useState("");
  const [original, setOriginal] = useState<InboxEntry>();
  const [document, setDocument] = useState<string>();
  const [notice, setNotice] = useState("");
  const [error, setError] = useState(store.loadError());
  const [resetting, setResetting] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark" | "system">("system");
  const data = store.overview();
  const library = {
    inbox: state.notes,
    notes: store.documents,
    sections: [
      {
        id: "notes",
        title: "笔记与决策",
        count: store.documents.length,
        sources: [t("示例", "Samples")],
        latest: null,
      },
      {
        id: "inbox",
        title: "收件箱",
        count: state.notes.length,
        sources: [t("随手记", "Quick notes")],
        latest: null,
      },
    ],
  };
  const explain = () => setNotice(t("这项需要正式 App。", "This needs the app."));
  function run(action: () => void) {
    try {
      action();
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }
  function openSection(id: string) {
    setSection(id);
    setOriginal(undefined);
    setDocument(undefined);
  }
  function navigate(id: string) {
    setView(id);
    openSection("");
    setNotice("");
  }
  return (
    <LocaleContext.Provider value={locale}>
      <FileServicesContext.Provider value={files}>
        <div
          className={`${css.app} ${preview.app}`}
          data-theme={theme === "system" ? undefined : theme}
          lang={locale}
        >
          <header className={`${css.top} ${preview.header}`}>
            <div className={css.brand}>
              <KaituMark size={26} />
              <span>{t("开图", "Kaitu")}</span>
            </div>
            <div className={preview.tools}>
              <a className={css.link} href={locale === "en" ? "/en/" : "/"}>
                {t("返回官网", "Back to website")}
              </a>
              <button
                type="button"
                className={css.link}
                onClick={() => setLocale(locale === "en" ? "zh-CN" : "en")}
              >
                {locale === "en" ? "中文" : "English"}
              </button>
              <label className={css.sr} htmlFor="appearance">
                {t("外观", "Appearance")}
              </label>
              <select
                id="appearance"
                value={theme}
                onChange={(event) => setTheme(event.target.value as typeof theme)}
              >
                <option value="system">{t("跟随系统", "System")}</option>
                <option value="light">{t("浅色", "Light")}</option>
                <option value="dark">{t("深色", "Dark")}</option>
              </select>
              <button type="button" className={css.link} onClick={() => setResetting(true)}>
                {t("重置示例", "Reset demo")}
              </button>
            </div>
            <nav className={css.tabs} aria-label={t("主要导航", "Main navigation")}>
              {[
                ["overview", t("首页", "Home")],
                ["explore", t("开图", "Explore")],
                ["records", t("资料", "Library")],
              ].map(([id, title]) => (
                <button
                  key={id}
                  type="button"
                  aria-current={view === id ? "page" : undefined}
                  onClick={() => navigate(id as string)}
                >
                  <NavigationIcon page={id as string} />
                  <span>{title}</span>
                </button>
              ))}
            </nav>
          </header>
          <main className={`${css.content} ${todayCss.page} ${preview.main}`}>
            <div className={preview.demoBar} aria-label={t("示例状态", "Demo state")}>
              <span>
                {t(
                  "示例；资料只留本标签页，刷新保留，不会上传。",
                  "Demo; data stays in this tab, survives refresh and is never uploaded.",
                )}
              </span>
              <div className={preview.tools}>
                {(
                  [
                    ["new", t("第一次打开", "New user")],
                    ["data", t("有资料", "With data")],
                    ["pending", t("有待确认", "Pending review")],
                  ] as const
                ).map(([id, title]) => (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={mode === id}
                    onClick={() => {
                      if (id === "new" && state.notes.length) {
                        setResetting(true);
                        return;
                      }
                      run(() => {
                        if (id !== "new" && !state.notes.length) store.reset();
                        setMode(id);
                        setHomeKey((key) => key + 1);
                        navigate("overview");
                      });
                    }}
                  >
                    {title}
                  </button>
                ))}
              </div>
            </div>
            {notice && (
              <output className={preview.notice} aria-live="polite">
                {notice}
              </output>
            )}
            {error && (
              <p role="alert" className={preview.notice}>
                {error}
              </p>
            )}
            {resetting && (
              <section className={preview.banner} aria-label={t("确认重置", "Confirm reset")}>
                <p>{t("清空示例记录？", "Clear the demo notes?")}</p>
                <div className={preview.tools}>
                  <button
                    type="button"
                    className={css.btn}
                    onClick={() =>
                      run(() => {
                        store.clear();
                        setResetting(false);
                        setHomeKey((key) => key + 1);
                        setMode("new");
                        setError("");
                        navigate("overview");
                        setNotice(t("示例已重置", "Demo reset"));
                      })
                    }
                  >
                    {t("确认重置", "Confirm reset")}
                  </button>
                  <button type="button" className={css.link} onClick={() => setResetting(false)}>
                    {t("取消", "Cancel")}
                  </button>
                </div>
              </section>
            )}
            {view === "overview" && (
              <HomeScenes
                key={homeKey}
                mode={mode}
                setMode={setMode}
                state={state}
                t={t}
                locale={locale}
                library={() => {
                  navigate("records");
                  openSection("inbox");
                }}
                directions={() => navigate("explore")}
                notice={setNotice}
                error={setError}
              />
            )}
            {view === "records" && (
              <>
                <div className={css.head}>
                  <h1>
                    {section === "inbox"
                      ? t("收件箱", "Inbox")
                      : document
                        ? t("示例资料原文", "Sample document")
                        : t("资料", "Library")}
                  </h1>
                  {(section || document) && (
                    <button type="button" className={css.link} onClick={() => openSection("")}>
                      {t("← 全部资料", "← Library")}
                    </button>
                  )}
                </div>
                {section === "inbox" ? (
                  <InboxPage
                    key={original?.file ?? "all"}
                    initialEntry={original}
                    loadLibrary={store.library}
                    loadMediaImage={unavailable}
                    subscribe={store.subscribe}
                    connect={explain}
                    openNext={() => navigate("overview")}
                    sources={{}}
                    overview={data}
                  />
                ) : document ? (
                  <article className={`${css.card} ${css.sum}`}>
                    <DocumentBody
                      content={store.documents.find((note) => note.file === document)?.body ?? ""}
                    />
                  </article>
                ) : section === "notes" ? (
                  <section className={css.sec}>
                    {store.documents.map((note) => (
                      <button
                        type="button"
                        className={css.btn}
                        key={note.file}
                        onClick={() => setDocument(note.file)}
                      >
                        {note.title}
                      </button>
                    ))}
                  </section>
                ) : (
                  <LibraryPage
                    data={library}
                    overview={data}
                    searchLibraryNotes={store.search}
                    query={query}
                    onQuery={setQuery}
                    open={openSection}
                    onOpenOriginal={(entry) => {
                      setOriginal(entry);
                      setSection("inbox");
                    }}
                    onOpenNote={setDocument}
                    onOpenGoal={() => navigate("overview")}
                  />
                )}
              </>
            )}
            {view === "explore" && (
              <>
                <nav className={css.subtabs} aria-label={t("开图里的内容", "Explore sections")}>
                  <button type="button" disabled>
                    {t("足迹", "Places")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      navigate("overview");
                      setNotice(t("在首页点「打开健康」。", "Open Health from Home."));
                    }}
                  >
                    {t("健康", "Health")}
                  </button>
                  <button type="button" disabled>
                    {t("资讯", "News")}
                  </button>
                  <button type="button" aria-pressed="true">
                    {t("方向", "Directions")}
                  </button>
                </nav>
                <DirectionsPage
                  loadExploration={loadDirections}
                  writeExploration={unavailable}
                  loadExplorationSource={unavailable}
                  onPrompt={explain}
                  onConnect={explain}
                />
              </>
            )}
          </main>
        </div>
      </FileServicesContext.Provider>
    </LocaleContext.Provider>
  );
}
createRoot(document.getElementById("root") as HTMLElement).render(<App />);
