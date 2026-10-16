import {
  experienceInterval,
  experienceLayer,
  experienceOverlaps,
  experienceYears,
} from "@kaitu/core/experience-time";
import { type GeoJSONSource, Map as LibreMap, LngLatBounds, setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerSource from "maplibre-gl/dist/maplibre-gl-worker.mjs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Experience, ExperienceChanges, LifeMapData } from "../types.js";
import { ExperienceEditor } from "./ExperienceEditor.js";
import { type ExperienceImportControlProps, ExperienceImportControls } from "./ExperienceImportControls.js";
import css from "./MapPage.module.css";
import { SourceEvidence } from "./SourceEvidence.js";
import { atlasStyle, cityKey, journeyRoutes } from "./life-map-visuals.js";

export interface MapPageProps extends ExperienceImportControlProps {
  subscribe?: (refresh: () => void) => () => void;
  loadExperienceSource: (id: string) => Promise<import("../types.js").ExperienceSource>;
  loadLifeMap: () => Promise<LifeMapData>;
  resolveExperience: (id: string, geonameid: number) => Promise<unknown>;
  editExperience: (id: string, changes: ExperienceChanges, revision: number) => Promise<void>;
  hideExperience: (id: string, revision: number) => Promise<number>;
  unhideExperience: (id: string, revision: number) => Promise<void>;
  onPrompt: (text: string) => void;
}
type Layer = LifeMapData["features"][number]["properties"]["layer"];
type CityGroup = {
  id: string;
  place: Experience["place"];
  experiences: Experience[];
  layers: Layer[];
  home?: boolean;
};
const layers: { id: Layer; name: string }[] = [
  { id: "been", name: "走过的地方" },
  { id: "now", name: "现在的生活" },
  { id: "planned", name: "计划与机会" },
];
const eventTypes = {
  lived: "住过",
  worked: "工作",
  studied: "读书",
  travel: "旅行",
  visit: "到访",
  other: "其他",
};
const statuses = {
  observed: "已记录",
  user_reported: "你说的",
  inferred: "AI 推测",
  planned: "计划",
  suggested: "建议",
};
const homePrompt =
  "请用 build-life-map 技能，从我的档案、记忆和对话识别家乡，列出原文依据，必要时向我核对。确认后在 me/profile.md 基本情况中维护一条家乡：城市名，保留其他内容。没有依据不要猜，不把籍贯、出生地或当前居住地直接当家乡。";
const prompt = `${homePrompt}然后整理去过和住过的城市；间接推断和计划保持待核对，不补造日期。`;
const cityId = cityKey;
function dateLabel(value: string | undefined, precision: Experience["time_precision"]) {
  if (!value || precision === "unknown") return "暂无记录";
  const [year, month, day] = value.split("-");
  if (precision === "year" || !month) return year;
  return `${year} 年 ${Number(month)} 月${precision === "day" && day ? ` ${Number(day)} 日` : ""}`;
}
function ExperienceDetails({
  item,
  onPrompt,
  save,
  hide,
  asOf,
  loadSource,
}: {
  item: Experience;
  asOf: string;
  loadSource: MapPageProps["loadExperienceSource"];
  onPrompt: MapPageProps["onPrompt"];
  save: (item: Experience, changes: ExperienceChanges) => Promise<void>;
  hide: (item: Experience) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmHide, setConfirmHide] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <article className={css.experience}>
      <div className={css.experienceHeading}>
        <strong>{item.title || eventTypes[item.event_type]}</strong>
        <span className={css.status} data-status={item.fact_status}>
          {statuses[item.fact_status]}
        </span>
      </div>
      <p className={css.secondary}>
        {eventTypes[item.event_type]} · {dateLabel(item.start, item.time_precision)}
        {item.end
          ? ` – ${dateLabel(item.end, item.time_precision)}`
          : experienceLayer(item, asOf) === "now"
            ? " – 至今"
            : ""}
      </p>
      {item.notes && <p className={css.notes}>{item.notes}</p>}
      <p className={css.source}>来源：{item.source || "暂无记录"}</p>
      <SourceEvidence id={item.id} load={loadSource} />
      {editing ? (
        <ExperienceEditor
          item={item}
          save={async (changes) => {
            await save(item, changes);
            setEditing(false);
          }}
          cancel={() => setEditing(false)}
        />
      ) : (
        <div className={css.actions}>
          <button type="button" className={css.link} onClick={() => setEditing(true)}>
            修正经历
          </button>
          <button type="button" className={css.link} onClick={() => setConfirmHide(true)}>
            隐藏
          </button>
        </div>
      )}
      {confirmHide && (
        <div className={css.notice}>
          <p>隐藏这段经历？之后可撤销，旧来源同步不会重新添加。</p>
          <div className={css.actions}>
            <button
              type="button"
              className={css.control}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await hide(item);
                } catch (err) {
                  setError(err instanceof Error ? err.message : String(err));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "隐藏中…" : "确认隐藏"}
            </button>
            <button
              type="button"
              className={css.control}
              disabled={busy}
              onClick={() => setConfirmHide(false)}
            >
              保留
            </button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className={css.formError}>
          {error}
        </p>
      )}
      <button
        type="button"
        className={css.link}
        onClick={() =>
          onPrompt(`帮我核对并修改「${item.place.name}」的这段经历（${item.id}），先和我确认地点、时间和分类`)
        }
      >
        请开图协助核对
      </button>
    </article>
  );
}

