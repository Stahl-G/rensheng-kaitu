import { type Locale, pick } from "./locale.js";

/**
 * 发给外部 AI 前去掉认得出的密钥和本机路径，其余文字照常保留。
 * 只靠记忆有没有标「敏感」不够：普通记忆、待办和方向里也可能写着 Key 或文件路径。
 */
const KEY_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\b(?:sk|pk|rk)-(?:[a-z]+-)?[A-Za-z0-9_-]{16,}/g,
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{10,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /\bbearer\s+[A-Za-z0-9._~+/-]{16,}=*/gi,
];
const KEY_LABEL = String.raw`(?:api[\s_-]?key|access[\s_-]?key|secret|token|password|passwd|pwd|密钥|密码|口令|令牌)["']?\s*(?:[:：=]|是|为|is\b)\s*["']?`;
/** 「密码是 abc123」「token: …」：只换掉后面像凭据的那一段（至少 6 个可见 ASCII 字符）。 */
const KEY_ASSIGNMENT = new RegExp(String.raw`(${KEY_LABEL})[^\s"'，。；;,]{6,}`, "gi");
/** 判断用：标签后面是带数字的一串可见 ASCII，「token 是 DeepSeek 的计费单位」这类正文不算。 */
const KEY_VALUE = new RegExp(String.raw`${KEY_LABEL}(?=[!#-&(-+\--:<-~]*\d)[!#-&(-+\--:<-~]{6,}`, "i");
const PATH_PATTERNS = [
  /file:\/\/\S+/gi,
  /(?<![\w.:/~-])(?:~|\/(?:Users|home|root|Volumes|private|var|tmp|opt|etc|mnt|media|Library|Applications|System))\/[^\s，。、；;,)）"'”’]+/g,
  /(?<![\w])[A-Za-z]:\\[^\s，。、；;,)）"'”’]+/g,
];

export function redact(text: string, locale: Locale): string {
  const key = pick(locale, "（密钥已去掉）", "(key removed)");
  const path = pick(locale, "（本机路径已去掉）", "(local path removed)");
  let out = text;
  for (const pattern of KEY_PATTERNS) out = out.replace(pattern, key);
  out = out.replace(KEY_ASSIGNMENT, (_match, label: string) => `${label}${key}`);
  for (const pattern of PATH_PATTERNS) out = out.replace(pattern, path);
  return out;
}

/** 要原样发布的文字里有没有认得出的密钥；有就整页拒收，不替作者改写。 */
export function containsKey(text: string): boolean {
  return KEY_PATTERNS.some((pattern) => text.search(pattern) >= 0) || KEY_VALUE.test(text);
}
