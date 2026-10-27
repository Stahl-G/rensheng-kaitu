import { PARAMETER_PORTS, STYLE_PORTS, settings } from "@kaitu/cartographer/settings";
import type { AtlasGenerateInput, LifeAtlasState, MapSettings } from "@kaitu/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import css from "./LifeAtlasPage.module.css";
import { useLocale, useT } from "./i18n.js";

export interface LifeAtlasPageProps {
  loadLifeAtlas: (id?: string, refresh?: boolean) => Promise<LifeAtlasState>;
  generateLifeAtlas: (input: AtlasGenerateInput) => Promise<LifeAtlasState>;
  changeLifeAtlas: (id: string, action: "adopt" | "archive" | "restore") => Promise<LifeAtlasState>;
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
  const [config, setConfig] = useState<MapSettings>(() => settings());
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<string>();
  const [keepTerrain, setKeepTerrain] = useState(true);
  const [hover, setHover] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const initialized = useRef(false);
  const request = useRef(0);
  const pendingCandidate = useRef(false);
  const regionElements = useRef(new Map<string, SVGPathElement>());
  const apply = useCallback((value: LifeAtlasState) => {
    setState(value);
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
      void loadLifeAtlas(preview, reload)
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
    const timer = setInterval(refresh, 1200);
    return () => clearInterval(timer);
  }, [state?.loading, state?.running, refresh]);
  // Freshness changes with time even when no record is uploaded.
  useEffect(() => {
    const timer = setInterval(refresh, 60_000);
    return () => clearInterval(timer);
  }, [refresh]);
  const resource = state?.resource;
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
  const change = async (id: string, action: "adopt" | "archive" | "restore") => {
    try {
      request.current++;
      const value = await changeLifeAtlas(id, action);
      setPreview(undefined);
      setPinned(null);
      apply(value);
      if (action === "adopt") {
        const c = value.candidates.find((item) => item.id === id);
        if (c) {
          setSelected(c.domains);
          setConfig(c.settings);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  const close = () => {
    const id = pinned ?? hover;
    setPinned(null);
    setHover(null);
    if (id) regionElements.current.get(id)?.focus();
  };
  if (!state && !error) return <output>{t("正在读取地图…", "Opening your map…")}</output>;
  return (
    <section className={css.page} aria-label={t("人生地图", "Life map")}>
      <header className={css.toolbar}>
        <div>
          <h2>
            {resource ? t("我的人生地图", "My life map") : t("生成你的人生地图", "Create your life map")}
          </h2>
          <p>
            {resource
              ? t("移到区域上查看，点击后展开资料。", "Hover to explore; click a region for its records.")
              : t(
                  "从你关心的模块开始，让资料逐渐成图。",
                  "Start with the areas you care about. Let your records fill the map.",
                )}
          </p>
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
          <button type="button" onClick={() => refresh(true)}>
            {t("重试读取", "Retry")}
          </button>
        </p>
      )}
      {(!resource || expanded) && (
        <div className={css.settings}>
          <fieldset disabled={state?.running || state?.loading}>
            <legend>
              {t("选择入图的模块", "Choose areas to map")} · {selected.length}/12
            </legend>
            <p>
              {t(
                "前两个区域靠近中心。未选择的模块仍保留在开图里。",
                "The first two areas sit near the center. Other modules remain available in Kaitu.",
              )}
            </p>
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
              <p>
                {t(
                  "还没有可入图的模块。先在「全部模块」或资料里选择关注的领域。",
                  "No areas are available yet. Choose your interests in All modules or add records first.",
                )}
              </p>
            )}
          </fieldset>
          <fieldset disabled={state?.running}>
            <legend>{t("地图样式", "Map style")}</legend>
            <label>
              {t("风格", "Style")}
              <select
                value={config.style}
                onChange={(event) =>
                  setConfig({ ...config, style: event.target.value as MapSettings["style"] })
                }
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
            <small>
              {t(
                "每次生成都会存档。换回旧图，资料仍显示最新内容。",
                "Every candidate is saved. Older maps always show your latest records.",
              )}
            </small>
          </fieldset>
        </div>
      )}
      {(state?.loading || state?.running) && (
        <output className={css.status}>
          {state.running
            ? t("正在绘制地形，完成后会自动存档…", "Drawing terrain; the result will be saved automatically…")
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
        <div className={css.mapLayout}>
          <div className={css.map}>
            <svg
              viewBox={`0 0 ${resource.width} ${resource.height}`}
              aria-label={t("人生地图区域", "Life map regions")}
              className={css.canvas}
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
                      <path d={`M${p.x} ${p.y - 32 - (lines.length - 1) * 28}l4 5-4 5-4-5Z`} fill="#826b44" />
                      {lines.map((line, i) => (
                        <text
                          key={`${i}-${line}`}
                          x={p.x}
                          y={p.y - 5 - (lines.length - 1 - i) * 28}
                          textAnchor="middle"
                          fontFamily="Songti SC, Noto Serif CJK SC, serif"
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
                  <circle r="34" fill="none" stroke="#b2a480" strokeWidth="3.5" />
                  <circle
                    r="34"
                    fill="none"
                    stroke="#6f8056"
                    strokeWidth="4.5"
                    strokeDasharray={2 * Math.PI * 34}
                    strokeDashoffset={2 * Math.PI * 34 * (1 - (state?.coverage ?? 0))}
                    transform="rotate(-90)"
                  />
                  <circle r="21" fill="#eadbb6" />
                  <text textAnchor="middle" y="5" fontSize="14" fill="#4f593e">
                    {state?.coverage === null ? "—" : `${Math.round((state?.coverage ?? 0) * 100)}%`}
                  </text>
                  <text textAnchor="middle" y="61" fontSize="14" fill="#7c6d50">
                    {t("档案完善度", "Profile coverage")}
                  </text>
                </g>
              </g>
            </svg>
            {detail && !pinned && (
              <output className={css.hover}>
                <strong>{detail.title}</strong>
                <span>{detail.facts[0]?.title ?? t("资料待补充", "No details yet")}</span>
                <small>{t("点击展开资料", "Click to open records")}</small>
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
              <p>
                {t("档案完善度", "Profile coverage")} ·{" "}
                {detail.score.coverage === null
                  ? t("待了解", "Not assessed")
                  : `${Math.round(detail.score.coverage * 100)}%`}
              </p>
              <small>
                {detail.temporal.kind === "historical"
                  ? t("来路经历保留，不随时间变淡。", "Past experiences stay clear over time.")
                  : detail.score.latest
                    ? t(
                        `最近资料：${detail.score.latest}；时间越久，地图逐渐变淡。`,
                        `Latest record: ${detail.score.latest}. Older records gradually fade.`,
                      )
                    : t(
                        "资料日期待补充，不能判断近期状态。",
                        "Dates are missing; current status is unknown.",
                      )}
              </small>
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
              {!!detail.score.missing.length && (
                <p>
                  {t("还可以补充：", "You can add: ")}
                  {detail.score.missing.join(" · ")}
                </p>
              )}
              <small>
                {t(
                  "圆环衡量资料覆盖程度，不代表人生的成绩。",
                  "Coverage describes your records, not your achievement.",
                )}
              </small>
            </aside>
          )}
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
          {t(
            "以下资料尚不可读取，地图未据此推断：",
            "These records could not be read and were not inferred: ",
          )}
          {state.gaps.join(" · ")}
        </p>
      )}
      {history && (
        <section className={css.history} aria-label={t("地图存档", "Map history")}>
          <h3>{t("每一张都能找回来", "Keep the maps you tried")}</h3>
          <p>
            {t(
              "存档只保存地图样式、地形与领域位置；资料始终取当前版本。移除后的方案可以恢复。",
              "History stores terrain, style and area positions. Your records stay current. Removed candidates can be restored.",
            )}
          </p>
          {[...(state?.candidates ?? [])].reverse().map((c) => (
            <div key={c.id}>
              <span>
                {new Date(c.createdAt).toLocaleString(locale)} ·{" "}
                {t(...(styleNames[c.settings.style] ?? [c.settings.style, c.settings.style]))}
                {c.id === state?.active ? t(" · 当前", " · Current") : ""}
                {c.archived ? t(" · 已移除", " · Removed") : ""}
              </span>
              {c.archived ? (
                <button type="button" onClick={() => void change(c.id, "restore")}>
                  {t("恢复", "Restore")}
                </button>
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
