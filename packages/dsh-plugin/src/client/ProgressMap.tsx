import type { PlansData } from "@kaitu/core";
import { Map as LibreMap, LngLatBounds, Marker, setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerSource from "maplibre-gl/dist/maplibre-gl-worker.mjs";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ExplorationData, LifeMapData, OverviewProject } from "../types.js";
import css from "./ProgressMap.module.css";
import { useT } from "./i18n.js";
import { atlasStyle, journeyRoutes } from "./life-map-visuals.js";
import { type ProgressRow, progressRows } from "./progress-map.js";

export interface ProgressMapProps {
  plans: PlansData | undefined;
  projects: OverviewProject[];
  loadLifeMap: () => Promise<LifeMapData>;
  loadExploration: () => Promise<ExplorationData>;
  subscribe?: (refresh: () => void) => () => void;
  open: (section: "footprints" | "directions" | "projects" | "plans") => void;
}

const COLLAPSED = "kaitu.progress-map.collapsed";
let workerReady = false;
const MAX_ROWS = 6;

/**
 * 开图顶上的人生进度图：上半是去过的地方（与足迹同一张底图和路线规则），下半是接下来往哪走。
 * 两半共用线型：实线已经走过，虚线计划或在试，点线还没探索。地点和方向分开画，只在点开时跳到各自的页面。
 */
