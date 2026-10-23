import { directionText } from "@kaitu/core/direction-copy";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
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
import { type Locale, useLocale, useT } from "./i18n.js";

export interface DirectionsPageProps {
  generateDirections?: (start: boolean) => Promise<{
    status: "idle" | "running" | "done" | "error";
    stage: string;
    error?: string;
  }>;
  onConnect?: () => void;
  /** 剪贴板协议：把提示词复制给自己的 AI，再把方向建议贴回来。 */
  directionsPrompt?: (locale?: Locale) => Promise<string>;
  pasteDirections?: (answer: string, locale?: Locale) => Promise<{ ids: string[]; skipped: number }>;
  loadExploration: () => Promise<ExplorationData>;
  writeExploration: (command: ExplorationCommand) => Promise<{ id: string; version: string | null }>;
  loadExplorationSource: (
    owner: "direction" | "direction_note" | "exploration_experiment",
    id: string,
    reference?: number,
  ) => Promise<ExperienceSource>;
  subscribe?: (refresh: () => void) => () => void;
  goals?: MeGoal[];
  /** Shared planning actions are supplied by Overview without duplicating their write flow. */
  planningContent?: ReactNode;
  onPrompt: (text: string) => void;
}
const states = {
  suggested: "AI 建议 · 待采纳",
  active: "在试",
  paused: "已暂停",
  archived: "已归档",
  dismissed: "已忽略",
};
const statesEn = {
  suggested: "AI suggestion · to adopt",
  active: "Trying",
  paused: "Paused",
  archived: "Archived",
  dismissed: "Dismissed",
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
const DIRECTION_EN: Record<string, string> = {
  计划中: "Planned",
  进行中: "In progress",
  行动已完成: "Action completed",
  已完成行动: "Action completed",
  已取消: "Cancelled",
  暂未判断假设: "Hypothesis not assessed",
  支持假设: "Supports hypothesis",
  反驳假设: "Refutes hypothesis",
  证据还不足: "Inconclusive",
  还不能判断: "Not assessed yet",
  支持依据: "Supporting evidence",
  反面证据: "Contrary evidence",
  依据与资料: "Evidence and sources",
  新的认识: "Reflection",
  我的决定: "My decision",
  "项目：": "Project: ",
  "决策：": "Decision: ",
  "原文：": "Source: ",
  关联项目: "Linked project",
  决策记录: "Decision",
  外部参考资料: "External source",
  个人资料: "Personal files",
  查看关联资料: "View linked source",
  已保存: "Saved",
  修正资料: "Correct source",
  重新读取: "Reload",
  "← 全部方向": "← All directions",
  取消收藏: "Unsave",
  收藏: "Save",
  方向详情: "Direction details",
  概览: "Overview",
  资料: "Sources",
  尝试: "Experiments",
  变化: "Changes",
  为什么在意: "Why it matters",
  目前的假设: "Current hypothesis",
  仍然未知: "Still unknown",
  需要认真看待的反面证据: "Contrary evidence to consider",
  最近的尝试: "Recent experiments",
  安排一个小尝试: "Plan a small experiment",
  补充依据或认识: "Add evidence or reflection",
  方向管理: "Manage direction",
  采纳这个方向: "Adopt this direction",
  不感兴趣: "Not interested",
  暂停方向: "Pause direction",
  继续探索: "Resume",
  归档方向: "Archive direction",
  调整问题与假设: "Edit question and hypothesis",
  还没有资料: "No sources yet",
  还没有尝试: "No experiments yet",
  查看结果来源: "View result source",
  更新尝试与结果: "Update experiment and result",
  "和 AI 一起梳理": "Explore with AI",
  你: "You",
  历史尝试: "Past experiment",
};
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
  const t = useT();
  const label = (value: string) => t(value, DIRECTION_EN[value] ?? value);
  return (
    <>
      {items?.map((item, index) => (
        <div key={`${item.kind}:${item.ref}`} className={css.reference}>
          <p>
            {item.kind === "project"
              ? label("项目：")
              : item.kind === "decision"
                ? label("决策：")
                : label("原文：")}
            {item.kind === "project"
              ? (data?.references.projects.find((p) => p.id === item.ref)?.title ?? label("关联项目"))
              : item.kind === "decision"
                ? (data?.references.decisions.find((d) => d.path === item.ref)?.title ?? label("决策记录"))
                : /^https?:\/\//i.test(item.ref)
                  ? label("外部参考资料")
                  : label("个人资料")}
          </p>
          <SourceEvidence id={id} label={label("查看关联资料")} load={() => load(owner, id, index)} />
        </div>
      ))}
    </>
  );
}

