import type { LibraryQuery, OnboardingMatter, OnboardingMatterDraft, PlansData } from "@kaitu/core";
import { Fragment, useEffect, useRef, useState } from "react";
import type { InboxEntry, LibraryData, OverviewData } from "../types.js";
import { AgentPhrases } from "./AgentPhrases.js";
import type { ChannelRequest, ChannelState } from "./ChannelSettings.js";
import inboxStyles from "./InboxPage.module.css";
import { LearningPage, type LearningServices, type LearningSource } from "./LearningPage.js";
import styles from "./LibraryPage.module.css";
import css from "./Prototype.module.css";
import { useLocale, useT, versionText } from "./i18n.js";
import type { OnboardingServices } from "./onboarding-services.js";

const SOURCE_EN: Record<string, string> = {
  开图: "Kaitu",
  你记录的: "Recorded by you",
  "本机 AI": "Local AI",
  "Apple 健康": "Apple Health",
  "Apple 健康导入": "Apple Health import",
  日历导入: "Calendar import",
  本机项目档案: "Local project files",
  学习笔记: "Learning notes",
  决策记录: "Decisions",
  随手记: "Quick notes",
  其他原文: "Other",
};
const LIBRARY_EN: Record<string, string> = {
  calendar: "Schedule",
  projects: "Projects",
  health: "Health",
  finance: "Finance",
  notes: "Notes and decisions",
  inbox: "Inbox",
};
export interface LibraryProps extends LearningServices {
  loadLibrary: (query?: LibraryQuery) => Promise<LibraryData>;
  loadLibraryDocument: (file: string) => Promise<string>;
}
export function LibraryPage({
  data,
  open,
  overview,
  capture,
  onAdd,
}: {
  data: LibraryData | null;
  open: (id: string) => void;
  overview?: OverviewData | null;
  capture?: (text: string) => Promise<unknown>;
  onAdd?: (kind: "file" | "phone" | "organizer" | "category") => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const away = overview?.sync.cloudOrganizer?.away;
  const items = data?.inbox ?? [];
  const matches = (value: string) => value.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const recent = items.filter((item) => matches(item.text));
  const hints: Record<string, [string, string]> = {
    calendar: ["添加日程或连接日历", "Add an event or connect a calendar"],
    projects: ["记下正在做的项目", "Add a project you are working on"],
    health: ["记录训练、饮食或睡眠", "Log training, meals or sleep"],
    finance: ["导入账单并核对", "Import and review a statement"],
    notes: ["记下笔记或一个决定", "Save a note or a decision"],
  };
  return (
    <div className={styles.page}>
      <div className={styles.heading}>
        <p>
          {t(
            "你留下的原文，和从中整理出的东西。原文永远保留。",
            "What you've saved, and what Kaitu organized from it. Originals are always kept.",
          )}
        </p>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label={t("搜索资料", "Search library")}
          placeholder={t("搜索原文、分类、笔记", "Search originals, categories and notes")}
        />
      </div>
      <section
        className={styles.inbox}
        aria-label={t("收件箱", "Inbox")}
        onDragOver={(event) => {
          const files = event.dataTransfer.types.includes("Files");
          if ((files && onAdd) || (!files && capture && event.dataTransfer.types.includes("text/plain")))
            event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          if (event.dataTransfer.files.length) {
            onAdd?.("file");
            return;
          }
          const text = event.dataTransfer.getData("text/plain");
          if (capture && text) setDraft(text);
        }}
        onPaste={(event) => {
          if (capture && !(event.target instanceof HTMLTextAreaElement)) {
            const text = event.clipboardData.getData("text/plain");
            if (text) {
              event.preventDefault();
              setDraft(text);
            }
          }
        }}
      >
        <div className={styles.heading}>
          <h2>{t("收件箱", "Inbox")}</h2>
          <button type="button" className={css.link} onClick={() => open("inbox")}>
            {t("查看全部", "View all")} ›
          </button>
        </div>
        {away && (
          <p className={styles.meta}>
            {t(
              `电脑不在时，云端整理员整理了 ${away.actions} 条`,
              `While your computer was off, the cloud organizer sorted ${away.actions} items`,
            )}{" "}
            · {away.returnedAt.slice(0, 16).replace("T", " ")}
          </p>
        )}
        {items.length === 0 && (
          <p>
            {t(
              "所有进来的东西都先放在这里，整理好再分到下面各类。",
              "Everything arrives here first, then is organized into the categories below.",
            )}
          </p>
        )}
        {recent.slice(0, 3).map((item) => (
          <button type="button" className={styles.row} key={item.file} onClick={() => open("inbox")}>
            <time className={styles.meta}>{item.date?.slice(0, 10) ?? ""}</time>
            <span className={styles.preview}>{item.text}</span>
            <span className={css.chip}>
              {t(
                item.status === "review" ? "要你核对" : item.status === "organized" ? "已整理" : "只存了原文",
                item.status === "review"
                  ? "To review"
                  : item.status === "organized"
                    ? "Organized"
                    : "Saved as is",
              )}
            </span>
          </button>
        ))}
        <div className={styles.ways}>
          {onAdd && (
            <button type="button" onClick={() => onAdd("file")}>
              {t("选择导出的资料", "Choose an export")}
            </button>
          )}
          {capture && (
            <button type="button" onClick={() => setDraft("")}>
              {t("粘贴一段对话", "Paste a conversation")}
            </button>
          )}
          {onAdd && (
            <>
              <button type="button" onClick={() => onAdd("phone")}>
                {t("用手机发给开图", "Send from your phone")}
              </button>
              <button type="button" onClick={() => onAdd("organizer")}>
                {t("让 Dot / Grok 挑邮件", "Let Dot / Grok pick email")}
              </button>
            </>
          )}
        </div>
        {draft !== null && capture && (
          <form
            className={styles.capture}
            onSubmit={async (event) => {
              event.preventDefault();
              if (busy || !draft.trim()) return;
              setBusy(true);
              setError("");
              try {
                await capture(draft);
                setDraft(null);
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              {t("原文", "Original text")}
              <textarea
                value={draft}
                maxLength={100000}
                disabled={busy}
                onChange={(event) => setDraft(event.target.value)}
              />
            </label>
            <button type="submit" disabled={busy || !draft.trim()}>
              {busy ? t("正在保存…", "Saving…") : t("保存原文", "Save original")}
            </button>
            <button type="button" disabled={busy} onClick={() => setDraft(null)}>
              {t("取消", "Cancel")}
            </button>
          </form>
        )}
        {error && <p role="alert">{error}</p>}
      </section>
      <h2>{t("整理好的资料", "Organized items")}</h2>
      <section className={styles.categories} aria-label={t("各类资料", "Library sections")}>
        {data?.sections
          .filter(
            (section) =>
              section.id !== "inbox" && matches(`${section.title} ${LIBRARY_EN[section.id] ?? ""}`),
          )
          .map((section) => (
            <button
              type="button"
              className={styles.category}
              key={section.id}
              onClick={() => open(section.id)}
            >
              <strong>{t(section.title, LIBRARY_EN[section.id] ?? section.title)}</strong>
              <span className={`${styles.count} ${section.count === 0 ? styles.meta : ""}`}>
                {section.count ?? "—"}
              </span>
              <span className={styles.meta}>
                {section.count === 0 && hints[section.id]
                  ? t(hints[section.id]?.[0] ?? "", hints[section.id]?.[1] ?? "")
                  : section.sources.map((source) => t(source, SOURCE_EN[source] ?? source)).join(" · ")}
              </span>
              {section.latest && <time className={styles.meta}>{section.latest.slice(0, 10)}</time>}
            </button>
          ))}
        {onAdd && (
          <button type="button" className={styles.category} onClick={() => onAdd("category")}>
            <strong>＋ {t("添加一类", "Add a category")}</strong>
            <span className={styles.meta}>{t("比如工作与求职", "For example, work and jobs")}</span>
          </button>
        )}
        {!data && <output>{t("正在读取资料…", "Loading…")}</output>}
      </section>
      {query && (
        <section aria-label={t("笔记搜索结果", "Matching notes")}>
          {data?.notes
            .filter((note) => matches(note.title))
            .map((note) => (
              <button type="button" className={styles.row} key={note.file} onClick={() => open("notes")}>
                {note.title}
              </button>
            ))}
          {recent.length === 0 && !data?.notes.some((note) => matches(note.title)) && (
            <p className={styles.meta}>{t("没有匹配的原文或笔记", "No matching originals or notes")}</p>
          )}
        </section>
      )}
      {!!overview?.versions.length && (
        <section>
          <div className={styles.heading}>
            <h2>{t("最近的变化", "Recent changes")}</h2>
            {overview.daily && (
              <details>
                <summary>
                  {t("近期回顾", "Recent review")} · {overview.daily.date}
                </summary>
                <div className={css.detailBody}>{overview.daily.body}</div>
              </details>
            )}
          </div>
          {overview.versions.slice(0, 3).map((version) => (
            <div className={styles.row} key={version.oid}>
              <span>{versionText(version.text, locale)}</span>
              <time className={styles.meta}>{version.time.slice(0, 16).replace("T", " ")}</time>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
export function InboxPage({
  loadLibrary,
  subscribe,
  channelSettings,
  connect,
  openNext,
  sources,
  overview,
  onReview,
  review,
}: Pick<LibraryProps, "loadLibrary"> & {
  subscribe?: (refresh: () => void) => () => void;
  channelSettings?: ChannelRequest;
  connect: () => void;
  openNext: (id: string, goalId?: string) => void;
  sources: PlansData["sources"] | undefined;
  overview?: OverviewData | null;
  onReview?: (file: string) => void;
  review?: Pick<
    OnboardingServices,
    "readOnboardingMatter" | "adoptOnboardingMatter" | "keepOnboardingMatter"
  >;
}) {
  const t = useT();
  const [channels, setChannels] = useState<ChannelState>();
  useEffect(() => {
    void channelSettings?.("list")
      .then((value) => setChannels(value as ChannelState))
      .catch(() => {});
  }, [channelSettings]);
  const [source, setSource] = useState("all");
  // null follows the default; an explicit choice survives pagination and refreshes.
  const [status, setStatus] = useState<"review" | "all" | "saved" | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [entries, setEntries] = useState<InboxEntry[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const reload = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    let active = true;
    const load = async () => {
      const seq = ++generation.current;
      setLoading(true);
      try {
        const page = await loadLibrary({ section: "inbox", source });
        if (!active || seq !== generation.current) return;
        setEntries(page.inbox);
        setNext(page.next ?? null);
        setError("");
      } catch (err) {
        if (active && seq === generation.current) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (active && seq === generation.current) setLoading(false);
      }
    };
    reload.current = load;
    setEntries(null);
    void load();
    const off = subscribe?.(() => void load());
    return () => {
      active = false;
      generation.current++;
      off?.();
    };
  }, [loadLibrary, source, subscribe]);
  const more = async () => {
    if (!next || loading) return;
    const seq = generation.current;
    setLoading(true);
    try {
      const page = await loadLibrary({ section: "inbox", source, before: next });
      if (seq !== generation.current) return;
      setEntries((current) => [...(current ?? []), ...page.inbox]);
      setNext(page.next ?? null);
      setError("");
    } catch (err) {
      if (seq === generation.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (seq === generation.current) setLoading(false);
    }
  };
  const activeStatus =
    status ?? (next || entries?.some((entry) => entry.status === "review") ? "review" : "all");
  const destinationFor = (entry: InboxEntry) => sources?.[entry.file.split("/").at(-1) ?? ""];
  const savedAsIs = (entry: InboxEntry) =>
    entry.status === "organized" && !!sources && !entry.destination && !destinationFor(entry);
  const filtered =
    entries?.filter(
      (entry) =>
        activeStatus === "all" || (activeStatus === "saved" ? savedAsIs(entry) : entry.status === "review"),
    ) ?? [];
  const selectedEntry = filtered.find((entry) => entry.file === selected);
  const away = overview?.sync.cloudOrganizer?.away;
  const sourceLabel = (id: string) =>
    id === "all"
      ? t("全部", "All")
      : id === "me"
        ? t("随手记", "Quick note")
        : id === "mail"
          ? t("邮件", "Email")
          : id === "slack"
            ? "Slack"
            : id === "feishu"
              ? t("飞书", "Feishu")
              : t("其他原文", "Other");
  const filters = ["all", "me", "mail", "slack", "feishu", "other"];
  return (
    <div className={css.sec}>
      {away && (
        <p className={inboxStyles.meta}>
          {t(
            `电脑不在时，云端整理员整理了 ${away.actions} 条`,
            `While your computer was off, the cloud organizer sorted ${away.actions} items`,
          )}
        </p>
      )}
      <div className={css["conn-strip"]}>
        {[
          ["gmail", "Gmail"],
          ["imap", t("其他邮箱", "Other email")],
          ["slack", "Slack"],
          ["feishu", t("飞书", "Feishu")],
        ].map(([kind, name]) => {
          const account = channels?.accounts.find((item) => item.kind === kind);
          return (
            <span className={css["conn-pill"]} key={kind}>
              <b>{name}</b>
              {account?.connected ? (
                <span className={css.small}>{t("已连接", "Connected")}</span>
              ) : (
                <button className={css.link} type="button" onClick={connect}>
                  {t("去连接", "Connect")}
                </button>
              )}
            </span>
          );
        })}
      </div>
      <div className={css.subtabs} role="toolbar" aria-label={t("来源", "Source")}>
        {filters.map((id) => (
          <button type="button" aria-pressed={source === id} key={id} onClick={() => setSource(id as string)}>
            {sourceLabel(id)}
          </button>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
      {!entries ? (
        <p className={css.small}>{t("正在读取收件箱…", "Loading inbox…")}</p>
      ) : !entries?.length ? (
        <p className={css.emptyState}>
          {["mail", "slack", "feishu", "ding"].includes(source)
            ? t("这个来源还没有原文记录", "Nothing from this source yet")
            : t("这里还没有原文记录", "Nothing here yet")}
        </p>
      ) : (
        <>
          <div className={css.subtabs} role="toolbar" aria-label={t("看哪些", "Show items")}>
            {(["review", "all", "saved"] as const).map((value) => (
              <button
                type="button"
                key={value}
                aria-pressed={activeStatus === value}
                onClick={() => {
                  setStatus(value);
                  setSelected(null);
                }}
              >
                {t(
                  value === "review" ? "要你核对" : value === "all" ? "全部" : "只存了原文",
                  value === "review" ? "To review" : value === "all" ? "All" : "Saved as is",
                )}
              </button>
            ))}
          </div>
          {filtered.length === 0 && (
            <p className={css.small}>
              {t(
                "这一页没有这类原文，可以切换筛选或加载更多。",
                "No matching originals on this page. Change the filter or load more.",
              )}
            </p>
          )}
          <div className={inboxStyles.split}>
            <div className={inboxStyles.list}>
              {filtered.map((row) => (
                <button
                  type="button"
                  className={inboxStyles.entry}
                  key={row.file}
                  aria-pressed={selectedEntry?.file === row.file}
                  onClick={() => setSelected(row.file)}
                >
                  <strong className={inboxStyles.preview}>{row.text.split("\n")[0]}</strong>
                  <time className={inboxStyles.meta}>
                    {row.date?.slice(0, 16).replace("T", " ") ?? t("时间未记录", "Time not recorded")}
                  </time>
                  <span className={inboxStyles.meta}>
                    {sourceLabel(row.source)} ·{" "}
                    {t(
                      row.status === "review"
                        ? "要你核对"
                        : savedAsIs(row)
                          ? "只存了原文"
                          : row.status === "organized"
                            ? "已整理"
                            : "还没整理",
                      row.status === "review"
                        ? "To review"
                        : savedAsIs(row)
                          ? "Saved as is"
                          : row.status === "organized"
                            ? "Organized"
                            : "Not organized yet",
                    )}
                  </span>
                </button>
              ))}
            </div>
            {selectedEntry && (
              <article className={inboxStyles.detail} aria-label={t("这一条原文", "Selected original")}>
                <p className={inboxStyles.meta}>
                  {t("原文", "Original")} · {selectedEntry.date?.slice(0, 16).replace("T", " ")}
                </p>
                <blockquote className={inboxStyles.original}>{selectedEntry.text}</blockquote>
                {(() => {
                  const destination = destinationFor(selectedEntry);
                  return destination ? (
                    <button
                      type="button"
                      className={css.link}
                      onClick={() => openNext(destination.taskId, destination.goalId)}
                    >
                      {t(`变成下一步：${destination.title}`, `Next step: ${destination.title}`)}
                    </button>
                  ) : savedAsIs(selectedEntry) ? (
                    <p className={styles.meta}>{t("只保留了原文", "Saved as is")}</p>
                  ) : null;
                })()}
                {review && selectedEntry.originalSource && selectedEntry.status !== "organized" && (
                  <InboxReview
                    key={selectedEntry.file}
                    file={selectedEntry.originalSource}
                    services={review}
                    done={() => {
                      setSelected(
                        filtered.find((row) => row.file !== selectedEntry.file && row.status !== "organized")
                          ?.file ?? null,
                      );
                      void reload.current();
                    }}
                    onReview={onReview}
                  />
                )}
                {!review &&
                  onReview &&
                  selectedEntry.originalSource &&
                  selectedEntry.status !== "organized" && (
                    <button
                      type="button"
                      className={`${css.btn} ${css["btn-primary"]}`}
                      onClick={() => onReview(selectedEntry.originalSource as string)}
                    >
                      {t("核对整理结果", "Review organized results")}
                    </button>
                  )}
              </article>
            )}
          </div>
        </>
      )}
      {next && (
        <button type="button" className={css.link} disabled={loading} onClick={() => void more()}>
          {loading ? t("正在读取…", "Loading…") : t("加载更多", "Load more")}
        </button>
      )}
    </div>
  );
}
function InboxReview({
  file,
  services,
  done,
  onReview,
}: {
  file: string;
  services: Pick<
    OnboardingServices,
    "readOnboardingMatter" | "adoptOnboardingMatter" | "keepOnboardingMatter"
  >;
  done: () => void;
  onReview?: (file: string) => void;
}) {
  const t = useT();
  const [matter, setMatter] = useState<OnboardingMatter | null>(null);
  const [draft, setDraft] = useState<OnboardingMatterDraft>({ goal: "", current: "", next: "" });
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void services
      .readOnboardingMatter(file)
      .then((value) => {
        if (active) {
          setMatter(value);
          if (value.draft)
            setDraft({ goal: value.draft.goal, current: value.draft.current, next: value.draft.next });
        }
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      active = false;
    };
  }, [file, services.readOnboardingMatter]);
  const cannotAdopt =
    busy ||
    (["goal", "current", "next"] as const).some((key) => {
      const value = draft[key].trim();
      return (
        (key !== "current" && !value) ||
        value.length > (key === "current" ? 4000 : 2000) ||
        /[\r\n]/.test(value)
      );
    });
  const save = async (keep = false) => {
    if (busy || (!keep && cannotAdopt)) return;
    setBusy(true);
    setError("");
    try {
      if (keep) await services.keepOnboardingMatter(file);
      else await services.adoptOnboardingMatter(file, draft);
      done();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={inboxStyles.review}>
      {error && <p role="alert">{error}</p>}
      {matter?.draft && !matter.draft.paths?.length && (
        <>
          <h2>{t("开图从这里整理出", "Organized from this original")}</h2>
          {editing ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              {(["goal", "current", "next"] as const).map((key) => (
                <label key={key}>
                  {t(
                    key === "goal" ? "想做成的事" : key === "current" ? "已知现状" : "下一步",
                    key === "goal" ? "Goal" : key === "current" ? "Current situation" : "Next step",
                  )}
                  <textarea
                    value={draft[key]}
                    disabled={busy}
                    maxLength={key === "current" ? 4000 : 2000}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        [key]: event.target.value.replace(/[\r\n]+/g, " "),
                      }))
                    }
                  />
                </label>
              ))}
              <button type="submit" className={`${css.btn} ${css["btn-primary"]}`} disabled={cannotAdopt}>
                {t("对，就这样", "Looks right")}
              </button>
            </form>
          ) : (
            <>
              <p>{draft.goal}</p>
              <p>{draft.current}</p>
              <p>
                {draft.next} · {t("进接下来", "Goes to next steps")}
              </p>
              <button
                type="button"
                className={`${css.btn} ${css["btn-primary"]}`}
                disabled={cannotAdopt}
                onClick={() => void save()}
              >
                {t("对，就这样", "Looks right")}
              </button>
            </>
          )}
          <button
            type="button"
            className={css.btn}
            disabled={busy}
            onClick={() => setEditing((value) => !value)}
          >
            {editing ? t("收起编辑", "Close editor") : t("改一下", "Edit")}
          </button>
        </>
      )}
      {!!matter?.draft?.paths?.length && onReview && (
        <button type="button" className={css.btn} onClick={() => onReview(file)}>
          {t("核对方向与尝试", "Review directions and experiments")}
        </button>
      )}
      {matter && (
        <button type="button" className={css.link} disabled={busy} onClick={() => void save(true)}>
          {busy ? t("正在保存…", "Saving…") : t("只存原文", "Keep original only")}
        </button>
      )}
    </div>
  );
}
export function NotesPage({
  data,
  loadLibraryDocument,
  ...learning
}: {
  data: LibraryData | null;
  topic: string;
  onTopic: (topic: string) => void;
  source?: LearningSource;
  onSourceConsumed: () => void;
  onPrompt: (text: string) => void;
  onSaved: () => void;
} & Pick<LibraryProps, "loadLibraryDocument"> &
  LearningServices) {
  const t = useT();
  const [file, setFile] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setBody("");
    setError("");
    if (file)
      void loadLibraryDocument(file)
        .then((text) => {
          if (active) setBody(text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, ""));
        })
        .catch((err) => {
          if (active) setError(err instanceof Error ? err.message : String(err));
        });
    return () => {
      active = false;
    };
  }, [file, loadLibraryDocument]);
  return (
    <div className={css.sec}>
      <LearningPage {...learning} data={data} />
      {error && <p role="alert">{error}</p>}
      {file ? (
        <>
          <button type="button" className={css.link} onClick={() => setFile(null)}>
            {t("← 笔记与决策", "← Notes and decisions")}
          </button>
          <article className={`${css.card} ${css.sum} ${css.detailBody}`}>
            {body || t("正在读取…", "Loading…")}
          </article>
        </>
      ) : !data ? (
        <p>{t("正在读取…", "Loading…")}</p>
      ) : !data.notes.some((item) => !item.file.startsWith("learning/")) ? (
        <>
          <p className={css.small}>{t("决策记录也会显示在这里。", "Your decisions also appear here.")}</p>
          <AgentPhrases />
        </>
      ) : (
        <div className={`${css.card} ${css["list-card"]}`}>
          {data.notes
            .filter((item) => !item.file.startsWith("learning/"))
            .map((row) => (
              <button
                type="button"
                className={`${css["note-row"]} ${css.summaryButton}`}
                key={row.file}
                onClick={() => setFile(row.file)}
              >
                <span className={css.chip}>{t(row.kind, row.kind === "决定" ? "Decision" : "Note")}</span>
                <span className={css.stack}>
                  <b>{row.title}</b>
                  <span className={css.small}>{row.status ?? row.file}</span>
                </span>
                <span>›</span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
