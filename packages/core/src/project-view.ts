import { KaituError } from "./errors.js";
import { projectDirectory } from "./projects.js";
import { schemas } from "./schema.js";
import type { Workspace } from "./workspace.js";

type ItemSource = { source?: string };
type BlockBase = { id: string; title?: string };
export type ProjectViewBlock = BlockBase &
  (
    | { type: "progress"; source: string }
    | { type: "curve"; source: string; kind: "words" | "commits" }
    | { type: "checklist"; items: (ItemSource & { text: string; checked: boolean })[] }
    | { type: "milestones"; items: (ItemSource & { title: string; date?: string; done: boolean })[] }
    | { type: "links"; items: { title: string; url: string }[] }
    | { type: "note"; text: string; source?: string }
    | {
        type: "table";
        columns: { key: string; title: string }[];
        rows: Record<string, string | number>[];
        source?: string;
      }
  );
export type ProjectView = { title?: string } & ({ blocks: ProjectViewBlock[] } | { html: string });
type ViewResult = { view: ProjectView | null; viewError: string | null };

/** 只接受本项目目录内的相对路径，或项目自身的 progress / metrics。 */
function validSource(source: string): boolean {
  if (source === "progress" || source === "metrics") return true;
  const file = source.split("#")[0] ?? "";
  return (
    !!file &&
    !file.includes("\\") &&
    !file.split("/").some((part) => !part || part === ".." || part.startsWith("."))
  );
}

function validReferences(block: ProjectViewBlock): boolean {
  const sources: string[] = [];
  if ("source" in block && block.source) sources.push(block.source);
  if (block.type === "checklist" || block.type === "milestones")
    for (const item of block.items) if (item.source) sources.push(item.source);
  return sources.every(validSource);
}

export function readProjectView(ws: Workspace, slug: string): ViewResult {
  const file = `${projectDirectory(ws, slug)}/view.json`;
  if (!ws.exists(file)) return { view: null, viewError: null };
  try {
    const view = ws.readJson<ProjectView>(file);
    const registry = schemas();
    if (!registry.builtin("project-view.schema.json#/$defs/envelope")(view))
      throw new KaituError("项目视图格式不合法", "INVALID_DOCUMENT");
    if ("blocks" in view) {
      const block = registry.builtin("project-view.schema.json#/$defs/block");
      view.blocks = view.blocks.filter((item) => block(item) && validReferences(item));
    }
    return { view, viewError: null };
  } catch (error) {
    if (
      !(error instanceof SyntaxError) &&
      !(error instanceof KaituError && error.code === "INVALID_DOCUMENT")
    )
      throw error;
    return { view: null, viewError: "项目视图无法解析，请让 AI 修正 view.json。" };
  }
}

export function writeProjectView(ws: Workspace, slug: string, input: unknown) {
  const dir = projectDirectory(ws, slug);
  if (!ws.exists(`${dir}/STATUS.md`)) throw new KaituError("找不到项目", "NOT_FOUND");
  const validate = schemas().builtin("project-view.schema.json");
  if (!validate(input)) {
    const paths = [...new Set((validate.errors ?? []).map((error) => error.instancePath || "/"))];
    throw new KaituError(`项目视图格式不合法，请检查字段：${paths.join("、")}`, "BAD_ARGS");
  }
  const view = input as ProjectView;
  if ("blocks" in view && !view.blocks.every(validReferences))
    throw new KaituError("项目视图引用不存在或超出本项目，请检查 source", "BAD_ARGS");
  ws.writeJson(`${dir}/view.json`, view);
  return { file: `${dir}/view.json` };
}
