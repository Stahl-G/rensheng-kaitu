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

/** HTTP errors follow the active view, including an automatic language choice. */
export function requestLocale(): Locale {
  return document.querySelector("[data-theme][lang]")?.getAttribute("lang") === "en" ? "en" : "zh-CN";
}

/** Translate Kaitu's generated history labels; keep user titles and custom messages verbatim. */
export function versionText(text: string, locale: Locale): string {
  if (locale !== "en") return text;
  const labels: [string, string][] = [
    ["从原文采纳了一个下一步", "Adopted a next step from the original"],
    ["完成下一步并记下结果", "Completed a next step and logged the result"],
    ["调整了下一步的日期", "Changed the date of a next step"],
    ["保存了一条原文记录", "Saved an original note"],
    ["留了一条笔记，等你整理", "Saved a note to organize"],
    ["记录了一餐", "Logged a meal"],
    ["记录了一次训练", "Logged a workout"],
    ["记录了睡眠", "Logged sleep"],
    ["记录了身体数据", "Logged body measurements"],
    ["记录了活动", "Logged activity"],
    ["加了一条待办", "Added a task"],
    ["记了一条记录", "Added a record"],
  ];
  for (const [zh, en] of labels) if (text === zh || text === `你${zh}`) return en;
  for (const [zh, en] of [
    ["新建了项目", "Created project"],
    ["更新了项目", "Updated project"],
    ["记下了待办", "Added task"],
    ["完成了待办", "Completed task"],
    ["取消了待办", "Cancelled task"],
    ["为目标定了下一步", "Set the next step"],
  ]) {
    const match = new RegExp(`^(?:你)?${zh}[：:]?\\s*([\\s\\S]*)$`).exec(text);
    if (match) return `${en}: ${match[1]}`;
  }
  return text;
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
