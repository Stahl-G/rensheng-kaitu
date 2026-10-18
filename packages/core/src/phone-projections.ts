import { journeyRoutes } from "./journey-routes.js";
import type { readOverviewPage } from "./overview-page.js";
import type { LifeMapData } from "./places.js";
import { progressRows } from "./progress-map.js";

type Overview = Awaited<ReturnType<typeof readOverviewPage>>;
const envelope = (name: string, generatedAt: string) => ({
  format: `kaitu.phone.${name}`,
  version: 1,
  generated_at: generatedAt,
});

export function buildPhoneToday(data: Overview, generatedAt: string) {
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
    next: data.next.slice(0, 3).map(({ id, title, file, module, section, proposed }) => ({
      id,
      title,
      file,
      module,
      section,
      proposed,
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
    changes: data.versions
      .filter((v) => !/财务|finance|交易|账户|记忆|记住了|memory/i.test(v.message))
      .slice(0, 3)
      .map(({ time, text }) => ({ time, message: text })),
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
