import { useEffect, useState } from "react";
import type { FinanceOverviewData, OverviewData } from "../types.js";
import css from "./OverviewPage.module.css";

export function RecordSummary({
  kind,
  data,
  loadFinance,
  openDetails,
}: {
  kind: "health" | "finance";
  data: OverviewData | null;
  loadFinance: () => Promise<FinanceOverviewData>;
  openDetails: () => void;
}) {
  const [finance, setFinance] = useState<FinanceOverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    if (kind === "finance")
      void loadFinance()
        .then((value) => {
          if (active) setFinance(value);
        })
        .catch((err) => {
          if (active) setError(String(err));
        });
    return () => {
      active = false;
    };
  }, [kind, loadFinance]);
  const metrics = data?.metrics.filter((m) => m.value !== null) ?? [];
  const next = data?.allNext.filter((item) => item.section === kind).slice(0, 3) ?? [];
  return (
    <section className={css.section} aria-label={`${kind === "health" ? "健康" : "财务"}摘要`}>
      {error && <p role="alert">{error}</p>}
      {kind === "health" ? (
        <>
          {metrics.length ? (
            <div className={css.lifeGrid}>
              {metrics.map((metric) => (
                <div key={metric.key}>
                  <p className={css.muted}>{metric.label}</p>
                  <h2>
                    {metric.estimated ? "约 " : ""}
                    {new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }).format(
                      metric.value as number,
                    )}{" "}
                    {metric.unit}
                  </h2>
                  <p className={css.muted}>
                    {metric.from} – {metric.to}
                    {metric.target ? ` · 目标 ${metric.target.join("–")} ${metric.unit}` : ""}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p>还没有健康记录。可以先记下一次活动，或导入已有资料。</p>
          )}
          {next.map((item) => (
            <div className={css.row} key={item.id}>
              <strong>{item.title}</strong>
              {item.proposed && <span className={css.muted}>建议，待确认</span>}
            </div>
          ))}
        </>
      ) : !finance ? (
        <p className={css.muted}>{error ? "请稍后重新打开" : "正在读取财务摘要…"}</p>
      ) : finance.currencies.length ? (
        <div className={css.lifeGrid}>
          {finance.currencies.map((group) => (
            <div key={group.currency}>
              <p className={css.muted}>净资产 · {group.currency}</p>
              <h2>{group.net_assets.amount ?? "资料不足"}</h2>
              <p className={css.muted}>现金 {group.cash.amount ?? "尚无余额记录"}</p>
            </div>
          ))}
        </div>
      ) : (
        <p>还没有财务资料。导入账单或持仓后，在这里查看关键变化。</p>
      )}
      <button type="button" className={css.link} onClick={openDetails}>
        {kind === "health" ? "查看全部健康记录与趋势" : "查看财务明细或导入账单"} →
      </button>
    </section>
  );
}
