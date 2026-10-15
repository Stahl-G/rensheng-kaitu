import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
let lastTime = -1;
let lastRandom: number[] = [];

function encodeTime(time: number): string {
  let out = "";
  let ms = time;
  for (let i = 0; i < 10; i++) {
    out = ALPHABET[ms % 32] + out;
    ms = Math.floor(ms / 32);
  }
  return out;
}

/** 单调递增 ULID：同一毫秒内随机部分加一，保证按 id 排序即按生成顺序。 */
export function ulid(at = Date.now()): string {
  let now = at;
  if (now <= lastTime) {
    now = lastTime;
    let i = lastRandom.length - 1;
    while (i >= 0 && lastRandom[i] === 31) lastRandom[i--] = 0;
    if (i < 0) throw new Error("ULID 随机部分溢出");
    lastRandom[i] = (lastRandom[i] ?? 0) + 1;
  } else {
    lastTime = now;
    lastRandom = Array.from(randomBytes(16), (b) => b % 32);
  }
  return encodeTime(now) + lastRandom.map((n) => ALPHABET[n]).join("");
}
