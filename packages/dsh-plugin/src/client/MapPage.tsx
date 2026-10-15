import {
  type GeoJSONSource,
  Map as LibreMap,
  LngLatBounds,
  NavigationControl,
  setWorkerUrl,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerSource from "maplibre-gl/dist/maplibre-gl-worker.mjs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Experience, LifeMapData } from "../types.js";
import css from "./MapPage.module.css";

export interface MapPageProps {
  loadLifeMap: () => Promise<LifeMapData>;
  resolveExperience: (id: string, geonameid: number) => Promise<unknown>;
  onPrompt: (text: string) => void;
}
type Layer = LifeMapData["features"][number]["properties"]["layer"];
type CityGroup = { id: string; place: Experience["place"]; experiences: Experience[]; layers: Layer[] };
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
  observed: "你说的",
  user_reported: "你说的",
  inferred: "AI 推测",
  planned: "计划",
  suggested: "建议",
};
const prompt = "用 build-life-map 技能，从我的记忆里整理去过和住过的城市";
const cityId = (place: Experience["place"]) =>
  String(place.geonameid ?? `${place.country ?? ""}:${place.name}`);
function layerOf(item: Experience): Layer {
  if (item.fact_status === "planned" || item.fact_status === "suggested") return "planned";
  return item.fact_status !== "inferred" && ["lived", "worked"].includes(item.event_type) && !item.end
    ? "now"
    : "been";
}
function dateLabel(value: string | undefined, precision: Experience["time_precision"]) {
  if (!value || precision === "unknown") return "暂无记录";
  const [year, month, day] = value.split("-");
  if (precision === "year" || !month) return year;
  return `${year} 年 ${Number(month)} 月${precision === "day" && day ? ` ${Number(day)} 日` : ""}`;
}
function ExperienceDetails({ item, onPrompt }: { item: Experience; onPrompt: MapPageProps["onPrompt"] }) {
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
          : layerOf(item) === "now"
            ? " – 至今"
            : ""}
      </p>
      {item.notes && <p className={css.notes}>{item.notes}</p>}
      <p className={css.source}>来源：{item.source || "暂无记录"}</p>
      <button
        type="button"
        className={css.link}
        onClick={() =>
          onPrompt(`帮我核对并修改「${item.place.name}」的这段经历（${item.id}），先和我确认地点、时间和分类`)
        }
      >
        纠正这段经历
      </button>
    </article>
  );
}

