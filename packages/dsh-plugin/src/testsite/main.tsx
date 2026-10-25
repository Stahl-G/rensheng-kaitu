import { type ReactNode, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { KaituMark } from "../client/Brand.js";
import { DirectionsPage } from "../client/DirectionsPage.js";
import { DocumentBody } from "../client/DocumentBody.js";
import { FileServicesContext } from "../client/DshFiles.js";
import { InboxPage, LibraryPage } from "../client/LibraryPage.js";
import { NavigationIcon } from "../client/NavigationIcon.js";
import css from "../client/Prototype.module.css";
import { LifeHome } from "../client/TodayPage.js";
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
  const [panel, setPanel] = useState<"capture" | "package" | "answer" | "project" | null>(null);
  const [draft, setDraft] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [projectLog, setProjectLog] = useState("");
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
  const candidates = [
    ...state.notes.map((note) => ({ id: note.file, title: note.text.slice(0, 70), text: note.text })),
    ...data.plans.goals.map((goal) => ({
      id: goal.id,
      title: goal.title,
      text: [goal.title, goal.next?.title, goal.lastResult].filter(Boolean).join("\n"),
    })),
  ];
  const packageText = candidates
    .filter((item) => selected.includes(item.id))
    .map((item) => item.text)
    .join("\n\n");
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
                save={store.capture}
                complete={async () => store.complete()}
                adopt={() => run(store.adopt)}
                dismiss={() => run(store.dismiss)}
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
                source={(entry) => {
                  navigate("records");
                  setSection("inbox");
                  setOriginal(state.notes.find((note) => note.file === entry.file));
                }}
                library={() => {
                  navigate("records");
                  openSection("inbox");
                }}
                addNext={explain}
                memory={() => setPanel("capture")}
                handover={() => {
                  setSelected([]);
                  setPanel("package");
                }}
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
                      setNotice(t("点健康数字可看来源记录。", "Select a health number to read its sources."));
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
          {panel && (
            <Dialog
              title={
                panel === "capture"
                  ? t("随手记一句", "Quick note")
                  : panel === "package"
                    ? t("选择要带的内容", "Choose what to bring")
                    : panel === "answer"
                      ? t("贴回回答", "Paste answer")
                      : t("项目进展原文", "Project log")
              }
              close={() => {
                if (!busy) setPanel(null);
              }}
            >
              {panel === "project" && <DocumentBody content={projectLog} />}
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
              {panel === "package" && (
                <>
                  <div className={preview.choices}>
                    {candidates.map((item) => (
                      <label key={item.id}>
                        <input
                          type="checkbox"
                          checked={selected.includes(item.id)}
                          onChange={(event) =>
                            setSelected(
                              event.target.checked
                                ? [...selected, item.id]
                                : selected.filter((id) => id !== item.id),
                            )
                          }
                        />
                        <span>{item.title}</span>
                      </label>
                    ))}
                  </div>
                  <label htmlFor="package-preview">{t("将复制的内容", "To be copied")}</label>
                  <textarea id="package-preview" rows={6} value={packageText} readOnly />
                  <div className={preview.tools}>
                    <button
                      type="button"
                      className={css.btn}
                      disabled={!packageText}
                      onClick={() => {
                        void navigator.clipboard
                          .writeText(packageText)
                          .then(() => setNotice(t("已复制", "Copied")))
                          .catch(() =>
                            setError(
                              t(
                                "复制失败，可以手动选中上面的内容。",
                                "Couldn't copy. Select the text above instead.",
                              ),
                            ),
                          );
                      }}
                    >
                      {t("复制所选内容", "Copy selected content")}
                    </button>
                    <button
                      type="button"
                      className={css.link}
                      onClick={() => {
                        setDraft("");
                        setReviewing(false);
                        setPanel("answer");
                      }}
                    >
                      {t("贴回回答", "Paste answer")}
                    </button>
                  </div>
                </>
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
