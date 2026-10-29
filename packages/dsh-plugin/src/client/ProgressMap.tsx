import type { PlansData } from "@kaitu/core";
import { useEffect, useMemo, useState } from "react";
import type { ExplorationData, OverviewProject } from "../types.js";
import css from "./ProgressMap.module.css";
import { useT } from "./i18n.js";
import { type ProgressRow, type RecordTarget, progressRows } from "./progress-map.js";

export interface ProgressMapProps {
  plans: PlansData | undefined;
  projects: OverviewProject[];
  loadExploration: () => Promise<ExplorationData>;
  subscribe?: (refresh: () => void) => () => void;
  open: (target: RecordTarget) => void;
}

const MAX_ROWS = 6;

/**
 * 足迹页里的人生进度图：接下来往哪走。去过的地方就是足迹页的地图，这里不再画一张。
 * 线型：实线已经走过，虚线计划或在试，点线还没探索。
 */
export function ProgressMap(props: ProgressMapProps) {
  const t = useT();
  const { loadExploration, subscribe } = props;
  const [exploration, setExploration] = useState<ExplorationData | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      void loadExploration()
        .then((data) => alive && setExploration(data))
        .catch(() => {});
    load();
    const unsubscribe = subscribe?.(load);
    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, [loadExploration, subscribe]);
  const rows = useMemo(
    () => progressRows(props.plans, props.projects, exploration),
    [props.plans, props.projects, exploration],
  );
  if (!rows.length) return null;
  const shown = rows.slice(0, MAX_ROWS);
  return (
    <section className={css.card} aria-labelledby="progress-map-title">
      <h2 id="progress-map-title">{t("人生进度图", "Life progress map")}</h2>
      <div className={css.rows}>
        {shown.map((row) => (
          <Row key={`${row.kind}:${row.id}`} row={row} open={props.open} />
        ))}
        <span className={css.nowLine} aria-hidden="true">
          <span>{t("现在", "Now")}</span>
        </span>
      </div>
      {rows.length > shown.length && (
        <p className={css.more}>
          {t(`还有 ${rows.length - shown.length} 项`, `${rows.length - shown.length} more`)}
        </p>
      )}
      <ul className={css.legend} aria-hidden="true">
        <li>
          <i />
          {t("已经走过", "Done")}
        </li>
        <li>
          <i className={css.dashed} />
          {t("计划或在试", "Planned or trying")}
        </li>
        <li>
          <i className={css.dotted} />
          {t("还没探索", "Unexplored")}
        </li>
      </ul>
    </section>
  );
}

function Row({ row, open }: { row: ProgressRow; open: ProgressMapProps["open"] }) {
  const t = useT();
  const type =
    row.kind === "goal"
      ? t("目标", "Goal")
      : row.kind === "project"
        ? t("项目", "Project")
        : row.suggested
          ? t("AI 建议", "Suggested")
          : t("方向", "Direction");
  const status = row.suggested
    ? t("还没探索", "Not explored yet")
    : row.next
      ? `${t("下一步：", "Next: ")}${row.next}`
      : t("还没定下一步", "No next step yet");
  return (
    <button
      type="button"
      className={`${css.row} ${css[row.kind]}`}
      onClick={() => open({ kind: row.kind, id: row.id })}
      title={status}
    >
      <span className={css.label}>
        <span className={css.type}>{type}</span>
        <span className={css.title}>{row.title}</span>
      </span>
      <span className={css.track} aria-label={status}>
        <span className={row.done ? css.pastDone : css.pastEmpty} />
        <span className={row.ahead === "planned" ? css.ahead : css.aheadFog} />
      </span>
    </button>
  );
}
