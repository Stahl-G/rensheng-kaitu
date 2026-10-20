import { KaituError } from "./errors.js";
import { snapshot } from "./history.js";
import type { Experience } from "./places.js";
import { resolvePlace } from "./places.js";
import type { Workspace } from "./workspace.js";

const hometownLine = /^(?:家乡|故乡|hometown)([（(]待核对[）)])?\s*[:：]\s*(.+)$/i;
const plainLine = (line: string) =>
  line
    .replaceAll("**", "")
    .replace(/^\s*[-*]\s*/, "")
    .trim();

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
    const match = hometownLine.exec(plainLine(line));
    const value = match?.[2]?.trim();
    if (!match || !value || /^(?:未提供|未知|不详|待补充|暂无|unknown)$/i.test(value)) return [];
    const name = (value.split(/\s+[|｜]\s*/)[0] ?? "").trim();
    const candidates = resolvePlace(name);
    const selected = /\s+[|｜]\s*geonameid:(\d+)\s*$/.exec(value);
    return [
      {
        name,
        candidate: selected
          ? candidates.find((city) => city.geonameid === Number(selected[1]))
          : candidates.length === 1
            ? candidates[0]
            : undefined,
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

/** 用户直接指定家乡，不调用模型，不改动档案的其他内容。 */
export async function saveHometown(ws: Workspace, name: string, geonameid: number): Promise<Hometown> {
  if (typeof name !== "string" || /[\r\n|｜]/.test(name) || !Number.isSafeInteger(geonameid))
    throw new KaituError("请选择一个城市", "BAD_ARGS");
  const city = resolvePlace(name).find((candidate) => candidate.geonameid === geonameid);
  if (!city) throw new KaituError("请选择匹配的城市", "BAD_ARGS");
  const file = "me/profile.md";
  const before = ws.exists(file) ? ws.readText(file) : "# 个人档案\n";
  const line = `家乡：${name.trim()} | geonameid:${city.geonameid}`;
  let replaced = false;
  const rows = before.split(/\r?\n/).flatMap((row) => {
    if (!hometownLine.test(plainLine(row))) return [row];
    if (replaced) return [];
    replaced = true;
    return [line];
  });
  const after = replaced ? rows.join("\n") : `${before.trimEnd()}\n${line}\n`;
  if (after !== before) {
    ws.writeText(file, after);
    await snapshot(ws, "你设置了家乡");
  }
  return readHometown(ws);
}
