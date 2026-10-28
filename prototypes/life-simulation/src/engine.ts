import { type Journal, netWorth } from "./finance.js";
import type { Market, State, Story, Text } from "./model.js";
// Remake's conditional event selection and weighted draw adapted from f04888e.
// Per-run state replaces upstream global Maps; MIT: vendor/remake/LICENSE.
import { check } from "./vendor/remake/condition.js";
import { pickWeight } from "./vendor/remake/random.js";
export { sample } from "./random.js";
export interface Event {
  id: string;
  text: Text;
  cooldown: number;
  include?: string;
  eligible?: (s: State, m: Market) => boolean;
  weight: (s: State, m: Market) => number;
  apply?: (s: State, j: Journal, m: Market) => void;
  support?: Story["support"];
  sensitive?: "fraud" | "homelessness" | "domestic-violence" | "self-harm";
  branch?: { condition: string; event: string }[];
}
function flat(s: State) {
  return {
    ...s.props,
    AGE: s.age,
    ASSETS: netWorth(s.assets),
    DEBT: s.assets.debt,
    EVT: new Set(Object.keys(s.lastEvents)),
  };
}
export function createEngine(definitions: Event[]) {
  const catalog = new Map(definitions.map((e) => [e.id, e]));
  if (catalog.size !== definitions.length) throw new Error("Duplicate event ID");
  for (const e of definitions) {
    if (e.sensitive && !e.support?.length) throw new Error("Missing support resource");
    for (const b of e.branch ?? []) if (!catalog.has(b.event)) throw new Error("Missing branch target");
  }
  function eligible(e: Event, s: State, m: Market) {
    return (
      (s.lastEvents[e.id] === undefined || m.year - s.lastEvents[e.id] > e.cooldown) &&
      (!e.include || check(flat(s), e.include)) &&
      (!e.eligible || e.eligible(s, m))
    );
  }
  function weights(s: State, m: Market) {
    return definitions
      .filter((e) => eligible(e, s, m))
      .map((e) => [e.id, Math.max(1, Math.round(e.weight(s, m)))] as const);
  }
  return {
    weights,
    next(s: State, j: Journal, m: Market, draw: number): Story[] {
      if (!Number.isFinite(draw) || draw < 0 || draw >= 1) throw new Error("Invalid draw");
      const candidates = weights(s, m);
      const id = pickWeight(candidates, (max = 1, min = 0) => Math.floor(draw * (max - min + 1)) + min);
      if (!id) throw new Error("No eligible event");
      const stories: Story[] = [];
      const visited = new Set<string>();
      function trigger(key: string) {
        const e = catalog.get(key);
        if (!e || visited.has(key) || visited.size > 16) throw new Error("Invalid event chain");
        visited.add(key);
        s.lastEvents[e.id] = m.year;
        e.apply?.(s, j, m);
        stories.push({
          id: e.id,
          text: e.text,
          kind: "ordinary",
          ...(e.support ? { support: e.support } : {}),
        });
        for (const b of e.branch ?? []) {
          const next = catalog.get(b.event);
          if (next && check(flat(s), b.condition) && eligible(next, s, m)) {
            trigger(b.event);
            break;
          }
        }
      }
      trigger(id);
      return stories;
    },
  };
}
