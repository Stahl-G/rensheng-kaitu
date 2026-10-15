import { useState } from "preact/hooks";
import { type StoredRecord, type WorkbenchData, dateOffset, dayOf, number } from "./api";
import { type Act, Chart, Empty, Markdown, Panel } from "./components";
import { Photos } from "./photos";
const tabs = ["训练", "饮食", "睡眠与活动", "身体指标"];
export function Health({
  data,
  act,
  busy,
  refresh,
}: { data: WorkbenchData; act: Act; busy: boolean; refresh: () => Promise<void> }) {
  const [tab, setTab] = useState("训练");
  const [exercise, setExercise] = useState("");
  const records = (type: string) => data.records[type] ?? [];
  const workouts = records("workout").filter((row) => row.modality !== "cardio");
  const cardio = records("workout").filter(
    (row) =>
      row.modality === "cardio" &&
      dayOf(row.ts, data.timeZone) >= dateOffset(data.today, -29) &&
      dayOf(row.ts, data.timeZone) <= data.today,
  );
  const exercises = [...new Set(workouts.map((r) => String(r.exercise)))];
  const selected = exercises.includes(exercise) ? exercise : (exercises[0] ?? "");
  const days = (count: number) =>
    Array.from({ length: count }, (_, i) => dateOffset(data.today, i + 1 - count));
  const valueOn = (rows: StoredRecord[], day: string, field: string, sum = false): number | null => {
    const hits = rows.filter((r) => dayOf(r.ts, data.timeZone) === day && typeof r[field] === "number");
    return hits.length
      ? sum
        ? hits.reduce((total, r) => total + Number(r[field]), 0)
        : Number(hits.at(-1)?.[field])
      : null;
  };
  const meals = records("meal");
  const kcal = valueOn(meals, data.today, "kcal", true);
  const protein = valueOn(meals, data.today, "protein_g", true);
  const todayMeals = meals.filter((r) => dayOf(r.ts, data.timeZone) === data.today);
  // 餐食营养是 Agent 估算；少于两餐或没有晚餐时缺口不可信
  const mealsComplete = todayMeals.length >= 2 && todayMeals.some((r) => r.meal === "晚");
  const approx = (value: number | null) => (value === null ? "—" : `约 ${number(value)}`);
  const nutrition = data.rules.data.nutrition;
  const activity = records("activity");
  const total = valueOn(activity, data.today, "total_kcal");
  const lastSleep = records("sleep").at(-1);
  const body = records("metric");
  const latestWeight = body.filter((r) => r.kind === "weight").at(-1);
  const healthStatus = data.statuses.find((status) => status.file === "health/STATUS.md");
  const sleepDays = days(30);
  return (
    <>
      <header class="page-heading">
        <p class="eyebrow">把变化看得更清楚</p>
        <h1>健康</h1>
      </header>
      <Panel title="健康小结" className="summary">
        <div class="stats">
          <div>
            <span>最近体重</span>
            <strong>
              {number(latestWeight?.value, 1)}
              <small> kg</small>
            </strong>
          </div>
          <div>
            <span>最近睡眠</span>
            <strong>
              {number(lastSleep ? Number(lastSleep.duration_min) / 60 : undefined, 1)}
              <small> 小时</small>
            </strong>
          </div>
          <div>
            <span>今天蛋白质</span>
            <strong>
              {approx(protein)}
              <small> g</small>
            </strong>
          </div>
          <div>
            <span>今天步数</span>
            <strong>{number(valueOn(activity, data.today, "steps"))}</strong>
          </div>
        </div>
        {healthStatus?.body && <Markdown text={healthStatus.body} />}
      </Panel>
      <div class="tabs" role="tablist" aria-label="健康分类">
        {tabs.map((name) => (
          <button
            type="button"
            role="tab"
            aria-selected={tab === name}
            class={tab === name ? "selected" : ""}
            onClick={() => setTab(name)}
            key={name}
          >
            {name}
          </button>
        ))}
      </div>
      {tab === "训练" && (
        <>
          <Panel title="近 30 天有氧">
            {cardio.length ? (
              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      {["日期", "项目", "距离（km）", "时长（分钟）"].map((title) => (
                        <th key={title}>{title}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...cardio].reverse().map((row) => (
                      <tr key={row.id}>
                        <td>{dayOf(row.ts, data.timeZone)}</td>
                        <td>{String(row.exercise)}</td>
                        <td>{number(row.distance_km, 2)}</td>
                        <td>{number(row.duration_min, 1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>对 Agent 说「跑步 5 公里 28 分钟」，开始记录有氧。</Empty>
            )}
          </Panel>
          <div class="toolbar">
            <label>
              动作{" "}
              <select value={selected} onChange={(e) => setExercise(e.currentTarget.value)}>
                <option value="" disabled>
                  选择动作
                </option>
                {exercises.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </label>
          </div>
          <Chart
            title={selected ? `${selected} · 重量趋势` : "重量趋势"}
            unit="kg"
            labels={days(30)}
            series={[
              {
                name: selected || "重量",
                values: days(30).map((day) =>
                  valueOn(
                    workouts.filter((r) => r.exercise === selected),
                    day,
                    "weight_kg",
                  ),
                ),
              },
            ]}
          />
          <Panel title="最近训练">
            {workouts.length ? (
              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      {["日期", "动作", "组 × 次", "重量"].map((title) => (
                        <th key={title}>{title}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...workouts]
                      .reverse()
                      .slice(0, 24)
                      .map((row) => (
                        <tr key={row.id}>
                          <td>{dayOf(row.ts, data.timeZone)}</td>
                          <td>{String(row.exercise)}</td>
                          <td>
                            {number(row.sets)} × {number(row.reps)}
                          </td>
                          <td>{number(row.weight_kg, 1)} kg</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>对 Agent 说「今天深蹲 3×12，60 kg」，开始记录。</Empty>
            )}
          </Panel>
        </>
      )}
      {tab === "饮食" && (
        <>
          <Panel title="今天的营养">
            <div class="stats">
              <div>
                <span>已记录摄入</span>
                <strong>
                  {approx(kcal)}
                  <small> kcal</small>
                </strong>
                <small>{total !== null ? `当天消耗 ${number(total)} kcal` : "还没有当天消耗记录"}</small>
              </div>
              <div>
                <span>已记录蛋白质</span>
                <strong>
                  {approx(protein)}
                  <small> g</small>
                </strong>
                <small>目标 {nutrition?.protein_g?.join("–") ?? "未设置"} g</small>
              </div>
              <div>
                <span>热量缺口</span>
                {mealsComplete && total !== null && kcal !== null ? (
                  <strong>
                    {approx(total - kcal)}
                    <small> kcal</small>
                  </strong>
                ) : (
                  <strong>
                    <small>{mealsComplete ? "还没有当天消耗记录" : "记录不完整，暂不计算"}</small>
                  </strong>
                )}
                <small>规则上限 {nutrition?.deficit_kcal_max ?? "未设置"} kcal</small>
              </div>
            </div>
            {protein !== null && nutrition?.protein_g?.[0] && (
              <progress value={protein} max={nutrition.protein_g[0]} aria-label="蛋白质目标进度" />
            )}
          </Panel>
          <Chart
            title="近 14 天热量"
            unit="kcal"
            labels={days(14)}
            series={[
              { name: "热量", type: "bar", values: days(14).map((day) => valueOn(meals, day, "kcal", true)) },
            ]}
          />
          <Chart
            title="近 14 天蛋白质"
            unit="g"
            labels={days(14)}
            series={[
              {
                name: "蛋白质",
                type: "bar",
                values: days(14).map((day) => valueOn(meals, day, "protein_g", true)),
              },
            ]}
          />
        </>
      )}
      {tab === "睡眠与活动" && (
        <>
          <Chart
            title="近 30 天睡眠"
            unit="小时"
            labels={sleepDays}
            series={[
              {
                name: "睡眠",
                values: sleepDays.map((day) => {
                  const rows = records("sleep").filter((r) => dayOf(r.end, data.timeZone) === day);
                  return rows.length
                    ? Math.round(rows.reduce((sum, row) => sum + Number(row.duration_min), 0) / 6) / 10
                    : null;
                }),
              },
            ]}
          />
          <Chart
            title="近 30 天步数"
            unit="步"
            labels={sleepDays}
            series={[
              { name: "步数", type: "bar", values: sleepDays.map((day) => valueOn(activity, day, "steps")) },
            ]}
          />
        </>
      )}
      {tab === "身体指标" && (
        <>
          {[
            { kind: "weight", title: "体重", unit: "kg" },
            { kind: "body_fat", title: "体脂", unit: "%" },
          ].map((metric) => (
            <Chart
              key={metric.kind}
              title={`${metric.title}趋势`}
              unit={metric.unit}
              labels={sleepDays}
              series={[
                {
                  name: metric.title,
                  values: sleepDays.map((day) =>
                    valueOn(
                      body.filter((r) => r.kind === metric.kind),
                      day,
                      "value",
                    ),
                  ),
                },
              ]}
            />
          ))}
          <Photos data={data} act={act} busy={busy} refresh={refresh} />
          <Panel title="最近体检">
            {!data.labs.length && <Empty>把体检文件交给 Agent 整理，指标与异常标记会显示在这里。</Empty>}
            {data.labs.map((lab) => (
              <div key={lab.file}>
                <h3>{lab.date}</h3>
                <p class="muted">{lab.file.split("/").at(-1)}</p>
                {lab.items.map((item, i) => (
                  <div class="list-row" key={`${item.name}-${i}`}>
                    <span class="grow">{item.name}</span>
                    <strong>
                      {item.value} {item.unit}
                    </strong>
                    {item.ref_range && <small>{item.ref_range}</small>}
                    {item.flag && item.flag !== "normal" && (
                      <span class="badge warning">
                        {{ high: "偏高", low: "偏低", abnormal: "异常" }[item.flag] ?? "异常"}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </Panel>
        </>
      )}
      <footer class="health-footer">只做记录与趋势，不构成医疗建议</footer>
    </>
  );
}
