import { type Context, Service } from "@deepseek-ai/cordis";
import {
  convertNovelUnit,
  editNovel,
  importWorldbook,
  novelScienceReference,
  novelView,
  recordScienceNote,
  reviewScienceFinding,
  runScienceCheck,
  saveScienceRule,
  scienceView,
} from "@kaitu/core";
import type { Workspace } from "@kaitu/core";
export const name = "kaitu-sf-consistency";
export const inject = ["kaituNovelData", "tools", "systemPrompt"];
interface NovelReadContract {
  contractVersion: number;
  workspace: Workspace;
  snapshot(project: string): unknown;
}
interface Host {
  kaituNovelData: NovelReadContract;
  tools: { register(definition: object): () => void };
  systemPrompt: { section(value: object): () => void };
}
export class ScienceService extends Service {
  private readonly workspace: Workspace;
  constructor(ctx: Context, novel: NovelReadContract) {
    super(ctx, "kaituScience");
    this.workspace = novel.workspace;
  }
  request(operation: string, args: Record<string, unknown>): unknown {
    const project = String(args.project);
    switch (operation) {
      case "rules": {
        const view = scienceView(this.workspace, project);
        const ids = Array.isArray(args.ids) ? args.ids : [];
        const latest = view.data.rules.filter(
          (rule) => view.data.rules.filter((other) => other.id === rule.id).at(-1) === rule,
        );
        return {
          revision: view.revision,
          rules: latest.map((rule) =>
            ids.includes(rule.id)
              ? rule
              : {
                  id: rule.id,
                  version: rule.version,
                  title: rule.title,
                  canon: rule.canon,
                  source: rule.sources.map((source) => ({
                    documentId: source.documentId,
                    path: source.path,
                    heading: source.heading,
                    line: source.line,
                  })),
                },
          ),
          findings: view.data.findings.map((f) => ({
            id: f.id,
            type: f.result.type,
            conclusion: f.result.conclusion,
            status: f.status,
            stale: view.stale.includes(f.id),
          })),
        };
      }
      case "import": {
        let documentId = args.documentId;
        if (!documentId && typeof args.path === "string") {
          let novel = novelView(this.workspace, project);
          if (!novel.data.documents.some((doc) => doc.path === args.path)) {
            editNovel(this.workspace, project, novel.revision, { type: "include", paths: [args.path] });
            novel = novelView(this.workspace, project);
          }
          documentId = novel.data.documents.find((doc) => doc.path === args.path)?.id;
        }
        return importWorldbook(this.workspace, project, String(args.revision), String(documentId));
      }
      case "reference":
        return novelScienceReference(String(args.topic));
      case "note":
        return recordScienceNote(this.workspace, project, String(args.revision), args.input);
      case "view":
        return scienceView(this.workspace, project);
      case "rule":
        return saveScienceRule(this.workspace, project, String(args.revision), args.rule);
      case "check":
        return runScienceCheck(this.workspace, project, String(args.revision), args.input);
      case "review":
        return reviewScienceFinding(this.workspace, project, String(args.revision), args.input);
      case "unit":
        return convertNovelUnit(Number(args.value), String(args.from), String(args.to));
      case "export":
        return scienceView(this.workspace, project).data;
      default:
        throw new Error("未知科幻操作");
    }
  }
}
export function apply(ctx: Context) {
  const host = ctx as unknown as Host;
  if (host.kaituNovelData.contractVersion !== 1)
    throw new Error("小说共享契约版本不兼容；保留资料文件，可用原版插件导出");
  const service = new ScienceService(ctx, host.kaituNovelData);
  const agentRequest = (operation: string, args: Record<string, unknown>) =>
    service.request(operation, {
      ...args,
      revision: scienceView(host.kaituNovelData.workspace, String(args.project)).revision,
    });
  host.systemPrompt.section({
    name: "kaitu:science",
    order: 3110,
    interpolate: false,
    text: "作为严谨技术编辑，对照原文、世界书和可靠科学资料。客观科学常识可直接采用有出处的近似值，无需作者逐项确认；月面重力用 kaitu_sf_reference 获取 NASA 的 1.62 m/s²，不能再问作者要不要把它定成世界规则。作品明确虚构技术或特殊设施时再检查适用范围。虚构技术可作为作者前提，不因偏离现实而判错。作者已指定的当前世界书可直接调用 kaitu_sf_import_worldbook 导入，无需作者重复登记现有设定。导入卡片的 excerpt 表示有来源的世界书原文，可以直接做对照；不以未逐项点确认作为阻碍。只有模型新推断和真实互相冲突的设定需要作者取舍。先做定性判断；只有某项数值结论确实依赖缺失输入时，才标 information_missing。质量不是恒重力自由落体时间、抛体飞行时间的必需参数，不要求无关输入。只追问会改变当前结论的最少条件，不把“没登记规则版本”当成阅读校对的障碍。用 kaitu_sf_note 将有来源的定性校对保存为提示；影响级别与证据把握分开。只有适用条件完整且计算器复算支持才给 hard_rule_conflict。人物主张、梦境和比喻不升级为世界事实。不奉承，不硬挑错。只用白名单计算器；超出恒重力落体、公历日期和简单单位转换的情形留待作者核对。不要提供武器或设备设计。",
  });
  for (const [name, description, properties, required, run] of [
    [
      "kaitu_sf_import_worldbook",
      "将作者选定的世界书文件各节直接导入设定卡，传文件 path 或 documentId 即可；保留原文、出处、候选状态；不改原文件",
      { project: { type: "string" }, path: { type: "string" }, documentId: { type: "string" } },
      ["project"],
      (a: Record<string, unknown>) => agentRequest("import", a),
    ],
    [
      "kaitu_sf_reference",
      "读取已核可靠科学常量，月面重力是客观参考值，不需要作者另行设定",
      { topic: { type: "string", enum: ["moon_gravity"] } },
      ["topic"],
      (a: Record<string, unknown>) => service.request("reference", a),
    ],
    [
      "kaitu_sf_note",
      "保存场景与世界书的定性校对，有证据的提示或实际缺项；不改世界规则",
      {
        project: { type: "string" },
        input: {
          type: "object",
          properties: {
            scene: { type: "string", description: "已索引场景的准确标题、文件路径#标题或稳定 ID" },
            relatedScenes: { type: "array", items: { type: "string" } },
            type: { type: "string", enum: ["information_missing", "plausibility_note"] },
            conclusion: { type: "string" },
            missing: { type: "array", items: { type: "string" } },
            useMoonReference: { type: "boolean" },
          },
          required: ["scene", "type", "conclusion"],
          additionalProperties: false,
        },
      },
      ["project", "input"],
      (a: Record<string, unknown>) => agentRequest("note", a),
    ],
    [
      "kaitu_sf_rules",
      "读取设定卡目录与检查摘要；传 ids 可展开指定卡片的完整设定和来源",
      { project: { type: "string" }, ids: { type: "array", items: { type: "string" } } },
      ["project"],
      (a: Record<string, unknown>) => service.request("rules", a),
    ],
    [
      "kaitu_sf_check",
      "对作者明确确认的输入复算；输入需与场景、规则版本对应",
      {
        project: { type: "string" },
        input: { type: "object", additionalProperties: true },
      },
      ["project", "input"],
      (a: Record<string, unknown>) =>
        agentRequest("check", { ...a, input: { ...(a.input as object), evidenceKind: "narration" } }),
    ],
    [
      "kaitu_sf_unit",
      "支持 m/km/cm、s/min/h、m/s、km/h、m/s^2、cm/s^2 的单位与量纲检查",
      { value: { type: "number" }, from: { type: "string" }, to: { type: "string" } },
      ["value", "from", "to"],
      (a: Record<string, unknown>) => service.request("unit", a),
    ],
  ] as const) {
    host.tools.register({
      name,
      description,
      parameters: { type: "object", properties, required, additionalProperties: false },
      output: {
        schema: { type: "object", additionalProperties: true },
        render: (_a: unknown, v: unknown) => [{ type: "text", text: JSON.stringify(v) }],
      },
      async execute(args: unknown, exec: { signal: AbortSignal }) {
        exec.signal.throwIfAborted();
        return run(args as Record<string, unknown>);
      },
    });
  }
}
