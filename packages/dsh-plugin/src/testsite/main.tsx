import { type ReactNode, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { KaituMark } from "../client/Brand.js";
import { DirectionsPage } from "../client/DirectionsPage.js";
import { DocumentBody } from "../client/DocumentBody.js";
import { FileServicesContext } from "../client/DshFiles.js";
import { HandoverPanel } from "../client/Handover.js";
import { HealthPage } from "../client/HealthPage.js";
import { InboxPage, LibraryPage } from "../client/LibraryPage.js";
import { MapPage } from "../client/MapPage.js";
import { NavigationIcon } from "../client/NavigationIcon.js";
import { NewsPage } from "../client/NewsPage.js";
import css from "../client/Prototype.module.css";
import { LifeHome } from "../client/TodayPage.js";
import todayCss from "../client/TodayPage.module.css";
import { type Locale, LocaleContext, browserLocale } from "../client/i18n.js";
import type { InboxEntry } from "../types.js";
import preview from "./preview.module.css";
import * as store from "./store.js";

const mapOptions = {
  offline: true,
  workerUrl: new URL("./assets/map-worker.js", location.href.split("?")[0]).href,
};
const unavailable = async () => {
  throw new Error(
    "此项需要正式 App；本预览不运行 AI、不读取文件，不读取系统文件。 / This needs the app. No AI or system file access in this preview.",
  );
};
const files = { pickDirectory: unavailable, findFiles: unavailable, openPath: unavailable };
let entryError = "";
const entryUrl = new URL(location.href);
if (entryUrl.searchParams.get("state") === "pending") {
  try {
    store.selectMode("pending");
    // Consume the entry preset so refreshing keeps a suggestion already handled in this tab.
    entryUrl.searchParams.delete("state");
    history.replaceState(null, "", entryUrl);
  } catch (err) {
    entryError = err instanceof Error ? err.message : String(err);
  }
}
function Dialog({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={preview.dialog}
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div className={preview.dialogHead}>
        <h2 id={id}>{title}</h2>
        <button type="button" className={css.link} onClick={close} aria-label="关闭 / Close">
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
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
  const mode = store.mode();
  const [homeKey, setHomeKey] = useState(0);
  const [homeAsk, setHomeAsk] = useState("");
  const [panel, setPanel] = useState<"capture" | "package" | "answer" | "project" | "prompt" | null>(null);
  const [draft, setDraft] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [projectLog, setProjectLog] = useState("");
  const [view, setView] = useState("overview");
  const [query, setQuery] = useState("");
  const [explore, setExplore] = useState("places");
  const [section, setSection] = useState("");
  const [original, setOriginal] = useState<InboxEntry>();
  const [document, setDocument] = useState<string>();
  const [notice, setNotice] = useState("");
  const [error, setError] = useState(entryError || store.loadError());
  const [resetting, setResetting] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark" | "system">("system");
  const [systemDark, setSystemDark] = useState(() => matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const data = store.overview();
  const docs = store.allDocuments();
  const library = {
    inbox: state.notes,
    notes: docs,
    sections: [
      {
        id: "notes",
        title: t("笔记与资料", "Notes and documents"),
        count: docs.length,
        sources: ["小林"],
        latest: null,
      },
      {
        id: "inbox",
        title: t("收件箱", "Inbox"),
        count: state.notes.length,
        sources: [t("随手记", "Quick notes")],
        latest: null,
      },
    ],
  };
  const prompt = (text: string) => {
    setProjectLog(text);
    setPanel("prompt");
  };
  const explain = () => setNotice(t("这项需要正式 App。", "This needs the app."));
  async function saveDraft() {
    setBusy(true);
    try {
      await store.capture(draft);
      setDraft("");
      setPanel(null);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }
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
          data-theme={theme === "system" ? (systemDark ? "dark" : "light") : theme}
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
          <main className={`${css.content} ${todayCss.page} ${preview.main}`}>
            <div className={preview.demoBar} aria-label={t("示例状态", "Demo state")}>
              <span>{t("示例，不会上传。", "Demo. Nothing is uploaded.")}</span>
              <div className={preview.tools}>
                {(
                  [
                    ["new", t("第一次打开", "New user")],
                    ["data", t("有资料", "With data")],
                    ["pending", t("有建议待看", "Suggestions to review")],
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
                        store.selectMode(id);
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
              <LifeHome
                key={homeKey}
                data={data}
                firstVisit={data.empty}
                writing={false}
                capture={null}
                busy={busy}
                start={() => setPanel("capture")}
                ask={explain}
                canAsk
                askError=""
                askText={homeAsk}
                setAskText={setHomeAsk}
                insertSpeech={(text) => setHomeAsk((current) => (current ? `${current}\n${text}` : text))}
                openAtlas={() => {}}
                adopt={(id) => run(() => store.adopt(id))}
                dismiss={(id) => run(() => store.dismiss(id))}
                loadLibrary={store.library}
                loadProjects={store.projects}
                openProject={(slug) => {
                  void store.projects().then((items) => {
                    const project = items.find((item) => item.slug === slug);
                    if (!project?.recentLog) return;
                    setProjectLog(
                      `# ${project.title}\n\n## ${project.recentLog.date}\n\n${project.recentLog.text}`,
                    );
                    setPanel("project");
                  });
                }}
                library={() => {
                  navigate("records");
                  openSection("inbox");
                }}
                memory={() => setPanel("capture")}
                handover={() => navigate("package")}
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
                    <DocumentBody content={docs.find((note) => note.file === document)?.body ?? ""} />
                  </article>
                ) : section === "notes" ? (
                  <section className={css.sec}>
                    {docs.map((note) => (
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
                    onOpenGoal={() => setDocument("me/goals.md")}
                  />
                )}
              </>
            )}
            {view === "package" && (
              <HandoverPanel
                loadHandover={store.handover}
                initialIncludeFinance={false}
                onAnswer={async (answer) => {
                  setDraft(answer);
                  setReviewing(true);
                  setPanel("answer");
                }}
              />
            )}
            {view === "explore" && (
              <>
                <nav className={css.subtabs} aria-label={t("开图里的内容", "Explore sections")}>
                  {[
                    ["places", t("足迹", "Places")],
                    ["health", t("健康", "Health")],
                    ["news", t("资讯", "News")],
                    ["directions", t("方向", "Directions")],
                  ].map(([id, title]) => (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={explore === id}
                      onClick={() => setExplore(id ?? "places")}
                    >
                      {title}
                    </button>
                  ))}
                </nav>
                {explore === "places" && (
                  <MapPage
                    mapOptions={mapOptions}
                    loadLifeMap={store.lifeMap}
                    loadExperienceSource={store.experienceSource}
                    subscribe={store.subscribe}
                    hometownCities={store.hometownCities}
                    saveHometown={store.saveHometown}
                    editExperience={store.editExperience}
                    hideExperience={store.hideExperience}
                    unhideExperience={store.unhideExperience}
                    resolveExperience={unavailable}
                    onPrompt={prompt}
                    loadExperienceImports={store.experienceImports}
                    previewExperienceBatch={unavailable}
                    setExperienceSource={unavailable}
                    changeExperienceBatch={unavailable}
                    recoverExperienceImports={unavailable}
                  />
                )}
                {explore === "health" && (
                  <HealthPage
                    loadHealth={store.loadHealth}
                    loadHealthPhoto={unavailable}
                    subscribe={store.subscribe}
                    onPrompt={prompt}
                    adoptTask={async () => store.adopt()}
                    cancelTask={async () => store.dismiss()}
                  />
                )}
                {explore === "news" && (
                  <NewsPage
                    showEarlierDetails
                    loadNews={store.news}
                    subscribe={store.subscribe}
                    tryNews={store.tryNews}
                    dismissNews={store.dismissNews}
                    feedbackNews={store.feedbackNews}
                    saveNewsKeywords={store.saveNewsKeywords}
                    onPrompt={prompt}
                  />
                )}
                {explore === "directions" && (
                  <DirectionsPage
                    loadExploration={store.exploration}
                    writeExploration={store.writeExploration}
                    loadExplorationSource={store.explorationSource}
                    subscribe={store.subscribe}
                    onPrompt={prompt}
                  />
                )}
              </>
            )}
          </main>
          {panel && (
            <Dialog
              title={
                panel === "capture"
                  ? t("随手记一句", "Quick note")
                  : panel === "package"
                    ? t("选择要带的内容", "Choose what to bring")
                    : panel === "answer"
                      ? t("贴回回答", "Paste answer")
                      : panel === "prompt"
                        ? t("AI 提示词", "AI prompt")
                        : t("项目进展原文", "Project log")
              }
              close={() => {
                if (!busy) setPanel(null);
              }}
            >
              {(panel === "project" || panel === "prompt") && <DocumentBody content={projectLog} />}
              {(panel === "capture" || panel === "answer") && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (panel === "answer" && !reviewing) setReviewing(true);
                    else if (!busy) void saveDraft();
                  }}
                >
                  <label htmlFor="demo-draft">
                    {panel === "answer" ? t("AI 的回答", "AI answer") : t("这一句", "Your sentence")}
                  </label>
                  <textarea
                    id="demo-draft"
                    rows={5}
                    maxLength={4000}
                    value={draft}
                    readOnly={panel === "answer" && reviewing}
                    onChange={(event) => setDraft(event.target.value)}
                  />
                  <div className={preview.tools}>
                    <button type="submit" className={css.btn} disabled={busy || !draft.trim()}>
                      {panel === "answer" && !reviewing ? t("预览", "Preview") : t("保存", "Save")}
                    </button>
                    {panel === "answer" && reviewing ? (
                      <button type="button" className={css.link} onClick={() => setReviewing(false)}>
                        {t("返回修改", "Back to edit")}
                      </button>
                    ) : (
                      <button type="button" className={css.link} onClick={() => setDraft(store.sampleNote)}>
                        {t("填入示例", "Use sample text")}
                      </button>
                    )}
                  </div>
                </form>
              )}
              {notice && <output aria-live="polite">{notice}</output>}
              {error && <p role="alert">{error}</p>}
            </Dialog>
          )}
        </div>
      </FileServicesContext.Provider>
    </LocaleContext.Provider>
  );
}
createRoot(document.getElementById("root") as HTMLElement).render(<App />);
