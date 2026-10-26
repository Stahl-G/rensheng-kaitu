import { experienceInterval, experienceLayer, partialDateBounds } from "./experience-time.js";
import { parseFrontmatter } from "./frontmatter.js";
import { inboxNotes } from "./inbox-notes.js";
import { journeyRoutes } from "./journey-routes.js";
import { listMemories } from "./memory.js";
import { listRecordTypes } from "./modules.js";
import type { readOverviewPage } from "./overview-page.js";
import { phoneInboxName } from "./phone-actions.js";
import type { Experience, LifeMapData } from "./places.js";
import { progressRows } from "./progress-map.js";
import { readRecords } from "./records.js";
import { listTasks } from "./tasks.js";
import { localDate, parseTs } from "./time.js";
import type { Workspace } from "./workspace.js";

type Overview = Awaited<ReturnType<typeof readOverviewPage>>;
const envelope = (name: string, generatedAt: string) => ({
  format: `kaitu.phone.${name}`,
  version: 1,
  generated_at: generatedAt,
  generator: { kind: "computer" },
});

// 当天饮食合计，以及已经算进去的手机提交文件：手机只再叠加不在其中的本机确认。
function nutrition(ws: Workspace, data: Overview) {
  if (!listRecordTypes(ws).some((ref) => ref.type === "meal")) return undefined;
  const meals = readRecords(ws, "meal").filter(
    (meal) => localDate(parseTs(meal.ts), data.timeZone) === data.today,
  );
  const receipts = ws.exists(".kaitu/inbox-records.json")
    ? Object.keys(ws.readJson<object>(".kaitu/inbox-records.json"))
    : [];
  return {
    version: 1,
    kcal: meals.reduce((sum, meal) => sum + (Number(meal.kcal) || 0), 0),
    protein_g: meals.reduce((sum, meal) => sum + (Number(meal.protein_g) || 0), 0),
    accounted_refs: receipts
      .filter((ref) => phoneInboxName.test(ref) && ref.endsWith(".records.jsonl"))
      .sort(),
  };
}

export function buildPhoneToday(data: Overview, generatedAt: string, ws: Workspace) {
  const food = nutrition(ws, data);
  const hasTasks = listRecordTypes(ws).some((ref) => ref.type === "task");
  const block = ({ id, title, kind, status, start, end, module, calendar }: Overview["blocks"][number]) => ({
    id,
    title,
    kind,
    status,
    start,
    end,
    module,
    ...(calendar ? { calendar } : {}),
  });
  return {
    ...envelope("today", generatedAt),
    today: data.today,
    timezone: data.timeZone,
    ...(food ? { nutrition: food } : {}),
    mobile: {
      version: 1,
      actions: hasTasks
        ? [
            "adopt_task",
            "create_task",
            "update_task",
            "complete_task",
            "cancel_task",
            "complete_next",
            "capture_memory",
            "replace_memory",
          ]
        : ["complete_next", "capture_memory", "replace_memory"],
      tasks: (hasTasks ? listTasks(ws, { status: "all" }) : []).map(
        ({ id, rev, title, status, ts, due }) => ({
          id,
          rev: rev ?? 1,
          title,
          status,
          ts,
          ...(due ? { due } : {}),
        }),
      ),
    },
    next: data.next.slice(0, 3).map(({ id, title, file, module, section, proposed }) => ({
      id,
      title,
      file,
      module,
      section,
      proposed,
      ...(ws.exists(file)
        ? {
            source_precondition: parseFrontmatter<{ next?: { id: string }[] }>(
              ws.readText(file),
            ).data.next?.find((item) => item.id === id),
          }
        : {}),
    })),
    proposals: data.blocks.filter((b) => b.kind === "proposal" && b.status === "pending").map(block),
    blocks: data.blocks.filter((b) => b.status === "confirmed").map(block),
    goals: data.plans.goals.map(({ id, title, results, lastResult, next }) => ({
      id,
      title,
      results,
      last_result: lastResult,
      next: next ? { id: next.id, title: next.title, due: next.due } : null,
    })),
    question: null,
    sync: {
      received: data.sync.received,
      needs_review: data.sync.needsReview,
      organizer: data.sync.organizer,
      updated_at: data.sync.updatedAt,
    },
  };
}

