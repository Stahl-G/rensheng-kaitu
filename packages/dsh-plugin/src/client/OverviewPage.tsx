import { Button } from "@deepseek-ai/dsh-client-ui-primitives";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { OverviewData, OverviewSource } from "../types.js";
import css from "./OverviewPage.module.css";

export interface OverviewPageProps {
  load: () => Promise<OverviewData>;
  onAgent: () => void;
}
const actors = { user: "你", agent: "本机 Agent", cloud: "云端", unknown: "来源未记录" };
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
  { label: "项目", hint: "说「新建项目：小说二稿」" },
];

function Sources({ items }: { items: OverviewSource[] }) {
  return (
    <div className={css.sources}>
      {items.map((source, index) => (
        <div key={`${source.file}:${index}`}>
          <code>{source.file}</code>
          {source.text && <pre>{source.text}</pre>}
        </div>
      ))}
      {!items.length && <p>暂无记录</p>}
    </div>
  );
}
function Row({
  children,
  sources,
  className = "",
}: {
  children: ReactNode;
  sources: OverviewSource[];
  className?: string;
}) {
  return (
    <details className={`${css.disclosure} ${className}`}>
      <summary className={css.row}>{children}</summary>
      <Sources items={sources} />
    </details>
  );
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
        <h2>{title}</h2>
        {source && <span className={css.muted}>{source}</span>}
      </div>
      {children}
    </section>
  );
}

export function OverviewPage({ load, onAgent }: OverviewPageProps) {
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
        <header className={css.header}>
          <div>
            <h1>总览</h1>
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
                问 Agent
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
        {data?.empty ? (
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
              <section className={css.attention} aria-label="需要你处理">
                <strong>
                  <span className={css.dot} aria-hidden="true" />
                  需要你处理
                </strong>
                <a href="#kt-today">{data.pending} 条日程建议待确认</a>
                <a href="#kt-daily">
                  {data.daily?.unresolved ?? 0} 条未决{data.daily ? `（${data.daily.date} 的每日整理）` : ""}
                </a>
                <details>
                  <summary className={css.link}>{data.inboxNotes} 条待整理笔记</summary>
                  <Sources items={data.notes} />
                </details>
              </section>
              <div className={css.columns}>
                <div className={css.mainColumn}>
                  <Section title="今天" source="来源：NOW.md" id="kt-today">
                    {data.blocks.map((block) => (
                      <Row
                        key={block.id}
                        className={block.kind === "proposal" && block.status === "pending" ? css.pending : ""}
                        sources={[
                          { file: "NOW.md", text: JSON.stringify(block, null, 2) },
                          ...(block.ref ? [{ file: block.ref, text: "" }] : []),
                        ]}
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
                          问 Agent
                        </button>
                      </p>
                    )}
                  </Section>
                  <Section title="下一步" source={`全部 ${data.next.length} 条 · 每模块最多 5 条`}>
                    {data.next.map((item) => (
                      <Row key={`${item.file}:${item.id}`} sources={[{ file: item.file, text: item.title }]}>
                        <span className={css.checkCircle} aria-hidden="true" />
                        <span className={css.blockTitle}>{item.title}</span>
                        <span className={css.tag}>{item.module}</span>
                        {item.proposed && <span className={css.muted}>建议 · 待确认</span>}
                      </Row>
                    ))}
                    {!data.next.length && <p className={css.emptyHint}>设一个目标后自动生成</p>}
                  </Section>
                  <Section title="近期变化" source="版本历史">
                    <div id="kt-daily">
                      {data.daily ? (
                        <Row
                          className={css.daily}
                          sources={[{ file: data.daily.file, text: data.daily.body }]}
                        >
                          <strong>
                            {data.daily.date === data.today
                              ? "今天的每日整理"
                              : `${data.daily.date} 的每日整理`}
                          </strong>
                          <span className={css.blockTitle}>
                            {data.daily.organizer} 整理 · {data.daily.unresolved} 条未决等你确认
                          </span>
                          <span className={css.cta}>打开</span>
                        </Row>
                      ) : (
                        <p className={css.emptyHint}>暂无每日整理</p>
                      )}
                    </div>
                    {data.versions.map((version) => (
                      <Row
                        key={version.oid}
                        sources={[
                          {
                            file: `版本 ${version.short}`,
                            text: `${version.time}\n${version.message}\n${version.oid}`,
                          },
                        ]}
                      >
                        <span className={css.versionTime}>{stamp(version.time)}</span>
                        <span className={css.actor}>{actors[version.source]}</span>
                        <span className={css.versionText}>{version.message}</span>
                      </Row>
                    ))}
                    {!data.versions.length && <p className={css.emptyHint}>暂无版本记录</p>}
                  </Section>
                </div>
                <aside className={css.aside}>
                  <section className={css.health} aria-label="健康">
                    <div className={css.sectionHeader}>
                      <h2>健康</h2>
                      <span className={css.muted}>
                        近 7 天 · {data.metrics[0]?.from?.slice(5)}–{data.today.slice(5)}
                      </span>
                    </div>
                    {data.metrics.map((metric) => (
                      <Row key={metric.key} className={css.metric} sources={metric.sources}>
                        <span className={css.muted}>{metric.label}</span>
                        <strong className={`${css.metricValue} ${metric.value === null ? css.noValue : ""}`}>
                          {metric.value === null
                            ? "暂无记录"
                            : `${metric.estimated ? "约 " : ""}${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: metric.key === "workouts" ? 0 : 1 }).format(metric.value)} ${metric.unit}`}
                        </strong>
                        <span className={css.muted}>
                          {metric.key === "weight"
                            ? metric.latest
                              ? `测量于 ${stamp(metric.latest)}`
                              : "连上 Apple 健康，或说一句「今天 72kg」"
                            : metric.value === null
                              ? "记一次训练或连上 Apple 健康"
                              : `${metric.estimated ? "估算 · " : ""}记录了 ${metric.days} 天${metric.key === "sleep" || metric.key === "protein" ? "，没记录的不算 0" : ""}`}
                        </span>
                        <span className={css.muted}>
                          {metric.from ? `${metric.from}–${metric.to} · ` : ""}截至 {stamp(metric.cutoff)}
                        </span>
                      </Row>
                    ))}
                  </section>
                  <Section title="进行中的项目">
                    {data.projects.map((project) => (
                      <Row
                        key={project.slug}
                        className={css.project}
                        sources={[
                          { file: project.file, text: project.next.join("\n") },
                          {
                            file: project.metricFiles.join("\n") || project.file,
                            text: `${project.from}–${project.to}\n字数变化：${project.words ?? "暂无记录"}\n提交数：${project.commits ?? "暂无记录"}`,
                          },
                        ]}
                      >
                        <strong>{project.title}</strong>
                        <span>下一步：{project.next[0] ?? "暂无记录"}</span>
                        <span className={css.muted}>
                          近 7 天{" "}
                          {project.words === null
                            ? "字数暂无记录"
                            : `${project.words >= 0 ? "+" : ""}${project.words.toLocaleString()} 字`}{" "}
                          · {project.commits === null ? "提交暂无记录" : `${project.commits} 次提交`}
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
