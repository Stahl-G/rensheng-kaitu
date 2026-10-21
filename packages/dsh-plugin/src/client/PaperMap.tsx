import {
  type GeoJSONSource,
  Map as LibreMap,
  LngLatBounds,
  Marker,
  Popup,
  type StyleSpecification,
  setWorkerUrl,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerSource from "maplibre-gl/dist/maplibre-gl-worker.mjs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Experience } from "../types.js";
import css from "./MapPage.module.css";
import { createMeMarker, tailRotation } from "./footprint-me-marker.js";
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
  cityNames = {},
  previous,
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
  cityNames?: Record<string, string>;
  previous?: Place;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onShowList: () => void;
  showRoutes: boolean;
  showAllPlaces?: boolean;
  asOf: string;
  current?: Place | null;
  onAdd: (state: FootprintState) => void;
}) {
  const t = useT();
  const [mode, setMode] = useState<FootprintState>("now");
  const [ready, setReady] = useState(false);
  const [detailStatus, setDetailStatus] = useState<"loading" | "offline" | "unavailable" | null>(null);
  const [cityZoom, setCityZoom] = useState(false);
  const [failure, setFailure] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<LibreMap | null>(null);
  const meMarker = useRef<Marker | null>(null);
  const originLabel = useRef<Marker | null>(null);
  const cityPopup = useRef<Popup | null>(null);
  const data = useMemo(
    () =>
      footprintData(
        cities.flatMap((c) => c.experiences),
        asOf,
        current,
      ),
    [cities, asOf, current],
  );
  const latest = useRef({
    mode,
    data,
    cities,
    cityNames,
    previous,
    t,
    onSelect,
    selected,
    showRoutes,
    showAllPlaces,
  });
  latest.current = {
    mode,
    data,
    cities,
    cityNames,
    previous,
    t,
    onSelect,
    selected,
    showRoutes,
    showAllPlaces,
  };
  const camera = useCallback((snapshot: Pick<typeof latest.current, "mode" | "data"> = latest.current) => {
    const m = map.current;
    const { mode, data } = snapshot;
    if (!m) return;
    m.stop();
    if (mode === "now" && coordinate(data.me))
      m.flyTo({ center: [data.me.lng, data.me.lat], zoom: 8, duration: animate() });
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
      const width = m.getContainer().clientWidth;
      const height = m.getContainer().clientHeight;
      const base = Math.min(100, width * 0.12, height * 0.15);
      m.fitBounds(bounds, {
        padding: {
          top: base + Math.min(70, height * 0.12),
          right: base,
          bottom: base + Math.min(80, height * 0.14),
          left: base + Math.min(80, width * 0.12),
        },
        maxZoom: 5,
        duration: animate(),
      });
    } else m.flyTo({ center: [20, 20], zoom: 1.5, duration: animate() });
  }, []);
  const update = useCallback(
    (
      m: LibreMap,
      snapshot: Pick<
        typeof latest.current,
        | "mode"
        | "data"
        | "cities"
        | "cityNames"
        | "previous"
        | "t"
        | "showRoutes"
        | "selected"
        | "showAllPlaces"
      > = latest.current,
    ) => {
      const { mode, data, cities, cityNames, previous, t, showRoutes, selected, showAllPlaces } = snapshot;
      const nameOf = (place: Place) => t(cityNames[String(place.geonameid)] ?? place.name, place.name);
      if (!m.getSource("footprint-cities")) return;
      const places = showAllPlaces
        ? data.all
        : mode === "history"
          ? data.history
          : mode === "possible"
            ? data.possible
            : [];
      const yearsByCity = new Map<string, Set<string>>();
      for (const city of cities)
        for (const e of city.experiences) {
          if (e.review || e.fact_status === "inferred" || e.time_precision === "unknown") continue;
          const key = cityKey(e.place);
          const years = yearsByCity.get(key) ?? new Set<string>();
          for (const date of [e.start, e.end]) if (date && /^\d{4}/.test(date)) years.add(date.slice(0, 4));
          yearsByCity.set(key, years);
        }
      (m.getSource("footprint-cities") as GeoJSONSource).setData({
        type: "FeatureCollection",
        features: places.filter(coordinate).map((p) => ({
          type: "Feature",
          properties: {
            id: cityKey(p),
            name: nameOf(p),
            years: [...(yearsByCity.get(cityKey(p)) ?? [])].sort().join(" · "),
            lived: data.lived.some((l) => cityKey(l) === cityKey(p)),
          },
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
      const meLabel = meMarker.current?.getElement().querySelector("span");
      if (meLabel)
        meLabel.textContent = data.me ? t(`我 · ${nameOf(data.me)}`, `Me · ${nameOf(data.me)}`) : "";
      originLabel.current?.remove();
      const origin = data.origin;
      if (mode === "history" && coordinate(origin) && cityKey(origin) !== (data.me && cityKey(data.me))) {
        const label = document.createElement("span");
        label.className = css.cityLabel ?? "";
        label.textContent = t(`起点 · ${nameOf(origin)}`, `Start · ${nameOf(origin)}`);
        originLabel.current = new Marker({ element: label, anchor: "bottom-left", offset: [10, -10] })
          .setLngLat([origin.lng, origin.lat])
          .addTo(m);
      }
      const marker = meMarker.current?.getElement();
      marker?.setAttribute("data-breathe", String(mode === "now"));
      marker?.setAttribute("data-mode", mode);
      marker?.setAttribute(
        "aria-label",
        data.me ? t(`我 · ${nameOf(data.me)}`, `Me · ${nameOf(data.me)}`) : t("我", "Me"),
      );
      const direction = marker?.querySelector("[data-me-direction]");
      direction?.setAttribute("transform", `rotate(${tailRotation(data.me, previous, m.getBearing())})`);
      if (marker) marker.dataset.mapBearing = String(m.getBearing());
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
    let detailSource: string | undefined;
    let attributionInitialized = false;
    let m: LibreMap | undefined;
    let remoteStyle: StyleSpecification | undefined;
    const controller = new AbortController();
    const details = async () => {
      if (!m || m.getZoom() < 5 || remoteLoaded || remoteLoading || !m.isStyleLoaded()) return;
      if (!navigator.onLine) {
        setDetailStatus(navigator.onLine ? "unavailable" : "offline");
        return;
      }
      remoteLoading = true;
      setDetailStatus("loading");
      const generation = styleGeneration;
      try {
        if (!remoteStyle) {
          const response = await fetch("https://tiles.openfreemap.org/styles/positron", {
            signal: controller.signal,
          });
          if (!response.ok) throw new Error("Map style unavailable");
          remoteStyle = (await response.json()) as StyleSpecification;
        }
        if (disposed || generation !== styleGeneration || !m.isStyleLoaded() || m.getZoom() < 5) return;
        const vector = Object.entries(remoteStyle.sources).find(([, source]) => source.type === "vector");
        if (!vector || vector[1].type !== "vector") throw new Error("Vector map unavailable");
        const [id, source] = vector;
        detailSource = id;
        if (!m.getSource(id)) m.addSource(id, { ...source, minzoom: 5 });
        const water = isDark() ? "#1c293c" : "#27495e";
        if (!m.getLayer("detail-water"))
          m.addLayer(
            {
              id: "detail-water",
              type: "fill",
              source: id,
              "source-layer": "water",
              minzoom: 5,
              filter: ["!=", ["get", "brunnel"], "tunnel"],
              paint: {
                "fill-color": water,
                "fill-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0, 7, 1],
              },
            },
            "footprint-history",
          );
        if (!m.getLayer("detail-river"))
          m.addLayer(
            {
              id: "detail-river",
              type: "line",
              source: id,
              "source-layer": "waterway",
              minzoom: 6,
              filter: ["all", ["==", ["get", "class"], "river"], ["!=", ["get", "brunnel"], "tunnel"]],
              layout: { "line-cap": "round", "line-join": "round" },
              paint: {
                "line-color": water,
                "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.5, 8, 0.7, 12, 1.2],
                "line-opacity": 0.9,
              },
            },
            "footprint-history",
          );
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
                "hillshade-exaggeration": isDark() ? 0.12 : 0.18,
              },
            },
            "detail-water",
          );
        remoteLoaded = true;
      } catch {
        if (!disposed) setDetailStatus(navigator.onLine ? "unavailable" : "offline");
      } finally {
        remoteLoading = false;
        if (!disposed && generation !== styleGeneration) void details();
      }
    };
    const loadStyle = () => {
      cityPopup.current?.remove();
      ++styleGeneration;
      if (disposed) return;
      const style = structuredClone(isDark() ? dark : light) as StyleSpecification;
      remoteLoaded = false;
      detailSource = undefined;
      m?.setStyle(style, { diff: false });
    };
    try {
      m = new LibreMap({
        container: el,
        center: [20, 20],
        zoom: 1.5,
        maxZoom: 12,
        attributionControl: {
          compact: true,
          customAttribution: '<a href="https://www.naturalearthdata.com/">Natural Earth</a>',
        },
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
              "line-color": isDark() ? "#ffffff" : "#263f64",
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
            "circle-radius": ["case", ["get", "lived"], 2.5, 1.5],
            "circle-color": "rgba(255,255,255,0)",
            "circle-stroke-color": isDark() ? "#fff" : "#263f64",
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
            "circle-stroke-color": isDark() ? "#fff" : "#263f64",
            "circle-stroke-width": 1,
          },
        });
        // One persistent A marker; positioning is owned by MapLibre, rotation and glow by its children.
        if (!meMarker.current) {
          const marker = createMeMarker(
            css.meMarker ?? "",
            css.meIcon ?? "",
            css.meGlow ?? "",
            css.cityLabel ?? "",
          );
          meMarker.current = new Marker({ element: marker });
        }
        update(instance);
        setReady(true);
        void details();
      });
      m.on("rotate", () => {
        const marker = meMarker.current?.getElement();
        marker
          ?.querySelector("[data-me-direction]")
          ?.setAttribute(
            "transform",
            `rotate(${tailRotation(latest.current.data.me, latest.current.previous, instance.getBearing())})`,
          );
        if (marker) marker.dataset.mapBearing = String(instance.getBearing());
      });
      const finishDetails = () => {
        if (remoteLoaded && detailSource && instance.isSourceLoaded(detailSource))
          setDetailStatus((status) => (status === "loading" ? null : status));
      };
      m.on("idle", () => {
        finishDetails();
        if (!attributionInitialized) {
          const attribution = el.querySelector(
            ".maplibregl-ctrl-attrib.maplibregl-compact:not(.maplibregl-attrib-empty)",
          );
          if (attribution) {
            attribution.classList.remove("maplibregl-compact-show");
            attributionInitialized = true;
          }
        }
        setCityZoom(instance.getZoom() >= 6);
        void details();
      });
      m.on("zoomend", () => {
        setCityZoom(instance.getZoom() >= 6);
        void details();
      });
      m.on("error", (e) => {
        if ("sourceId" in e && e.sourceId === "paper-earth") setFailure(true);
        else setDetailStatus(navigator.onLine ? "unavailable" : "offline");
      });
      const popup = new Popup({ closeButton: false, closeOnClick: false, offset: 12 });
      cityPopup.current = popup;
      const showCity = (e: { point: { x: number; y: number }; lngLat: { lng: number; lat: number } }) => {
        const feature = instance.queryRenderedFeatures([e.point.x, e.point.y], {
          layers: ["footprint-cities"],
        })[0];
        if (!feature) {
          popup.remove();
          return;
        }
        const content = document.createElement("div");
        content.className = css.cityPopup ?? "";
        content.textContent = `${feature.properties?.name} · ${feature.properties?.years || latest.current.t("时间未知", "Undated")}`;
        popup.setLngLat(e.lngLat).setDOMContent(content).addTo(instance);
      };
      m.on("mousemove", showCity);
      m.on("mouseout", () => popup.remove());
      m.on("click", (e) => {
        showCity(e);
        const features = instance.queryRenderedFeatures([e.point.x, e.point.y], {
          layers: ["footprint-cities"],
        });
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
    const offline = () => setDetailStatus("offline");
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
      originLabel.current?.remove();
      cityPopup.current?.remove();
      cityPopup.current = null;
      meMarker.current = null;
      map.current = null;
      m?.remove();
      URL.revokeObjectURL(worker);
    };
  }, [update]);
  const cameraKey = JSON.stringify(
    mode === "now"
      ? [mode, data.me?.lng, data.me?.lat]
      : mode === "history"
        ? [
            mode,
            data.history.map((p) => [p.lng, p.lat]),
            data.routes.features
              .filter((f) => f.properties.kind === "history")
              .map((f) => [f.geometry.coordinates[0], f.geometry.coordinates.at(-1)]),
          ]
        : [mode],
  );
  useEffect(() => {
    if (map.current && ready && cameraKey) camera();
  }, [cameraKey, ready, camera]);
  useEffect(() => {
    if (map.current && ready)
      update(map.current, {
        mode,
        data,
        cities,
        cityNames,
        previous,
        t,
        selected,
        showRoutes,
        showAllPlaces,
      });
  }, [mode, data, cities, cityNames, previous, t, selected, showRoutes, showAllPlaces, ready, update]);
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
            {t(cityNames[String(data.me.geonameid)] ?? data.me.name, data.me.name)} ·{" "}
            {t("最近的居住记录", "Latest residence record")}
          </p>
        )}
        {mode === "history" && data.undated > 0 && (
          <p>
            {t(
              `另有 ${data.undated} 段居住记录未注明时间`,
              `${data.undated} residences with unspecified dates`,
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
      {cityZoom && detailStatus && (
        <output className={css.mapNotice}>
          {detailStatus === "loading"
            ? t("正在加载城市细节…", "Loading city details…")
            : detailStatus === "offline"
              ? t(
                  "需要联网才能看城市细节 · 全球底图仍可浏览",
                  "Connect to view city details · The global map remains available",
                )
              : t(
                  "城市细节暂不可用 · 全球底图仍可浏览",
                  "City details are temporarily unavailable · The global map remains available",
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
              cityPopup.current?.remove();
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
        <button type="button" className={css.listToggle} onClick={onShowList}>
          {t("城市与工具", "Cities and tools")}
        </button>
      </fieldset>
      <span className={css.routeKey}>
        {mode === "now"
          ? t("城市级位置 · 现居记录", "City-level record · Current residence")
          : mode === "possible"
            ? t("虚线 计划 · 点线 AI 建议", "Dashed: planned · Dotted: AI suggestions")
            : t("城市级位置 · 连线表示经历顺序", "City-level locations · Lines show experience order")}
      </span>
    </section>
  );
}
