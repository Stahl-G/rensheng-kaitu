import type { DirectionMapState } from "@kaitu/core";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import css from "./DirectionMap.module.css";
import { useLocale, useT } from "./i18n.js";

// 目标的颜色按顺序取模块色；颜色只用来分组，不代表含义。
const tones = ["--doing", "--me", "--health", "--news", "--finance"] as const;

/**
 * 方向页的「我在推进什么」：点一下让已连接的 AI 读目标、项目和日志，
 * 按固定样子画出 想达成 → 正在做 → 下一步，再附几句导师式的建议。
 * 连线是开图的看法，每条都带原文依据，用户可以点「不对」去掉。
 */
export function DirectionMap({
  load,
  generate,
  dismiss,
  onConnect,
  openProject,
}: {
  load: () => Promise<DirectionMapState>;
  generate: () => Promise<DirectionMapState>;
  dismiss: (goal: string, project: string) => Promise<DirectionMapState>;
  onConnect?: () => void;
  openProject: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [state, setState] = useState<DirectionMapState | null>(null);
  const [error, setError] = useState("");
  const board = useRef<HTMLDivElement>(null);
  const [paths, setPaths] = useState<{ d: string; tone: string; dashed: boolean }[]>([]);
  const refresh = useCallback(() => {
    void load()
      .then(setState)
      .catch(() => {});
  }, [load]);
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
      setState(await generate());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  const map = state?.map;
  const input = state?.input;
  const links = (map?.links ?? []).filter(
    (link) => !state?.dismissed.includes(`${link.goal}|${link.project}`),
  );
  const goals = input?.goals ?? [];
  const toneOf = (goal: string): string =>
    tones[
      Math.max(
        0,
        goals.findIndex((g) => g.id === goal),
      ) % tones.length
    ] ?? "--doing";
  // 连线跟着卡片的实际位置画；窗口变窄时卡片上下排，线不画，理由仍写在项目卡里。
  // biome-ignore lint/correctness/useExhaustiveDependencies: links 和颜色都由 map 与「不对」算出，只在它们变化时重画。
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
      for (const step of map.next) {
        const a = at(`project:${step.project}`, "r");
        const b = at(`next:${step.project}`, "l");
        if (a && b) next.push({ d: curve(a, b), tone: "--line-strong", dashed: false });
      }
      setPaths(next);
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(root);
    return () => observer.disconnect();
  }, [map, state?.dismissed]);

  if (!state) return null;
  const header = (
    <div className={css.lens}>
      <span>
        <b>{t("开图的看法", "Kaitu's view")}</b>
        {state.generatedAt &&
          t(
            ` · ${new Date(state.generatedAt).toLocaleDateString(locale)} 根据 ${goals.length} 个目标、${input?.projects.length ?? 0} 个项目最近 30 天的记录整理`,
            ` · ${new Date(state.generatedAt).toLocaleDateString(locale)}, from ${goals.length} goals and ${input?.projects.length ?? 0} projects over the last 30 days`,
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
            {/AI_NOT_CONFIGURED|连上 AI/.test(failure) && onConnect && (
              <button type="button" className={css.link} onClick={onConnect}>
                {t("去连接 AI", "Connect AI")}
              </button>
            )}
          </p>
        )}
      </section>
    );
  const projects = input?.projects ?? [];
  const title = (slug: string) => projects.find((p) => p.slug === slug)?.title ?? slug;
  const last = (slug: string) => projects.find((p) => p.slug === slug)?.logs[0];
  return (
    <section className={css.map} aria-label={t("我在推进什么", "What I'm moving forward")}>
      {header}
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
        </div>
        <div className={css.col}>
          <h3>{t("正在做", "Working on")}</h3>
          {projects.map((project) => {
            const recent = last(project.slug);
            const own = links.filter((link) => link.project === project.slug);
            const loose = map.unlinked.find((row) => row.project === project.slug);
            return (
              <div key={project.slug} data-node={`project:${project.slug}`} className={css.card}>
                <button type="button" className={css.title} onClick={openProject}>
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
                    <span className={css.meta}>
                      {" "}
                      {t("依据", "From")}「{link.quote}」
                    </span>
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
          {map.next.map((step) => (
            <div
              key={step.project}
              data-node={`next:${step.project}`}
              className={step.text && !step.suggested ? css.card : `${css.card} ${css.suggested}`}
            >
              <strong>{step.text || t("还没有下一步", "No next step yet")}</strong>
              <p className={css.meta}>
                {step.suggested
                  ? step.text
                    ? t(`开图建议 · ${title(step.project)}`, `Suggested by Kaitu · ${title(step.project)}`)
                    : t(
                        `给「${title(step.project)}」定一个小动作`,
                        `Pick a small step for “${title(step.project)}”`,
                      )
                  : t(`来自「${title(step.project)}」的下一步`, `From “${title(step.project)}”`)}
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
              <span className={css.meta}>
                {" "}
                {t("依据", "From")}「{item.evidence[0]}」
              </span>
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
