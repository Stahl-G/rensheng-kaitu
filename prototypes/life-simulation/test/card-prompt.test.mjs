import assert from "node:assert/strict";
import { test } from "node:test";
import { blankCard, cardPrompt, parseCard } from "../dist/card.js";
import { initialState } from "../dist/simulation.js";

test("generated prompts allow scoped read-only evidence and distinguish unavailable from unrecorded", () => {
  for (const locale of ["zh", "en"]) {
    const prompt = cardPrompt(locale);
    assert.doesNotMatch(prompt, /不调用工具|禁止.*调用工具|\bno tools\b|do not (?:call|use) tools/i);
    const terms =
      locale === "zh"
        ? [
            "只读工具或连接器",
            "已授权",
            "当前无法访问",
            "在已读资料中未记录",
            "最高已完成学历",
            "AI 游戏估计",
            "用户指定的游戏设定",
          ]
        : [
            "read-only tools or connectors",
            "already authorized",
            "currently inaccessible",
            "not recorded in the material read",
            "highest completed qualification",
            "AI game estimate",
            "User-specified game setting",
          ];
    for (const term of terms) assert.ok(prompt.toLowerCase().includes(term.toLowerCase()), term);
    assert.deepEqual(parseCard(prompt), blankCard());
  }
  const card = blankCard();
  card.age = 34;
  card.role = "employed";
  card.education = "degree";
  card.specialty = "technical";
  card.attributes.health.source = "当前无法访问相关资料：连接器未连接";
  card.attributes.knowledge = { value: 62, source: "AI 游戏估计；依据用户陈述：近期完成软件课程" };
  const response = `已读取：当前对话。年龄与已完成学历来自用户陈述。\n未读取：开图连接器未连接。\n\n\`\`\`json\n${JSON.stringify(card)}\n\`\`\``;
  const parsed = parseCard(response);
  const state = initialState(parsed, "prompt-evidence");
  assert.deepEqual(parsed, card);
  assert.equal(parsed.attributes.health.value, null);
  assert.equal(state.props.health, 50);
  assert.equal(state.education, "degree");
  assert.equal(state.props.knowledge, 62);
});
