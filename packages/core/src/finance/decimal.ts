/** 十进制定点运算。输入原文由记录保存，计算结果去掉无意义的尾零。 */
export function decimal(value: string): { units: bigint; scale: number } {
  if (!/^-?\d+(?:\.\d+)?$/.test(value)) throw new Error(`无效十进制：${value}`);
  const [whole = "0", fraction = ""] = value.replace(/^-/, "").split(".");
  return { units: BigInt(whole + fraction) * (value.startsWith("-") ? -1n : 1n), scale: fraction.length };
}
function render(units: bigint, scale: number): string {
  const digits = (units < 0n ? -units : units).toString().padStart(scale + 1, "0");
  const result = scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/\.?0+$/, "") : digits;
  return `${units < 0n ? "-" : ""}${result}`;
}
export function add(a: string, b: string): string {
  const x = decimal(a);
  const y = decimal(b);
  const scale = Math.max(x.scale, y.scale);
  return render(x.units * 10n ** BigInt(scale - x.scale) + y.units * 10n ** BigInt(scale - y.scale), scale);
}
export function neg(a: string): string {
  return a.startsWith("-") ? a.slice(1) : `-${a}`;
}
export function abs(a: string): string {
  return a.replace(/^-/, "");
}
export function sub(a: string, b: string): string {
  return add(a, neg(b));
}
export function mul(a: string, b: string): string {
  const x = decimal(a);
  const y = decimal(b);
  return render(x.units * y.units, x.scale + y.scale);
}
/** 比率截断至 12 位小数，不影响原币金额精度。 */
export function div(a: string, b: string): string | null {
  const x = decimal(a);
  const y = decimal(b);
  if (!y.units) return null;
  return render((x.units * 10n ** BigInt(y.scale + 12)) / (y.units * 10n ** BigInt(x.scale)), 12);
}
export function equal(a: string, b: string): boolean {
  return sub(a, b) === "0";
}
