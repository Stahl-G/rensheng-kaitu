import { addRecord, readHealthPage } from "@kaitu/core";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { expect, test, vi } from "vitest";
import { freshWorkspace, workout } from "../../core/test/helpers.js";
import { HealthPage } from "../src/client/HealthPage.js";

test("sparse health data hides training charts while other records and later workouts remain available", async () => {
  const ws = await freshWorkspace("UTC");
  const now = new Date("2026-11-01T12:00:00Z");
  const ts = "2026-11-01T08:00:00Z";
  addRecord(ws, "metric", { ts, kind: "weight", value: 71, unit: "kg", source: "manual" });
  addRecord(ws, "activity", { ts, date: "2026-11-01", steps: 0, source: "estimate" });
  const loadHealth = async () => readHealthPage(ws, now);
  const props = {
    loadHealth,
    loadHealthPhoto: vi.fn(),
    onPrompt: vi.fn(),
    adoptTask: vi.fn(),
    cancelTask: vi.fn(),
  };
  let app!: ReturnType<typeof create>;
  const sections = () => app.root.findAllByType("section").map((item) => item.props["aria-label"]);
  const select = async (tab: string) =>
    act(async () =>
      app.root
        .findAllByProps({ role: "tab" })
        .find((item) => item.children.includes(tab))
        ?.props.onClick(),
    );
  try {
    await act(async () => {
      app = create(createElement(HealthPage, props));
    });
    expect(sections()).not.toContain("训练");
    expect(sections()).not.toContain("近 5 周");
    expect(sections()).not.toContain("最近的训练");
    expect(JSON.stringify(app.toJSON())).toContain("≈0");
    await select("身体数据");
    expect(JSON.stringify(app.toJSON())).toContain("71");
    await select("体态照片");
    expect(app.root.findAllByProps({ role: "tab", "aria-selected": true })[0]?.children).toContain(
      "体态照片",
    );

    addRecord(ws, "meal", {
      ts,
      meal: "午",
      items: [{ name: "合成午餐" }],
      kcal: 0,
      protein_g: 0,
      source: "manual",
    });
    addRecord(ws, "workout", { ...workout, ts, exercise: "合成徒手训练", weight_kg: 0 });
    await act(async () =>
      app.update(createElement(HealthPage, { ...props, loadHealth: async () => loadHealth() })),
    );
    await select("饮食");
    expect(JSON.stringify(app.toJSON())).toContain("合成午餐");
    await select("训练");
    expect(sections()).toContain("训练");
    expect(sections()).toContain("近 5 周");
    expect(sections()).toContain("最近的训练");
    const text = JSON.stringify(app.toJSON());
    expect(text).toContain("合成徒手训练");
    expect(text).toContain("0 kg");
  } finally {
    await act(async () => app?.unmount());
  }
});
