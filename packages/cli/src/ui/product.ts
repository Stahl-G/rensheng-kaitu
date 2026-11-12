import {
  type AtlasGenerateInput,
  CalendarPush,
  KaituError,
  type Locale,
  type SyncProvider,
  type Workspace,
  type WorkspaceWrite,
  calendarPushEntries,
  calendarPushStore,
  changeLifeAtlas,
  dismissDirectionLink,
  generateDirectionMap,
  generateLifeAtlas,
  invalidateLifeAtlas,
  moveWorkspace,
  normalizeLocale,
  pick,
  readDirectionMap,
  readLifeAtlas,
  readLifeAtlasProgress,
  recordOnboardingAiConnection,
  restore,
  workspaceBackupRequest,
} from "@kaitu/core";
import { directionGeneration } from "./directions-ai.js";
import { suggestNewsKeywords } from "./news-ai.js";
import { organizeOnboardingMatter } from "./onboarding-ai.js";
import { askTextOnly, suggestProjectGoal } from "./project-ai.js";
import { extractResume } from "./resume-ai.js";

import { Context } from "@deepseek-ai/cordis";
import { KaituFinanceService, KaituOverviewService, TYPERT } from "@kaitu/dsh-plugin/service";
import type { AskMode, AskService } from "./ask.js";

/** 独立版自己编排、要占资料写入队列的操作；其余写入由界面服务的写入队列排队并通知界面。 */
export const productMutations = new Set(["workspaceBackup", "askModels", "restoreVersion", "moveStorage"]);

export interface ProductServices {
  kaitu: KaituOverviewService;
  kaituFinance: KaituFinanceService;
}

type Invocation = {
  service: string;
  method: string;
  invocation: { kind: string };
  parameters: { name: string; codec: { create(): { safeParse(value: unknown): { success: boolean } } } }[];
};
const invocations = new Map(
  (TYPERT as { invocations: Invocation[] }).invocations
    .filter((entry) => entry.invocation.kind === "direct")
    .map((entry) => [entry.method, entry]),
);

/** 独立版和 DSH 插件共用的界面接口：按生成的协议检查参数，再调同一个服务对象。 */
async function invokeRemote(services: ProductServices, method: string, args: unknown[]): Promise<unknown> {
  const entry = invocations.get(method);
  const target =
    entry && (services[entry.service as keyof ProductServices] as unknown as Record<string, unknown>);
  if (!entry || typeof target?.[method] !== "function") throw new KaituError("接口不存在", "NOT_FOUND");
  if (args.length > entry.parameters.length) throw new KaituError("缺少有效参数", "BAD_ARGS");
  const values = entry.parameters.map((parameter, index) => {
    const schema = parameter.codec.create();
    const value = args[index];
    if (schema.safeParse(value).success) return value;
    // JSON 数组里没有 undefined，省略的可选参数到这里是 null。
    if (value == null && schema.safeParse(undefined).success) return undefined;
    throw new KaituError(`缺少有效参数：${parameter.name}`, "BAD_ARGS");
  });
  const result = (target[method] as (...values: unknown[]) => unknown)(...values);
  // 持续推送的方法（首页更新流）在独立版走 /api/events，不经这里。
  if (result && typeof (result as AsyncIterable<unknown>)[Symbol.asyncIterator] === "function")
    throw new KaituError("接口不存在", "NOT_FOUND");
  return (await result) ?? null;
}

const standalone = new WeakMap<Workspace, ProductServices>();
/** 不经本机服务直接调用时（命令行、测试）用的服务对象：不建首页缓存，写入不排队。 */
function servicesFor(ws: Workspace): ProductServices {
  let services = standalone.get(ws);
  if (!services) {
    const ctx = new Context();
    services = {
      kaitu: new KaituOverviewService(ctx, {}, ws, undefined, undefined, { home: null }),
      kaituFinance: new KaituFinanceService(ctx, {}, ws),
    };
    standalone.set(ws, services);
  }
  return services;
}

