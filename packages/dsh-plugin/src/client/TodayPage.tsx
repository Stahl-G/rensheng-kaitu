import { type ReactNode, useEffect, useState } from "react";
import type {
  FinanceCashflowData,
  FinanceInvestmentsData,
  FinanceOverviewData,
  OverviewData,
  OverviewNext,
} from "../types.js";
import type { FinancePageProps } from "./FinancePage.js";
import css from "./Prototype.module.css";
import todayCss from "./TodayPage.module.css";
import { useLocale, useT } from "./i18n.js";
import { nextPresentation } from "./next-presentation.js";

const nf = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 });

function formatCardDate(iso: string | null, today: string, locale: "zh-CN" | "en") {
  if (!iso) return "";
  const day = iso.slice(0, 10);
  const todayAt = Date.parse(`${today}T12:00:00`);
  const dayAt = Date.parse(`${day}T12:00:00`);
  if (!Number.isFinite(todayAt) || !Number.isFinite(dayAt)) return day;
  const diff = Math.round((todayAt - dayAt) / 86_400_000);
  if (diff === 0) return locale === "en" ? "Today" : "今天";
  if (diff === 1) return locale === "en" ? "Yesterday" : "昨天";
  if (diff > 1 && diff < 7) return locale === "en" ? `${diff} days ago` : `${diff} 天前`;
  const date = new Date(`${day}T12:00:00`);
  if (locale === "en") return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}
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
        if (active) setError(err instanceof Error ? err.message : String(err));
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
  const t = useT();
  const locale = useLocale();
  const sections = data.sections.filter((section) => section.id !== "finance");
  if (!sections.length) return null;
  return (
    <section className={css.sec}>
      <div className={css["sec-head"]}>
        <h2 className={css.eyebrow}>{t("你的数据", "Your data")}</h2>
      </div>
      <div className={css.grid}>
        {sections.map((section) => {
          const when = formatCardDate(section.latest, data.today, locale);
          return (
            <button
              type="button"
              className={`${css.sum} ${css.card} ${css.summaryButton}`}
              key={section.id}
              onClick={() => open(section.id)}
            >
              <span className={css["sum-h"]}>
                <i
                  className={css.dot}
                  style={{
                    background: `var(--${({ health: "health", projects: "doing", feed: "news", calendar: "news", me: "me" } as Record<string, string>)[section.id] ?? "explore"})`,
                  }}
                />
                {t(
                  (
                    { feed: "资讯", me: "个人档案", explore: "方向", projects: "在做的事" } as Record<
                      string,
                      string
                    >
                  )[section.id] ?? section.label,
                  (
                    {
                      feed: "News",
                      me: "Profile",
                      explore: "Directions",
                      projects: "Projects",
                      health: "Health",
                      calendar: "Schedule",
                      learning: "Learning",
                      decisions: "Decisions",
                      reviews: "Reviews",
                    } as Record<string, string>
                  )[section.id] ?? section.label,
                )}
                <span>
                  {t(`${section.count} 条`, `${section.count}`)}
                  {when ? ` · ${when}` : ""}
                </span>
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
                    <span className={css.small}>
                      {project.next[0] ?? t("还没有下一步", "No next step yet")}
                    </span>
                  </span>
                ))
              ) : section.preview?.length ? (
                <span className={css.sumPreview}>
                  {section.preview.map((line, index) => (
                    <span key={`${index}-${line}`}>{line}</span>
                  ))}
                </span>
              ) : (
                <span className={css.small}>{t("查看全部资料与来源", "See all notes and sources")}</span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

export { CalendarPushResult, CalendarSlotForm } from "./CalendarPush.js";

/** 主题只预填现有原文表单；保存与采纳仍走原流程。 */
export function TodayStart({
  start,
  memory,
  busy = false,
}: {
  start: (text: string) => void;
  memory: () => void;
  busy?: boolean;
}) {
  const t = useT();
  const [memoryShown, setMemoryShown] = useState(true);
  const topics = [
    ["工作", "Work", "在做的事", "What you're working on", "#c89f78"],
    ["身体", "Body", "吃睡与精力", "Food, rest and energy", "#88a68b"],
    ["学习", "Learning", "想学的新东西", "Something to learn", "#a29bc7"],
    ["关系", "Relationships", "重要的人", "People who matter", "#c69498"],
    ["生活", "Life", "住处与日常", "Home and everyday life", "#8fa7ba"],
    ["还说不清", "Not sure yet", "先说一句", "Start with a thought", "#c6bb88"],
  ] as const;
  return (
    <section className={todayCss.start} aria-label={t("从一件事开始", "Start with one thing")}>
      <h1>{t("最近有什么事，\n你想理一理？", "What's on your mind lately?")}</h1>
      <div className={todayCss.topics}>
        {topics.map(([zh, en, hint, hintEn, color]) => (
          <button
            type="button"
            key={en}
            disabled={busy}
            onClick={() =>
              start(
                zh === "还说不清"
                  ? ""
                  : t(`我想理一理${zh}：`, `I'd like to think about ${en.toLowerCase()}: `),
              )
            }
          >
            <b>
              <i style={{ background: color }} />
              {t(zh, en)}
            </b>
            <span>{t(hint, hintEn)}</span>
          </button>
        ))}
      </div>
      <button type="button" className={todayCss.direct} disabled={busy} onClick={() => start("")}>
        <b>{t("我想直接说一句", "Say it in my own words")}</b>
        <span aria-hidden="true">→</span>
      </button>
      {memoryShown && (
        <div className={todayCss.memory}>
          <div>
            <b>{t("已经在用 ChatGPT、豆包？", "Already using an AI?")}</b>
            <p>{t("把它记得的关于你的事搬过来。", "Bring over what it remembers about you.")}</p>
          </div>
          <button type="button" className={css.btn} disabled={busy} onClick={memory}>
            {t("搬过来", "Bring it over")}
          </button>
          <button
            type="button"
            className={css.link}
            aria-label={t("关闭记忆搬入提示", "Dismiss memory import tip")}
            onClick={() => setMemoryShown(false)}
          >
            ×
          </button>
        </div>
      )}
    </section>
  );
}

export function TodayTasks({
  data,
  busy,
  complete,
  ask,
  schedule,
  review,
  focusCard,
}: {
  data: OverviewData;
  busy: boolean;
  complete: (item: OverviewNext) => void;
  ask: (item: OverviewNext) => void;
  schedule: (item: OverviewNext) => void;
  review: () => void;
  focusCard?: ReactNode;
}) {
  const t = useT();
  const locale = useLocale();
  const focus = data.next[0];
  const focusText = focus && nextPresentation(focus, locale);
  const upcoming = focusCard ? data.allNext : data.allNext.slice(1);
  const [remainingOpen, setRemainingOpen] = useState(false);
  const extra = (item: OverviewNext, inRow = true) => (
    <details className={todayCss.more}>
      <summary
        aria-label={t(
          `更多操作：${nextPresentation(item, locale).title}`,
          `More actions: ${nextPresentation(item, locale).title}`,
        )}
      >
        ···
      </summary>
      {!item.proposed && (
        <button type="button" className={css.link} onClick={() => schedule(item)}>
          {t("安排时间段", "Schedule a time")}
        </button>
      )}
      {inRow && item.proposed && item.id.startsWith("onboarding-matter-") && (
        <button type="button" className={css.link} onClick={review}>
          {t("去核对", "Review")}
        </button>
      )}
      {inRow && (
        <button type="button" className={css.link} onClick={() => ask(item)}>
          {t("交给 AI", "Ask AI")}
        </button>
      )}
    </details>
  );
  const row = (item: OverviewNext) => {
    const display = nextPresentation(item, locale);
    return (
      <div className={todayCss.nextRow} key={`${item.file}:${item.id}`}>
        <button
          type="button"
          className={css.check}
          disabled={busy || item.proposed}
          aria-label={t(`完成：${display.title}`, `Done: ${display.title}`)}
          onClick={() => complete(item)}
        >
          ✓
        </button>
        <span className={todayCss.nextTitle}>
          {display.title}
          {display.source && display.source !== display.title && <small> · {display.source}</small>}
          {item.proposed && <small>{t(" · 建议", " · Suggested")}</small>}
        </span>
        <span className={css.small}>{item.module}</span>
        {extra(item)}
      </div>
    );
  };
  return (
    <>
      {(focus || focusCard) && (
        <section className={css.sec}>
          {focusCard ??
            (focus && (
              <>
                <h2 className={css.eyebrow}>{t("现在这件事", "One thing now")}</h2>
                <div className={`${todayCss.focus} ${css.card}`}>
                  <h2>{focusText?.title}</h2>
                  <p className={css.small}>
                    {t(`来自 ${focus.module}`, `From ${focus.module}`)}
                    {focusText?.source && focusText.source !== focusText.title
                      ? ` · ${focusText.source}`
                      : ""}
                    {focus.proposed ? t(" · 建议，待核对", " · Suggested, to review") : ""}
                  </p>
                  <div className={todayCss.actions}>
                    {!focus.proposed && (
                      <button
                        type="button"
                        className={`${css.btn} ${css["btn-strong"]}`}
                        disabled={busy}
                        onClick={() => complete(focus)}
                      >
                        {t("完成", "Done")}
                      </button>
                    )}
                    {focus.proposed && focus.id.startsWith("onboarding-matter-") && (
                      <button
                        type="button"
                        className={`${css.btn} ${css["btn-strong"]}`}
                        disabled={busy}
                        onClick={review}
                      >
                        {t("去核对", "Review")}
                      </button>
                    )}
                    <button type="button" className={css.btn} onClick={() => ask(focus)}>
                      {t("交给 AI", "Ask AI")}
                    </button>
                    {!focus.proposed && extra(focus, false)}
                  </div>
                </div>
              </>
            ))}
        </section>
      )}
      {upcoming.length > 0 && (
        <section className={css.sec}>
          <h2 className={css.eyebrow}>{t("接下来", "Up next")}</h2>
          <div className={css.card}>{upcoming.slice(0, 2).map(row)}</div>
          {upcoming.length > 2 && (
            <details
              className={todayCss.remaining}
              onToggle={(event) => setRemainingOpen(event.currentTarget.open)}
            >
              <summary className={css.link}>
                {t(`还有 ${upcoming.length - 2} 件`, `${upcoming.length - 2} more`)}
              </summary>
              {remainingOpen && <div className={css.card}>{upcoming.slice(2).map(row)}</div>}
            </details>
          )}
        </section>
      )}
    </>
  );
}