/** 没有内置 AI 时，用自己常用的 AI 提方向：复制提示词，贴回建议，建议进「待采纳」。 */
function ClipboardDirections({
  directionsPrompt,
  pasteDirections,
  done,
}: {
  directionsPrompt: NonNullable<DirectionsPageProps["directionsPrompt"]>;
  pasteDirections: NonNullable<DirectionsPageProps["pasteDirections"]>;
  done: (message: string) => Promise<void>;
}) {
  const t = useT();
  const locale = useLocale();
  const [prompt, setPrompt] = useState("");
  const [answer, setAnswer] = useState("");
  const [copied, setCopied] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);
  return (
    <div
      className={`${v2.card} ${v2["sub-form"]}`}
      aria-label={t("用你常用的 AI 提方向", "Ask your own AI for directions")}
    >
      <b>{t("用你常用的 AI 提方向", "Ask the AI you already use")}</b>
      <div className={v2["dialog-foot"]}>
        {copied && <output className={v2.small}>{copied}</output>}
        <button
          type="button"
          className={`${v2.btn} ${v2["btn-quiet"]}`}
          disabled={busy}
          onClick={() =>
            void (async () => {
              setError("");
              try {
                const text = prompt || (await directionsPrompt(locale));
                setPrompt(text);
                try {
                  await navigator.clipboard.writeText(text);
                  setCopied(t("已复制，去你的 AI 里粘贴发送", "Copied. Paste it into your AI and send"));
                } catch {
                  setCopied(t("已显示在下面，请全选复制", "Shown below; select all and copy"));
                  requestAnimationFrame(() => area.current?.select());
                }
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              }
            })()
          }
        >
          {t("1 · 复制提示词", "1 · Copy the research prompt")}
        </button>
      </div>
      {prompt && (
        <textarea ref={area} readOnly rows={4} value={prompt} aria-label={t("提示词", "Research prompt")} />
      )}
      <textarea
        rows={5}
        value={answer}
        disabled={busy}
        aria-label={t("AI 的回答", "The AI's answer")}
        placeholder={t(
          "2 · 把 AI 按【方向】格式回复的内容贴到这里",
          "2 · Paste what the AI replied in the [Direction] format",
        )}
        onChange={(event) => setAnswer(event.target.value)}
      />
      {error && (
        <p role="alert" className={v2.error}>
          {error}
        </p>
      )}
      <div className={v2["dialog-foot"]}>
        <button
          type="button"
          className={v2.btn}
          disabled={busy || !answer.trim()}
          onClick={() => {
            setBusy(true);
            setError("");
            void pasteDirections(answer, locale)
              .then(async (result) => {
                setAnswer("");
                await done(
                  t(
                    `加入了 ${result.ids.length} 个方向建议${result.skipped ? `，${result.skipped} 个已存在` : ""}，在下面采纳或选不感兴趣`,
                    `Added ${result.ids.length} suggestions${result.skipped ? ` (${result.skipped} already there)` : ""}. Adopt or dismiss them below`,
                  ),
                );
              })
              .catch((err) => setError(err instanceof Error ? err.message : String(err)))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? t("正在读取…", "Reading…") : t("3 · 读取方向建议", "3 · Read the suggestions")}
        </button>
      </div>
    </div>
  );
}

