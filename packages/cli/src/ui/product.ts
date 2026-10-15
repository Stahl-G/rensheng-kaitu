import {
  type ExperienceChanges,
  type ExplorationCommand,
  type FinanceImportOptions,
  type FinanceViewOptions,
  KaituError,
  type Workspace,
  captureNote,
  commitFinanceImport,
  decideProposal,
  discardFinanceImport,
  dismissNews,
  editExperience,
  financeAccounts,
  financeCashflow,
  financeInvestments,
  financeOverview,
  hideExperience,
  lifeMap,
  listProjects,
  previewFinanceImport,
  readAvatar,
  readDoing,
  readExperienceSource,
  readExploration,
  readExplorationSource,
  readHealthPage,
  readMe,
  readNews,
  readOverviewPage,
  readPhoto,
  removeAvatar,
  resolveExperience,
  saveAvatar,
  stageFinanceUpload,
  tryNews,
  unhideExperience,
  writeExploration,
} from "@kaitu/core";

export const productMutations = new Set([
  "explorationWrite",
  "capture",
  "decideProposal",
  "resolveExperience",
  "editExperience",
  "hideExperience",
  "unhideExperience",
  "tryNews",
  "dismissNews",
  "setAvatar",
  "removeAvatar",
  "financeImportCommit",
]);

export async function productRequest(ws: Workspace, method: string, args: unknown[]): Promise<unknown> {
  const text = (i: number) => {
    if (typeof args[i] !== "string") throw new KaituError("缺少有效参数", "BAD_ARGS");
    return args[i] as string;
  };
  const revision = (i: number) => {
    if (!Number.isInteger(args[i])) throw new KaituError("缺少记录版本", "BAD_ARGS");
    return args[i] as number;
  };
  switch (method) {
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
    case "decideProposal":
      return decideProposal(ws, text(0), text(1) as "confirmed" | "rejected");
    case "capture":
      return captureNote(ws, text(0));
    case "me":
      return readMe(ws);
    case "health":
      return readHealthPage(ws);
    case "doing":
      return readDoing(ws);
    case "projects":
      return listProjects(ws).map((p) => ({
        ...p,
        recentLog: p.lastLogDate
          ? {
              date: p.lastLogDate,
              text:
                p.log
                  .split(/^##[ \t]+/m)
                  .find((part) => part.startsWith(p.lastLogDate as string))
                  ?.split(/\r?\n/)
                  .slice(1)
                  .join("\n")
                  .trim() ?? "",
            }
          : null,
        recent7: { ...p.recent7, commits: p.recent7.commitsRecorded ? p.recent7.commits : null },
      }));
    case "experienceSource":
      return readExperienceSource(ws, text(0));
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
    case "news":
      return readNews(ws);
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
    case "financeOverview":
      return financeOverview(ws, (args[0] ?? undefined) as FinanceViewOptions | undefined);
    case "financeCashflow":
      return financeCashflow(ws, text(0), text(1), (args[2] ?? undefined) as FinanceViewOptions | undefined);
    case "financeInvestments":
      return financeInvestments(ws, (args[0] ?? undefined) as FinanceViewOptions | undefined);
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
          preview: previewFinanceImport(ws, file, (args[2] ?? undefined) as FinanceImportOptions | undefined),
        };
      } catch (err) {
        discardFinanceImport(ws, file);
        throw err;
      }
    }
    case "financeImportCommit":
      return commitFinanceImport(ws, text(0), args[1] as FinanceImportOptions & { account: string });
    case "financeImportDiscard":
      return discardFinanceImport(ws, text(0));
    default:
      throw new KaituError("接口不存在", "NOT_FOUND");
  }
}
