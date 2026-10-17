import type { Anchor, Finding, NovelData, NovelView, WorldRule } from "@kaitu/core";
import { useCallback, useEffect, useState } from "react";
import base from "../../../dsh-plugin/src/client/Prototype.module.css";
import css from "./Novel.module.css";
import { continuationPrompt, externalContinuationPrompt } from "./continuation-prompt.js";
export type Request = <T = unknown>(operation: string, input?: object) => Promise<T>;
type Agent = (text: string) => Promise<void>;
type Project = {
  slug: string;
  title: string;
  linked: boolean;
  pinned: boolean;
  words: number;
  scenes: number;
};
type Catalog = { projects: Project[]; science: boolean };
type Source = { scene: NovelData["scenes"][number]; text: string; path: string; anchor: Anchor };
type ScienceView = { data: { rules: WorldRule[]; findings: Finding[] }; revision: string; stale: string[] };
const status = { planned: "待写", draft: "进行中", done: "完成" };
const canon = { confirmed: "作者确认", tentative: "待定", ai_inference: "AI 推测", excerpt: "原文资料" };
function download(name: string, value: string, type = "text/markdown") {
  const url = URL.createObjectURL(new Blob([value], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
export function NovelPage({ request, onAgent }: { request: Request; onAgent?: Agent }) {
  const [catalog, setCatalog] = useState<Catalog>({ projects: [], science: false });
  const [project, setProject] = useState("");
  const [view, setView] = useState<NovelView | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [tab, setTab] = useState("overview");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState("");
  const [completed, setCompleted] = useState("");
  const [next, setNext] = useState("");
  const [writingIntent, setWritingIntent] = useState("");
  const refresh = useCallback(async () => {
    const info = await request<Catalog>("projects");
    setCatalog(info);
    if (project && info.projects.some((p) => p.slug === project && p.linked))
      setView(await request<NovelView>("view", { project }));
  }, [request, project]);
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
  }, [refresh]);
  const run = async (op: () => Promise<unknown>, message = "已保存") => {
    setBusy(true);
    setError("");
    try {
      await op();
      await refresh();
      setReceipt(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const ask = (text: string) =>
    onAgent ? run(() => onAgent(text), "已打开 Agent 会话草稿") : Promise.resolve();
  const choose = async (p: Project) => {
    setProject(p.slug);
    setView(null);
    setSource(null);
    setWritingIntent("");
    setTab("overview");
    if (p.linked) {
      const v = await request<NovelView>("view", { project: p.slug });
      setView(v);
      const scene = v.data.sessions.at(-1)?.scene ?? v.data.scenes[0]?.id;
      if (scene)
        try {
          setSource(await request<Source>("scene", { project: p.slug, scene }));
        } catch (e) {
          setError((e as Error).message);
        }
    }
  };
  const edit = (command: object) => request("edit", { project, revision: view?.revision, command });
  const data = view?.data;
  const title = catalog.projects.find((p) => p.slug === project)?.title;
  const last = data?.sessions.at(-1);
  return (
    <div className={base.app}>
      <div className={css.wrap}>
        <header className={css.actions}>
          <div style={{ flex: 1 }}>
            <span className={css.muted}>开图 · 小说工作台</span>
            <h1>{title ?? "你的作品"}</h1>
          </div>
          {project && (
            <button
              type="button"
              className={base.btn}
              onClick={() => {
                setProject("");
                setView(null);
              }}
            >
              全部作品
            </button>
          )}
          {onAgent && (
            <button
              type="button"
              className={`${base.btn} ${base["btn-strong"]}`}
              onClick={() =>
                void ask(
                  `请整理${project ? `作品 ${project}` : "我的小说项目"}。用现成文件工具找当前正文、README 和世界书，接入索引与设定资料。已有信息直接处理，只对实质歧义提问。`,
                )
              }
            >
              让 Agent 整理
            </button>
          )}
        </header>
        {error && (
          <p role="alert" className={css.warn}>
            {error}
          </p>
        )}
        {receipt && <output className={css.muted}>{receipt}</output>}
        {!project && (
          <>
            <p>继续写作，找回资料，检查设定。</p>
            <div className={css.grid}>
              {[...catalog.projects]
                .sort((a, b) => Number(b.pinned) - Number(a.pinned))
                .map((p) => (
                  <button
                    type="button"
                    key={p.slug}
                    className={css.card}
                    style={{ textAlign: "left", color: "inherit" }}
                    onClick={() => void run(() => choose(p), "作品已打开")}
                  >
                    <small>
                      {p.pinned ? "已固定 · " : ""}
                      {p.linked ? `${p.scenes} 场景 · ${p.words} 字词` : "待接入小说资料"}
                    </small>
                    <h2>{p.title}</h2>
                  </button>
                ))}
            </div>
            {!catalog.projects.length && <p>在开图关联作品项目后，让 Agent 接入正文与世界书。</p>}
          </>
        )}
        {project && !data && <p>让 Agent 读取这个项目的目录并接入索引即可开始。</p>}
        {data && view && (
          <>
            <div className={base.subtabs} role="tablist">
              {[
                ["overview", "概览"],
                ["chapters", "章节"],
                ["facts", "资料"],
                ...(catalog.science ? [["science", "世界书与校对"]] : []),
                ["drafts", "续写候选"],
              ].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  onClick={() => setTab(id as string)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className={css.actions}>
              <span className={css.muted}>
                {data.scenes.length} 场景 · {data.scenes.reduce((n, s) => n + s.words, 0)} 字词
              </span>
              <button
                className={base.link}
                type="button"
                disabled={busy}
                onClick={() => void run(() => edit({ type: "refresh" }), "索引已刷新")}
              >
                刷新
              </button>
              <button
                className={base.link}
                type="button"
                disabled={busy}
                onClick={() => void run(() => edit({ type: "pin", value: !data.pinned }))}
              >
                {data.pinned ? "取消固定" : "固定作品"}
              </button>
              <button
                className={base.link}
                type="button"
                onClick={() =>
                  download(`${project}-novel.json`, JSON.stringify(data, null, 2), "application/json")
                }
              >
                导出资料
              </button>
              <span className={css.muted}>{data.writingMode === "writing" ? "续写模式" : "只读模式"}</span>
            </div>
            {data.issues.length > 0 && (
              <details className={css.warn}>
                <summary>{data.issues.length} 项索引提示</summary>
                {data.issues.map((i) => (
                  <p key={i}>{i}</p>
                ))}
              </details>
            )}
            {tab === "overview" && (
              <div className={css.grid}>
                <section className={css.card}>
                  <h2>继续写作</h2>
                  <p>{source?.scene.title ?? "从章节选择场景"}</p>
                  {last && (
                    <>
                      <p>上次：{last.completed}</p>
                      <p>下次：{last.next || "未填写"}</p>
                    </>
                  )}
                  <div className={css.actions}>
                    <button className={base.btn} type="button" onClick={() => setTab("chapters")}>
                      查看章节
                    </button>
                    {source && (
                      <button
                        className={base.btn}
                        type="button"
                        onClick={() =>
                          void run(
                            () => request("open", { project, scene: source.scene.id }),
                            "已交给原编辑器",
                          )
                        }
                      >
                        打开正文
                      </button>
                    )}
                  </div>
                </section>
                <section className={css.card}>
                  <h2>写作交接</h2>
                  <label>
                    本次处理
                    <textarea value={completed} onChange={(e) => setCompleted(e.target.value)} />
                  </label>
                  <label>
                    未完成事项 / 下次入口
                    <textarea value={next} onChange={(e) => setNext(e.target.value)} />
                  </label>
                  <button
                    className={base.btn}
                    type="button"
                    disabled={busy || !source || !completed}
                    onClick={() =>
                      void run(async () => {
                        await edit({ type: "session", scene: source?.scene.id, completed, next });
                        setCompleted("");
                        setNext("");
                      })
                    }
                  >
                    保存交接
                  </button>
                </section>
                <section className={css.card}>
                  <h2>待处理</h2>
                  <p>
                    {data.proposals.filter((p) => p.state === "pending").length} 项提案 ·{" "}
                    {view.staleFacts.length} 项来源陈旧
                  </p>
                  <button className={base.link} type="button" onClick={() => setTab("facts")}>
                    查看资料
                  </button>
                </section>
                <section className={css.card}>
                  <h2>最近交接</h2>
                  {data.sessions
                    .slice(-4)
                    .reverse()
                    .map((s) => (
                      <div key={s.id}>
                        <small className={css.muted}>{s.savedAt}</small>
                        <p>{s.completed}</p>
                        <p>下次：{s.next}</p>
                      </div>
                    ))}
                </section>
              </div>
            )}
            {tab === "chapters" && (
              <>
                <div className={css.scroll}>
                  <table className={css.table}>
                    <thead>
                      <tr>
                        <th>章节 / 场景</th>
                        <th>叙述顺序</th>
                        <th>状态</th>
                        <th>字词 / 字符</th>
                        <th>世界内时间</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.scenes.map((s) => (
                        <tr key={s.id}>
                          <td>
                            <button
                              className={base.link}
                              type="button"
                              onClick={() =>
                                void run(
                                  async () =>
                                    setSource(await request<Source>("scene", { project, scene: s.id })),
                                  "场景已选定",
                                )
                              }
                            >
                              {s.title}
                            </button>
                            <small className={css.muted} style={{ display: "block" }}>
                              {s.path} · {s.id.slice(0, 8)}
                            </small>
                          </td>
                          <td>
                            <input
                              aria-label={`${s.title}叙述顺序`}
                              type="number"
                              style={{ width: 65 }}
                              defaultValue={s.order}
                              key={`${s.id}-o-${s.order}`}
                              onBlur={(e) => {
                                if (Number(e.target.value) !== s.order)
                                  void run(() =>
                                    edit({ type: "scene", ...s, order: Number(e.target.value) }),
                                  );
                              }}
                            />
                          </td>
                          <td>
                            <select
                              aria-label={`${s.title}状态`}
                              value={s.status}
                              onChange={(e) =>
                                void run(() => edit({ type: "scene", ...s, status: e.target.value }))
                              }
                            >
                              {Object.entries(status).map(([k, v]) => (
                                <option key={k} value={k}>
                                  {v}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            {s.words} / {s.characters}
                          </td>
                          <td>
                            <input
                              aria-label={`${s.title}世界内时间`}
                              defaultValue={s.worldTime ?? ""}
                              placeholder="未设定"
                              key={`${s.id}-t-${s.worldTime}`}
                              onBlur={(e) => {
                                if ((e.target.value || null) !== s.worldTime)
                                  void run(() =>
                                    edit({ type: "scene", ...s, worldTime: e.target.value || null }),
                                  );
                              }}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className={css.muted}>
                  叙述顺序与世界内时间分开。字词 v1：汉字按字，连续字母／数字按词，排除 YAML
                  和代码块；不等同于编辑器字数。
                </p>
                {source && <Evidence source={source} />}
              </>
            )}
            {tab === "facts" && (
              <div className={css.stack}>
                {onAgent && (
                  <button
                    className={base.btn}
                    type="button"
                    onClick={() =>
                      void ask(
                        `请整理作品 ${project} 的人物与地点资料，读取当前稿与设定，用来源支持每条资料，保留推测与原文摘录的区别，保存到插件。`,
                      )
                    }
                  >
                    让 Agent 整理人物与地点
                  </button>
                )}
                <div className={css.grid}>
                  {data.facts.map((f) => (
                    <article key={f.id} className={css.card}>
                      <small>
                        {canon[f.canon]} · {f.kind === "person" ? "人物" : "地点"}
                      </small>
                      <h2>{f.name}</h2>
                      <p>{f.text}</p>
                      {view.staleFacts.includes(f.id) && <p className={css.warn}>来源已陈旧</p>}
                      <Sources anchors={f.sources} />
                    </article>
                  ))}
                </div>
                <h2>提案与撤销</h2>
                {data.proposals
                  .slice()
                  .reverse()
                  .map((p) => (
                    <article className={css.card} key={p.id}>
                      <h3>
                        {p.after.name} · {canon[p.after.canon]}
                      </h3>
                      <div className={css.diff}>
                        <div>
                          <small>原值</small>
                          <p>{p.before?.text ?? "新增"}</p>
                        </div>
                        <div>
                          <small>提议值</small>
                          <p>{p.after.text}</p>
                        </div>
                      </div>
                      <Sources anchors={p.after.sources} />
                      <div className={css.actions}>
                        <small>{p.state}</small>
                        {p.state === "pending"
                          ? (
                              [
                                ["approve", "采纳"],
                                ["reject", "拒绝"],
                              ] as const
                            ).map(([decision, label]) => (
                              <button
                                className={base.btn}
                                type="button"
                                disabled={busy}
                                key={decision}
                                onClick={() =>
                                  void run(() => edit({ type: "decide", ids: [p.id], decision }))
                                }
                              >
                                {label}
                              </button>
                            ))
                          : p.state === "approved" && (
                              <button
                                className={base.btn}
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  void run(
                                    () => edit({ type: "decide", ids: [p.id], decision: "undo" }),
                                    "已撤销",
                                  )
                                }
                              >
                                撤销
                              </button>
                            )}
                      </div>
                    </article>
                  ))}
              </div>
            )}
            {tab === "science" && <SciencePanel request={request} project={project} onAgent={onAgent} />}
            {tab === "drafts" && (
              <div className={css.stack}>
                <section className={css.card}>
                  <h2>续写模式</h2>
                  <label className={css.check}>
                    <input
                      type="checkbox"
                      checked={data.writingMode === "writing"}
                      onChange={(e) =>
                        void run(() =>
                          edit({ type: "mode", mode: e.target.checked ? "writing" : "read_only" }),
                        )
                      }
                    />
                    允许保存续写候选与合稿
                  </label>
                  <label className={css.stack}>
                    这次想怎么续写（选填）
                    <textarea
                      value={writingIntent}
                      onChange={(e) => setWritingIntent(e.target.value)}
                      placeholder="例如：接着当前章节写 1000 字，保持第一人称，让两人的矛盾在对话中显露，先不揭晓真相。"
                      rows={3}
                    />
                  </label>
                  <p className={css.muted}>
                    本地 Agent 读取正文、世界书和文风样本，整理成包含实际材料的完整提示词。 复制给 Gemini
                    等外部聊天模型即可续写。
                  </p>
                  {onAgent && (
                    <button
                      className={base.btn}
                      type="button"
                      onClick={() =>
                        void ask(
                          externalContinuationPrompt(data, title ?? project, source?.scene, writingIntent),
                        )
                      }
                    >
                      整理外部续写提示词
                    </button>
                  )}
                  {onAgent && (
                    <button
                      className={base.btn}
                      type="button"
                      onClick={() =>
                        void ask(continuationPrompt(data, title ?? project, source?.scene, writingIntent))
                      }
                    >
                      在 DSH 中续写
                    </button>
                  )}
                </section>
                {data.drafts?.map((d) => (
                  <article className={css.card} key={d.id}>
                    <h2>{d.title}</h2>
                    <small>
                      {d.applied ? "已合稿" : "独立候选"} · {d.created}
                    </small>
                    <pre className={css.quote} style={{ maxHeight: "none" }}>
                      {d.text}
                    </pre>
                    <div className={css.actions}>
                      <button
                        className={base.btn}
                        type="button"
                        onClick={() => download(`${d.title}.md`, `# ${d.title}\n\n${d.text}\n`)}
                      >
                        导出 Markdown
                      </button>
                      <button
                        className={base.btn}
                        type="button"
                        disabled={busy || data.writingMode !== "writing"}
                        onClick={() =>
                          void run(() =>
                            request("applyDraft", {
                              project,
                              revision: view.revision,
                              id: d.id,
                              operation: d.applied ? "undo" : "append",
                            }),
                          )
                        }
                      >
                        {d.applied ? "撤销合稿" : "接到原文末尾"}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
function Sources({ anchors }: { anchors: Anchor[] }) {
  return (
    <details>
      <summary>原文出处</summary>
      {anchors.map((a) => (
        <blockquote className={css.quote} key={`${a.path}${a.quoteHash}`}>
          <small>
            {a.path} : {a.line}
          </small>
          <br />
          {a.quote}
        </blockquote>
      ))}
    </details>
  );
}
function Evidence({ source }: { source: Source }) {
  return (
    <section className={css.card}>
      <h2>正文快照</h2>
      <p className={css.muted}>
        {source.path} : {source.scene.line}
      </p>
      <pre className={css.quote}>{source.text}</pre>
    </section>
  );
}
function SciencePanel({ request, project, onAgent }: { request: Request; project: string; onAgent?: Agent }) {
  const [view, setView] = useState<ScienceView | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(
    async () => setView(await request<ScienceView>("sf:view", { project })),
    [request, project],
  );
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [load]);
  const run = async (op: () => Promise<unknown>) => {
    try {
      setError("");
      await op();
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const latest =
    view?.data.rules.filter((rule) => view.data.rules.filter((r) => r.id === rule.id).at(-1) === rule) ?? [];
  return (
    <div className={css.stack}>
      {error && (
        <p role="alert" className={css.warn}>
          {error}
        </p>
      )}
      <div className={css.actions}>
        {onAgent && (
          <button
            className={`${base.btn} ${base["btn-strong"]}`}
            type="button"
            onClick={() =>
              void run(() =>
                onAgent(
                  `请对照作品 ${project} 当前正文和世界书。用现成 grep 与读文件工具找材料，直接导入已有设定，检查有科幻内容的场景，把有意义的提示保存在插件。不要改正文。`,
                ),
              )
            }
          >
            让 Agent 导入设定并校对
          </button>
        )}
        <button className={base.link} type="button" onClick={() => void load()}>
          刷新结果
        </button>
        {view && (
          <button
            className={base.link}
            type="button"
            onClick={() =>
              download(`${project}-science.json`, JSON.stringify(view.data, null, 2), "application/json")
            }
          >
            导出设定与检查
          </button>
        )}
      </div>
      <p className={css.muted}>
        {latest.length} 张设定卡 · {view?.data.findings.length ?? 0} 项校对。月面重力参考 NASA 1.62
        m/s²；作品中的特殊设施与例外另行判断。
      </p>
      <h2>校对结果</h2>
      {view?.data.findings
        .slice()
        .reverse()
        .map((f) => (
          <article key={f.id} className={css.card}>
            <div className={css.actions}>
              <h3>
                {{
                  hard_rule_conflict: "明确规则冲突",
                  information_missing: "需要补充条件",
                  plausibility_note: "校对提示",
                }[f.result.type] ?? f.result.type}
              </h3>
              <small>
                影响：{f.result.type === "hard_rule_conflict" ? "中" : "低"} ·{" "}
                {f.result.type === "hard_rule_conflict" ? "条件已确认" : "供作者判断"}
              </small>
              {view.stale.includes(f.id) && <span className={css.warn}>来源或规则已变化，需要重查</span>}
            </div>
            <p>{f.result.conclusion}</p>
            {f.result.missing?.length ? (
              <ul>
                {f.result.missing.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            ) : null}
            <Sources anchors={[f.anchor, ...(f.relatedAnchors ?? [])]} />
            {f.result.references?.map((r) => (
              <p key={r.url}>
                <a href={r.url} target="_blank" rel="noreferrer">
                  {r.title}
                </a>
              </p>
            ))}
            {f.result.calculation && (
              <pre className={css.quote}>{JSON.stringify(f.result.calculation, null, 2)}</pre>
            )}
            <div className={css.actions}>
              <small>{f.status}</small>
              {(
                [
                  ["confirmed", "确认问题"],
                  ["deferred", "暂缓"],
                  ["false_positive", "误报"],
                ] as const
              ).map(([state, label]) => (
                <button
                  className={base.btn}
                  type="button"
                  key={state}
                  onClick={() =>
                    void run(() =>
                      request("sf:review", {
                        project,
                        revision: view.revision,
                        input: { id: f.id, status: state, note: f.note },
                      }),
                    )
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          </article>
        ))}
      <h2>世界书与设定</h2>
      {latest.map((r) => (
        <article className={css.card} key={r.id}>
          <h3>
            {r.title}{" "}
            <small>
              v{r.version} · {canon[r.canon]}
            </small>
          </h3>
          <details>
            <summary>查看设定</summary>
            <p style={{ whiteSpace: "pre-wrap" }}>{r.statement}</p>
            <Sources anchors={r.sources} />
            {r.exceptions.map((e) => (
              <p key={e.id}>
                例外：{e.statement} · {e.location}
              </p>
            ))}
          </details>
        </article>
      ))}
    </div>
  );
}