export function DirectionsPage(props: DirectionsPageProps) {
  const t = useT();
  const label = (value: string) => t(value, DIRECTION_EN[value] ?? value);
  const locale = useLocale();
  const stateLabel = (status: Direction["status"]) => (locale === "en" ? statesEn[status] : states[status]);
  const [clipboard, setClipboard] = useState(false);
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
    setGeneration({ status: "running", stage: t("读资料", "Reading sources") });
    try {
      if (!props.generateDirections) {
        setGeneration(undefined);
        props.onConnect?.();
        return;
      }
      setGeneration(await props.generateDirections(true));
    } catch (error) {
      setGeneration(undefined);
      const message = error instanceof Error ? error.message : String(error);
      // 没连内置 AI 时直接给出「用你常用的 AI」这条路，而不是只让用户去连接。
      if (props.pasteDirections && /连接 AI|AI_CONNECTION/.test(message)) {
        setClipboard(true);
        setError(t("还没有连接 AI", "No AI connected"));
      } else setError(message);
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
    setReceipt(label("已保存"));
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
          <strong>{label(kinds[note.kind])}</strong>
          <span className={base.muted}>
            {label(stances[note.stance])} · {note.by === "user" ? label("你") : "AI"}
          </span>
        </div>
        {note.question !== (direction?.hypothesis || direction?.title) && (
          <p className={base.muted}>
            {t("记录时针对的问题：", "Question when recorded: ")}
            {note.question}
          </p>
        )}
        <p className={css.prose}>{note.text}</p>
        {note.experiment_id && (
          <p className={base.muted}>
            {t("来自尝试：", "From experiment: ")}
            {experiments.find((e) => e.id === note.experiment_id)?.action ?? label("历史尝试")}
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
          {label("修正资料")}
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
              {label("重新读取")}
            </button>
          </p>
        ) : (
          <p className={base.muted}>{t("正在读取方向…", "Loading directions…")}</p>
        )}
      </section>
    );
  return (
    <section className={css.page} aria-label={t("探索方向", "Directions")}>
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
          {t("AI 与连接", "AI & connections")}
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
              {label("← 全部方向")}
            </button>
            <span className={base.muted}>{stateLabel(direction.status)}</span>
          </header>
          <div className={css.heading}>
            <h2>{directionText(direction.title, 120)}</h2>
            <button
              type="button"
              className={base.link}
              disabled={busy}
              onClick={() => void update({ favorite: !direction.favorite })}
            >
              {direction.favorite ? label("取消收藏") : label("收藏")}
            </button>
          </div>
          <nav className={base.secondaryNav} aria-label={label("方向详情")}>
            {(
              [
                ["overview", label("概览")],
                ["sources", label("资料")],
                ["experiments", label("尝试")],
                ["changes", label("变化")],
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
                <h3>{label("为什么在意")}</h3>
                <p>{directionText(direction.motivation, 600) || "—"}</p>
                <h3>{label("目前的假设")}</h3>
                <p>{directionText(direction.hypothesis, 400) || "—"}</p>
                {direction.unknowns && (
                  <>
                    <h3>{label("仍然未知")}</h3>
                    <p>{directionText(direction.unknowns, 240)}</p>
                  </>
                )}
              </div>

              {notes.some((n) => n.stance === "refutes") && (
                <section>
                  <h3>{label("需要认真看待的反面证据")}</h3>
                  {noteItems(notes.filter((n) => n.stance === "refutes").slice(-2))}
                </section>
              )}
              {experiments.length > 0 && (
                <section>
                  <h3>{label("最近的尝试")}</h3>
                  {experiments.slice(-2).map((e) => (
                    <article key={e.id} className={css.item}>
                      <strong>{e.action}</strong>
                      <p className={base.muted}>
                        {label(actionStates[e.status])} · {label(conclusions[e.conclusion])}
                      </p>
                      {e.question !== (direction.hypothesis || direction.title) && (
                        <p className={base.muted}>
                          {t("这次验证的问题：", "Question tested: ")}
                          {e.question}
                        </p>
                      )}
                      {e.result && <p className={css.prose}>{e.result}</p>}
                    </article>
                  ))}
                </section>
              )}
              <div className={css.actions}>
                {direction.status === "active" && (
                  <button type="button" className={base.button} onClick={() => openForm("experiment")}>
                    {label("安排一个小尝试")}
                  </button>
                )}
                <button type="button" className={base.link} onClick={() => openForm("note")}>
                  {label("补充依据或认识")}
                </button>
              </div>
              <details>
                <summary>{label("方向管理")}</summary>
                <div className={css.actions}>
                  {direction.status === "suggested" ? (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        className={base.button}
                        onClick={() => void update({ status: "active" })}
                      >
                        {label("采纳这个方向")}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        className={base.link}
                        onClick={() => void update({ status: "dismissed" })}
                      >
                        {label("不感兴趣")}
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
                        {direction.status === "active" ? label("暂停方向") : label("继续探索")}
                      </button>
                      {direction.status !== "archived" && (
                        <button
                          type="button"
                          disabled={busy}
                          className={base.link}
                          onClick={() => void update({ status: "archived" })}
                        >
                          {label("归档方向")}
                        </button>
                      )}
                    </>
                  )}
                  <button
                    type="button"
                    className={base.link}
                    onClick={() => openForm("direction", direction)}
                  >
                    {label("调整问题与假设")}
                  </button>
                </div>
              </details>
            </>
          )}
          {tab === "sources" && (
            <>
              <ReferenceList
                data={data}
                load={props.loadExplorationSource}
                owner="direction"
                id={direction.id}
                items={direction.references}
              />
              <div className={css.actions}>
                <button type="button" className={base.button} onClick={() => openForm("note")}>
                  {label("补充依据或认识")}
                </button>
              </div>
              {notes.length ? noteItems(notes) : <p className={base.muted}>{label("还没有资料")}</p>}
            </>
          )}
          {tab === "experiments" && (
            <>
              {direction.status === "active" && (
                <button type="button" className={base.button} onClick={() => openForm("experiment")}>
                  {label("安排一个小尝试")}
                </button>
              )}
              {!experiments.length && <p className={base.muted}>{label("还没有尝试")}</p>}
              {experiments.map((e) => (
                <article key={`${e.id}:${e.rev ?? 1}`} className={css.item}>
                  <div className={css.itemHeader}>
                    <h3>{e.action}</h3>
                    <span className={base.muted}>{label(actionStates[e.status])}</span>
                  </div>
                  <p>{e.question}</p>
                  <p className={base.muted}>
                    {t("投入上限：", "Budget: ")}
                    {e.budget} · {t("期限：", "Due: ")}
                    {e.deadline}
                  </p>
                  <p className={css.prose}>
                    {t("观察标准：", "Observation criteria: ")}
                    {e.criteria}
                  </p>
                  {e.result && (
                    <p className={css.prose}>
                      {t("实际结果：", "Observed result: ")}
                      {e.result}
                    </p>
                  )}
                  <p>
                    {label(conclusions[e.conclusion])}
                    {e.by === "agent" ? t(" · AI 记录", " · Recorded by AI") : ""}
                  </p>
                  {e.source && (
                    <SourceEvidence
                      id={e.id}
                      label={label("查看结果来源")}
                      load={() => props.loadExplorationSource("exploration_experiment", e.id)}
                    />
                  )}
                  <button type="button" className={base.link} onClick={() => openForm("experiment", e)}>
                    {label("更新尝试与结果")}
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
                  <span className={base.muted}>{entry.by === "user" ? label("你") : "AI"}</span>
                  <p className={css.prose}>{entry.text}</p>
                  {entry.before && (
                    <p className={base.muted}>
                      {t("此前假设：", "Previous hypothesis: ")}
                      {entry.before}
                    </p>
                  )}
                  {entry.after && (
                    <p>
                      {t("当前假设：", "Current hypothesis: ")}
                      {entry.after}
                    </p>
                  )}
                </article>
              ))}
            </div>
          )}
          <button
            type="button"
            className={base.link}
            onClick={() =>
              props.onPrompt(
                t(
                  `一起研究「${direction.title}」，先通过 exploration_read 读取方向、正反依据和尝试结果，再提出下一步。`,
                  `Explore “${direction.title}” with me. Use exploration_read to read the direction, supporting and contrary evidence and experiment results before suggesting a next step.`,
                ),
              )
            }
          >
            {label("和 AI 一起梳理")}
          </button>
        </>
      ) : (
        <>
          <h1>{t("方向", "Directions")}</h1>
          {props.planningContent && (
            <section className={css.planning} aria-label={t("想做成的事", "Things you want to get done")}>
              <h2>{t("想做成的事", "Things you want to get done")}</h2>
              {props.planningContent}
            </section>
          )}
          <header className={css.listHeader}>
            <h2 className={v2.eyebrow}>{t("你在探索的方向", "Directions you're exploring")}</h2>
            <button
              type="button"
              className={v2.btn}
              disabled={generation?.status === "running"}
              onClick={() => void generate()}
            >
              {t("让 AI 提几个方向", "Ask AI for directions")}
            </button>
            {props.pasteDirections && (
              <button type="button" className={v2.link} onClick={() => setClipboard(!clipboard)}>
                {t("用你常用的 AI 提", "Use your own AI")}
              </button>
            )}
            <button type="button" className={v2.link} onClick={() => openForm("direction")}>
              {t("写下一个新方向", "Write a new direction")}
            </button>
          </header>
          {clipboard && props.directionsPrompt && props.pasteDirections && (
            <ClipboardDirections
              directionsPrompt={props.directionsPrompt}
              pasteDirections={props.pasteDirections}
              done={async (message) => {
                setClipboard(false);
                setError(null);
                setReceipt(message);
                await refresh();
              }}
            />
          )}
          {!!data.directions.length && (
            <nav className={base.secondaryNav} aria-label={t("方向筛选", "Direction filter")}>
              {(
                [
                  ["current", t("当前", "Current")],
                  ["favorites", t("收藏", "Saved")],
                  ["history", t("已归档", "Archived")],
                ] as const
              ).map(([id, title]) => (
                <button type="button" key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>
                  {title}
                </button>
              ))}
            </nav>
          )}
          <div className={css.directionList}>
            {listedDirections.map((d) => {
              const ownAttempts = data.experiments.filter((e) => e.direction_id === d.id);
              const attempt =
                ownAttempts.find((e) => e.status === "active") ??
                ownAttempts.find((e) => e.status === "planned");
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
              const open = () => {
                setSelected(d.id);
                setTab("overview");
                setReceipt(null);
              };
              return (
                <article key={d.id} className={css.ideaRow} data-paused={d.status === "paused"}>
                  <div className={css.ideaBody}>
                    <div className={css.ideaHeading}>
                      <span className={v2.chip}>{stateLabel(d.status)}</span>
                      {d.favorite && <span className={v2.small}>{t("已收藏", "Saved")}</span>}
                    </div>
                    <h3>
                      <button type="button" className={css.ideaTitle} onClick={open}>
                        {directionText(d.title, 60)}
                      </button>
                    </h3>
                    <p className={css.ideaSummary}>
                      {directionText(d.motivation, 110).split(/(?<=[。！？!?])\s*/)[0] ||
                        t("先记下这个想法，试过再判断。", "Keep the idea and learn by trying.")}
                    </p>
                    {attempt?.action && (
                      <p className={css.ideaNext}>
                        <span>{t("第一步", "First step")}</span>
                        {directionText(attempt.action, 100)}
                      </p>
                    )}
                    {attempt && (
                      <>
                        <p className={css.ideaNext}>
                          <span>{t("投入上限", "Budget")}</span>
                          {directionText(attempt.budget, 100)}
                        </p>
                        <p className={css.ideaNext}>
                          <span>{t("看什么", "What to observe")}</span>
                          {directionText(attempt.criteria, 160)}
                        </p>
                        <p className={css.ideaNext}>
                          <span>{t("期限", "Deadline")}</span>
                          {attempt.deadline}
                        </p>
                      </>
                    )}
                    {!attempt && (
                      <p className={css.ideaNext}>{t("还没有安排下一步", "No next step planned yet")}</p>
                    )}
                  </div>
                  <div className={css.ideaActions}>
                    {d.status === "suggested" ? (
                      <>
                        <button
                          type="button"
                          className={v2.btn}
                          disabled={busy}
                          onClick={() => void change("active")}
                        >
                          {t("采纳", "Adopt")}
                        </button>
                        <button
                          type="button"
                          className={v2.link}
                          disabled={busy}
                          onClick={() => void change("dismissed")}
                        >
                          {t("不感兴趣", "Not interested")}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className={v2.link}
                        disabled={busy}
                        onClick={() => void change(d.status === "active" ? "paused" : "active")}
                      >
                        {d.status === "active" ? t("暂停", "Pause") : t("继续探索", "Resume")}
                      </button>
                    )}
                    <button type="button" className={v2.link} onClick={open}>
                      {t("查看详情", "Details")}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
          {!data.directions.length && (
            <div className={base.focus}>
              <h2>{t("一个值得探索的问题", "A question worth exploring")}</h2>
            </div>
          )}
          {!!data.directions.length && !listedDirections.length && (
            <p className={base.muted}>
              {filter === "favorites"
                ? t("还没有收藏的方向", "No saved directions")
                : filter === "history"
                  ? t("没有暂停或归档的方向", "Nothing paused or archived")
                  : t("没有正在探索的方向", "Nothing in progress")}
            </p>
          )}
          {!!props.goals?.length && (
            <details>
              <summary>{t("从已有目标出发", "Start from a goal you have")}</summary>
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
                    {t("建立为方向", "Make it a direction")}
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
