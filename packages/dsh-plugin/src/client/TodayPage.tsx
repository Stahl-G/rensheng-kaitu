import type { ReactNode } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { OverviewData, OverviewNext } from "../types.js";
import css from "./Prototype.module.css";
import todayCss from "./TodayPage.module.css";
import { exploreModules } from "./explore-modules.js";
import { useLocale, useT } from "./i18n.js";
import { nextPresentation } from "./next-presentation.js";

export function TodayStart({
  start,
  memory,
  connect,
  openModule,
  storage,
  status,
  hasWrittenMatter = false,
  busy = false,
}: {
  start: (text: string) => void;
  memory: () => void;
  connect: () => void;
  openModule?: (id: string) => void;
  storage?: () => void;
  status: import("@kaitu/core").OnboardingStatus | null;
  hasWrittenMatter?: boolean;
  busy?: boolean;
}) {
  const t = useT();
  const [goal, setGoal] = useState("");
  const stepDone = (id: string) =>
    id === "matter"
      ? !!(
          hasWrittenMatter ||
          status?.draft ||
          status?.next ||
          status?.checklist.items.find((item) => item.id === id)?.done
        )
      : !!status?.checklist.items.find((item) => item.id === id)?.done;
  const steps = [
    ["matter", t("写下一件事", "Write down one thing"), t("就在上面", "Start above"), () => start(goal)],
    [
      "memory",
      t("把 AI 记得的你搬过来", "Bring over what AI remembers"),
      t("也可以导入笔记和日历", "You can also import notes and calendars"),
      memory,
    ],
    [
      "ai",
      t("接上 AI（可以先跳过）", "Connect AI (optional)"),
      t("不接也能记录、看日程和足迹", "Notes, schedules and footprints work without AI"),
      connect,
    ],
  ] as const;
  return (
    <>
      <section className={todayCss.start}>
        <p className={css.eyebrow}>{t("欢迎来到开图", "Welcome to Kaitu")}</p>
        <h1>{t("从一件事开始。", "Start with one thing.")}</h1>
        <p>
          {t(
            "现在最想做成的一件事是什么？写一句就行，以后随时能改。",
            "What would you most like to do? One sentence is enough; you can change it later.",
          )}
        </p>
        <form
          className={todayCss.goalForm}
          onSubmit={(e) => {
            e.preventDefault();
            if (goal.trim()) start(goal.trim());
          }}
        >
          <input
            className={css.input}
            aria-label={t("最想做成的一件事", "One thing to do")}
            placeholder={t("比如：两年内出版第一本散文集", "For example: publish my first essay collection")}
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
          />
          <button type="submit" className={`${css.btn} ${css["btn-strong"]}`} disabled={busy || !goal.trim()}>
            {t("就是它", "That's it")}
          </button>
        </form>
        <div className={todayCss.topics}>
          {(
            [
              ["工作", "work"],
              ["身体", "body"],
              ["学习", "learning"],
              ["关系", "relationships"],
              ["生活", "life"],
            ] as const
          ).map(([zh, en]) => (
            <button
              type="button"
              className={css.btn}
              key={en}
              onClick={() => start(t(`我想理一理${zh}：`, `I'd like to think about ${en}: `))}
            >
              {t(zh, en)}
            </button>
          ))}
          <button type="button" className={css.link} onClick={() => start("")}>
            {t("还没想好，我想直接说一段", "Not sure yet; start with a thought")}
          </button>
        </div>
      </section>
      {!steps.every(([id]) => stepDone(id)) && (
        <section className={todayCss.steps}>
          <h2>{t("三步用起来", "Three steps to get started")}</h2>
          {steps.map(([id, title, hint, action], i) => (
            <div className={css.row} key={id}>
              <span aria-label={stepDone(id) ? t("已完成", "Done") : undefined}>
                {stepDone(id) ? "✓" : i + 1}
              </span>
              <span className={todayCss.grow}>
                <b>{title}</b>
                <small>{hint}</small>
              </span>
              {i > 0 && (
                <button type="button" className={css.btn} onClick={action}>
                  {i === 1 ? t("搬过来", "Bring it over") : t("看看怎么接", "See how")}
                </button>
              )}
            </div>
          ))}
        </section>
      )}
      {openModule && (
        <section className={todayCss.modules}>
          <h2>{t("开图里可以放这些", "Make room for these")}</h2>
          <div className={todayCss.moduleGrid}>
            {exploreModules
              .filter((entry) => entry.default)
              .map((entry) => (
                <button
                  type="button"
                  className={css.card}
                  key={entry.id}
                  onClick={() => openModule(entry.id)}
                >
                  <b>{t(entry.title[0], entry.title[1])}</b>
                  <span>{t(entry.description[0], entry.description[1])}</span>
                  <span className={todayCss.firstAction}>
                    {t(
                      entry.id === "footprints"
                        ? "加上家乡"
                        : entry.id === "health"
                          ? "记一条健康记录"
                          : entry.id === "news"
                            ? "选几个关键词"
                            : "写下一个想试的方向",
                      entry.id === "footprints"
                        ? "Add your hometown"
                        : entry.id === "health"
                          ? "Log a health record"
                          : entry.id === "news"
                            ? "Choose some keywords"
                            : "Write an idea to try",
                    )}{" "}
                    →
                  </span>
                </button>
              ))}
          </div>
          <button type="button" className={css.link} onClick={() => openModule("modules")}>
            {t("更多模块 →", "More modules →")}
          </button>
        </section>
      )}
      {storage && (
        <section className={todayCss.storage}>
          <h2>{t("你的资料在哪", "Where your data lives")}</h2>
          <p>
            {t(
              "都存在你选的文件夹里，是普通文件，随时可以带走。",
              "Ordinary files in your chosen folder, ready to take with you.",
            )}
          </p>
          <button type="button" className={css.link} onClick={storage}>
            {t("换个位置", "Change location")}
          </button>
        </section>
      )}
    </>
  );
}

