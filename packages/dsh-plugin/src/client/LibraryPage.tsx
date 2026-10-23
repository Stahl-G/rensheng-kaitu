import type { LibraryQuery, OnboardingMatter, OnboardingMatterDraft, PlansData } from "@kaitu/core";
import { Fragment, useEffect, useRef, useState } from "react";
import type { InboxEntry, LibraryData, OverviewData } from "../types.js";
import type { ChannelRequest, ChannelState } from "./ChannelSettings.js";
import styles from "./InboxPage.module.css";
import { LearningPage, type LearningServices, type LearningSource } from "./LearningPage.js";
import css from "./Prototype.module.css";
import { useT } from "./i18n.js";
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
  inboxCount,
}: { data: LibraryData | null; open: (id: string) => void; inboxCount?: number }) {
  const t = useT();
  const colors: Record<string, string> = {
    calendar: "news",
    projects: "doing",
    health: "health",
    finance: "finance",
    notes: "explore",
    inbox: "me",
  };
  return (
    <section className={css.mods} aria-label={t("各类资料", "Library sections")}>
      {data?.sections.map((item) => {
        const section =
          item.id === "inbox" && inboxCount !== undefined ? { ...item, count: inboxCount } : item;
        return (
          <button
            type="button"
            className={`${css.mod} ${css.card} ${css.summaryButton}`}
            key={section.id}
            onClick={() => open(section.id)}
          >
            <span className={css["sum-h"]}>
              <i className={css.dot} style={{ background: `var(--${colors[section.id]})` }} />
              {t(section.title, LIBRARY_EN[section.id] ?? section.title)}
              <span>›</span>
            </span>
            {section.count === null ? (
              <span className={css["mod-empty"]}>{t("查看资料", "Browse items")}</span>
            ) : section.count || (section.id === "inbox" && inboxCount !== undefined) ? (
              <span className={`${css.big} ${css.num}`}>
                {t(
                  section.id === "inbox" && inboxCount !== undefined
                    ? `${section.count} 条未整理`
                    : `${section.count} ${section.id === "projects" ? "个项目" : "条"}`,
                  section.id === "inbox" && inboxCount !== undefined
                    ? `${section.count} to sort`
                    : `${section.count} ${section.id === "projects" ? (section.count === 1 ? "project" : "projects") : section.count === 1 ? "item" : "items"}`,
                )}
              </span>
            ) : (
              <span className={css["mod-empty"]}>{t("还没有资料", "Nothing yet")}</span>
            )}
            <span className={css.small}>
              {section.sources.map((source, index) => (
                <Fragment key={source}>
                  {index ? t("、", ", ") : ""}
                  <span className={css.nowrap}>{t(source, SOURCE_EN[source] ?? source)}</span>
                </Fragment>
              ))}
              {section.latest && (
                <span className={css.nowrap}>
                  {section.sources.length ? " · " : ""}
                  {t(
                    `${section.id === "calendar" ? "最近同步" : "最近记录"} ${section.latest.slice(0, 10)}`,
                    `${section.id === "calendar" ? "synced" : "latest"} ${section.latest.slice(0, 10)}`,
                  )}
                </span>
              )}
            </span>
          </button>
        );
      }) ?? <p className={css.small}>{t("正在读取资料…", "Loading…")}</p>}
    </section>
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
  const [status, setStatus] = useState<"review" | "all" | "raw">("review");
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
        setStatus((current) =>
          current === "review" && !page.next && !page.inbox.some((row) => row.status === "review")
            ? "all"
            : current,
        );
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
  const filtered = entries?.filter((entry) => status === "all" || entry.status === status) ?? [];
  const selectedEntry = filtered.find((entry) => entry.file === selected) ?? filtered[0];
  const away = overview?.sync.cloudOrganizer?.away;
  const filters = [
    ["all", t("全部", "All")],
    ["me", t("随手记", "Quick notes")],
    ["mail", t("邮件", "Email")],
    ["slack", "Slack"],
    ["feishu", t("飞书", "Feishu")],
    ["other", t("其他原文", "Other")],
  ];
  return (
    <div className={css.sec}>
      {away && (
        <p className={styles.meta}>
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
        {filters.map(([id, label]) => (
          <button type="button" aria-pressed={source === id} key={id} onClick={() => setSource(id as string)}>
            {label}
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
            {(["review", "all", "raw"] as const).map((value) => (
              <button
                type="button"
                key={value}
                aria-pressed={status === value}
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
          <div className={styles.split}>
            <div className={styles.list}>
              {filtered.map((row) => (
                <button
                  type="button"
                  className={styles.entry}
                  key={row.file}
                  aria-pressed={selectedEntry?.file === row.file}
                  onClick={() => setSelected(row.file)}
                >
                  <strong className={styles.preview}>{row.text.split("\n")[0]}</strong>
                  <time className={styles.meta}>
                    {row.date?.slice(0, 16).replace("T", " ") ?? t("时间未记录", "Time not recorded")}
                  </time>
                  <span className={styles.meta}>
                    {t(
                      row.source === "me"
                        ? "随手记"
                        : row.source === "mail"
                          ? "邮件"
                          : row.source === "other"
                            ? "其他原文"
                            : row.source,
                      row.source === "me"
                        ? "Quick note"
                        : row.source === "mail"
                          ? "Email"
                          : row.source === "other"
                            ? "Other"
                            : row.source,
                    )}{" "}
                    ·{" "}
                    {t(
                      row.status === "review"
                        ? "要你核对"
                        : row.status === "organized"
                          ? "已整理"
                          : "只存了原文",
                      row.status === "review"
                        ? "To review"
                        : row.status === "organized"
                          ? "Organized"
                          : "Saved as is",
                    )}
                  </span>
                </button>
              ))}
            </div>
            {selectedEntry && (
              <article className={styles.detail} aria-label={t("这一条原文", "Selected original")}>
                <p className={styles.meta}>
                  {t("原文", "Original")} · {selectedEntry.date?.slice(0, 16).replace("T", " ")}
                </p>
                <blockquote className={styles.original}>{selectedEntry.text}</blockquote>
                {(() => {
                  const destination = sources?.[selectedEntry.file.split("/").at(-1) ?? ""];
                  return destination ? (
                    <button
                      type="button"
                      className={css.link}
                      onClick={() => openNext(destination.taskId, destination.goalId)}
                    >
                      {t(`变成下一步：${destination.title}`, `Next step: ${destination.title}`)}
                    </button>
                  ) : null;
                })()}
                {review && selectedEntry.source === "me" && selectedEntry.status !== "organized" && (
                  <InboxReview
                    key={selectedEntry.file}
                    file={selectedEntry.file}
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
                  selectedEntry.source === "me" &&
                  selectedEntry.status !== "organized" && (
                    <button
                      type="button"
                      className={`${css.btn} ${css["btn-primary"]}`}
                      onClick={() => onReview(selectedEntry.file)}
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
  const save = async (keep = false) => {
    if (busy) return;
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
    <div className={styles.review}>
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
                    maxLength={10000}
                    onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))}
                  />
                </label>
              ))}
              <button
                type="submit"
                className={`${css.btn} ${css["btn-primary"]}`}
                disabled={busy || !draft.next.trim()}
              >
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
                disabled={busy}
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
        <p className={css.small}>{t("决策记录也会显示在这里。", "Your decisions also appear here.")}</p>
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