function markerImage(ids: Layer[], ink: string, paper: string) {
  const canvas = document.createElement("canvas");
  canvas.width = ids.length * 48;
  canvas.height = 48;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.scale(2, 2);
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
}: { cities: CityGroup[]; selected: string | null; onSelect: (id: string) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<LibreMap | null>(null);
  const latest = useRef({ cities, onSelect });
  latest.current = { cities, onSelect };
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const geojson = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: cities
        .filter(
          (city) =>
            city.layers.length &&
            city.place.precision === "city" &&
            city.place.lng !== undefined &&
            city.place.lat !== undefined,
        )
        .map((city) => ({
          type: "Feature" as const,
          geometry: {
            type: "Point" as const,
            coordinates: [city.place.lng as number, city.place.lat as number],
          },
          properties: { id: city.id, icon: city.layers.join("-") },
        })),
    }),
    [cities],
  );
  const latestGeojson = useRef(geojson);
  latestGeojson.current = geojson;
  useEffect(() => {
    if (!container.current) return;
    const workerUrl = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
    setWorkerUrl(workerUrl);
    let instance: LibreMap | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failed = false;
    const waitForMap = () => {
      failed = false;
      setState("loading");
      clearTimeout(timer);
      timer = setTimeout(() => setState("failed"), 8000);
    };
    const styleUrl = () =>
      `https://tiles.openfreemap.org/styles/${document.body.hasAttribute("data-ds-dark-theme") ? "dark" : "positron"}`;
    try {
      instance = new LibreMap({
        container: container.current,
        style: styleUrl(),
        center: [20, 25],
        zoom: 1,
        cooperativeGestures: true,
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
      const m = instance;
      m.addControl(new NavigationControl({ showCompass: false }), "top-left");
      waitForMap();
      let fitted = false;
      m.on("style.load", () => {
        const theme = getComputedStyle(container.current as HTMLDivElement);
        const ink = theme.getPropertyValue("--kt-map").trim();
        const paper = theme.getPropertyValue("--kt-card").trim();
        for (let mask = 1; mask < 8; mask++) {
          const ids = layers.filter((_, i) => mask & (1 << i)).map((layer) => layer.id);
          const image = markerImage(ids, ink, paper);
          if (image) m.addImage(ids.join("-"), image, { pixelRatio: 2 });
        }
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
          id: "places",
          type: "symbol",
          source: "cities",
          filter: ["!", ["has", "point_count"]],
          layout: {
            "icon-image": ["get", "icon"],
            "icon-allow-overlap": true,
          },
        });
        if (!fitted && latestGeojson.current.features.length) {
          const bounds = new LngLatBounds();
          for (const point of latestGeojson.current.features)
            bounds.extend(point.geometry.coordinates as [number, number]);
          m.fitBounds(bounds, { padding: 56, maxZoom: 5, duration: 0 });
          fitted = true;
        }
      });
      m.on("idle", () => {
        if (failed || !m.isStyleLoaded() || !m.areTilesLoaded()) return;
        clearTimeout(timer);
        setState("ready");
      });
      m.on("error", (event) => {
        if ("sourceId" in event && event.sourceId === "cities") return;
        failed = true;
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
    } catch {
      clearTimeout(timer);
      setState("failed");
    }
    const observer = new MutationObserver(() => {
      if (!instance) return;
      waitForMap();
      instance.setStyle(styleUrl());
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ["data-ds-dark-theme"] });
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
  }, []);
  useEffect(() => {
    const source = map.current?.getSource("cities") as GeoJSONSource | undefined;
    source?.setData(geojson);
  }, [geojson]);
  useEffect(() => {
    const city = cities.find((city) => city.id === selected);
    if (city?.place.precision === "city" && city.place.lng !== undefined && city.place.lat !== undefined) {
      map.current?.flyTo({ center: [city.place.lng, city.place.lat], zoom: 7 });
    }
  }, [selected, cities]);
  return (
    <section className={css.mapPane} aria-label="城市地图">
      <div ref={container} className={css.map} />
      {state !== "ready" && (
        <output className={css.mapNotice}>
          {state === "failed" ? "地图暂时加载不了，下面的列表照常可用" : "正在加载地图…"}
        </output>
      )}
      <span className={css.precision}>城市级位置</span>
    </section>
  );
}

export function MapPage({ loadLifeMap, resolveExperience, onPrompt }: MapPageProps) {
  const [data, setData] = useState<LifeMapData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [year, setYear] = useState("all");
  const [enabled, setEnabled] = useState<Layer[]>(["been", "now", "planned"]);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState("map");
  const [compact, setCompact] = useState(false);
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
  const years = [
    ...new Set(data?.experiences.flatMap((item) => (item.start ? [item.start.slice(0, 4)] : []))),
  ]
    .sort()
    .reverse();
  const cities = useMemo(() => {
    const groups = new Map<string, CityGroup>();
    for (const item of data?.experiences ?? []) {
      const layer = layerOf(item);
      if (item.review || !enabled.includes(layer)) continue;
      if (year === "undated" && (item.start || item.end)) continue;
      if (year !== "all" && year !== "undated") {
        const start = item.start?.slice(0, 4) ?? item.end?.slice(0, 4);
        const end = item.end?.slice(0, 4) ?? (layer === "now" ? "9999" : start);
        if (!start || !end || year < start || year > end) continue;
      }
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
    for (const group of groups.values())
      group.layers.sort((a, b) => layers.findIndex((l) => l.id === a) - layers.findIndex((l) => l.id === b));
    return [...groups.values()];
  }, [data, enabled, year]);
  const city = cities.find((item) => item.id === selected);
  const selectedId = city?.id;
  useEffect(() => {
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
  const details = city && (
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
            const focusable = sheet.current?.querySelectorAll<HTMLElement>("button, a[href]");
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
              {city.place.country || "暂无记录"} · {city.experiences.length} 段经历
            </p>
          </div>
          <button ref={close} type="button" className={css.control} onClick={dismiss}>
            关闭
          </button>
        </div>
        {city.experiences.map((item) => (
          <ExperienceDetails key={item.id} item={item} onPrompt={ask} />
        ))}
      </div>
    </>
  );
  return (
    <div ref={page} className={css.page}>
      <header className={css.header}>
        <div>
          <h1>
            <span className={css.dot} aria-hidden="true" />
            地图
          </h1>
          <p className={css.secondary}>走过的、现在的和计划去的城市 · 由 Agent 从你的记忆整理</p>
        </div>
        <button type="button" className={css.primary} onClick={() => ask(prompt)}>
          从记忆生成
        </button>
      </header>
      {error && (
        <p className={css.notice} role="alert">
          {error}{" "}
          <button type="button" className={css.link} onClick={() => void refresh()}>
            重新读取
          </button>
        </p>
      )}
      {!data ? (
        <output className={css.empty}>{error ? "经历读取失败，请重试。" : "正在读取经历…"}</output>
      ) : !data.experiences.length ? (
        <div className={css.empty}>
          <h2>让开图从你的记忆里生成地图</h2>
          <p>和开图聊聊，整理去过和住过的城市。</p>
          <button type="button" className={css.primary} onClick={() => ask(prompt)}>
            从记忆生成
          </button>
        </div>
      ) : (
        <>
          <div className={css.toolbar}>
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
          <div className={css.layout} data-view={view}>
            <CityMap cities={cities} selected={city?.id ?? null} onSelect={setSelected} />
            <section className={css.listPane} aria-label="城市列表">
              {!!data.review.length && (
                <details className={css.review}>
                  <summary>
                    {data.review.length} 个地点待你确认 <span aria-hidden="true">⌄</span>
                  </summary>
                  {data.review.map((item) => (
                    <div key={item.id} className={css.reviewItem}>
                      <h3>原地名：{item.place.name}</h3>
                      <ExperienceDetails item={item} onPrompt={ask} />
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
                        <p className={css.secondary}>没有候选城市，和开图核对地名。</p>
                      )}
                    </div>
                  ))}
                </details>
              )}
              <div className={css.listHeading}>
                <h2>城市</h2>
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
                      {item.place.country || "暂无记录"} · {item.experiences.length} 段经历
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
                  setSelected(null);
                }}
              >
                {item.name}
              </button>
            ))}
          </fieldset>

          {compact && details}
        </>
      )}
    </div>
  );
}
