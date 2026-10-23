import {
  type AgentConnectionId,
  type AutomationKey,
  type BankMail,
  CalendarPush,
  type ExperienceChanges,
  type ExplorationCommand,
  type FinanceImportOptions,
  type FinanceViewOptions,
  type ImportSource,
  KaituError,
  type LearningCheckinInput,
  type Locale,
  type MemoryExpectation,
  type MemoryInput,
  type NewsFeedback,
  type OnboardingAi,
  type OnboardingChoices,
  type OnboardingMatterDraft,
  type OnboardingMatterSuggestion,
  type OnboardingPath,
  type OnboardingSetupInput,
  type OnboardingTarget,
  type ProjectGoal,
  type SettingsData,
  type StartLearningInput,
  type SyncProvider,
  type TaskInput,
  type Workspace,
  addCalendarSubscription,
  addGoalNext,
  adoptOnboardingMatter,
  adoptTask,
  archiveMemory,
  bankNotificationCandidates,
  bindGithub,
  calendarPushEntries,
  calendarPushStore,
  cancelOnboardingPreview,
  cancelTask,
  captureNote,
  changeExperienceBatch,
  changeOnboardingNext,
  commitFinanceImport,
  completeNext,
  configureAutomation,
  confirmOnboardingImport,
  confirmOnboardingMemory,
  confirmOnboardingSetup,
  createProject,
  decideProposal,
  directionsPrompt,
  discardFinanceImport,
  dismissDirectionLink,
  dismissNews,
  draftOnboardingMatter,
  editCalendarBlock,
  editExperience,
  exportWorkspace,
  financeAccounts,
  financeCashflow,
  financeOverview,
  generateDirectionMap,
  handoverPack,
  hideExperience,
  installProjectMemory,
  keepOnboardingMatter,
  lifeMap,
  listLearning,
  loadFinanceInvestments,
  markOrganizerSeen,
  matterPrompt,
  moveWorkspace,
  normalizeLocale,
  onboardingStatus,
  pasteDirections,
  pasteOnboardingMatter,
  previewExperienceBatch,
  previewFinanceImport,
  previewOnboardingImport,
  previewOnboardingMemory,
  previewOnboardingSetup,
  projectArchitecturePrompt,
  projectMemoryPrompt,
  proposeTask,
  readAutomation,
  readAvatar,
  readCalendar,
  readDirectionMap,
  readDoing,
  readExperienceImports,
  readExperienceSource,
  readExploration,
  readExplorationSource,
  readHealthPage,
  readJobs,
  readLearning,
  readLibrary,
  readLibraryDocument,
  readMe,
  readNews,
  readOnboardingMatter,
  readOverviewPage,
  readPhoto,
  readProjectArchitecture,
  readProjectPage,
  readProjectsPage,
  readSettings,
  readWeather,
  receiveBankNotification,
  recordOnboardingAiConnection,
  recoverExperienceImports,
  refreshWeather,
  removeAvatar,
  replaceMemory,
  resolveExperience,
  resolvePlace,
  resolvePreferences,
  restore,
  saveAvatar,
  saveHometown,
  saveLearningCheckin,
  saveNewsKeywords,
  saveOnboardingChoices,
  saveOnboardingMatter,
  savePreferences,
  saveProjectGoal,
  scheduleNext,
  setExperienceSource,
  setFinanceAccess,
  setNewsFeedback,
  setWeatherPlace,
  stageFinanceUpload,
  startLearning,
  syncProject,
  tryNews,
  unhideExperience,
  workspaceBackupRequest,
  writeExploration,
} from "@kaitu/core";
import { directionGeneration } from "./directions-ai.js";
import { suggestNewsKeywords } from "./news-ai.js";
import { organizeOnboardingMatter } from "./onboarding-ai.js";
import { askText, suggestProjectGoal } from "./project-ai.js";

import type { AskMode, AskService } from "./ask.js";

/** 改了今天计划、需要在后台同步系统日历的操作。 */
export const planMutations = new Set(["decideProposal", "scheduleNext", "editCalendarBlock"]);

