import fs from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Workspace } from "../workspace.js";
import { novelScene, readNovel, validateAnchor } from "./index.js";
import { type Anchor, anchorSchema, canon } from "./model.js";
import { moonGravity } from "./reference.js";
import { changeStore, id, readStore } from "./store.js";
import { dateValue } from "./time.js";

const units: Record<string, { factor: number; dimension: string }> = {
  m: { factor: 1, dimension: "L" },
  km: { factor: 1000, dimension: "L" },
  cm: { factor: 0.01, dimension: "L" },
  s: { factor: 1, dimension: "T" },
  min: { factor: 60, dimension: "T" },
  h: { factor: 3600, dimension: "T" },
  "m/s": { factor: 1, dimension: "L/T" },
  "km/h": { factor: 1 / 3.6, dimension: "L/T" },
  "m/s^2": { factor: 1, dimension: "L/T^2" },
  "cm/s^2": { factor: 0.01, dimension: "L/T^2" },
};
export function convertNovelUnit(value: number, from: string, to: string) {
  const a = units[from];
  const b = units[to];
  if (!a || !b || !Number.isFinite(value))
    return { type: "information_missing", error: "请提供支持的单位和有限数值" };
  if (a.dimension !== b.dimension)
    return {
      type: "hard_rule_conflict",
      error: "两侧量纲不同",
      from,
      to,
      dimensions: [a.dimension, b.dimension],
    };
  return {
    type: "calculated",
    value: (value * a.factor) / b.factor,
    unit: to,
    dimension: a.dimension,
    normalized: value * a.factor,
    formula: "value × from.factor / to.factor",
    version: "1.0.0",
  };
}
export function fallTime(height: number, g: number) {
  return Math.sqrt((2 * height) / g);
}
const quantity = z.object({ value: z.number().finite(), unit: z.string() });
const exception = z.object({
  id: z.string(),
  statement: z.string().min(1),
  location: z.string().min(1),
  from: z.string().nullable(),
  to: z.string().nullable(),
  canon,
});
export const ruleSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().positive(),
  title: z.string().min(1),
  statement: z.string().min(1),
  kind: z.enum(["gravity", "fictional", "setting"]),
  canon,
  location: z.string(),
  frame: z.string(),
  from: z.string().nullable(),
  to: z.string().nullable(),
  g: quantity.nullable(),
  exceptions: z.array(exception),
  sources: z.array(anchorSchema).min(1),
  reason: z.string().min(1),
});
export type WorldRule = z.infer<typeof ruleSchema>;
const checkInput = z.object({
  scene: z.string(),
  rule: z.string(),
  version: z.number().int(),
  location: z.string(),
  frame: z.string(),
  worldTime: z.string().nullable(),
  height: quantity.nullable(),
  reportedTime: quantity.nullable(),
  toleranceSeconds: z.number().finite().nonnegative(),
  // These are explicit author inputs, never inferred from silence in the prose.
  fromRest: z.boolean(),
  constantGravity: z.boolean(),
  noDrag: z.boolean(),
  noExtraForce: z.boolean(),
  evidenceKind: z.enum(["author_confirmed", "narration", "character_claim", "metaphor", "dream"]),
});
export type ScienceInput = z.infer<typeof checkInput>;
export interface Finding {
  id: string;
  input: ScienceInput;
  ruleVersion: number;
  fileHash: string;
  anchor: Anchor;
  created: string;
  relatedAnchors?: Anchor[];
  result: {
    type: string;
    conclusion: string;
    missing?: string[];
    references?: { title: string; url: string }[];
    calculation?: {
      resultSeconds: number;
      heightM: number;
      gravityMps2: number;
      reportedSeconds: number;
      toleranceSeconds: number;
      formula: string;
      version: string;
      unit: string;
    };
    assumptions?: string[];
  };
  status: "open" | "confirmed" | "deferred" | "false_positive";
  note: string;
}
interface ScienceData {
  schemaVersion: 1;
  rules: WorldRule[];
  findings: Finding[];
}
const empty = (): ScienceData => ({ schemaVersion: 1, rules: [], findings: [] });
function file(ws: Workspace, project: string) {
  return join(readNovel(ws, project).value.managedRoot, "science.json");
}
function within(time: string | null, from: string | null, to: string | null) {
  if (!from && !to) return true;
  const t = dateValue(time ?? "");
  if (t === null || (from && dateValue(from) === null) || (to && dateValue(to) === null)) return null;
  return (!from || t >= (dateValue(from) as number)) && (!to || t <= (dateValue(to) as number));
}
export function scienceView(ws: Workspace, project: string) {
  const { value: data, revision } = readStore(file(ws, project), empty);
  const novel = readNovel(ws, project).value;
  return {
    data,
    revision,
    stale: data.findings
      .filter((finding) => {
        const versions = data.rules.filter((rule) => rule.id === finding.input.rule);
        const current = versions
          .filter((rule) => within(finding.input.worldTime, rule.from, rule.to) === true)
          .at(-1);
        return (
          !validateAnchor(novel, finding.anchor) ||
          !(finding.relatedAnchors ?? []).every((anchor) => validateAnchor(novel, anchor)) ||
          (finding.ruleVersion > 0 &&
            (!current ||
              current.version !== finding.ruleVersion ||
              !current.sources.every((source) => validateAnchor(novel, source))))
        );
      })
      .map((finding) => finding.id),
  };
}
export function saveScienceRule(ws: Workspace, project: string, revision: string, input: unknown) {
  return changeStore(file(ws, project), empty, revision, (data) => {
    const rule = ruleSchema.parse(input);
    const previous = data.rules.filter((item) => item.id === rule.id).at(-1);
    if (rule.version !== (previous?.version ?? 0) + 1) throw new Error("规则版本已变化，请刷新后核对");
    for (const range of [rule, ...rule.exceptions]) {
      if (
        (range.from && dateValue(range.from) === null) ||
        (range.to && dateValue(range.to) === null) ||
        (range.from && range.to && range.from > range.to)
      )
        throw new Error("生效区间使用完整公历日期，未知请留空");
    }
    const novel = readNovel(ws, project).value;
    if (!rule.sources.every((source) => validateAnchor(novel, source)))
      throw new Error("规则来源已变化，请重新定位");
    data.rules.push(rule);
  });
}
export function runScienceCheck(ws: Workspace, project: string, revision: string, input: unknown) {
  return changeStore(file(ws, project), empty, revision, (data) => {
    const args = checkInput.parse(input);
    const source = novelScene(ws, project, args.scene);
    const rule = data.rules.find((item) => item.id === args.rule && item.version === args.version);
    if (!rule) throw new Error("请选择规则版本");
    const missing: string[] = [];
    const applicable = within(args.worldTime, rule.from, rule.to);
    if (applicable !== true)
      missing.push(
        applicable === null ? "规则生效年代与场景世界时间" : "当前年代不适用所选规则，请选择历史版本",
      );
    const newer = data.rules.filter((item) => item.id === rule.id && item.version > rule.version);
    if (newer.some((item) => within(args.worldTime, item.from, item.to) !== false))
      missing.push("选择适用年代的最新规则版本，或补齐世界时间");
    if (rule.canon !== "confirmed") missing.push("作者确认的规则");
    if (!rule.sources.every((anchor) => validateAnchor(readNovel(ws, project).value, anchor)))
      missing.push("有效的规则来源");
    if (!args.location || args.location !== rule.location) missing.push("匹配的地点范围");
    if (!args.frame || args.frame !== rule.frame) missing.push("明确且匹配的参考系");
    const activeException = rule.exceptions.find(
      (item) =>
        item.canon === "confirmed" &&
        item.location === args.location &&
        within(args.worldTime, item.from, item.to) === true,
    );
    if (
      rule.exceptions.some(
        (item) =>
          item.canon === "confirmed" &&
          item.location === args.location &&
          within(args.worldTime, item.from, item.to) === null,
      )
    )
      missing.push("例外生效时间");
    let result: Finding["result"];
    if (args.evidenceKind !== "author_confirmed")
      result = {
        type: "information_missing",
        conclusion: "这段陈述尚未由作者确认为世界事实",
        missing: ["确认陈述含义；人物主张、梦境和比喻保留为摘录"],
      };
    else if (missing.length)
      result = { type: "information_missing", conclusion: "适用条件尚不齐备", missing };
    else if (activeException)
      result = { type: "plausibility_note", conclusion: `适用作者确认例外：${activeException.statement}` };
    else if (rule.kind === "setting")
      result = {
        type: "plausibility_note",
        conclusion: "世界书原文已导入，可作定性对照；具体数值问题再选择对应计算模型",
      };
    else if (rule.kind === "fictional")
      result = { type: "plausibility_note", conclusion: "保留作者确认的虚构前提；本计算器未覆盖其内部限制" };
    else {
      for (const [key, label] of [
        ["fromRest", "从静止释放"],
        ["constantGravity", "恒定重力"],
        ["noDrag", "忽略阻力"],
        ["noExtraForce", "无额外作用力"],
      ] as const)
        if (!args[key]) missing.push(label);
      const height = args.height ? convertNovelUnit(args.height.value, args.height.unit, "m") : null;
      const gravity = rule.g ? convertNovelUnit(rule.g.value, rule.g.unit, "m/s^2") : null;
      const reported = args.reportedTime
        ? convertNovelUnit(args.reportedTime.value, args.reportedTime.unit, "s")
        : null;
      if (height?.type !== "calculated" || height.value === undefined || height.value < 0)
        missing.push("带长度单位的非负高度");
      if (gravity?.type !== "calculated" || gravity.value === undefined || gravity.value <= 0)
        missing.push("带加速度单位的正重力参数");
      if (reported?.type !== "calculated" || reported.value === undefined || reported.value < 0)
        missing.push("带时间单位的原文报告值");
      const heightM = height?.value;
      const gravityMps2 = gravity?.value;
      const reportedSeconds = reported?.value;
      if (
        missing.length ||
        heightM === undefined ||
        gravityMps2 === undefined ||
        reportedSeconds === undefined
      )
        result = { type: "information_missing", conclusion: "补齐条件后可复算", missing };
      else {
        const seconds = fallTime(heightM, gravityMps2);
        result = {
          type:
            Math.abs(seconds - reportedSeconds) > args.toleranceSeconds
              ? "hard_rule_conflict"
              : "plausibility_note",
          conclusion: `恒定重力下所需时间 ${seconds.toFixed(9)} s；报告值 ${reportedSeconds} s，容差 ${args.toleranceSeconds} s`,
          assumptions: [
            "作者确认输入",
            "静止释放",
            "恒定重力",
            "忽略阻力",
            "无额外作用力",
            `参考系：${args.frame}`,
          ],
          calculation: {
            heightM: heightM,
            gravityMps2: gravityMps2,
            reportedSeconds: reportedSeconds,
            toleranceSeconds: args.toleranceSeconds,
            formula: "t = sqrt(2 × h / g)",
            resultSeconds: seconds,
            version: "1.0.0",
            unit: "s",
          },
        };
      }
    }
    // Equal-scope rules need an author's decision, never an arbitrary winner.
    const peers = data.rules.filter(
      (item) =>
        item.id !== rule.id &&
        item.canon === "confirmed" &&
        item.kind === "gravity" &&
        item.location === args.location &&
        item.frame === args.frame &&
        within(args.worldTime, item.from, item.to) === true &&
        data.rules
          .filter((other) => other.id === item.id && within(args.worldTime, other.from, other.to) === true)
          .at(-1) === item,
    );
    if (rule.kind === "gravity" && peers.some((peer) => JSON.stringify(peer.g) !== JSON.stringify(rule.g)))
      result = {
        type: "information_missing",
        conclusion: "同一范围的确认规则有冲突，请作者决定优先关系",
        missing: ["规则优先关系"],
      };
    const finding: Finding = {
      id: id(),
      input: args,
      ruleVersion: rule.version,
      fileHash: source.anchor.fileHash,
      anchor: source.anchor,
      created: new Date().toISOString(),
      result,
      status: "open",
      note: "",
    };
    data.findings.push(finding);
    return finding;
  });
}
export function reviewScienceFinding(ws: Workspace, project: string, revision: string, input: unknown) {
  const args = z
    .object({ id: z.string(), status: z.enum(["confirmed", "deferred", "false_positive"]), note: z.string() })
    .parse(input);
  return changeStore(file(ws, project), empty, revision, (data) => {
    const finding = data.findings.find((item) => item.id === args.id);
    if (!finding) throw new Error("找不到检查记录");
    Object.assign(finding, { status: args.status, note: args.note });
  });
}
export function scienceExists(ws: Workspace, project: string) {
  return fs.existsSync(file(ws, project));
}

