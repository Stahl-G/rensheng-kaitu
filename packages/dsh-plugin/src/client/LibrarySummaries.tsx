import { useEffect, useState } from "react";
import type { HealthData } from "../types.js";
import { HealthPage, type HealthPageProps } from "./HealthPage.js";
import css from "./Prototype.module.css";
import { useT } from "./i18n.js";

export function HealthLibrary(props: HealthPageProps & { sources: string[] }) {
  const t = useT();
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
          {t("← 健康摘要", "← Health summary")}
        </button>
        <HealthPage {...props} />
      </div>
    );
  const heat = data?.training.heatmap.filter((day) => !day.future).slice(-28) ?? [];
  const recorded = data?.sleep.filter((day) => day.value !== null) ?? [];
  const training = heat.reduce((count, day) => count + (day.sessions ?? 0), 0);
  return (
    <div className={`${css.sec} ${css.sections}`}>
      {error && <p role="alert">{error}</p>}
      {!data ? (
        <p className={css.small}>{t("正在读取健康记录…", "Loading health records…")}</p>
      ) : (
        <>
          <section className={css.sec}>
            <h2 className={css.eyebrow}>{t("训练 · 最近 4 周", "Training · Last 4 weeks")}</h2>
            <div className={`${css.card} ${css.sum}`}>
              {training ? (
                <>
                  <div className={css.heat}>
                    {heat.map((day) => (
                      <i
                        key={day.date}
                        title={t(
                          `${day.date}：${day.sessions === null ? "未记录" : `${day.sessions} 次`}`,
                          `${day.date}: ${day.sessions === null ? "Not recorded" : `${day.sessions} ${day.sessions === 1 ? "session" : "sessions"}`}`,
                        )}
                        style={day.sessions !== null ? { background: "var(--health)" } : {}}
                      />
                    ))}
                  </div>
                  <span className={css.small}>
                    {t(`${training} 次训练`, `${training} ${training === 1 ? "session" : "sessions"}`)} ·{" "}
                    {heat[0]?.date} – {heat.at(-1)?.date}
                  </span>
                </>
              ) : (
                <p className={css.small}>
                  {t("这段时间还没有训练记录", "No training records in this period")}
                </p>
              )}
            </div>
          </section>
          <section className={css.sec}>
            <h2 className={css.eyebrow}>{t("睡眠 · 最近 14 晚", "Sleep · Last 14 nights")}</h2>
            <div className={`${css.card} ${css.sum}`}>
              {recorded.length ? (
                <>
                  <div className={css.sleep}>
                    {data.sleep.map((day) => (
                      <i
                        key={day.date}
                        className={day.value === null ? css.miss : undefined}
                        title={t(
                          `${day.date}：${day.value === null ? "未记录" : `${day.value.toFixed(1)} 小时`}`,
                          `${day.date}: ${day.value === null ? "Not recorded" : `${day.value.toFixed(1)} h`}`,
                        )}
                        style={day.value !== null ? { height: Math.min((day.value / 9) * 80, 100) } : {}}
                      />
                    ))}
                  </div>
                  <span className={css.small}>
                    {t(
                      `${recorded.length} 晚有记录，平均 ${(recorded.reduce((sum, day) => sum + (day.value ?? 0), 0) / recorded.length).toFixed(1)} 小时 · ${data.sleep.length - recorded.length} 晚没记`,
                      `${recorded.length} nights recorded · Average ${(recorded.reduce((sum, day) => sum + (day.value ?? 0), 0) / recorded.length).toFixed(1)} h · ${data.sleep.length - recorded.length} missing`,
                    )}
                  </span>
                </>
              ) : (
                <p className={css.small}>{t("还没有睡眠记录", "No sleep records yet")}</p>
              )}
            </div>
          </section>
          <section className={css.sec}>
            <h2 className={css.eyebrow}>{t("来源", "Sources")}</h2>
            <div className={`${css.card} ${css["list-card"]}`}>
              {props.sources.length ? (
                props.sources.map((source) => (
                  <div className={css["switch-row"]} key={source}>
                    {t(
                      source,
                      (
                        {
                          "Apple 健康": "Apple Health",
                          "Apple 健康导入": "Apple Health import",
                          你记录的: "Recorded by you",
                          "本机 AI": "Local AI",
                        } as Record<string, string>
                      )[source] ?? source,
                    )}
                  </div>
                ))
              ) : (
                <p className={css.small}>{t("还没有健康资料来源", "No health sources yet")}</p>
              )}
            </div>
          </section>
        </>
      )}
      <button type="button" className={css.link} onClick={() => setDetails(true)}>
        {t("全部健康记录、照片与趋势 →", "All health records, photos and trends →")}
      </button>
    </div>
  );
}
export { ProjectsPage as ProjectsLibrary } from "./ProjectsPage.js";
