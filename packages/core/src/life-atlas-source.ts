import { readdirSync, statSync } from "node:fs";
import type { DomainRule, Fact, LifeData } from "@kaitu/cartographer";
import { parseFrontmatter } from "./frontmatter.js";
import {
  type RecordTypeRef,
  listModules,
  listRecordTypes,
  recordFilePattern,
  resolveRecordPath,
} from "./modules.js";
import { onboardingModuleChoices } from "./onboarding.js";
import { type StoredRecord, readRecords } from "./records.js";
import type { Workspace } from "./workspace.js";

export interface AtlasSource {
  data: LifeData;
  rules: DomainRule[];
  modules: { id: string; title: string; available: boolean; recommended: boolean }[];
  gaps: string[];
}

/** Runs in the background worker; uses the existing workspace reader and record revision semantics. */
export function atlasSource(ws: Workspace): AtlasSource {
  const domains = new Map<string, { id: string; title: string; facts: Fact[]; priority?: number }>();
  const gaps: string[] = [];
  const sources: string[] = [];
  let bytesRead = 0;
  const add = (id: string, title: string, fact?: Fact) => {
    let d = domains.get(id);
    if (!d) {
      d = { id, title, facts: [] };
      domains.set(id, d);
    }
    if (fact && !d.facts.some((f) => f.id === fact.id)) d.facts.push(fact);
  };
  function text(file: string) {
    if (!ws.exists(file)) return "";
    if (
      statSync(ws.resolve(file)).size > 512_000 ||
      bytesRead + statSync(ws.resolve(file)).size > 4_000_000
    ) {
      gaps.push(file);
      return "";
    }
    const value = ws.scanText(file);
    if (value === undefined) {
      gaps.push(file);
      return "";
    }
    if (value.length > 512_000 || bytesRead + value.length > 4_000_000) {
      gaps.push(file);
      return "";
    }
    sources.push(file);
    bytesRead += value.length;
    return value;
  }
  const modules = listModules(ws).slice(0, 24);
  for (const { dir, def } of modules) {
    if (["me", "explore"].includes(dir)) continue;
    const id = def.id === "jobs" ? "work" : def.id;
    add(id, id === "work" ? "工作与求职" : def.name);
    const files = [
      `${dir}/STATUS.md`,
      ...readdirSync(ws.resolve(dir), { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name !== "data" && !entry.name.startsWith("."))
        .slice(0, 40)
        .map((entry) => `${dir}/${entry.name}/STATUS.md`),
    ];
    for (const file of files) {
      try {
        const value = text(file);
        if (!value) continue;
        const { data: m } = parseFrontmatter<{
          title?: string;
          updated?: string;
          stage?: string;
          next?: { id: string; title: string; status: string }[];
          progress?: Fact["progress"];
          links?: { role: string }[];
        }>(value);
        const creation = dir === "projects" && m.links?.some((link) => link.role === "manuscript");
        const target = creation ? "creation" : id;
        const title = creation ? "创作" : def.name;
        if (m.title)
          add(target, title, {
            id: file,
            title: m.title,
            kind: dir === "learning" ? "topic" : "project",
            status: m.stage ?? "recorded",
            source: file,
            updated: m.updated,
            ...(m.progress ? { progress: m.progress } : {}),
          });
        for (const next of m.next ?? [])
          if (["todo", "done"].includes(next.status))
            add(target, title, {
              id: `${file}#${next.id}`,
              title: next.title,
              kind: "plan",
              status: next.status === "done" ? "recorded" : "planned",
              source: file,
              updated: m.updated,
            });
      } catch {
        gaps.push(file);
      }
    }
  }
  try {
    for (const goal of JSON.parse(text("me/goals.json") || "[]") as {
      id: string;
      title: string;
      area?: string;
      status?: string;
      updated?: string;
    }[]) {
      const area = goal.area ?? "";
      const id = /健康|health/i.test(area)
        ? "health"
        : /工作|职业|求职|career|work/i.test(area)
          ? "work"
          : /学习|learning/i.test(area)
            ? "learning"
            : /创作|writing/i.test(area)
              ? "creation"
              : (modules.find((m) => m.dir === area || m.def.name === area)?.def.id ?? "goals");
      add(
        id,
        (
          { health: "健康", work: "工作与求职", learning: "学习", creation: "创作", goals: "目标" } as Record<
            string,
            string
          >
        )[id] ?? area,
        {
          id: goal.id,
          title: goal.title,
          kind: "goal",
          status: goal.status ?? "unknown",
          source: "me/goals.json",
          updated: goal.updated,
        },
      );
    }
  } catch {
    gaps.push("me/goals.json");
  }
  const profile = text("me/profile.md");
  const profileDate = profile.match(/整理日期\s*(\d{4}-\d{2}-\d{2})/)?.[1];
  for (const [i, line] of profile.split("\n").entries()) {
    if (/担任|任职|工作于|^目前常驻/.test(line))
      add("work", "工作与求职", {
        id: `profile-work-${i}`,
        title: line.slice(0, 500),
        kind: "context",
        status: "recorded",
        source: "me/profile.md",
        updated: profileDate,
      });
  }
  // Read complete revision streams through the existing reader. A partial stream could
  // resurrect deleted data, so unavailable or oversized types are omitted as a whole.
  function records(ref: RecordTypeRef): StoredRecord[] {
    const { dir, match } = recordFilePattern(ref);
    try {
      const abs = resolveRecordPath(ws, ref, dir);
      if (!ws.exists(dir)) return [];
      const names = readdirSync(abs).filter((name) => match.test(name));
      const sizes = names.map((name) => statSync(resolveRecordPath(ws, ref, `${dir}/${name}`)).size);
      const bytes = sizes.reduce((n, size) => n + size, 0);
      if (names.length > 120 || sizes.some((size) => size > 512_000) || bytesRead + bytes > 4_000_000) {
        gaps.push(dir);
        return [];
      }
      if (names.some((name) => ws.scanText(`${dir}/${name}`) === undefined)) {
        gaps.push(dir);
        return [];
      }
      bytesRead += bytes;
      sources.push(dir);
      return readRecords(ws, ref.type);
    } catch {
      gaps.push(dir);
      return [];
    }
  }
  for (const ref of listRecordTypes(ws).filter((r) => modules.some((m) => m.dir === r.module.dir))) {
    const historical = ref.type === "experience";
    if (!historical && ["me", "explore"].includes(ref.module.def.id)) continue;
    const id = historical ? "experience" : ref.module.def.id === "jobs" ? "work" : ref.module.def.id;
    const title = historical ? "来路" : id === "work" ? "工作与求职" : ref.module.def.name;
    add(id, title);
    for (const row of records(ref).slice(historical ? -100 : -5)) {
      const factTitle =
        typeof row.title === "string"
          ? row.title
          : typeof row.exercise === "string"
            ? row.exercise
            : (ref.def.label ?? ref.type);
      add(id, title, {
        id: `record:${ref.type}:${row.id}`,
        title: factTitle,
        kind: historical ? "experience" : "context",
        status: row.review ? "needs_review" : historical ? String(row.fact_status ?? "unknown") : "recorded",
        source: recordFilePattern(ref).dir,
        updated: historical
          ? typeof row.start === "string" && row.time_precision !== "unknown"
            ? row.start
            : undefined
          : row.ts,
      });
    }
  }
  const rules: DomainRule[] = [...domains.values()].map((d) => ({
    id: d.id,
    title: d.title,
    includeDomains: [d.id],
    temporal: d.id === "experience" ? { kind: "historical" } : { kind: "live", cadenceDays: 14 },
    facets:
      d.id === "experience"
        ? [
            { id: "records", label: "已确认的经历", factIds: [], kinds: ["experience"] },
            {
              id: "dates",
              label: "有时间依据的经历",
              factIds: d.facts.filter((f) => f.updated).map((f) => f.id),
            },
          ]
        : [
            { id: "focus", label: "关注的事项", factIds: [], kinds: ["topic", "project", "context", "goal"] },
            {
              id: "state",
              label: "已有状态记录",
              factIds: d.facts.filter((f) => f.kind !== "plan" && !!f.updated).map((f) => f.id),
            },
            { id: "next", label: "下一步", factIds: [], kinds: ["plan", "goal"] },
            {
              id: "progress",
              label: "实际进展记录",
              factIds: d.facts.filter((f) => f.progress || f.id.startsWith("record:")).map((f) => f.id),
            },
          ],
  }));
  let chosen: string[] = [];
  try {
    chosen = onboardingModuleChoices(ws).map((id) =>
      id === "jobs" ? "work" : id === "explore" ? "experience" : id,
    );
  } catch {
    gaps.push("开图模块选择");
  }
  const ordered = [...domains.values()].sort(
    (a, b) =>
      (["health", "work"].indexOf(a.id) < 0 ? 2 : ["health", "work"].indexOf(a.id)) -
      (["health", "work"].indexOf(b.id) < 0 ? 2 : ["health", "work"].indexOf(b.id)),
  );
  return {
    data: { title: "人生地图", domains: [...domains.values()], sources, bytesRead, gaps },
    rules,
    modules: ordered.map((d) => ({
      id: d.id,
      title: d.title,
      available: !!d.facts.length,
      recommended: chosen.length ? chosen.includes(d.id) : !!d.facts.length,
    })),
    gaps,
  };
}
