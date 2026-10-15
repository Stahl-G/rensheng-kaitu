import { readdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { type Workspace, parseFrontmatter } from "@kaitu/core";
import type {
  SkillCandidate,
  SkillContext,
  SkillDefinition,
  SkillLookupOptions,
  SkillProvider,
  SkillProviderControl,
} from "./dsh.js";

export const skillToolGuide = `在 dsh 中执行开图技能时，所有路径都相对于开图工作区，与会话 cwd 无关。
技能中的 CLI 步骤用下列开图工具完成，无需运行 shell、安装 CLI、注册 MCP 或另开 kaitu ui。
- status / record schema → kaitu_status；record add → kaitu_add_record；地点经历 → kaitu_add_experience。
- record list / update / delete → kaitu_records；chats search → kaitu_search_chats。
- 读取、列目录、写 Markdown/JSON → kaitu_workspace（read/list/write）；创建模块时一次提交 module.json、STATUS.md 和 schema。
- validate → kaitu_validate；snapshot / agents-md → kaitu_workspace（snapshot/agents-md）；history → kaitu_history；确认恢复 → kaitu_restore。
- memory list/search/add/update/rm/import → kaitu_memory；批量 import 先 dryRun，用户确认后使用完全相同的候选。
- task add/list/done/cancel → kaitu_tasks；inbox notes/done/process → kaitu_inbox。
- project list/new/show/link/set/log/sync → kaitu_projects；项目内文件用 project-read/project-write，支持仅本机项目。
- import apple-health/nut-ai/ics/chatgpt-conversations → kaitu_import，先 dryRun，再确认执行；文件用用户指定的本机绝对路径或工作区内相对路径。
- photo add/list/rm → kaitu_photos；头像用「关于我」的上传入口。
- drive status/enable/disable → kaitu_drive。迁移后工具和技能自动切换到新工作区。
- 每日整理按 ORGANIZER.md 执行，归档交接用 kaitu_workspace archive-handoffs。
- kaitu ui → dsh 侧栏「开图」；不要求用户另开程序。批量导入、规则与目标修改仍须用户确认。
首次了解用户时先读 AGENTS.md，再按其读取顺序读取档案、规则、NOW.md 和模块状态。`;

function boolean(data: Record<string, unknown>, key: string): boolean | undefined {
  if (!Object.hasOwn(data, key)) return undefined;
  const value = data[key];
  if (typeof value === "boolean") return value;
  if (
    [1, "1", "true", "yes", "on"].includes(
      typeof value === "string" ? value.toLowerCase() : (value as number),
    )
  )
    return true;
  if (
    [0, "0", "false", "no", "off"].includes(
      typeof value === "string" ? value.toLowerCase() : (value as number),
    )
  )
    return false;
  throw new Error(`${key} 必须是布尔值`);
}

/** 固定读开图工作区，不采用 DSH 的会话 cwd。正文每次重新读，目录变化使注册表缓存失效。 */
export class KaituSkillProvider implements SkillProvider {
  readonly name = "kaitu-workspace";

  constructor(private readonly workspace: Workspace) {}

  private load(file: string): SkillDefinition | undefined {
    if (!this.workspace.exists(file)) return undefined;
    const { data, body } = parseFrontmatter(this.workspace.readText(file));
    if (
      typeof data.name !== "string" ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.name) ||
      typeof data.description !== "string" ||
      !data.description.trim()
    )
      throw new Error("技能需要合法的 name 和 description");
    for (const key of ["disableModelInvocation", "modelInvocable", "userInvocable"]) {
      if (Object.hasOwn(data, key)) throw new Error(`不支持 ${key}，请使用标准 frontmatter 字段`);
    }
    const path = this.workspace.resolve(file);
    return {
      name: data.name,
      description: data.description,
      ...(typeof data.whenToUse === "string" ? { whenToUse: data.whenToUse } : {}),
      invocation: {
        modelInvocable: boolean(data, "disable-model-invocation") !== true,
        userInvocable: boolean(data, "user-invocable") !== false,
      },
      source: "kaitu",
      provider: this.name,
      path,
      resourceBase: { kind: "directory", path: dirname(path) },
      ...(data.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata)
        ? { metadata: data.metadata as Record<string, unknown> }
        : {}),
      content: `${skillToolGuide}\n\n${body.trim()}`,
    };
  }

  async list(options: SkillLookupOptions): Promise<SkillCandidate[]> {
    options.signal?.throwIfAborted();
    if (!this.workspace.exists(".agents/skills")) return [];
    const result: SkillCandidate[] = [];
    for (const entry of readdirSync(this.workspace.resolve(".agents/skills"), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const file = `.agents/skills/${entry.name}/SKILL.md`;
      try {
        const skill = this.load(file);
        if (skill) {
          const { content: _content, ...summary } = skill;
          result.push({ ...summary, rank: 300, locator: file });
        }
      } catch (error) {
        console.warn(`[kaitu] 忽略技能 ${file}：${(error as Error).message}`);
      }
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }

  async get(candidate: SkillCandidate, options: SkillLookupOptions): Promise<SkillDefinition | undefined> {
    options.signal?.throwIfAborted();
    if (!/^\.agents\/skills\/[^/]+\/SKILL\.md$/.test(candidate.locator)) return undefined;
    const skill = this.load(candidate.locator);
    return skill?.name === candidate.name ? skill : undefined;
  }

  watch(control: SkillProviderControl): void {
    const stamp = () => {
      if (!this.workspace.exists(".agents/skills")) return "";
      return readdirSync(this.workspace.resolve(".agents/skills"))
        .sort()
        .map((name) => {
          const file = `.agents/skills/${name}/SKILL.md`;
          if (!this.workspace.exists(file)) return name;
          const stat = statSync(this.workspace.resolve(file));
          return `${name}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`;
        })
        .join("\n");
    };
    let previous = stamp();
    const timer = setInterval(() => {
      try {
        const next = stamp();
        if (next !== previous) {
          previous = next;
          control.invalidate();
        }
      } catch (error) {
        console.warn(`[kaitu] 刷新技能目录失败：${(error as Error).message}`);
      }
    }, 1000);
    timer.unref();
    control.signal.addEventListener("abort", () => clearInterval(timer), { once: true });
  }
}

export function registerSkills(ctx: SkillContext, ws: Workspace): void {
  ctx.skills.registerProvider((control) => {
    const provider = new KaituSkillProvider(ws);
    provider.watch(control);
    return provider;
  });
}
