import type { ProjectGoal } from "@kaitu/core";
import { useEffect, useState } from "react";
import type { DoingProject, ProjectDetailData } from "../types.js";
import { type DoingPageProps, Output, Repository } from "./DoingPage.js";
import css from "./DoingPage.module.css";

function Progress({ project }: { project: DoingProject & { progress?: ProjectGoal | null } }) {
  const completion = project.completion;
  return completion && completion.total > 0 ? (
    <div>
      <p>
        {project.progress?.label ?? (completion.basis === "tasks" ? "待办完成" : "进度")}：
        {completion.done.toLocaleString("zh-CN")} / {completion.total.toLocaleString("zh-CN")}{" "}
        {project.progress?.unit}
      </p>
      <progress className={css.progress} value={Math.max(0, completion.done)} max={completion.total} />
    </div>
  ) : (
    <p className={css.muted}>还没有量化目标，打开项目设置一个。</p>
  );
}

function GoalForm({
  project,
  save,
  suggest,
  ask,
  busy,
}: {
  project: ProjectDetailData;
  save: (goal: ProjectGoal) => void;
  suggest?: () => Promise<ProjectGoal>;
  ask: () => void;
  busy: boolean;
}) {
  const [goal, setGoal] = useState<ProjectGoal>(
    project.progress ?? { label: "", current: 0, target: 1, unit: "" },
  );
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState("");
  const [proposed, setProposed] = useState(false);
  return (
    <form
      className={css.form}
      onSubmit={(event) => {
        event.preventDefault();
        save(goal);
      }}
    >
      <div className={css.actions}>
        <h3>量化目标</h3>
        <button
          type="button"
          className={css.link}
          disabled={busy || thinking}
          onClick={async () => {
            if (!suggest) return ask();
            setThinking(true);
            setError("");
            try {
              setGoal(await suggest());
              setProposed(true);
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            } finally {
              setThinking(false);
            }
          }}
        >
          {thinking ? "正在提议目标…" : "让 AI 提议目标"}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {proposed && <p className={css.muted}>AI 提议，可以修改，确认后才保存。</p>}
      <label>
        目标名称
        <input
          required
          value={goal.label}
          onChange={(event) => setGoal({ ...goal, label: event.target.value })}
        />
      </label>
      <div className={css.fields}>
        <label>
          当前数值
          <input
            required
            type="number"
            min="0"
            step="any"
            value={goal.current}
            onChange={(event) => setGoal({ ...goal, current: event.target.valueAsNumber })}
          />
        </label>
        <label>
          目标数值
          <input
            required
            type="number"
            min="0.000001"
            step="any"
            value={goal.target}
            onChange={(event) => setGoal({ ...goal, target: event.target.valueAsNumber })}
          />
        </label>
        <label>
          单位
          <input
            list="project-units"
            value={goal.unit ?? ""}
            onChange={(event) => setGoal({ ...goal, unit: event.target.value })}
          />
        </label>
      </div>
      <datalist id="project-units">
        <option value="字" />
        <option value="次提交" />
        <option value="次" />
        <option value="版" />
      </datalist>
      <p className={css.muted}>
        「字」随关联手稿同步，「次提交」按关联仓库已统计的提交累计；其他单位可手动更新。
      </p>
      <button className={css.primary} disabled={busy || thinking} type="submit">
        确认并保存目标
      </button>
    </form>
  );
}

function Curve({ project }: { project: ProjectDetailData }) {
  const kind =
    project.progress?.unit === "字" ? "words" : project.progress?.unit === "次提交" ? "commits" : null;
  let total = 0;
  const points = project.metrics
    .filter((row) => row.kind === kind)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((row) => {
      total = kind === "commits" ? total + row.value : row.value;
      return { ...row, value: total };
    });
  const max = Math.max(1, ...points.map((row) => row.value));
  return (
    <section>
      <h3>进度曲线</h3>
      {points.length ? (
        <>
          <svg viewBox="0 0 300 90" className={css.curve} role="img" aria-label="项目进度随时间变化">
            <polyline
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              points={points
                .map(
                  (row, i) =>
                    `${10 + (i * 280) / Math.max(1, points.length - 1)},${80 - (row.value * 70) / max}`,
                )
                .join(" ")}
            />
            {points.map((row, i) => (
              <circle
                key={row.date}
                cx={10 + (i * 280) / Math.max(1, points.length - 1)}
                cy={80 - (row.value * 70) / max}
                r="3"
              >
                <title>
                  {row.date}：{row.value}
                </title>
              </circle>
            ))}
          </svg>
          <p className={css.muted}>
            {points[0]?.date} — {points.at(-1)?.date} · 最近 {points.at(-1)?.value} {project.progress?.unit}
          </p>
        </>
      ) : (
        <p className={css.muted}>还没有可绘制的进度，关联手稿或仓库后同步一次。</p>
      )}
    </section>
  );
}

