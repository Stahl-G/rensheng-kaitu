import { useEffect, useState } from "react";
import type { HealthData } from "../types.js";
import { HealthPage, type HealthPageProps } from "./HealthPage.js";
import css from "./Prototype.module.css";

export function HealthLibrary(props: HealthPageProps & { sources: string[] }) {
  const [data, setData] = useState<HealthData | null>(null);
  const [error, setError] = useState("");
  const [details, setDetails] = useState(false);
  useEffect(() => {
    let active = true;
    void props
      .loadHealth()
      .then((value) => {
        if (active) setData(value);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      active = false;
    };
  }, [props.loadHealth]);
  if (details)
    return (
      <div className={css.sec}>
        <button type="button" className={css.link} onClick={() => setDetails(false)}>
          ← 健康摘要
        </button>
        <HealthPage {...props} />
      </div>
    );
  const heat = data?.training.heatmap.filter((day) => !day.future).slice(-28) ?? [];
  const recorded = data?.sleep.filter((day) => day.value !== null) ?? [];
  const training = heat.reduce((count, day) => count + (day.sessions ?? 0), 0);
  return (
    <div className={css.sec}>
      {error && <p role="alert">{error}</p>}
      {!data ? (
        <p className={css.small}>正在读取健康记录…</p>
      ) : (
        <>
          <section className={css.sec}>
            <h2 className={css.eyebrow}>训练 · 最近 4 周</h2>
            <div className={`${css.card} ${css.sum}`}>
              {training ? (
                <>
                  <div className={css.heat}>
                    {heat.map((day) => (
                      <i
                        key={day.date}
                        title={`${day.date}：${day.sessions === null ? "未记录" : `${day.sessions} 次`}`}
                        style={day.sessions !== null ? { background: "var(--health)" } : {}}
                      />
                    ))}
                  </div>
                  <span className={css.small}>
                    {training} 次训练 · {heat[0]?.date} – {heat.at(-1)?.date}
                  </span>
                </>
              ) : (
                <p className={css.small}>这段时间还没有训练记录</p>
              )}
            </div>
          </section>
          <section className={css.sec}>
            <h2 className={css.eyebrow}>睡眠 · 最近 14 晚</h2>
            <div className={`${css.card} ${css.sum}`}>
              {recorded.length ? (
                <>
                  <div className={css.sleep}>
                    {data.sleep.map((day) => (
                      <i
                        key={day.date}
                        className={day.value === null ? css.miss : undefined}
                        title={`${day.date}：${day.value === null ? "未记录" : `${day.value.toFixed(1)} 小时`}`}
                        style={day.value !== null ? { height: Math.min((day.value / 9) * 80, 100) } : {}}
                      />
                    ))}
                  </div>
                  <span className={css.small}>
                    {recorded.length} 晚有记录，平均{" "}
                    {(recorded.reduce((sum, day) => sum + (day.value ?? 0), 0) / recorded.length).toFixed(1)}{" "}
                    小时 · {data.sleep.length - recorded.length} 晚没记
                  </span>
                </>
              ) : (
                <p className={css.small}>还没有睡眠记录</p>
              )}
            </div>
          </section>
          <section className={css.sec}>
            <h2 className={css.eyebrow}>来源</h2>
            <div className={`${css.card} ${css["list-card"]}`}>
              {props.sources.length ? (
                props.sources.map((source) => (
                  <div className={css["switch-row"]} key={source}>
                    {source}
                  </div>
                ))
              ) : (
                <p className={css.small}>还没有健康资料来源</p>
              )}
            </div>
          </section>
        </>
      )}
      <button type="button" className={css.link} onClick={() => setDetails(true)}>
        全部健康记录、照片与趋势 →
      </button>
    </div>
  );
}
export { ProjectsPage as ProjectsLibrary } from "./ProjectsPage.js";
