import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { HealthData, MeGoal } from "../types.js";
import css from "./HealthPage.module.css";

export interface HealthPageProps {
  loadHealth: () => Promise<HealthData>;
  loadHealthPhoto: (id: string) => Promise<string>;
  onPrompt: (text: string) => void;
}
const tabs = ["训练", "饮食", "睡眠与活动", "身体数据", "体态照片"];
const metricNames: Record<string, string> = {
  weight: "体重",
  body_fat: "体脂",
  height: "身高",
  bp: "血压",
  glucose: "血糖",
  waist: "腰围",
  bmi: "身体质量指数",
  muscle_mass: "肌肉量",
};
const poses = { front: "正面", side: "侧面", back: "背面", other: "其他" };
const number = (value: number) => new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }).format(value);
const amount = (value: number | null, unit: string, estimated = false) =>
  value === null ? "暂无记录" : `${estimated ? "约 " : ""}${number(value)} ${unit}`;
function Empty({ children }: { children: ReactNode }) {
  return <p className={css.empty}>暂无记录。{children}</p>;
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
  const values = points.flatMap((p) => (p.value === null ? [] : [p.value]));
  const max = Math.max(...values, ...(target ?? []), 1);
  const min =
    line && values.length ? Math.min(...values) - Math.max((max - Math.min(...values)) * 0.2, 1) : 0;
  const y = (value: number) => 112 - ((value - min) / (max - min || 1)) * 96;
  const x = (i: number) => 18 + (i * 564) / Math.max(points.length - 1, 1);
  const summary = points.map((p) => `${p.date}：${amount(p.value, unit, p.estimated)}`).join("，");
  return (
    <Section title={title} note={target?.length ? `每日目标 ${target.join("–")} ${unit}` : unit}>
      {!values.length ? (
        <Empty>导入或记下数据后，就能看到趋势。</Empty>
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
                      {p.date}：{amount(p.value, unit, p.estimated)}
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
                  title={`${p.date}：${amount(p.value, unit, p.estimated)}`}
                >
                  {p.value === null ? (
                    <span className={css.missing} />
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
            <summary>查看每日数值</summary>
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
        <img src={url} alt={`${photo.date} ${poses[photo.pose]}体态照片`} />
      ) : error ? (
        <button type="button" onClick={() => setRetry((n) => n + 1)}>
          照片读取失败，点此重试
        </button>
      ) : (
        <p>正在读取照片…</p>
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
  const dates = [...new Set(photos.map((p) => p.date))];
  const [left, setLeft] = useState(dates.at(-1) ?? "");
  const [right, setRight] = useState(dates.length > 1 ? (dates[0] ?? "") : "");
  return (
    <Section title="体态照片" note="只读取本机照片">
      <button type="button" className={css.link} onClick={() => onPrompt("帮我记录今天的体态照片")}>
        记一次体态照片
      </button>
      {!dates.length ? (
        <Empty>把体态照片交给开图，之后可以按日期对比。</Empty>
      ) : (
        <>
          {dates.length < 2 && <p className={css.empty}>再记录一个日期，就可以并排对比。</p>}
          <div className={css.comparison}>
            {[
              { value: left, set: setLeft, other: right, label: "左侧日期" },
              { value: right, set: setRight, other: left, label: "右侧日期" },
            ].map((side) => (
              <div key={side.label}>
                <label className={css.photoDate}>
                  {side.label}
                  <select value={side.value} onChange={(e) => side.set(e.target.value)}>
                    <option value="">选择日期</option>
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
                    .join("、")}
                </span>
                <button
                  type="button"
                  className={css.link}
                  disabled={date === right}
                  onClick={() => setLeft(date)}
                >
                  放左侧
                </button>
                <button
                  type="button"
                  className={css.link}
                  disabled={date === left}
                  onClick={() => setRight(date)}
                >
                  放右侧
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </Section>
  );
}
export function HealthPage({ loadHealth, loadHealthPhoto, onPrompt }: HealthPageProps) {
  const [data, setData] = useState<HealthData | null>(null);
  const [tab, setTab] = useState("训练");
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const seq = ++sequence.current;
    setError(null);
    try {
      const result = await loadHealth();
      if (seq === sequence.current) setData(result);
    } catch (err) {
      if (seq === sequence.current) setError(err instanceof Error ? err.message : String(err));
    }
  }, [loadHealth]);
  useEffect(() => {
    void refresh();
    return () => {
      sequence.current++;
    };
  }, [refresh]);
  const ask = (text: string) => {
    try {
      onPrompt(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  const stamp = (ts: string) =>
    new Intl.DateTimeFormat("zh-CN", {
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
      ? "隔天一次 · 每周约 3–4 次"
      : pattern === "daily"
        ? "每天一次"
        : pattern === "weekdays"
          ? "工作日训练"
          : pattern === "custom"
            ? "自定安排"
            : "暂无训练目标";
  const maxReps = Math.max(...(training?.heatmap.map((d) => d.repetitions ?? 0) ?? []), 1);
  const maxMinutes = Math.max(...(training?.heatmap.map((d) => d.minutes ?? 0) ?? []), 1);
  return (
    <div className={css.page} aria-busy={!data && !error}>
      <header className={css.header}>
        <div>
          <h1>
            <span aria-hidden="true" />
            健康
          </h1>
          <p>近 30 天的记录与趋势</p>
        </div>
        <div className={css.actions}>
          <button type="button" className={css.button} onClick={() => ask("帮我导入 Apple 健康数据")}>
            导入 Apple 健康
          </button>
          <button
            type="button"
            className={`${css.button} ${css.primary}`}
            onClick={() => ask("记录今天的训练：")}
          >
            记一次训练
          </button>
        </div>
      </header>
      {error && (
        <p className={css.notice} role="alert">
          {error}{" "}
          <button type="button" className={css.link} onClick={() => void refresh()}>
            重新读取
          </button>
        </p>
      )}
      <div className={css.tabs} role="tablist" aria-label="健康分类">
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
            {name}
          </button>
        ))}
      </div>
      {!data || !training ? (
        <p className={css.empty}>{error ? "健康数据读取失败，请重试。" : "正在读取健康数据…"}</p>
      ) : (
        <>
          <div id="health-panel" role="tabpanel" aria-labelledby={`health-tab-${tab}`} className={css.panel}>
            {tab === "训练" && (
              <>
                <div className={css.stats}>
                  {[
                    [
                      "本周训练",
                      amount(training.week, "次"),
                      `${ruleText}${target && training.week !== null ? ` · ${training.week >= (target[0] ?? 0) ? "已达到本周目标" : `距目标还差 ${(target[0] ?? 0) - training.week} 次`}` : ""}`,
                    ],
                    [
                      "本月训练",
                      amount(training.month, "次"),
                      training.month !== null && training.previousMonth !== null
                        ? `上月 ${training.previousMonth} 次 · ${training.month === training.previousMonth ? "与上月持平" : `比上月${training.month > training.previousMonth ? "多" : "少"} ${Math.abs(training.month - training.previousMonth)} 次`}`
                        : "上月或本月暂无记录",
                    ],
                    [
                      "练得最多",
                      training.topPart?.name ?? "暂无记录",
                      training.topPart
                        ? `本月 ${training.topPart.count} 次 · 按动作归类`
                        : "记录动作后可汇总部位",
                    ],
                    [
                      training.lift ? `最大${training.lift.name}` : "最大重量变化",
                      amount(training.lift?.max ?? null, "kg"),
                      training.lift?.change !== null && training.lift?.change !== undefined
                        ? `比本月首个记录日 ${training.lift.change >= 0 ? "+" : ""}${number(training.lift.change)} kg`
                        : "需要不同日期的力量记录",
                    ],
                  ].map(([label, value, hint]) => (
                    <article className={css.stat} key={label}>
                      <span>{label}</span>
                      <strong>{value}</strong>
                      <span>{hint}</span>
                    </article>
                  ))}
                </div>
                <Section title="近 5 周" note="颜色越深，那天练得越多">
                  <div className={css.heatmap}>
                    {[..."一二三四五六日"].map((d) => (
                      <span className={css.weekday} key={d}>
                        {d}
                      </span>
                    ))}
                    {training.heatmap.map((d) => {
                      const volume = d.repetitions ? d.repetitions / maxReps : (d.minutes ?? 0) / maxMinutes;
                      const text = `${d.date}：${d.future ? "尚未到来" : d.sessions === null ? "暂无记录" : `${d.sessions} 次训练${d.repetitions ? ` · ${d.repetitions} 次动作` : ""}${d.minutes !== null ? ` · ${number(d.minutes)} 分钟` : ""}`}`;
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
                    <Empty>记一次训练，就会在这里留下足迹。</Empty>
                  )}
                </Section>
                <Section title="最近的训练" note="近 30 天">
                  {!training.recent.length ? (
                    <Empty>点击「记一次训练」，记下动作、组数和重量。</Empty>
                  ) : (
                    training.recent.map((session) => (
                      <article className={css.workout} key={session.id}>
                        <time dateTime={session.ts}>{stamp(session.ts)}</time>
                        {session.parts.length > 0 && (
                          <span className={css.tag}>{session.parts.join("、")}</span>
                        )}
                        <div className={css.exercises}>
                          {session.exercises.map((exercise) => (
                            <div key={exercise.id}>
                              <span>
                                {exercise.estimated && "约 "}
                                {exercise.name}
                                {exercise.cardio
                                  ? `${exercise.distance !== null ? ` ${number(exercise.distance)} km` : ""}${exercise.duration !== null ? ` · ${number(exercise.duration)} 分钟` : ""}`
                                  : ` ${exercise.sets ?? "—"}×${exercise.reps ?? "—"} · ${amount(exercise.weight, "kg")}`}
                              </span>
                              <small>记录者：{exercise.recorder}</small>
                            </div>
                          ))}
                        </div>
                        <span className={css.duration}>时长：{amount(session.duration, "分钟")}</span>
                      </article>
                    ))
                  )}
                </Section>
              </>
            )}
            {tab === "饮食" && (
              <>
                <div className={css.trends}>
                  <Trend title="近 7 天热量" points={data.nutrition.calories} unit="kcal" />
                  <Trend
                    title="近 7 天蛋白质"
                    points={data.nutrition.protein}
                    unit="g"
                    target={data.nutrition.target}
                  />
                </div>
                {!data.nutrition.target?.length && (
                  <p className={css.empty}>暂无蛋白质目标，可在对话中设置每天的目标。</p>
                )}
                <Section title="最近餐食" note="近 30 天">
                  <button type="button" className={css.link} onClick={() => ask("记录今天的饮食：")}>
                    记一餐
                  </button>
                  {!data.nutrition.meals.length ? (
                    <Empty>记下吃了什么，开图会帮你整理营养记录。</Empty>
                  ) : (
                    data.nutrition.meals.map((meal) => (
                      <article className={css.row} key={meal.id}>
                        <time dateTime={meal.ts}>
                          {stamp(meal.ts)} · {meal.meal}
                        </time>
                        <span className={css.grow}>{meal.items}</span>
                        <span>
                          {amount(meal.kcal, "kcal", meal.estimated)} · 蛋白质{" "}
                          {amount(meal.protein, "g", meal.estimated)}
                        </span>
                      </article>
                    ))
                  )}
                </Section>
              </>
            )}
            {tab === "睡眠与活动" && (
              <div className={css.trends}>
                <Trend title="近 14 天睡眠" points={data.sleep} unit="小时" />
                <Trend title="近 14 天步数" points={data.steps} unit="步" />
              </div>
            )}
            {tab === "身体数据" && (
              <>
                <button type="button" className={css.link} onClick={() => ask("记录今天的身体数据：")}>
                  记一次测量
                </button>
                {!data.metrics.length ? (
                  <Empty>记下体重、体脂等测量结果，每项数据会单独展示趋势。</Empty>
                ) : (
                  <div className={css.trends}>
                    {data.metrics.map((metric) => (
                      <div key={metric.key}>
                        {metric.points.some((p) => typeof p.value === "number") ? (
                          <Trend
                            title={`${metricNames[metric.kind] ?? metric.kind}趋势`}
                            unit={metric.unit}
                            line
                            points={metric.points.map((p) => ({
                              ...p,
                              value: typeof p.value === "number" ? p.value : null,
                            }))}
                          />
                        ) : (
                          <div className={css.heading}>
                            <h2>{metricNames[metric.kind] ?? metric.kind}记录</h2>
                            <span>{metric.unit}</span>
                          </div>
                        )}
                        <div className={css.measurements}>
                          {metric.points.map((p) => (
                            <p key={p.id}>
                              <time dateTime={p.ts}>{p.date}</time>
                              <strong>
                                {p.estimated && "约 "}
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
          <footer className={css.footer}>
            <section aria-label="健康目标">
              <div className={css.heading}>
                <h2>健康目标</h2>
                <button type="button" className={css.link} onClick={() => ask("帮我设一个健康目标")}>
                  新建目标
                </button>
              </div>
              {!data.goals.length ? (
                <Empty>和开图聊聊你想达到的健康目标。</Empty>
              ) : (
                data.goals.map((goal: MeGoal) => (
                  <article className={`${css.card} ${css.goal}`} key={goal.id}>
                    <h3>目标 · {goal.title}</h3>
                    {(goal.metric || goal.target) && (
                      <p>{[goal.metric, goal.target].filter(Boolean).join(" · ")}</p>
                    )}
                    {goal.approach && (
                      <p>
                        <span>现在的做法</span>
                        {goal.approach}
                      </p>
                    )}
                    {goal.actual && (
                      <p>
                        <span>实际发生</span>
                        {goal.actual}
                      </p>
                    )}
                    {goal.due && (
                      <p>
                        <span>下次回看</span>
                        {goal.due}
                      </p>
                    )}
                  </article>
                ))
              )}
            </section>
            <Section title="健康的下一步">
              {!data.next.length ? (
                <Empty>让开图根据最近的记录帮你安排下一步。</Empty>
              ) : (
                data.next.map((item) => (
                  <div className={css.next} key={item.id}>
                    <span aria-hidden="true" />
                    <span>
                      {item.title}
                      {item.status === "proposed" && <small> · 建议</small>}
                      {item.due && <small> · {item.due}</small>}
                    </span>
                  </div>
                ))
              )}
            </Section>
          </footer>
        </>
      )}
    </div>
  );
}