export function buildPhoneWeek(data: Overview, generatedAt: string) {
  const from = new Date(Date.parse(`${data.today}T12:00:00Z`) - 6 * 86400000).toISOString().slice(0, 10);
  const metric = (key: string) => data.metrics.find((m) => m.key === key);
  const weight = metric("weight");
  return {
    ...envelope("week", generatedAt),
    from,
    to: data.today,
    projects: data.projects.map(({ slug, title, kind, file, next, words, commits, daily }) => ({
      slug,
      title,
      kind,
      file,
      next,
      words,
      commits,
      daily: daily.map(({ date, words, commits }) => ({ date, words, commits })),
    })),
    health: {
      workouts: metric("workouts")?.value ?? null,
      workout_days: metric("workouts")?.days ?? 0,
      sleep_avg_hours: metric("sleep")?.value ?? null,
      protein_avg_g: metric("protein")?.value ?? null,
      weight:
        weight?.value !== null && weight?.value !== undefined && weight.latest
          ? { value: weight.value, unit: weight.unit, ts: weight.latest }
          : null,
    },
    notes: { captured: data.capturedWeek },
    changes: data.versions.slice(0, 3).map(({ time, text }) => ({ time, message: text })),
  };
}

function mapFootprint(map: LifeMapData) {
  type City = { name: string; lat: number; lng: number };
  const city = (item: Experience): City | null => {
    const { place } = item;
    return !item.review &&
      place.precision === "city" &&
      place.name.trim() &&
      typeof place.lat === "number" &&
      Number.isFinite(place.lat) &&
      typeof place.lng === "number" &&
      Number.isFinite(place.lng)
      ? { name: place.name, lat: place.lat, lng: place.lng }
      : null;
  };
  const key = (item: Experience) =>
    String(item.place.geonameid ?? `${item.place.name}:${item.place.lat}:${item.place.lng}`);
  const compare = (a: City, b: City) => a.name.localeCompare(b.name) || a.lat - b.lat || a.lng - b.lng;
  const livedNow = new Map<string, City>();
  for (const item of map.experiences) {
    const place = city(item);
    const interval = experienceInterval(item);
    if (
      place &&
      item.event_type === "lived" &&
      !item.end &&
      (item.fact_status === "observed" || item.fact_status === "user_reported") &&
      interval &&
      interval.from <= map.asOf &&
      (!interval.to || interval.to >= map.asOf)
    )
      livedNow.set(key(item), place);
  }
  const [currentKey, currentCity] =
    livedNow.size === 1 ? (livedNow.entries().next().value ?? [null, null]) : [null, null];
  const visited = new Map<string, City>();
  const planned = new Map<string, City & { status: "planned" | "suggested" }>();
  for (const item of map.experiences) {
    const place = city(item);
    if (!place) continue;
    const id = key(item);
    const start = partialDateBounds(item.start)?.from;
    if (
      (item.fact_status === "observed" || item.fact_status === "user_reported") &&
      (!start || start <= map.asOf) &&
      experienceLayer(item, map.asOf) !== null &&
      id !== currentKey
    )
      visited.set(id, place);
    if (item.fact_status === "planned" || item.fact_status === "suggested") {
      const prior = planned.get(id);
      if (!prior || item.fact_status === "planned") planned.set(id, { ...place, status: item.fact_status });
    }
  }
  return {
    current: currentCity,
    visited: [...visited.values()].sort(compare),
    planned: [...planned.values()].sort(compare),
  };
}

