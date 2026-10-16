import { KaituError } from "./errors.js";
import type { Workspace } from "./workspace.js";

export const automationKeys = ["morning", "organizer", "news"] as const;
export type AutomationKey = (typeof automationKeys)[number];
export interface AutomationSettings {
  asked: boolean;
  tasks: Record<AutomationKey, boolean>;
}
const file = ".kaitu/automation.json";

export function readAutomation(ws: Workspace): AutomationSettings {
  if (ws.exists(file)) {
    const value = ws.readJson<AutomationSettings>(file);
    if (
      typeof value.asked !== "boolean" ||
      !value.tasks ||
      automationKeys.some((key) => typeof value.tasks[key] !== "boolean")
    )
      throw new KaituError("自动任务设置不完整", "INVALID_CONFIG");
    return value;
  }
  const legacy = ws.exists(".kaitu/dsh-setup.json")
    ? ws.readJson<{ tasks: Record<string, string> }>(".kaitu/dsh-setup.json").tasks
    : {};
  const existing = Object.keys(legacy).length > 0;
  return {
    asked: existing,
    tasks: {
      morning: existing ? !!legacy.morning : true,
      organizer: existing ? !!legacy.organizer : true,
      news: false,
    },
  };
}

/** 首次确认和设置共用此写入口。历史任务回执独立保留。 */
export function configureAutomation(ws: Workspace, tasks: Partial<Record<AutomationKey, boolean>>) {
  if (
    !tasks ||
    Object.entries(tasks).some(
      ([key, value]) => !automationKeys.includes(key as AutomationKey) || typeof value !== "boolean",
    )
  )
    throw new KaituError("自动任务开关不合法", "BAD_ARGS");
  const settings = { asked: true, tasks: { ...readAutomation(ws).tasks, ...tasks } };
  ws.writeJson(file, settings, { internal: true });
  return settings;
}
