import { rmSync } from "node:fs";
import { expect, it } from "vitest";
import { lifeMap } from "../src/index.js";
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
