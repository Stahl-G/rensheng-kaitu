import { createElement } from "react";
import { type ReactTestRenderer, act, create } from "react-test-renderer";
import { afterEach, expect, test, vi } from "vitest";
import { TodayWeather } from "../src/client/Weather.js";

afterEach(() => vi.unstubAllGlobals());

test("compact weather uses cached city, shows details and changes city only on request", async () => {
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
      root = create(createElement(TodayWeather, { compact: true, load, setPlace, loadLifeMap }));
    });
    if (!root) throw new Error("weather missing");
    expect(loadLifeMap).not.toHaveBeenCalled();
    expect(setPlace).not.toHaveBeenCalled();
    const compact = root.root
      .findAllByType("button")
      .find((button) => String(button.props["aria-label"]).includes("查看天气详情"));
    if (!compact) throw new Error("compact weather missing");
    expect(compact.children.join("")).toContain("合成城市");
    await act(async () => compact.props.onClick());
    expect(root.root.findByProps({ "aria-label": "逐时预报" })).toBeDefined();
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

test("compact weather offers retry and city change after a failed forecast", async () => {
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
          compact: true,
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

test("without a city, compact weather waits for a deliberate choice and can be dismissed", async () => {
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
  const state = { place: null, forecast: null, stale: true, error: null };
  const setPlace = vi.fn(async () => state);
  const loadLifeMap = vi.fn(async () => ({}) as never);
  let root: ReactTestRenderer | undefined;
  try {
    await act(async () => {
      root = create(
        createElement(TodayWeather, { compact: true, load: async () => state, setPlace, loadLifeMap }),
      );
    });
    const setup = root?.root.findAllByType("button").find((button) => button.children.includes("设置天气"));
    expect(setup).toBeDefined();
    expect(loadLifeMap).not.toHaveBeenCalled();
    expect(setPlace).not.toHaveBeenCalled();
    await act(async () => setup?.props.onClick());
    const cancel = root?.root.findAllByType("button").find((button) => button.children.includes("取消"));
    await act(async () => cancel?.props.onClick());
    expect(root?.root.findAllByType("form")).toHaveLength(0);
    expect(setPlace).not.toHaveBeenCalled();
  } finally {
    if (root) act(() => root?.unmount());
  }
});
