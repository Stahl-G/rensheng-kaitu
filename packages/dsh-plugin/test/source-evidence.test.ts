import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { expect, test, vi } from "vitest";
import { SourceEvidence } from "../src/client/SourceEvidence.js";
import type { ExperienceSource } from "../src/types.js";

test("source can be dismissed while loading and changing records cannot show stale evidence", async () => {
  let finish!: (value: ExperienceSource) => void;
  const load = vi.fn(
    () =>
      new Promise<ExperienceSource>((resolve) => {
        finish = resolve;
      }),
  );
  let app!: ReturnType<typeof create>;
  try {
    await act(async () => {
      app = create(createElement(SourceEvidence, { id: "first", load }));
    });
    await act(async () => {
      void app.root.findByType("button").props.onClick();
    });
    expect(app.root.findByType("button").props.disabled).not.toBe(true);
    await act(async () => app.root.findByType("button").props.onClick());
    await act(async () => finish({ kind: "external", url: "https://example.com/first" }));
    expect(app.root.findAllByType("a")).toHaveLength(0);
    await act(async () => {
      void app.root.findByType("button").props.onClick();
    });
    await act(async () => app.update(createElement(SourceEvidence, { id: "second", load })));
    await act(async () => finish({ kind: "external", url: "https://example.com/first" }));
    expect(app.root.findAllByType("a")).toHaveLength(0);
    expect(app.root.findByType("button").props["aria-expanded"]).toBe(false);
  } finally {
    await act(async () => app?.unmount());
  }
});
