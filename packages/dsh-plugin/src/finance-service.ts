import type { Context } from "@deepseek-ai/cordis";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import {
  Workspace,
  commitFinanceImport,
  defaultRoot,
  discardFinanceImport,
  financeAccounts,
  financeCashflow,
  financeInvestments,
  financeOverview,
  previewFinanceImport,
  stageFinanceUpload,
} from "@kaitu/core";
import type { MutationQueue } from "./dsh.js";
import type { Config } from "./tools.js";
import type {
  FinanceAccountsData,
  FinanceCashflowData,
  FinanceImportCommitData,
  FinanceImportPreviewData,
  FinanceInvestmentsData,
  FinanceOverviewData,
  FinanceRemoteCommitOptions,
  FinanceRemoteImportOptions,
  FinanceRemoteViewOptions,
} from "./types.js";

declare module "@deepseek-ai/cordis" {
  interface Context {
    kaituFinance: KaituFinanceService;
  }
}
export class KaituFinanceService extends TypertRemoteService {
  private readonly workspace: Workspace;
  constructor(
    ctx: Context,
    config: Config = {},
    workspace?: Workspace,
    private readonly write: MutationQueue = (run) => run(),
  ) {
    super(ctx, "kaituFinance");
    this.workspace = workspace ?? new Workspace(config.workspace ?? defaultRoot(), { maintain: false });
  }
  @Remote("financeOverview")
  async financeOverview(options?: FinanceRemoteViewOptions): Promise<FinanceOverviewData> {
    return financeOverview(this.workspace, options);
  }
  @Remote("financeCashflow")
  async financeCashflow(
    from: string,
    to: string,
    options?: FinanceRemoteViewOptions,
  ): Promise<FinanceCashflowData> {
    return financeCashflow(this.workspace, from, to, options);
  }
  @Remote("financeInvestments")
  async financeInvestments(options?: FinanceRemoteViewOptions): Promise<FinanceInvestmentsData> {
    return financeInvestments(this.workspace, options);
  }
  @Remote("financeAccounts")
  async financeAccounts(options?: FinanceRemoteViewOptions): Promise<FinanceAccountsData> {
    return financeAccounts(this.workspace, options);
  }
  @Remote("financeImportPreview")
  async financeImportPreview(
    name: string,
    base64: string,
    options?: FinanceRemoteImportOptions,
  ): Promise<FinanceImportPreviewData> {
    if (
      base64.length > 48 * 1024 * 1024 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)
    )
      throw new Error("上传内容不是有效的 base64 或超过大小限制");
    const file = stageFinanceUpload(this.workspace, name, Buffer.from(base64, "base64"));
    try {
      return { file, preview: previewFinanceImport(this.workspace, file, options) };
    } catch (error) {
      discardFinanceImport(this.workspace, file);
      throw error;
    }
  }
  @Remote("financeImportCommit")
  async financeImportCommit(
    file: string,
    options: FinanceRemoteCommitOptions,
  ): Promise<FinanceImportCommitData> {
    this.assertUpload(file);
    return this.write(() => commitFinanceImport(this.workspace, file, options));
  }
  @Remote("financeImportDiscard")
  async financeImportDiscard(file: string): Promise<void> {
    this.assertUpload(file);
    discardFinanceImport(this.workspace, file);
  }
  private assertUpload(file: string): void {
    if (!/^\.kaitu\/cache\/uploads\/[a-f0-9-]+\.(csv|xml)$/.test(file)) throw new Error("无效的财务上传文件");
  }
}
