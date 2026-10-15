import { readAvatar } from "./avatar.js";
import { parseFrontmatter } from "./frontmatter.js";
import { listMemories } from "./memory.js";
import type { Workspace } from "./workspace.js";
export interface MeGoal {
  id: string;
  title: string;
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
  memories: {
    file: string;
    type: "preference" | "fact" | "context" | "person" | "decision";
    text: string;
    source: string | null;
    sensitive: boolean;
  }[];
}

export function readMe(ws: Workspace): MeData {
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
    memories: listMemories(ws).map(({ file, type, text, source, sensitive }) => ({
      file,
      type,
      text,
      source: source ?? null,
      sensitive: sensitive ?? false,
    })),
    avatar: readAvatar(ws),
  };
}
