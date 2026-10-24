import { useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { KaituMark } from "../client/Brand.js";
import { DirectionsPage } from "../client/DirectionsPage.js";
import { DocumentBody } from "../client/DocumentBody.js";
import { FileServicesContext } from "../client/DshFiles.js";
import { InboxPage, LibraryPage } from "../client/LibraryPage.js";
import { NavigationIcon } from "../client/NavigationIcon.js";
import css from "../client/Prototype.module.css";
import { LifeHome, TodayTasks } from "../client/TodayPage.js";
import todayCss from "../client/TodayPage.module.css";
import { type Locale, LocaleContext, browserLocale } from "../client/i18n.js";
import type { InboxEntry } from "../types.js";
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
      title: "先去杭州短住一个周末（合成示例）",
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
  const [writing, setWriting] = useState(false);
  const [view, setView] = useState("overview");
  const [query, setQuery] = useState("");
  const [section, setSection] = useState("");
  const [original, setOriginal] = useState<InboxEntry>();
  const [document, setDocument] = useState<string>();
  const [draft, setDraft] = useState("");
  const [result, setResult] = useState("");
  const [completing, setCompleting] = useState(false);
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
        sources: [t("合成示例", "Synthetic samples")],
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
  const explain = () =>
    setNotice(
      t(
        "本预览不运行 AI、日历、导入或连接；请体验示例建议的采纳和完成，完整功能在正式 App。",
        "AI, calendars, imports and connections need the app. Try adopting and completing the sample suggestion here.",
      ),
    );
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
    setCompleting(false);
  }
  const capture = (
    <section className={todayCss.capture}>
      <h2>{t("随手记", "Quick note")}</h2>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          try {
            await store.capture(draft);
            setWriting(false);
            setDraft("");
            setError("");
            setNotice(t("已保存原文，可到资料找回", "Original saved. Find it in Library."));
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          }
        }}
      >
        <label className={css.sr} htmlFor="capture-text">
          {t("随手记一句", "Quick note")}
        </label>
        <textarea
          id="capture-text"
          rows={3}
          maxLength={4000}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t("写一条示例，不要填真实个人资料", "Use sample text, no personal data")}
        />
        <button type="submit" className={css.btn} disabled={!draft.trim()}>
          {t("记下", "Add note")}
        </button>
        <button type="button" className={css.link} onClick={() => setDraft(store.sampleNote)}>
          {t("填入示例原文", "Use sample text")}
        </button>
      </form>
      <button
        type="button"
        className={css.link}
        onClick={() => {
          navigate("records");
          openSection("inbox");
        }}
      >
        {t(`找回已保存的 ${state.notes.length} 条原文 →`, `Find ${state.notes.length} saved originals →`)}
      </button>
    </section>
  );
  return (
    <LocaleContext.Provider value={locale}>
      <FileServicesContext.Provider value={files}>
        <div className={css.app} data-theme={theme === "system" ? undefined : theme} lang={locale}>
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
                ["overview", t("今天", "Today")],
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
          <main className={`${css.content} ${todayCss.page}`}>
            <section className={preview.banner} aria-label={t("示例说明", "About this demo")}>
              <strong>
                {t("浏览器体验 · 小林的合成资料", "Browser demo · a fictional person's synthetic data")}
              </strong>
              <p>
                {t(
                  "试试：记一件事 → 到资料找回；也可浏览方向，或展开示例建议体验采纳与完成。",
                  "Try: write a moment → find it in Library. Browse a direction, or expand the sample suggestion to adopt and complete it.",
                )}
              </p>
              <p className={css.small}>
                {t(
                  "请勿输入真实档案或密钥。改动只在本标签页，刷新保留，可随时重置；浏览器恢复标签页也可能恢复示例。没有上传、云盘或真实 AI 调用。问问、导入、连接、足迹、健康、资讯与方向编辑需正式 App。",
                  "Use sample text only, with no personal files or keys. Changes stay in this tab across refreshes; reset any time. Restoring a tab may restore its demo state. No uploads, cloud connections or live AI. Ask, imports, connections, places, health, news and direction editing need the app.",
                )}
              </p>
            </section>
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
                <p>
                  {t(
                    "清除本标签页的记录与进度，回到最初的示例？",
                    "Clear this tab's notes and progress and restore the starting demo?",
                  )}
                </p>
                <div className={preview.tools}>
                  <button
                    type="button"
                    className={css.btn}
                    onClick={() =>
                      run(() => {
                        store.reset();
                        setResetting(false);
                        setDraft("");
                        setWriting(false);
                        setResult("");
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
              <>
                <LifeHome
                  data={{
                    ...data,
                    notes: state.notes.map((note) => ({
                      file: note.file,
                      text: note.text,
                      date: note.date,
                      status: "received" as const,
                    })),
                  }}
                  firstVisit={state.notes.length === 1}
                  capture={capture}
                  writing={writing}
                  start={() => setWriting(true)}
                  library={() => {
                    navigate("records");
                    openSection("inbox");
                  }}
                  connect={explain}
                  openModule={(id) => (id === "directions" ? navigate("explore") : explain())}
                  handover={explain}
                  memory={explain}
                />
                <details className={preview.banner}>
                  <summary>
                    {t("试试示例建议：采纳 → 完成", "Try a sample suggestion: adopt → complete")}
                  </summary>
                  <TodayTasks
                    data={data}
                    busy={false}
                    complete={() => setCompleting(true)}
                    ask={explain}
                    schedule={explain}
                    review={explain}
                    all={() => {}}
                  />
                  {state.task === "proposed" && (
                    <section className={todayCss.suggestions}>
                      <h2>{t("示例 AI 建议 · 待你决定", "Sample AI suggestion · your decision")}</h2>
                      <p className={css.small}>
                        {t(
                          "预先写好的示例结果，没有调用 AI。采纳后才进入今天。",
                          "A prewritten example, with no AI call. It enters Today only after you adopt it.",
                        )}
                      </p>
                      <p>{data.proposedTasks[0]?.title}</p>
                      <div className={preview.tools}>
                        <button
                          type="button"
                          className={css.btn}
                          onClick={() =>
                            run(() => {
                              store.adopt();
                              setNotice(
                                t("已采纳，下一步已进入今天", "Adopted. Your next step is in Today."),
                              );
                            })
                          }
                        >
                          {t("采纳", "Adopt")}
                        </button>
                        <button type="button" className={css.link} onClick={() => run(store.dismiss)}>
                          {t("不用了", "Not needed")}
                        </button>
                      </div>
                    </section>
                  )}
                  {completing && state.task === "open" && (
                    <form
                      className={preview.banner}
                      onSubmit={(event) => {
                        event.preventDefault();
                        run(() => {
                          store.complete(result);
                          setCompleting(false);
                          setResult("");
                          setNotice(t("已完成并保存示例结果", "Completed with a sample result"));
                        });
                      }}
                    >
                      <label htmlFor="sample-result">{t("记一句示例结果", "Record a sample result")}</label>
                      <textarea
                        id="sample-result"
                        rows={3}
                        maxLength={4000}
                        value={result}
                        onChange={(event) => setResult(event.target.value)}
                      />
                      <div className={preview.tools}>
                        <button
                          type="button"
                          className={css.link}
                          onClick={() =>
                            setResult("示例：约好了周六和朋友聊 20 分钟，先问最近一次遇到的问题。")
                          }
                        >
                          {t("填入示例结果", "Use sample result")}
                        </button>
                        <button type="submit" className={css.btn} disabled={!result.trim()}>
                          {t("完成并记下", "Complete and save")}
                        </button>
                        <button type="button" className={css.link} onClick={() => setCompleting(false)}>
                          {t("取消", "Cancel")}
                        </button>
                      </div>
                    </form>
                  )}
                  {state.task === "done" && (
                    <section className={preview.banner} aria-label={t("已完成", "Completed")}>
                      <h2>{t("已完成 · 用户访谈", "Completed · user interview")}</h2>
                      <p>{state.result}</p>
                    </section>
                  )}
                  {state.task === "skipped" && (
                    <p>{t("已略过示例建议。重置可再体验。", "Suggestion dismissed. Reset to try again.")}</p>
                  )}
                </details>
              </>
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
                    {t("足迹 · 需 App", "Places · app")}
                  </button>
                  <button type="button" disabled>
                    {t("健康 · 需 App", "Health · app")}
                  </button>
                  <button type="button" disabled>
                    {t("资讯 · 需 App", "News · app")}
                  </button>
                  <button type="button" aria-pressed="true">
                    {t("方向", "Directions")}
                  </button>
                </nav>
                <p className={css.small}>
                  {t(
                    "方向页可浏览合成示例；编辑、采纳方向和 AI 生成需正式 App。今天页可体验采纳建议 → 完成。",
                    "Browse a synthetic direction. Editing, adopting directions and AI generation need the app. Try adopting and completing a task in Today.",
                  )}
                </p>
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