function markerImage(ids: Layer[], ink: string, paper: string, home = false) {
  const canvas = document.createElement("canvas");
  canvas.width = (home ? 1 : ids.length) * 48;
  canvas.height = 48;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.scale(2, 2);
  if (home) {
    context.fillStyle = ink;
    context.strokeStyle = paper;
    context.lineWidth = 2;
    context.beginPath();
    context.arc(12, 12, 10, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.beginPath();
    context.moveTo(6, 12);
    context.lineTo(12, 6);
    context.lineTo(18, 12);
    context.moveTo(8, 11);
    context.lineTo(8, 18);
    context.lineTo(16, 18);
    context.lineTo(16, 11);
    context.moveTo(11, 18);
    context.lineTo(11, 13);
    context.lineTo(13, 13);
    context.lineTo(13, 18);
    context.lineWidth = 1.5;
    context.stroke();
  }
  ids.forEach((id, i) => {
    const x = i * 24 + 12;
    context.strokeStyle = paper;
    context.lineWidth = 4;
    context.setLineDash([]);
    context.beginPath();
    context.arc(x, 12, 8, 0, Math.PI * 2);
    context.stroke();
    context.strokeStyle = ink;
    context.fillStyle = ink;
    context.lineWidth = 2;
    context.setLineDash(id === "planned" ? [3, 2] : []);
    context.beginPath();
    context.arc(x, 12, id === "been" ? 6 : 8, 0, Math.PI * 2);
    if (id === "been") context.fill();
    else context.stroke();
    if (id === "now") {
      context.beginPath();
      context.arc(x, 12, 3, 0, Math.PI * 2);
      context.fill();
    }
  });
  return context.getImageData(0, 0, canvas.width, canvas.height);
}
function CityMap({
  cities,
  selected,
  onSelect,
  onShowList,
  showRoutes,
  home,
  asOf,
}: {
  cities: CityGroup[];
  selected: string | null;
  onSelect: (id: string) => void;
  onShowList: () => void;
  showRoutes: boolean;
  home?: Experience["place"];
  asOf: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<LibreMap | null>(null);
  const latest = useRef({ cities, onSelect, selected });
  latest.current = { cities, onSelect, selected };
  const fitted = useRef(false);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const geojson = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: cities
        .filter(
          (city) =>
            (city.layers.length || city.home) &&
            city.place.precision === "city" &&
            city.place.lng !== undefined &&
            city.place.lat !== undefined,
        )
        .map((city) => ({
          type: "Feature" as const,
          geometry: {
            type: "Point" as const,
            coordinates: [city.place.lng as number, city.place.lat as number] as [number, number],
          },
          properties: {
            id: city.id,
            name: city.place.name,
            home: !!city.home,
            icon: city.home
              ? "home"
              : city.layers.includes("now")
                ? "now"
                : city.layers.includes("been")
                  ? "been"
                  : "planned",
          },
        })),
    }),
    [cities],
  );
  const routes = useMemo(
    () =>
      showRoutes && home
        ? journeyRoutes(
            cities.flatMap((city) => city.experiences),
            asOf,
            home,
          )
        : { type: "FeatureCollection" as const, features: [] },
    [cities, asOf, home, showRoutes],
  );
  const latestRoutes = useRef(routes);
  latestRoutes.current = routes;
  const fitCities = useCallback((duration = 600) => {
    const instance = map.current;
    if (!instance) return;
    const points = latestGeojson.current.features;
    if (!points.length) {
      instance.fitBounds(
        [
          [-180, -60],
          [180, 80],
        ],
        { padding: 24, duration },
      );
      return;
    }
    const bounds = new LngLatBounds();
    const longitudes = points
      .map((point) => (point.geometry.coordinates[0] + 360) % 360)
      .sort((a, b) => a - b);
    let start = longitudes[0] ?? 0;
    let largestGap = -1;
    for (let i = 0; i < longitudes.length; i++) {
      const current = longitudes[i] as number;
      const next =
        (longitudes[(i + 1) % longitudes.length] as number) + (i === longitudes.length - 1 ? 360 : 0);
      if (next - current > largestGap) {
        largestGap = next - current;
        start = next % 360;
      }
    }
    for (const point of points) {
      let longitude = (point.geometry.coordinates[0] + 360) % 360;
      if (longitude < start) longitude += 360;
      bounds.extend([longitude, point.geometry.coordinates[1]]);
    }
    instance.fitBounds(bounds, { padding: 64, maxZoom: 5, duration });
    fitted.current = true;
  }, []);
  const latestGeojson = useRef(geojson);
  latestGeojson.current = geojson;
  useEffect(() => {
    if (!container.current) return;
    const workerUrl = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
    setWorkerUrl(workerUrl);
    let instance: LibreMap | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const waitForMap = () => {
      setState("loading");
      clearTimeout(timer);
      timer = setTimeout(() => setState("failed"), 8000);
    };
    const themeRoot = container.current.closest("[data-theme]") ?? document.body;
    const styleTransform = (_previous: unknown, next: Parameters<typeof atlasStyle>[0]) => {
      const theme = getComputedStyle(container.current as HTMLDivElement);
      const value = (name: string) => theme.getPropertyValue(name).trim();
      return atlasStyle(next, {
        water: value("--atlas-water"),
        land: value("--atlas-land"),
        border: value("--atlas-border"),
        muted: value("--atlas-muted"),
        green: value("--atlas-green"),
      });
    };
    const styleUrl = () => {
      const theme = themeRoot.getAttribute("data-theme");
      const dark = theme === "dark" || (!theme && document.body.hasAttribute("data-ds-dark-theme"));
      return `https://tiles.openfreemap.org/styles/${dark ? "dark" : "positron"}`;
    };
    try {
      instance = new LibreMap({
        container: container.current,
        center: [20, 25],
        zoom: 1,
        cooperativeGestures: false,
        attributionControl: {
          compact: true,
          customAttribution:
            '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap</a>',
        },
        locale: {
          "NavigationControl.ZoomIn": "放大",
          "NavigationControl.ZoomOut": "缩小",
          "AttributionControl.ToggleAttribution": "显示地图署名",
          "Map.Title": "城市地图",
          "CooperativeGesturesHandler.WindowsHelpText": "按住 Ctrl 并滚动以缩放地图",
          "CooperativeGesturesHandler.MacHelpText": "按住 ⌘ 并滚动以缩放地图",
          "CooperativeGesturesHandler.MobileHelpText": "使用双指移动地图",
        },
      });
      map.current = instance;
      fitted.current = false;
      const m = instance;
      waitForMap();
      m.on("style.load", () => {
        const theme = getComputedStyle(container.current as HTMLDivElement);
        const ink = theme.getPropertyValue("--kt-map").trim();
        const paper = theme.getPropertyValue("--kt-card").trim();
        const text = theme.getPropertyValue("--kt-text").trim();
        const house = markerImage([], ink, paper, true);
        if (house) m.addImage("home", house, { pixelRatio: 2 });
        for (let mask = 1; mask < 8; mask++) {
          const ids = layers.filter((_, i) => mask & (1 << i)).map((layer) => layer.id);
          const image = markerImage(ids, ink, paper);
          if (image) m.addImage(ids.join("-"), image, { pixelRatio: 2 });
        }
        m.addSource("experience-order", { type: "geojson", data: latestRoutes.current });
        m.addLayer({
          id: "experience-order",
          type: "line",
          source: "experience-order",
          paint: {
            "line-color": ink,
            "line-width": ["interpolate", ["linear"], ["zoom"], 1, 1.5, 6, 2.5],
            "line-opacity": 0.8,
          },
          layout: { "line-cap": "round", "line-join": "round" },
        });
        m.addSource("cities", {
          type: "geojson",
          data: latestGeojson.current,
          cluster: true,
          clusterRadius: 48,
          clusterMaxZoom: 10,
        });
        m.addLayer({
          id: "clusters",
          type: "circle",
          source: "cities",
          filter: ["has", "point_count"],
          paint: {
            "circle-color": ink,
            "circle-radius": 18,
            "circle-stroke-color": paper,
            "circle-stroke-width": 2,
          },
        });
        m.addLayer({
          id: "counts",
          type: "symbol",
          source: "cities",
          filter: ["has", "point_count"],
          layout: {
            "text-field": ["get", "point_count_abbreviated"],
            "text-size": 13,
          },
          paint: { "text-color": paper },
        });
        m.addLayer({
          id: "selected-city",
          type: "circle",
          source: "cities",
          filter: ["==", ["get", "id"], latest.current.selected ?? ""],
          paint: {
            "circle-radius": 20,
            "circle-color": ink,
            "circle-opacity": 0.13,
            "circle-stroke-color": ink,
            "circle-stroke-width": 1,
          },
        });
        m.addLayer({
          id: "places",
          type: "symbol",
          source: "cities",
          filter: ["!", ["has", "point_count"]],
          layout: {
            "icon-image": ["get", "icon"],
            "icon-allow-overlap": false,
            "symbol-sort-key": ["case", ["get", "home"], 0, 1],
            "text-field": ["get", "name"],
            "text-font": ["Noto Sans Regular"],
            "text-size": ["interpolate", ["linear"], ["zoom"], 1, 12, 5, 15],
            "text-anchor": "left",
            "text-offset": [1.2, 0],
            "text-optional": true,
          },
          paint: { "text-color": text, "text-halo-color": paper, "text-halo-width": 2 },
        });
        if (!fitted.current && latestGeojson.current.features.length) fitCities(0);
      });
      m.on("idle", () => {
        if (!m.isStyleLoaded() || !m.areTilesLoaded()) return;
        clearTimeout(timer);
        setState("ready");
      });
      m.on("error", (event) => {
        if ("sourceId" in event && event.sourceId === "cities") return;
        clearTimeout(timer);
        setState("failed");
      });
      m.on("click", "places", (event) => {
        const id = event.features?.[0]?.properties.id;
        if (typeof id === "string") latest.current.onSelect(id);
      });
      m.on("click", "clusters", async (event) => {
        const point = event.features?.[0];
        if (!point || point.geometry.type !== "Point") return;
        try {
          const zoom = await (m.getSource("cities") as GeoJSONSource).getClusterExpansionZoom(
            Number(point.properties.cluster_id),
          );
          if (map.current === m) m.easeTo({ center: point.geometry.coordinates as [number, number], zoom });
        } catch {
          // 图层切换后原来的聚合可能已消失。
        }
      });
      for (const layer of ["places", "clusters"]) {
        m.on("mouseenter", layer, () => {
          m.getCanvas().style.cursor = "pointer";
        });
        m.on("mouseleave", layer, () => {
          m.getCanvas().style.cursor = "";
        });
      }
      m.setStyle(styleUrl(), { diff: false, transformStyle: styleTransform });
    } catch {
      clearTimeout(timer);
      setState("failed");
    }
    const observer = new MutationObserver(() => {
      if (!instance) return;
      waitForMap();
      instance.setStyle(styleUrl(), { diff: false, transformStyle: styleTransform });
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ["data-ds-dark-theme"] });
    if (themeRoot !== document.body)
      observer.observe(themeRoot, { attributes: true, attributeFilter: ["data-theme"] });
    const resize = new ResizeObserver(() => instance?.resize());
    resize.observe(container.current);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      resize.disconnect();
      map.current = null;
      instance?.remove();
      URL.revokeObjectURL(workerUrl);
    };
  }, [fitCities]);
  useEffect(() => {
    const source = map.current?.getSource("cities") as GeoJSONSource | undefined;
    source?.setData(geojson);
    if (source && !fitted.current && geojson.features.length) fitCities(0);
  }, [geojson, fitCities]);
  useEffect(() => {
    const source = map.current?.getSource("experience-order") as GeoJSONSource | undefined;
    source?.setData(routes);
  }, [routes]);
  useEffect(() => {
    const instance = map.current;
    const city = latest.current.cities.find((city) => city.id === selected);
    if (
      instance &&
      fitted.current &&
      instance.isStyleLoaded() &&
      city?.place.lng !== undefined &&
      city.place.lat !== undefined
    ) {
      const position = instance.project([city.place.lng, city.place.lat]);
      const canvas = instance.getCanvas();
      const outside =
        position.x < 48 ||
        position.y < 48 ||
        position.x > canvas.clientWidth - 48 ||
        position.y > canvas.clientHeight - 48;
      if (outside) {
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        instance.easeTo({
          center: [city.place.lng, city.place.lat],
          zoom: Math.max(2.5, Math.min(instance.getZoom(), 5)),
          duration: reduced ? 0 : 500,
        });
      }
    }
    if (instance?.getLayer("selected-city"))
      instance.setFilter("selected-city", ["==", ["get", "id"], selected ?? ""]);
  }, [selected]);
  return (
    <section className={css.mapPane} aria-label="城市地图">
      <div ref={container} className={css.map} />
      {state !== "ready" && (
        <output className={css.mapNotice}>
          {state === "failed" ? (
            <>
              底图暂时不可用，仍可查看城市记录。
              <button type="button" className={css.control} onClick={onShowList}>
                显示城市列表
              </button>
            </>
          ) : (
            "正在加载地图…"
          )}
        </output>
      )}
      <fieldset className={css.mapControls} aria-label="地图视野">
        <button type="button" aria-label="放大" onClick={() => map.current?.zoomIn()}>
          +
        </button>
        <button type="button" aria-label="缩小" onClick={() => map.current?.zoomOut()}>
          −
        </button>
        <button type="button" onClick={() => fitCities()}>
          我的足迹
        </button>
        <button
          type="button"
          onClick={() =>
            map.current?.fitBounds(
              [
                [-180, -60],
                [180, 80],
              ],
              { padding: 24, duration: 600 },
            )
          }
        >
          全世界
        </button>
      </fieldset>
      <span className={css.precision}>
        {home ? `⌂ ${home.name} · 家乡起点` : "城市级位置"}
        {routes.features.length > 0 && " · 连线表示经历顺序"}
      </span>
    </section>
  );
}

