import type { LibraryQuery } from "@kaitu/core";
import { Fragment, useEffect, useRef, useState } from "react";
import type { InboxEntry, LibraryData } from "../types.js";
import type { ChannelRequest, ChannelState } from "./ChannelSettings.js";
import { LearningPage, type LearningServices, type LearningSource } from "./LearningPage.js";
import css from "./Prototype.module.css";
import { useT } from "./i18n.js";

const SOURCE_EN: Record<string, string> = {
  你记录的: "Recorded by you",
  "本机 AI": "Local AI",
  "Apple 健康": "Apple Health",
  "Apple 健康导入": "Apple Health import",
  日历导入: "Calendar import",
  本机项目档案: "Local project files",
  学习笔记: "Learning notes",
  决策记录: "Decisions",
  随手记: "Quick notes",
  其他原文: "Other originals",
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
export function LibraryPage({ data, open }: { data: LibraryData | null; open: (id: string) => void }) {
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
      {data?.sections.map((section) => (
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
          ) : section.count ? (
            <span className={`${css.big} ${css.num}`}>
              {t(
                `${section.count} ${section.id === "projects" ? "个项目" : "条"}`,
                `${section.count} ${section.id === "projects" ? "projects" : "items"}`,
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
      )) ?? <p className={css.small}>{t("正在读取资料…", "Loading…")}</p>}
    </section>
  );
}
export function InboxPage({
  loadLibrary,
  subscribe,
  channelSettings,
  connect,
}: Pick<LibraryProps, "loadLibrary"> & {
  subscribe?: (refresh: () => void) => () => void;
  channelSettings?: ChannelRequest;
  connect: () => void;
}) {
  const t = useT();
  const [channels, setChannels] = useState<ChannelState>();
  useEffect(() => {
    void channelSettings?.("list")
      .then((value) => setChannels(value as ChannelState))
      .catch(() => {});
  }, [channelSettings]);
  const [source, setSource] = useState("all");
  const [entries, setEntries] = useState<InboxEntry[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
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
  const filters = [
    ["all", t("全部", "All")],
    ["me", t("随手记", "Quick notes")],
    ["mail", t("邮件", "Email")],
    ["slack", "Slack"],
    ["feishu", t("飞书", "Feishu")],
    ["other", t("其他原文", "Other originals")],
  ];
  return (
    <div className={css.sec}>
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
            ? t("这个来源还没有原文记录", "No originals from this source yet")
            : t("这里还没有原文记录", "No originals yet")}
        </p>
      ) : (
        entries.map((row) => (
          <div className={css.raw} key={row.file}>
            <time>
              {row.date?.slice(0, 16).replace("T", " ") ?? t("时间未记录", "Time not recorded")}
              <br />
              <span className={css.small}>
                {row.source === "me"
                  ? t("随手记", "Quick note")
                  : row.source === "mail"
                    ? t("邮件", "Email")
                    : row.source === "slack"
                      ? "Slack"
                      : row.source === "feishu"
                        ? t("飞书", "Feishu")
                        : t("其他原文", "Other original")}
              </span>
            </time>
            <blockquote>{row.text}</blockquote>
            <span className={css.st}>
              <span className={css.chip}>
                {row.status === "organized"
                  ? t("已整理", "Organized")
                  : row.status === "review"
                    ? t("要你核对", "Needs review")
                    : t("只存了原文", "Text saved")}
              </span>
              {row.status === "organized"
                ? (row.destination ?? t("整理去向未记录", "Destination not recorded"))
                : row.status === "review"
                  ? t("请核对原文与相关资料", "Review the original and related items")
                  : t("还没整理", "Not organized yet")}
            </span>
          </div>
        ))
      )}
      {next && (
        <button type="button" className={css.link} disabled={loading} onClick={() => void more()}>
          {loading ? t("正在读取…", "Loading…") : t("加载更多", "Load more")}
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
