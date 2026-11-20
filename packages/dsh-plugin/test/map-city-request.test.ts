import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { expect, test, vi } from "vitest";
import { MapPage, type MapPageProps } from "../src/client/MapPage.js";
import type { LifeMapData } from "../src/types.js";
vi.mock("../src/client/PaperMap.js", () => ({
  PaperMap: (props: { selected: string }) => createElement("div", { "data-map-selected": props.selected }),
}));
vi.mock("../src/client/ExperienceImportControls.js", () => ({ ExperienceImportControls: () => null }));

test("a repeated city command reopens the dismissed city without default selection overriding it", async () => {
  const experiences = [
    {
      id: "a",
      place: { geonameid: 1, name: "First", country: "CN" },
      event_type: "lived",
      fact_status: "user_reported",
      start: "2018",
      time_precision: "year",
      source: "memory/source.md",
    },
    {
      id: "b",
      place: { geonameid: 2, name: "Second", country: "AU" },
      event_type: "travel",
      fact_status: "planned",
      start: "2027",
      time_precision: "year",
      source: "memory/source.md",
    },
  ];
  const data = {
    experiences,
    features: [],
    asOf: "2026-11-10",
    hidden: [],
    review: [],
    undated: 0,
  } as unknown as LifeMapData;
  const props = {
    initialCity: "2",
    initialCityRequest: 1,
    loadLifeMap: async () => data,
    onPrompt: vi.fn(),
  } as unknown as MapPageProps;
  let app!: ReturnType<typeof create>;
  const selected = () =>
    app.root.findAllByType("div").find((item) => Object.hasOwn(item.props, "data-map-selected"))?.props[
      "data-map-selected"
    ];
  try {
    await act(async () => {
      app = create(createElement(MapPage, props));
    });
    expect(selected()).toBe("2");
    await act(async () =>
      app.root
        .findAllByType("button")
        .find((item) => item.children.includes("关闭"))
        ?.props.onClick(),
    );
    expect(selected()).toBe(null);
    const year = app.root.findAllByType("button").find((item) => item.children.includes("2018"));
    expect(year).toBeDefined();
    await act(async () => year?.props.onClick());
    expect(year?.props["aria-pressed"]).toBe(true);
    expect(selected()).toBe(null);
    await act(async () => app.update(createElement(MapPage, { ...props, initialCityRequest: 2 })));
    expect(selected()).toBe("2");
    expect(app.root.findByProps({ id: "city-title" }).children).toContain("Second");
  } finally {
    await act(async () => app?.unmount());
  }
});
