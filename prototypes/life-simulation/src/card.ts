export type Locale = "zh" | "en";
export const dimensions = ["health", "knowledge", "relationships", "happiness"] as const;
export type Dimension = (typeof dimensions)[number];
export type Score = { value: number | null; source: string };
export type Role = "employed" | "founder" | "student" | "unemployed" | "retired" | "unknown";
export type Education = "secondary" | "vocational" | "degree" | "postgraduate" | "unknown";
export type Specialty = "service" | "technical" | "creative" | "general";
export interface Card {
  version: 2;
  name: string;
  age: number | null;
  role: Role;
  project: string;
  attributes: Record<Dimension, Score>;
  education: Education;
  specialty: Specialty;
}
export const labels: Record<Dimension, [string, string]> = {
  health: ["健康", "Health"],
  knowledge: ["知识", "Knowledge"],
  relationships: ["关系", "Relationships"],
  happiness: ["快乐", "Happiness"],
};
export const roleLabels: Record<Role, [string, string]> = {
  employed: ["受雇", "Employed"],
  founder: ["创业经营", "Founder"],
  student: ["在读", "Student"],
  unemployed: ["待业", "Between jobs"],
  retired: ["退休", "Retired"],
  unknown: ["未知", "Unknown"],
};
export const educationLabels: Record<Education, [string, string]> = {
  secondary: ["中学", "Secondary"],
  vocational: ["职业教育", "Vocational"],
  degree: ["本科", "Degree"],
  postgraduate: ["研究生", "Postgraduate"],
  unknown: ["未知", "Unknown"],
};
export const specialtyLabels: Record<Specialty, [string, string]> = {
  service: ["服务", "Service"],
  technical: ["技术", "Technical"],
  creative: ["创意", "Creative"],
  general: ["通用", "General"],
};
export function blankCard(): Card {
  return {
    version: 2,
    name: "",
    age: null,
    role: "unknown",
    project: "",
    education: "unknown",
    specialty: "general",
    attributes: Object.fromEntries(
      dimensions.map((k) => [k, { value: null, source: "" }]),
    ) as Card["attributes"],
  };
}
export function parseCard(input: string): Card {
  if (input.length > 16000) throw new Error("角色卡过长 / Card too long");
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(input.slice(input.indexOf("{"), input.lastIndexOf("}") + 1));
  } catch {
    throw new Error("JSON 格式有误，请检查后重试 / Invalid JSON; check and retry");
  }
  if (!raw || Array.isArray(raw) || raw.version !== 2)
    throw new Error("需要四属性 version 2 角色卡；旧五分卡请重新生成 / Please regenerate a version 2 card");
  const card = blankCard();
  const txt = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  card.name = txt(raw.name, 24);
  card.project = txt(raw.project, 80);
  if (
    raw.age !== null &&
    raw.age !== undefined &&
    (!Number.isInteger(raw.age) || Number(raw.age) < 18 || Number(raw.age) > 90)
  )
    throw new Error("本轮起始年龄为 18–90 或 null / Starting age must be 18–90 or null");
  card.age = typeof raw.age === "number" ? raw.age : null;
  for (const [key, options] of [
    ["role", roleLabels],
    ["education", educationLabels],
    ["specialty", specialtyLabels],
  ] as const) {
    if (raw[key] !== undefined) {
      if (typeof raw[key] !== "string" || !Object.hasOwn(options, String(raw[key])))
        throw new Error(`${key}: 无效选项 / Invalid option`);
      (card as unknown as Record<string, unknown>)[key] = raw[key];
    }
  }
  if (
    raw.attributes !== undefined &&
    (!raw.attributes || typeof raw.attributes !== "object" || Array.isArray(raw.attributes))
  )
    throw new Error("attributes 需要对象 / Invalid attributes");
  for (const key of dimensions) {
    const item = (raw.attributes as Record<string, unknown> | undefined)?.[key];
    if (item === undefined || item === null) continue;
    if (typeof item !== "object" || Array.isArray(item)) throw new Error(`${key}: 需要 value/source`);
    const v = item as Record<string, unknown>;
    const value = v.value === undefined || v.value === "unknown" ? null : v.value;
    if (value !== null && (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 100))
      throw new Error(`${key}: 分值为 0–100 或 null / Use 0–100 or null`);
    card.attributes[key] = { value: value as number | null, source: txt(v.source, 160) };
  }
  return card;
}
export function cardPrompt(locale: Locale) {
  return `${
    locale === "zh"
      ? "请根据你已经知道并能给出依据的信息，输出下方 JSON 的开图人生游戏角色卡。只输出 JSON，不调用工具，不上传或展开完整记忆。昵称；年龄未知用 null；role 未知用 unknown；project 只写我明确说过想做的事。四属性 health/knowledge/relationships/happiness 是 0–100 的游戏设定，不是健康诊断或人生评价；只在有依据时估计并在 source 标明‘AI 游戏估计’及依据。不知道保留 null，不把缺少记录当低分。不得推断疾病、寿命、真实资产、学历、家庭成员或财务能力。education: secondary/vocational/degree/postgraduate/unknown；specialty: service/technical/creative/general。role: employed/founder/student/unemployed/retired/unknown。我会检查修改。"
      : "Using only information you already know and can support, return this JSON game character. No tools or full memory export. Use an alias. Unknown age/attributes stay null; unknown role/education stay unknown. project must be something I explicitly wanted. Four 0–100 attributes are game settings, never diagnoses or personal worth. Label supported estimates as AI game estimates in source. Never infer low scores from missing records, diagnoses, lifespan, money, education or family. Allowed role: employed/founder/student/unemployed/retired/unknown; education: secondary/vocational/degree/postgraduate/unknown; specialty: service/technical/creative/general. I will review and edit."
  }\n\n${JSON.stringify(blankCard(), null, 2)}`;
}
export function sampleCard(index: number, locale: Locale): Card {
  const card = blankCard();
  card.name = (locale === "zh" ? ["林", "周", "乔"] : ["Lin", "Zhou", "Jo"])[index % 3];
  card.age = [28, 36, 45][index % 3];
  card.role = "employed";
  card.education = "degree";
  card.specialty = (["technical", "service", "creative"] as const)[index % 3];
  card.project = locale === "zh" ? "做一本自己的短篇集" : "Make a short story collection";
  for (const [i, key] of dimensions.entries())
    card.attributes[key] = {
      value: 48 + ((index + i) % 3) * 9,
      source: locale === "zh" ? "虚构角色" : "Fictional character",
    };
  return card;
}
