import { expect, it } from "vitest";
import { type DirectionMapInput, directionMapPrompt, parseDirectionMap } from "../src/index.js";

const input: DirectionMapInput = {
  today: "2026-10-23",
  goals: [
    { id: "ai-product", title: "转向 AI 产品工作", why: "做真正有人用的产品" },
    { id: "novel", title: "写完一部中篇小说" },
  ],
  projects: [
    {
      slug: "tool",
      title: "合成效率工具",
      stage: "active",
      next: ["修好排版，再请一位朋友试用"],
      logs: [{ date: "2026-10-23", text: "第一轮朋友试用，发现长文本排版问题" }],
    },
    {
      slug: "story",
      title: "合成小说",
      stage: "active",
      next: [],
      logs: [{ date: "2026-10-02", text: "写完第二章开场" }],
    },
  ],
  directions: [],
};

it("只留下有原文依据、对得上目标和项目的看法；项目自己的下一步优先", () => {
  const prompt = directionMapPrompt(input);
  expect(prompt).toContain("<materials>");
  expect(prompt).toContain("什么样才算可以交付");
  const map = parseDirectionMap(
    `\`\`\`json
${JSON.stringify({
  links: [
    { goal: "ai-product", project: "tool", reason: "它正在找真实用户", quote: "第一轮朋友试用" },
    // 引用改写过，材料里找不到原文：丢掉。
    { goal: "ai-product", project: "story", reason: "也算产品", quote: "第一次给朋友试用" },
    // 不存在的目标：丢掉。
    { goal: "made-up", project: "tool", reason: "编的", quote: "第一轮朋友试用" },
  ],
  unlinked: [],
  next: [
    { project: "tool", text: "模型改写的下一步", suggested: true },
    { project: "story", text: "重读第二章结尾", suggested: true },
  ],
  mentor: [
    { text: "小说三周没有新进展，可以先定一个更小的动作。", evidence: ["写完第二章开场"] },
    { text: "没有依据的话。", evidence: ["材料里没有这句"] },
  ],
})}
\`\`\``,
    input,
  );
  expect(map.links).toEqual([
    { goal: "ai-product", project: "tool", reason: "它正在找真实用户", quote: "第一轮朋友试用" },
  ]);
  // 没连上的项目也要出现在图上。
  expect(map.unlinked.map((row) => row.project)).toEqual(["story"]);
  expect(map.next).toEqual([
    { project: "tool", text: "修好排版，再请一位朋友试用", suggested: false },
    { project: "story", text: "重读第二章结尾", suggested: true },
  ]);
  expect(map.mentor).toHaveLength(1);
  expect(() => parseDirectionMap("不是 JSON", input)).toThrow("读不出来");
});
