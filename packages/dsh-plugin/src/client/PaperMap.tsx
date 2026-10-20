import {
  type GeoJSONSource,
  Map as LibreMap,
  LngLatBounds,
  Marker,
  type StyleSpecification,
  setWorkerUrl,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerSource from "maplibre-gl/dist/maplibre-gl-worker.mjs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Experience } from "../types.js";
import css from "./MapPage.module.css";
import { type FootprintState, type Place, coordinate, footprintData } from "./footprint-state.js";
import { useT } from "./i18n.js";
import { cityKey } from "./life-map-visuals.js";
import dark from "./map-assets/kaitu-paper-dark.json";
import light from "./map-assets/kaitu-paper.json";
import { registerPaperTiles } from "./paper-tiles-protocol.js";
import { terrainAttribution } from "./terrain-attribution.js";

const animate = () => (window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1200);

type City = { id: string; place: Place; experiences: Experience[] };
export function PaperMap({
  cities,
  selected,
  onSelect,
  onShowList,
  showRoutes,
  showAllPlaces = false,
  asOf,
  current,
  onAdd,
}: {
  cities: City[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  onShowList: () => void;
  showRoutes: boolean;
  showAllPlaces?: boolean;
  asOf: string;
  current?: Place;
  onAdd: (state: FootprintState) => void;
}) {
  const t = useT();
  const [mode, setMode] = useState<FootprintState>("now");
  const [ready, setReady] = useState(false);
  const [detailUnavailable, setDetailUnavailable] = useState(false);
  const [cityZoom, setCityZoom] = useState(false);
  const [failure, setFailure] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<LibreMap | null>(null);
  const meMarker = useRef<Marker | null>(null);
  const data = useMemo(
    () =>
      footprintData(
        cities.flatMap((c) => c.experiences),
        asOf,
        current,
      ),
    [cities, asOf, current],
  );
  const latest = useRef({ mode, data, onSelect, selected, showRoutes, showAllPlaces });
  latest.current = { mode, data, onSelect, selected, showRoutes, showAllPlaces };
  const camera = useCallback((snapshot: Pick<typeof latest.current, "mode" | "data"> = latest.current) => {
    const m = map.current;
    const { mode, data } = snapshot;
    if (!m) return;
    m.stop();
    if (mode === "now" && coordinate(data.me))
      m.flyTo({ center: [data.me.lng, data.me.lat], zoom: 10, duration: animate() });
    else if (mode === "history" && data.history.length) {
      const bounds = new LngLatBounds();
      const anchor = data.history[0]?.lng ?? 0;
      for (const p of data.history)
        if (coordinate(p)) {
          let lng = p.lng;
          while (lng - anchor > 180) lng -= 360;
          while (lng - anchor < -180) lng += 360;
          bounds.extend([lng, p.lat]);
        }
      for (const route of data.routes.features)
        if (route.properties.kind === "history") {
          for (const point of route.geometry.coordinates) {
            let lng = point[0] as number;
            while (lng - anchor > 180) lng -= 360;
            while (lng - anchor < -180) lng += 360;
            bounds.extend([lng, point[1] as number]);
          }
        }
      m.fitBounds(bounds, { padding: 100, maxZoom: 5, duration: animate() });
    } else m.flyTo({ center: [20, 20], zoom: 1.5, duration: animate() });
  }, []);
  const update = useCallback(
    (
      m: LibreMap,
      snapshot: Pick<
        typeof latest.current,
        "mode" | "data" | "showRoutes" | "selected" | "showAllPlaces"
      > = latest.current,
    ) => {
      const { mode, data, showRoutes, selected, showAllPlaces } = snapshot;
      if (!m.getSource("footprint-cities")) return;
      const places = showAllPlaces
        ? data.all
        : mode === "history"
          ? data.history
          : mode === "possible"
            ? data.possible
            : [];
      (m.getSource("footprint-cities") as GeoJSONSource).setData({
        type: "FeatureCollection",
        features: places.filter(coordinate).map((p) => ({
          type: "Feature",
          properties: { id: cityKey(p), lived: data.lived.some((l) => cityKey(l) === cityKey(p)) },
          geometry: { type: "Point", coordinates: [p.lng, p.lat] },
        })),
      });
      (m.getSource("footprint-routes") as GeoJSONSource).setData({
        ...data.routes,
        features: showRoutes
          ? data.routes.features.filter((f) =>
              mode === "history"
                ? f.properties.kind === "history"
                : mode === "possible"
                  ? f.properties.kind !== "history"
                  : false,
            )
          : [],
      });
      m.setFilter("footprint-selected", ["==", ["get", "id"], selected ?? ""]);
      if (coordinate(data.me)) meMarker.current?.setLngLat([data.me.lng, data.me.lat]).addTo(m);
      else meMarker.current?.remove();
      meMarker.current?.getElement().setAttribute("data-breathe", String(mode === "now"));
    },
    [],
  );
  useEffect(() => {
    if (!container.current) return;
    const el = container.current;
    registerPaperTiles();
    const worker = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
    setWorkerUrl(worker);
    const themeRoot = el.closest("[data-theme]") ?? document.body;
    const isDark = () =>
      themeRoot.getAttribute("data-theme") === "dark" ||
      (!themeRoot.getAttribute("data-theme") && document.body.hasAttribute("data-ds-dark-theme"));
    let disposed = false;
    let styleGeneration = 0;
    let remoteLoading = false;
    let remoteLoaded = false;
    let m: LibreMap | undefined;
    let remoteStyle: StyleSpecification | undefined;
    const controller = new AbortController();
    const details = async () => {
      if (!m || m.getZoom() < 6 || remoteLoaded || remoteLoading || !m.isStyleLoaded()) return;
      if (!navigator.onLine) {
        setDetailUnavailable(true);
        return;
      }
      remoteLoading = true;
      const generation = styleGeneration;
      try {
        if (!remoteStyle) {
          const response = await fetch("https://tiles.openfreemap.org/styles/positron", {
            signal: controller.signal,
          });
          if (!response.ok) throw new Error("Map style unavailable");
          remoteStyle = (await response.json()) as StyleSpecification;
        }
        if (disposed || generation !== styleGeneration || !m.isStyleLoaded() || m.getZoom() < 6) return;
        for (const [id, source] of Object.entries(remoteStyle.sources)) {
          if (source.type === "vector" && !m.getSource(id)) m.addSource(id, { ...source, minzoom: 6 });
        }
        for (const layer of remoteStyle.layers) {
          const sourceLayer = "source-layer" in layer ? layer["source-layer"] : "";
          if (
            !sourceLayer ||
            !["water", "waterway", "boundary", "landcover"].includes(sourceLayer) ||
            !["line", "fill"].includes(layer.type)
          )
            continue;
          const color =
            sourceLayer === "water"
              ? isDark()
                ? "#102536"
                : "#27495e"
              : sourceLayer === "landcover"
                ? isDark()
                  ? "#4c4e4a"
                  : "#e6dcc5"
                : isDark()
                  ? "#728185"
                  : "#aaa58e";
          const next = {
            ...layer,
            id: `detail-${layer.id}`,
            minzoom: Math.max(6, layer.minzoom ?? 0),
            paint: {
              ...layer.paint,
              [`${layer.type}-color`]:
                getComputedStyle(el)
                  .getPropertyValue(
                    sourceLayer === "water"
                      ? "--atlas-water"
                      : sourceLayer === "landcover"
                        ? "--atlas-land"
                        : "--atlas-border",
                  )
                  .trim() || color,
            },
          };
          if (!m.getLayer(next.id)) m.addLayer(next as typeof layer, "footprint-history");
        }
        if (!m.getSource("paper-terrain"))
          m.addSource("paper-terrain", {
            type: "raster-dem",
            tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
            tileSize: 256,
            minzoom: 6,
            maxzoom: 12,
            encoding: "terrarium",
            attribution: terrainAttribution,
          });
        if (!m.getLayer("paper-hillshade"))
          m.addLayer(
            {
              id: "paper-hillshade",
              type: "hillshade",
              source: "paper-terrain",
              minzoom: 6,
              paint: {
                "hillshade-shadow-color": isDark() ? "#121c22" : "#817761",
                "hillshade-highlight-color": isDark() ? "#a9aaa0" : "#fff8e8",
                "hillshade-exaggeration": 0.3,
              },
            },
            "footprint-history",
          );
        remoteLoaded = true;
        setDetailUnavailable(false);
      } catch {
        if (!disposed) setDetailUnavailable(true);
      } finally {
        remoteLoading = false;
        if (!disposed && generation !== styleGeneration) void details();
      }
    };
    const loadStyle = () => {
      ++styleGeneration;
      if (disposed) return;
      const style = structuredClone(isDark() ? dark : light) as StyleSpecification;
      remoteLoaded = false;
      m?.setStyle(style, { diff: false });
    };
    try {
      m = new LibreMap({
        container: el,
        center: [20, 20],
        zoom: 1.5,
        maxZoom: 12,
        attributionControl: { compact: true },
        cooperativeGestures: false,
      });
      map.current = m;
      const instance = m;
      m.on("style.load", () => {
        if (disposed) return;
        const empty = { type: "FeatureCollection" as const, features: [] };
        instance.addSource("footprint-routes", { type: "geojson", data: empty });
        for (const [kind, dash] of [
          ["history", undefined],
          ["planned", [6, 4]],
          ["suggested", [1, 5]],
        ] as const) {
          instance.addLayer({
            id: `footprint-${kind}`,
            type: "line",
            source: "footprint-routes",
            filter: ["==", ["get", "kind"], kind],
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": "#ffffff",
              "line-width": 1.5,
              "line-opacity": ["get", "opacity"],
              ...(dash ? { "line-dasharray": [...dash] } : {}),
            },
          });
        }
        instance.addSource("footprint-cities", { type: "geojson", data: empty });
        instance.addLayer({
          id: "footprint-cities",
          type: "circle",
          source: "footprint-cities",
          paint: {
            "circle-radius": ["case", ["get", "lived"], 5, 3.5],
            "circle-color": "rgba(255,255,255,0)",
            "circle-stroke-color": "#fff",
            "circle-stroke-width": 1.5,
          },
        });
        instance.addLayer({
          id: "footprint-selected",
          type: "circle",
          source: "footprint-cities",
          filter: ["==", ["get", "id"], latest.current.selected ?? ""],
          paint: {
            "circle-radius": 12,
            "circle-color": "rgba(255,255,255,.15)",
            "circle-stroke-color": "#fff",
            "circle-stroke-width": 1,
          },
        });
        // Existing neutral dot remains until the user chooses a marker design.
        if (!meMarker.current) {
          const marker = document.createElement("div");
          marker.className = css.meMarker ?? "";
          marker.setAttribute("role", "img");
          marker.setAttribute("aria-label", "我 / Me");
          meMarker.current = new Marker({ element: marker });
        }
        update(instance);
        setReady(true);
        camera();
        void details();
      });
      m.on("idle", () => {
        setCityZoom(instance.getZoom() >= 6);
        void details();
      });
      m.on("zoomend", () => {
        setCityZoom(instance.getZoom() >= 6);
        void details();
      });
      m.on("error", (e) => {
        if ("sourceId" in e && e.sourceId === "paper-earth") setFailure(true);
        else setDetailUnavailable(true);
      });
      m.on("click", (e) => {
        const features = instance.queryRenderedFeatures(e.point, { layers: ["footprint-cities"] });
        const id = features[0]?.properties?.id;
        latest.current.onSelect(typeof id === "string" ? id : null);
      });
      void loadStyle();
    } catch {
      setFailure(true);
    }
    const observer = new MutationObserver(() => {
      void loadStyle();
    });
    observer.observe(themeRoot, { attributes: true, attributeFilter: ["data-theme", "data-ds-dark-theme"] });
    if (themeRoot !== document.body)
      observer.observe(document.body, { attributes: true, attributeFilter: ["data-ds-dark-theme"] });
    const resize = new ResizeObserver(() => m?.resize());
    resize.observe(el);
    const offline = () => setDetailUnavailable(true);
    const online = () => {
      remoteLoaded = false;
      void details();
    };
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    return () => {
      disposed = true;
      controller.abort();
      observer.disconnect();
      resize.disconnect();
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", online);
      meMarker.current?.remove();
      meMarker.current = null;
      map.current = null;
      m?.remove();
      URL.revokeObjectURL(worker);
    };
  }, [camera, update]);
  useEffect(() => {
    if (map.current && ready) camera({ mode, data });
  }, [mode, data, ready, camera]);
  useEffect(() => {
    if (map.current && ready) update(map.current, { mode, data, selected, showRoutes, showAllPlaces });
  }, [mode, data, selected, showRoutes, showAllPlaces, ready, update]);
  const empty =
    mode === "now" ? !data.me : mode === "history" ? !data.history.length : !data.possible.length || !data.me;
  return (
    <section className={css.mapPane} aria-label={t("足迹地图", "Footprint map")}>
      <div ref={container} className={css.map} />
      <div className={css.stateCaption}>
        <h1>
          {mode === "now"
            ? t("我在这里。", "I am here.")
            : mode === "history"
              ? t("这些经历组成了我。", "These experiences shaped me.")
              : t("还有许多生活等待探索。", "There is more life to explore.")}
        </h1>
        <p>
          {t(
            `住过 ${data.lived.length} 个城市 · 去过 ${data.travelled.length} 个`,
            `Lived in ${data.lived.length} cities · Visited ${data.travelled.length}`,
          )}
        </p>
        {showAllPlaces && <p>{t("已叠加全部城市", "All city records overlaid")}</p>}
        {mode === "now" && data.me && (
          <p>
            {data.me.name} ·{" "}
            {t(
              current ? "来自档案现居城市" : "最近的居住记录，不代表实时位置",
              current ? "Current city from your profile" : "Latest residence record, not live location",
            )}
          </p>
        )}
        {mode === "history" && data.undated > 0 && (
          <p>
            {t(
              `另有 ${data.undated} 段居住时间不明，不连线`,
              `${data.undated} undated residences are not connected`,
            )}
          </p>
        )}
      </div>
      {(empty || failure) && (
        <div className={css.stateEmpty}>
          <p>
            {failure
              ? t(
                  "底图暂时无法显示，城市记录仍可查看。",
                  "The map is unavailable. Your city records are still accessible.",
                )
              : mode === "now"
                ? t("还没有确定此刻的城市。", "Your current city is not yet known.")
                : mode === "history"
                  ? t("还没有有时间依据的居住记录。", "No dated residence records yet.")
                  : !data.me
                    ? t("先确定从哪里出发。", "Choose a starting city first.")
                    : t("还没有想去的地方。", "No places to explore yet.")}
          </p>
          <button
            type="button"
            className={css.control}
            onClick={() => (failure ? onShowList() : onAdd(mode === "possible" && !data.me ? "now" : mode))}
          >
            {failure
              ? t("显示城市列表", "Show city list")
              : mode === "history"
                ? t("从照片或记忆里找", "Find in photos or memories")
                : t("加一个", "Add one")}
          </button>
        </div>
      )}
      {cityZoom && detailUnavailable && (
        <output className={css.mapNotice}>
          {t(
            "需要联网才能看城市细节 · 全球底图仍可浏览",
            "Connect to view city details · The global map remains available",
          )}
        </output>
      )}
      {!ready && !failure && (
        <output className={css.mapNotice}>{t("正在展开地图…", "Opening your map…")}</output>
      )}
      <fieldset className={css.stateTabs} aria-label={t("足迹状态", "Map states")}>
        {(
          [
            ["now", t("此刻", "Here")],
            ["history", t("来路", "Journey")],
            ["possible", t("可能", "Possibilities")],
          ] as const
        ).map(([id, label]) => (
          <button
            type="button"
            key={id}
            aria-pressed={mode === id}
            onClick={() => {
              onSelect(null);
              setMode(id);
            }}
          >
            {label}
          </button>
        ))}
      </fieldset>
      <fieldset className={css.mapControls} aria-label={t("地图视野", "Map view")}>
        <button
          type="button"
          aria-label={t("放大", "Zoom in")}
          onClick={() => map.current?.zoomIn({ duration: animate() })}
        >
          +
        </button>
        <button
          type="button"
          aria-label={t("缩小", "Zoom out")}
          onClick={() => map.current?.zoomOut({ duration: animate() })}
        >
          −
        </button>
        <button type="button" onClick={onShowList}>
          {t("城市与工具", "Cities and tools")}
        </button>
      </fieldset>
      <span className={css.routeKey}>
        {mode === "possible"
          ? t("虚线 计划 · 点线 AI 建议", "Dashed: planned · Dotted: AI suggestions")
          : t("城市级位置 · 连线表示经历顺序", "City-level locations · Lines show experience order")}
      </span>
    </section>
  );
}
