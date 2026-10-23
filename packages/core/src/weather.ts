import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { KaituError } from "./errors.js";
import { localStateRoot } from "./local-state.js";
import { resolvePlace } from "./places.js";

export interface WeatherPlace {
  name: string;
  latitude: number;
  longitude: number;
  /** manual：用户自己选的，足迹不覆盖；footprints：跟着足迹里的现居城市。 */
  source: "manual" | "footprints";
}
export interface WeatherForecast {
  fetchedAt: string;
  timezone: string;
  current: { time: string; temperature: number; code: number; isDay: boolean };
  today: { max: number; min: number; sunrise: string; sunset: string };
  hourly: { time: string; temperature: number; code: number }[];
}
export interface WeatherState {
  place: WeatherPlace | null;
  forecast: WeatherForecast | null;
  /** 缓存超过一小时；界面照常显示旧数字，旁边写更新时间。 */
  stale: boolean;
  /** 最近一次没取到的原因；取到后清空。 */
  error: string | null;
}
type Cache = { place: WeatherPlace | null; forecast: WeatherForecast | null; error?: string | null };

const HOUR = 3_600_000;
const API = "https://api.open-meteo.com/v1/forecast";

// 城市和天气缓存只放本机状态目录：不进工作区、不同步、不进版本历史。
function file() {
  return join(localStateRoot(), "weather.json");
}
function read(): Cache {
  try {
    const value = JSON.parse(readFileSync(file(), "utf8")) as Cache;
    const place = value.place ? { ...value.place, source: value.place.source ?? "manual" } : null;
    return { place, forecast: value.forecast ?? null, error: value.error ?? null };
  } catch {
    return { place: null, forecast: null };
  }
}
function write(cache: Cache) {
  mkdirSync(localStateRoot(), { recursive: true, mode: 0o700 });
  const temp = `${file()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(cache)}\n`, { mode: 0o600 });
  renameSync(temp, file());
}

export function readWeather(now = new Date()): WeatherState {
  const { place, forecast, error } = read();
  const stale = !forecast || now.getTime() - Date.parse(forecast.fetchedAt) > HOUR;
  return { place, forecast, stale, error: error ?? null };
}

/** 换城市以坐标为准：同名不同地、或中途换了又换回来，都按坐标区分。 */
const key = (place: Pick<WeatherPlace, "latitude" | "longitude">) =>
  `${place.latitude.toFixed(2)},${place.longitude.toFixed(2)}`;

const valid = (place: WeatherPlace) =>
  !!place.name.trim() &&
  place.name.length <= 100 &&
  Number.isFinite(place.latitude) &&
  Math.abs(place.latitude) <= 90 &&
  Number.isFinite(place.longitude) &&
  Math.abs(place.longitude) <= 180;

/** 用户填的城市名用内置城市表换成坐标，不联网；足迹里的现居城市直接带坐标。 */
export function setWeatherPlace(input: {
  name: string;
  latitude?: number;
  longitude?: number;
  source?: WeatherPlace["source"];
}): WeatherState {
  if (!input || typeof input.name !== "string") throw new KaituError("请提供城市名", "BAD_ARGS");
  let place: WeatherPlace;
  if (typeof input.latitude === "number" && typeof input.longitude === "number")
    place = {
      name: input.name.trim(),
      latitude: input.latitude,
      longitude: input.longitude,
      source: input.source === "footprints" ? "footprints" : "manual",
    };
  else {
    const city = resolvePlace(input.name)[0];
    if (!city) throw new KaituError("没找到这个城市，换个写法试试，比如「杭州」或「Hangzhou」", "NOT_FOUND");
    place = { name: input.name.trim(), latitude: city.lat, longitude: city.lng, source: "manual" };
  }
  if (!valid(place)) throw new KaituError("城市信息不完整", "BAD_ARGS");
  const cache = read();
  // 用户手选的城市优先，足迹里的现居城市不覆盖它。
  if (place.source === "footprints" && cache.place?.source === "manual") return readWeather();
  const same = !!cache.place && key(cache.place) === key(place);
  // 再设一次同一个城市就是「重试」：保留旧数字，清掉上次的失败。
  write({ place, forecast: same ? cache.forecast : null, error: null });
  return readWeather();
}

