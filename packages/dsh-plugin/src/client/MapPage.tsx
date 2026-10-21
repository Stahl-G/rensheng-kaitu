import {
  experienceInterval,
  experienceLayer,
  experienceOverlaps,
  experienceYears,
} from "@kaitu/core/experience-time";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Experience, ExperienceChanges, LifeMapData } from "../types.js";
import { ExperienceEditor } from "./ExperienceEditor.js";
import { type ExperienceImportControlProps, ExperienceImportControls } from "./ExperienceImportControls.js";
import { HometownEditor } from "./HometownEditor.js";
import css from "./MapPage.module.css";
import { PaperMap } from "./PaperMap.js";
import { SourceEvidence } from "./SourceEvidence.js";
import { footprintAnchor, footprintData } from "./footprint-state.js";
import { useT } from "./i18n.js";
import { cityKey } from "./life-map-visuals.js";

export interface MapPageProps extends ExperienceImportControlProps {
  subscribe?: (refresh: () => void) => () => void;
  loadExperienceSource: (id: string) => Promise<import("../types.js").ExperienceSource>;
  loadLifeMap: () => Promise<LifeMapData>;
  hometownCities: (name: string) => Promise<import("../types.js").City[]>;
  saveHometown: (name: string, id: number) => Promise<unknown>;
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

export function MapPage({
  subscribe,
  loadExperienceSource,
  loadLifeMap,
  hometownCities,
  saveHometown,
  resolveExperience,
  editExperience,
  hideExperience,
  unhideExperience,
  onPrompt,
  ...importControls
}: MapPageProps) {
  const t = useT();
  const [editingHome, setEditingHome] = useState(false);
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
  const [showAllPlaces, setShowAllPlaces] = useState(false);
  const [chapterLimit, setChapterLimit] = useState(30);
  const [detailLimit, setDetailLimit] = useState(30);
  const [compact, setCompact] = useState(false);
  const showMapList = useCallback(() => setView((value) => (value === "list" ? "map" : "list")), []);
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
  const anchor = useMemo(() => (data ? footprintAnchor(data.experiences, data.asOf) : undefined), [data]);
  const home = data?.hometown?.status === "ready" ? data.hometown.place : undefined;
  const previousPlace = useMemo(
    () => (data ? footprintData(data.experiences, data.asOf, anchor ?? null).previous : undefined),
    [data, anchor],
  );

  const homeId = home ? cityId(home) : null;
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
            <p>{home?.name}</p>
            <p className={css.source}>{t("来自个人档案", "From your profile")}</p>
            <button
              type="button"
              className={css.link}
              onClick={() => {
                dismiss();
                setEditingHome(true);
              }}
            >
              {t("修改家乡", "Change hometown")}
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
        <h2 className={css.sr}>{t("足迹工具", "Footprint tools")}</h2>
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
          reviewPending={data?.review.length ?? 0}
        />
        <button type="button" className={css.control} onClick={() => setEditingHome(true)}>
          {home ? `⌂ ${t("家乡", "Hometown")}：${home.name}` : t("设置家乡", "Set hometown")}
        </button>
      </div>
      {data && editingHome && (
        <HometownEditor
          initial={home?.name ?? ""}
          search={hometownCities}
          save={async (name, id) => {
            await saveHometown(name, id);
            await refresh();
            setEditingHome(false);
            setNotice(t("家乡已保存", "Hometown saved"));
          }}
          cancel={home ? () => setEditingHome(false) : undefined}
        />
      )}
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
      ) : (
        <>
          <details className={css.review}>
            <summary>地图工具 · 图层与时间</summary>
            <div className={css.toolbar}>
              <label className={css.routeToggle}>
                <input
                  type="checkbox"
                  checked={showAllPlaces}
                  onChange={(event) => setShowAllPlaces(event.target.checked)}
                />
                {t("显示全部城市（含旅行）", "Show all cities, including travel")}
              </label>
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
          <div className={css.layout} data-view={view} data-selected={!!city}>
            <PaperMap
              cities={cities}
              cityNames={data.cityNames}
              previous={previousPlace}
              selected={city?.id ?? null}
              onSelect={setSelected}
              onShowList={showMapList}
              showRoutes={showRoutes}
              showAllPlaces={showAllPlaces}
              current={anchor ?? null}
              asOf={data.asOf}
              onAdd={(mode) =>
                mode === "now"
                  ? ask(
                      "请帮我核对目前居住的城市，并确认对应经历的时间和事实状态。不要把计划或推测写成已发生。",
                    )
                  : ask(
                      mode === "history"
                        ? prompt
                        : "我想记一个计划去的城市，请先问我要去哪里，区分计划与 AI 建议，不写成已经去过。",
                    )
              }
            />
            <section
              className={css.listPane}
              aria-label="城市列表"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setView("map");
                  setSelected(null);
                }
              }}
            >
              <div className={css.listControls}>
                <button
                  type="button"
                  className={css.control}
                  onClick={() => {
                    setView("map");
                    setSelected(null);
                  }}
                  aria-label={t("关闭城市列表", "Close city list")}
                >
                  {t("关闭", "Close")}
                </button>
              </div>
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
          <p className={css.mapFootnote}>城市级位置 · 连线表示经历顺序</p>
          <details className={css.review}>
            <summary>{t("地图资料去向", "Map data and connections")}</summary>
            <p>
              {t(
                "全球底图保存在本机。拉近城市时，按视野向 OpenFreeMap 和 AWS Terrain Tiles 下载瓦片；请求包含地图区域与常规网络信息。",
                "The global map is local. Zooming into cities downloads visible tiles from OpenFreeMap and AWS Terrain Tiles. Requests include the map area and ordinary network metadata.",
              )}
            </p>
          </details>
          {compact && details}
        </>
      )}
    </div>
  );
}
