import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  type DirectionMapInput,
  addTask,
  appendLog,
  createProject,
  directionMapInput,
  directionMapPrompt,
  directionNext,
  generateDirectionMap,
  localDate,
  parseDirectionMap,
  readDirectionMap,
  setProject,
} from "../src/index.js";
import { freshWorkspace } from "./helpers.js";

afterEach(() => vi.unstubAllEnvs());

const input: DirectionMapInput = {
  today: "2026-10-23",
  locale: "zh-CN",
  goals: [
    { id: "ai-product", source: "g:ai-product", title: "转向 AI 产品工作", why: "做真正有人用的产品" },
    { id: "novel", source: "g:novel", title: "写完一部中篇小说" },
  ],
  projects: [
    {
      slug: "tool",
      source: "p:tool",
      title: "合成效率工具",
      stage: "active",
      next: [{ source: "n:tool:fix", text: "修好排版，再请一位朋友试用", state: "todo" }],
      logs: [{ source: "l:tool:2026-10-23", date: "2026-10-23", text: "第一轮朋友试用，发现长文本排版问题" }],
    },
    {
      slug: "story",
      source: "p:story",
      title: "合成小说",
      stage: "active",
      next: [],
      logs: [{ source: "l:story:2026-10-02", date: "2026-10-02", text: "写完第二章开场" }],
    },
  ],
  directions: [],
};

it("引用必须出自声明的那段原文，连线的依据只能来自这条线两端", () => {
  const prompt = directionMapPrompt(input);
  expect(prompt).toContain("<materials>");
  expect(prompt).toContain("什么样才算可以交付");
  const map = parseDirectionMap(
    `\`\`\`json
${JSON.stringify({
  links: [
    {
      goal: "ai-product",
      project: "tool",
      reason: "它正在找真实用户",
      source: "l:tool:2026-10-23",
      quote: "第一轮朋友试用",
    },
    // 拿 tool 的日志给 story 当依据：丢掉。
    {
      goal: "novel",
      project: "story",
      reason: "借来的依据",
      source: "l:tool:2026-10-23",
      quote: "第一轮朋友试用",
    },
    // 只在序列化结构里出现的字串（stage）不是原文：丢掉。
    { goal: "novel", project: "story", reason: "结构字段", source: "p:story", quote: "active" },
    // 不存在的目标：丢掉。
    {
      goal: "made-up",
      project: "tool",
      reason: "编的",
      source: "l:tool:2026-10-23",
      quote: "第一轮朋友试用",
    },
  ],
  unlinked: [],
  suggestions: [
    { project: "tool", text: "模型改写的下一步" },
    { project: "story", text: "重读第二章结尾" },
  ],
  mentor: [
    {
      text: "小说三周没有新进展，可以先定一个更小的动作。",
      evidence: [{ source: "l:story:2026-10-02", quote: "写完第二章开场" }],
    },
    { text: "出处对不上。", evidence: [{ source: "l:tool:2026-10-23", quote: "写完第二章开场" }] },
  ],
})}
\`\`\``,
    input,
  );
  expect(map.links).toEqual([
    {
      goal: "ai-product",
      project: "tool",
      reason: "它正在找真实用户",
      source: "l:tool:2026-10-23",
      quote: "第一轮朋友试用",
    },
  ]);
  // 没连上的项目也要出现在图上。
  expect(map.unlinked.map((row) => row.project)).toEqual(["story"]);
  // 有用户定下的下一步时，模型的建议不算数。
  expect(directionNext(input, map)).toEqual([
    { project: "tool", text: "修好排版，再请一位朋友试用", kind: "todo" },
    { project: "story", text: "重读第二章结尾", kind: "suggested" },
  ]);
  expect(map.mentor).toHaveLength(1);
  expect(() => parseDirectionMap("不是 JSON", input)).toThrow("读不出来");
});

it("从真实 STATUS 和待办组材料：只有 todo 是事实，待采纳的建议保持建议身份，跳过的不出现", async () => {
  const ws = await freshWorkspace();
  const a = await createProject(ws, { title: "合成甲", kind: "personal" });
  await setProject(ws, a.slug, {
    next: [
      { id: "proposed", title: "AI 提的还没采纳", status: "proposed" },
      { id: "fix", title: "修好排版", status: "todo" },
      { id: "skip", title: "已经跳过的事", status: "skipped" },
      { id: "old", title: "做完的事", status: "done" },
    ],
  });
  const b = await createProject(ws, { title: "合成乙", kind: "personal" });
  await setProject(ws, b.slug, {
    next: [
      { id: "skip", title: "跳过了", status: "skipped" },
      { id: "maybe", title: "待采纳的建议", status: "proposed" },
    ],
  });
  const c = await createProject(ws, { title: "合成丙", kind: "personal" });
  await addTask(ws, { title: "挂在项目上的待办", project: c.slug });
  const material = directionMapInput(ws, "zh-CN", new Date("2026-10-22T16:30:00Z"));
  // 上海 00:30 已经是 23 日。
  expect(material.today).toBe("2026-10-23");
  const next = Object.fromEntries(
    material.projects.map((p) => [p.title, p.next.map((n) => [n.text, n.state])]),
  );
  expect(next).toEqual({
    合成甲: [
      ["AI 提的还没采纳", "proposed"],
      ["修好排版", "todo"],
    ],
    合成乙: [["待采纳的建议", "proposed"]],
    合成丙: [["挂在项目上的待办", "todo"]],
  });
  const steps = directionNext(material, {
    links: [],
    unlinked: [],
    suggestions: [
      { project: b.slug, text: "模型的建议" },
      { project: c.slug, text: "模型的建议" },
    ],
    mentor: [],
  });
  const title = (slug: string) => material.projects.find((p) => p.slug === slug)?.title;
  expect(Object.fromEntries(steps.map((step) => [title(step.project), [step.text, step.kind]]))).toEqual({
    合成甲: ["修好排版", "todo"],
    合成乙: ["待采纳的建议", "proposed"],
    合成丙: ["挂在项目上的待办", "todo"],
  });
});

it("资料变了就标成过期，对不上当前资料的看法撤下", async () => {
  vi.stubEnv("KAITU_LOCAL_STATE_DIR", mkdtempSync(join(tmpdir(), "kaitu-direction-")));
  const ws = await freshWorkspace();
  const today = localDate(new Date(), ws.timeZone());
  ws.writeJson("me/goals.json", [{ id: "run", title: "连续 12 周规律训练", status: "active" }]);
  const project = await createProject(ws, { title: "合成训练计划", kind: "personal" });
  appendLog(ws, project.slug, "完成第一周三次慢跑", today);
  const answer = JSON.stringify({
    links: [
      {
        goal: "run",
        project: project.slug,
        reason: "这就是训练本身",
        source: `l:${project.slug}:${today}`,
        quote: "完成第一周三次慢跑",
      },
    ],
    unlinked: [],
    suggestions: [],
    mentor: [],
  });
  await new Promise<void>((resolve) => generateDirectionMap(ws, async () => answer, "zh-CN", resolve));
  expect(readDirectionMap(ws)).toMatchObject({ stale: false, map: { links: [{ goal: "run" }] } });

  appendLog(ws, project.slug, "第二周两次", today);
  // 原文还在，看法留着，但提示资料有变化。
  expect(readDirectionMap(ws)).toMatchObject({ stale: true, map: { links: [{ goal: "run" }] } });

  ws.writeJson("me/goals.json", []);
  const after = readDirectionMap(ws);
  expect(after.map?.links).toEqual([]);
  expect(after.input?.goals).toEqual([]);
});
