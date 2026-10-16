import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Direction,
  DirectionNote,
  ExperienceSource,
  ExplorationCommand,
  ExplorationData,
  ExplorationExperiment,
  ExplorationReference,
  MeGoal,
} from "../types.js";
import { DirectionForm, ExperimentForm, NoteForm } from "./DirectionForms.js";
import css from "./DirectionsPage.module.css";
import base from "./OverviewPage.module.css";
import v2 from "./Prototype.module.css";
import { SourceEvidence } from "./SourceEvidence.js";

export interface DirectionsPageProps {
  generateDirections?: (start: boolean) => Promise<{
    status: "idle" | "running" | "done" | "error";
    stage: string;
    error?: string;
  }>;
  onConnect?: () => void;
  loadExploration: () => Promise<ExplorationData>;
  writeExploration: (command: ExplorationCommand) => Promise<{ id: string; version: string | null }>;
  loadExplorationSource: (
    owner: "direction" | "direction_note" | "exploration_experiment",
    id: string,
    reference?: number,
  ) => Promise<ExperienceSource>;
  subscribe?: (refresh: () => void) => () => void;
  goals?: MeGoal[];
  onPrompt: (text: string) => void;
}
const states = {
  suggested: "AI 建议 · 待采纳",
  active: "在试",
  paused: "已暂停",
  archived: "已归档",
  dismissed: "已忽略",
};
const actionStates = { planned: "计划中", active: "进行中", completed: "行动已完成", cancelled: "已取消" };
const conclusions = {
  unassessed: "暂未判断假设",
  supports: "支持假设",
  refutes: "反驳假设",
  inconclusive: "证据还不足",
};
const stances = { unclear: "还不能判断", supports: "支持依据", refutes: "反面证据" };
const kinds = { evidence: "依据与资料", reflection: "新的认识", decision: "我的决定" };
function ReferenceList({
  data,
  load,
  owner,
  id,
  items,
}: {
  owner: "direction" | "direction_note";
  id: string;
  items?: ExplorationReference[];
  data: ExplorationData | null;
  load: DirectionsPageProps["loadExplorationSource"];
}) {
  return (
    <>
      {items?.map((item, index) => (
        <div key={`${item.kind}:${item.ref}`} className={css.reference}>
          <p>
            {item.kind === "project" ? "项目：" : item.kind === "decision" ? "决策：" : "原文："}
            {item.kind === "project"
              ? (data?.references.projects.find((p) => p.id === item.ref)?.title ?? item.ref)
              : item.kind === "decision"
                ? (data?.references.decisions.find((d) => d.path === item.ref)?.title ?? item.ref)
                : item.ref}
          </p>
          <SourceEvidence id={id} label="查看关联资料" load={() => load(owner, id, index)} />
        </div>
      ))}
    </>
  );
}

