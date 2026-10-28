// Adapted from VickScarlet/remake core game.ts / event.ts at f04888e.
// MIT copyright and change details: vendor/remake/LICENSE and README.md.
import { check } from "./vendor/remake/condition.js";
import { pickWeight } from "./vendor/remake/random.js";
export type Stats = Record<string, number>;
export interface State {
  age: number;
  props: Stats;
  flags: string[];
  events: string[];
}
export interface Event {
  id: string;
  text: [string, string];
  weight?: number;
  include?: string;
  exclude?: string;
  requires?: string[];
  sets?: string[];
  clears?: string[];
  effect?: Stats;
  NoRandom?: boolean;
  branch?: { condition: string; event: string }[];
}
export function sample(seed: string, year: number, category: string): number {
  // Addressed draws: branching never shifts the next year's random stream.
  const key = JSON.stringify([seed, year, category]);
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function flat(state: State) {
  return { ...state.props, AGE: state.age, EVT: new Set(state.events) };
}
function allowed(event: Event, state: State) {
  return (
    (!event.requires || event.requires.every((flag) => state.flags.includes(flag))) &&
    (!event.include || check(flat(state), event.include)) &&
    (!event.exclude || !check(flat(state), event.exclude))
  );
}
export function createEngine(definitions: Event[]) {
  // No module-global Maps, profiles, achievements or data initialization.
  const catalog = new Map(structuredClone(definitions).map((event) => [event.id, event]));
  if (catalog.size !== definitions.length) throw new Error("Duplicate event ID");
  for (const event of catalog.values()) {
    if (!Number.isInteger(event.weight ?? 1) || (event.weight ?? 1) < 1)
      throw new Error("Invalid event weight");
    for (const branch of event.branch ?? [])
      if (!catalog.has(branch.event)) throw new Error("Missing branch target");
  }
  function trigger(id: string, state: State, visited = new Set<string>()): { state: State; events: Event[] } {
    const event = catalog.get(id);
    if (!event || visited.has(id) || visited.size >= 16) throw new Error("Invalid event chain");
    if (!allowed(event, state)) throw new Error("Event prerequisites are not met");
    visited.add(id);
    const next = structuredClone(state);
    next.events.push(id);
    for (const [key, value] of Object.entries(event.effect ?? {}))
      next.props[key] = (next.props[key] ?? 0) + value;
    next.flags = [
      ...new Set([...next.flags.filter((flag) => !event.clears?.includes(flag)), ...(event.sets ?? [])]),
    ];
    if (next.flags.includes("employed") && next.flags.includes("founder"))
      throw new Error("Conflicting work states");
    for (const branch of event.branch ?? []) {
      const target = catalog.get(branch.event);
      if (target && check(flat(next), branch.condition) && allowed(target, next)) {
        const result = trigger(branch.event, next, visited);
        return { state: result.state, events: [structuredClone(event), ...result.events] };
      }
    }
    return { state: next, events: [structuredClone(event)] };
  }
  return {
    start(age: number, props: Stats, flags: string[] = []): State {
      return { age, props: { ...props }, flags: [...flags], events: [] };
    },
    next(state: State, draw: number, context: Stats = {}) {
      if (draw < 0 || draw >= 1 || !Number.isFinite(draw)) throw new Error("Invalid random draw");
      const next = { ...structuredClone(state), age: state.age + 1, props: { ...state.props, ...context } };
      const candidates = [...catalog.values()].filter((event) => !event.NoRandom && allowed(event, next));
      const event = pickWeight(
        candidates.map((item) => [item.id, item.weight ?? 1] as const),
        (max = 1, min = 0) => Math.floor(draw * (max - min + 1)) + min,
      );
      if (!event) throw new Error(`No event available for age ${next.age}`);
      return trigger(event, next);
    },
  };
}
