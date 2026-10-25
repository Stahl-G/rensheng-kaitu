import { directionText } from "@kaitu/core/direction-copy";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { HealthData, MeGoal } from "../types.js";
import css from "./HealthPage.module.css";
import { useLocale, useT } from "./i18n.js";

export interface HealthPageProps {
  loadHealth: () => Promise<HealthData>;
  loadHealthPhoto: (id: string) => Promise<string>;
  onPrompt: (text: string) => void;
  subscribe?: (refresh: () => void) => () => void;
  onReviewMeasurement?: (id: string) => void;
  adoptTask: (id: string) => Promise<unknown>;
  cancelTask: (id: string) => Promise<unknown>;
  selectedTab?: string;
  onSelectTab?: (tab: string) => void;
}
const tabs = ["训练", "饮食", "睡眠与活动", "身体数据", "体态照片"];
const number = (value: number) => new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }).format(value);
const sessions = (n: number) => `${n} ${n === 1 ? "session" : "sessions"}`;
const reps = (n: number) => `${n} ${n === 1 ? "rep" : "reps"}`;
const makeAmount =
  (t: ReturnType<typeof useT>) =>
  (value: number | null, unit: string, estimated = false) =>
    value === null
      ? t("暂无记录", "No records yet")
      : `${estimated ? t("约 ", "about ") : ""}${number(estimated && /^(?:克|g)(?:\s|$)/.test(unit) ? Math.round(value) : value)} ${unit}`;