export function buildPhoneMap(
  data: Overview,
  map: LifeMapData,
  exploration: Parameters<typeof progressRows>[2],
  generatedAt: string,
) {
  const cities = map.features.filter((f) => f.properties.place.precision === "city");
  const home = map.hometown?.status === "ready" ? map.hometown.place : undefined;
  const now = cities.find((f) => f.properties.layer === "now");
  // 跨日期变更线的曲线拆开，保持 schema 的经度范围且不画横穿地图的线。
  const split = (line: number[][]) => {
    const result: number[][][] = [];
    let part: number[][] = [];
    for (const point of line) {
      const x = point[0] as number;
      const y = point[1] as number;
      const lng = ((((x + 180) % 360) + 360) % 360) - 180;
      const previous = part.at(-1);
      if (previous && Math.abs(lng - (previous[0] as number)) > 180) {
        const from = previous[0] as number;
        const to = lng + (lng < from ? 360 : -360);
        const edge = to > from ? 180 : -180;
        const lat = (previous[1] as number) + ((y - (previous[1] as number)) * (edge - from)) / (to - from);
        part.push([edge, lat]);
        result.push(part);
        part = [[-edge, lat]];
      }
      part.push([lng, y]);
    }
    if (part.length > 1) result.push(part);
    return result;
  };
  return {
    ...envelope("map", generatedAt),
    as_of: map.asOf,
    rows: progressRows(data.plans, data.projects, exploration).map(({ results: _results, ...row }) => row),
    places: cities.map(({ properties: { place, layer, experiences } }) => ({
      name: place.name,
      lat: place.lat,
      lng: place.lng,
      layer,
      start: experiences[0]?.start,
      end: experiences.at(-1)?.end,
    })),
    hometown: home ? { name: home.name, lat: home.lat, lng: home.lng } : null,
    footprint: mapFootprint(map),
    routes: {
      walked: journeyRoutes(map.experiences, map.asOf, home).features.flatMap((f) =>
        split(f.geometry.coordinates),
      ),
      planned: now
        ? cities
            .filter((f) => f.properties.layer === "planned")
            .flatMap((f) => split([now.geometry.coordinates, f.geometry.coordinates]))
        : [],
    },
  };
}

/** 资料目录：只放标题、类型、日期和相对路径，手机点开哪一项才读那个文件。手机是用户自己的设备，财务和全部记忆都列出。 */
export function buildPhoneLibrary(ws: Workspace, data: Overview, generatedAt: string) {
  const tz = ws.timeZone();
  const day = (ts: string) => localDate(parseTs(ts), tz);
  const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
  const since = new Date(Date.parse(`${data.today}T12:00:00Z`) - 29 * 86400000).toISOString().slice(0, 10);
  const items: {
    kind: string;
    title: string;
    subtitle?: string;
    date: string | null;
    path: string;
    id?: string;
  }[] = [];
  for (const p of data.projects)
    items.push({
      kind: "project",
      title: clip(p.title, 80),
      ...(p.next[0] ? { subtitle: clip(`下一步：${p.next[0]}`, 80) } : {}),
      date: null,
      path: p.file,
    });
  for (const g of data.plans.goals)
    items.push({
      kind: "me",
      title: clip(g.title, 80),
      subtitle: `记过 ${g.results} 次结果`,
      date: null,
      path: "me/goals.json",
      id: g.id,
    });
  for (const m of listMemories(ws))
    items.push({
      kind: "me",
      title: clip(m.name, 80),
      ...(m.sensitive ? { subtitle: "标为敏感" } : {}),
      date: m.updated.slice(0, 10),
      path: `memory/${m.file}`,
    });
  for (const ref of listRecordTypes(ws)) {
    const kind = ref.module.def.id;
    if (kind !== "health" && kind !== "finance") continue;
    const rows = readRecords(ws, ref.type);
    const latest = rows.at(-1);
    if (!latest) continue;
    const month = day(latest.ts).slice(0, 7);
    items.push({
      kind,
      title: clip(ref.def.label?.trim() || ref.type, 80),
      subtitle: `${rows.length} 条`,
      date: day(latest.ts),
      path: `${ref.module.dir}/${ref.def.path.replace("{YYYY-MM}", month)}`,
    });
  }
  for (const n of [
    ...inboxNotes(ws, "inbox/notes", { from: since }),
    ...inboxNotes(ws, "inbox/notes/done", { from: since }),
  ]) {
    // 日期取所在的日期目录；frontmatter 里的 date 可能不是字符串。
    const date = n.path.match(/\/(\d{4}-\d{2}-\d{2})\//)?.[1];
    if (!date || date < since) continue;
    items.push({ kind: "note", title: clip(n.firstLine, 40), date, path: n.path });
  }
  items.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  return { ...envelope("library", generatedAt), items };
}