/** Only clipped goals become interactive; the full text remains unchanged. */
export function TodayGoal({ text, title = false }: { text: string; title?: boolean }) {
  const t = useT();
  const line = useRef<HTMLSpanElement>(null);
  const [clipped, setClipped] = useState(false);
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    setOpen(false);
    const measure = () => {
      const node = line.current;
      if (node)
        setClipped(!!text && (node.scrollWidth > node.clientWidth || node.scrollHeight > node.clientHeight));
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (line.current) observer.observe(line.current);
    return () => observer.disconnect();
  }, [text]);
  const Text = title ? "b" : "span";
  return (
    <div className={`${todayCss.goal} ${title ? todayCss.goalTitle : ""}`}>
      {!title && <span>{t("为了", "For")}</span>}
      <Text ref={line} className={todayCss.goalLine}>
        {text}
      </Text>
      {clipped && (
        <button type="button" className={css.link} aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? t("收起", "Show less") : t("展开", "Show more")}
        </button>
      )}
      {open && clipped && <p>{text.replace(/(?<=.)(?=[[【][^\]】]{1,16}[\]】])/g, "\n")}</p>}
    </div>
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
  focusTaskId,
  all,
  adopted = [],
  showAll = false,
}: {
  data: OverviewData;
  busy: boolean;
  complete: (item: OverviewNext) => void;
  ask: (item: OverviewNext) => void;
  schedule: (item: OverviewNext) => void;
  review: () => void;
  focusCard?: ReactNode;
  focusTaskId?: string;
  all: () => void;
  adopted?: string[];
  showAll?: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const focus = data.next[0];
  const focusText = focus && nextPresentation(focus, locale);
  const goal =
    data.plans.goals.find((goal) => goal.next?.id === focus?.id)?.title ??
    Object.values(data.plans.sources).find((source) => source.taskId === focus?.id)?.goalTitle;
  const upcoming = (focusCard ? data.allNext : data.allNext.slice(1))
    .filter((item) => item.id !== focusTaskId)
    .sort((a, b) => Number(adopted.includes(b.id)) - Number(adopted.includes(a.id)));
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
          {adopted.includes(item.id) && <small>{t("刚采纳", "Just added")}</small>}
          {item.proposed && <small>{t(" · 建议", " · Suggested")}</small>}
        </span>
        <span className={css.small}>
          {data.blocks.find((block) => block.ref === item.id)?.start?.slice(11, 16)}
        </span>
        {extra(item)}
      </div>
    );
  };
  return (
    <>
      {!showAll && (focus || focusCard) && (
        <section className={todayCss.focusSection}>
          {focusCard ??
            (focus && (
              <>
                <h2 className={css.eyebrow}>{t("现在这件事", "One thing now")}</h2>
                <div className={todayCss.focus}>
                  <h2>{focusText?.title}</h2>
                  {goal && <TodayGoal text={goal} />}
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
                    {!focus.proposed && (
                      <button type="button" className={css.btn} onClick={() => schedule(focus)}>
                        {t("安排时间", "Schedule a time")}
                      </button>
                    )}
                  </div>
                </div>
              </>
            ))}
        </section>
      )}
      {upcoming.length > 0 && (
        <section className={todayCss.upcoming}>
          <div className={todayCss.sectionHead}>
            <h2>{t("接下来", "Up next")}</h2>
            {!showAll && (
              <button type="button" className={css.link} onClick={all}>
                {t(`全部 ${upcoming.length} 条`, `All ${upcoming.length}`)}
              </button>
            )}
          </div>
          <div>{(showAll ? upcoming : upcoming.slice(0, 3)).map(row)}</div>
        </section>
      )}
    </>
  );
}