// Qualitative comparison remains an editor's note; it cannot create a hard conflict or alter canon.
export function recordScienceNote(ws: Workspace, project: string, revision: string, input: unknown) {
  const args = z
    .object({
      scene: z.string(),
      relatedScenes: z.array(z.string()).default([]),
      type: z.enum(["information_missing", "plausibility_note"]),
      conclusion: z.string().min(1),
      missing: z.array(z.string()).default([]),
      useMoonReference: z.boolean().default(false),
    })
    .parse(input);
  return changeStore(file(ws, project), empty, revision, (data) => {
    const source = novelScene(ws, project, args.scene);
    const finding: Finding = {
      id: id(),
      input: {
        scene: source.scene.id,
        rule: "",
        version: 0,
        location: "",
        frame: "",
        worldTime: null,
        height: null,
        reportedTime: null,
        toleranceSeconds: 0,
        fromRest: false,
        constantGravity: false,
        noDrag: false,
        noExtraForce: false,
        evidenceKind: "narration",
      },
      ruleVersion: 0,
      fileHash: source.anchor.fileHash,
      anchor: source.anchor,
      relatedAnchors: args.relatedScenes.map((scene) => novelScene(ws, project, scene).anchor),
      created: new Date().toISOString(),
      result: {
        type: args.type,
        conclusion: args.conclusion,
        missing: args.missing,
        references: args.useMoonReference ? [{ title: moonGravity.title, url: moonGravity.url }] : [],
      },
      status: "open",
      note: "",
    };
    data.findings.push(finding);
    return { id: finding.id, type: finding.result.type };
  });
}

