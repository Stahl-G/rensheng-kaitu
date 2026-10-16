import { Fragment, useEffect, useState } from "react";
import type { LibraryData } from "../types.js";
import type { ChannelRequest, ChannelState } from "./ChannelSettings.js";
import css from "./Prototype.module.css";
import { useT } from "./i18n.js";

const LIBRARY_EN: Record<string, string> = {
  calendar: "Schedule",
  projects: "Projects",
  health: "Health",
  finance: "Finance",
  notes: "Notes and decisions",
  inbox: "Inbox",
};
export interface LibraryProps {
  loadLibrary: () => Promise<LibraryData>;
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
          {section.count ? (
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
                <span className={css.nowrap}>{source}</span>
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
  data,
  channelSettings,
  connect,
}: { data: LibraryData | null; channelSettings?: ChannelRequest; connect: () => void }) {
  const [channels, setChannels] = useState<ChannelState>();
  useEffect(() => {
    void channelSettings?.("list")
      .then((value) => setChannels(value as ChannelState))
      .catch(() => {});
  }, [channelSettings]);
  const [source, setSource] = useState("all");
  const filters = [
    ["all", "全部"],
    ["me", "随手记"],
    ["mail", "邮件"],
    ["slack", "Slack"],
    ["feishu", "飞书"],
    ["other", "其他原文"],
  ];
  const entries = data?.inbox.filter((row) => source === "all" || row.source === source);
  return (
    <div className={css.sec}>
      <div className={css["conn-strip"]}>
        {[
          ["gmail", "Gmail"],
          ["imap", "其他邮箱"],
          ["slack", "Slack"],
          ["feishu", "飞书"],
        ].map(([kind, name]) => {
          const account = channels?.accounts.find((item) => item.kind === kind);
          return (
            <span className={css["conn-pill"]} key={kind}>
              <b>{name}</b>
              {account?.connected ? (
                <span className={css.small}>已连接</span>
              ) : (
                <button className={css.link} type="button" onClick={connect}>
                  去连接
                </button>
              )}
            </span>
          );
        })}
      </div>
      <div className={css.subtabs} role="toolbar" aria-label="来源">
        {filters.map(([id, label]) => (
          <button type="button" aria-pressed={source === id} key={id} onClick={() => setSource(id as string)}>
            {label}
          </button>
        ))}
      </div>
      {!data ? (
        <p className={css.small}>正在读取收件箱…</p>
      ) : !entries?.length ? (
        <p className={css.emptyState}>
          {["mail", "slack", "feishu", "ding"].includes(source)
            ? "这个来源还没有原文记录"
            : "这里还没有原文记录"}
        </p>
      ) : (
        entries.map((row) => (
          <div className={css.raw} key={row.file}>
            <time>
              {row.date?.slice(0, 16).replace("T", " ") ?? "时间未记录"}
              <br />
              <span className={css.small}>
                {row.source === "me"
                  ? "随手记"
                  : row.source === "mail"
                    ? "邮件"
                    : row.source === "slack"
                      ? "Slack"
                      : row.source === "feishu"
                        ? "飞书"
                        : "其他原文"}
              </span>
            </time>
            <blockquote>{row.text}</blockquote>
            <span className={css.st}>
              <span className={css.chip}>
                {row.status === "organized" ? "已整理" : row.status === "review" ? "要你核对" : "只存了原文"}
              </span>
              {row.status === "organized"
                ? (row.destination ?? "整理去向未记录")
                : row.status === "review"
                  ? "请核对原文与相关资料"
                  : "还没整理"}
            </span>
          </div>
        ))
      )}
    </div>
  );
}
export function NotesPage({
  data,
  loadLibraryDocument,
}: { data: LibraryData | null } & Pick<LibraryProps, "loadLibraryDocument">) {
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
      {error && <p role="alert">{error}</p>}
      {file ? (
        <>
          <button type="button" className={css.link} onClick={() => setFile(null)}>
            ← 笔记与决策
          </button>
          <article className={`${css.card} ${css.sum} ${css.detailBody}`}>{body || "正在读取…"}</article>
        </>
      ) : !data ? (
        <p>正在读取…</p>
      ) : !data.notes.length ? (
        <p className={css.emptyState}>还没有笔记或决定</p>
      ) : (
        <div className={`${css.card} ${css["list-card"]}`}>
          {data.notes.map((row) => (
            <button
              type="button"
              className={`${css["note-row"]} ${css.summaryButton}`}
              key={row.file}
              onClick={() => setFile(row.file)}
            >
              <span className={css.chip}>{row.kind}</span>
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
