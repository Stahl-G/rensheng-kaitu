import { PARAMETER_PORTS, STYLE_PORTS, settings } from "@kaitu/cartographer/settings";
import type { AtlasAction, AtlasGenerateInput, LifeAtlasState, MapSettings } from "@kaitu/core";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import css from "./LifeAtlasPage.module.css";
import { useLocale, useT } from "./i18n.js";

export interface LifeAtlasPageProps {
  loadLifeAtlas: (id?: string, refresh?: boolean, knownResourceId?: string) => Promise<LifeAtlasState>;
  loadLifeAtlasProgress?: () => Promise<{ running: boolean; progress: number }>;
  generateLifeAtlas: (input: AtlasGenerateInput) => Promise<LifeAtlasState>;
  changeLifeAtlas: (id: string, action: AtlasAction) => Promise<LifeAtlasState>;
  subscribe?: (refresh: () => void) => () => void;
}
const styleNames: Record<string, readonly [string, string]> = {
  fantasy: ["奇幻羊皮", "Fantasy"],
  ink: ["水墨", "Ink"],
  topo: ["地形", "Topographic"],
  teyvat: ["Teyvat（上游主题）", "Teyvat (upstream theme)"],
  physical: ["自然地理", "Physical"],
  nautical: ["航海", "Nautical"],
  political: ["政区", "Political"],
  strategy: ["战略", "Strategy"],
};
const parameterNames = {
  landRatio: "Land area",
  mountains: "Relief",
  coastRoughness: "Coastline",
  erosion: "Erosion",
  rainfall: "Rainfall",
  plates: "Tectonic plates",
};
const colors = ["#7d8f65", "#ad885a", "#8b9a88", "#b3966d", "#8a9c9f", "#b08a80"];
/** Keep the map's available height stable when its scroll container moves. */
export function mapAvailableHeight(viewportHeight: number, mapTop: number, scrollTop: number): number {
  return Math.max(200, viewportHeight - (mapTop + scrollTop) - 16);
}
/** Fits long Chinese/Latin labels into two lines; full names remain in accessible region controls. */
export function atlasLabel(title: string): string[] {
  const lines: string[] = [];
  let line = "";
  let width = 0;
  for (const ch of title) {
    const size = ch.charCodeAt(0) <= 255 ? 0.55 : 1;
    if (width + size > 8) {
      lines.push(line);
      line = "";
      width = 0;
    }
    line += ch;
    width += size;
  }
  if (line) lines.push(line);
  return lines.length > 2 ? [lines[0] ?? "", `${[...(lines[1] ?? "")].slice(0, -1).join("")}…`] : lines;
}
export function LifeAtlasPage({
  loadLifeAtlas,
  loadLifeAtlasProgress,
  generateLifeAtlas,
  changeLifeAtlas,
  subscribe,
}: LifeAtlasPageProps) {
  const t = useT();
  const locale = useLocale();
  const [state, setState] = useState<LifeAtlasState | null>(null);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [history, setHistory] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [mapHeight, setMapHeight] = useState(400);
  const mapFrame = useRef<HTMLDivElement>(null);
  const [deleting, setDeleting] = useState<string>();
  const [config, setConfig] = useState<MapSettings>(() => settings());
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<string>();
  const [keepTerrain, setKeepTerrain] = useState(true);
  const [hover, setHover] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const initialized = useRef(false);
  const request = useRef(0);
  const pendingCandidate = useRef(false);
  const cachedResource = useRef<Pick<LifeAtlasState, "resourceId" | "resource">>({ resourceId: null });
  const regionElements = useRef(new Map<string, SVGPathElement>());
  const apply = useCallback((value: LifeAtlasState) => {
    if (value.resource !== undefined) cachedResource.current = value;
    setState({
      ...value,
      resource: value.resource === undefined ? cachedResource.current.resource : value.resource,
    });
    setError("");
    if (!initialized.current && !value.loading && !value.error) {
      const current = value.candidates.find((c) => c.id === value.active);
      setConfig(current?.settings ?? settings());
      setSelected(
        current?.domains ??
          value.modules
            .filter((m) => m.recommended)
            .slice(0, 12)
            .map((m) => m.id),
      );
      initialized.current = true;
    }
    if (pendingCandidate.current && !value.running) {
      pendingCandidate.current = false;
      if (!value.error && value.latest && value.latest !== value.active) setPreview(value.latest);
      if (!value.error) setExpanded(false);
    }
  }, []);
  const refresh = useCallback(
    (reload = false) => {
      const id = ++request.current;
      void loadLifeAtlas(preview, reload, cachedResource.current.resourceId ?? undefined)
        .then((value) => {
          if (request.current === id) apply(value);
        })
        .catch((err) => {
          if (request.current === id) setError(String(err.message ?? err));
        });
    },
    [loadLifeAtlas, preview, apply],
  );
  useEffect(() => {
    refresh();
    return () => {
      request.current++;
    };
  }, [refresh]);
  useEffect(() => subscribe?.(refresh), [subscribe, refresh]);
  useEffect(() => {
    if (!state?.loading && !state?.running) return;
    let cancelled = false;
    const poll = () => {
      if (!state.running || !loadLifeAtlasProgress) return refresh();
      void loadLifeAtlasProgress()
        .then((progress) => {
          if (cancelled) return;
          setState((prior) => prior && { ...prior, ...progress });
          if (!progress.running) refresh();
        })
        .catch(() => {
          if (!cancelled) refresh();
        });
    };
    const timer = setInterval(poll, 1200);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [state?.loading, state?.running, refresh, loadLifeAtlasProgress]);
  // Recheck only when an active light expires; opening the map also reads current data.
  useEffect(() => {
    const deadlines = (state?.domains ?? [])
      .filter((domain) => domain.score.glow)
      .flatMap((domain) => domain.facts.map((fact) => Date.parse(fact.actualActivityAt ?? "")))
      .filter((time) => Number.isFinite(time) && time <= Date.now() && time + 7 * 86400000 > Date.now())
      .map((time) => time + 7 * 86400000);
    if (!deadlines.length) return;
    const timer = setTimeout(refresh, Math.max(0, Math.min(...deadlines) - Date.now()) + 50);
    return () => clearTimeout(timer);
  }, [state?.domains, refresh]);
  const resource = state?.resource;
  useEffect(() => {
    if (!resource || typeof window === "undefined") return;
    const measure = () => {
      const map = mapFrame.current;
      if (!map) return;
      let root = map.parentElement;
      while (root && !/(auto|scroll)/.test(window.getComputedStyle(root).overflowY))
        root = root.parentElement;
      if (root) {
        const top = map.getBoundingClientRect().top - root.getBoundingClientRect().top - root.clientTop;
        setMapHeight(mapAvailableHeight(root.clientHeight, top, root.scrollTop));
      } else {
        const scrolling = document.scrollingElement;
        setMapHeight(
          mapAvailableHeight(window.innerHeight, map.getBoundingClientRect().top, scrolling?.scrollTop ?? 0),
        );
      }
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    const section = mapFrame.current?.closest("section");
    if (section) observer?.observe(section);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [resource]);
  const nativeSvg = resource?.svg;
  const image = useMemo(
    () => (nativeSvg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(nativeSvg)}` : ""),
    [nativeSvg],
  );
  const detail = state?.domains.find((domain) => domain.id === (pinned ?? hover));
  const current = state?.candidates.find((c) => c.id === state.active);
  const omitted = state?.modules.filter((m) => !state.domains.some((d) => d.id === m.id)) ?? [];
  const start = async () => {
    setError("");
    pendingCandidate.current = true;
    try {
      request.current++;
      setPreview(undefined);
      apply(
        await generateLifeAtlas({
          domains: selected,
          settings: config,
          sameTerrain: !!current && keepTerrain,
        }),
      );
    } catch (err) {
      pendingCandidate.current = false;
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  const change = async (id: string, action: AtlasAction) => {
    try {
      request.current++;
      const value = await changeLifeAtlas(id, action);
      setPreview(undefined);
      setPinned(null);
      setDeleting(undefined);
      apply(value);
      if (action === "adopt") {
        const c = value.candidates.find((item) => item.id === id);
        if (c) {
          setSelected(c.domains);
          setConfig(c.settings);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      try {
        apply(await loadLifeAtlas());
      } catch {
        /* retain the action error */
      }
      setError(message);
    }
  };
  const close = () => {
    const id = pinned ?? hover;
    setPinned(null);
    setHover(null);
    if (id) regionElements.current.get(id)?.focus();
  };
  const settingsPanel = (
    <div className={`${css.settings} ${resource ? css.sidebar : ""}`}>
      <fieldset disabled={state?.running || state?.loading}>
        <legend>
          {t("选择入图的模块", "Choose areas to map")} · {selected.length}/12
        </legend>
        <div className={css.modules}>
          {state?.modules.map((m) => (
            <label key={m.id}>
              <input
                type="checkbox"
                checked={selected.includes(m.id)}
                disabled={selected.length >= 12 && !selected.includes(m.id)}
                onChange={(event) =>
                  setSelected((ids) =>
                    event.target.checked ? [...ids, m.id] : ids.filter((id) => id !== m.id),
                  )
                }
              />
              <span>
                {m.title}
                <small>
                  {m.available ? t("已有资料", "Records available") : t("资料待补充", "No details yet")}
                </small>
              </span>
            </label>
          ))}
        </div>
        {selected.length > 0 && (
          <ol className={css.order}>
            {selected.map((id, i) => (
              <li key={id}>
                <span>{state?.modules.find((m) => m.id === id)?.title ?? id}</span>
                <button
                  type="button"
                  disabled={i === 0 || (!!current && keepTerrain)}
                  aria-label={t(
                    `将 ${state?.modules.find((m) => m.id === id)?.title ?? id} 提前`,
                    `Move ${id} earlier`,
                  )}
                  onClick={() =>
                    setSelected((ids) => {
                      const next = [...ids];
                      [next[i - 1], next[i]] = [next[i] as string, next[i - 1] as string];
                      return next;
                    })
                  }
                >
                  ↑
                </button>
              </li>
            ))}
          </ol>
        )}
        {!state?.modules.length && !state?.loading && (
          <p>{t("还没有可入图的模块。", "No areas are available yet.")}</p>
        )}
      </fieldset>
      <fieldset disabled={state?.running}>
        <legend>{t("地图样式", "Map style")}</legend>
        <label>
          {t("风格", "Style")}
          <select
            value={config.style}
            onChange={(event) => setConfig({ ...config, style: event.target.value as MapSettings["style"] })}
          >
            {STYLE_PORTS.map((style) => (
              <option key={style} value={style}>
                {t(...(styleNames[style] ?? [style, style]))}
              </option>
            ))}
          </select>
        </label>
        {current && (
          <label className={css.check}>
            <input
              type="checkbox"
              checked={keepTerrain}
              onChange={(event) => {
                setKeepTerrain(event.target.checked);
                if (event.target.checked && current)
                  setConfig({ ...config, terrain: current.settings.terrain });
              }}
            />
            {t("保留当前地形与区域位置", "Keep current terrain and region positions")}
          </label>
        )}
        <div className={css.parameters}>
          {Object.entries(PARAMETER_PORTS).map(([key, spec]) => (
            <label key={key}>
              {t(spec.label, parameterNames[key as keyof typeof parameterNames])}
              <output>
                {config.terrain[key as keyof MapSettings["terrain"]].toFixed("integer" in spec ? 0 : 2)}
              </output>
              <input
                aria-label={t(spec.label, parameterNames[key as keyof typeof parameterNames])}
                type="range"
                min={spec.min}
                max={spec.max}
                step={"integer" in spec ? 1 : 0.01}
                disabled={!!current && keepTerrain}
                value={config.terrain[key as keyof MapSettings["terrain"]]}
                onChange={(event) =>
                  setConfig({
                    ...config,
                    terrain: { ...config.terrain, [key]: Number(event.target.value) },
                  })
                }
              />
            </label>
          ))}
        </div>
        <label>
          {t("地形纹理", "Terrain detail")}
          <input
            type="range"
            min="0"
            max="1"
            step=".05"
            value={config.glyphDensity}
            onChange={(event) => setConfig({ ...config, glyphDensity: Number(event.target.value) })}
          />
        </label>
        <button
          type="button"
          className={css.primary}
          disabled={state?.running || state?.loading || !selected.length || selected.length > 12}
          onClick={() => void start()}
        >
          {state?.running
            ? t("正在生成…", "Generating…")
            : current
              ? t("生成新方案并保存", "Generate and save a candidate")
              : t("生成我的地图", "Generate my map")}
        </button>
      </fieldset>
    </div>
  );
  if (!state && !error) return <output>{t("正在读取地图…", "Opening your map…")}</output>;
  return (
    <section className={css.page} aria-label={t("人生地图", "Life map")}>
      <header className={css.toolbar}>
        <div>
          <h2>
            {resource ? t("我的人生地图", "My life map") : t("生成你的人生地图", "Create your life map")}
          </h2>
        </div>
        {resource && (
          <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
            {t("调整地图", "Customize")}
          </button>
        )}
        {!!state?.candidates.length && (
          <button type="button" aria-expanded={history} onClick={() => setHistory(!history)}>
            {t("地图存档", "Map history")} · {state.candidates.length}
          </button>
        )}
      </header>
      {(error || state?.error) && (
        <p className={css.error} role="alert">
          {error || state?.error}{" "}
          <button
            type="button"
            onClick={() => (state?.errorKind === "generate" ? void start() : refresh(true))}
          >
            {state?.errorKind === "generate" ? t("重新生成", "Generate again") : t("重试读取", "Retry")}
          </button>
        </p>
      )}
      {!resource && settingsPanel}
      {(state?.loading || state?.running) && (
        <output className={css.status}>
          {state.running
            ? t("正在绘制地形…", "Drawing terrain…")
            : t("正在更新模块资料…", "Refreshing module records…")}
          {state.running && <progress max="1" value={state.progress} />}
        </output>
      )}
      {preview && preview !== state?.active && (
        <div className={css.notice}>
          {t("正在预览已保存的新方案", "Previewing a saved candidate")}
          <button type="button" onClick={() => void change(preview, "adopt")}>
            {t("用这张地图", "Use this map")}
          </button>
          <button type="button" onClick={() => setPreview(undefined)}>
            {t("返回当前地图", "Back to current map")}
          </button>
        </div>
      )}
      {resource && (
        <div className={css.workspace} style={{ "--map-height": `${mapHeight}px` } as CSSProperties}>
          <div className={css.mapLayout}>
            <div
              className={css.map}
              ref={mapFrame}
              style={{ maxWidth: (mapHeight * resource.width) / resource.height }}
            >
              <div className={css.mapViewport}>
                <svg
                  viewBox={`0 0 ${resource.width} ${resource.height}`}
                  aria-label={t("人生地图区域", "Life map regions")}
                  className={css.canvas}
                  style={{
                    width: `min(${zoom * 100}%, ${(mapHeight * zoom * resource.width) / resource.height}px)`,
                  }}
                >
                  <title>
                    {t(
                      "人生地图：用 Tab 选择区域，回车查看，Esc 关闭",
                      "Life map: Tab to a region, Enter to open, Escape to close",
                    )}
                  </title>
                  <image href={image} width={resource.width} height={resource.height} />
                  <g transform={`translate(${resource.margin} ${resource.margin})`}>
                    {resource.regions.provinces.map((p) => (
                      <path
                        key={p.slot}
                        d={p.path}
                        fill="#efe5ca"
                        fillOpacity={
                          0.78 * (1 - (state?.domains.find((d) => d.slot === p.slot)?.score.clarity ?? 0.12))
                        }
                        fillRule="evenodd"
                        pointerEvents="none"
                      />
                    ))}
                    <path
                      d={resource.regions.borders}
                      fill="none"
                      stroke="#8b7758"
                      strokeWidth=".9"
                      opacity=".24"
                      pointerEvents="none"
                    />
                    {state?.domains.map((d) => {
                      const p = resource.regions.provinces[d.slot];
                      if (!p) return null;
                      return (
                        <path
                          key={d.id}
                          ref={(node) => {
                            if (node) regionElements.current.set(d.id, node);
                            else regionElements.current.delete(d.id);
                          }}
                          className={css.province}
                          d={p.path}
                          fill={colors[d.slot % colors.length]}
                          fillOpacity=".13"
                          fillRule="evenodd"
                          stroke="#86724f"
                          strokeWidth="1.1"
                          strokeOpacity=".55"
                          // biome-ignore lint/a11y/useSemanticElements: SVG paths implement keyboard and focus behavior for province buttons.
                          role="button"
                          tabIndex={0}
                          aria-label={d.title}
                          aria-pressed={pinned === d.id}
                          onMouseEnter={() => setHover(d.id)}
                          onMouseLeave={() => setHover(null)}
                          onFocus={() => setHover(d.id)}
                          onBlur={() => setHover(null)}
                          onClick={() => setPinned(pinned === d.id ? null : d.id)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setPinned(d.id);
                            }
                            if (event.key === "Escape") {
                              setPinned(null);
                              setHover(null);
                            }
                          }}
                        >
                          <title>{d.title}</title>
                        </path>
                      );
                    })}
                    {state?.domains.map((d) => {
                      const p = resource.regions.provinces[d.slot];
                      if (!p) return null;
                      const lines = atlasLabel(d.title);
                      return (
                        <g key={d.id} pointerEvents="none">
                          {!!d.score.glow && (
                            <circle
                              cx={p.x + 26}
                              cy={p.y - 32}
                              r="7"
                              fill="#d69330"
                              stroke="#fff1c4"
                              strokeWidth="3"
                            />
                          )}
                          <path
                            d={`M${p.x} ${p.y - 32 - (lines.length - 1) * 28}l4 5-4 5-4-5Z`}
                            fill="#826b44"
                          />
                          {lines.map((line, i) => (
                            <text
                              key={`${i}-${line}`}
                              x={p.x}
                              y={p.y - 5 - (lines.length - 1 - i) * 28}
                              textAnchor="middle"
                              fontFamily="Songti SC, SimSun, Microsoft YaHei, Noto Serif CJK SC, serif"
                              fontSize="26"
                              fontWeight="600"
                              fill={resource.settings.style === "teyvat" ? "#fbf7e8" : "#493a29"}
                              stroke={resource.settings.style === "teyvat" ? "#244840" : "#efe2bf"}
                              strokeWidth="4"
                              paintOrder="stroke"
                            >
                              {line}
                            </text>
                          ))}
                        </g>
                      );
                    })}
                    <g
                      transform={`translate(${resource.compass.cx} ${resource.compass.cy})`}
                      pointerEvents="none"
                    >
                      <circle r="30" fill="#eadbb6" stroke="#b2a480" strokeWidth="2" />
                      <path d="M0 -22L6 0 0 22 -6 0Z" fill="#6f8056" stroke="#4f593e" strokeWidth="1" />
                    </g>
                  </g>
                </svg>
              </div>
              <nav className={css.zoomControls} aria-label={t("地图缩放", "Map zoom")}>
                <button
                  type="button"
                  aria-label={t("缩小地图", "Zoom out")}
                  disabled={zoom <= 1}
                  onClick={() => setZoom((value) => Math.max(1, value - 0.25))}
                >
                  −
                </button>
                <button type="button" onClick={() => setZoom(1)}>
                  {t("适应窗口", "Fit")}
                </button>
                <button
                  type="button"
                  aria-label={t("放大地图", "Zoom in")}
                  disabled={zoom >= 3}
                  onClick={() => setZoom((value) => Math.min(3, value + 0.25))}
                >
                  +
                </button>
              </nav>
              {detail && !pinned && (
                <output className={css.hover}>
                  <strong>{detail.title}</strong>
                  <span>{detail.facts[0]?.title ?? t("资料待补充", "No details yet")}</span>
                </output>
              )}
            </div>
            {detail && pinned && (
              <aside
                className={css.detail}
                aria-label={detail.title}
                onKeyDown={(event) => {
                  if (event.key === "Escape") close();
                }}
              >
                <button type="button" className={css.close} onClick={close}>
                  {t("关闭", "Close")} ×
                </button>
                <h3>{detail.title}</h3>
                {detail.facts.length ? (
                  <ul>
                    {detail.facts.map((fact) => (
                      <li key={fact.id}>
                        <span>{fact.title}</span>
                        <small>
                          {fact.updated?.slice(0, 10) ?? t("日期待补充", "Undated")} ·{" "}
                          {fact.status === "needs_review" || fact.status === "unknown"
                            ? t("待核实", "Unverified")
                            : fact.kind === "goal" || fact.kind === "plan"
                              ? t("目标与计划", "Goal / plan")
                              : t("资料记录", "Recorded")}
                        </small>
                        <small className={css.source}>{fact.source}</small>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>{t("这个领域还没有资料。", "No records in this area yet.")}</p>
                )}
              </aside>
            )}
          </div>
          {expanded && settingsPanel}
        </div>
      )}
      {resource && !!omitted.length && (
        <div className={css.omitted}>
          <span>
            {t("尚未入图", "Not on this map")} · {omitted.map((m) => m.title).join(" · ")}
          </span>
          <button type="button" onClick={() => setExpanded(true)}>
            {t("选择模块", "Choose areas")}
          </button>
        </div>
      )}
      {!!state?.gaps.length && (
        <p className={css.error}>
          {t("以下资料尚不可读取：", "These records could not be read: ")}
          {state.gaps.join(" · ")}
        </p>
      )}
      {history && (
        <section className={css.history} aria-label={t("地图存档", "Map history")}>
          <h3>{t("地图存档", "Map history")}</h3>
          {state?.storage && (
            <p>
              {state.storage.count}/{state.storage.maxCount} · {(state.storage.bytes / 1024 ** 2).toFixed(1)}{" "}
              / {state.storage.maxBytes / 1024 ** 2} MiB
            </p>
          )}
          {deleting && (
            <div role="alertdialog" aria-label={t("永久删除地图", "Permanently delete map")}>
              <p>
                {t(
                  "永久删除这张已移除的地图？删除后无法恢复。你的资料和当前地图会保留。",
                  "Permanently delete this removed map? This cannot be undone. Your records and current map will be kept.",
                )}
              </p>
              <p>
                {new Date(state?.candidates.find((c) => c.id === deleting)?.createdAt ?? "").toLocaleString(
                  locale,
                )}
              </p>
              <button type="button" onClick={() => setDeleting(undefined)}>
                {t("取消", "Cancel")}
              </button>
              <button type="button" disabled={state?.running} onClick={() => void change(deleting, "delete")}>
                {t("确认永久删除", "Delete permanently")}
              </button>
            </div>
          )}
          {[...(state?.candidates ?? [])].reverse().map((c) => (
            <div key={c.id}>
              <span>
                {new Date(c.createdAt).toLocaleString(locale)} ·{" "}
                {t(...(styleNames[c.settings.style] ?? [c.settings.style, c.settings.style]))}
                {c.id === state?.active ? t(" · 当前", " · Current") : ""}
                {c.archived ? t(" · 已移除", " · Removed") : ""}
              </span>
              {c.archived ? (
                <>
                  <button type="button" disabled={c.deleting} onClick={() => void change(c.id, "restore")}>
                    {t("恢复", "Restore")}
                  </button>
                  <button type="button" disabled={state?.running} onClick={() => setDeleting(c.id)}>
                    {c.deleting ? t("重试永久删除", "Retry deletion") : t("永久删除", "Delete permanently")}
                  </button>
                </>
              ) : (
                c.id !== state?.active && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setPreview(c.id);
                        setPinned(null);
                      }}
                    >
                      {t("预览", "Preview")}
                    </button>
                    <button type="button" onClick={() => void change(c.id, "adopt")}>
                      {t("使用", "Use")}
                    </button>
                    <button type="button" onClick={() => void change(c.id, "archive")}>
                      {t("移除", "Remove")}
                    </button>
                  </>
                )
              )}
            </div>
          ))}
        </section>
      )}
    </section>
  );
}
