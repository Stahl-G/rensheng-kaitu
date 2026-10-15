import { Button } from "@deepseek-ai/dsh-client-ui-primitives";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type {
  OverviewData,
  OverviewMetric,
  OverviewProject,
  OverviewSource,
  OverviewVersion,
} from "../types.js";
import css from "./OverviewPage.module.css";

export interface OverviewPageProps {
  load: () => Promise<OverviewData>;
  onAgent: () => void;
}
const sections = [
  { id: "today", name: "今天", tip: "今天的安排、下一步和要你确认的事" },
  { id: "health", name: "健康", tip: "训练、饮食、睡眠和身体数据" },
  { id: "projects", name: "在做的事", tip: "你的项目和长期计划，以及进度" },
  { id: "feed", name: "资讯", tip: "你关注的领域每天的新消息" },
  { id: "me", name: "关于我", tip: "目标、作息规则和 AI 记住的你" },
];
const collapseKey = "kaitu.overview.sectionsCollapsed";
function Actor({ source, name }: { source: OverviewVersion["source"]; name?: string | null }) {
  if (source === "unknown") return null;
  const label =
    source === "user" ? "你" : source === "agent" ? "本机 Agent" : name ? `${name} · 云端` : "云端 Agent";
  const initial = source === "user" ? "你" : source === "agent" ? "本" : (name?.[0]?.toUpperCase() ?? "云");
  return (
    <>
      <span aria-hidden="true" className={css.avatar} data-source={source}>
        {initial}
      </span>
      <span className={css.actor}>{label}</span>
    </>
  );
}
function MetricChart({ metric }: { metric: OverviewMetric }) {
  const { daily, target } = metric;
  const description = daily
    .map((d) => `${d.date}：${d.value === null ? "未记录" : `${d.value} ${metric.unit}`}`)
    .join("，");
  if (metric.key === "workouts")
    return (
      <div className={css.week} role="img" aria-label={description}>
        {daily.map((d) => (
          <span
            className={css.trainingDay}
            key={d.date}
            title={`${d.date}：${d.value === null ? "未记录" : `${d.value} 次`}`}
          >
            <span className={d.value !== null && d.value > 0 ? css.trained : css.untrained} />
            <span className={css.muted}>
              {new Intl.DateTimeFormat("zh-CN", { weekday: "narrow", timeZone: "UTC" }).format(
                new Date(`${d.date}T12:00:00Z`),
              )}
            </span>
          </span>
        ))}
      </div>
    );
  if (metric.key === "sleep") {
    const goal = target?.[0];
    const max = Math.max(9, goal ?? 0, ...daily.map((d) => d.value ?? 0)) * 1.05;
    return (
      <>
        <div className={`${css.week} ${css.sleepChart}`} role="img" aria-label={description}>
          {goal !== undefined && (
            <span className={css.targetLine} style={{ bottom: `${(goal / max) * 100}%` }} />
          )}
          {daily.map((d) => (
            <span
              key={d.date}
              title={`${d.date}：${d.value === null ? "未记录" : `${d.value} 小时`}`}
              className={d.value === null ? css.missingBar : css.sleepBar}
              style={d.value === null ? undefined : { height: `${(d.value / max) * 100}%` }}
            />
          ))}
        </div>
        <span className={css.muted}>
          虚线框 = 没记录（不算 0）{goal !== undefined ? ` · 横线 = 目标 ${goal} 小时` : ""}
        </span>
      </>
    );
  }
  if (metric.key === "protein") {
    const low = target?.[0];
    const high = target?.[1] ?? low;
    const max = Math.max(1, (high ?? metric.value ?? 150) * 1.15, metric.value ?? 0);
    const valueLabel =
      metric.value === null ? "暂无记录" : `${metric.estimated ? "约 " : ""}${metric.value} g`;
    return (
      <>
        <div
          className={css.proteinTrack}
          role="img"
          aria-label={`${valueLabel}${low !== undefined ? `，目标 ${low}–${high} g` : ""}`}
        >
          {metric.value !== null && (
            <span
              className={`${css.proteinFill} ${metric.estimated ? css.estimated : ""}`}
              style={{ width: `${(metric.value / max) * 100}%` }}
            />
          )}
          {low !== undefined && high !== undefined && (
            <span
              className={css.proteinTarget}
              style={{ left: `${(low / max) * 100}%`, width: `${((high - low) / max) * 100}%` }}
            />
          )}
        </div>
        <span className={css.chartLegend}>
          <span>
            {metric.estimated
              ? "斜纹 = 估算"
              : metric.value === null
                ? "暂无记录"
                : `记录了 ${metric.days} 天`}
          </span>
          {low !== undefined && (
            <span>
              目标 {low}–{high} g
            </span>
          )}
        </span>
      </>
    );
  }
  return metric.latest ? <span className={css.muted}>测量于 {metric.from}</span> : null;
}
function ProjectChart({ project }: { project: OverviewProject }) {
  const kind = project.words === null ? "commits" : "words";
  const unit = kind === "words" ? "字" : "次提交";
  const max = Math.max(1, ...project.daily.map((d) => Math.max(0, d[kind] ?? 0)));
  const description = project.daily
    .map((d) => `${d.date}：${d[kind] === null ? "未记录" : `${d[kind]} ${unit}`}`)
    .join("，");
  return (
    <span className={css.projectChart} role="img" aria-label={`近 7 天每日产出，${description}`}>
      {project.daily.map((d) => (
        <span
          key={d.date}
          className={css.projectSlot}
          title={`${d.date}：${d[kind] === null ? "未记录" : `${d[kind]} ${unit}`}`}
        >
          <span style={{ height: `${(Math.max(0, d[kind] ?? 0) / max) * 100}%` }} />
        </span>
      ))}
    </span>
  );
}
const starts = [
  {
    title: "导入 ChatGPT 记忆",
    body: "把 ChatGPT 记得的你粘贴进来，开图整理成档案和目标。",
    cta: "开始导入",
    help: "在 ChatGPT 中导出记忆，回到对话中说「帮我导入 ChatGPT 记忆」，粘贴内容并核对导入预览后确认。",
  },
  {
    title: "连上 Apple 健康",
    body: "每晚自动同步步数、睡眠和训练，不用手记。",
    cta: "查看设置方法",
    help: "在开图仓库打开 docs/guides/apple-health.html，按三步说明设置 iPhone 快捷指令与自己的同步收件箱。",
  },
  { title: "随口说一句", body: "比如「今天深蹲 3×12 60kg」，Agent 会记下来。", cta: "去对话" },
];
const empties = [
  { label: "今天", hint: "连上日历或说一句「安排今天」" },
  { label: "下一步", hint: "设一个目标后自动生成" },
  { label: "健康", hint: "记一次训练或连上 Apple 健康" },
  { label: "在做的事", hint: "说「新建项目：小说二稿」" },
];

