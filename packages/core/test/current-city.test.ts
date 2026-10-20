import { rmSync } from "node:fs";
import { expect, it } from "vitest";
import { readCurrentCity, saveCurrentCity } from "../src/hometown.js";
import { freshWorkspace } from "./helpers.js";

it("现居和家乡独立保存，保留其他档案，歧义和冲突不猜测", async () => {
  const ws = await freshWorkspace();
  try {
    ws.writeText("me/profile.md", "# Profile\n家乡：成都\n职业：设计\n现居城市：Shanghai\n");
    expect(readCurrentCity(ws)?.name).toBe("Shanghai");
    const { resolvePlace } = await import("../src/places.js");
    const city = resolvePlace("Beijing").find((c) => c.country === "CN");
    expect(city).toBeDefined();
    await saveCurrentCity(ws, "Beijing", city?.geonameid as number);
    expect(readCurrentCity(ws)?.geonameid).toBe(city?.geonameid);
    expect(ws.readText("me/profile.md")).toContain("家乡：成都\n职业：设计");
    ws.writeText("me/profile.md", `${ws.readText("me/profile.md")}\n现居：Shanghai\n`);
    expect(readCurrentCity(ws)).toBeUndefined();
    await expect(saveCurrentCity(ws, "Beijing\nother", 1)).rejects.toThrow();
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});