export function DirectionsPage(props: DirectionsPageProps) {
  const [data, setData] = useState<ExplorationData | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState("current");
  const [tab, setTab] = useState("overview");
  const [form, setForm] = useState<"direction" | "experiment" | "note" | null>(null);
  const [editing, setEditing] = useState<Direction | ExplorationExperiment | DirectionNote | null>(null);
  const [seed, setSeed] = useState<{ title: string; hypothesis?: string } | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [generation, setGeneration] = useState<{ status: string; stage: string; error?: string }>();
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const seq = ++sequence.current;
    try {
      const result = await props.loadExploration();
      if (seq === sequence.current) {
        setData(result);
        setError(null);
      }
    } catch (error) {
      if (seq === sequence.current) setError(error instanceof Error ? error.message : String(error));
    }
  }, [props.loadExploration]);
  useEffect(() => {
    void refresh();
    return () => {
      sequence.current++;
    };
  }, [refresh]);
  useEffect(() => props.subscribe?.(() => void refresh()), [props.subscribe, refresh]);
  useEffect(() => {
    if (!props.generateDirections) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await props.generateDirections?.(false);
        if (!active || !result) return;
        setGeneration(result);
        if (result.status === "done") await refresh();
        if (result.status === "running") timer = setTimeout(poll, 1000);
      } catch (error) {
        if (active) setError(error instanceof Error ? error.message : String(error));
      }
    };
    if (generation?.status === "running") timer = setTimeout(poll, 1000);
    else void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [props.generateDirections, generation?.status, refresh]);
  const generate = async () => {
    setError(null);
    setGeneration({ status: "running", stage: "读资料" });
    try {
      if (!props.generateDirections) {
        setGeneration(undefined);
        props.onConnect?.();
        return;
      }
      setGeneration(await props.generateDirections(true));
    } catch (error) {
      setGeneration(undefined);
      setError(error instanceof Error ? error.message : String(error));
    }
  };
  const direction = data?.directions.find((d) => d.id === selected);
  const experiments = data?.experiments.filter((e) => e.direction_id === selected) ?? [];
  const notes = data?.notes.filter((n) => n.direction_id === selected) ?? [];
  const timeline = data?.timeline.filter((e) => e.direction_id === selected) ?? [];
  const listedDirections =
    data?.directions
      .filter((d) =>
        filter === "favorites"
          ? d.favorite
          : filter === "history"
            ? ["archived", "dismissed"].includes(d.status)
            : ["active", "suggested", "paused"].includes(d.status),
      )
      .sort(
        (a, b) =>
          ["active", "suggested", "paused", "archived", "dismissed"].indexOf(a.status) -
          ["active", "suggested", "paused", "archived", "dismissed"].indexOf(b.status),
      ) ?? [];
  const closeForm = () => {
    setForm(null);
    setEditing(null);
  };
  const save = async (command: ExplorationCommand) => {
    const result = await props.writeExploration(command);
    if (command.operation === "create_direction") {
      setSelected(result.id);
      setTab("overview");
    }
    closeForm();
    setReceipt("已保存");
    await refresh();
  };
  const update = async (patch: Partial<Pick<Direction, "status" | "favorite">>) => {
    if (!direction) return;
    setBusy(true);
    setError(null);
    try {
      await save({
        operation: "update_direction",
        id: direction.id,
        expected_revision: direction.rev ?? 1,
        data: patch,
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const openForm = (
    kind: "direction" | "experiment" | "note",
    item?: Direction | ExplorationExperiment | DirectionNote,
  ) => {
    setEditing(item ?? null);
    setSeed(undefined);
    setForm(kind);
    setReceipt(null);
  };
  const noteItems = (items: DirectionNote[]) =>
    items.map((note) => (
      <article key={`${note.id}:${note.rev ?? 1}`} className={css.item}>
        <div className={css.itemHeader}>
          <strong>{kinds[note.kind]}</strong>
          <span className={base.muted}>
            {stances[note.stance]} · {note.by === "user" ? "你" : "AI"}
          </span>
        </div>
        {note.question !== (direction?.hypothesis || direction?.title) && (
          <p className={base.muted}>记录时针对的问题：{note.question}</p>
        )}
        <p className={css.prose}>{note.text}</p>
        {note.experiment_id && (
          <p className={base.muted}>
            来自尝试：{experiments.find((e) => e.id === note.experiment_id)?.action ?? "历史尝试"}
          </p>
        )}
        {note.source && (
          <SourceEvidence id={note.id} load={() => props.loadExplorationSource("direction_note", note.id)} />
        )}
        <ReferenceList
          data={data}
          load={props.loadExplorationSource}
          owner="direction_note"
          id={note.id}
          items={note.references}
        />
        <button type="button" className={base.link} onClick={() => openForm("note", note)}>
          修正资料
        </button>
      </article>
    ));
  if (!data)
    return (
      <section className={css.page}>
        {error ? (
          <p role="alert">
            {error}
            <button type="button" className={base.link} onClick={() => void refresh()}>
              重新读取
            </button>
          </p>
        ) : (
          <p className={base.muted}>正在读取方向…</p>
        )}
      </section>
    );
  return (
    <section className={css.page} aria-label="探索方向">
      {error && (
        <p role="alert" className={base.notice}>
          {error}
        </p>
      )}
      {generation && generation.status !== "idle" && (
        <output aria-live="polite">
          {generation.error ?? generation.stage}
          {generation.status === "running" ? "…" : ""}
        </output>
      )}
      {(error || generation?.error) && props.onConnect && (
        <button type="button" className={base.link} onClick={props.onConnect}>
          AI 与连接
        </button>
      )}
      {receipt && <output className={base.muted}>{receipt}</output>}
      {form === "direction" ? (
        <DirectionForm
          key={editing?.id ?? "new"}
          data={data}
          initial={(editing as Direction | undefined) ?? undefined}
          seed={seed}
          save={save}
          cancel={closeForm}
        />
      ) : direction && form === "experiment" ? (
        <ExperimentForm
          key={editing?.id ?? "new"}
          direction={direction}
          initial={(editing as ExplorationExperiment | undefined) ?? undefined}
          save={save}
          cancel={closeForm}
        />
      ) : direction && form === "note" ? (
        <NoteForm
          key={editing?.id ?? "new"}
          direction={direction}
          data={data}
          experiments={experiments}
          initial={(editing as DirectionNote | undefined) ?? undefined}
          save={save}
          cancel={closeForm}
        />
      ) : direction ? (
        <>
          <header className={css.detailHeader}>
            <button
              className={base.link}
              type="button"
              onClick={() => {
                setSelected(null);
                setReceipt(null);
              }}
            >
              ← 全部方向
            </button>
            <span className={base.muted}>{states[direction.status]}</span>
          </header>
          <div className={css.heading}>
            <h2>{direction.title}</h2>
            <button
              type="button"
              className={base.link}
              disabled={busy}
              onClick={() => void update({ favorite: !direction.favorite })}
            >
              {direction.favorite ? "取消收藏" : "收藏"}
            </button>
          </div>
          <nav className={base.secondaryNav} aria-label="方向详情">
            {(
              [
                ["overview", "概览"],
                ["sources", "资料"],
                ["experiments", "尝试"],
                ["changes", "变化"],
              ] as const
            ).map(([id, title]) => (
              <button type="button" key={id} aria-pressed={tab === id} onClick={() => setTab(id)}>
                {title}
              </button>
            ))}
          </nav>
          {tab === "overview" && (
            <>
              <div className={css.statement}>
                <h3>为什么在意</h3>
                <p>{direction.motivation || "先保留这个问题，再慢慢补充为什么在意。"}</p>
                <h3>目前的假设</h3>
                <p>{direction.hypothesis || "还没形成假设，可以先收集一点资料。"}</p>
                {direction.unknowns && (
                  <>
                    <h3>仍然未知</h3>
                    <p>{direction.unknowns}</p>
                  </>
                )}
              </div>
              <ReferenceList
                data={data}
                load={props.loadExplorationSource}
                owner="direction"
                id={direction.id}
                items={direction.references}
              />
              {notes.some((n) => n.stance === "refutes") && (
                <section>
                  <h3>需要认真看待的反面证据</h3>
                  {noteItems(notes.filter((n) => n.stance === "refutes").slice(-2))}
                </section>
              )}
              {experiments.length > 0 && (
                <section>
                  <h3>最近的尝试</h3>
                  {experiments.slice(-2).map((e) => (
                    <article key={e.id} className={css.item}>
                      <strong>{e.action}</strong>
                      <p className={base.muted}>
                        {actionStates[e.status]} · {conclusions[e.conclusion]}
                      </p>
                      {e.question !== (direction.hypothesis || direction.title) && (
                        <p className={base.muted}>这次验证的问题：{e.question}</p>
                      )}
                      {e.result && <p className={css.prose}>{e.result}</p>}
                    </article>
                  ))}
                </section>
              )}
              <div className={css.actions}>
                {direction.status === "active" && (
                  <button type="button" className={base.button} onClick={() => openForm("experiment")}>
                    安排一个小尝试
                  </button>
                )}
                <button type="button" className={base.link} onClick={() => openForm("note")}>
                  补充依据或认识
                </button>
              </div>
              <details>
                <summary>方向管理</summary>
                <div className={css.actions}>
                  {direction.status === "suggested" ? (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        className={base.button}
                        onClick={() => void update({ status: "active" })}
                      >
                        采纳这个方向
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        className={base.link}
                        onClick={() => void update({ status: "dismissed" })}
                      >
                        不感兴趣
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        className={base.link}
                        onClick={() =>
                          void update({ status: direction.status === "active" ? "paused" : "active" })
                        }
                      >
                        {direction.status === "active" ? "暂停方向" : "继续探索"}
                      </button>
                      {direction.status !== "archived" && (
                        <button
                          type="button"
                          disabled={busy}
                          className={base.link}
                          onClick={() => void update({ status: "archived" })}
                        >
                          归档方向
                        </button>
                      )}
                    </>
                  )}
                  <button
                    type="button"
                    className={base.link}
                    onClick={() => openForm("direction", direction)}
                  >
                    调整问题与假设
                  </button>
                </div>
              </details>
            </>
          )}
          {tab === "sources" && (
            <>
              <div className={css.actions}>
                <button type="button" className={base.button} onClick={() => openForm("note")}>
                  补充依据或认识
                </button>
              </div>
              {notes.length ? (
                noteItems(notes)
              ) : (
                <p className={base.muted}>还没有资料。先记下支持或反对这个假设的观察。</p>
              )}
            </>
          )}
          {tab === "experiments" && (
            <>
              {direction.status === "active" && (
                <button type="button" className={base.button} onClick={() => openForm("experiment")}>
                  安排一个小尝试
                </button>
              )}
              {!experiments.length && (
                <p className={base.muted}>还没有尝试。先选一件投入可控、能观察结果的事。</p>
              )}
              {experiments.map((e) => (
                <article key={`${e.id}:${e.rev ?? 1}`} className={css.item}>
                  <div className={css.itemHeader}>
                    <h3>{e.action}</h3>
                    <span className={base.muted}>{actionStates[e.status]}</span>
                  </div>
                  <p>{e.question}</p>
                  <p className={base.muted}>
                    投入上限：{e.budget} · 期限：{e.deadline}
                  </p>
                  <p className={css.prose}>观察标准：{e.criteria}</p>
                  {e.result && <p className={css.prose}>实际结果：{e.result}</p>}
                  <p>
                    {conclusions[e.conclusion]}
                    {e.by === "agent" ? " · AI 记录" : ""}
                  </p>
                  {e.source && (
                    <SourceEvidence
                      id={e.id}
                      label="查看结果来源"
                      load={() => props.loadExplorationSource("exploration_experiment", e.id)}
                    />
                  )}
                  <button type="button" className={base.link} onClick={() => openForm("experiment", e)}>
                    更新尝试与结果
                  </button>
                </article>
              ))}
            </>
          )}
          {tab === "changes" && (
            <div className={css.timeline}>
              {timeline.map((entry) => (
                <article key={entry.id}>
                  <time>{entry.at.replace("T", " ").slice(0, 16)}</time>
                  <span className={base.muted}>{entry.by === "user" ? "你" : "AI"}</span>
                  <p className={css.prose}>{entry.text}</p>
                  {entry.before && <p className={base.muted}>此前假设：{entry.before}</p>}
                  {entry.after && <p>当前假设：{entry.after}</p>}
                </article>
              ))}
            </div>
          )}
          <button
            type="button"
            className={base.link}
            onClick={() =>
              props.onPrompt(
                `一起研究「${direction.title}」，先通过 exploration_read 读取方向、正反依据和尝试结果，再提出下一步。`,
              )
            }
          >
            和 AI 一起梳理
          </button>
        </>
      ) : (
        <>
          <header className={css.listHeader}>
            <h2 className={v2.eyebrow}>你在探索的方向</h2>
            <button
              type="button"
              className={v2.btn}
              disabled={generation?.status === "running"}
              onClick={() => void generate()}
            >
              让 AI 提几个方向
            </button>
            <button type="button" className={v2.link} onClick={() => openForm("direction")}>
              写下一个新方向
            </button>
          </header>
          <div className={`${v2.grid} ${css.cards}`}>
            {listedDirections.map((d) => {
              const attempt = data.experiments.filter((e) => e.direction_id === d.id).at(-1);
              const evidence = data.notes.filter((n) => n.direction_id === d.id);
              const change = async (status: Direction["status"]) => {
                setBusy(true);
                setError(null);
                try {
                  await save({
                    operation: "update_direction",
                    id: d.id,
                    expected_revision: d.rev ?? 1,
                    data: { status },
                  });
                } catch (err) {
                  setError(String(err));
                } finally {
                  setBusy(false);
                }
              };
              return (
                <article
                  key={d.id}
                  className={`${v2.dir} ${v2.card} ${d.status === "paused" ? v2["is-paused"] : ""}`}
                >
                  <div className={v2["sec-head"]}>
                    <span
                      className={v2.chip}
                      style={{
                        background: d.status === "suggested" ? "var(--news-tint)" : "var(--explore-tint)",
                        color: d.status === "suggested" ? "var(--news-ink)" : "var(--explore-ink)",
                      }}
                    >
                      {states[d.status]}
                    </span>
                    {d.favorite && <span className={v2.small}>已收藏</span>}
                  </div>
                  <h3>
                    <button
                      type="button"
                      className={v2.link}
                      style={{ color: "inherit", font: "inherit" }}
                      onClick={() => {
                        setSelected(d.id);
                        setTab("overview");
                        setReceipt(null);
                      }}
                    >
                      {d.title}
                    </button>
                  </h3>
                  {d.status === "suggested" ? (
                    <div className={css.prose}>
                      <p>{d.motivation || "这条建议还没有写明依据"}</p>
                      <p>{d.hypothesis}</p>
                      {d.unknowns && <p>还不清楚：{d.unknowns}</p>}
                      {d.references
                        ?.filter((ref) => ref.kind === "source" && /^https?:\/\//.test(ref.ref))
                        .map((ref) => (
                          <p key={ref.ref}>
                            <a href={ref.ref} target="_blank" rel="noreferrer">
                              {ref.ref}
                            </a>
                          </p>
                        ))}
                    </div>
                  ) : (
                    <dl>
                      <dt>当前猜想</dt>
                      <dd>{d.hypothesis || "还没有写下猜想"}</dd>
                      <dt>还不清楚</dt>
                      <dd>{d.unknowns || "尚未记录"}</dd>
                    </dl>
                  )}
                  {attempt && (
                    <div className={v2.attempt}>
                      <span className={v2.small}>{d.status === "paused" ? "上次尝试" : "这次尝试"}</span>
                      <b>{attempt.action}</b>
                      <span className={v2.small}>
                        投入：{attempt.budget} · 期限：{attempt.deadline}
                      </span>
                      {attempt.result && <p>{attempt.result}</p>}
                    </div>
                  )}
                  {d.status !== "suggested" && (
                    <div className={v2.evidence}>
                      {(
                        [
                          ["supports", "支持"],
                          ["refutes", "反对"],
                          ["unclear", "还说不准"],
                        ] as const
                      ).map(([stance, label]) => (
                        <span key={stance} className={v2.chip}>
                          {label} {evidence.filter((n) => n.stance === stance).length}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className={v2["dir-foot"]}>
                    {d.status === "suggested" ? (
                      <>
                        <button
                          type="button"
                          className={`${v2.btn} ${v2["btn-primary"]}`}
                          disabled={busy}
                          onClick={() => void change("active")}
                        >
                          采纳
                        </button>
                        <button
                          type="button"
                          className={v2.link}
                          disabled={busy}
                          onClick={() => void change("dismissed")}
                        >
                          不感兴趣
                        </button>
                        <button
                          type="button"
                          className={v2.link}
                          disabled={generation?.status === "running"}
                          onClick={() => void generate()}
                        >
                          换一批
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className={v2.link}
                          onClick={() => {
                            setSelected(d.id);
                            setTab("overview");
                          }}
                        >
                          打开方向 →
                        </button>
                        <button
                          type="button"
                          className={v2.link}
                          disabled={busy}
                          onClick={() => void change(d.status === "active" ? "paused" : "active")}
                        >
                          {d.status === "active" ? "暂停" : "继续探索"}
                        </button>
                      </>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
          <details>
            <summary className={v2.link}>筛选方向</summary>{" "}
            <nav className={base.secondaryNav} aria-label="方向筛选">
              {(
                [
                  ["current", "当前"],
                  ["favorites", "收藏"],
                  ["history", "已归档"],
                ] as const
              ).map(([id, title]) => (
                <button type="button" key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>
                  {title}
                </button>
              ))}
            </nav>
          </details>
          {!data.directions.length && (
            <div className={base.focus}>
              <h2>一个值得探索的问题</h2>
              <p className={base.subtitle}>可以是创作、学习、职业，或一个尚不确定的想法。</p>
            </div>
          )}
          {!!data.directions.length && !listedDirections.length && (
            <p className={base.muted}>
              {filter === "favorites"
                ? "还没有收藏的方向。打开一个方向后可以收藏。"
                : filter === "history"
                  ? "还没有暂停、归档或忽略的方向。"
                  : "当前没有正在探索的方向，可以记下新问题，或从暂停与归档中继续。"}
            </p>
          )}
          {!!props.goals?.length && (
            <details>
              <summary>从已有目标出发</summary>
              {props.goals.map((goal) => (
                <div key={goal.id} className={base.row}>
                  <strong>{goal.title}</strong>
                  <button
                    type="button"
                    className={base.link}
                    onClick={() => {
                      setSeed({ title: goal.title });
                      setEditing(null);
                      setForm("direction");
                    }}
                  >
                    建立为方向
                  </button>
                </div>
              ))}
            </details>
          )}
        </>
      )}
    </section>
  );
}
