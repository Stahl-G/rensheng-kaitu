export interface CompletionCheckin {
  done: boolean;
}
export interface CompletionRate {
  done: number;
  total: number;
  lower: number;
  upper: number;
}

// Lanczos 近似与连分式计算正则不完全 Beta，避免大样本阶乘溢出。
function logGamma(z: number): number {
  const coefficients = [
    676.5203681218851, -1259.1392167224028, 771.3234287776531, -176.6150291621406, 12.507343278686905,
    -0.13857109526572012, 9.984369578019572e-6, 1.5056327351493116e-7,
  ];
  let x = 0.9999999999998099;
  const n = z - 1;
  for (const [i, coefficient] of coefficients.entries()) x += coefficient / (n + i + 1);
  const t = n + 7.5;
  return 0.9189385332046727 + (n + 0.5) * Math.log(t) - t + Math.log(x);
}
function fraction(a: number, b: number, x: number): number {
  const floor = (v: number) => (Math.abs(v) < 1e-30 ? 1e-30 : v);
  let c = 1;
  let d = 1 / floor(1 - ((a + b) * x) / (a + 1));
  let h = d;
  for (let m = 1; m <= 200; m++) {
    const m2 = 2 * m;
    const first = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 / floor(1 + first * d);
    c = floor(1 + first / c);
    h *= d * c;
    const second = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 / floor(1 + second * d);
    c = floor(1 + second / c);
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 3e-14) break;
  }
  return h;
}
function quantile(p: number, a: number, b: number, logBeta: number): number {
  let lo = 0;
  let hi = 1;
  const mean = a / (a + b);
  const sigma = Math.sqrt((a * b) / ((a + b) ** 2 * (a + b + 1)));
  let x = Math.max(1e-8, Math.min(1 - 1e-8, mean + (p < 0.5 ? -1 : 1) * 1.2815515655446004 * sigma));
  for (let i = 0; i < 40; i++) {
    const factor = Math.exp(a * Math.log(x) + b * Math.log1p(-x) - logBeta);
    const cdf =
      x < (a + 1) / (a + b + 2) ? (factor * fraction(a, b, x)) / a : 1 - (factor * fraction(b, a, 1 - x)) / b;
    if (Math.abs(cdf - p) < 1e-12) return x;
    if (cdf < p) lo = x;
    else hi = x;
    const candidate = x - ((cdf - p) * x * (1 - x)) / factor;
    if (Math.abs(candidate - x) < 1e-13) return x;
    x = candidate > lo && candidate < hi ? candidate : (lo + hi) / 2;
  }
  return (lo + hi) / 2;
}
/** 按计划做到的次数与 Beta(1 + 做到, 1 + 没做到) 的 80% 区间。 */
export function completionRate(checkins: readonly CompletionCheckin[]): CompletionRate {
  let done = 0;
  for (const checkin of checkins) if (checkin.done) done++;
  const total = checkins.length;
  const a = 1 + done;
  const b = 1 + total - done;
  const logBeta = logGamma(a) + logGamma(b) - logGamma(a + b);
  return { done, total, lower: quantile(0.1, a, b, logBeta), upper: quantile(0.9, a, b, logBeta) };
}
