import type { Experience } from "./places.js";
import { resolvePlace } from "./places.js";
import type { Workspace } from "./workspace.js";

export interface Hometown {
  status: "ready" | "review" | "missing";
  place?: Experience["place"];
  evidence?: string;
  source?: string;
}

/** 家乡复用个人档案文字，不把出生地、当前位置或最早经历当成家乡。 */
export function readHometown(ws: Workspace): Hometown {
  if (!ws.exists("me/profile.md")) return { status: "missing" };
  const rows = ws.readText("me/profile.md").split(/\r?\n/);
  const matches = rows.flatMap((line, index) => {
    const plain = line
      .replaceAll("**", "")
      .replace(/^\s*[-*]\s*/, "")
      .trim();
    const match = /^(?:家乡|故乡|hometown)([（(]待核对[）)])?\s*[:：]\s*(.+)$/i.exec(plain);
    const value = match?.[2]?.trim();
    if (!match || !value || /^(?:未提供|未知|不详|待补充|暂无|unknown)$/i.test(value)) return [];
    const name = (value.split(/\s+[|｜]\s*/)[0] ?? "").trim();
    const candidates = resolvePlace(name);
    return [
      {
        name,
        candidate: candidates.length === 1 ? candidates[0] : undefined,
        pending: !!match[1],
        line,
        index,
      },
    ];
  });
  const first = matches[0];
  if (!first) return { status: "missing" };
  const consistent = matches.every(
    (item) => item.candidate && item.candidate.geonameid === first.candidate?.geonameid && !item.pending,
  );
  const city = consistent ? first.candidate : undefined;
  return {
    status: city ? "ready" : "review",
    evidence: matches.map((item) => item.line.trim()).join("\n"),
    source: `me/profile.md:L${first.index + 1}`,
    ...(city
      ? {
          place: {
            name: first.name,
            country: city.country,
            geonameid: city.geonameid,
            lat: city.lat,
            lng: city.lng,
            precision: "city" as const,
          },
        }
      : {}),
  };
}
