import type { ReactNode } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { OverviewData, OverviewNext } from "../types.js";
import css from "./Prototype.module.css";
import todayCss from "./TodayPage.module.css";
import { exploreModules } from "./explore-modules.js";
import { useLocale, useT } from "./i18n.js";
import { nextPresentation } from "./next-presentation.js";

export function LifeHome({
  data,
  firstVisit,
  capture,
  writing,
  start,
  library,
  connect,
  openModule,
  handover,
  memory,
}: {
  data: OverviewData;
  firstVisit: boolean;
  capture: ReactNode;
  writing: boolean;
  start: () => void;
  library: () => void;
  connect: () => void;
  openModule: (id: string) => void;
  handover: () => void;
  memory: () => void;
}) {
  const t = useT();
  const recent = data.notes[0];
  const health = data.sections.find((section) => section.id === "health");
  const latest =
    recent?.text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim() ||
    data.sections.find((section) => section.preview.length)?.preview[0];
  const cards = [
    {
      id: "health",
      title: t("回看身体变化", "Notice changes in your body"),
      description: t(
        "记下吃了什么、运动和睡眠，慢慢看见自己的变化。",
        "Keep track of meals, movement and sleep, and notice what changes.",
      ),
      detail:
        health?.preview[0] ||
        (health ? t(`已留下 ${health.count} 条健康记录`, `${health.count} health records kept`) : null),
      action: t("打开健康", "Open health"),
      open: () => openModule("health"),
    },
    {
      id: "directions",
      title: t("找一个新方向", "Find a new direction"),
      description: t(
        "从经历和兴趣出发，探索工作或生活的选择，试一小步。",
        "Explore choices in work and life through your experience and interests. Try one small step.",
      ),
      detail: null,
      action: t("探索方向", "Explore directions"),
      open: () => openModule("directions"),
    },
    {
      id: "handover",
      title: t("换个 AI 接着聊", "Continue with another AI"),
      description: t(
        "选好要带的近况，预览、删改后，复制给你常用的 AI。",
        "Choose what to bring, review and edit it, then copy it to the AI you use.",
      ),
      detail: null,
      action: t("准备资料包", "Prepare a context pack"),
      open: handover,
    },
  ];
  return (
    <section className={todayCss.lifeHome} aria-label={t("生活首页", "Life at a glance")}>
      <header className={todayCss.lifeHeading}>
        <p className={css.eyebrow}>{t("生活，慢慢有迹可循", "A little life, kept over time")}</p>
        <h1>
          {firstVisit
            ? t("让 AI 了解你，从一件小事开始", "Let AI get to know you, one small moment at a time")
            : t("把日子记下来，慢慢看见自己", "Keep your moments. Get to know yourself.")}
        </h1>
        <p>
          {firstVisit
            ? t(
                "先留下一点生活，想聊时再接上 AI。",
                "Keep a little of your life. Connect AI whenever you want to talk.",
              )
            : t(
                "不用每天做计划。留下一点，也可以只是回来看一看。",
                "No daily plan required. Leave a note, or simply look back.",
              )}
        </p>
      </header>
      <div className={todayCss.lifeHero}>
        <div>
          <h2>{t("先记下今天的一件事", "Keep one moment from today")}</h2>
          <p>
            {t(
              "一顿饭、一次散步，或一个还没想明白的念头。",
              "A meal, a walk, or a thought you are still figuring out.",
            )}
          </p>
          {!writing && (
            <button
              id="life-capture-start"
              type="button"
              className={`${css.btn} ${css["btn-strong"]}`}
              onClick={start}
            >
              {t("记一件事", "Write a moment")}
              <span aria-hidden="true"> ↗</span>
            </button>
          )}
          <small>
            {t("不用连接 AI，写一句就能保存。", "No AI connection needed. A sentence is enough.")}
          </small>
        </div>
        {!writing && (
          <div className={todayCss.lifeNote}>
            <span>
              {latest
                ? t("最近留下的", "Recently kept")
                : firstVisit
                  ? t("灵感示例 · 不会保存", "A writing idea · not saved")
                  : t("你的积累", "What you have kept")}
            </span>
            <p>
              {latest ||
                (firstVisit
                  ? t(
                      "今天散步时，发现了一条想再走一次的小路。",
                      "On my walk today, I found a path I want to take again.",
                    )
                  : t(
                      "你保存的资料都在这里，随时可以回看。",
                      "Your saved material is here whenever you want to revisit it.",
                    ))}
            </p>
            {latest && (
              <button type="button" className={css.link} onClick={library}>
                {recent ? t("回看原文 →", "Read the original →") : t("打开资料 →", "Open library →")}
              </button>
            )}
          </div>
        )}
        {writing && capture}
      </div>
      {firstVisit && (
        <ol className={todayCss.lifeSteps}>
          {[
            [t("记一件事", "Write a moment"), t("写一句就好", "One sentence is enough"), start],
            [
              t("看看存了什么", "See what you saved"),
              t("原文在资料里，随时可回看", "Your original words stay in Library"),
              library,
            ],
            [
              t("想聊时再连接 AI", "Connect AI when you want"),
              t("可以以后再说", "There is no rush"),
              connect,
            ],
          ].map(([title, hint, action], i) => (
            <li key={String(title)}>
              <button type="button" onClick={action as () => void}>
                <span>{i + 1}</span>
                <div>
                  <b>{title as string}</b>
                  <small>{hint as string}</small>
                </div>
              </button>
            </li>
          ))}
        </ol>
      )}
      <div className={todayCss.lifeCards}>
        {cards.map((card) => (
          <button
            type="button"
            className={todayCss.lifeCard}
            id={card.id === "handover" ? "life-handover-start" : undefined}
            data-kind={card.id}
            key={card.id}
            onClick={card.open}
          >
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <path
                d={
                  exploreModules.find((entry) => entry.id === card.id)?.icon ??
                  "M3 7h7l2 2h9v11H3V7Zm3 0V3h11v6M8 13h8m-8 3h5"
                }
              />
            </svg>
            <h2>{card.title}</h2>
            <p>{card.description}</p>
            {card.detail && <span className={todayCss.lifeDetail}>{card.detail}</span>}
            <b className={todayCss.lifeAction}>{card.action} →</b>
          </button>
        ))}
      </div>
      <div className={todayCss.lifeLinks}>
        <button type="button" className={css.link} onClick={memory}>
          {t("已有 AI 记忆？搬过来", "Already have AI memories? Bring them over")}
        </button>
        <button type="button" className={css.link} onClick={() => openModule("modules")}>
          {t("看看全部模块 →", "Browse all modules →")}
        </button>
      </div>
    </section>
  );
}

export function TodayStart({
  start,
  memory,
  connect,
  storage,
  status,
  busy = false,
}: {
  start: (text: string) => void;
  memory: () => void;
  connect: () => void;
  storage?: () => void;
  status: import("@kaitu/core").OnboardingStatus | null;
  busy?: boolean;
}) {
  const t = useT();
  const [goal, setGoal] = useState("");
  const stepDone = (id: string) =>
    id === "matter"
      ? !!(status?.draft || status?.next || status?.checklist.items.find((item) => item.id === id)?.done)
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
