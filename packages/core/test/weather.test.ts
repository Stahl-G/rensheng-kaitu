import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { readWeather, refreshWeather, setWeatherPlace } from "../src/index.js";

const state = mkdtempSync(join(tmpdir(), "kaitu-weather-"));
afterEach(() => vi.unstubAllEnvs());

const forecast = (temperature: number) => ({
  ok: true,
  status: 200,
  json: async () => ({
    timezone: "Asia/Shanghai",
    current: { time: "2026-10-23T10:15", temperature_2m: temperature, weather_code: 2, is_day: 1 },
    hourly: {
      time: Array.from(
        { length: 48 },
        (_, h) => `2026-10-${23 + Math.floor(h / 24)}T${String(h % 24).padStart(2, "0")}:00`,
      ),
      temperature_2m: Array.from({ length: 48 }, (_, h) => h),
      weather_code: Array.from({ length: 48 }, () => 0),
    },
    daily: {
      temperature_2m_max: [24, 22],
      temperature_2m_min: [15, 14],
      sunrise: ["2026-10-23T06:05"],
      sunset: ["2026-10-23T17:30"],
    },
  }),
});

it("城市名换成坐标后取天气，失败保留上次的数字，换城市期间的旧结果不写回", async () => {
  vi.stubEnv("KAITU_LOCAL_STATE_DIR", state);
  try {
    expect(readWeather()).toEqual({ place: null, forecast: null, stale: true });
    expect(() => setWeatherPlace({ name: "不存在的合成城市" })).toThrow("没找到这个城市");
    const place = setWeatherPlace({ name: "杭州" }).place;
    expect(place?.latitude).toBeCloseTo(30.29, 1);
    const now = new Date("2026-10-23T02:15:00Z");
    expect(await refreshWeather({ fetch: async () => forecast(21), now })).toBe(true);
    const saved = readWeather(now);
    expect(saved.stale).toBe(false);
    expect(saved.forecast?.current.temperature).toBe(21);
    expect(saved.forecast?.hourly[0]?.time).toBe("2026-10-23T10:00");
    expect(saved.forecast?.hourly).toHaveLength(12);
    // 服务不可用时报错，缓存不动，一小时后标成旧数据但照样显示。
    await expect(
      refreshWeather({ fetch: async () => ({ ok: false, status: 503, json: async () => ({}) }) }),
    ).rejects.toThrow("503");
    const later = readWeather(new Date("2026-10-23T04:00:00Z"));
    expect(later.forecast?.current.temperature).toBe(21);
    expect(later.stale).toBe(true);
    // 同一个城市再设一次不清缓存；换到别的城市先清空，取数据途中又换城市就不写回。
    expect(
      setWeatherPlace({ name: "杭州", latitude: place?.latitude, longitude: place?.longitude }).forecast,
    ).not.toBeNull();
    expect(setWeatherPlace({ name: "合成海边", latitude: 18.2, longitude: 109.5 }).forecast).toBeNull();
    const changed = await refreshWeather({
      fetch: async () => {
        setWeatherPlace({ name: "合成山城", latitude: 29.56, longitude: 106.55 });
        return forecast(30);
      },
    });
    expect(changed).toBe(false);
    expect(readWeather().forecast).toBeNull();
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
});
