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

/** Translate Kaitu's generated history labels; keep user titles and custom messages verbatim. */
export function versionText(text: string, locale: Locale): string {
  if (locale !== "en") return text;
  const labels: Record<string, string> = {
    从原文采纳了一个下一步: "Turned a note into a next step",
    完成下一步并记下结果: "Completed a next step and logged the result",
    调整了下一步的日期: "Changed the date of a next step",
    保存了一条原文记录: "Saved a quick note",
    "留了一条笔记，等你整理": "Saved a note to organize",
    记录了一餐: "Logged a meal",
    记录了一次训练: "Logged a workout",
    记录了睡眠: "Logged sleep",
    记录了身体数据: "Logged body measurements",
    记录了活动: "Logged activity",
    加了一条待办: "Added a task",
    记了一条记录: "Added a record",
    设置了家乡: "Set your hometown",
    修正了一条地点经历: "Corrected a place",
    隐藏了一条地点经历: "Hid a place",
    撤销了地点经历的隐藏: "Unhid a place",
    确认了一条经历的城市: "Confirmed a city",
    删除了一张体态照片: "Deleted a progress photo",
    记录了资讯反馈: "Logged news feedback",
    更新了资讯关注方向: "Updated news interests",
    "只保留了原文，未采纳下一步": "Kept the note without a next step",
    "AI 提出了一个探索方向": "AI suggested a direction",
    记下了一个探索方向: "Added a direction",
    更新了探索方向: "Updated a direction",
    记录了一个方向尝试: "Planned an experiment",
    记录了尝试结果: "Logged an experiment result",
    更新了方向尝试: "Updated an experiment",
    记录了尝试打卡: "Logged an experiment check-in",
    补充了方向依据与认识: "Added direction evidence",
    修正了方向资料: "Corrected direction details",
  };
  const prefixes: [string, string][] = [
    ["完成了下一步", "Completed next step"],
    ["确认了下一步的时间段", "Scheduled next step"],
    ["新建了项目", "Created project"],
    ["更新了项目", "Updated project"],
    ["记录了项目进展", "Logged progress"],
    ["同步了项目进度", "Synced project progress"],
    ["记下了待办", "Added task"],
    ["完成了待办", "Completed task"],
    ["取消了待办", "Cancelled task"],
    ["记住了", "Remembered"],
    ["更新了一条记忆", "Updated a memory"],
    ["标记了不相关", "Marked as not relevant"],
  ];
  return text
    .split("；")
    .map((part) => {
      const label = part.replace(/^你/, "");
      if (labels[label]) return labels[label];
      if (/^添加了一张体态照片（.*）$/.test(label)) return "Added a progress photo";
      for (const [zh, en] of prefixes) {
        if (!label.startsWith(zh) || !/^[：:]|^「/.test(label.slice(zh.length))) continue;
        const title = label
          .slice(zh.length)
          .replace(/^[：:]\s*/, "")
          .replace(/^「([\s\S]*)」$/, "$1");
        return zh.endsWith("项目") ? `${en} “${title}”` : `${en}: ${title}`;
      }
      if (label.startsWith("开图升级到 ")) return label.replace("开图升级到 ", "Upgraded Kaitu to ");
      const files = /^文件夹有改动：([\s\S]*)等 (\d+) 个文件$/.exec(label);
      if (files) return `Folder changed: ${files[1]} (${files[2]} files)`;
      return part;
    })
    .join("; ");
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
