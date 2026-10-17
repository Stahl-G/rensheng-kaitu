import type { Direction, ExplorationExperiment } from "./exploration.js";
import type { readOverviewPage } from "./overview-page.js";
import type { PlansData } from "./plans.js";
type OverviewProject = Pick<
  Awaited<ReturnType<typeof readOverviewPage>>["projects"][number],
  "slug" | "title" | "next" | "daily"
>;
type ExplorationData = { directions: Direction[]; experiments: ExplorationExperiment[] };

/** 进度图下半张的一行：左边是已经记下的，右边是接下来的。线型只按资料里有没有来定，不估算比例。 */
export interface ProgressRow {
  id: string;
  kind: "goal" | "project" | "direction";
  title: string;
  /** 已有记录（结果、写作或提交、完成的尝试）画实线，没有就空着。 */
  done: boolean;
  /** 有下一步或进行中的尝试画虚线，还没探索的画点线。 */
  ahead: "planned" | "unexplored";
  next: string | null;
  results: number;
  suggested: boolean;
}

export function progressRows(
  plans: PlansData | undefined,
  projects: OverviewProject[],
  exploration: Pick<ExplorationData, "directions" | "experiments"> | null,
): ProgressRow[] {
  const goals: ProgressRow[] = (plans?.goals ?? []).map((goal) => ({
    id: goal.id,
    kind: "goal",
    title: goal.title,
    done: goal.results > 0,
    ahead: goal.next ? "planned" : "unexplored",
    next: goal.next?.title ?? null,
    results: goal.results,
    suggested: false,
  }));
  const work: ProgressRow[] = projects.map((project) => {
    const active = project.daily.some((day) => (day.words ?? 0) > 0 || (day.commits ?? 0) > 0);
    return {
      id: project.slug,
      kind: "project",
      title: project.title,
      done: active,
      ahead: project.next.length ? "planned" : "unexplored",
      next: project.next[0] ?? null,
      results: 0,
      suggested: false,
    };
  });
  const experiments = exploration?.experiments ?? [];
  const directions: ProgressRow[] = (exploration?.directions ?? [])
    // 暂停、归档和忽略的方向不在「接下来往哪走」里。
    .filter((direction) => direction.status === "active" || direction.status === "suggested")
    .sort((a, b) => Number(a.status === "suggested") - Number(b.status === "suggested"))
    .map((direction) => {
      const own = experiments.filter((item) => item.direction_id === direction.id);
      const current = own.find((item) => item.status === "active" || item.status === "planned");
      const completed = own.filter((item) => item.status === "completed").length;
      const suggested = direction.status === "suggested";
      return {
        id: direction.id,
        kind: "direction",
        title: direction.title,
        done: completed > 0,
        ahead: !suggested && current ? "planned" : "unexplored",
        next: suggested ? null : (current?.action ?? null),
        results: completed,
        suggested,
      };
    });
  return [...goals, ...work, ...directions];
}