export function MapPage({
  subscribe,
  loadExperienceSource,
  loadLifeMap,
  resolveExperience,
  editExperience,
  hideExperience,
  unhideExperience,
  onPrompt,
  ...importControls
}: MapPageProps) {
  const [notice, setNotice] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ id: string; revision: number } | null>(null);
  const [data, setData] = useState<LifeMapData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [year, setYear] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [enabled, setEnabled] = useState<Layer[]>(["been", "now", "planned"]);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState("map");
  const [showRoutes, setShowRoutes] = useState(true);
  const [chapterLimit, setChapterLimit] = useState(30);
  const [detailLimit, setDetailLimit] = useState(30);
  const [compact, setCompact] = useState(false);
  const showMapList = useCallback(() => setView("list"), []);
  const page = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const seq = ++sequence.current;
    setError(null);
    try {
      const result = await loadLifeMap();
      if (seq === sequence.current) setData(result);
    } catch (err) {
      if (seq === sequence.current) setError(err instanceof Error ? err.message : String(err));
    }
  }, [loadLifeMap]);
  useEffect(() => {
    void refresh();
    return () => {
      sequence.current++;
    };
  }, [refresh]);
  useEffect(() => subscribe?.(() => void refresh()), [subscribe, refresh]);
  useEffect(() => {
    if (!page.current) return;
    const resize = new ResizeObserver(([entry]) => {
      if (entry) setCompact(entry.contentRect.width <= 640);
    });
    resize.observe(page.current);
    return () => resize.disconnect();
  }, []);
  const ask = (text: string) => {
    try {
      onPrompt(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  const years = data ? experienceYears(data.experiences, data.asOf) : [];
  const invalidRange = year === "range" && !!from && !!to && from > to;
  const cities = useMemo(() => {
    if (!data) return [];
    const groups = new Map<string, CityGroup>();
    for (const item of data?.experiences ?? []) {
      const layer = experienceLayer(item, data.asOf);
      if (item.review || !layer || !enabled.includes(layer)) continue;
      if (year === "undated" && experienceInterval(item)) continue;
      if (year === "range" && !experienceOverlaps(item, from || undefined, to || undefined)) continue;
      if (
        !["all", "undated", "range"].includes(year) &&
        !experienceOverlaps(item, `${year}-01-01`, `${year}-12-31`)
      )
        continue;
      const id = cityId(item.place);
      let group = groups.get(id);
      if (!group) {
        group = { id, place: item.place, experiences: [], layers: [] };
        groups.set(id, group);
      }
      group.experiences.push(item);
    }
    for (const feature of data?.features ?? []) {
      const group = groups.get(cityId(feature.properties.place));
      if (
        group &&
        enabled.includes(feature.properties.layer) &&
        feature.properties.experiences.some((item) => group.experiences.some((row) => row.id === item.id))
      ) {
        group.place = feature.properties.place;
        if (!group.layers.includes(feature.properties.layer)) group.layers.push(feature.properties.layer);
      }
    }
    const home = data.hometown?.status === "ready" ? data.hometown.place : undefined;
    if (home) {
      const id = cityId(home);
      const group = groups.get(id);
      if (group) group.home = true;
      else groups.set(id, { id, place: home, experiences: [], layers: [], home: true });
    }
    for (const group of groups.values())
      group.layers.sort((a, b) => layers.findIndex((l) => l.id === a) - layers.findIndex((l) => l.id === b));
    return [...groups.values()].sort((a, b) => Number(!!b.home) - Number(!!a.home));
  }, [data, enabled, year, from, to]);
  const home = data?.hometown?.status === "ready" ? data.hometown.place : undefined;
  const homeId = home ? cityId(home) : null;
  const initialized = useRef(false);
  useEffect(() => {
    if (data && !initialized.current) {
      initialized.current = true;
      if (homeId && !compact) setSelected(homeId);
    }
  }, [data, homeId, compact]);
  const timeline = cities
    .flatMap((city) => city.experiences.map((item) => ({ city, item })))
    .sort(
      (a, b) =>
        (a.item.start ?? "9999").localeCompare(b.item.start ?? "9999") || a.item.id.localeCompare(b.item.id),
    );
  const city = cities.find((item) => item.id === selected);
  const selectedId = city?.id;
  useEffect(() => {
    setDetailLimit(30);
    if (!selectedId || !page.current) return;
    const previous = document.activeElement as HTMLElement;
    close.current?.focus({ preventScroll: compact });
    const background = compact
      ? Array.from(page.current.children).filter(
          (element): element is HTMLElement =>
            element instanceof HTMLElement &&
            element !== sheet.current &&
            element.getAttribute("aria-hidden") !== "true",
        )
      : [];
    for (const element of background) element.inert = true;
    return () => {
      for (const element of background) element.inert = false;
      if (previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, [selectedId, compact]);
  const dismiss = () => setSelected(null);
  const save = async (item: Experience, changes: ExperienceChanges) => {
    await editExperience(item.id, changes, item.rev ?? 1);
    setNotice("修正已保存");
    await refresh();
  };
  const hide = async (item: Experience) => {
    const revision = await hideExperience(item.id, item.rev ?? 1);
    setUndo({ id: item.id, revision });
    setNotice("经历已隐藏");
    await refresh();
  };
  const unhide = async (id: string, revision: number) => {
    setBusy(true);
    try {
      await unhideExperience(id, revision);
      setUndo(null);
      setNotice("隐藏已撤销");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  const resolve = async (id: string, candidate: number) => {
    setBusy(true);
    setError(null);
    try {
      await resolveExperience(id, candidate);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  const details = city && data && (
    <>
      {compact && <div className={css.backdrop} aria-hidden="true" />}
      <div
        id="city-details"
        ref={sheet}
        className={css.detail}
        role={compact ? "dialog" : "region"}
        aria-modal={compact || undefined}
        aria-labelledby="city-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") dismiss();
          if (compact && event.key === "Tab") {
            const focusable = sheet.current?.querySelectorAll<HTMLElement>(
              "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])",
            );
            const first = focusable?.[0];
            const last = focusable?.[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <div className={css.detailHeading}>
          <div>
            <h2 id="city-title">{city.place.name}</h2>
            <p className={css.secondary}>
              {city.home
                ? "家乡 · 人生地图的起点"
                : `${city.place.country || "暂无记录"} · ${city.experiences.length} 段经历`}
            </p>
          </div>
          <button ref={close} type="button" className={css.control} onClick={dismiss}>
            关闭
          </button>
        </div>
        {city.home && (
          <section className={css.homeStory}>
            <span className={css.homeBadge}>⌂ 从这里出发</span>
            <p>{data.hometown?.evidence}</p>
            <p className={css.source}>依据：{data.hometown?.source}</p>
            <button type="button" className={css.link} onClick={() => ask(homePrompt)}>
              核对或修正家乡
            </button>
          </section>
        )}
        {city.experiences.slice(0, detailLimit).map((item) => (
          <ExperienceDetails
            key={`${item.id}:${item.rev ?? 1}`}
            item={item}
            onPrompt={ask}
            asOf={data.asOf}
            loadSource={loadExperienceSource}
            save={save}
            hide={hide}
          />
        ))}
        {city.experiences.length > detailLimit && (
          <button type="button" className={css.link} onClick={() => setDetailLimit((value) => value + 30)}>
            更多经历（{city.experiences.length - detailLimit}）
          </button>
        )}
      </div>
    </>
  );
  return (
    <div ref={page} className={css.page}>
      <header className={css.header}>
        <div>
          <h1>
            <span className={css.dot} aria-hidden="true" />
            人生地图
          </h1>
          <p className={css.secondary}>从家乡出发，记录走过的城市和现在的生活</p>
        </div>
        {/* 还没有经历时，下方空白处已有同一个入口。 */}
        {!(data && !data.experiences.length && !home) && (
          <button type="button" className={css.primary} onClick={() => ask(prompt)}>
            从记忆生成
          </button>
        )}
      </header>
      <div className={css.tools}>
        <ExperienceImportControls
          {...importControls}
          subscribe={subscribe}
          onChanged={refresh}
          pending={data?.importsPending ?? 0}
        />
        <button
          type="button"
          className={css.control}
          onClick={() => (homeId ? setSelected(homeId) : ask(homePrompt))}
        >
          {home ? `⌂ 家乡：${home.name}` : data?.hometown?.status === "review" ? "核对家乡" : "识别我的家乡"}
        </button>
      </div>
      {error && (
        <p className={css.notice} role="alert">
          {error}{" "}
          <button type="button" className={css.link} onClick={() => void refresh()}>
            重新读取
          </button>
        </p>
      )}
      {notice && (
        <output className={css.notice}>
          {notice}
          {undo && (
            <button
              type="button"
              className={css.control}
              disabled={busy}
              onClick={() => void unhide(undo.id, undo.revision)}
            >
              撤销隐藏
            </button>
          )}
        </output>
      )}
      {!!data?.hidden.length && (
        <details className={css.review}>
          <summary>已隐藏 {data.hidden.length} 段经历</summary>
          {data.hidden.map(({ item, revision }) => (
            <div key={item.id} className={css.reviewItem}>
              <strong>{item.title || item.place.name}</strong>
              <p className={css.source}>
                {item.place.name} · {dateLabel(item.start, item.time_precision)} · 来源：{item.source}
              </p>
              <button
                type="button"
                className={css.control}
                disabled={busy}
                onClick={() => void unhide(item.id, revision)}
              >
                恢复这段经历
              </button>
            </div>
          ))}
        </details>
      )}
      {!data ? (
        <output className={css.empty}>{error ? "经历读取失败，请重试。" : "正在读取经历…"}</output>
      ) : !data.experiences.length && !home ? (
        <div className={css.empty}>
          <h2>让开图从你的记忆里生成地图</h2>
          <p>和开图聊聊，整理去过和住过的城市。</p>
          <button type="button" className={css.primary} onClick={() => ask(prompt)}>
            从记忆生成
          </button>
        </div>
      ) : (
        <>
          <details className={css.review}>
            <summary>地图工具 · 图层与时间</summary>
            <div className={css.toolbar}>
              <label className={css.routeToggle}>
                <input
                  type="checkbox"
                  checked={showRoutes}
                  onChange={(event) => setShowRoutes(event.target.checked)}
                />
                经历连线
              </label>
              <fieldset className={css.legend} aria-label="地图图层">
                {layers.map((layer) => (
                  <button
                    type="button"
                    key={layer.id}
                    aria-pressed={enabled.includes(layer.id)}
                    onClick={() => {
                      setEnabled((current) =>
                        current.includes(layer.id)
                          ? current.filter((id) => id !== layer.id)
                          : [...current, layer.id],
                      );
                      setSelected(null);
                    }}
                  >
                    <span className={css.shape} data-layer={layer.id} aria-hidden="true" />
                    {layer.name}
                  </button>
                ))}
              </fieldset>
              <fieldset className={css.switch} aria-label="显示方式">
                {(
                  [
                    ["map", "地图"],
                    ["list", "列表"],
                  ] as const
                ).map(([id, name]) => (
                  <button type="button" key={id} aria-pressed={view === id} onClick={() => setView(id)}>
                    {name}
                  </button>
                ))}
              </fieldset>
            </div>
            <fieldset className={css.years} aria-label="按年份筛选">
              {[
                { id: "all", name: "全部" },
                ...years.map((id) => ({ id, name: id })),
                { id: "undated", name: `时间不详 ${data.undated}` },
              ].map((item) => (
                <button
                  type="button"
                  key={item.id}
                  aria-pressed={year === item.id}
                  onClick={() => {
                    setYear(item.id);
                    setFrom("");
                    setTo("");
                    setSelected(null);
                  }}
                >
                  {item.name}
                </button>
              ))}
            </fieldset>
            <fieldset className={css.range} aria-label="按日期区间筛选">
              <label>
                从
                <input
                  type="date"
                  value={from}
                  onChange={(e) => {
                    setFrom(e.target.value);
                    setYear(e.target.value || to ? "range" : "all");
                    setSelected(null);
                  }}
                />
              </label>
              <label>
                至
                <input
                  type="date"
                  value={to}
                  onChange={(e) => {
                    setTo(e.target.value);
                    setYear(e.target.value || from ? "range" : "all");
                    setSelected(null);
                  }}
                />
              </label>
              <button
                type="button"
                className={css.control}
                onClick={() => {
                  setFrom("");
                  setTo("");
                  setYear("all");
                  setSelected(null);
                }}
              >
                清除时间筛选
              </button>
            </fieldset>
            {invalidRange && (
              <p role="alert" className={css.formError}>
                开始日期不能晚于结束日期
              </p>
            )}
          </details>
          {(year !== "all" || enabled.length !== layers.length) && (
            <div className={css.filterStatus}>
              <span>
                {year === "undated"
                  ? "时间不详"
                  : year === "range"
                    ? `${from || "不限"} — ${to || "不限"}`
                    : year === "all"
                      ? "全部时间"
                      : `${year} 年`}
                {enabled.length !== layers.length
                  ? ` · ${
                      layers
                        .filter((l) => enabled.includes(l.id))
                        .map((l) => l.name)
                        .join("、") || "未选择图层"
                    }`
                  : ""}
              </span>
              <button
                type="button"
                className={css.link}
                onClick={() => {
                  setYear("all");
                  setFrom("");
                  setTo("");
                  setEnabled(layers.map((l) => l.id));
                  setSelected(null);
                }}
              >
                重置筛选
              </button>
            </div>
          )}
          <div className={css.layout} data-view={view}>
            <CityMap
              cities={cities}
              selected={city?.id ?? null}
              onSelect={setSelected}
              onShowList={showMapList}
              showRoutes={showRoutes}
              home={home}
              asOf={data.asOf}
            />
            <section className={css.listPane} aria-label="城市列表">
              {!!data.review.length && (
                <details className={css.review}>
                  <summary>
                    {data.review.length} 段经历待核对 <span aria-hidden="true">⌄</span>
                  </summary>
                  {data.review.map((item) => (
                    <div key={item.id} className={css.reviewItem}>
                      <h3>
                        {item.place.name} · {item.review ? "地点待核对" : "事实或时间待核对"}
                      </h3>
                      <ExperienceDetails
                        key={`${item.id}:${item.rev ?? 1}`}
                        item={item}
                        onPrompt={ask}
                        asOf={data.asOf}
                        loadSource={loadExperienceSource}
                        save={save}
                        hide={hide}
                      />
                      {item.review?.candidates.length ? (
                        item.review.candidates.map((candidate) => (
                          <button
                            type="button"
                            className={css.candidate}
                            key={candidate.geonameid}
                            disabled={busy}
                            onClick={() => void resolve(item.id, candidate.geonameid)}
                          >
                            <strong>{candidate.zh[0] || candidate.name}</strong>
                            <span>
                              {candidate.name} · {candidate.admin1 || "暂无记录"} · {candidate.country}
                            </span>
                            <span>
                              {candidate.population > 0
                                ? `人口约 ${new Intl.NumberFormat("zh-CN", {
                                    notation: "compact",
                                    maximumFractionDigits: 1,
                                  }).format(candidate.population)}`
                                : "人口暂无记录"}
                            </span>
                          </button>
                        ))
                      ) : (
                        <p className={css.secondary}>
                          {item.review
                            ? "没有候选城市，可修正地名。"
                            : "这条记录是推测或日期仍在未来，核对后才计入已到访。"}
                        </p>
                      )}
                    </div>
                  ))}
                </details>
              )}
              {!home && (
                <section className={css.homeStory}>
                  <h2>{data.hometown?.status === "review" ? "家乡待核对" : "从家乡开始"}</h2>
                  <p>{data.hometown?.evidence ?? "让开图从已有资料识别家乡，为人生地图找到起点。"}</p>
                  <button type="button" className={css.link} onClick={() => ask(homePrompt)}>
                    识别与核对家乡
                  </button>
                </section>
              )}
              <div className={css.listHeading}>
                <h2>我的城市</h2>
                <span>{cities.length} 个</span>
              </div>
              {!compact && details}
              {!cities.length && <p className={css.empty}>这个筛选下暂无记录。</p>}
              {cities.map((item) => (
                <button
                  type="button"
                  className={css.city}
                  key={item.id}
                  aria-expanded={city?.id === item.id}
                  aria-controls={city?.id === item.id ? "city-details" : undefined}
                  onClick={() => setSelected(item.id)}
                >
                  <span>
                    <strong>{item.place.name}</strong>
                    <span className={css.secondary}>
                      {item.home
                        ? "⌂ 家乡 · 起点"
                        : `${item.place.country || "暂无记录"} · ${item.experiences.length} 段经历`}
                    </span>
                  </span>
                  <span className={css.cityShapes}>
                    {item.layers.map((id) => (
                      <span
                        key={id}
                        className={css.shape}
                        data-layer={id}
                        role="img"
                        aria-label={layers.find((l) => l.id === id)?.name}
                      />
                    ))}
                    <span aria-hidden="true">›</span>
                  </span>
                </button>
              ))}
            </section>
          </div>

          {(timeline.length > 0 || home) && (
            <section className={css.timeline} aria-label="经历时间轴">
              <h2>生活的章节</h2>
              <div className={css.timelineCards}>
                {home && (
                  <button
                    type="button"
                    className={css.chapter}
                    aria-pressed={selected === homeId}
                    onClick={() => setSelected(homeId)}
                  >
                    <span>人生起点</span>
                    <strong>⌂ {home.name} · 家乡</strong>
                    <small>查看家乡依据</small>
                  </button>
                )}
                {timeline.slice(0, chapterLimit).map(({ city, item }) => (
                  <button
                    type="button"
                    className={css.chapter}
                    key={item.id}
                    aria-pressed={selected === city.id}
                    onClick={() => setSelected(city.id)}
                  >
                    <span>{dateLabel(item.start, item.time_precision)}</span>
                    <strong>
                      {city.place.name} · {item.title || eventTypes[item.event_type]}
                    </strong>
                    <small>{statuses[item.fact_status]}</small>
                  </button>
                ))}
              </div>
            </section>
          )}
          {timeline.length > chapterLimit && (
            <button type="button" className={css.link} onClick={() => setChapterLimit((value) => value + 30)}>
              更多时间轴经历（{timeline.length - chapterLimit}）
            </button>
          )}
          <div className={css.mapFooter}>
            <button
              type="button"
              className={css.link}
              aria-pressed={showRoutes}
              onClick={() => setShowRoutes((value) => !value)}
            >
              {showRoutes ? "隐藏经历连线" : "显示经历连线"}
            </button>
          </div>
          <p className={css.mapFootnote}>城市级位置 · 连线只表示经历顺序，不代表实际交通路线</p>
          {compact && details}
        </>
      )}
    </div>
  );
}
