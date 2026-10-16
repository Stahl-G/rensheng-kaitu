import { useEffect, useState } from "react";
import type {
  FinanceCashflowData,
  FinanceInvestmentsData,
  FinanceOverviewData,
  OverviewData,
} from "../types.js";
import type { FinancePageProps } from "./FinancePage.js";
import css from "./Prototype.module.css";

const nf = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 });
const money = (metric: { amount: string | null; record_ids: string[] } | undefined, currency: string) =>
  metric?.amount !== null && metric?.amount !== undefined && metric.record_ids.length
    ? `${currency} ${metric.amount}`
    : "资料不足";
export function TodayFinance({
  today,
  open,
  ...props
}: Pick<FinancePageProps, "loadFinanceOverview" | "loadFinanceCashflow" | "loadFinanceInvestments"> & {
  today: string;
  open: () => void;
}) {
  const [data, setData] = useState<{
    overview: FinanceOverviewData;
    flow: FinanceCashflowData;
    investment: FinanceInvestmentsData;
  } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void Promise.all([
      props.loadFinanceOverview(),
      props.loadFinanceCashflow(`${today.slice(0, 7)}-01`, today),
      props.loadFinanceInvestments(),
    ])
      .then(([overview, flow, investment]) => {
        if (active) setData({ overview, flow, investment });
      })
      .catch((err) => {
        if (active) setError(String(err));
      });
    return () => {
      active = false;
    };
  }, [props.loadFinanceOverview, props.loadFinanceCashflow, props.loadFinanceInvestments, today]);
  const currencies = [
    ...new Set([
      ...(data?.overview.currencies.map((g) => g.currency) ?? []),
      ...(data?.flow.currencies.map((g) => g.currency) ?? []),
    ]),
  ];
  return (
    <section className={css.sec}>
      <div className={css["sec-head"]}>
        <h2 className={css["sum-h"]}>
          <i className={css.dot} style={{ background: "var(--finance)" }} />
          财务
        </h2>
        <button type="button" className={css.link} onClick={open}>
          打开财务
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {data && !currencies.length && (
        <p className={css.emptyState}>还没有财务资料，导入账单或账户余额后再来看。</p>
      )}
      {currencies.map((currency) => {
        const balance = data?.overview.currencies.find((g) => g.currency === currency);
        const flow = data?.flow.currencies.find((g) => g.currency === currency);
        const investment = data?.investment.currencies.find((g) => g.currency === currency);
        return (
          <div className={`${css.fin} ${css.card}`} key={currency}>
            {[
              ["本月支出", money(flow?.consumption, currency)],
              ["本月收入", money(flow?.income, currency)],
              ["总资产", money(balance?.total_assets, currency)],
              ["投资收益 · 未实现", money(investment?.unrealized_gain, currency)],
            ].map(([label, value]) => (
              <div className={css["fin-cell"]} key={label}>
                <span className={css.small}>{label}</span>
                <span className={`${css.big} ${css.num}`}>{value}</span>
              </div>
            ))}
            <div className={css["fin-wide"]}>
              <span className={css.small}>本月支出去向</span>
              {data?.flow.consumption_categories
                .filter((row) => row.currency === currency)
                .map((row) => (
                  <span key={row.category}>
                    {{ expense: "消费", interest: "利息", refund: "退款" }[row.category]} ·{" "}
                    {money(row.total, currency)}
                  </span>
                ))}
              {!data?.flow.consumption_categories.some((row) => row.currency === currency) && (
                <span className={css.small}>尚无支出分类</span>
              )}
            </div>
          </div>
        );
      })}
      {!!data?.overview.pending.length && (
        <div className={css.ask}>
          <span>{data.overview.pending.length} 笔待核对</span>
          <span>{data.overview.pending[0]?.description}</span>
          <button type="button" className={css.link} onClick={open}>
            去核对
          </button>
        </div>
      )}
    </section>
  );
}
export function DataSummaries({ data, open }: { data: OverviewData; open: (id: string) => void }) {
  const sections = data.sections.filter((section) => section.id !== "finance");
  if (!sections.length) return null;
  return (
    <section className={css.sec}>
      <div className={css["sec-head"]}>
        <h2 className={css.eyebrow}>你的数据</h2>
        <span className={css.small}>有数据的板块会自动出现，没数据的不占位置</span>
      </div>
      <div className={css.grid}>
        {sections.map((section) => (
          <button
            type="button"
            className={`${css.sum} ${css.card} ${css.summaryButton}`}
            key={section.id}
            onClick={() => open(section.id)}
          >
            <span className={css["sum-h"]}>
              {section.label}
              <span>{section.count} 条</span>
            </span>
            {section.id === "health" && data.metrics.length ? (
              <>
                <div className={css.pair}>
                  {data.metrics.slice(0, 2).map((metric) => (
                    <span className={css.stack} key={metric.key}>
                      <span className={`${css.big} ${css.num}`}>
                        {metric.value === null
                          ? "尚无记录"
                          : `${metric.estimated ? "约 " : ""}${nf.format(metric.value)} ${metric.unit}`}
                      </span>
                      <span className={css.small}>
                        {metric.label} · {metric.days} 天有记录
                      </span>
                    </span>
                  ))}
                </div>
                <div className={css.week}>
                  {data.metrics
                    .find((m) => m.key === "workouts")
                    ?.daily.map((day) => (
                      <span
                        key={day.date}
                        title={`${day.date}：${day.value === null ? "没记" : `${day.value} 次`}`}
                      >
                        <i style={day.value !== null ? { background: "var(--health)" } : {}} />
                        {day.date.slice(8)}
                      </span>
                    ))}
                </div>
              </>
            ) : section.id === "projects" && data.projects.length ? (
              data.projects.slice(0, 2).map((project) => (
                <span className={css.stack} key={project.slug}>
                  <b>{project.title}</b>
                  <span className={css.small}>{project.next[0] ?? "还没有下一步"}</span>
                </span>
              ))
            ) : (
              <span className={css.small}>
                {section.latest ? `最近更新 ${section.latest.slice(0, 10)}` : "查看全部资料与来源"}
              </span>
            )}
          </button>
        ))}
      </div>
    </section>
  );
}
