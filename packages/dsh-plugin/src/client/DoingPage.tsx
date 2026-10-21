import type { ProjectGoal } from "@kaitu/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DoingData, DoingProject, ProjectDetailData } from "../types.js";
import css from "./DoingPage.module.css";
import { OpenPath } from "./DshFiles.js";
import { type Locale, useLocale, useT } from "./i18n.js";

export interface DoingPageProps {
  loadProjects: () => Promise<DoingProject[]>;
  loadDoing: () => Promise<DoingData>;
  loadProject: (slug: string) => Promise<ProjectDetailData>;
  createProject: (title: string) => Promise<{ slug: string }>;
  bindProjectGithub: (slug: string, repo: string) => Promise<ProjectDetailData>;
  saveProjectGoal: (slug: string, goal: ProjectGoal) => Promise<ProjectDetailData>;
  suggestProjectGoal?: (slug: string) => Promise<ProjectGoal>;
  syncProject: (slug: string) => Promise<unknown>;
  onPrompt: (text: string) => void;
}
const stages = { active: "进行中", paused: "暂停", idea: "想法", done: "完成" };
const roles = { manuscript: "手稿", repo: "仓库", folder: "文件夹" };
const ciStates = {
  success: "通过",
  failure: "失败",
  running: "运行中",
  none: "暂无记录",
  no_access: "暂无记录",
};
const number = (value: number) => value.toLocaleString("zh-CN");

