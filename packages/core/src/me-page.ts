import { readAvatar } from "./avatar.js";
import { committedExperiences } from "./experience-imports.js";
import { parseFrontmatter } from "./frontmatter.js";
import {
  type MemoryInput,
  type MemoryReplacement,
  listMemories,
  pendingMemoryReplacements,
} from "./memory.js";
import type { Workspace } from "./workspace.js";
export interface MeGoal {
  id: string;
  title: string;
  status?: string;
  area?: string;
  metric?: string;
  target?: string;
  due?: string;
  approach?: string;
  actual?: string;
}
export interface MeRules {
  timezone?: string;
  sleep?: { start: string; end: string };
  work_hours?: { start: string; end: string; days?: number[] };
  training?: { pattern?: string; duration_min?: number; preferred?: string };
  nutrition?: { protein_g?: number[] };
  no_tasks_after?: string;
}
export interface MeData {
  name: string | null;
  bio: string | null;
  avatar: string | null;
  goals: MeGoal[];
  rules: MeRules;
  memories: (Pick<MemoryInput, "origin" | "observed_at" | "evidence" | "uncertainty" | "replaces"> & {
    file: string;
    name: string;
    type: "preference" | "fact" | "context" | "person" | "decision";
    text: string;
    source: string | null;
    sensitive: boolean;
    ended?: string;
    replaced_by?: string;
  })[];
  archivedMemories: MeData["memories"];
  memoryReplacements: MemoryReplacement[];
  /** 读书和工作经历，按开始时间从近到远；简历就是这份列表。 */
  career: {
    id: string;
    kind: "studied" | "worked";
    title: string;
    place: string;
    start: string | null;
    end: string | null;
    source: string;
  }[];
}

export function readMe(ws: Workspace): MeData {
  const memories = listMemories(ws, { includeArchived: true }).map(
    ({
      file,
      name,
      type,
      text,
      source,
      sensitive,
      ended,
      replaced_by,
      origin,
      observed_at,
      evidence,
      uncertainty,
      replaces,
    }) => ({
      origin,
      observed_at,
      evidence,
      uncertainty,
      replaces,
      file,
      name,
      type,
      text,
      source: source ?? null,
      sensitive: sensitive ?? false,
      ...(ended ? { ended } : {}),
      ...(replaced_by ? { replaced_by } : {}),
    }),
  );
  const profile = parseFrontmatter<{ name?: string; bio?: string }>(
    ws.exists("me/profile.md") ? ws.readText("me/profile.md") : "",
  );
  const heading = profile.body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? null;
  const bio = profile.body.split(/\r?\n\s*\r?\n/).find((p) => p.trim() && !/^(#|（|\()/.test(p.trim()));
  return {
    name:
      profile.data.name?.trim() || (heading && !/^(档案|个人档案|我的档案)$/.test(heading) ? heading : null),
    bio: profile.data.bio?.trim() || bio?.trim().replace(/\s*\n\s*/g, " ") || null,
    goals: ws.exists("me/goals.json") ? ws.readJson<MeGoal[]>("me/goals.json") : [],
    rules: ws.exists("me/rules.md") ? parseFrontmatter<MeRules>(ws.readText("me/rules.md")).data : {},
    memories: memories.filter((memory) => !memory.ended),
    archivedMemories: memories.filter((memory) => memory.ended),
    memoryReplacements: pendingMemoryReplacements(ws),
    avatar: readAvatar(ws),
    career: committedExperiences(ws)
      .filter(
        (item) =>
          (item.event_type === "studied" || item.event_type === "worked") &&
          ["user_reported", "observed"].includes(item.fact_status),
      )
      .map((item) => ({
        id: item.id,
        kind: item.event_type as "studied" | "worked",
        title: item.title ?? item.place.name,
        place: item.place.name,
        start: item.start ?? null,
        end: item.end ?? null,
        source: item.source,
      }))
      .sort((a, b) => (b.start ?? "").localeCompare(a.start ?? "")),
  };
}