export async function productRequest(
  ws: Workspace,
  method: string,
  args: unknown[],
  ask?: AskService,
  calendarPush = new CalendarPush(calendarPushStore(ws)),
  write: WorkspaceWrite = (operation) => operation(),
  services?: ProductServices,
): Promise<unknown> {
  const text = (i: number) => {
    if (typeof args[i] !== "string") throw new KaituError("缺少有效参数", "BAD_ARGS");
    return args[i] as string;
  };
  const locale = (i: number): Locale => normalizeLocale(args[i]);
  if (method === "resumeExtract") return extractResume(ws, text(0), ask);
  if (method === "resumeConnection") {
    const settings = await ask?.settings(true);
    return {
      configured: settings?.configured ?? false,
      supportsImages: settings?.supportsImages ?? false,
      provider: settings?.providerName || settings?.provider || "",
      model: settings?.model || "",
    };
  }
  if (method === "directionGeneration") return directionGeneration(ws, args[0] === true, ask);
  if (method.startsWith("ask")) {
    if (!ask) {
      // 未找到本机 AI 引擎时，保留资料浏览和外部 AI 入口。
      if (method === "askSettings")
        return {
          available: false,
          configured: false,
          model: "",
          provider: "",
          providerName: "",
          protocols: [],
          supportsImages: false,
          providers: [],
        };
      if (method === "askList") return [];
      throw new KaituError("问问引擎未载入，请重新安装开图 CLI/Web 包并重启工作台", "BAD_ARGS");
    }
    switch (method) {
      case "askSupport": {
        if (!ask.support) throw new KaituError("请更新开图引擎", "AI_CONNECTION");
        return ask.support(text(0), (args[1] ?? {}) as Record<string, unknown>);
      }
      case "askModels":
        return ask.models((args[0] ?? {}) as Record<string, unknown>);
      case "askSearchConfigure":
        return ask.configure({ search: args[0] });
      case "askCancel":
        return ask.cancel(text(0));
      case "askPermission":
        if (args[2] !== null && typeof args[2] !== "string")
          throw new KaituError("缺少单次审批选项", "BAD_ARGS");
        return ask.permission(text(0), text(1), args[2] as string | null);
      case "askSetMode":
        return ask.setMode(text(0), text(1) as AskMode, args[2] === true);
      case "askSettings": {
        const settings = await ask.settings(args[0] === true);
        if (settings.configured) recordOnboardingAiConnection(ws, "问问");
        return settings;
      }
      case "askConfigure": {
        const result = await ask.configure((args[0] ?? {}) as Record<string, unknown>);
        if ((result as { configured?: boolean }).configured) recordOnboardingAiConnection(ws, "问问");
        return result;
      }
      case "askList":
        return ask.list();
      case "askHandoffStatus":
        return ask.handoffStatus(text(0));
      case "askCreate":
        return ask.create(typeof args[0] === "string" ? args[0] : undefined);
      case "askOrganize":
        return ask.organize(text(0), (args[1] ?? {}) as Record<string, unknown>);
      case "askRemove":
        return ask.remove(text(0));
      case "askEvents":
        return ask.events(text(0));
      case "askSend":
        return ask.send(
          text(0),
          text(1),
          args[2] as import("./ask.js").AskAttachment[] | undefined,
          typeof args[3] === "string" ? args[3] : undefined,
        );
    }
  }
  switch (method) {
    case "configureCalendarPush":
      if (typeof args[0] !== "boolean") throw new KaituError("缺少开关状态", "BAD_ARGS");
      return calendarPush.configure(args[0]);
    case "retryCalendarPush":
      return calendarPush.sync(calendarPushEntries(ws), text(0));
    case "removeCalendarPush":
      return calendarPush.removeAll();
    case "workspaceBackup":
      return workspaceBackupRequest(ws, text(0), args[1], write);
    case "restoreVersion":
      return restore(ws, text(0));
    case "moveStorage": {
      if (typeof args[1] !== "boolean") throw new KaituError("缺少存放方式", "BAD_ARGS");
      return moveWorkspace(ws, text(0), args[1], (args[2] ?? undefined) as SyncProvider | undefined);
    }
    case "onboardingMatterOrganize":
      return organizeOnboardingMatter(ws, text(0), ask, locale(1), write);
    case "lifeAtlas":
      if (args[1] === true) invalidateLifeAtlas(ws);
      return readLifeAtlas(
        ws,
        typeof args[0] === "string" ? args[0] : undefined,
        undefined,
        typeof args[2] === "string" ? args[2] : undefined,
      );
    case "lifeAtlasProgress":
      return readLifeAtlasProgress(ws);
    case "lifeAtlasGenerate":
      return generateLifeAtlas(ws, args[0] as AtlasGenerateInput);
    case "lifeAtlasChange":
      return changeLifeAtlas(ws, text(0), text(1) as "adopt" | "archive" | "restore" | "delete");
    case "directionMap":
      return readDirectionMap(ws, locale(0));
    case "directionMapGenerate": {
      const lang = locale(0);
      if (!ask || !(await ask.settings()).configured)
        throw new KaituError(
          pick(lang, "先到「AI 与连接」连上 AI，开图才能帮你看", "Connect AI in AI & Connections first"),
          "AI_NOT_CONFIGURED",
        );
      // 本机 Agent 自带读文件和命令工具，开图没法保证它只收发文字；这次只用内置模型。
      if (((await ask.settings()).backend ?? "dsh") !== "dsh")
        throw new KaituError(
          pick(
            lang,
            "方向页的看法只用内置模型生成：本机 Agent 会带自己的读文件和命令工具，开图没法保证它只收发文字。请到「AI 与连接」切到内置模型再看。",
            "Kaitu's view uses the built-in model only: local Agents bring their own file and command tools, so Kaitu can't keep them text-only. Switch to a built-in model in AI & Connections.",
          ),
          "AI_NOT_CONFIGURED",
        );
      const service = ask;
      // 等 AI 是外部的事：立刻返回「正在看」，结果写进本机缓存，界面再读。
      return generateDirectionMap(
        ws,
        (prompt) =>
          askTextOnly(
            service,
            prompt,
            {
              timeout: pick(lang, "开图看得太久了，请再试一次", "Kaitu took too long. Try again."),
              empty: pick(lang, "AI 没有回答，请再试一次", "The AI didn't answer. Try again."),
            },
            120000,
          ),
        lang,
      );
    }
    case "directionMapDismiss":
      return dismissDirectionLink(ws, text(0), text(1));
    case "projectGoalSuggest":
      return suggestProjectGoal(ws, text(0), ask);
    case "suggestNewsKeywords":
      return suggestNewsKeywords(ws, ask);
    default:
      return invokeRemote(services ?? servicesFor(ws), method, args);
  }
}
