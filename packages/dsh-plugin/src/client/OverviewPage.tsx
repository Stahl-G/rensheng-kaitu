import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { MeData, OverviewData, OverviewVersion } from "../types.js";
import { DoingPage, type DoingPageProps } from "./DoingPage.js";
import { FinancePage, type FinancePageProps } from "./FinancePage.js";
import { HealthPage, type HealthPageProps } from "./HealthPage.js";
import { MapPage, type MapPageProps } from "./MapPage.js";
import { MePage, type MePageProps } from "./MePage.js";
import { NewsPage, type NewsPageProps } from "./NewsPage.js";
import css from "./OverviewPage.module.css";
import { RecordSummary } from "./RecordSummary.js";

export interface OverviewPageProps
  extends MePageProps,
    Omit<NewsPageProps, "onPrompt">,
    Omit<DoingPageProps, "onPrompt">,
    Omit<MapPageProps, "onPrompt">,
    Omit<HealthPageProps, "onPrompt">,
    Omit<FinancePageProps, "onPrompt" | "today" | "timeZone"> {
  load: () => Promise<OverviewData>;
  subscribe?: (refresh: () => void) => () => void;
  decideProposal: (id: string, decision: "confirmed" | "rejected") => Promise<unknown>;
  capture: (text: string) => Promise<unknown>;
  onAgent: () => void;
  onAdvanced?: () => void;
}
type View = "overview" | "explore" | "records" | "profile" | "connections" | "advanced";
type RecordView = "all" | "projects" | "health" | "finance" | "knowledge" | "memory";
const navigation: { id: View; title: string; subtitle: string }[] = [
  { id: "overview", title: "总览", subtitle: "我的现状" },
  { id: "explore", title: "开图", subtitle: "人生探索" },
  { id: "records", title: "记录", subtitle: "全部资料" },
];
const modules: { id: Exclude<RecordView, "all">; title: string; subtitle: string }[] = [
  { id: "projects", title: "项目", subtitle: "目标、作品和进展" },
  { id: "health", title: "健康", subtitle: "活动、趋势和身体记录" },
  { id: "finance", title: "财务", subtitle: "收支、资产和账目" },
  { id: "knowledge", title: "知识与决策", subtitle: "学习、依据和选择" },
  { id: "memory", title: "记忆", subtitle: "AI 了解的你" },
];
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={css.section} aria-label={title}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}
function Actor({ version }: { version: OverviewVersion }) {
  return (
    <span className={css.muted}>
      {version.source === "user"
        ? "你"
        : version.source === "cloud"
          ? (version.actor ?? "云端 AI")
          : version.source === "agent"
            ? "本机 AI"
            : ""}
    </span>
  );
}
function noteText(text: string) {
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
}

