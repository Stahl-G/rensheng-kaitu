import type { ProjectGoal } from "@kaitu/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DoingData, DoingProject, ProjectDetailData } from "../types.js";
import css from "./DoingPage.module.css";
import { OpenPath } from "./DshFiles.js";

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

function dateLabel(date: string, today: string) {
  if (date === today) return "今天";
  const yesterday = new Date(`${today}T12:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  return date === yesterday.toISOString().slice(0, 10) ? "昨天" : date.slice(5).replace("-", "/");
}

export function Output({ project }: { project: DoingProject }) {
  const kind = project.recent7.words !== null ? "words" : "commits";
  const value = project.recent7[kind];
  const unit = kind === "words" ? "字" : "次提交";
  const daily = project.recent7.daily;
  const max = Math.max(1, ...daily.map((day) => Math.abs(day[kind] ?? 0)));
  const label = (value: number | null) =>
    value === null
      ? "暂无记录"
      : `${kind === "words" ? `约 ${value >= 0 ? "+" : ""}` : ""}${number(value)} ${unit}`;
  return (
    <div className={css.output}>
      <div className={css.paths}>
        <span>近 7 天 {label(value)}</span>
        {project.links.length ? (
          project.links.map((link) => (
            <span key={`${link.role}:${link.path}`}>
              <span className={css.role}>{roles[link.role]}：</span>
              <OpenPath path={link.path} />
            </span>
          ))
        ) : (
          <span>链接：暂无记录</span>
        )}
      </div>
      {daily.some((day) => day[kind] !== null) && (
        <span
          className={css.chart}
          role="img"
          aria-label={daily.map((day) => `${day.date}：${label(day[kind])}`).join("，")}
        >
          {daily.map((day) => (
            <span
              key={day.date}
              className={css.slot}
              data-missing={day[kind] === null}
              title={`${day.date}：${label(day[kind])}`}
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
  const latest = github.latest;
  const stamp = github.ok_at ?? latest?.ts;
  let updated = "暂无记录";
  if (stamp && Number.isFinite(Date.parse(stamp))) {
    const date = new Intl.DateTimeFormat("sv-SE", { timeZone }).format(new Date(stamp));
    const time = new Intl.DateTimeFormat("zh-CN", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(stamp));
    updated = `${dateLabel(date, today)} ${time}`;
  }
  return (
    <div className={css.repository}>
      <a href={github.url} target="_blank" rel="noreferrer">
        {github.repo}
      </a>
      <div className={css.repoStats}>
        <span>Star {latest ? number(latest.stars) : "暂无记录"}</span>
        <span>Fork {latest ? number(latest.forks) : "暂无记录"}</span>
        <span>开放 Issue {latest ? number(latest.open_issues) : "暂无记录"}</span>
        <span>开放 PR {latest ? number(latest.open_prs) : "暂无记录"}</span>
        <span>CI {latest ? ciStates[latest.ci.state] : "暂无记录"}</span>
        <span>
          最新发布{" "}
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
        最近推送{" "}
        {latest?.pushed_at ? new Date(latest.pushed_at).toLocaleString("zh-CN", { timeZone }) : "暂无记录"}
      </p>
      {github.problem && <p className={css.stale}>GitHub 更新失败，请检查仓库地址或稍后重试。</p>}
      {github.stale && <p className={css.stale}>数据过期 · 上次更新 {updated}</p>}
    </div>
  );
}

export function DoingPage({
  loadProjects,
  loadDoing,
  onPrompt,
  timeZone,
}: DoingPageProps & { timeZone?: string }) {
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
            在做的事
          </h1>
          <p className={css.subtitle}>项目、学习和正在做的决定</p>
        </div>
        <button type="button" className={css.primary} onClick={() => ask("帮我新建一个项目：")}>
          新建项目
        </button>
      </header>
      {error && (
        <p className={css.notice} role="alert">
          {error}{" "}
          <button type="button" className={css.link} onClick={() => void refresh()}>
            重新读取
          </button>
        </p>
      )}
      {!error && (projects === null || doing === null) && <p className={css.muted}>正在读取在做的事…</p>}
      {empty && (
        <div className={css.empty}>
          <h2>还没有在做的事</h2>
          <p>和开图聊聊你想推进的事，从一个项目开始。</p>
          <button type="button" className={css.primary} onClick={() => ask("帮我新建一个项目：")}>
            新建项目
          </button>
        </div>
      )}
      {!!projects?.length && (
        <section aria-label="项目">
          <div className={css.heading}>
            <h2>项目</h2>
            {hidden && (
              <button
                type="button"
                className={css.link}
                aria-expanded={expanded}
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? "收起" : `全部 ${projects.length} 个`}
              </button>
            )}
          </div>
          {!visible.length && <p className={css.muted}>暂无进行中的项目，展开全部看看，或新建一个项目。</p>}
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
                        {project.kind === "work" ? "工作" : "个人"}
                      </span>
                      <span className={css.stage}>{stages[project.stage]}</span>
                    </div>
                  </div>
                  <p>
                    <span className={css.muted}>下一步　</span>
                    {next?.title ?? "暂无记录"}
                  </p>
                  <p className={css.log}>
                    {project.recentLog
                      ? `${dateLabel(project.recentLog.date, today)}：${project.recentLog.text}`
                      : "最近日志：暂无记录"}
                  </p>
                  {project.completion !== null && (
                    <span className={css.muted}>
                      完成度 {number(project.completion.done)} / {number(project.completion.total)}
                    </span>
                  )}
                  {project.github && <Repository github={project.github} today={today} timeZone={timeZone} />}
                  <Output project={project} />
                  <button
                    type="button"
                    className={`${css.link} ${css.record}`}
                    onClick={() => ask(`帮我给项目「${project.title}」记一次进展：`)}
                  >
                    记一次
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
            <section className={css.decisions} aria-label="在做的决定">
              <div className={css.heading}>
                <h2>在做的决定</h2>
              </div>
              {doing.decisions.map((decision) => (
                <div className={css.decision} key={decision.file}>
                  <strong>{decision.title}</strong>
                  <span className={css.status}>{decision.status ?? "暂无记录"}</span>
                  <span className={css.due}>{decision.due ? `${decision.due} 截止` : "截止：暂无记录"}</span>
                </div>
              ))}
            </section>
          )}
          {!!doing?.learning.length && (
            <section aria-label="在学">
              <div className={css.heading}>
                <h2>在学</h2>
              </div>
              <div className={css.learning}>
                {doing.learning.map((topic) => (
                  <article className={css.topic} key={topic.file}>
                    <h3>{topic.title}</h3>
                    <p className={css.status}>
                      {topic.progress
                        ? `第 ${number(topic.progress.current)} / ${number(topic.progress.target)} 章`
                        : "进度：暂无记录"}{" "}
                      · 下一步：{topic.next ?? "暂无记录"}
                    </p>
                    {topic.progress && topic.progress.target > 0 && (
                      <progress
                        className={css.progress}
                        aria-label={`${topic.title}学习进度`}
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