export const productMutations = new Set([
  "archiveMemory",
  "replaceMemory",
  "learningStart",
  "learningSave",
  "organizerSeen",
  "workspaceBackup",
  "askModels",
  "projectCreate",
  "projectBindGithub",
  "projectGoalSave",
  "projectSync",
  "configureAutomation",
  "configureCalendarPush",
  "retryCalendarPush",
  "removeCalendarPush",
  "scheduleNext",
  "editCalendarBlock",
  "restoreVersion",
  "moveStorage",
  "addCalendarSubscription",
  "completeNext",
  "adoptTask",
  "cancelTask",
  "proposeTask",
  "onboardingChoose",
  "onboardingMatterSave",
  "onboardingMatterKeep",
  "onboardingMatterDraft",
  "onboardingMatterOrganize",
  "onboardingMatterAdopt",
  "onboardingMatterPaste",
  "onboardingNextChange",
  "goalNextAdd",
  "directionsPaste",
  "onboardingSetupConfirm",
  "onboardingMemoryConfirm",
  "onboardingImportConfirm",
  "setExperienceSource",
  "changeExperienceBatch",
  "recoverExperienceImports",
  "explorationWrite",
  "capture",
  "decideProposal",
  "resolveExperience",
  "saveHometown",
  "editExperience",
  "hideExperience",
  "unhideExperience",
  "tryNews",
  "feedbackNews",
  "saveNewsKeywords",
  "dismissNews",
  "setAvatar",
  "removeAvatar",
  "financeImportCommit",
  "financeNotificationReceive",
]);

