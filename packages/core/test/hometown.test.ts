import { rmSync } from "node:fs";
import { expect, it } from "vitest";
import { history, lifeMap, resolvePlace, restore, saveHometown, snapshot } from "../src/index.js";
import { freshWorkspace } from "./helpers.js";

it("家乡保留档案依据；当前位置、推测、冲突和歧义城市不能替代确定起点", async () => {
  const ws = await freshWorkspace();
  try {
    ws.writeText("me/profile.md", "# 档案\n出生地：东京\n目前居住：北京\n");
    expect(lifeMap(ws).hometown?.status).toBe("missing");
    ws.writeText("me/profile.md", "# 档案\n- **家乡**：北京\n依据：memory/childhood.md\n");
    expect(lifeMap(ws).hometown).toMatchObject({
      status: "ready",
      source: "me/profile.md:L2",
      evidence: "- **家乡**：北京",
      place: { name: "北京", country: "CN", precision: "city", geonameid: 1816670 },
    });
    expect(lifeMap(ws).experiences).toEqual([]);
    for (const profile of [
      "家乡（待核对）：北京",
      "家乡：北京\n家乡：东京",
      "家乡：Springfield",
      "家乡：可能在北京",
    ]) {
      ws.writeText("me/profile.md", profile);
      expect(lifeMap(ws).hometown).toMatchObject({ status: "review" });
      expect(lifeMap(ws).hometown?.place).toBeUndefined();
    }
    ws.writeText("me/profile.md", "家乡：未知");
    expect(lifeMap(ws).hometown?.status).toBe("missing");
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});

it("直接设置歧义城市可回读、重复保存不新增版本、保留其他档案且能撤销", async () => {
  const ws = await freshWorkspace();
  try {
    const original = "---\nname: 测试用户\n---\n# 档案\n目前居住：北京\n- **家乡**：东京\n爱好：游泳\n";
    ws.writeText("me/profile.md", original);
    const before = await snapshot(ws, "测试前档案");
    if (!before) throw new Error("应保存初始档案版本");
    const cities = resolvePlace("Springfield");
    expect(cities.length).toBeGreaterThan(1);
    const chosen = cities[1];
    if (!chosen) throw new Error("应有同名城市可供选择");
    await saveHometown(ws, "Springfield", chosen.geonameid);
    expect(lifeMap(ws).hometown).toMatchObject({
      status: "ready",
      place: { name: "Springfield", geonameid: chosen.geonameid },
    });
    expect(ws.readText("me/profile.md")).toContain("name: 测试用户");
    expect(ws.readText("me/profile.md")).toContain("目前居住：北京");
    expect(ws.readText("me/profile.md")).toContain("爱好：游泳");
    const saved = ws.readText("me/profile.md");
    const versions = (await history(ws)).length;
    await saveHometown(ws, "Springfield", chosen.geonameid);
    expect((await history(ws)).length).toBe(versions);
    await expect(saveHometown(ws, "北京\n爱好：更改", chosen.geonameid)).rejects.toMatchObject({
      code: "BAD_ARGS",
    });
    await expect(saveHometown(ws, "北京", chosen.geonameid)).rejects.toMatchObject({ code: "BAD_ARGS" });
    expect(ws.readText("me/profile.md")).toBe(saved);
    await restore(ws, before);
    expect(ws.readText("me/profile.md")).toBe(original);
    expect(lifeMap(ws).hometown?.place?.name).toBe("东京");
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});
