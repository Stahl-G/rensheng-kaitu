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
import { useT } from "./i18n.js";

function FormShell({
  title,
  children,
  save,
  cancel,
}: { title: string; children: ReactNode; save: (form: FormData) => Promise<void>; cancel: () => void }) {
  const t = useT();
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
          {busy ? t("保存中…", "Saving…") : t("保存", "Save")}
        </button>
        <button type="button" className={base.link} onClick={cancel} disabled={busy}>
          {t("取消", "Cancel")}
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
  const t = useT();
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
          {t("选择开图资料…", "Choose Kaitu files…")}
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
  const t = useT();
  const missing = selected.filter(
    (ref) =>
      (ref.kind === "project" && !data.references.projects.some((project) => project.id === ref.ref)) ||
      (ref.kind === "decision" && !data.references.decisions.some((decision) => decision.path === ref.ref)),
  );
  return (
    <details>
      <summary>{t("关联资料（可选）", "Linked sources (optional)")}</summary>
      <div className={css.referenceFields}>
        {missing.length > 0 && (
          <fieldset>
            <legend>{t("暂时找不到的关联资料", "Unavailable linked sources")}</legend>
            <p>
              {t(
                "保留原有关联。若资料已移除，请取消勾选后保存。",
                "Existing links are kept. Uncheck a removed source before saving.",
              )}
            </p>
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
            <legend>{t("项目", "Projects")}</legend>
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
            <legend>{t("决策", "Decisions")}</legend>
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
          label={t("原文链接或资料位置（每行一个）", "Source links or file locations (one per line)")}
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
  const t = useT();
  return (
    <FormShell
      title={initial ? t("调整方向", "Edit direction") : t("记下一个方向", "Add a direction")}
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
      <Field
        name="title"
        label={t("我想探索什么", "What I want to explore")}
        value={initial?.title ?? seed?.title}
      />
      <Field
        name="motivation"
        label={t("为什么在意（可选）", "Why it matters (optional)")}
        optional
        value={initial?.motivation}
        multiline
      />
      <Field
        name="hypothesis"
        label={t("我目前的假设（可选）", "My current hypothesis (optional)")}
        optional
        value={initial?.hypothesis ?? seed?.hypothesis}
        multiline
      />
      <Field
        name="unknowns"
        label={t("还不知道什么（可选）", "What I don’t know yet (optional)")}
        value={initial?.unknowns}
        multiline
        optional
      />
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
  const t = useT();
  return (
    <FormShell
      title={
        initial
          ? t("更新尝试与结果", "Update experiment and result")
          : t("安排一个小尝试", "Plan a small experiment")
      }
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
        label={t("这次想弄清的问题", "Question to explore")}
        value={initial?.question ?? (direction.hypothesis || direction.title)}
        multiline
      />
      <Field name="action" label={t("具体做什么", "What to do")} value={initial?.action} multiline />
      <div className={css.fieldsRow}>
        <Field name="budget" label={t("投入上限", "Budget limit")} value={initial?.budget} />
        <Field name="deadline" label={t("期限", "Due date")} value={initial?.deadline} type="date" />
      </div>
      <Field
        name="criteria"
        label={t("怎样观察结果", "How to observe results")}
        value={initial?.criteria}
        multiline
      />
      {initial && (
        <>
          <label>
            {t("行动状态", "Action status")}
            <select name="status" aria-label={t("行动状态", "Action status")} defaultValue={initial.status}>
              <option value="planned">{t("计划中", "Planned")}</option>
              <option value="active">{t("进行中", "In progress")}</option>
              <option value="completed">{t("已完成行动", "Action completed")}</option>
              <option value="cancelled">{t("已取消", "Cancelled")}</option>
            </select>
          </label>
          <Field
            name="result"
            label={t("实际观察到什么", "What happened")}
            value={initial.result}
            multiline
            optional
          />
          <label>
            {t("这些结果对假设意味着什么", "What the results mean for the hypothesis")}
            <select
              name="conclusion"
              aria-label={t("假设结论", "Hypothesis conclusion")}
              defaultValue={initial.conclusion}
            >
              <option value="unassessed">{t("暂不判断", "Not assessed")}</option>
              <option value="supports">{t("支持假设", "Supports hypothesis")}</option>
              <option value="refutes">{t("反驳假设", "Refutes hypothesis")}</option>
              <option value="inconclusive">{t("证据还不足", "Inconclusive")}</option>
            </select>
          </label>
          <Field
            name="source"
            label={t("结果来源（可选）", "Result source (optional)")}
            value={initial.source}
            optional
          />
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
  const t = useT();
  return (
    <FormShell
      title={initial ? t("修正资料", "Correct source") : t("补充依据或认识", "Add evidence or reflection")}
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
      {initial && (
        <p className={base.muted}>
          {t("这条资料针对的问题：", "Question for this source: ")}
          {initial.question}
        </p>
      )}
      <label>
        {t("内容类型", "Content type")}
        <select
          name="kind"
          aria-label={t("内容类型", "Content type")}
          defaultValue={initial?.kind ?? "evidence"}
        >
          <option value="evidence">{t("依据与资料", "Evidence and sources")}</option>
          <option value="reflection">{t("新的认识", "Reflection")}</option>
          <option value="decision">{t("我的决定", "My decision")}</option>
        </select>
      </label>
      <Field name="text" label={t("内容", "Content")} value={initial?.text} multiline />
      <label>
        {t("与当前假设的关系", "How it relates to the hypothesis")}
        <select
          name="stance"
          aria-label={t("与假设的关系", "Relation to hypothesis")}
          defaultValue={initial?.stance ?? "unclear"}
        >
          <option value="unclear">{t("还不能判断", "Not assessed yet")}</option>
          <option value="supports">{t("提供支持", "Supports it")}</option>
          <option value="refutes">{t("提供反面证据", "Contrary evidence")}</option>
        </select>
      </label>
      <Field
        name="source"
        label={t("来源链接或资料位置（可选）", "Source link or file location (optional)")}
        value={initial?.source}
        optional
      />
      {!initial && experiments.length > 0 && (
        <label>
          {t("关联尝试（可选）", "Linked experiment (optional)")}
          <select name="experiment" aria-label={t("关联尝试", "Linked experiment")} defaultValue="">
            <option value="">{t("不关联", "None")}</option>
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
