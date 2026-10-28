/** Addressed draws: a different branch never shifts next year's external random stream. */
export function sample(seed: string, year: number, category: string): number {
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
export function normal(seed: string, year: number, key: string) {
  return (
    Math.sqrt(-2 * Math.log(Math.max(1e-9, sample(seed, year, `${key}-u`)))) *
    Math.cos(2 * Math.PI * sample(seed, year, `${key}-v`))
  );
}
