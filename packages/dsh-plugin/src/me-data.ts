import { type Workspace, listMemories, parseFrontmatter, readAvatar } from "@kaitu/core";
import type { MeData, MeGoal, MeRules } from "./types.js";

export function readMe(ws: Workspace): MeData {
  const profile = parseFrontmatter<{ name?: string; bio?: string }>(
    ws.exists("me/profile.md") ? ws.readText("me/profile.md") : "",
  );
  const heading = profile.body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? null;
  const bio = profile.body.split(/\r?\n\s*\r?\n/).find((p) => p.trim() && !/^(#|（|\()/.test(p.trim()));
  return {
    name: profile.data.name?.trim() || heading,
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
