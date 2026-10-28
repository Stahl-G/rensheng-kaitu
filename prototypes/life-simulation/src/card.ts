export type Locale = "zh" | "en";
export const dimensions = ["energy", "knowledge", "resources", "connection", "joy"] as const;
export type Dimension = (typeof dimensions)[number];
export type Score = { value: number | null; source: string };
export type Role = "employed" | "founder" | "student" | "other" | "unknown";
export interface Card {
  version: 1;
  name: string;
  age: number | null;
  role: Role;
  project: string;
  attributes: Record<Dimension, Score>;
}
export const labels: Record<Dimension, [string, string]> = {
  energy: ["精力", "Energy"],
  knowledge: ["知识", "Knowledge"],
  resources: ["余量", "Resources"],
  connection: ["联结", "Connection"],
  joy: ["心情", "Joy"],
};
export const roleLabels: Record<Role, [string, string]> = {
  employed: ["受雇工作", "Employed"],
  founder: ["自己经营", "Self-employed"],
  student: ["在读", "Studying"],
  other: ["其他状态", "Other"],
  unknown: ["未知", "Unknown"],
};
export function blankCard(): Card {
  return {
    version: 1,
    name: "",
    age: null,
    role: "unknown",
    project: "",
    attributes: Object.fromEntries(
      dimensions.map((key) => [key, { value: null, source: "" }]),
    ) as Card["attributes"],
  };
}
export function parseCard(input: string): Card {
  if (input.length > 16000) throw new Error("角色卡超过 16,000 字符 / Card exceeds 16,000 characters");
  let data: Record<string, unknown>;
  try {
    const start = input.indexOf("{");
    const end = input.lastIndexOf("}");
    data = JSON.parse(input.slice(start, end + 1));
  } catch {
    throw new Error("未读到 JSON 角色卡，请检查后重新粘贴 / Invalid JSON card; check and paste again");
  }
  if (!data || Array.isArray(data) || data.version !== 1)
    throw new Error("需要 version 为 1 的角色卡 / Card version must be 1");
  const card = blankCard();
  const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
  card.name = text(data.name, 24);
  card.project = text(data.project, 40);
  if (
    data.age !== null &&
    data.age !== undefined &&
    (!Number.isInteger(data.age) || Number(data.age) < 0 || Number(data.age) > 110)
  )
    throw new Error("年龄应为 0–110 的整数或 null / Age must be 0–110 or null");
  card.age = typeof data.age === "number" ? data.age : null;
  if (typeof data.role === "string" && Object.hasOwn(roleLabels, data.role)) card.role = data.role as Role;
  else if (data.role !== undefined) throw new Error("职业状态格式无效 / Invalid role");
  const attributes = data.attributes;
  if (
    attributes !== undefined &&
    (!attributes || typeof attributes !== "object" || Array.isArray(attributes))
  )
    throw new Error("attributes 需要对象 / attributes must be an object");
  if (attributes && typeof attributes === "object" && !Array.isArray(attributes)) {
    for (const key of dimensions) {
      const raw = (attributes as Record<string, unknown>)[key];
      if (raw === undefined || raw === null) continue;
      if (typeof raw !== "object" || Array.isArray(raw))
        throw new Error(`${key}: 需要 value 和 source / Expected value and source`);
      const item = raw as Record<string, unknown>;
      const value = item.value === "unknown" || item.value === undefined ? null : item.value;
      if (value !== null && (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 5))
        throw new Error(`${key}: 分值应为 1–5 或 null / Score must be 1–5 or null`);
      card.attributes[key] = { value: value as number | null, source: text(item.source, 160) };
    }
  }
  return card;
}
export function cardPrompt(locale: Locale): string {
  const instructions =
    locale === "zh"
      ? [
          "请用你已经知道、且能直接引用依据的关于我的信息，生成一张 Kaitu 人生推演游戏角色卡。只输出下面格式的 JSON，不调用工具，不读取或上传完整记忆。",
          "用昵称，勿含地址、财务金额、疾病、凭据或他人隐私。不要编造经历、计划或当前年龄；不知道写 null，role 不知道写 unknown，文本不知道留空。role 只能是 employed/founder/student/other/unknown。project 只写我已明确说过的一件想做的事。",
          "attributes 每项都是游戏角色设定：energy 日常可支配精力，knowledge 与该项目相关的熟悉度，resources 可支配时间与工具，connection 可获得的支持，joy 当前主观心情。",
          "可按已有明确依据估计 1–5（很少/较少/中等/较多/很多），source 写一条简短依据，并标 AI 估计。不知道保留 null，不用缺少记录、地图清晰度、MBTI 或身份推算低分，不作医学、财务或寿命预测。由我回到网页检查和修改。",
        ]
      : [
          "Create a Kaitu simulation character card using only what you already know about me and can support with a short source. Return only JSON in the format below. Do not call tools, fetch or upload full memory.",
          "Use an alias; omit addresses, financial amounts, diagnoses, credentials and other people's private information. Do not invent past events, plans or my current age. Unknown values are null, unknown role is unknown, unknown text is empty. role must be employed/founder/student/other/unknown. project is one thing I have explicitly said I want to work on.",
          "Attributes are game settings: energy = available everyday energy, knowledge = familiarity relevant to the project, resources = available time and tools, connection = available support, joy = self-reported mood.",
          "Estimate 1–5 only with explicit evidence (very little/little/moderate/much/very much); label source as AI estimate and give a short basis. Unknown stays null. Missing records, map clarity, MBTI and identity are not evidence of low scores. Do not make medical, financial or lifespan predictions. I will review and edit the card in the website.",
        ];
  return [...instructions, JSON.stringify(blankCard(), null, 2)].join("\n\n");
}
export function sampleCard(index: number, locale: Locale): Card {
  const cards =
    locale === "zh"
      ? [
          ["林", "完成一个小作品"],
          ["周", "学会一门新手艺"],
          ["乔", "整理一本旅行手记"],
        ]
      : [
          ["Lin", "Finish a small creative project"],
          ["Zhou", "Learn a new craft"],
          ["Jo", "Make a travel journal"],
        ];
  const [name, project] = cards[index % cards.length];
  return {
    version: 1,
    name,
    age: [28, 36, 45][index % 3],
    role: ["employed", "founder", "other"][index % 3] as Role,
    project,
    attributes: Object.fromEntries(
      dimensions.map((key, i) => [
        key,
        {
          value: 2 + ((index + i) % 3),
          source: locale === "zh" ? "随机角色 · 虚构" : "Random character · fictional",
        },
      ]),
    ) as Card["attributes"],
  };
}