function dateLabel(date: string, today: string, locale: Locale) {
  if (date === today) return locale === "en" ? "Today" : "今天";
  const yesterday = new Date(`${today}T12:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  return date === yesterday.toISOString().slice(0, 10)
    ? locale === "en"
      ? "Yesterday"
      : "昨天"
    : date.slice(5).replace("-", "/");
}

export function Output({ project }: { project: DoingProject }) {
  const t = useT();
  const kind = project.recent7.words !== null ? "words" : "commits";
  const value = project.recent7[kind];
  const unit = kind === "words" ? t("字", "words") : t("次提交", "commits");
  const daily = project.recent7.daily;
  const max = Math.max(1, ...daily.map((day) => Math.abs(day[kind] ?? 0)));
  const label = (value: number | null) =>
    value === null
      ? t("暂无记录", "No records yet")
      : `${kind === "words" ? `${t("约 ", "about ")}${value >= 0 ? "+" : ""}` : ""}${number(value)} ${unit}`;
  return (
    <div className={css.output}>
      <div className={css.paths}>
        <span>
          {t("近 7 天", "Last 7 days")} {label(value)}
        </span>
        {project.links.length ? (
          project.links.map((link) => (
            <span key={`${link.role}:${link.path}`}>
              <span className={css.role}>
                {t(
                  roles[link.role],
                  { manuscript: "Manuscript", repo: "Repository", folder: "Folder" }[link.role],
                )}
                {t("：", ": ")}
              </span>
              <OpenPath path={link.path} />
            </span>
          ))
        ) : (
          <span>{t("链接：暂无记录", "No linked sources yet")}</span>
        )}
      </div>
      {daily.some((day) => day[kind] !== null) && (
        <span
          className={css.chart}
          role="img"
          aria-label={daily
            .map((day) => `${day.date}${t("：", ": ")}${label(day[kind])}`)
            .join(t("，", ", "))}
        >
          {daily.map((day) => (
            <span
              key={day.date}
              className={css.slot}
              data-missing={day[kind] === null}
              title={`${day.date}${t("：", ": ")}${label(day[kind])}`}
            >
              {day[kind] !== null && (
                <span
                  data-negative={day[kind] < 0}
                  style={{ height: `${(Math.abs(day[kind]) / max) * 100}%` }}
                />
              )}
            </span>
          ))}
        </span>
      )}
    </div>
  );
}

export function Repository({
  github,
  today,
  timeZone,
}: {
  github: NonNullable<DoingProject["github"]>;
  today: string;
  timeZone?: string;
}) {
  const t = useT();
  const locale = useLocale();
  const latest = github.latest;
  const stamp = github.ok_at ?? latest?.ts;
  let updated = t("暂无记录", "No records yet");
  if (stamp && Number.isFinite(Date.parse(stamp))) {
    const date = new Intl.DateTimeFormat("sv-SE", { timeZone }).format(new Date(stamp));
    const time = new Intl.DateTimeFormat("zh-CN", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(stamp));
    updated = `${dateLabel(date, today, locale)} ${time}`;
  }
  return (
    <div className={css.repository}>
      <a href={github.url} target="_blank" rel="noreferrer">
        {github.repo}
      </a>
      <div className={css.repoStats}>
        <span>Star {latest ? number(latest.stars) : t("暂无记录", "No records yet")}</span>
        <span>Fork {latest ? number(latest.forks) : t("暂无记录", "No records yet")}</span>
        <span>
          {t("开放 Issue", "Open issues")}{" "}
          {latest ? number(latest.open_issues) : t("暂无记录", "No records yet")}
        </span>
        <span>
          {t("开放 PR", "Open PRs")} {latest ? number(latest.open_prs) : t("暂无记录", "No records yet")}
        </span>
        <span>
          CI{" "}
          {latest
            ? t(
                ciStates[latest.ci.state],
                {
                  success: "Passed",
                  failure: "Failed",
                  running: "Running",
                  none: "No records yet",
                  no_access: "No records yet",
                }[latest.ci.state],
              )
            : t("暂无记录", "No records yet")}
        </span>
        <span>
          {t("最新发布", "Latest release")}{" "}
          {latest?.latest_release ? (
            <a href={latest.latest_release.url} target="_blank" rel="noreferrer">
              {latest.latest_release.name || latest.latest_release.tag}
            </a>
          ) : (
            "暂无记录"
          )}
        </span>
      </div>
      <p>
        {t("最近推送", "Last push")}{" "}
        {latest?.pushed_at
          ? new Date(latest.pushed_at).toLocaleString(locale, { timeZone })
          : t("暂无记录", "No records yet")}
      </p>
      {github.problem && (
        <p className={css.stale}>
          {t(
            "GitHub 更新失败，请检查仓库地址或稍后重试。",
            "Couldn’t refresh GitHub. Check the repository or try again later.",
          )}
        </p>
      )}
      {github.stale && (
        <p className={css.stale}>
          {t("数据过期 · 上次更新", "Out of date · Last updated")} {updated}
        </p>
      )}
    </div>
  );
}

export function DoingPage({
  loadProjects,
  loadDoing,
  onPrompt,
  timeZone,
}: DoingPageProps & { timeZone?: string }) {
  const t = useT();
  const locale = useLocale();
  const [projects, setProjects] = useState<DoingProject[] | null>(null);
  const [doing, setDoing] = useState<DoingData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const seq = ++sequence.current;
    setError(null);
    const results = await Promise.allSettled([loadProjects(), loadDoing()]);
    if (seq !== sequence.current) return;
    if (results[0].status === "fulfilled") setProjects(results[0].value);
    if (results[1].status === "fulfilled") setDoing(results[1].value);
    const errors = results
      .filter((r) => r.status === "rejected")
      .map((r) => (r.reason instanceof Error ? r.reason.message : String(r.reason)));
    if (errors.length) setError(errors.join("；"));
  }, [loadProjects, loadDoing]);
  useEffect(() => {
    void refresh();
    return () => {
      sequence.current++;
    };
  }, [refresh]);
  const ask = (text: string) => {
    try {
      onPrompt(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone }).format(new Date());
  const visible = projects?.filter((project) => expanded || project.stage === "active") ?? [];
  const hidden = projects?.some((project) => project.stage !== "active");
  const empty = projects?.length === 0 && doing?.decisions.length === 0 && doing.learning.length === 0;
  return (
    <div className={css.page} aria-busy={!error && (projects === null || doing === null)}>
      <header className={css.header}>
        <div>
          <h1>
            <span className={css.dot} aria-hidden="true" />
            {t("在做的事", "In progress")}
          </h1>
          <p className={css.subtitle}>{t("项目、学习和正在做的决定", "Projects, learning and decisions")}</p>
        </div>
        <button
          type="button"
          className={css.primary}
          onClick={() => ask(t("帮我新建一个项目：", "Help me create a project:"))}
        >
          {t("新建项目", "New project")}
        </button>
      </header>
      {error && (
        <p className={css.notice} role="alert">
          {error}{" "}
          <button type="button" className={css.link} onClick={() => void refresh()}>
            {t("重新读取", "Reload")}
          </button>
        </p>
      )}
      {!error && (projects === null || doing === null) && (
        <p className={css.muted}>{t("正在读取在做的事…", "Loading…")}</p>
      )}
      {empty && (
        <div className={css.empty}>
          <h2>{t("还没有在做的事", "Nothing in progress yet")}</h2>
          <p>
            {t(
              "和开图聊聊你想推进的事，从一个项目开始。",
              "Tell Kaitu what you want to move forward. Start with a project.",
            )}
          </p>
          <button
            type="button"
            className={css.primary}
            onClick={() => ask(t("帮我新建一个项目：", "Help me create a project:"))}
          >
            {t("新建项目", "New project")}
          </button>
        </div>
      )}
      {!!projects?.length && (
        <section aria-label={t("项目", "Projects")}>
          <div className={css.heading}>
            <h2>{t("项目", "Projects")}</h2>
            {hidden && (
              <button
                type="button"
                className={css.link}
                aria-expanded={expanded}
                onClick={() => setExpanded(!expanded)}
              >
                {expanded
                  ? t("收起", "Show less")
                  : t(`全部 ${projects.length} 个`, `All projects · ${projects.length}`)}
              </button>
            )}
          </div>
          {!visible.length && (
            <p className={css.muted}>
              {t(
                "暂无进行中的项目，展开全部看看，或新建一个项目。",
                "No active projects. Show all projects or create one.",
              )}
            </p>
          )}
          <div className={css.projects}>
            {visible.map((project) => {
              const next = project.next.find((item) => item.status === "todo" || item.status === "proposed");
              return (
                <article className={css.card} data-stage={project.stage} key={project.slug}>
                  <div className={css.cardHeading}>
                    <h3>{project.title}</h3>
                    <div className={css.tags}>
                      <span className={css.kind}>
                        <span className={css.kindDot} aria-hidden="true" />
                        {project.kind === "work"
                          ? t("工作", "Work")
                          : project.kind === "learning"
                            ? t("学习", "Learning")
                            : t("个人", "Personal")}
                      </span>
                      <span className={css.stage}>
                        {t(
                          stages[project.stage],
                          { active: "Active", paused: "Paused", idea: "Idea", done: "Done" }[project.stage],
                        )}
                      </span>
                    </div>
                  </div>
                  <p>
                    <span className={css.muted}>{t("下一步\u3000", "Next step ")}</span>
                    {next?.title ?? t("暂无记录", "No records yet")}
                  </p>
                  <p className={css.log}>
                    {project.recentLog
                      ? `${dateLabel(project.recentLog.date, today, locale)}${t("：", ": ")}${project.recentLog.text}`
                      : t("最近日志：暂无记录", "No recent progress logged")}
                  </p>
                  {project.completion !== null && (
                    <span className={css.muted}>
                      {t("完成度", "Completed")} {number(project.completion.done)} /{" "}
                      {number(project.completion.total)}
                    </span>
                  )}
                  {project.github && <Repository github={project.github} today={today} timeZone={timeZone} />}
                  <Output project={project} />
                  <button
                    type="button"
                    className={`${css.link} ${css.record}`}
                    onClick={() =>
                      ask(
                        t(
                          `帮我给项目「${project.title}」记一次进展：`,
                          `Help me log progress for “${project.title}”:`,
                        ),
                      )
                    }
                  >
                    {t("记一次", "Log progress")}
                  </button>
                </article>
              );
            })}
          </div>
        </section>
      )}
      {(!!doing?.decisions.length || !!doing?.learning.length) && (
        <div className={css.lower}>
          {!!doing?.decisions.length && (
            <section className={css.decisions} aria-label={t("在做的决定", "Decisions in progress")}>
              <div className={css.heading}>
                <h2>{t("在做的决定", "Decisions in progress")}</h2>
              </div>
              {doing.decisions.map((decision) => (
                <div className={css.decision} key={decision.file}>
                  <strong>{decision.title}</strong>
                  <span className={css.status}>{decision.status ?? t("暂无记录", "No records yet")}</span>
                  <span className={css.due}>
                    {decision.due
                      ? t(`${decision.due} 截止`, `Due ${decision.due}`)
                      : t("截止：暂无记录", "No due date")}
                  </span>
                </div>
              ))}
            </section>
          )}
          {!!doing?.learning.length && (
            <section aria-label={t("在学", "Learning")}>
              <div className={css.heading}>
                <h2>{t("在学", "Learning")}</h2>
              </div>
              <div className={css.learning}>
                {doing.learning.map((topic) => (
                  <article className={css.topic} key={topic.file}>
                    <h3>{topic.title}</h3>
                    <p className={css.status}>
                      {topic.progress
                        ? t(
                            `第 ${number(topic.progress.current)} / ${number(topic.progress.target)} 章`,
                            `${number(topic.progress.current)} / ${number(topic.progress.target)} chapters`,
                          )
                        : t("进度：暂无记录", "No progress recorded")}{" "}
                      · {t("下一步：", "Next step: ")}
                      {topic.next ?? t("暂无记录", "No records yet")}
                    </p>
                    {topic.progress && topic.progress.target > 0 && (
                      <progress
                        className={css.progress}
                        aria-label={t(`${topic.title}学习进度`, `${topic.title} learning progress`)}
                        value={Math.max(0, topic.progress.current)}
                        max={topic.progress.target}
                      />
                    )}
                  </article>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