function noteLine(text = "") {
  const body = text.replace(/^---\n[\s\S]*?\n---\n?/, "");
  return (
    body
      .split("\n")
      .find((line) => line.trim())
      ?.trim() ?? "（空笔记）"
  );
}
function Row({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`${css.row} ${className}`}>{children}</div>;
}
function Section({
  title,
  source,
  children,
  id,
}: {
  title: string;
  source?: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className={css.section} aria-label={title}>
      <div className={css.sectionHeader}>
        <h2 data-section={title === "进行中的项目" ? "projects" : "today"}>
          {title === "进行中的项目" && <span className={css.sectionDot} aria-hidden="true" />}
          {title}
        </h2>
        {source && <span className={css.muted}>{source}</span>}
      </div>
      {children}
    </section>
  );
}

export function OverviewPage({ load, onAgent }: OverviewPageProps) {
  const [current, setCurrent] = useState("today");
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(collapseKey) === "true";
    } catch {
      return false;
    }
  });
  const toggleSections = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(collapseKey, String(next));
    } catch {
      /* 本次会话仍可收起。 */
    }
  };
  const currentName = sections.find((s) => s.id === current)?.name ?? "今天";
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++sequence.current;
    setLoading(true);
    setError(null);
    try {
      const result = await load();
      if (current === sequence.current) setData(result);
    } catch (err) {
      if (current === sequence.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }, [load]);
  useEffect(() => {
    void refresh();
    return () => {
      sequence.current++;
    };
  }, [refresh]);
  const format = (value: string, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("zh-CN", { timeZone: data?.timeZone, ...options }).format(new Date(value));
  const time = (value: string) => format(value, { hour: "2-digit", minute: "2-digit", hour12: false });
  const stamp = (value: string) =>
    format(value, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  return (
    <main className={`${css.page} ${data?.empty ? css.emptyPage : ""}`} aria-busy={loading}>
      <div className={css.content}>
        <nav className={`${css.sectionNav} ${collapsed ? css.collapsedNav : ""}`} aria-label="开图板块">
          {collapsed ? (
            <button
              type="button"
              className={css.expandSections}
              onClick={toggleSections}
              aria-expanded={false}
            >
              {currentName} · 展开板块
            </button>
          ) : (
            <>
              <div className={css.tabs}>
                {sections.map((section) => (
                  <button
                    type="button"
                    key={section.id}
                    title={section.tip}
                    aria-pressed={current === section.id}
                    className={css.tab}
                    data-section={section.id}
                    onClick={() => setCurrent(section.id)}
                  >
                    <span className={css.sectionDot} aria-hidden="true" />
                    {section.name}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className={css.collapseSections}
                aria-label="收起板块栏"
                aria-expanded={true}
                onClick={toggleSections}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  aria-hidden="true"
                >
                  <path d="m4 10 4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </>
          )}
        </nav>
        <header className={css.header}>
          <div>
            <h1>{currentName}</h1>
            <p className={css.subtitle}>
              {data
                ? data.empty
                  ? `工作区在 ${data.root} · 还没有记录`
                  : `${new Intl.DateTimeFormat("zh-CN", { timeZone: "UTC", month: "long", day: "numeric", weekday: "short" }).format(new Date(`${data.today}T12:00:00Z`))} · 数据截至 ${time(data.cutoff)} · 工作区在 ${data.drive ? "Google Drive" : data.root}`
                : "正在读取工作区…"}
            </p>
          </div>
          <div className={css.actions}>
            <Button size="sm" className={css.button} disabled={loading} onClick={() => void refresh()}>
              {loading ? "刷新中…" : "刷新"}
            </Button>
            {!data?.empty && (
              <Button size="sm" className={`${css.button} ${css.primary}`} onClick={onAgent}>
                问问开图
              </Button>
            )}
          </div>
        </header>
        {error && (
          <div role="alert" className={css.notice}>
            读取失败：{error}{" "}
            <button className={css.link} type="button" onClick={() => void refresh()}>
              重试
            </button>
          </div>
        )}
        {data?.warnings.map((warning) => (
          <p key={warning} className={css.notice}>
            {warning}
          </p>
        ))}
        {current !== "today" ? (
          <section className={css.placeholder}>
            <p>这一页还在做</p>
            <button type="button" className={css.link} onClick={() => setCurrent("today")}>
              回到「今天」
            </button>
          </section>
        ) : data?.empty ? (
          <>
            <section className={css.welcome} aria-label="先让开图认识你">
              <div>
                <h2>先让开图认识你</h2>
                <p>选一件你最想让 AI 持续跟进的事。做完这一步，这里就会出现今天的安排和下一步。</p>
              </div>
              <div className={css.starts}>
                {starts.map((item) =>
                  item.help ? (
                    <details key={item.title} className={css.start}>
                      <summary>
                        <strong>{item.title}</strong>
                        <span>{item.body}</span>
                        <span className={css.cta}>{item.cta}</span>
                      </summary>
                      <p>{item.help}</p>
                      <button type="button" className={css.link} onClick={onAgent}>
                        去对话
                      </button>
                    </details>
                  ) : (
                    <button key={item.title} type="button" className={css.start} onClick={onAgent}>
                      <strong>{item.title}</strong>
                      <span>{item.body}</span>
                      <span className={css.cta}>{item.cta}</span>
                    </button>
                  ),
                )}
              </div>
            </section>
            <div className={css.emptyGrid}>
              {empties.map((item) => (
                <div className={css.emptyTile} key={item.label}>
                  <span className={css.muted}>{item.label}</span>
                  <strong>暂无记录</strong>
                  <span>{item.hint}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          data && (
            <>
              {(data.pending > 0 || (data.daily?.unresolved ?? 0) > 0 || data.inboxNotes > 0) && (
                <section className={css.attention} aria-label="需要你处理">
                  <strong>
                    <span className={css.dot} aria-hidden="true" />
                    需要你处理
                  </strong>
                  {data.pending > 0 && <a href="#kt-today">{data.pending} 条日程建议待确认</a>}
                  {(data.daily?.unresolved ?? 0) > 0 && (
                    <a href="#kt-daily">
                      {data.daily?.unresolved ?? 0} 条未决
                      {data.daily ? `（${data.daily.date} 的每日整理）` : ""}
                    </a>
                  )}
                  {data.inboxNotes > 0 && (
                    <details>
                      <summary className={css.link}>{data.inboxNotes} 条待整理笔记</summary>
                      <ul className={css.noteList}>
                        {data.notes.map((note) => (
                          <li key={note.file}>{noteLine(note.text)}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </section>
              )}
              <div className={css.columns}>
                <div className={css.mainColumn}>
                  <Section title="日程" source="来源：NOW.md" id="kt-today">
                    {data.blocks.map((block) => (
                      <Row
                        key={block.id}
                        className={block.kind === "proposal" && block.status === "pending" ? css.pending : ""}
                      >
                        <span className={css.blockTime}>
                          {block.start ? block.start : "待安排"}
                          {block.end ? `–${block.end}` : ""}
                        </span>
                        <span className={css.blockTitle}>{block.title}</span>
                        <span className={css.muted}>
                          {block.kind === "proposal" && block.status === "pending"
                            ? "建议 · 待确认"
                            : block.status === "done"
                              ? "已完成"
                              : block.kind === "event"
                                ? "日历"
                                : block.status === "rejected"
                                  ? "已拒绝"
                                  : block.status === "skipped"
                                    ? "已跳过"
                                    : ""}
                        </span>
                      </Row>
                    ))}
                    {!data.blocks.length && <p className={css.emptyHint}>连上日历或说一句「安排今天」</p>}
                    {data.pending > 0 && (
                      <p className={css.help}>
                        在对话中确认或调整日程建议。
                        <button type="button" className={css.link} onClick={onAgent}>
                          问问开图
                        </button>
                      </p>
                    )}
                  </Section>
                  <Section title="下一步" source={`全部 ${data.next.length} 条 · 每模块最多 5 条`}>
                    {data.next.map((item) => (
                      <Row key={`${item.file}:${item.id}`}>
                        <span className={css.checkCircle} aria-hidden="true" />
                        <span className={css.blockTitle}>{item.title}</span>
                        <span className={css.tag} data-section={item.section}>
                          <span className={css.sectionDot} aria-hidden="true" />
                          {item.module}
                        </span>
                        {item.proposed && <span className={css.muted}>建议 · 待确认</span>}
                      </Row>
                    ))}
                    {!data.next.length && <p className={css.emptyHint}>设一个目标后自动生成</p>}
                  </Section>
                  <Section title="近期变化" source="版本历史">
                    <div id="kt-daily">
                      {data.daily ? (
                        <details className={css.dailyDetails}>
                          <summary className={`${css.row} ${css.daily}`}>
                            <strong>
                              {data.daily.date === data.today
                                ? "今天的每日整理"
                                : `${data.daily.date} 的每日整理`}
                            </strong>
                            <span className={css.blockTitle}>
                              {data.daily.organizer} 整理 · {data.daily.unresolved} 条未决等你确认
                            </span>
                            <span className={css.cta}>打开</span>
                          </summary>
                          <div className={css.dailyBody}>{data.daily.body.trim()}</div>
                        </details>
                      ) : (
                        <p className={css.emptyHint}>暂无每日整理</p>
                      )}
                    </div>
                    {data.versions.map((version) => (
                      <Row key={version.oid}>
                        <span className={css.versionTime}>{stamp(version.time)}</span>
                        <Actor source={version.source} name={version.actor} />
                        <span className={css.versionText}>{version.text}</span>
                      </Row>
                    ))}
                    {!data.versions.length && <p className={css.emptyHint}>暂无版本记录</p>}
                  </Section>
                </div>
                <aside className={css.aside}>
                  <section className={css.health} aria-label="健康">
                    <div className={css.sectionHeader}>
                      <h2 data-section="health">
                        <span className={css.sectionDot} aria-hidden="true" />
                        健康
                      </h2>
                      <span className={css.muted}>
                        近 7 天 · {data.metrics[0]?.from?.slice(5)}–{data.today.slice(5)}
                      </span>
                    </div>
                    {data.metrics.map((metric) =>
                      metric.key === "weight" && metric.value === null ? (
                        <div key={metric.key} className={css.weightEmpty}>
                          <div className={css.metricHeading}>
                            <span className={css.muted}>体重</span>
                            <span className={css.noValue}>暂无记录</span>
                          </div>
                          <div className={css.weightPrompt}>
                            <span>说一句「今天 72kg」</span>
                            <button type="button" className={css.button} onClick={onAgent}>
                              记一次
                            </button>
                          </div>
                        </div>
                      ) : (
                        <Row key={metric.key} className={css.metric}>
                          <span className={css.metricHeading}>
                            <span className={css.muted}>{metric.label}</span>
                            <strong
                              className={`${css.metricValue} ${metric.value === null ? css.noValue : ""}`}
                            >
                              {metric.value === null
                                ? "暂无记录"
                                : `${metric.estimated ? "约 " : ""}${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: metric.key === "workouts" ? 0 : 1 }).format(metric.value)} ${metric.unit}`}
                            </strong>
                          </span>
                          <MetricChart metric={metric} />
                        </Row>
                      ),
                    )}
                  </section>
                  <Section title="进行中的项目">
                    {data.projects.map((project) => (
                      <Row key={project.slug} className={css.project}>
                        <strong>{project.title}</strong>
                        <span>下一步：{project.next[0] ?? "暂无记录"}</span>
                        <span className={css.projectFooter}>
                          <span className={css.muted}>
                            近 7 天{" "}
                            {project.words !== null
                              ? `${project.words >= 0 ? "+" : ""}${project.words.toLocaleString()} 字`
                              : project.commits !== null
                                ? `${project.commits} 次提交`
                                : "暂无产出记录"}
                          </span>
                          <ProjectChart project={project} />
                        </span>
                      </Row>
                    ))}
                    {!data.projects.length && <p className={css.emptyHint}>说「新建项目：小说二稿」</p>}
                  </Section>
                </aside>
              </div>
            </>
          )
        )}
      </div>
    </main>
  );
}
