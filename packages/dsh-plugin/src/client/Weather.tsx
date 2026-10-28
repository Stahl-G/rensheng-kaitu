import type { LifeMapData, WeatherForecast, WeatherState } from "@kaitu/core";
import { useCallback, useEffect, useRef, useState } from "react";
import css from "./Weather.module.css";
import { footprintAnchor } from "./footprint-state.js";
import { useLocale, useT } from "./i18n.js";

type Tod = "morning" | "noon" | "dusk" | "night";

/** Decorative only: the existing forecast and time-of-day gradient remain the source of truth. */
function WeatherSky({ tod, code }: { tod: Tod; code: number }) {
  return (
    <div className={css.sky} aria-hidden="true">
      <svg
        className={css.atmosphere}
        viewBox="0 0 1200 240"
        preserveAspectRatio="xMidYMid slice"
        focusable="false"
        aria-hidden="true"
      >
        {tod === "night" && code <= 2 && (
          <g className={css.stars}>
            {[
              [90, 32],
              [210, 92],
              [355, 22],
              [465, 65],
              [558, 30],
              [620, 101],
              [704, 48],
              [815, 20],
              [890, 85],
              [1010, 42],
              [1115, 108],
            ].map(([x, y], index) => (
              <circle
                className={css.star}
                key={`${x}-${y}`}
                cx={x}
                cy={y}
                r={index % 3 === 0 ? 1.8 : 1.2}
                style={{ animationDelay: `${-index * 0.7}s` }}
              />
            ))}
          </g>
        )}
        {code > 0 && (
          <g className={css.clouds}>
            <g className={css.cloud}>
              <path d="M355 100c-24 0-24-30-4-34 0-30 49-38 60-10 22-10 43 7 40 24 30-2 34 26 9 26H355Z" />
            </g>
            <g className={css.cloud}>
              <path d="M725 57c-27 0-30-30-7-37 3-27 44-31 55-8 20-8 39 5 39 21 24-1 31 26 4 29H725Z" />
            </g>
            <g className={css.cloud}>
              <path d="M940 135c-23 0-26-27-6-33 0-27 39-34 52-13 20-11 42 5 40 24 24-2 31 27 6 27H940Z" />
            </g>
          </g>
        )}
      </svg>
    </div>
  );
}

// WMO 天气代码，Open-Meteo 用的就是这一套。
function condition(code: number, t: (zh: string, en: string) => string) {
  if (code === 0) return t("晴", "Clear");
  if (code <= 2) return t("少云", "Partly cloudy");
  if (code === 3) return t("阴", "Overcast");
  if (code <= 48) return t("雾", "Fog");
  if (code <= 57) return t("毛毛雨", "Drizzle");
  if (code <= 67) return t("雨", "Rain");
  if (code <= 77) return t("雪", "Snow");
  if (code <= 82) return t("阵雨", "Showers");
  if (code <= 86) return t("阵雪", "Snow showers");
  return t("雷雨", "Thunderstorm");
}

/** 5–11 早晨、11–16 中午、16–19 傍晚、其余夜晚；有日出日落就按实际的切。 */
function timeOfDay(forecast: WeatherForecast): Tod {
  const now = forecast.current.time.slice(11, 16);
  const sunrise = forecast.today.sunrise.slice(11, 16) || "05:00";
  const sunset = forecast.today.sunset.slice(11, 16) || "19:00";
  if (now < sunrise || now >= sunset) return "night";
  if (now < "11:00") return "morning";
  if (now < "16:00") return "noon";
  return "dusk";
}

const today = () => new Date().toLocaleDateString("sv");
function rememberedOpen(): boolean | null {
  try {
    const saved = JSON.parse(localStorage.getItem("kaitu-weather-open") ?? "null");
    return saved?.day === today() ? !!saved.open : null;
  } catch {
    return null;
  }
}