export function OverviewPage(props: OverviewPageProps) {
  const [view, setView] = useState<View>("overview");
  const [recordDetails, setRecordDetails] = useState(false);
  const [recordView, setRecordView] = useState<RecordView>("all");
  const [exploreView, setExploreView] = useState("directions");
  const [data, setData] = useState<OverviewData | null>(null);
  const [personal, setPersonal] = useState<MeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [allChanges, setAllChanges] = useState(false);
  const [pins, setPins] = useState<string[]>(["projects", "health"]);
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const seq = ++sequence.current;
    setLoading(true);
    try {
      const result = await props.load();
      if (seq === sequence.current) {
        setData(result);
        setError(null);
      }
    } catch (err) {
      if (seq === sequence.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (seq === sequence.current) setLoading(false);
    }
  }, [props.load]);
  useEffect(() => {
    void refresh();
    return () => {
      sequence.current++;
    };
  }, [refresh]);
  useEffect(() => props.subscribe?.(() => void refresh()), [props.subscribe, refresh]);
  useEffect(() => {
    if (!data?.root) return;
    try {
      const stored = JSON.parse(localStorage.getItem(`kaitu.summary.pins:${data.root}`) ?? "null");
      if (Array.isArray(stored)) setPins(stored.filter((id) => modules.some((m) => m.id === id)));
    } catch {
      /* 本次会话仍能固定模块。 */
    }
  }, [data?.root]);
  useEffect(() => {
    let active = true;
    void props
      .loadMe()
      .then((value) => {
        if (active) setPersonal(value);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [props.loadMe]);
  const [deciding, setDeciding] = useState(false);
  const decide = async (id: string, decision: "confirmed" | "rejected") => {
    setDeciding(true);
    try {
      await props.decideProposal(id, decision);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeciding(false);
    }
  };
  const openRecord = (id: RecordView) => {
    setView("records");
    setRecordView(id);
    setRecordDetails(false);
  };
  const openNext = (item: OverviewData["next"][number]) => {
    if (item.section === "me") setView("profile");
    else if (item.section === "feed") {
      setExploreView("discoveries");
      setView("explore");
    } else
      openRecord(item.section === "health" ? "health" : item.section === "projects" ? "projects" : "all");
  };
  const prompt = (text: string) => {
    setDraft(text);
    setView("connections");
  };
  const childProps = { ...props, onPrompt: prompt };
  const togglePin = (id: string) => {
    const next = pins.includes(id) ? pins.filter((p) => p !== id) : [...pins, id];
    setPins(next);
    try {
      localStorage.setItem(`kaitu.summary.pins:${data?.root}`, JSON.stringify(next));
    } catch {
      /* 保留当前视图。 */
    }
  };
  const stamp = (value: string) =>
    new Intl.DateTimeFormat("zh-CN", {
      timeZone: data?.timeZone,
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(value));
  const syncLabel = !data
    ? "正在读取…"
    : data.sync.needsReview
      ? `需要核对 ${data.sync.needsReview} 条`
      : data.sync.received
        ? `已收到 ${data.sync.received} 条，等待整理`
        : data.sync.updatedAt
          ? `已更新 ${stamp(data.sync.updatedAt)}`
          : "本机资料 · 还没有记录";
  const recordSummary = (id: string) =>
    id === "projects"
      ? data?.projects
          .map((p) => p.title)
          .slice(0, 2)
          .join("、")
      : id === "health"
        ? data?.metrics
            .filter((m) => m.value !== null)
            .map(
              (m) =>
                `${m.label} ${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }).format(m.value as number)} ${m.unit}`,
            )
            .slice(0, 2)
            .join(" · ")
        : null;
  const quickCapture = (
    <form
      className={css.capture}
      onSubmit={async (event) => {
        event.preventDefault();
        setSaving(true);
        setReceipt(null);
        try {
          await props.capture(draft);
          setDraft("");
          setReceipt("已保存原文，等待 AI 整理");
          await refresh();
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setSaving(false);
        }
      }}
    >
      <label htmlFor="kaitu-capture">记录一件事</label>
      <textarea
        id="kaitu-capture"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="今天发生了什么？"
        rows={3}
        maxLength={100000}
        disabled={saving}
      />
      <div className={css.captureActions}>
        <button type="button" className={css.link} onClick={() => setView("connections")}>
          和开图聊聊
        </button>
        <button type="submit" className={`${css.button} ${css.primary}`} disabled={saving || !draft.trim()}>
          {saving ? "保存中…" : "记录"}
        </button>
      </div>
      {receipt && <output className={css.muted}>{receipt}</output>}
    </form>
  );
  const nextRows = (items: OverviewData["next"]) =>
    items.map((item) => (
      <div className={css.row} key={`${item.file}:${item.id}`}>
        <div className={css.grow}>
          <strong>{item.title}</strong>
          <p className={css.muted}>
            来自{item.module}
            {item.proposed ? " · 建议，待确认" : ""}
          </p>
        </div>
        <button type="button" className={css.link} onClick={() => openNext(item)}>
          查看
        </button>
      </div>
    ));
  return (
    <main className={css.page} aria-busy={loading}>
      <div className={css.content}>
        <header className={css.topbar}>
          <strong className={css.wordmark}>开图</strong>
          <div className={css.accountArea}>
            <details className={css.sync}>
              <summary>{syncLabel}</summary>
              <p>已收到的资料还在等待整理。正式记录更新后才会进入对应图表。</p>
              <button type="button" className={css.link} onClick={() => void refresh()}>
                刷新状态
              </button>
            </details>
            <details className={css.personalMenu}>
              <summary>{personal?.name || "个人与设置"}</summary>
              <div>
                <button type="button" onClick={() => setView("profile")}>
                  个人档案
                </button>
                <button type="button" onClick={() => setView("connections")}>
                  AI 与连接
                </button>
                <button type="button" onClick={() => setView("advanced")}>
                  高级设置
                </button>
              </div>
            </details>
          </div>
        </header>
        <nav className={css.primaryNav} aria-label="主要导航">
          {navigation.map((item) => (
            <button
              type="button"
              key={item.id}
              aria-current={view === item.id ? "page" : undefined}
              onClick={() => {
                setView(item.id);
                if (item.id === "records") setRecordView("all");
              }}
            >
              <strong>{item.title}</strong>
              <span>{item.subtitle}</span>
            </button>
          ))}
        </nav>
        {error && (
          <p className={css.notice} role="alert">
            {error}{" "}
            <button type="button" className={css.link} onClick={() => void refresh()}>
              重新读取
            </button>
          </p>
        )}
        {data?.warnings.length ? (
          <details className={css.muted}>
            <summary>{data.warnings.length} 项资料需要检查</summary>
            {data.warnings.map((w) => (
              <p key={w}>{w}</p>
            ))}
          </details>
        ) : null}
        {view === "overview" && data && (
          <>
            <header>
              <h1>今天</h1>
              <p className={css.subtitle}>你正在推进的事情，以及值得注意的变化</p>
            </header>
            {data.next[0] ? (
              <section className={css.focus} aria-label="现在最重要的一件事">
                <span className={css.muted}>现在最重要的一件事</span>
                <h2>{data.next[0].title}</h2>
                <p className={css.muted}>
                  来自{data.next[0].module} · {data.next[0].proposed ? "建议，待确认" : "当前下一步"}
                </p>
                <button
                  type="button"
                  className={css.link}
                  onClick={() => data.next[0] && openNext(data.next[0])}
                >
                  查看相关记录 →
                </button>
              </section>
            ) : (
              <section className={css.focus}>
                <h2>{data.empty ? "从今天的一件事开始" : "今天，留一点空间给下一步"}</h2>
                <p className={css.subtitle}>
                  {data.empty
                    ? "记下一次训练、一个想法，或导入已有资料。"
                    : "先看看最近的变化，或记下一件值得持续跟进的事。"}
                </p>
              </section>
            )}
            {!!(data.pending || data.sync.needsReview || data.daily?.unresolved) && (
              <Section title="需要你处理">
                {data.blocks
                  .filter((b) => b.kind === "proposal" && b.status === "pending")
                  .map((b) => (
                    <div className={css.row} key={b.id}>
                      <div className={css.grow}>
                        <strong>{b.title}</strong>
                        <p className={css.muted}>
                          {b.start}
                          {b.end ? `–${b.end}` : ""} · 日程建议
                        </p>
                      </div>
                      <button
                        type="button"
                        className={css.link}
                        disabled={deciding}
                        onClick={() => void decide(b.id, "confirmed")}
                      >
                        确认
                      </button>
                      <button
                        type="button"
                        className={css.link}
                        disabled={deciding}
                        onClick={() => void decide(b.id, "rejected")}
                      >
                        不采用
                      </button>
                    </div>
                  ))}
                {data.sync.needsReview > 0 && (
                  <button type="button" className={css.link} onClick={() => openRecord("all")}>
                    {data.sync.needsReview} 条资料需要核对
                  </button>
                )}
                {!!data.daily?.unresolved && <p>{data.daily.unresolved} 项未决事项，见近期回顾</p>}
              </Section>
            )}
            {data.next.length > 1 && <Section title="接下来">{nextRows(data.next.slice(1))}</Section>}
            {data.allNext.length > 3 && (
              <details>
                <summary className={css.link}>查看全部下一步（{data.allNext.length}）</summary>
                {nextRows(data.allNext)}
              </details>
            )}
            {data.blocks.length > 0 && (
              <details>
                <summary className={css.link}>今天的日程（{data.blocks.length}）</summary>
                {data.blocks.map((b) => (
                  <div className={css.row} key={b.id}>
                    <time>
                      {b.start}
                      {b.end ? `–${b.end}` : ""}
                    </time>
                    <span>{b.title}</span>
                    <span className={css.muted}>
                      {b.status === "pending" ? "建议，待确认" : b.status === "done" ? "已完成" : ""}
                    </span>
                  </div>
                ))}
              </details>
            )}
            {pins.some((id) => recordSummary(id)) && (
              <Section title="我的生活">
                <div className={css.lifeGrid}>
                  {modules
                    .filter((m) => pins.includes(m.id) && recordSummary(m.id))
                    .map((m) => (
                      <button
                        type="button"
                        className={css.lifeItem}
                        key={m.id}
                        onClick={() => openRecord(m.id)}
                      >
                        <strong>{m.title}</strong>
                        <span>{recordSummary(m.id)}</span>
                        <small>查看趋势与下一步 →</small>
                      </button>
                    ))}
                </div>
              </Section>
            )}
            {(data.versions.length > 0 || data.daily) && (
              <Section title="最近变化">
                {(allChanges ? data.versions : data.versions.slice(0, 3)).map((v) => (
                  <div className={css.row} key={v.oid}>
                    <time className={css.muted}>{stamp(v.time)}</time>
                    <Actor version={v} />
                    <span>{v.text}</span>
                  </div>
                ))}
                {data.versions.length > 3 && (
                  <button type="button" className={css.link} onClick={() => setAllChanges((v) => !v)}>
                    {allChanges ? "收起" : "查看全部变化"}
                  </button>
                )}
                {data.daily && (
                  <details className={css.dailyDetails}>
                    <summary className={css.link}>近期回顾 · {data.daily.date}</summary>
                    <div className={css.dailyBody}>{data.daily.body}</div>
                  </details>
                )}
              </Section>
            )}
            {quickCapture}
          </>
        )}
        {view === "records" && (
          <>
            <header className={css.header}>
              <div>
                <h1>{recordView === "all" ? "全部资料" : modules.find((m) => m.id === recordView)?.title}</h1>
                <p className={css.subtitle}>每次记录、每份资料，都留在你的工作区</p>
              </div>
              {recordView !== "all" && (
                <button type="button" className={css.link} onClick={() => setRecordView("all")}>
                  ← 全部资料
                </button>
              )}
            </header>
            {recordView === "all" ? (
              <>
                <div className={css.moduleList}>
                  {modules.map((m) => (
                    <article key={m.id}>
                      <button
                        type="button"
                        className={css.moduleOpen}
                        onClick={() => {
                          setRecordView(m.id);
                          setRecordDetails(false);
                        }}
                      >
                        <strong>{m.title}</strong>
                        <span>{recordSummary(m.id) || m.subtitle}</span>
                      </button>
                      {["projects", "health"].includes(m.id) && (
                        <button
                          type="button"
                          className={css.pin}
                          aria-pressed={pins.includes(m.id)}
                          onClick={() => togglePin(m.id)}
                        >
                          {pins.includes(m.id) ? "已固定到总览" : "固定到总览"}
                        </button>
                      )}
                    </article>
                  ))}
                </div>
                {data?.notes.length ? (
                  <Section title="最近记录">
                    {data.notes.map((note) => (
                      <details key={note.file} className={css.rawNote}>
                        <summary>
                          <strong>{noteText(note.text).split("\n").find(Boolean)?.slice(0, 90)}</strong>
                          <span className={css.muted}>
                            {note.status === "received" ? "已收到 · 等待整理" : "需要核对"}
                          </span>
                        </summary>
                        <div className={css.dailyBody}>{noteText(note.text)}</div>
                      </details>
                    ))}
                  </Section>
                ) : null}
                {quickCapture}
              </>
            ) : recordView === "projects" || recordView === "knowledge" ? (
              <DoingPage {...childProps} timeZone={data?.timeZone} />
            ) : recordView === "health" ? (
              recordDetails ? (
                <HealthPage {...childProps} />
              ) : (
                <RecordSummary
                  kind="health"
                  data={data}
                  loadFinance={props.loadFinanceOverview}
                  openDetails={() => setRecordDetails(true)}
                />
              )
            ) : recordView === "finance" ? (
              recordDetails ? (
                <FinancePage {...childProps} today={data?.today} timeZone={data?.timeZone} />
              ) : (
                <RecordSummary
                  kind="finance"
                  data={data}
                  loadFinance={props.loadFinanceOverview}
                  openDetails={() => setRecordDetails(true)}
                />
              )
            ) : (
              <MePage {...childProps} />
            )}
          </>
        )}
        {view === "explore" && (
          <>
            <header>
              <h1>开图</h1>
              <p className={css.subtitle}>看看走过的路，也看看接下来值得探索什么</p>
            </header>
            <nav className={css.secondaryNav} aria-label="探索视图">
              {[
                ["directions", "方向"],
                ["footprints", "足迹"],
                ["discoveries", "发现"],
              ].map(([id, title]) => (
                <button
                  type="button"
                  key={id}
                  aria-pressed={exploreView === id}
                  onClick={() => setExploreView(id as string)}
                >
                  {title}
                </button>
              ))}
            </nav>
            {exploreView === "footprints" ? (
              <MapPage {...childProps} />
            ) : exploreView === "discoveries" ? (
              <NewsPage {...childProps} />
            ) : (
              <>
                {personal?.goals.length ? (
                  <Section title="正在探索的方向">
                    {personal.goals.map((goal) => (
                      <article className={css.direction} key={goal.id}>
                        <h2>{goal.title}</h2>
                        {goal.approach && <p>{goal.approach}</p>}
                        {goal.actual && <p className={css.muted}>最近认识：{goal.actual}</p>}
                        {goal.due && <p className={css.muted}>目标日期 {goal.due}</p>}
                        <button
                          type="button"
                          className={css.link}
                          onClick={() =>
                            prompt(`一起看看「${goal.title}」：梳理已有依据、未知条件和一个低成本尝试。`)
                          }
                        >
                          梳理下一步 →
                        </button>
                      </article>
                    ))}
                  </Section>
                ) : (
                  <div className={css.focus}>
                    <h2>一个值得探索的问题</h2>
                    <p className={css.subtitle}>从你关心的方向出发，把依据、尝试和新的认识慢慢串起来。</p>
                    <button type="button" className={css.link} onClick={() => prompt("我想探索一个方向：")}>
                      记下我的方向 →
                    </button>
                  </div>
                )}
                <button type="button" className={css.link} onClick={() => setExploreView("footprints")}>
                  回看我的地理足迹 →
                </button>
              </>
            )}
          </>
        )}
        {view === "profile" && (
          <>
            <h1>个人档案</h1>
            <MePage {...childProps} />
          </>
        )}
        {view === "connections" && (
          <>
            <header>
              <h1>AI 与连接</h1>
              <p className={css.subtitle}>先用你熟悉的 AI，或者选择开图内置 AI</p>
            </header>
            <Section title="连接已有 AI">
              <p>让现有 AI 读取你的开图工作区，接着整理已有记录。资料浏览和原文记录都不需要配置模型。</p>
              <details>
                <summary className={css.link}>查看给 AI 的接手说明</summary>
                <textarea
                  className={css.connectionText}
                  readOnly
                  value={`请接续我的开图工作区：${data?.root ?? ""}\n先读 AGENT-README.md 和 OVERVIEW.md，再读相关交接。${draft ? `\n这次要处理：${draft}` : ""}`}
                  rows={5}
                />
                <button
                  type="button"
                  className={css.button}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(
                        `请接续我的开图工作区：${data?.root ?? ""}\n先读 AGENT-README.md 和 OVERVIEW.md，再读相关交接。${draft ? `\n这次要处理：${draft}` : ""}`,
                      );
                      setReceipt("接手说明已复制");
                    } catch {
                      setReceipt("请选中并复制上面的接手说明");
                    }
                  }}
                >
                  复制接手说明
                </button>
              </details>
            </Section>
            <Section title="使用内置 AI">
              <p>主动启用后，可以选择模型并配置账户。</p>
              <button
                type="button"
                className={css.button}
                onClick={() => (draft ? props.onPrompt(draft) : props.onAgent())}
              >
                使用内置 AI
              </button>
            </Section>
            {receipt && <output>{receipt}</output>}
          </>
        )}
        {view === "advanced" && (
          <>
            <h1>高级设置</h1>
            <p className={css.subtitle}>连接、运行环境与开发者能力按需使用</p>
            <button type="button" className={css.button} onClick={props.onAdvanced}>
              插件与运行环境
            </button>
            <button type="button" className={css.link} onClick={() => setView("connections")}>
              管理 AI 连接
            </button>
            <details>
              <summary>工作区位置</summary>
              <p>{data?.root}</p>
            </details>
          </>
        )}
      </div>
    </main>
  );
}
