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

test("pasted prose, fences and quoted braces preserve details; malformed and multiple cards explain the failure", () => {
  const card = blankCard();
  card.age = 42;
  card.background = {
    education: "博士",
    major: "凝聚态物理",
    industry: "金融",
    occupation: "量化研究员",
    experienceYears: 7,
    source: "用户说：“研究 {模型}”。来自当前对话。",
  };
  const json = JSON.stringify(card);
  for (const text of [
    json,
    `说明 {不是 JSON}。\n${json}\n附注 {不是卡片}`,
    `说明 {背景}\n\`\`\`json\n${json}\n\`\`\`\n其他 {注释}`,
  ])
    assert.deepEqual(parseCard(text), card);
  const state = initialState(card, "details");
  assert.equal(state.experience, 7);
  assert.equal(card.role, "unknown");
  assert.equal(card.background.occupation, "量化研究员");
  card.starting = { role: "student", experienceYears: 2, cash: 13000, deposits: 25000 };
  const start = initialState(card, "override");
  assert.equal(start.role, "student");
  assert.equal(start.experience, 2);
  assert.equal(start.assets.cash, 1300000);
  assert.equal(card.role, "unknown");
  assert.equal(card.background.experienceYears, 7);
  assert.throws(() => parseCard(json + json), /Multiple cards/);
  assert.throws(() => parseCard('{"version":2,"age":}'), /Cannot read card JSON/);
  assert.throws(() => parseCard('{"version":2'), /Missing closing/);
  assert.throws(() => parseCard(JSON.stringify({ ...card, role: "量化研究员" })), /role:.*employed/);
  assert.throws(
    () => parseCard(JSON.stringify({ ...card, background: { experienceYears: -1 } })),
    /background.experienceYears/,
  );
  const legacy = { ...card };
  legacy.background = undefined;
  legacy.starting = undefined;
  assert.equal(parseCard(JSON.stringify(legacy)).version, 2);
  assert.equal(parseCard(JSON.stringify(legacy)).background.experienceYears, null);
});