export function ProjectsPage(props: DoingPageProps & { timeZone?: string }) {
  const [projects, setProjects] = useState<DoingProject[] | null>(null);
  const [project, setProject] = useState<ProjectDetailData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [repo, setRepo] = useState("");
  const [binding, setBinding] = useState(false);
  useEffect(() => {
    let active = true;
    void props
      .loadProjects()
      .then((data) => {
        if (active) setProjects(data);
      })
      .catch((err) => {
        if (active) setError(String(err.message ?? err));
      });
    return () => {
      active = false;
    };
  }, [props.loadProjects]);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  const open = async (slug: string) => {
    const detail = await props.loadProject(slug);
    setProject(detail);
    setRepo(detail.github?.repo ?? "");
    setBinding(false);
  };
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: props.timeZone }).format(new Date());
  const refresh = async () => {
    if (project) await open(project.slug);
    setProjects(await props.loadProjects());
  };
  const github = (item: DoingProject) =>
    item.github ? <Repository github={item.github} today={today} timeZone={props.timeZone} /> : null;
  return (
    <div className={css.page} aria-busy={busy}>
      {error && <p role="alert">{error}</p>}
      {project ? (
        <>
          <button type="button" className={css.link} disabled={busy} onClick={() => setProject(null)}>
            ← 全部项目
          </button>
          <header className={css.header}>
            <h2>{project.title}</h2>
            <button
              type="button"
              className={css.primary}
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const result = (await props.syncProject(project.slug)) as
                    | { issues?: { message: string }[] }
                    | undefined;
                  await refresh();
                  if (result?.issues?.length)
                    setError(result.issues.map((issue) => issue.message).join("；"));
                })
              }
            >
              {busy ? "正在处理…" : "同步进度"}
            </button>
          </header>
          <section className={css.card}>
            <h3>目标与现状</h3>
            <p className={css.body}>
              {project.body.replace(/^#\s+.*\n?/, "") || "记下项目目标，让下一步更明确。"}
            </p>
            <Progress project={project} />
            <GoalForm
              key={`${project.slug}:${JSON.stringify(project.progress)}`}
              project={project}
              busy={busy}
              save={(goal) =>
                void run(async () => {
                  await props.saveProjectGoal(project.slug, goal);
                  await refresh();
                })
              }
              suggest={
                props.suggestProjectGoal
                  ? () => props.suggestProjectGoal?.(project.slug) as Promise<ProjectGoal>
                  : undefined
              }
              ask={() =>
                props.onPrompt(
                  `请为项目「${project.title}」提议一个可量化目标，说明当前值、目标值和单位，不要写入，等我在项目详情确认。`,
                )
              }
            />
          </section>
          <section className={css.card}>
            <h3>下一步</h3>
            {project.next.length ? (
              project.next.map((item) => (
                <p key={item.id}>
                  {item.title} ·{" "}
                  {{ todo: "待做", proposed: "待确认", done: "已完成", skipped: "已跳过" }[item.status]}
                </p>
              ))
            ) : (
              <p className={css.muted}>还没有下一步，和开图聊聊接下来做什么。</p>
            )}
          </section>
          <div className={css.card}>
            <Curve project={project} />
            <Output project={project} />
          </div>
          <section className={css.card}>
            <h3>GitHub</h3>
            {github(project)}
            <button type="button" className={css.link} disabled={busy} onClick={() => setBinding(!binding)}>
              {project.github ? "更换 GitHub 仓库" : "绑定 GitHub 仓库"}
            </button>
            {binding && (
              <form
                className={css.form}
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(async () => {
                    await props.bindProjectGithub(project.slug, repo);
                    await refresh();
                  });
                }}
              >
                <label>
                  仓库地址
                  <input
                    placeholder="owner/repo"
                    required
                    value={repo}
                    onChange={(event) => setRepo(event.target.value)}
                  />
                </label>
                <button type="submit" className={css.primary} disabled={busy}>
                  校验并绑定
                </button>
              </form>
            )}
            {!!project.github?.latest?.commits.length && (
              <details>
                <summary>最近 {project.github.latest.commits.length} 条提交</summary>
                {project.github.latest.commits.map((commit) => (
                  <p key={commit.sha}>
                    {commit.date.slice(0, 10)} · {commit.title}
                  </p>
                ))}
              </details>
            )}
          </section>
          <section className={css.card}>
            <h3>最近日志</h3>
            {project.logs.length ? (
              project.logs.slice(0, 20).map((log) => (
                <div key={log.date}>
                  <h4>{log.date}</h4>
                  <p className={css.body}>{log.text}</p>
                </div>
              ))
            ) : (
              <p className={css.muted}>还没有日志，记下一次实际进展。</p>
            )}
            <button
              type="button"
              className={css.link}
              onClick={() => props.onPrompt(`帮我给项目「${project.title}」记一次进展：`)}
            >
              记一次进展
            </button>
          </section>
          <section className={css.card}>
            <h3>来源</h3>
            {project.links.map((link) => (
              <p key={link.path}>
                <span className={css.role}>
                  {{ repo: "仓库", manuscript: "手稿", folder: "文件夹" }[link.role]}
                </span>{" "}
                {link.path}
              </p>
            ))}
            {project.sources.map((file) => (
              <p key={file} className={css.muted}>
                {file}
              </p>
            ))}
          </section>
        </>
      ) : (
        <>
          <header className={css.header}>
            <p className={css.muted}>打开一个项目，查看目标、进度和来源。</p>
            <button type="button" className={css.primary} onClick={() => setCreating(!creating)}>
              新建项目
            </button>
          </header>
          {creating && (
            <form
              className={css.form}
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  const result = await props.createProject(title);
                  setCreating(false);
                  setTitle("");
                  await open(result.slug);
                  setProjects(await props.loadProjects());
                });
              }}
            >
              <label>
                项目名称
                <input required value={title} onChange={(event) => setTitle(event.target.value)} />
              </label>
              <button type="submit" disabled={busy} className={css.primary}>
                创建并设置目标
              </button>
            </form>
          )}
          {!projects ? (
            <p className={css.muted}>正在读取项目…</p>
          ) : !projects.length ? (
            <p className={css.muted}>还没有项目，先记下一件想推进的事。</p>
          ) : (
            <div className={css.projects}>
              {projects.map((item) => (
                <article className={css.card} key={item.slug}>
                  <div className={css.cardHeading}>
                    <button
                      type="button"
                      className={css.title}
                      disabled={busy}
                      onClick={() => void run(() => open(item.slug))}
                    >
                      {item.title} →
                    </button>
                    <span className={css.stage}>
                      {{ active: "进行中", paused: "暂停", done: "完成", idea: "想法" }[item.stage]}
                    </span>
                  </div>
                  <Progress project={item} />
                  <p>
                    下一步：
                    {item.next.find((next) => next.status === "todo" || next.status === "proposed")?.title ??
                      "还没有下一步"}
                  </p>
                  {item.recentLog && (
                    <p className={css.log}>
                      {item.recentLog.date} · {item.recentLog.text}
                    </p>
                  )}
                  {github(item)}
                  <div className={css.actions}>
                    <button
                      type="button"
                      className={css.link}
                      disabled={busy}
                      onClick={() => void run(() => open(item.slug))}
                    >
                      项目详情
                    </button>
                    <button
                      type="button"
                      className={css.link}
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await open(item.slug);
                          setBinding(true);
                        })
                      }
                    >
                      {item.github ? "更换 GitHub 仓库" : "绑定 GitHub 仓库"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
