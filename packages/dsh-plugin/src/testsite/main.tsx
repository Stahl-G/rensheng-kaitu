import { useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { KaituMark } from "../client/Brand.js";
import { InboxPage } from "../client/LibraryPage.js";
import { NavigationIcon } from "../client/NavigationIcon.js";
import css from "../client/Prototype.module.css";
import { TodayTasks } from "../client/TodayPage.js";
import todayCss from "../client/TodayPage.module.css";
import { type Locale, LocaleContext, browserLocale } from "../client/i18n.js";
import preview from "./preview.module.css";
import * as store from "./store.js";

function App() {
  const state = useSyncExternalStore(store.subscribe, store.snapshot);
  const [locale, setLocale] = useState<Locale>(() =>
    browserLocale().toLowerCase().startsWith("zh") ? "zh-CN" : "en",
  );
  const t = (zh: string, en: string) => (locale === "en" ? en : zh);
  const [view, setView] = useState("overview");
  const [draft, setDraft] = useState("");
  const [result, setResult] = useState("");
  const [completing, setCompleting] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState(store.loadError());
  const [resetting, setResetting] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark" | "system">("system");
  const data = store.overview();
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
  function navigate(id: string) {
    setView(id);
    setNotice("");
    setCompleting(false);
  }
  return (
    <LocaleContext.Provider value={locale}>
      <div className={css.app} data-theme={theme === "system" ? undefined : theme} lang={locale}>
        <header className={css.top}>
          <div className={css.brand}>
            <KaituMark size={26} />
            <span>{t("开图", "Kaitu")}</span>
          </div>
          <div className={preview.tools}>
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
            {[["overview", t("今天", "Today")]].map(([id, title]) => (
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
                "本切片：记一条示例原文 → 展开找回；采纳示例建议 → 完成并记结果。资料搜索与开图由下一切片接上。",
                "This slice: save sample text → expand saved originals; adopt a suggestion → finish and record a result. Library search and Explore follow in the next slice.",
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
            <div className={todayCss.layout}>
              <div className={todayCss.left}>
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
                            setNotice(t("已采纳，下一步已进入今天", "Adopted. Your next step is in Today."));
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
              </div>
              <aside className={todayCss.right}>
                <section className={todayCss.capture}>
                  <h2>{t("随手记", "Quick note")}</h2>
                  <form
                    onSubmit={async (event) => {
                      event.preventDefault();
                      try {
                        await store.capture(draft);
                        setDraft("");
                        setError("");
                        setNotice(
                          t("已保存原文，可展开找回", "Original saved. Expand saved originals to find it."),
                        );
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
                </section>
              </aside>
              <details className={css.sec} style={{ gridColumn: "1 / -1" }}>
                <summary>
                  {t(
                    `找回已保存的 ${state.notes.length} 条原文`,
                    `Find ${state.notes.length} saved originals`,
                  )}
                </summary>
                <InboxPage
                  loadLibrary={store.library}
                  loadMediaImage={async () => {
                    throw new Error("Media needs the app; no files are read in this demo.");
                  }}
                  subscribe={store.subscribe}
                  connect={explain}
                  openNext={explain}
                  sources={{}}
                  overview={data}
                />
              </details>
            </div>
          )}
        </main>
      </div>
    </LocaleContext.Provider>
  );
}
createRoot(document.getElementById("root") as HTMLElement).render(<App />);
