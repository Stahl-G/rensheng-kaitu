import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { KaituError } from "./errors.js";
import { localStateRoot } from "./local-state.js";

export const locales = ["zh-CN", "en"] as const;
export type Locale = (typeof locales)[number];
export interface Preferences {
  locale: Locale | null;
  /** Ordered visible Explore entry IDs; absent uses defaults, [] deliberately hides all entries. */
  exploreEntries?: string[];
  /** Resolved UI state only; an automatic choice is never persisted as a manual choice. */
  followSystem?: boolean;
}

/** 未知或缺省的语言按中文处理，已有用户的界面不变。 */
export function normalizeLocale(value: unknown): Locale {
  return value === "en" ? "en" : "zh-CN";
}

/** 中文与英文并列写在调用处，选当前语言的一份。 */
export function pick(locale: Locale, zh: string, en: string): string {
  return locale === "en" ? en : zh;
}

function file() {
  return join(localStateRoot(), "preferences.json");
}
function entryList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((id) => typeof id === "string" && id.length > 0 && id.trim() === id) &&
    new Set(value).size === value.length
  );
}

/** 界面偏好只存在本机状态目录：不进工作区、不同步、不进版本历史。 */
export function readPreferences(): Preferences {
  try {
    const value = JSON.parse(readFileSync(file(), "utf8")) as Partial<Preferences>;
    return {
      locale: locales.includes(value.locale as Locale) ? (value.locale as Locale) : null,
      ...(entryList(value.exploreEntries) ? { exploreEntries: value.exploreEntries } : {}),
    };
  } catch {
    return { locale: null };
  }
}

export function savePreferences(input: Partial<Preferences>): Preferences {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => key !== "locale" && key !== "exploreEntries") ||
    (input.exploreEntries !== undefined && !entryList(input.exploreEntries)) ||
    (input.locale !== null && input.locale !== undefined && !locales.includes(input.locale))
  )
    throw new KaituError("界面偏好不合法", "BAD_ARGS");
  const next = { ...readPreferences(), ...input };
  mkdirSync(localStateRoot(), { recursive: true, mode: 0o700 });
  const temp = `${file()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(next)}\n`, { mode: 0o600 });
  renameSync(temp, file());
  return next;
}
