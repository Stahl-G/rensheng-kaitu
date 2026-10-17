import { type ReactNode, useId, useState } from "react";
import type {
  Direction,
  DirectionNote,
  ExplorationCommand,
  ExplorationData,
  ExplorationExperiment,
  ExplorationReference,
} from "../types.js";
import css from "./DirectionsPage.module.css";
import { FilePicker } from "./DshFiles.js";
import base from "./OverviewPage.module.css";

function FormShell({
  title,
  children,
  save,
  cancel,
}: { title: string; children: ReactNode; save: (form: FormData) => Promise<void>; cancel: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className={css.form}
      aria-label={title}
      aria-busy={busy}
      onSubmit={async (e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        setBusy(true);
        setError(null);
        try {
          await save(form);
        } catch (error) {
          setError(error instanceof Error ? error.message : String(error));
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>{title}</h2>
      <fieldset disabled={busy}>{children}</fieldset>
      {error && (
        <p className={base.notice} role="alert">
          {error}
        </p>
      )}
      <div className={css.actions}>
        <button className={`${base.button} ${base.primary}`} type="submit" disabled={busy}>
          {busy ? "保存中…" : "保存"}
        </button>
        <button type="button" className={base.link} onClick={cancel} disabled={busy}>
          取消
        </button>
      </div>
    </form>
  );
}
function Field({
  name,
  label,
  value,
  optional = false,
  multiline = false,
  type = "text",
}: { name: string; label: string; value?: string; optional?: boolean; multiline?: boolean; type?: string }) {
  const id = useId();
  const [text, setText] = useState(value ?? "");
  const [picking, setPicking] = useState(false);
  return (
    <div>
      <label htmlFor={id}>
        {label}
        {multiline ? (
          <textarea
            id={id}
            name={name}
            aria-label={label}
            value={text}
            onChange={(event) => setText(event.target.value)}
            required={!optional}
            rows={3}
            maxLength={100000}
          />
        ) : (
          <input
            id={id}
            name={name}
            aria-label={label}
            value={text}
            onChange={(event) => setText(event.target.value)}
            required={!optional}
            type={type}
            maxLength={100000}
          />
        )}
      </label>
      {["source", "sources"].includes(name) && (
        <button type="button" className={base.link} onClick={() => setPicking(true)}>
          选择开图资料…
        </button>
      )}
      {picking && (
        <FilePicker
          filesOnly
          close={() => setPicking(false)}
          select={(path) => {
            setText(multiline && text.trim() ? `${text.trim()}\n${path}` : path);
            setPicking(false);
          }}
        />
      )}
    </div>
  );
}
function References({ data, selected = [] }: { data: ExplorationData; selected?: ExplorationReference[] }) {
  const missing = selected.filter(
    (ref) =>
      (ref.kind === "project" && !data.references.projects.some((project) => project.id === ref.ref)) ||
      (ref.kind === "decision" && !data.references.decisions.some((decision) => decision.path === ref.ref)),
  );
  return (
    <details>
      <summary>关联资料（可选）</summary>
      <div className={css.referenceFields}>
        {missing.length > 0 && (
          <fieldset>
            <legend>暂时找不到的关联资料</legend>
            <p>保留原有关联。若资料已移除，请取消勾选后保存。</p>
            {missing.map((ref) => (
              <label key={`${ref.kind}:${ref.ref}`} className={css.check}>
                <input type="checkbox" name={ref.kind} value={ref.ref} defaultChecked />
                {ref.ref}
              </label>
            ))}
          </fieldset>
        )}
        {!!data.references.projects.length && (
          <fieldset>
            <legend>项目</legend>
            {data.references.projects.map((p) => (
              <label key={p.id} className={css.check}>
                <input
                  type="checkbox"
                  name="project"
                  value={p.id}
                  defaultChecked={selected.some((r) => r.kind === "project" && r.ref === p.id)}
                />
                {p.title}
              </label>
            ))}
          </fieldset>
        )}
        {!!data.references.decisions.length && (
          <fieldset>
            <legend>决策</legend>
            {data.references.decisions.map((d) => (
              <label key={d.path} className={css.check}>
                <input
                  type="checkbox"
                  name="decision"
                  value={d.path}
                  defaultChecked={selected.some((r) => r.kind === "decision" && r.ref === d.path)}
                />
                {d.title}
              </label>
            ))}
          </fieldset>
        )}
        <Field
          name="sources"
          label="原文链接或资料位置（每行一个）"
          optional
          multiline
          value={selected
            .filter((r) => r.kind === "source")
            .map((r) => r.ref)
            .join("\n")}
        />
      </div>
    </details>
  );
}
const value = (form: FormData, name: string) => String(form.get(name) ?? "").trim();
function references(form: FormData): ExplorationReference[] {
  return [
    ...form.getAll("project").map((ref) => ({ kind: "project" as const, ref: String(ref) })),
    ...form.getAll("decision").map((ref) => ({ kind: "decision" as const, ref: String(ref) })),
    ...value(form, "sources")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((ref) => ({ kind: "source" as const, ref })),
  ];
}
export function DirectionForm({
  data,
  initial,
  seed,
  save,
  cancel,
}: {
  data: ExplorationData;
  initial?: Direction;
  seed?: { title: string; hypothesis?: string };
  save: (command: ExplorationCommand) => Promise<void>;
  cancel: () => void;
}) {
  return (
    <FormShell
      title={initial ? "调整方向" : "记下一个方向"}
      cancel={cancel}
      save={async (form) => {
        const fields = {
          title: value(form, "title"),
          motivation: value(form, "motivation"),
          hypothesis: value(form, "hypothesis"),
          unknowns: value(form, "unknowns"),
          references: references(form),
        };
        await save(
          initial
            ? {
                operation: "update_direction",
                id: initial.id,
                expected_revision: initial.rev ?? 1,
                data: fields,
              }
            : { operation: "create_direction", data: fields },
        );
      }}
    >
      <Field name="title" label="我想探索什么" value={initial?.title ?? seed?.title} />
      <Field name="motivation" label="为什么在意（可选）" optional value={initial?.motivation} multiline />
      <Field
        name="hypothesis"
        label="我目前的假设（可选）"
        optional
        value={initial?.hypothesis ?? seed?.hypothesis}
        multiline
      />
      <Field name="unknowns" label="还不知道什么（可选）" value={initial?.unknowns} multiline optional />
      <References data={data} selected={initial?.references} />
    </FormShell>
  );
}
export function ExperimentForm({
  direction,
  initial,
  save,
  cancel,
}: {
  direction: Direction;
  initial?: ExplorationExperiment;
  save: (command: ExplorationCommand) => Promise<void>;
  cancel: () => void;
}) {
  return (
    <FormShell
      title={initial ? "更新尝试与结果" : "安排一个小尝试"}
      cancel={cancel}
      save={async (form) => {
        const fields = {
          question: value(form, "question"),
          action: value(form, "action"),
          budget: value(form, "budget"),
          deadline: value(form, "deadline"),
          criteria: value(form, "criteria"),
        };
        await save(
          initial
            ? {
                operation: "update_experiment",
                id: initial.id,
                expected_revision: initial.rev ?? 1,
                data: {
                  ...fields,
                  status: value(form, "status") as ExplorationExperiment["status"],
                  result: value(form, "result"),
                  conclusion: value(form, "conclusion") as ExplorationExperiment["conclusion"],
                  source: value(form, "source"),
                },
              }
            : { operation: "create_experiment", data: { ...fields, direction_id: direction.id } },
        );
      }}
    >
      <Field
        name="question"
        label="这次想弄清的问题"
        value={initial?.question ?? (direction.hypothesis || direction.title)}
        multiline
      />
      <Field name="action" label="具体做什么" value={initial?.action} multiline />
      <div className={css.fieldsRow}>
        <Field name="budget" label="投入上限" value={initial?.budget} />
        <Field name="deadline" label="期限" value={initial?.deadline} type="date" />
      </div>
      <Field name="criteria" label="怎样观察结果" value={initial?.criteria} multiline />
      {initial && (
        <>
          <label>
            行动状态
            <select name="status" aria-label="行动状态" defaultValue={initial.status}>
              <option value="planned">计划中</option>
              <option value="active">进行中</option>
              <option value="completed">已完成行动</option>
              <option value="cancelled">已取消</option>
            </select>
          </label>
          <Field name="result" label="实际观察到什么" value={initial.result} multiline optional />
          <label>
            这些结果对假设意味着什么
            <select name="conclusion" aria-label="假设结论" defaultValue={initial.conclusion}>
              <option value="unassessed">暂不判断</option>
              <option value="supports">支持假设</option>
              <option value="refutes">反驳假设</option>
              <option value="inconclusive">证据还不足</option>
            </select>
          </label>
          <Field name="source" label="结果来源（可选）" value={initial.source} optional />
        </>
      )}
    </FormShell>
  );
}
export function NoteForm({
  direction,
  data,
  experiments,
  initial,
  save,
  cancel,
}: {
  direction: Direction;
  data: ExplorationData;
  experiments: ExplorationExperiment[];
  initial?: DirectionNote;
  save: (command: ExplorationCommand) => Promise<void>;
  cancel: () => void;
}) {
  return (
    <FormShell
      title={initial ? "修正资料" : "补充依据或认识"}
      cancel={cancel}
      save={async (form) => {
        const fields = {
          kind: value(form, "kind") as DirectionNote["kind"],
          text: value(form, "text"),
          stance: value(form, "stance") as DirectionNote["stance"],
          source: value(form, "source"),
          references: references(form),
        };
        await save(
          initial
            ? { operation: "update_note", id: initial.id, expected_revision: initial.rev ?? 1, data: fields }
            : {
                operation: "add_note",
                data: {
                  ...fields,
                  direction_id: direction.id,
                  ...(value(form, "experiment") ? { experiment_id: value(form, "experiment") } : {}),
                },
              },
        );
      }}
    >
      {initial && <p className={base.muted}>这条资料针对的问题：{initial.question}</p>}
      <label>
        内容类型
        <select name="kind" aria-label="内容类型" defaultValue={initial?.kind ?? "evidence"}>
          <option value="evidence">依据与资料</option>
          <option value="reflection">新的认识</option>
          <option value="decision">我的决定</option>
        </select>
      </label>
      <Field name="text" label="内容" value={initial?.text} multiline />
      <label>
        与当前假设的关系
        <select name="stance" aria-label="与假设的关系" defaultValue={initial?.stance ?? "unclear"}>
          <option value="unclear">还不能判断</option>
          <option value="supports">提供支持</option>
          <option value="refutes">提供反面证据</option>
        </select>
      </label>
      <Field name="source" label="来源链接或资料位置（可选）" value={initial?.source} optional />
      {!initial && experiments.length > 0 && (
        <label>
          关联尝试（可选）
          <select name="experiment" aria-label="关联尝试" defaultValue="">
            <option value="">不关联</option>
            {experiments.map((e) => (
              <option key={e.id} value={e.id}>
                {e.action}
              </option>
            ))}
          </select>
        </label>
      )}
      <References data={data} selected={initial?.references} />
    </FormShell>
  );
}
