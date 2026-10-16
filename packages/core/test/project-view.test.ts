import { rmSync } from "node:fs";
import { expect, it } from "vitest";
import { createProject, readProjectPage } from "../src/index.js";
import { freshWorkspace } from "./helpers.js";

it("项目视图跳过错误积木并保留其余内容", async () => {
  const ws = await freshWorkspace();
  try {
    const { slug } = await createProject(ws, { title: "作品", kind: "personal" });
    const first = { id: "first", type: "note", text: "继续写作" };
    const last = { id: "last", type: "checklist", items: [{ text: "完成一章", checked: false }] };
    ws.writeJson(`projects/${slug}/view.json`, {
      blocks: [first, { id: "bad", type: "checklist", items: [{ text: "缺少状态" }] }, last],
    });
    const detail = readProjectPage(ws, slug);
    expect(detail.view).toEqual({ blocks: [first, last] });
    expect(detail.viewError).toBeNull();
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});
