import { createElement } from "react";
import { type ReactTestRenderer, act, create } from "react-test-renderer";
import { afterEach, expect, test, vi } from "vitest";
import { TodayWeather } from "../src/client/Weather.js";

afterEach(() => vi.unstubAllGlobals());

test("visual weather preserves cached manual city and changes city on request", async () => {
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
  const state = {
    place: { name: "合成城市", latitude: 1, longitude: 2, source: "manual" as const },
    forecast: {
      fetchedAt: new Date().toISOString(),
      timezone: "UTC",
      current: { time: "2026-10-28T12:00", temperature: 23, code: 0, isDay: true },
      today: { max: 25, min: 18, sunrise: "06:00", sunset: "18:00" },
      hourly: [{ time: "2026-10-28T12:00", temperature: 23, code: 0 }],
    },
    stale: false,
    error: null,
  };
  const load = vi.fn(async () => state);
  const loadLifeMap = vi.fn(async () => ({ experiences: [], asOf: "2026-10-28" }) as never);
  const setPlace = vi.fn(async () => state);
  let root: ReactTestRenderer | undefined;
  try {
    await act(async () => {
      root = create(createElement(TodayWeather, { load, setPlace, loadLifeMap }));
    });
    if (!root) throw new Error("weather missing");
    expect(loadLifeMap).toHaveBeenCalled();
    expect(setPlace).not.toHaveBeenCalled();
    const city = root.root.findAllByType("button").find((button) => button.props.title === "换城市");
    if (!city) throw new Error("city selector missing");
    await act(async () => city.props.onClick());
    await act(async () => root?.root.findByType("input").props.onChange({ target: { value: "杭州" } }));
    await act(async () => root?.root.findByType("form").props.onSubmit({ preventDefault() {} }));
    expect(setPlace).toHaveBeenCalledWith("杭州");
  } finally {
    if (root) act(() => root?.unmount());
  }
});

test("visual weather retries a failed forecast without losing the city", async () => {
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
  const state = {
    place: { name: "合成城市", latitude: 1, longitude: 2, source: "manual" as const },
    forecast: null,
    stale: true,
    error: "offline",
  };
  const setPlace = vi.fn(async () => state);
  let root: ReactTestRenderer | undefined;
  try {
    await act(async () => {
      root = create(
        createElement(TodayWeather, {
          load: async () => state,
          setPlace,
          loadLifeMap: async () => ({}) as never,
        }),
      );
    });
    const retry = root?.root.findAllByType("button").find((button) => button.children.includes("重试"));
    expect(retry).toBeDefined();
    await act(async () => retry?.props.onClick());
    expect(setPlace).toHaveBeenCalledWith("合成城市", 1, 2, "manual");
  } finally {
    if (root) act(() => root?.unmount());
  }
});

test("without a city or footprint, visual weather waits for an explicit city choice", async () => {
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
  const state = { place: null, forecast: null, stale: true, error: null };
  const setPlace = vi.fn(async () => state);
  const loadLifeMap = vi.fn(async () => ({}) as never);
  let root: ReactTestRenderer | undefined;
  try {
    await act(async () => {
      root = create(createElement(TodayWeather, { load: async () => state, setPlace, loadLifeMap }));
    });
    expect(root?.root.findAllByType("form")).toHaveLength(1);
    expect(setPlace).not.toHaveBeenCalled();
    await act(async () => root?.root.findByType("input").props.onChange({ target: { value: "杭州" } }));
    await act(async () => root?.root.findByType("form").props.onSubmit({ preventDefault() {} }));
    expect(setPlace).toHaveBeenCalledWith("杭州");
  } finally {
    if (root) act(() => root?.unmount());
  }
});
