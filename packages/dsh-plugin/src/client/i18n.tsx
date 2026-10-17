import { createContext, useCallback, useContext } from "react";

/** 界面语言。中文与英文并列写在调用处：t("今天", "Today")。 */
export type Locale = "zh-CN" | "en";
export const LocaleContext = createContext<Locale>("zh-CN");

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

export function useT() {
  const locale = useLocale();
  return useCallback((zh: string, en: string) => (locale === "en" ? en : zh), [locale]);
}

/** Web 使用浏览器首选语言；桌面服务端会替换为系统首选语言。 */
export function browserLocale(): string {
  try {
    return navigator.languages?.[0] ?? navigator.language ?? "en";
  } catch {
    return "en";
  }
}

export function dateFormat(locale: Locale, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "zh-CN", options);
}