export function ProgressMap(props: ProgressMapProps) {
  const t = useT();
  const { loadLifeMap, loadExploration, subscribe } = props;
  const [places, setPlaces] = useState<LifeMapData | null>(null);
  const [exploration, setExploration] = useState<ExplorationData | null>(null);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSED) === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    let alive = true;
    const load = () => {
      void loadLifeMap()
        .then((data) => alive && setPlaces(data))
        .catch(() => {});
      void loadExploration()
        .then((data) => alive && setExploration(data))
        .catch(() => {});
    };
    load();
    const unsubscribe = subscribe?.(load);
    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, [loadLifeMap, loadExploration, subscribe]);
  const rows = useMemo(
    () => progressRows(props.plans, props.projects, exploration),
    [props.plans, props.projects, exploration],
  );
  const cities = useMemo(
    () => (places?.features ?? []).filter((feature) => feature.properties.place.precision === "city"),
    [places],
  );
  // 没有地点也没有任何方向、目标和项目时不铺空图。
  if (!cities.length && !rows.length) return null;
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED, next ? "1" : "0");
    } catch {}
  };
  const shown = rows.slice(0, MAX_ROWS);
  return (
    <section className={css.card} aria-labelledby="progress-map-title">
      <div className={css.head}>
        <h2 id="progress-map-title">{t("人生进度图", "Life progress map")}</h2>
        <button type="button" className={css.toggle} aria-expanded={!collapsed} onClick={toggle}>
          {collapsed ? t("展开", "Show") : t("收起", "Hide")}
        </button>
      </div>
      {!collapsed && (
        <>
          {cities.length > 0 && places && (
            <>
              <h3 className={css.sub}>{t("去过的地方", "Where I've been")}</h3>
              <PlacesMap data={places} onOpen={() => props.open("footprints")} />
            </>
          )}
          {shown.length > 0 && (
            <>
              <h3 className={css.sub}>{t("接下来往哪走", "Where to go next")}</h3>
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
            </>
          )}
          <ul className={css.legend} aria-hidden="true">
            <li>
              <i className={css.solid} />
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
        </>
      )}
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
      onClick={() => open(row.kind === "goal" ? "plans" : row.kind === "project" ? "projects" : "directions")}
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

function PlacesMap({ data, onOpen }: { data: LifeMapData; onOpen: () => void }) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const cities = data.features.filter((feature) => feature.properties.place.precision === "city");
  const now = cities.find((feature) => feature.properties.layer === "now");
  const hometown = data.hometown?.status === "ready" ? data.hometown.place : undefined;
  const walked = useMemo(
    () => journeyRoutes(data.experiences, data.asOf, hometown),
    [data.experiences, data.asOf, hometown],
  );
  const planned = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: now
        ? cities
            .filter((feature) => feature.properties.layer === "planned")
            .map((feature) => ({
              type: "Feature" as const,
              properties: {},
              geometry: {
                type: "LineString" as const,
                coordinates: [now.geometry.coordinates, feature.geometry.coordinates],
              },
            }))
        : [],
    }),
    [cities, now],
  );
  // 按内容而不是对象身份决定是否重画：资料刷新、父组件重渲染都不重建地图。
  const key = JSON.stringify([
    hometown?.geonameid,
    cities.map((f) => [f.properties.place.name, f.properties.layer]),
    walked,
    planned,
  ]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: key 已包含城市、家乡、层和两种路线。
  useEffect(() => {
    const container = box.current;
    if (!container || !cities.length) return;
    let map: LibreMap | undefined;
    let observer: MutationObserver | undefined;
    const markers: Marker[] = [];
    const themeRoot = container.closest("[data-theme]") ?? document.body;
    const dark = () => {
      const theme = themeRoot.getAttribute("data-theme");
      return theme === "dark" || (!theme && document.body.hasAttribute("data-ds-dark-theme"));
    };
    const timer = setTimeout(() => {
      setFailed(true);
      map?.remove();
      map = undefined;
    }, 8000);
    try {
      // 足迹页也会设置；开图默认停在健康时足迹页还没挂载，这里先设好。
      if (!workerReady) {
        setWorkerUrl(URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" })));
        workerReady = true;
      }
      map = new LibreMap({
        container,
        interactive: false,
        attributionControl: {
          compact: true,
          customAttribution:
            '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap</a>',
        },
      });
      const m = map;
      m.on("style.load", () => {
        clearTimeout(timer);
        const ink = getComputedStyle(container).getPropertyValue("--pm-ink").trim();
        const plan = getComputedStyle(container).getPropertyValue("--pm-plan").trim();
        m.addSource("walked", { type: "geojson", data: walked });
        m.addLayer({
          id: "walked",
          type: "line",
          source: "walked",
          paint: { "line-color": ink, "line-width": 2.5, "line-opacity": 0.85 },
          layout: { "line-cap": "round", "line-join": "round" },
        });
        m.addSource("planned", { type: "geojson", data: planned });
        m.addLayer({
          id: "planned",
          type: "line",
          source: "planned",
          paint: { "line-color": plan, "line-width": 2.5, "line-dasharray": [2, 2] },
          layout: { "line-cap": "round" },
        });
      });
      if (
        hometown?.lng !== undefined &&
        hometown.lat !== undefined &&
        !cities.some((f) => f.properties.place.geonameid === hometown.geonameid)
      ) {
        const element = document.createElement("span");
        element.className = `${css.city} ${css.been}`;
        element.textContent = hometown.name;
        markers.push(
          new Marker({ element, anchor: "left" }).setLngLat([hometown.lng, hometown.lat]).addTo(m),
        );
      }
      for (const feature of cities) {
        const element = document.createElement("span");
        element.className = `${css.city} ${css[feature.properties.layer]}`;
        element.textContent = feature.properties.place.name;
        markers.push(
          new Marker({ element, anchor: "left" }).setLngLat(feature.geometry.coordinates).addTo(m),
        );
      }
      const bounds = new LngLatBounds();
      for (const feature of cities) bounds.extend(feature.geometry.coordinates);
      if (hometown?.lng !== undefined && hometown.lat !== undefined)
        bounds.extend([hometown.lng, hometown.lat]);
      m.fitBounds(bounds, { padding: { top: 36, bottom: 36, left: 36, right: 96 }, maxZoom: 6, duration: 0 });
      const applyStyle = () =>
        m.setStyle(`https://tiles.openfreemap.org/styles/${dark() ? "dark" : "positron"}`, {
          diff: false,
          transformStyle: (_previous, next) => {
            const theme = getComputedStyle(container);
            const value = (name: string) => theme.getPropertyValue(name).trim();
            return atlasStyle(next, {
              water: value("--atlas-water"),
              land: value("--atlas-land"),
              border: value("--atlas-border"),
              muted: value("--atlas-muted"),
              green: value("--atlas-green"),
            });
          },
        });
      applyStyle();
      observer = new MutationObserver(() => map && applyStyle());
      observer.observe(document.body, { attributes: true, attributeFilter: ["data-ds-dark-theme"] });
      if (themeRoot !== document.body)
        observer.observe(themeRoot, { attributes: true, attributeFilter: ["data-theme"] });
    } catch {
      clearTimeout(timer);
      setFailed(true);
    }
    return () => {
      clearTimeout(timer);
      observer?.disconnect();
      for (const marker of markers) marker.remove();
      map?.remove();
    };
  }, [key]);
  const route = [
    ...(hometown && !cities.some((f) => f.properties.place.geonameid === hometown.geonameid)
      ? [hometown.name]
      : []),
    ...cities
      .filter((feature) => feature.properties.layer !== "planned")
      .map((feature) => feature.properties.place.name),
  ];
  const plans = cities
    .filter((feature) => feature.properties.layer === "planned")
    .map((f) => f.properties.place.name);
  return (
    <div className={failed ? `${css.map} ${css.mapFailed}` : css.map}>
      {failed ? (
        <p className={css.fallback}>
          {route.join(" · ")}
          {plans.length > 0 && ` ⇢ ${plans.join(" · ")}`}
        </p>
      ) : (
        <div ref={box} className={css.canvas} />
      )}
      <button type="button" className={css.mapLink} onClick={onOpen}>
        {t("在足迹里看", "Open in Footprints")}
      </button>
    </div>
  );
}