export async function productRequest(
  ws: Workspace,
  method: string,
  args: unknown[],
  ask?: AskService,
  calendarPush = new CalendarPush(calendarPushStore(ws)),
): Promise<unknown> {
  const text = (i: number) => {
    if (typeof args[i] !== "string") throw new KaituError("缺少有效参数", "BAD_ARGS");
    return args[i] as string;
  };
  const revision = (i: number) => {
    if (!Number.isInteger(args[i])) throw new KaituError("缺少记录版本", "BAD_ARGS");
    return args[i] as number;
  };
  const locale = (i: number): Locale => normalizeLocale(args[i]);
  if (method === "archiveMemory")
    return archiveMemory(ws, text(0), { by: "user", expected: args[1] as MemoryExpectation });
  if (method === "replaceMemory")
    return replaceMemory(ws, text(0), args[1] as MemoryInput, {
      by: "user",
      expected: args[2] as MemoryExpectation,
    });
  if (method === "organizerSeen") return markOrganizerSeen(ws);
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
        const settings = await ask.settings();
        if (settings.configured) recordOnboardingAiConnection(ws, "问问");
        return settings;
      }
      case "askConfigure": {
        const result = await ask.configure((args[0] ?? {}) as Record<string, unknown>);
        if ((await ask.settings()).configured) recordOnboardingAiConnection(ws, "问问");
        return result;
      }
      case "askList":
        return ask.list();
      case "askCreate":
        return ask.create();
      case "askOrganize":
        return ask.organize(text(0), (args[1] ?? {}) as Record<string, unknown>);
      case "askRemove":
        return ask.remove(text(0));
      case "askEvents":
        return ask.events(text(0));
      case "askSend":
        return ask.send(text(0), text(1), args[2] as import("./ask.js").AskAttachment[] | undefined);
    }
  }
  switch (method) {
    case "library":
      return readLibrary(ws, args[0] as Parameters<typeof readLibrary>[1]);
    case "libraryDocument":
      return readLibraryDocument(ws, text(0));
    case "learningList":
      return listLearning(ws);
    case "learningRead":
      return readLearning(ws, text(0));
    case "learningStart":
      return startLearning(ws, args[0] as StartLearningInput);
    case "learningSave":
      return saveLearningCheckin(ws, args[0] as LearningCheckinInput);
    case "calendarPush":
      return calendarPush.settings();
    case "configureCalendarPush":
      if (typeof args[0] !== "boolean") throw new KaituError("缺少开关状态", "BAD_ARGS");
      return calendarPush.configure(args[0]);
    case "retryCalendarPush":
      return calendarPush.sync(calendarPushEntries(ws), text(0));
    case "removeCalendarPush":
      return calendarPush.removeAll();
    case "editCalendarBlock": {
      const result = await editCalendarBlock(ws, text(0), text(1), text(2), calendarPush.located(text(0)));
      return { ...result, calendarPush: calendarPush.settings() };
    }
    case "scheduleNext": {
      const result = await scheduleNext(ws, text(0), text(1), text(2), text(3));
      return { ...result, calendarPush: calendarPush.settings() };
    }
    case "calendar":
      return readCalendar(ws);
    case "addCalendarSubscription":
      return addCalendarSubscription(ws, text(0), text(1));
    case "cancelTask":
      return cancelTask(ws, text(0), { by: "user" });
    case "adoptTask":
      return adoptTask(ws, text(0));
    case "proposeTask":
      return { id: (await proposeTask(ws, args[0] as TaskInput)).record.id };
    case "completeNext":
      return completeNext(ws, text(0), text(1));
    case "workspaceBackup":
      return workspaceBackupRequest(ws, text(0), args[1]);
    case "settings": {
      const data: SettingsData = await readSettings(ws);
      data.ai = ask ? await ask.settings() : null;
      return data;
    }
    case "setFinanceAccess":
      return setFinanceAccess(ws, text(0) as AgentConnectionId, args[1] as boolean);
    case "exportWorkspace":
      return exportWorkspace(ws);
    case "restoreVersion":
      return restore(ws, text(0));
    case "moveStorage": {
      if (typeof args[1] !== "boolean") throw new KaituError("缺少存放方式", "BAD_ARGS");
      return moveWorkspace(ws, text(0), args[1], (args[2] ?? undefined) as SyncProvider | undefined);
    }
    case "onboardingMatterKeep":
      return keepOnboardingMatter(ws, text(0));
    case "onboardingMatterSave":
      return saveOnboardingMatter(ws, text(0));
    case "onboardingMatterRead":
      return readOnboardingMatter(ws, text(0));
    case "onboardingMatterOrganize":
      return organizeOnboardingMatter(ws, text(0), ask, locale(1));
    case "onboardingMatterPrompt":
      return matterPrompt(readOnboardingMatter(ws, text(0)).text, locale(1));
    case "onboardingMatterPaste":
      return pasteOnboardingMatter(ws, text(0), text(1), { locale: locale(2) });
    case "onboardingMatterDraft":
      return draftOnboardingMatter(ws, text(0), args[1] as OnboardingMatterSuggestion);
    case "onboardingMatterAdopt":
      return adoptOnboardingMatter(
        ws,
        text(0),
        args[1] as OnboardingMatterDraft,
        (args[2] ?? null) as OnboardingPath | null,
      );
    case "onboardingNextChange":
      return changeOnboardingNext(ws, text(0), revision(1), text(2), text(3));
    case "onboarding":
      return onboardingStatus(ws, { locale: locale(0) });
    case "onboardingMemoryPreview":
      return previewOnboardingMemory(ws, text(0), text(1) as OnboardingAi, { locale: locale(2) });
    case "onboardingMemoryConfirm":
      return confirmOnboardingMemory(ws, text(0), args[1] as string[], {
        targets: (args[2] ?? undefined) as Record<string, OnboardingTarget> | undefined,
      });
    case "goalNextAdd":
      return addGoalNext(ws, text(0), text(1));
    case "handoverPack":
      return handoverPack(ws, locale(0), undefined, args[1] === true);
    case "directionsPrompt":
      return directionsPrompt(ws, locale(0));
    case "directionsPaste":
      return pasteDirections(ws, text(0), { locale: locale(1) });
    case "preferences":
      return resolvePreferences(ws, args[0]);
    case "savePreferences":
      return savePreferences(args[0] as Parameters<typeof savePreferences>[0]);
    case "onboardingCancel":
      return cancelOnboardingPreview(ws, text(0));
    case "onboardingSetupPreview":
      return previewOnboardingSetup(ws, args[0] as OnboardingSetupInput);
    case "onboardingSetupConfirm":
      return confirmOnboardingSetup(ws, text(0));
    case "onboardingChoose":
      return saveOnboardingChoices(ws, args[0] as OnboardingChoices);
    case "onboardingImportPreview": {
      const base64 = text(2);
      if (
        base64.length > 48 * 1024 * 1024 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)
      )
        throw new KaituError("文件过大或格式不合法", "BAD_ARGS");
      return previewOnboardingImport(ws, text(0) as ImportSource, text(1), Buffer.from(base64, "base64"));
    }
    case "onboardingImportConfirm":
      return confirmOnboardingImport(ws, text(0));
    case "automation":
      return readAutomation(ws);
    case "configureAutomation":
      return configureAutomation(
        ws,
        args[0] as Partial<Record<AutomationKey, boolean>>,
        (args[1] ?? undefined) as Partial<Record<AutomationKey, string>> | undefined,
      );
    case "experienceImports":
      return readExperienceImports(ws);
    case "experienceBatchPreview":
      return previewExperienceBatch(ws, text(0), text(1) as "confirm" | "undo" | "restore");
    case "setExperienceSource":
      if (typeof args[1] !== "boolean") throw new KaituError("缺少来源开关", "BAD_ARGS");
      return setExperienceSource(ws, text(0), args[1], revision(2));
    case "changeExperienceBatch":
      return changeExperienceBatch(ws, text(0), text(1) as "confirm" | "undo" | "restore", revision(2));
    case "recoverExperienceImports":
      return { recovered: (await recoverExperienceImports(ws)).length };
    case "exploration":
      return readExploration(ws);
    case "explorationWrite":
      return writeExploration(ws, args[0] as ExplorationCommand, "user");
    case "explorationSource":
      return readExplorationSource(
        ws,
        text(0) as "direction" | "direction_note" | "exploration_experiment",
        text(1),
        args[2] == null ? undefined : revision(2),
      );
    case "overview":
      return readOverviewPage(ws);
    case "decideProposal": {
      const result = await decideProposal(ws, text(0), text(1) as "confirmed" | "rejected");
      return { ...result, calendarPush: calendarPush.settings() };
    }
    case "capture":
      return captureNote(ws, text(0));
    case "me":
      return readMe(ws);
    case "health":
      return readHealthPage(ws);
    case "doing":
      return readDoing(ws);
    case "projects":
      return readProjectsPage(ws);
    case "projectDetail":
      return readProjectPage(ws, text(0));
    case "projectCreate":
      return createProject(ws, { title: text(0), kind: "personal" });
    case "directionMap":
      return readDirectionMap(ws);
    case "directionMapGenerate": {
      if (!ask || !(await ask.settings()).configured)
        throw new KaituError("先到「AI 与连接」连上 AI，开图才能帮你看", "AI_NOT_CONFIGURED");
      const service = ask;
      // 等 AI 是外部的事：立刻返回「正在看」，结果写进本机缓存，界面再读。
      return generateDirectionMap(ws, (prompt) =>
        askText(
          service,
          prompt,
          { timeout: "开图看得太久了，请再试一次", empty: "AI 没有回答，请再试一次" },
          120000,
        ),
      );
    }
    case "directionMapDismiss":
      return dismissDirectionLink(ws, text(0), text(1));
    case "projectGoalSuggest":
      return suggestProjectGoal(ws, text(0), ask);
    case "projectGoalSave":
      return saveProjectGoal(ws, text(0), args[1] as ProjectGoal);
    case "projectBindGithub":
      await bindGithub(ws, text(0), text(1));
      return readProjectPage(ws, text(0));
    case "projectSync":
      return syncProject(ws, text(0));
    case "projectMemoryPrompt":
      return projectMemoryPrompt(ws, text(0), args[1] === "en" ? "en" : "zh-CN");
    case "weather":
      return readWeather();
    case "weatherPlace": {
      const state = setWeatherPlace(args[0] as Parameters<typeof setWeatherPlace>[0]);
      // 取天气是等外部的事：先返回，界面稍后再读缓存。
      void refreshWeather().catch(() => {});
      return state;
    }
    case "projectArchitecturePrompt":
      return projectArchitecturePrompt(ws, text(0), args[1] === "en" ? "en" : "zh-CN");
    case "projectArchitecture":
      return readProjectArchitecture(ws, text(0));
    case "projectMemoryInstall":
      return installProjectMemory(ws, text(1), text(0));
    case "experienceSource":
      return readExperienceSource(ws, text(0));
    case "hometownCities":
      return resolvePlace(text(0));
    case "saveHometown":
      return saveHometown(ws, text(0), revision(1));
    case "lifeMap":
      return lifeMap(ws);
    case "resolveExperience":
      return resolveExperience(ws, text(0), revision(1));
    case "editExperience":
      return editExperience(ws, text(0), args[1] as ExperienceChanges, revision(2));
    case "hideExperience":
      return (await hideExperience(ws, text(0), revision(1))).record.rev;
    case "unhideExperience":
      return unhideExperience(ws, text(0), revision(1));
    case "jobs":
      return readJobs(ws);
    case "news":
      return readNews(ws);
    case "suggestNewsKeywords":
      return suggestNewsKeywords(ws, ask);
    case "saveNewsKeywords":
      return saveNewsKeywords(ws, args[0] as string[]);
    case "feedbackNews":
      return setNewsFeedback(ws, text(0), args[1] as NewsFeedback | null);
    case "tryNews": {
      const result = await tryNews(ws, text(0));
      return { id: result.record.id, status: "tried", version: result.version };
    }
    case "dismissNews": {
      const result = await dismissNews(ws, text(0));
      return { id: result.record.id, status: "dismissed", version: result.version };
    }
    case "healthPhoto": {
      const photo = readPhoto(ws, text(0));
      return `data:${photo.contentType};base64,${photo.bytes.toString("base64")}`;
    }
    case "setAvatar": {
      const input = text(0);
      if (
        input.length > 2800000 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input)
      )
        throw new KaituError("头像超过 2MB 或格式不合法", "BAD_ARGS");
      saveAvatar(ws, Buffer.from(input, "base64"));
      return readAvatar(ws);
    }
    case "removeAvatar":
      return removeAvatar(ws);
    case "financeNotificationReceive":
      return receiveBankNotification(ws, args[0] as BankMail);
    case "financeNotificationCandidates":
      return bankNotificationCandidates(ws);
    case "financeOverview":
      return financeOverview(ws, (args[0] ?? undefined) as FinanceViewOptions | undefined);
    case "financeCashflow":
      return financeCashflow(ws, text(0), text(1), (args[2] ?? undefined) as FinanceViewOptions | undefined);
    case "financeInvestments":
      return loadFinanceInvestments(ws, (args[0] ?? undefined) as FinanceViewOptions | undefined);
    case "financeAccounts":
      return financeAccounts(ws, (args[0] ?? undefined) as FinanceViewOptions | undefined);
    case "financeImportPreview": {
      const base64 = text(1);
      if (
        base64.length > 48 * 1024 * 1024 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)
      )
        throw new KaituError("文件过大或格式不合法", "BAD_ARGS");
      const file = stageFinanceUpload(ws, text(0), Buffer.from(base64, "base64"));
      try {
        return {
          file,
          preview: await previewFinanceImport(
            ws,
            file,
            (args[2] ?? undefined) as FinanceImportOptions | undefined,
          ),
        };
      } catch (err) {
        discardFinanceImport(ws, file);
        throw err;
      }
    }
    case "financeImportCommit":
      if (!/^\.kaitu\/cache\/uploads\/[a-f0-9-]+\.(csv|xml|xls|xlsx)$/.test(text(0)))
        throw new KaituError("无效的财务上传文件", "BAD_ARGS");
      ws.resolve(text(0), { internal: true });
      return commitFinanceImport(ws, text(0), args[1] as FinanceImportOptions);
    case "financeImportDiscard":
      return discardFinanceImport(ws, text(0));
    default:
      throw new KaituError("接口不存在", "NOT_FOUND");
  }
}