export function importWorldbook(ws: Workspace, project: string, revision: string, documentId: string) {
  const novel = readNovel(ws, project).value;
  const scenes = novel.scenes.filter((scene) => scene.documentId === documentId);
  if (!scenes.length) throw new Error("请选择已索引的世界书文件");
  return changeStore(file(ws, project), empty, revision, (data) => {
    let imported = 0;
    let unchanged = 0;
    for (const scene of scenes) {
      const source = novelScene(ws, project, scene.id);
      const text = source.text.replace(/^#{1,6}[^\n]*(?:\n|$)/, "").trim();
      if (!text) continue;
      const ruleId = `worldbook-${scene.id}`;
      const previous = data.rules.filter((rule) => rule.id === ruleId).at(-1);
      if (previous?.sources[0]?.fileHash === source.anchor.fileHash && previous.statement === text) {
        unchanged++;
        continue;
      }
      // The source's own adopted / candidate / uncertain language remains visible verbatim.
      const tentative = /候选|未定|待定|尚未采用/.test(scene.title);
      data.rules.push({
        id: ruleId,
        version: (previous?.version ?? 0) + 1,
        title: scene.title,
        statement: text,
        kind: "setting",
        canon: tentative ? "tentative" : "excerpt",
        location: "",
        frame: "",
        from: null,
        to: null,
        g: null,
        exceptions: [],
        sources: [source.anchor],
        reason: "从作者选定的当前世界书导入；保留原文采用状态",
      });
      imported++;
    }
    return { imported, unchanged };
  });
}
