import type { DirectionMapState, DirectionQuote } from "@kaitu/core";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import css from "./DirectionMap.module.css";
import { type Locale, useLocale, useT } from "./i18n.js";

// 目标的颜色按顺序取模块色；颜色只用来分组，不代表含义。
const tones = ["--doing", "--me", "--health", "--news", "--finance"] as const;

/**
 * 方向页的「我在推进什么」：点一下让已连接的 AI 读目标、项目和日志，
 * 按固定样子画出 想达成 → 正在做 → 下一步，再附几句导师式的建议。
 * 连线是开图的看法，每条都带出处明确的原文，用户可以点「不对」去掉。
 */
export function DirectionMap({
  load,
  generate,
  dismiss,
  onConnect,
  openProject,
}: {
  load: (locale: Locale) => Promise<DirectionMapState>;
  generate: (locale: Locale) => Promise<DirectionMapState>;
  dismiss: (goal: string, project: string) => Promise<DirectionMapState>;
  onConnect?: () => void;
  openProject: (slug: string) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [state, setState] = useState<DirectionMapState | null>(null);
  const [error, setError] = useState("");
  const board = useRef<HTMLDivElement>(null);
  const [paths, setPaths] = useState<{ d: string; tone: string; dashed: boolean }[]>([]);
  const refresh = useCallback(() => {
    void load(locale)
      .then(setState)
      .catch(() => {});
  }, [load, locale]);
  useEffect(() => refresh(), [refresh]);
  // 正在看时读本机缓存，看完就停。
  useEffect(() => {
    if (!state?.running) return;
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, [state?.running, refresh]);
  const start = async () => {
    setError("");
    try {
      setState(await generate(locale));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  const map = state?.map;
  const input = state?.input;
  const links = map?.links ?? [];
  const goals = input?.goals ?? [];
  const toneOf = (goal: string): string =>
    tones[
      Math.max(
        0,
        goals.findIndex((g) => g.id === goal),
      ) % tones.length
    ] ?? "--doing";
  // 连线跟着卡片的实际位置画；窗口变窄时卡片上下排，线不画，理由仍写在项目卡里。
  // biome-ignore lint/correctness/useExhaustiveDependencies: 连线由看法和当前资料算出，只在它们变化时重画。
  useLayoutEffect(() => {
    const root = board.current;
    if (!root || !map) return;
    const draw = () => {
      const box = root.getBoundingClientRect();
      if (box.width < 760) return setPaths([]);
      const at = (id: string, side: "l" | "r") => {
        const node = root.querySelector<HTMLElement>(`[data-node="${id}"]`);
        if (!node) return null;
        const r = node.getBoundingClientRect();
        return [
          side === "r" ? r.right - box.left : r.left - box.left,
          r.top - box.top + Math.min(36, r.height / 2),
        ] as const;
      };
      const curve = (a: readonly [number, number], b: readonly [number, number]) => {
        const m = (a[0] + b[0]) / 2;
        return `M${a[0]} ${a[1]}C${m} ${a[1]} ${m} ${b[1]} ${b[0]} ${b[1]}`;
      };
      const next: typeof paths = [];
      for (const link of links) {
        const a = at(`goal:${link.goal}`, "r");
        const b = at(`project:${link.project}`, "l");
        if (a && b) next.push({ d: curve(a, b), tone: toneOf(link.goal), dashed: true });
      }
      // 只有用户定下的下一步画实线；建议和空缺都是虚线。
      for (const step of state?.next ?? []) {
        const a = at(`project:${step.project}`, "r");
        const b = at(`next:${step.project}`, "l");
        if (a && b) next.push({ d: curve(a, b), tone: "--line-strong", dashed: step.kind !== "todo" });
      }
      setPaths(next);
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(root);
    return () => observer.disconnect();
  }, [map, input, state?.next]);

  if (!state) return null;
  const projects = input?.projects ?? [];
  const header = (
    <div className={css.lens}>
      <span>
        <b>{t("开图的看法", "Kaitu's view")}</b>
        {state.generatedAt &&
          t(
            ` · ${new Date(state.generatedAt).toLocaleDateString(locale)} 根据 ${goals.length} 个目标、${projects.length} 个项目最近 30 天的记录整理`,
            ` · ${new Date(state.generatedAt).toLocaleDateString(locale)}, from ${goals.length} goals and ${projects.length} projects over the last 30 days`,
          )}
      </span>
      <button type="button" className={css.primary} disabled={state.running} onClick={() => void start()}>
        {state.running
          ? t("开图正在看…", "Looking…")
          : map
            ? t("重新看一遍", "Look again")
            : t("让开图看一看", "Ask Kaitu to look")}
      </button>
    </div>
  );
  const failure = error || state.error;
  if (!map)
    return (
      <section className={css.map} aria-label={t("我在推进什么", "What I'm moving forward")}>
        {header}
        <p className={css.intro}>
          {t(
            "开图会读你的目标、项目和最近的日志，画出这些事正在把你带向哪里，再说几句建议。看法不写进你的资料。",
            "Kaitu reads your goals, projects and recent logs, shows where they are taking you, and adds a few suggestions. Nothing is written into your notes.",
          )}
        </p>
        {failure && (
          <p className={css.error} role="alert">
            {failure}{" "}
            {/连上 AI|AI 与连接|Connect AI|AI & Connections/.test(failure) && onConnect && (
              <button type="button" className={css.link} onClick={onConnect}>
                {t("去连接 AI", "Connect AI")}
              </button>
            )}
          </p>
        )}
      </section>
    );
  const title = (slug: string) => projects.find((p) => p.slug === slug)?.title ?? slug;
  const last = (slug: string) => projects.find((p) => p.slug === slug)?.logs[0];
  // 依据写明出自哪里：哪个目标、哪个项目的哪天日志或下一步。
  const from = ({ source, quote }: DirectionQuote) => {
    const [kind, id = "", rest = ""] = source.split(":");
    const place =
      kind === "g"
        ? t(
            `目标「${goals.find((g) => g.id === id)?.title ?? id}」`,
            `goal “${goals.find((g) => g.id === id)?.title ?? id}”`,
          )
        : kind === "l"
          ? t(`「${title(id)}」${rest.split("#")[0]} 的日志`, `“${title(id)}” log, ${rest.split("#")[0]}`)
          : kind === "n"
            ? t(`「${title(id)}」的下一步`, `“${title(id)}” next step`)
            : kind === "d"
              ? t("你在探索的方向", "a direction you're exploring")
              : t(`项目「${title(id)}」`, `project “${title(id)}”`);
    return (
      <span className={css.meta}>
        {" "}
        {t("依据", "From")} {place}：「{quote}」
      </span>
    );
  };
  return (
    <section className={css.map} aria-label={t("我在推进什么", "What I'm moving forward")}>
      {header}
      {state.stale && (
        <output className={css.stale}>
          {t(
            "这之后你的目标或项目有变化：卡片已按现在的资料画，对不上的看法已撤下。想更新就点「重新看一遍」。",
            "Your goals or projects changed since then. Cards show your current notes and views that no longer match were removed. Choose “Look again” to refresh.",
          )}
        </output>
      )}
      {failure && (
        <p className={css.error} role="alert">
          {failure}
        </p>
      )}
      <div className={css.board} ref={board}>
        <svg className={css.lines} aria-hidden="true">
          {paths.map((path) => (
            <path
              key={path.d}
              d={path.d}
              fill="none"
              stroke={`var(${path.tone})`}
              strokeWidth="1.6"
              strokeDasharray={path.dashed ? "5 5" : undefined}
            />
          ))}
        </svg>
        <div className={css.col}>
          <h3>{t("想达成", "Want to reach")}</h3>
          {goals.length === 0 && <p className={css.quiet}>{t("还没写下目标", "No goals written yet")}</p>}
          {goals.map((goal) => (
            <div
              key={goal.id}
              data-node={`goal:${goal.id}`}
              className={css.goal}
              style={{ ["--tone" as string]: `var(${toneOf(goal.id)})` }}
            >
              <strong>{goal.title}</strong>
              {goal.why && <p>{goal.why}</p>}
            </div>
          ))}
          {!!input?.directions.length && (
            <>
              <h3>{t("也在探索", "Also exploring")}</h3>
              {input.directions.map((direction) => (
                <div key={direction.id} className={`${css.card} ${css.direction}`}>
                  <strong>{direction.title}</strong>
                  {direction.status === "paused" && (
                    <span className={css.meta}> · {t("先放一放", "Paused")}</span>
                  )}
                  {direction.motivation && <p>{direction.motivation}</p>}
                </div>
              ))}
            </>
          )}
        </div>
        <div className={css.col}>
          <h3>{t("正在做", "Working on")}</h3>
          {projects.map((project) => {
            const recent = last(project.slug);
            const own = links.filter((link) => link.project === project.slug);
            const loose = map.unlinked.find((row) => row.project === project.slug);
            return (
              <div key={project.slug} data-node={`project:${project.slug}`} className={css.card}>
                <button type="button" className={css.title} onClick={() => openProject(project.slug)}>
                  {project.title}
                </button>
                {recent ? (
                  <p>
                    {t("最近：", "Latest: ")}
                    {recent.text.split("\n")[0]?.replace(/^[-*]\s+/, "")}
                    <span className={css.meta}> · {recent.date}</span>
                  </p>
                ) : (
                  <p className={css.meta}>{t("最近 30 天没有记录", "No log in the last 30 days")}</p>
                )}
                {own.map((link) => (
                  <p key={link.goal} className={css.why}>
                    {t("开图觉得它在帮", "Kaitu thinks it helps")}「
                    {goals.find((g) => g.id === link.goal)?.title}」：
                    {link.reason}
                    {from(link)}
                    <button
                      type="button"
                      className={css.link}
                      onClick={() => void dismiss(link.goal, link.project).then(setState)}
                    >
                      {t("不对", "Not right")}
                    </button>
                  </p>
                ))}
                {!own.length && loose && <p className={css.why}>{loose.note}</p>}
              </div>
            );
          })}
        </div>
        <div className={css.col}>
          <h3>{t("下一步", "Next")}</h3>
          {state.next.map((step) => (
            <div
              key={step.project}
              data-node={`next:${step.project}`}
              className={step.kind === "todo" ? css.card : `${css.card} ${css.suggested}`}
            >
              <strong>{step.text || t("还没有下一步", "No next step yet")}</strong>
              <p className={css.meta}>
                {step.kind === "todo"
                  ? t(`来自「${title(step.project)}」的下一步`, `From “${title(step.project)}”`)
                  : step.kind === "proposed"
                    ? t(
                        `待你采纳的建议 · ${title(step.project)}`,
                        `Suggestion waiting for you · ${title(step.project)}`,
                      )
                    : step.kind === "suggested"
                      ? t(`开图建议 · ${title(step.project)}`, `Suggested by Kaitu · ${title(step.project)}`)
                      : t(
                          `给「${title(step.project)}」定一个小动作`,
                          `Pick a small step for “${title(step.project)}”`,
                        )}
              </p>
            </div>
          ))}
        </div>
      </div>
      {!!map.mentor.length && (
        <div className={css.mentor}>
          <h3>{t("开图想跟你说", "From Kaitu")}</h3>
          {map.mentor.map((item) => (
            <p key={item.text}>
              {item.text}
              {item.evidence[0] && from(item.evidence[0])}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