/** 今天页顶部的天气：城市先用足迹里的现居城市，没有就问；数字来自本机缓存，后台每小时更新。 */
export function TodayWeather({
  load,
  setPlace,
  loadLifeMap,
  subscribe,
}: {
  load: () => Promise<WeatherState>;
  setPlace: (
    name: string,
    latitude?: number,
    longitude?: number,
    source?: "manual" | "footprints",
  ) => Promise<WeatherState>;
  loadLifeMap: () => Promise<LifeMapData>;
  subscribe?: (refresh: () => void) => () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [state, setState] = useState<WeatherState | null>(null);
  const [draft, setDraft] = useState("");
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState(false);
  const [open, setOpen] = useState(() => rememberedOpen() ?? false);
  // 只采用最后一次请求的结果，旧响应不覆盖新选的城市。
  const generation = useRef(0);
  const apply = useCallback(async (request: Promise<WeatherState>) => {
    const id = ++generation.current;
    const value = await request;
    if (id === generation.current) {
      setState(value);
      setLoadError(false);
    }
    return value;
  }, []);
  const refresh = useCallback(() => {
    void apply(load()).catch(() => setLoadError(true));
  }, [apply, load]);
  useEffect(() => {
    refresh();
    const off = subscribe?.(refresh);
    // 后台每小时更新本机缓存；没有推送的宿主（如 DSH）靠每 10 分钟读一次缓存跟上。
    const timer = setInterval(refresh, 10 * 60_000);
    return () => {
      off?.();
      clearInterval(timer);
    };
  }, [refresh, subscribe]);
  // 还没有城市、或城市本来就跟着足迹时，用足迹里的现居城市；用户手选的不覆盖。
  useEffect(() => {
    let active = true;
    void Promise.all([load(), loadLifeMap()])
      .then(async ([current, map]) => {
        const home = footprintAnchor(map.experiences, map.asOf);
        if (!active || !home || !Number.isFinite(home.lat) || !Number.isFinite(home.lng)) return;
        if (current.place?.source === "manual") return;
        const lat = home.lat as number;
        const lng = home.lng as number;
        if (
          current.place &&
          current.place.latitude.toFixed(2) === lat.toFixed(2) &&
          current.place.longitude.toFixed(2) === lng.toFixed(2)
        )
          return;
        await apply(setPlace(home.name, lat, lng, "footprints"));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [apply, load, loadLifeMap, setPlace]);
  // 刚换城市还没取到：读几次本机缓存，取到、失败或读满 10 次就停。
  const placeKey = state?.place
    ? `${state.place.latitude.toFixed(2)},${state.place.longitude.toFixed(2)}`
    : "";
  const waiting = !!placeKey && !state?.forecast && !state?.error;
  useEffect(() => {
    if (!waiting || !placeKey) return;
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      refresh();
      if (tries >= 10) clearInterval(timer);
    }, 3000);
    return () => clearInterval(timer);
  }, [waiting, placeKey, refresh]);
  const retry = () => {
    if (state?.place)
      void apply(
        setPlace(state.place.name, state.place.latitude, state.place.longitude, state.place.source),
      ).catch(() => {});
  };
  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem("kaitu-weather-open", JSON.stringify({ day: today(), open: !open }));
    } catch {}
  };
  if (!state)
    return loadError ? (
      <div className={css.ask} role="alert">
        {t("天气暂时无法读取", "Weather is unavailable")}
        <button type="button" onClick={refresh}>
          {t("重试", "Retry")}
        </button>
      </div>
    ) : null;
  if (!state.place || asking)
    return (
      <form
        className={css.ask}
        onSubmit={async (event) => {
          event.preventDefault();
          if (!draft.trim()) return;
          setError("");
          try {
            await apply(setPlace(draft.trim()));
            setAsking(false);
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          }
        }}
      >
        <label htmlFor="weather-city">{t("选择城市", "Choose city")}</label>
        <input
          id="weather-city"
          value={draft}
          maxLength={100}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t("比如：杭州", "For example: Hangzhou")}
        />
        <button type="submit" disabled={!draft.trim()}>
          {t("好了", "Done")}
        </button>
        {asking && (
          <button type="button" onClick={() => setAsking(false)}>
            {t("取消", "Cancel")}
          </button>
        )}
        {error && <span role="alert">{error}</span>}
      </form>
    );
  const forecast = state.forecast;
  if (!forecast)
    return state.error ? (
      <div className={css.ask} role="alert">
        <span>
          {t(`暂时取不到${state.place.name}的天气：`, `Couldn't get the weather for ${state.place.name}: `)}
          {state.error}
        </span>
        <button type="button" onClick={retry}>
          {t("重试", "Retry")}
        </button>
        <button type="button" onClick={() => setAsking(true)}>
          {t("换城市", "Change city")}
        </button>
      </div>
    ) : (
      <output className={css.ask}>
        {t(`正在取${state.place.name}的天气…`, `Getting the weather for ${state.place.name}…`)}
      </output>
    );
  const tod = timeOfDay(forecast);
  const round = (value: number) => `${Math.round(value)}°`;
  const updated = state.stale
    ? t(
        `${new Date(forecast.fetchedAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })} 更新`,
        `Updated ${new Date(forecast.fetchedAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}`,
      )
    : "";
  const place = (
    <button
      type="button"
      className={css.place}
      onClick={() => setAsking(true)}
      title={t("换城市", "Change city")}
    >
      {state.place.name}
    </button>
  );
  const credit = (
    <a className={css.credit} href="https://open-meteo.com/" target="_blank" rel="noreferrer">
      {t("天气数据 Open-Meteo", "Weather data by Open-Meteo")}
    </a>
  );
  if (!open)
    return (
      <section
        className={css.bar}
        data-tod={tod}
        aria-label={t("今天的天气，收起", "Today's weather, collapsed")}
      >
        <WeatherSky tod={tod} code={forecast.current.code} />
        <div className={css.barIn}>
          {place}
          <span className={css.barTemp}>{round(forecast.current.temperature)}</span>
          <span>
            {condition(forecast.current.code, t)} · {t("最高", "H")} {round(forecast.today.max)}{" "}
            {t("最低", "L")} {round(forecast.today.min)}
          </span>
          {updated && <small>{updated}</small>}
          {credit}
          <button type="button" onClick={toggle}>
            {t("展开", "Expand")}
          </button>
        </div>
      </section>
    );
  return (
    <section className={css.wx} data-tod={tod} aria-label={t("今天的天气", "Today's weather")}>
      <WeatherSky tod={tod} code={forecast.current.code} />
      <div className={css.inner}>
        <div className={css.top}>
          <div>
            {place}
            <div className={css.temp}>{round(forecast.current.temperature)}</div>
          </div>
          <div className={css.right}>
            <div className={css.condition}>{condition(forecast.current.code, t)}</div>
            <div>
              {t("最高", "H")} {round(forecast.today.max)} · {t("最低", "L")} {round(forecast.today.min)}
            </div>
            {updated && <small>{updated}</small>}
            <button type="button" onClick={toggle}>
              {t("收起", "Collapse")}
            </button>
          </div>
        </div>
        <ol className={css.hours} aria-label={t("逐时预报", "Hourly forecast")}>
          {forecast.hourly.slice(0, 6).map((hour, index) => (
            <li key={hour.time}>
              <span>{index === 0 ? t("现在", "Now") : hour.time.slice(11, 13)}</span>
              <span>{condition(hour.code, t)}</span>
              <span>{round(hour.temperature)}</span>
            </li>
          ))}
        </ol>
        {credit}
      </div>
    </section>
  );
}