type Fetch = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** 取一次 Open-Meteo，成功才覆盖缓存；失败保留上次的数字。返回是否有新数据。 */
export async function refreshWeather(options: { fetch?: Fetch; now?: Date } = {}): Promise<boolean> {
  const { place } = read();
  if (!place) return false;
  const params = new URLSearchParams({
    latitude: String(place.latitude),
    longitude: String(place.longitude),
    current: "temperature_2m,weather_code,is_day",
    hourly: "temperature_2m,weather_code",
    daily: "temperature_2m_max,temperature_2m_min,sunrise,sunset",
    timezone: "auto",
    forecast_days: "2",
  });
  // 只要坐标没变就是同一次选择；中途换了城市，这次的结果和失败都不写回。
  const current = () => {
    const now = read();
    return now.place && key(now.place) === key(place) ? now : null;
  };
  let body: {
    timezone: string;
    current: { time: string; temperature_2m: number; weather_code: number; is_day: number };
    hourly: { time: string[]; temperature_2m: number[]; weather_code: number[] };
    daily: {
      temperature_2m_max: number[];
      temperature_2m_min: number[];
      sunrise: string[];
      sunset: string[];
    };
  };
  try {
    const response = await (options.fetch ?? fetch)(`${API}?${params}`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new KaituError(`天气服务暂时不可用（${response.status}）`, "NETWORK");
    body = (await response.json()) as typeof body;
  } catch (error) {
    const now = current();
    if (now) write({ ...now, error: error instanceof KaituError ? error.message : "暂时连不上天气服务" });
    throw error;
  }
  // 逐时从当前这一小时往后取 12 个；时间都是当地时间，和 current.time 同一格式。
  const start = Math.max(
    0,
    body.hourly.time.findIndex((time) => time >= body.current.time.slice(0, 13)),
  );
  const forecast: WeatherForecast = {
    fetchedAt: (options.now ?? new Date()).toISOString(),
    timezone: body.timezone,
    current: {
      time: body.current.time,
      temperature: body.current.temperature_2m,
      code: body.current.weather_code,
      isDay: body.current.is_day === 1,
    },
    today: {
      max: body.daily.temperature_2m_max[0] ?? body.current.temperature_2m,
      min: body.daily.temperature_2m_min[0] ?? body.current.temperature_2m,
      sunrise: body.daily.sunrise[0] ?? "",
      sunset: body.daily.sunset[0] ?? "",
    },
    hourly: body.hourly.time.slice(start, start + 12).map((time, index) => ({
      time,
      temperature: body.hourly.temperature_2m[start + index] ?? Number.NaN,
      code: body.hourly.weather_code[start + index] ?? 0,
    })),
  };
  const now = current();
  if (!now?.place) return false;
  write({ place: now.place, forecast, error: null });
  return true;
}

/** 开图开着时每小时取一次天气；换城市时由调用方立刻触发一次。结果通过 notify 推回界面。 */
export function startWeatherSync(notify: () => void = () => {}, intervalMs = HOUR) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      if (readWeather().stale && (await refreshWeather())) notify();
    } catch {
      // 断网或服务不可用时保留上次的数字，下个小时再试。
    } finally {
      running = false;
    }
  };
  const first = setTimeout(() => void run(), 5_000);
  const timer = setInterval(() => void run(), Math.min(intervalMs, 10 * 60_000));
  first.unref();
  timer.unref();
  return {
    refresh: () => void run(),
    stop: () => {
      clearTimeout(first);
      clearInterval(timer);
    },
  };
}
