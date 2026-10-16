import { KaituError } from "./errors.js";
import type { Workspace } from "./workspace.js";

export const automationKeys = ["morning", "organizer", "news"] as const;
export type AutomationKey = (typeof automationKeys)[number];
export interface AutomationSettings {
  asked: boolean;
  tasks: Record<AutomationKey, boolean>;
  times: Record<AutomationKey, string>;
}
interface SavedAutomation {
  asked: boolean;
  tasks: Record<AutomationKey, boolean>;
  times?: Partial<Record<AutomationKey, string>>;
}
const file = ".kaitu/automation.json";
const defaults = { morning: "07:30", organizer: "03:00", news: "08:00" };
export function configuredAutomationTimes(ws: Workspace) {
  return ws.exists(file) ? (ws.readJson<SavedAutomation>(file).times ?? {}) : {};
}
export function readAutomation(ws: Workspace): AutomationSettings {
  const setup = ws.exists(".kaitu/dsh-setup.json")
    ? ws.readJson<{
        tasks: Record<string, string>;
        observedTimes?: Partial<Record<AutomationKey, string>>;
        appliedTimes?: Partial<Record<AutomationKey, string>>;
        saved?: Partial<Record<AutomationKey, { daily?: { time: string }; weekly?: { time: string } }>>;
      }>(".kaitu/dsh-setup.json")
    : { tasks: {} };
  const existing = Object.keys(setup.tasks).length > 0;
  const value: SavedAutomation = ws.exists(file)
    ? ws.readJson(file)
    : {
        asked: existing,
        tasks: {
          morning: existing ? !!setup.tasks.morning : true,
          organizer: existing ? !!setup.tasks.organizer : true,
          news: false,
        },
      };
  if (
    typeof value.asked !== "boolean" ||
    !value.tasks ||
    automationKeys.some((key) => typeof value.tasks[key] !== "boolean") ||
    Object.entries(value.times ?? {}).some(
      ([key, time]) =>
        !automationKeys.includes(key as AutomationKey) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time),
    )
  )
    throw new KaituError("自动任务设置不完整", "INVALID_CONFIG");
  const times = { ...defaults };
  for (const key of automationKeys) {
    const requested = value.times?.[key];
    times[key] =
      requested && requested !== setup.appliedTimes?.[key]
        ? requested
        : (setup.observedTimes?.[key] ??
          setup.saved?.[key]?.daily?.time.slice(0, 5) ??
          setup.saved?.[key]?.weekly?.time.slice(0, 5) ??
          requested ??
          defaults[key]);
  }
  return { asked: value.asked, tasks: value.tasks, times };
}
export function configureAutomation(
  ws: Workspace,
  tasks: Partial<Record<AutomationKey, boolean>>,
  times: Partial<Record<AutomationKey, string>> = {},
) {
  if (
    !tasks ||
    Object.entries(tasks).some(
      ([key, value]) => !automationKeys.includes(key as AutomationKey) || typeof value !== "boolean",
    ) ||
    !times ||
    Object.entries(times).some(
      ([key, value]) =>
        !automationKeys.includes(key as AutomationKey) ||
        typeof value !== "string" ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(value),
    )
  )
    throw new KaituError("自动任务设置不合法", "BAD_ARGS");
  const settings = {
    asked: true,
    tasks: { ...readAutomation(ws).tasks, ...tasks },
    times: { ...configuredAutomationTimes(ws), ...times },
  };
  ws.writeJson(file, settings, { internal: true });
  return readAutomation(ws);
}