function Empty({ children }: { children: ReactNode }) {
  const t = useT();
  return (
    <p className={css.empty}>
      {t("暂无记录。", "No records yet. ")}
      {children}
    </p>
  );
}
function Section({ title, children, note }: { title: string; children: ReactNode; note?: string }) {
  return (
    <section className={css.card} aria-label={title}>
      <div className={css.heading}>
        <h2>{title}</h2>
        {note && <span>{note}</span>}
      </div>
      {children}
    </section>
  );
}
type Point = { date: string; value: number | null; estimated: boolean };
function Trend({
  title,
  points,
  unit,
  target,
  line = false,
}: {
  title: string;
  points: Point[];
  unit: string;
  target?: number[] | null;
  line?: boolean;
}) {
  const t = useT();
  const amount = makeAmount(t);
  const values = points.flatMap((p) => (p.value === null ? [] : [p.value]));
  const max = Math.max(...values, ...(target ?? []), 1);
  const min =
    line && values.length ? Math.min(...values) - Math.max((max - Math.min(...values)) * 0.2, 1) : 0;
  const y = (value: number) => 112 - ((value - min) / (max - min || 1)) * 96;
  const x = (i: number) => 18 + (i * 564) / Math.max(points.length - 1, 1);
  const summary = points
    .map((p) => `${p.date}${t("：", ": ")}${amount(p.value, unit, p.estimated)}`)
    .join(t("，", ", "));
  return (
    <Section
      title={title}
      note={
        target?.length
          ? t(`每日目标 ${target.join("–")} ${unit}`, `Daily goal ${target.join("–")} ${unit}`)
          : unit
      }
    >
      {!values.length ? (
        <Empty>{t("导入或记下数据后，就能看到趋势。", "Import or log data to see the trend.")}</Empty>
      ) : (
        <>
          <div className={css.scale}>
            <span>
              {number(max)} {unit}
            </span>
            <span>
              {number(min)} {unit}
            </span>
          </div>
          {line ? (
            <svg className={css.lineChart} viewBox="0 0 600 132" role="img" aria-label={summary}>
              {points.map((p, i) =>
                p.value === null ? null : (
                  <g key={`${p.date}-${i}`}>
                    <title>
                      {p.date}
                      {t("：", ": ")}
                      {amount(p.value, unit, p.estimated)}
                    </title>
                    {i > 0 && points[i - 1]?.value !== null && (
                      <line x1={x(i - 1)} y1={y(points[i - 1]?.value ?? 0)} x2={x(i)} y2={y(p.value)} />
                    )}
                    <circle cx={x(i)} cy={y(p.value)} r="4" />
                  </g>
                ),
              )}
            </svg>
          ) : (
            <div className={css.plot} role="img" aria-label={summary}>
              {target?.[0] !== undefined && (
                <span className={css.target} style={{ bottom: `${(target[0] / max) * 100}%` }} />
              )}
              {points.map((p) => (
                <div
                  className={css.barSlot}
                  key={p.date}
                  title={`${p.date}${t("：", ": ")}${amount(p.value, unit, p.estimated)}`}
                >
                  {p.value === null ? (
                    <span className={css.missing}>{t("没记", "Not logged")}</span>
                  ) : (
                    <span
                      className={css.bar}
                      data-estimated={p.estimated}
                      style={{ height: `${(p.value / max) * 100}%`, minHeight: p.value > 0 ? 2 : 0 }}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
          <div className={css.dates}>
            {points.map((p, i) => (
              <span key={`${p.date}-${i}`}>
                {points.length > 8 && i % 2 !== 0 && i !== points.length - 1
                  ? ""
                  : p.date.slice(5).replace("-", "/")}
              </span>
            ))}
          </div>
          <details className={css.details}>
            <summary>{t("查看每日数值", "View daily values")}</summary>
            <dl>
              {points.map((p, i) => (
                <div key={`${p.date}-${i}`}>
                  <dt>{p.date}</dt>
                  <dd>{amount(p.value, unit, p.estimated)}</dd>
                </div>
              ))}
            </dl>
          </details>
        </>
      )}
    </Section>
  );
}
function Photo({
  photo,
  load,
}: { photo: HealthData["photos"][number]; load: HealthPageProps["loadHealthPhoto"] }) {
  const t = useT();
  const poses = {
    front: t("正面", "Front"),
    side: t("侧面", "Side"),
    back: t("背面", "Back"),
    other: t("其他", "Other"),
  };
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 重试会重新读取同一张照片。
  useEffect(() => {
    let active = true;
    setUrl(null);
    setError(false);
    void load(photo.id).then(
      (value) => {
        if (active) setUrl(value);
      },
      () => {
        if (active) setError(true);
      },
    );
    return () => {
      active = false;
    };
  }, [photo.id, load, retry]);
  return (
    <figure className={css.photo}>
      {url ? (
        <img
          src={url}
          alt={t(
            `${photo.date} ${poses[photo.pose]}体态照片`,
            `${photo.date} ${poses[photo.pose]} progress photo`,
          )}
        />
      ) : error ? (
        <button type="button" onClick={() => setRetry((n) => n + 1)}>
          {t("照片读取失败，点此重试", "Couldn't load photo. Click to retry")}
        </button>
      ) : (
        <p>{t("正在读取照片…", "Loading photo…")}</p>
      )}
      <figcaption>
        {poses[photo.pose]}
        {photo.notes && ` · ${photo.notes}`}
      </figcaption>
    </figure>
  );
}
function Photos({
  photos,
  load,
  onPrompt,
}: {
  photos: HealthData["photos"];
  load: HealthPageProps["loadHealthPhoto"];
  onPrompt: HealthPageProps["onPrompt"];
}) {
  const t = useT();
  const poses = {
    front: t("正面", "Front"),
    side: t("侧面", "Side"),
    back: t("背面", "Back"),
    other: t("其他", "Other"),
  };
  const dates = [...new Set(photos.map((p) => p.date))];
  const [left, setLeft] = useState(dates.at(-1) ?? "");
  const [right, setRight] = useState(dates.length > 1 ? (dates[0] ?? "") : "");
  return (
    <Section
      title={t("体态照片", "Progress photos")}
      note={t("只读取本机照片", "Only photos stored on this computer")}
    >
      <button
        type="button"
        className={css.link}
        onClick={() => onPrompt(t("帮我记录今天的体态照片", "Help me log today’s progress photos"))}
      >
        {t("记一次体态照片", "Log a progress photo")}
      </button>
      {!dates.length ? (
        <Empty>
          {t("把体态照片交给开图，之后可以按日期对比。", "Add progress photos to compare them by date.")}
        </Empty>
      ) : (
        <>
          {dates.length < 2 && (
            <p className={css.empty}>
              {t("再记录一个日期，就可以并排对比。", "Add another date to compare side by side.")}
            </p>
          )}
          <div className={css.comparison}>
            {[
              { value: left, set: setLeft, other: right, label: t("左侧日期", "Left date") },
              { value: right, set: setRight, other: left, label: t("右侧日期", "Right date") },
            ].map((side) => (
              <div key={side.label}>
                <label className={css.photoDate}>
                  {side.label}
                  <select value={side.value} onChange={(e) => side.set(e.target.value)}>
                    <option value="">{t("选择日期", "Choose a date")}</option>
                    {dates
                      .filter((d) => d !== side.other)
                      .map((d) => (
                        <option key={d}>{d}</option>
                      ))}
                  </select>
                </label>
                {photos
                  .filter((p) => p.date === side.value)
                  .map((p) => (
                    <Photo key={p.id} photo={p} load={load} />
                  ))}
              </div>
            ))}
          </div>
          <div className={css.photoList}>
            {dates.map((date) => (
              <div className={css.row} key={date}>
                <time>{date}</time>
                <span>
                  {photos
                    .filter((p) => p.date === date)
                    .map((p) => poses[p.pose])
                    .join(t("、", ", "))}
                </span>
                <button
                  type="button"
                  className={css.link}
                  disabled={date === right}
                  onClick={() => setLeft(date)}
                >
                  {t("放左侧", "Show on left")}
                </button>
                <button
                  type="button"
                  className={css.link}
                  disabled={date === left}
                  onClick={() => setRight(date)}
                >
                  {t("放右侧", "Show on right")}
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </Section>
  );
}
export function HealthPage({
  loadHealth,
  loadHealthPhoto,
  onPrompt,
  subscribe,
  onReviewMeasurement,
  adoptTask,
  cancelTask,
  selectedTab,
  onSelectTab,
}: HealthPageProps) {
  const t = useT();
  const locale = useLocale();
  const amount = makeAmount(t);
  const labels: Record<string, string> = {
    早: "Breakfast",
    午: "Lunch",
    晚: "Dinner",
    加餐: "Snack",
    腿部: "Legs",
    胸部: "Chest",
    背部: "Back",
    肩部: "Shoulders",
    手臂: "Arms",
    核心: "Core",
    你: "you",
    "本机 Agent": "Local agent",
    "Apple 健康导入": "Apple Health import",
    导入记录: "Imported",
  };
  const label = (value: string) =>
    t(value, labels[value] ?? value.replace(/^云端 Agent · /, "Cloud agent · "));
  const metricNames: Record<string, string> = {
    resting_hr: t("静息心率", "Resting heart rate"),
    hrv_sdnn: t("心率变异性", "Heart rate variability"),
    weight: t("体重", "Weight"),
    body_fat: t("体脂", "Body fat"),
    height: t("身高", "Height"),
    bp: t("血压", "Blood pressure"),
    glucose: t("血糖", "Blood glucose"),
    waist: t("腰围", "Waist"),
    bmi: t("身体质量指数", "BMI"),
    muscle_mass: t("肌肉量", "Muscle mass"),
  };
  const [data, setData] = useState<HealthData | null>(null);
  const [localTab, setLocalTab] = useState("训练");
  const tab = selectedTab ?? localTab;
  const setTab = onSelectTab ?? setLocalTab;
  const [showLog, setShowLog] = useState(false);
  const [showAllRecent, setShowAllRecent] = useState(false);
  const [reviewTarget, setReviewTarget] = useState<{ id: string }>();
  const measurement = useRef<HTMLParagraphElement>(null);
  const [acting, setActing] = useState<string>();
  const [receipt, setReceipt] = useState("");
  useEffect(() => {
    if (tab !== "身体数据" || !reviewTarget) return;
    measurement.current?.focus({ preventScroll: true });
    measurement.current?.scrollIntoView({ block: "center" });
  }, [reviewTarget, tab]);

  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const seq = ++sequence.current;
    setError(null);
    try {
      const result = await loadHealth();
      if (seq === sequence.current) setData(result);
      return result;
    } catch (err) {
      if (seq === sequence.current) setError(err instanceof Error ? err.message : String(err));
    }
  }, [loadHealth]);
  useEffect(() => {
    void refresh();
    const off = subscribe?.(() => void refresh());
    return () => {
      sequence.current++;
      off?.();
    };
  }, [refresh, subscribe]);
  const decideTask = async (id: string, adopt: boolean) => {
    if (acting) return;
    setActing(id);
    setReceipt("");
    try {
      await (adopt ? adoptTask(id) : cancelTask(id));
      const result = await refresh();
      if (!result) return;
      setReceipt(
        adopt
          ? t("已采纳，已加入待办。", "Adopted and added to tasks.")
          : t("已拒绝这条建议。", "Suggestion declined."),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActing(undefined);
    }
  };
  const ask = (text: string) => {
    try {
      onPrompt(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  const stamp = (ts: string) =>
    new Intl.DateTimeFormat(locale, {
      timeZone: data?.timeZone,
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(ts));
  const training = data?.training;
  const pattern = training?.rule?.pattern;
  const target =
    pattern === "alternate-days" ? [3, 4] : pattern === "daily" ? [7] : pattern === "weekdays" ? [5] : null;
  const ruleText =
    pattern === "alternate-days"
      ? t("隔天一次 · 每周约 3–4 次", "Every other day · about 3–4 times a week")
      : pattern === "daily"
        ? t("每天一次", "Daily")
        : pattern === "weekdays"
          ? t("工作日训练", "Weekdays")
          : pattern === "custom"
            ? t("自定安排", "Custom schedule")
            : t("暂无训练目标", "No training goal yet");
  const maxReps = Math.max(...(training?.heatmap.map((d) => d.repetitions ?? 0) ?? []), 1);
  const maxMinutes = Math.max(...(training?.heatmap.map((d) => d.minutes ?? 0) ?? []), 1);
  const monday = data
    ? new Date(
        Date.parse(`${data.today}T12:00:00Z`) -
          ((new Date(`${data.today}T12:00:00Z`).getUTCDay() + 6) % 7) * 86400000,
      )
        .toISOString()
        .slice(0, 10)
    : "";
  const average = (points: Point[]) => {
    const logged = points.filter((point) => point.date >= monday && point.value !== null);
    return {
      value: logged.length
        ? logged.reduce((total, point) => total + (point.value ?? 0), 0) / logged.length
        : null,
      count: logged.length,
      estimated: logged.some((point) => point.estimated),
    };
  };
  const protein = average(data?.nutrition.protein ?? []);
  const sleep = average(data?.sleep ?? []);
  const steps = average(data?.steps ?? []);
  const weights = (
    data?.metrics.find((metric) => metric.kind === "weight" && metric.unit === "kg")?.points ?? []
  )
    .slice()
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  const weight = weights.at(-1);
  const weightChanges = weights.flatMap((point, index) => {
    const previous = weights[index - 1];
    if (
      !previous ||
      typeof point.value !== "number" ||
      typeof previous.value !== "number" ||
      Date.parse(point.date) - Date.parse(previous.date) > 86400000
    )
      return [];
    const change = point.value - previous.value;
    return Math.abs(change) > 3 ? [{ point, change }] : [];
  });
  const coverage = (count: number) => t(`本周 ${count} 天有记录`, `${count} days logged this week`);
  const summary = [
    [t("本周训练", "Workouts this week"), amount(training?.week ?? null, t("次", "sessions")), ruleText],
    [
      t("蛋白质", "Protein"),
      amount(protein.value, t("克 / 天", "g / day"), protein.estimated),
      `${coverage(protein.count)}${data?.nutrition.target?.length ? t(` · 目标 ${data.nutrition.target.join("–")} 克 / 天`, ` · Target ${data.nutrition.target.join("–")} g / day`) : ""}`,
    ],
    [
      t("睡眠", "Sleep"),
      amount(sleep.value, t("小时 / 晚", "hours / night"), sleep.estimated),
      coverage(sleep.count),
    ],
    [
      t("步数", "Steps"),
      amount(steps.value, t("步 / 天", "steps / day"), steps.estimated),
      coverage(steps.count),
    ],
    [
      t("体重", "Weight"),
      amount(typeof weight?.value === "number" ? weight.value : null, "kg", weight?.estimated),
      weight?.date ?? t("记一次测量，开始追踪变化", "Log a measurement to start tracking changes"),
    ],
  ];
  const recent = [
    ...(training?.recent ?? []).map((session) => ({
      id: `workout-${session.id}`,
      ts: session.ts,
      kind: t("训练", "Workout"),
      title: session.exercises.map((exercise) => exercise.name).join(t("、", ", ")),
      value: amount(session.duration, t("分钟", "min")),
    })),
    ...(data?.nutrition.meals ?? []).map((meal) => ({
      id: `meal-${meal.id}`,
      ts: meal.ts,
      kind: t("饮食", "Meal"),
      title: `${label(meal.meal)} · ${meal.items}`,
      value: amount(meal.kcal, "kcal", meal.estimated),
    })),
    ...(data?.metrics ?? []).flatMap((metric) =>
      metric.points.map((point) => ({
        id: `metric-${point.id}`,
        ts: point.ts,
        kind: t("测量", "Measurement"),
        title: metricNames[metric.kind] ?? metric.kind,
        value: `${point.estimated ? t("约 ", "about ") : ""}${point.value} ${metric.unit}`,
      })),
    ),
  ].sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
  return (
    <div className={css.page} aria-busy={!data && !error}>
      <header className={css.header}>
        <div>
          <h1>
            <span aria-hidden="true" />
            {t("健康", "Health")}
          </h1>
          <p>{t("这周概况与最近的记录", "This week and your recent records")}</p>
        </div>
        <div className={css.actions}>
          <button
            type="button"
            className={css.button}
            onClick={() => ask(t("帮我导入 Apple 健康数据", "Help me import Apple Health data"))}
          >
            {t("导入 Apple 健康", "Import Apple Health")}
          </button>
          <button
            type="button"
            className={`${css.button} ${css.primary}`}
            aria-expanded={showLog}
            onClick={() => setShowLog(!showLog)}
          >
            {t("记一笔", "Log something")}
          </button>
        </div>
      </header>
      {showLog && (
        <div
          className={css.actions}
          aria-label={t("记什么", "What to log")}
          onKeyDown={(event) => {
            if (event.key === "Escape") setShowLog(false);
          }}
        >
          {[
            ["训练", "Workout", "记录今天的训练：", "Log today’s workout:"],
            ["饮食", "Meal", "记录今天的饮食：", "Log today’s meals:"],
            ["睡眠", "Sleep", "记录昨晚的睡眠：", "Log last night’s sleep:"],
            ["身体数据", "Measurement", "记录今天的身体数据：", "Log today’s measurements:"],
            ["体态照片", "Progress photo", "帮我记录今天的体态照片", "Help me log today’s progress photos"],
          ].map(([zh, en, prompt, english]) => (
            <button
              key={zh}
              type="button"
              className={css.button}
              onClick={() => {
                setShowLog(false);
                ask(t(prompt ?? "", english ?? ""));
              }}
            >
              {t(zh ?? "", en ?? "")}
            </button>
          ))}
        </div>
      )}
      {error && (
        <p className={css.notice} role="alert">
          {error}{" "}
          <button type="button" className={css.link} onClick={() => void refresh()}>
            {t("重新读取", "Reload")}
          </button>
        </p>
      )}
      {!data || !training ? (
        <p className={css.empty}>
          {error
            ? t("健康数据读取失败，请重试。", "Couldn't load health data. Try again.")
            : t("正在读取健康数据…", "Loading health data…")}
        </p>
      ) : (
        <>
          <dl className={css.overview} aria-label={t("健康概况", "Health summary")}>
            {summary.map(([title, value, note], index) => (
              <div className={css.card} key={title}>
                <dt>{title}</dt>
                <dd>
                  <strong>{value}</strong>
                  {index === 0 && target?.[0] && training.week !== null && (
                    <progress
                      aria-label={t("本周训练目标", "Weekly workout goal")}
                      value={training.week}
                      max={target[0]}
                    />
                  )}
                  {index === 1 && data.nutrition.target?.[0] && protein.value !== null && (
                    <progress
                      aria-label={t("每日蛋白质目标", "Daily protein goal")}
                      value={protein.value}
                      max={data.nutrition.target[0]}
                    />
                  )}
                  <small>{note}</small>
                </dd>
              </div>
            ))}
          </dl>
          {weightChanges.map(({ point, change }) => (
            <p key={point.id} className={css.warning}>
              {t(
                `${point.date} 体重一天内变化 ${number(change)} kg，请核对记录。`,
                `${point.date}: weight changed by ${number(change)} kg within one day. Check this record.`,
              )}{" "}
              <button
                type="button"
                className={css.link}
                onClick={() => {
                  setTab("身体数据");
                  setReviewTarget({ id: point.id });
                  onReviewMeasurement?.(point.id);
                }}
              >
                {t("去核对", "Review")}
              </button>
            </p>
          ))}
          <div className={css.footer}>
            <section aria-label={t("健康目标", "Health goals")}>
              <div className={css.heading}>
                <h2>{t("健康目标", "Health goals")}</h2>
                <button
                  type="button"
                  className={css.link}
                  onClick={() => ask(t("帮我设一个健康目标", "Help me set a health goal"))}
                >
                  {t("新建目标", "New goal")}
                </button>
              </div>
              {!data.goals.length ? (
                <Empty>
                  {t("和开图聊聊你想达到的健康目标。", "Tell Kaitu about a health goal you want to reach.")}
                </Empty>
              ) : (
                data.goals.map((goal: MeGoal) => (
                  <article className={`${css.card} ${css.goal}`} key={goal.id}>
                    <h3>
                      {t("目标", "Goal")} · {goal.title}
                    </h3>
                    {(goal.metric || goal.target) && (
                      <p>{[goal.metric, goal.target].filter(Boolean).join(" · ")}</p>
                    )}
                    {goal.approach && (
                      <p>
                        <span>{t("现在的做法", "Current approach")}</span>
                        {goal.approach}
                      </p>
                    )}
                    {goal.actual && (
                      <p>
                        <span>{t("实际发生", "What happened")}</span>
                        {goal.actual}
                      </p>
                    )}
                    {goal.due && (
                      <p>
                        <span>{t("下次回看", "Next review")}</span>
                        {goal.due}
                      </p>
                    )}
                  </article>
                ))
              )}
            </section>
            <Section title={t("健康的下一步", "Health next steps")}>
              {receipt && <output>{receipt}</output>}
              {!data.next.length ? (
                <Empty>
                  {t(
                    "让开图根据最近的记录帮你安排下一步。",
                    "Ask Kaitu for a next step based on your recent records.",
                  )}
                </Empty>
              ) : (
                data.next.map((item) => (
                  <div className={css.next} key={item.id}>
                    <span aria-hidden="true" />
                    <span>
                      {directionText(item.title, 120)}
                      {item.status === "proposed" && <small>{t(" · AI 建议", " · AI suggestion")}</small>}
                      {item.due && <small> · {item.due}</small>}
                    </span>
                    {item.status === "proposed" && item.taskId && (
                      <div className={css.actions}>
                        <button
                          type="button"
                          className={css.button}
                          disabled={!!acting}
                          onClick={() => void decideTask(item.taskId as string, true)}
                        >
                          {acting === item.taskId ? t("正在保存…", "Saving…") : t("采纳", "Adopt")}
                        </button>
                        <button
                          type="button"
                          className={css.link}
                          disabled={!!acting}
                          onClick={() => void decideTask(item.taskId as string, false)}
                        >
                          {t("不用了", "Not needed")}
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </Section>
          </div>
          <Section
            title={t("最近记录", "Recent records")}
            note={t("近 30 天 · 训练、饮食、测量", "Last 30 days · workouts, meals and measurements")}
          >
            {!recent.length ? (
              <Empty>
                {t(
                  "记下训练、饮食或测量结果，在这里回看。",
                  "Log a workout, meal or measurement to see it here.",
                )}
              </Empty>
            ) : (
              (showAllRecent ? recent : recent.slice(0, 6)).map((item) => (
                <article className={css.row} key={item.id}>
                  <time dateTime={item.ts}>{stamp(item.ts)}</time>
                  <span className={css.tag}>{item.kind}</span>
                  <span className={css.grow}>{item.title}</span>
                  <span>{item.value}</span>
                </article>
              ))
            )}
            {recent.length > 6 && (
              <button
                type="button"
                className={css.link}
                aria-expanded={showAllRecent}
                onClick={() => setShowAllRecent(!showAllRecent)}
              >
                {showAllRecent
                  ? t("收起", "Show less")
                  : t(`全部 ${recent.length} 条`, `All ${recent.length} records`)}
              </button>
            )}
          </Section>
          <h2>{t("细看", "Details")}</h2>
          <div className={css.tabs} role="tablist" aria-label={t("健康分类", "Health categories")}>
            {tabs.map((name) => (
              <button
                type="button"
                role="tab"
                id={`health-tab-${name}`}
                aria-controls="health-panel"
                key={name}
                aria-selected={tab === name}
                onClick={() => setTab(name)}
                onKeyDown={(e) => {
                  const index = tabs.indexOf(tab);
                  const next =
                    e.key === "ArrowRight"
                      ? tabs[(index + 1) % tabs.length]
                      : e.key === "ArrowLeft"
                        ? tabs[(index + tabs.length - 1) % tabs.length]
                        : e.key === "Home"
                          ? tabs[0]
                          : e.key === "End"
                            ? tabs.at(-1)
                            : null;
                  if (next) {
                    e.preventDefault();
                    setTab(next);
                    document.getElementById(`health-tab-${next}`)?.focus();
                  }
                }}
                tabIndex={tab === name ? 0 : -1}
              >
                {t(
                  name,
                  ["Training", "Meals", "Sleep and activity", "Body measurements", "Progress photos"][
                    tabs.indexOf(name)
                  ] ?? name,
                )}
              </button>
            ))}
          </div>
          <div id="health-panel" role="tabpanel" aria-labelledby={`health-tab-${tab}`} className={css.panel}>
            {tab === "训练" && (
              <>
                <dl className={css.stats}>
                  {[
                    [
                      t("本周训练", "Workouts this week"),
                      amount(training.week, t("次", training.week === 1 ? "session" : "sessions")),
                      `${ruleText}${target && training.week !== null ? ` · ${training.week >= (target[0] ?? 0) ? t("已达到本周目标", "Weekly goal reached") : t(`距目标还差 ${(target[0] ?? 0) - training.week} 次`, `${sessions((target[0] ?? 0) - training.week)} to goal`)}` : ""}`,
                    ],
                    [
                      t("本月训练", "Workouts this month"),
                      amount(training.month, t("次", training.month === 1 ? "session" : "sessions")),
                      training.month !== null && training.previousMonth !== null
                        ? t(
                            `上月 ${training.previousMonth} 次 · ${training.month === training.previousMonth ? "与上月持平" : `比上月${training.month > training.previousMonth ? "多" : "少"} ${Math.abs(training.month - training.previousMonth)} 次`}`,
                            `Last month: ${training.previousMonth} · ${training.month === training.previousMonth ? "Same as last month" : `${Math.abs(training.month - training.previousMonth)} ${training.month > training.previousMonth ? "more" : "fewer"} ${Math.abs(training.month - training.previousMonth) === 1 ? "session" : "sessions"}`}`,
                          )
                        : t("上月或本月暂无记录", "No records for last month or this month"),
                    ],
                    [
                      t("练得最多", "Most trained"),
                      training.topPart ? label(training.topPart.name) : t("暂无记录", "No records yet"),
                      training.topPart
                        ? t(
                            `本月 ${training.topPart.count} 次 · 按动作归类`,
                            `${sessions(training.topPart.count)} this month · grouped by exercise`,
                          )
                        : t("记录动作后可汇总部位", "Log exercises to see the muscle groups"),
                    ],
                    [
                      training.lift
                        ? t(`最大${training.lift.name}`, `Heaviest ${training.lift.name}`)
                        : t("最大重量变化", "Change in heaviest lift"),
                      amount(training.lift?.max ?? null, "kg"),
                      training.lift?.change !== null && training.lift?.change !== undefined
                        ? t(
                            `比本月首个记录日 ${training.lift.change >= 0 ? "+" : ""}${number(training.lift.change)} kg`,
                            `${training.lift.change >= 0 ? "+" : ""}${number(training.lift.change)} kg since the first record this month`,
                          )
                        : t(
                            "需要不同日期的力量记录",
                            "Log strength sets on two different days to see the change",
                          ),
                    ],
                  ].map(([label, value, hint]) => (
                    <div className={css.stat} key={label}>
                      <dt>{label}</dt>
                      <dd>
                        <strong>{value}</strong>
                        <small>{hint}</small>
                      </dd>
                    </div>
                  ))}
                </dl>
                <div className={css.trainingDetails}>
                  <Section
                    title={t("近 5 周", "Last 5 weeks")}
                    note={t("颜色越深，那天练得越多", "Darker squares mean more training")}
                  >
                    <div className={css.heatmap}>
                      {(locale === "en"
                        ? ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]
                        : [..."一二三四五六日"]
                      ).map((d) => (
                        <span className={css.weekday} key={d}>
                          {d}
                        </span>
                      ))}
                      {training.heatmap.map((d) => {
                        const volume = d.repetitions
                          ? d.repetitions / maxReps
                          : (d.minutes ?? 0) / maxMinutes;
                        const text = `${d.date}${t("：", ": ")}${d.future ? t("尚未到来", "Upcoming") : d.sessions === null ? t("暂无记录", "No records yet") : t(`${d.sessions} 次训练${d.repetitions ? ` · ${d.repetitions} 次动作` : ""}${d.minutes !== null ? ` · ${number(d.minutes)} 分钟` : ""}`, `${sessions(d.sessions)}${d.repetitions ? ` · ${reps(d.repetitions)}` : ""}${d.minutes !== null ? ` · ${number(d.minutes)} min` : ""}`)}`;
                        return (
                          <span
                            className={css.heat}
                            key={d.date}
                            title={text}
                            aria-label={text}
                            data-future={d.future}
                            data-level={d.sessions === null ? 0 : volume > 0.66 ? 3 : volume > 0.33 ? 2 : 1}
                          />
                        );
                      })}
                    </div>
                    {!training.heatmap.some((d) => d.sessions !== null) && (
                      <Empty>{t("记一次训练，就会在这里留下足迹。", "Log a workout to see it here.")}</Empty>
                    )}
                  </Section>
                  <Section title={t("最近的训练", "Recent workouts")} note={t("近 30 天", "Last 30 days")}>
                    {!training.recent.length ? (
                      <Empty>
                        {t(
                          "点击「记一次训练」，记下动作、组数和重量。",
                          "Choose “Log a workout” to record exercises, sets and weights.",
                        )}
                      </Empty>
                    ) : (
                      training.recent.map((session) => (
                        <article className={css.workout} key={session.id}>
                          <time dateTime={session.ts}>{stamp(session.ts)}</time>
                          {session.parts.length > 0 && (
                            <span className={css.tag}>{session.parts.map(label).join(t("、", ", "))}</span>
                          )}
                          <div className={css.exercises}>
                            {session.exercises.map((exercise) => (
                              <div key={exercise.id}>
                                <span>
                                  {exercise.estimated && t("约 ", "about ")}
                                  {exercise.name}
                                  {exercise.cardio
                                    ? `${exercise.distance !== null ? ` ${number(exercise.distance)} km` : ""}${exercise.duration !== null ? t(` · ${number(exercise.duration)} 分钟`, ` · ${number(exercise.duration)} min`) : ""}`
                                    : ` ${exercise.sets ?? "—"}×${exercise.reps ?? "—"} · ${amount(exercise.weight, "kg")}`}
                                </span>
                                <small>
                                  {t("记录者：", "Recorded by: ")}
                                  {label(exercise.recorder)}
                                </small>
                              </div>
                            ))}
                          </div>
                          <span className={css.duration}>
                            {t("时长：", "Duration: ")}
                            {amount(session.duration, t("分钟", "min"))}
                          </span>
                        </article>
                      ))
                    )}
                  </Section>
                </div>
              </>
            )}
            {tab === "饮食" && (
              <>
                <div className={css.trends}>
                  <Trend
                    title={t("近 7 天热量", "Calories over 7 days")}
                    points={data.nutrition.calories}
                    unit="kcal"
                  />
                  <Trend
                    title={t("近 7 天蛋白质", "Protein over 7 days")}
                    points={data.nutrition.protein}
                    unit={t("克", "g")}
                    target={data.nutrition.target}
                  />
                </div>
                {!data.nutrition.target?.length && (
                  <p className={css.empty}>
                    {t(
                      "暂无蛋白质目标，可在对话中设置每天的目标。",
                      "No protein goal yet. Set a daily goal in Ask.",
                    )}
                  </p>
                )}
                <Section title={t("最近餐食", "Recent meals")} note={t("近 30 天", "Last 30 days")}>
                  <button
                    type="button"
                    className={css.link}
                    onClick={() => ask(t("记录今天的饮食：", "Log today’s meals:"))}
                  >
                    {t("记一餐", "Log a meal")}
                  </button>
                  {!data.nutrition.meals.length ? (
                    <Empty>
                      {t(
                        "记下吃了什么，开图会帮你整理营养记录。",
                        "Log what you ate to organize your nutrition records.",
                      )}
                    </Empty>
                  ) : (
                    data.nutrition.meals.map((meal) => (
                      <article className={css.row} key={meal.id}>
                        <time dateTime={meal.ts}>
                          {stamp(meal.ts)} · {label(meal.meal)}
                        </time>
                        <span className={css.grow}>{meal.items}</span>
                        <span>
                          {amount(meal.kcal, "kcal", meal.estimated)} · {t("蛋白质", "Protein")}{" "}
                          {amount(meal.protein, t("克", "g"), meal.estimated)}
                        </span>
                      </article>
                    ))
                  )}
                </Section>
              </>
            )}
            {tab === "睡眠与活动" && (
              <div className={css.trends}>
                <Trend
                  title={t("近 14 天睡眠", "Sleep over 14 days")}
                  points={data.sleep}
                  unit={t("小时", "hours")}
                />
                <Trend
                  title={t("近 14 天步数", "Steps over 14 days")}
                  points={data.steps}
                  unit={t("步", "steps")}
                />
              </div>
            )}
            {tab === "身体数据" && (
              <>
                <button
                  type="button"
                  className={css.link}
                  onClick={() => ask(t("记录今天的身体数据：", "Log today’s measurements:"))}
                >
                  {t("记一次测量", "Log a measurement")}
                </button>
                {!data.metrics.length ? (
                  <Empty>
                    {t(
                      "记下体重、体脂等测量结果，每项数据会单独展示趋势。",
                      "Log weight, body fat or other measurements to see each trend.",
                    )}
                  </Empty>
                ) : (
                  <div className={css.trends}>
                    {data.metrics.map((metric) => (
                      <div key={metric.key}>
                        {metric.points.some((p) => typeof p.value === "number") ? (
                          <Trend
                            title={t(
                              `${metricNames[metric.kind] ?? metric.kind}趋势`,
                              `${metricNames[metric.kind] ?? metric.kind} trend`,
                            )}
                            unit={metric.unit}
                            line
                            points={metric.points.map((p) => ({
                              ...p,
                              value: typeof p.value === "number" ? p.value : null,
                            }))}
                          />
                        ) : (
                          <div className={css.heading}>
                            <h2>
                              {t(
                                `${metricNames[metric.kind] ?? metric.kind}记录`,
                                `${metricNames[metric.kind] ?? metric.kind} records`,
                              )}
                            </h2>
                            <span>{metric.unit}</span>
                          </div>
                        )}
                        <div className={css.measurements}>
                          {metric.points.map((p) => (
                            <p
                              key={p.id}
                              id={`health-measurement-${p.id}`}
                              tabIndex={-1}
                              ref={reviewTarget?.id === p.id ? measurement : undefined}
                              data-review={reviewTarget?.id === p.id}
                            >
                              <time dateTime={p.ts}>{stamp(p.ts)}</time>
                              <strong>
                                {p.estimated && t("约 ", "about ")}
                                {typeof p.value === "number" ? number(p.value) : p.value} {metric.unit}
                              </strong>
                            </p>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
            {tab === "体态照片" && <Photos photos={data.photos} load={loadHealthPhoto} onPrompt={ask} />}
          </div>
        </>
      )}
    </div>
  );
}
