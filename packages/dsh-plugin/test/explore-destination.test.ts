import { expect, it } from "vitest";
import { exploreDestination } from "../src/client/explore-modules.js";
const empty = { hometown: false, experiences: 0, healthRecords: 0, newsTopics: 0, goals: 0, directions: 0 };
it("empty built-ins open All modules even when a plugin is first", () => {
  expect(exploreDestination(["plugin", "health"], empty, ["plugin", "health"])).toBe("modules");
  for (const content of [
    { ...empty, hometown: true },
    { ...empty, experiences: 1 },
    { ...empty, healthRecords: 1 },
    { ...empty, newsTopics: 1 },
    { ...empty, goals: 1 },
    { ...empty, directions: 1 },
  ]) {
    expect(exploreDestination(["plugin", "health"], content, ["plugin", "health"])).toBe("plugin");
  }
});
it("saved order skips unavailable entries and keeps all-hidden recoverable", () => {
  const content = { ...empty, healthRecords: 400 };
  expect(exploreDestination(["removed", "news", "health"], content)).toBe("news");
  expect(exploreDestination([], content)).toBe("modules");
  expect(exploreDestination(["removed"], content)).toBe("modules");
});
