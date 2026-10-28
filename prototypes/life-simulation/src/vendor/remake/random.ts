export type RNG = (max?: number, min?: number) => number;
export function random(max = 1, min = 0, rng?: RNG): number {
  if (rng) return rng(max, min);
  const low = Math.min(max, min);
  const high = Math.max(max, min);
  return Math.floor(Math.random() * (high - low + 1)) + low;
}
export function pick<T>(items: T[], rng?: RNG) {
  if (items.length === 0) return null;
  return items[random(items.length - 1, 0, rng)] ?? null;
}
export type WeightItem<T> = readonly [T, number];
export function pickWeight<T>(items: WeightItem<T>[], rng?: RNG) {
  if (items.length === 0) return null;
  const totalWeight = items.reduce((sum, [, weight]) => sum + weight, 0);
  let mark = random(totalWeight - 1, 0, rng);
  for (const [item, weight] of items) {
    if (mark < weight) return item;
    mark -= weight;
  }
  return null;
}
