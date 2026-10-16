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

/** 浏览器 / 系统语言，只作为第一次打开时的参考；已有资料的工作区由服务端保持中文。 */
export function browserLocale(): string {
  try {
    return navigator.languages?.[0] ?? navigator.language ?? "zh-CN";
  } catch {
    return "zh-CN";
  }
}

export function dateFormat(locale: Locale, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "zh-CN", options);
}
