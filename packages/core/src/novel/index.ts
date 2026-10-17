import fs from "node:fs";
import { isAbsolute, join, matchesGlob, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { docxText, listProjects, readProject } from "../projects.js";
import { type Workspace, stateDirectory } from "../workspace.js";
import { type Anchor, type Document, type Fact, type NovelData, type Scene, factSchema } from "./model.js";
import { changeStore, hash, id, readStore } from "./store.js";
export type * from "./model.js";

export const novelContractVersion = 1;
const inside = (root: string, path: string) => path === root || path.startsWith(`${root}${sep}`);
const initial = (): NovelData => {
  throw new Error("请先关联小说目录");
};
export function novelFile(ws: Workspace, project: string) {
  readProject(ws, project);
  return join(stateDirectory(ws.root), "novels", project, "novel.json");
}
export function readNovel(ws: Workspace, project: string) {
  const result = readStore(novelFile(ws, project), initial);
  if (result.value.schemaVersion !== 1) throw new Error("小说资料版本暂不支持，请保留原文件");
  return result;
}
export function novelProjects(ws: Workspace) {
  return listProjects(ws).map((project) => {
    const file = novelFile(ws, project.slug);
    const novel = fs.existsSync(file) ? readNovel(ws, project.slug).value : null;
    return {
      slug: project.slug,
      title: project.title,
      linked: !!novel,
      pinned: novel?.pinned ?? false,
      words: novel?.scenes.reduce((sum, scene) => sum + scene.words, 0) ?? 0,
      scenes: novel?.scenes.length ?? 0,
    };
  });
}
export function connectNovel(ws: Workspace, input: unknown) {
  const options = z
    .object({
      project: z.string(),
      sourceRoot: z.string(),
      mode: z.enum(["files", "headings"]),
      include: z.array(z.string()).default(["**/*.md"]),
      exclude: z.array(z.string()).default(["**/.*/**"]),
      preview: z.boolean().default(true),
    })
    .parse(input);
  const project = readProject(ws, options.project);
  const linked = project.data.links.filter((link) => link.role === "manuscript" || link.role === "folder");
  if (!isAbsolute(options.sourceRoot)) throw new Error("请选择绝对目录路径");
  const root = fs.realpathSync(options.sourceRoot);
  if (!linked.some((link) => fs.existsSync(link.path) && fs.realpathSync(link.path) === root))
    throw new Error("请先在现有项目中关联该稿件目录");
  const managed = resolve(join(stateDirectory(ws.root), "novels", options.project));
  if (!isAbsolute(managed) || inside(root, managed) || inside(managed, root))
    throw new Error("资料目录需要与正文目录分开");
  const file = novelFile(ws, options.project);
  if (fs.existsSync(file)) throw new Error("作品已关联，使用刷新更新索引");
  const data: NovelData = {
    schemaVersion: 1,
    project: options.project,
    sourceRoot: root,
    managedRoot: managed,
    mode: options.mode,
    include: options.include,
    exclude: options.exclude,
    pinned: true,
    documents: [],
    scenes: [],
    issues: [],
    indexedAt: null,
    facts: [],
    proposals: [],
    sessions: [],
  };
  scan(data);
  if (!options.preview)
    changeStore(
      file,
      () => data,
      hash(""),
      () => {},
    );
  return data;
}
function sourcePath(data: Pick<NovelData, "sourceRoot" | "include" | "exclude">, path: string) {
  const target = resolve(data.sourceRoot, path);
  if (!inside(data.sourceRoot, target)) throw new Error("引用超出作品目录");
  const parts = relative(data.sourceRoot, target).split(sep).filter(Boolean);
  let current = data.sourceRoot;
  if (fs.realpathSync(current) !== current) throw new Error("作品目录已移动，请重新关联");
  for (const part of parts) {
    current = join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error("作品索引不跟随符号链接");
  }
  if (
    data.exclude.some((glob) => matchesGlob(path, glob)) ||
    !data.include.some((glob) => matchesGlob(path, glob))
  )
    throw new Error("引用已在读取范围之外");
  return target;
}
function readSource(data: Pick<NovelData, "sourceRoot" | "include" | "exclude">, path: string) {
  const target = sourcePath(data, path);
  const stat = fs.statSync(target);
  if (stat.size > 1024 * 1024) throw new Error("文件超过 1 MB，已跳过");
  const bytes = fs.readFileSync(target);
  const text = /\.docx$/i.test(path)
    ? docxText(bytes)
    : new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return { text, hash: hash(bytes), modified: stat.mtime.toISOString(), identity: `${stat.dev}:${stat.ino}` };
}
export function countNovelText(text: string) {
  const plain = text
    .replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "")
    .replace(/^\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s*\1\s*$/gm, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(/^[\s#>*+\-\d.)]+/gm, "")
    .replace(/[`*_~]/g, "");
  return {
    words: (plain.match(/\p{Script=Han}|[\p{L}\p{N}]+/gu) ?? []).length,
    characters: [...plain.replace(/\s/g, "")].length,
  };
}
function scan(data: NovelData) {
  const documents: Document[] = [];
  const scenes: Scene[] = [];
  const issues: string[] = [];
  const paths: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(join(data.sourceRoot, dir), { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.name.startsWith(".") || data.exclude.some((glob) => matchesGlob(path, glob))) continue;
      const relevant = data.include.some((glob) => {
        const fixed = glob.split(/[*?{\[]/, 1)[0] ?? "";
        return !fixed || fixed === path || fixed.startsWith(`${path}${sep}`) || path.startsWith(fixed);
      });
      if (!relevant) continue;
      if (entry.isSymbolicLink()) {
        issues.push(`${path}：已跳过符号链接`);
        continue;
      }
      if (entry.isDirectory()) walk(path);
      else if (
        entry.isFile() &&
        /\.(md|txt|docx)$/i.test(path) &&
        data.include.some((glob) => matchesGlob(path, glob))
      )
        paths.push(path);
    }
  };
  walk("");
  for (const path of paths.sort()) {
    try {
      const source = readSource(data, path);
      const samePath = data.documents.find((doc) => doc.path === path);
      const candidates = data.documents.filter(
        (doc) => doc.identity === source.identity || doc.hash === source.hash,
      );
      const previous = samePath ?? (candidates.length === 1 ? candidates[0] : undefined);
      if (!samePath && candidates.length > 1) issues.push(`${path}：文件关联有多个候选，请核对`);
      const documentId = previous?.id ?? id();
      documents.push({
        id: documentId,
        path,
        hash: source.hash,
        identity: source.identity,
        modified: source.modified,
      });
      const body = source.text.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, (match) =>
        "\n".repeat(match.split("\n").length - 1),
      );
      // Ignore fenced code when recognizing scene headings, retaining line positions.
      let fence = "";
      const masked = body
        .split("\n")
        .map((line) => {
          const mark = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
          if (mark) {
            fence = fence ? "" : (mark[0] ?? "");
            return "";
          }
          return fence ? "" : line;
        })
        .join("\n");
      const headings = [...masked.matchAll(/^#{1,6}\s+(.+)$/gm)];
      const starts =
        data.mode === "headings" && headings.length
          ? headings.map((match) => ({ title: (match[1] as string).trim(), offset: match.index }))
          : [{ title: headings[0]?.[1]?.trim() ?? path.replace(/\.(md|txt|docx)$/i, ""), offset: 0 }];
      const first = starts[0];
      if (data.mode === "headings" && first && first.offset > 0 && body.slice(0, first.offset).trim())
        starts.unshift({ title: path.replace(/\.(md|txt|docx)$/i, ""), offset: 0 });
      const occurrences = new Map<string, number>();
      for (const [i, start] of starts.entries()) {
        const n = occurrences.get(start.title) ?? 0;
        occurrences.set(start.title, n + 1);
        const heading = `${start.title}#${n}`;
        const old = data.scenes.find(
          (scene) => scene.documentId === documentId && (data.mode === "files" || scene.heading === heading),
        );
        if (n) issues.push(`${path}：重复标题「${start.title}」，按出现位置区分`);
        scenes.push({
          id: old?.id ?? id(),
          documentId,
          path,
          title: start.title,
          heading,
          line: body.slice(0, start.offset).split("\n").length,
          fileHash: source.hash,
          ...countNovelText(body.slice(start.offset, starts[i + 1]?.offset)),
          writtenAt: source.modified,
          order: old?.order ?? data.scenes.length + scenes.length,
          status: old?.status ?? "planned",
          worldTime: old?.worldTime ?? null,
        });
      }
      if (fs.statSync(sourcePath(data, path)).mtime.toISOString() !== source.modified)
        throw new Error("扫描期间有修改，请重新刷新");
    } catch (error) {
      issues.push(`${path}：${(error as Error).message}`);
    }
  }
  for (const old of data.scenes)
    if (!scenes.some((scene) => scene.id === old.id))
      issues.push(`${old.path} / ${old.title}：原场景已失联，保留资料引用待核对`);
  data.documents = documents;
  data.scenes = scenes.sort((a, b) => a.order - b.order);
  data.issues = issues;
  data.indexedAt = new Date().toISOString();
}
export function validateAnchor(data: NovelData, anchor: Anchor) {
  try {
    const source = readSource(data, anchor.path);
    return (
      source.hash === anchor.fileHash &&
      hash(anchor.quote) === anchor.quoteHash &&
      source.text.includes(anchor.quote) &&
      data.documents.some((doc) => doc.id === anchor.documentId && doc.path === anchor.path)
    );
  } catch {
    return false;
  }
}
export function novelScene(ws: Workspace, project: string, sceneId: string) {
  const { value: data } = readNovel(ws, project);
  let scene = data.scenes.find((item) => item.id === sceneId);
  if (!scene) {
    const parts = sceneId.split("#");
    const title = parts.at(-1) ?? sceneId;
    const owner = parts.length > 1 ? parts.slice(0, -1).join("#") : null;
    const candidates = data.scenes.filter(
      (item) =>
        (item.title === title || item.path === sceneId) &&
        (!owner ||
          item.path === owner ||
          data.scenes.some((parent) => parent.documentId === item.documentId && parent.title === owner)),
    );
    if (candidates.length === 1) scene = candidates[0];
    else if (candidates.length > 1) throw new Error("有同名场景，请用文件路径#标题指定");
  }
  if (!scene) throw new Error("未找到场景，请先索引正文文件；scene 可填准确标题或稳定 ID");
  const source = readSource(data, scene.path);
  if (source.hash !== scene.fileHash) throw new Error("正文已变化，请先刷新索引");
  const next = data.scenes
    .filter((item) => item.path === scene.path && item.line > scene.line)
    .sort((a, b) => a.line - b.line)[0];
  const text = source.text
    .split("\n")
    .slice(scene.line - 1, next ? next.line - 1 : undefined)
    .join("\n");
  return {
    scene,
    text,
    path: join(data.sourceRoot, scene.path),
    anchor: {
      documentId: scene.documentId,
      path: scene.path,
      heading: scene.heading,
      line: scene.line,
      quote: text,
      quoteHash: hash(text),
      fileHash: source.hash,
    } satisfies Anchor,
  };
}
export function novelView(ws: Workspace, project: string) {
  const { value: data, revision } = readNovel(ws, project);
  return {
    data,
    revision,
    staleFacts: data.facts
      .filter((fact) => !fact.sources.every((source) => validateAnchor(data, source)))
      .map((fact) => fact.id),
    staleProposals: data.proposals
      .filter((p) => !p.after.sources.every((source) => validateAnchor(data, source)))
      .map((p) => p.id),
  };
}
const canonRevision = (data: NovelData) => hash(JSON.stringify(data.facts));
export function proposeNovelFact(
  ws: Workspace,
  project: string,
  revision: string,
  fact: unknown,
  actor: "agent" | "author",
) {
  return changeStore(novelFile(ws, project), initial, revision, (data) => {
    const after = factSchema.parse(fact);
    if (!after.sources.every((anchor) => validateAnchor(data, anchor)))
      throw new Error("来源已变化，请刷新后重新提案");
    if (actor === "agent" && after.canon === "confirmed")
      throw new Error("模型提案使用待定或 AI 推测，确认由作者完成");
    data.proposals.push({
      id: id(),
      baseCanon: canonRevision(data),
      before: data.facts.find((item) => item.id === after.id) ?? null,
      after,
      actor,
      created: new Date().toISOString(),
      state: "pending",
    });
  });
}
export function editNovel(ws: Workspace, project: string, revision: string, input: unknown) {
  const command = z
    .discriminatedUnion("type", [
      z.object({ type: z.literal("refresh") }),
      z.object({ type: z.literal("mode"), mode: z.enum(["read_only", "writing"]) }),
      z.object({ type: z.literal("include"), paths: z.array(z.string()).min(1) }),
      z.object({ type: z.literal("pin"), value: z.boolean() }),
      z.object({
        type: z.literal("scene"),
        id: z.string(),
        status: z.enum(["planned", "draft", "done"]),
        order: z.number(),
        worldTime: z.string().nullable(),
      }),
      z.object({
        type: z.literal("session"),
        scene: z.string(),
        completed: z.string().min(1),
        next: z.string(),
      }),
      z.object({
        type: z.literal("decide"),
        ids: z.array(z.string()).min(1),
        decision: z.enum(["approve", "reject", "undo"]),
      }),
    ])
    .parse(input);
  return changeStore(novelFile(ws, project), initial, revision, (data) => {
    if (command.type === "refresh") scan(data);
    if (command.type === "mode") data.writingMode = command.mode;
    if (command.type === "include") {
      data.include = [...new Set([...data.include, ...command.paths])];
      scan(data);
    }
    if (command.type === "pin") data.pinned = command.value;
    if (command.type === "scene") {
      const scene = data.scenes.find((item) => item.id === command.id);
      if (!scene) throw new Error("找不到场景");
      Object.assign(scene, { status: command.status, order: command.order, worldTime: command.worldTime });
      data.scenes.sort((a, b) => a.order - b.order);
    }
    if (command.type === "session") {
      if (!data.scenes.some((scene) => scene.id === command.scene)) throw new Error("找不到场景");
      data.sessions.push({ ...command, id: id(), savedAt: new Date().toISOString() });
    }
    if (command.type === "decide") {
      const base = canonRevision(data);
      for (const proposalId of command.ids) {
        const proposal = data.proposals.find((p) => p.id === proposalId);
        if (!proposal) throw new Error("找不到提案");
        if (command.decision === "reject" && proposal.state === "pending") {
          proposal.state = "rejected";
          continue;
        }
        if (command.decision === "approve") {
          if (proposal.state !== "pending" || proposal.baseCanon !== base)
            throw new Error("资料已有更新，请核对后重新提案");
          if (!proposal.after.sources.every((anchor) => validateAnchor(data, anchor)))
            throw new Error("正文引用已陈旧，不能批准");
          data.facts = data.facts.filter((fact) => fact.id !== proposal.after.id);
          const fact: Fact = { ...proposal.after };
          if (fact.canon === "confirmed") fact.confirmedAt = new Date().toISOString();
          data.facts.push(fact);
          proposal.after = fact;
          proposal.state = "approved";
          proposal.approvedAt = new Date().toISOString();
        } else if (command.decision === "undo") {
          if (
            proposal.state !== "approved" ||
            JSON.stringify(data.facts.find((f) => f.id === proposal.after.id)) !==
              JSON.stringify(proposal.after)
          )
            throw new Error("资料有后续修改，请先核对当前值再撤销");
          data.facts = data.facts.filter((f) => f.id !== proposal.after.id);
          if (proposal.before) data.facts.push(proposal.before);
          proposal.state = "undone";
        }
      }
    }
  });
}

function linkedSource(ws: Workspace, project: string): Pick<NovelData, "sourceRoot" | "include" | "exclude"> {
  const file = novelFile(ws, project);
  if (fs.existsSync(file)) return readNovel(ws, project).value;
  const root = readProject(ws, project).data.links.find(
    (link) => link.role === "manuscript" || link.role === "folder",
  )?.path;
  if (!root) throw new Error("项目尚未关联作品目录");
  return { sourceRoot: fs.realpathSync(root), include: ["**/*.md", "**/*.txt", "**/*.docx"], exclude: [] };
}
export function connectNovelAutomatically(ws: Workspace, project: string) {
  if (fs.existsSync(novelFile(ws, project))) return readNovel(ws, project).value;
  const root = linkedSource(ws, project).sourceRoot;
  return connectNovel(ws, {
    project,
    sourceRoot: root,
    mode: "headings",
    include: ["**/*.md", "**/*.txt", "**/*.docx"],
    exclude: ["archived/**", "archive/**", "08_制作资源/**", "**/node_modules/**"],
    preview: false,
  });
}

export function saveNovelDraft(ws: Workspace, project: string, revision: string, input: unknown) {
  const args = z
    .object({
      title: z.string().min(1),
      text: z.string().min(1),
      scene: z.string(),
      styleSources: z.array(z.string()).default([]),
    })
    .parse(input);
  return changeStore(novelFile(ws, project), initial, revision, (data) => {
    if (data.writingMode !== "writing") throw new Error("作品当前为只读模式，可切换到续写模式");
    const source = novelScene(ws, project, args.scene);
    const draft = {
      ...args,
      scene: source.scene.id,
      id: id(),
      created: new Date().toISOString(),
      sourceHash: source.anchor.fileHash,
    };
    data.drafts ??= [];
    data.drafts.push(draft);
    return { id: draft.id, title: draft.title };
  });
}
export function applyNovelDraft(
  ws: Workspace,
  project: string,
  revision: string,
  draftId: string,
  operation: "append" | "undo",
) {
  return changeStore(novelFile(ws, project), initial, revision, (data) => {
    if (data.writingMode !== "writing") throw new Error("作品当前为只读模式");
    const draft = data.drafts?.find((item) => item.id === draftId);
    if (!draft) throw new Error("找不到候选稿");
    const scene = novelScene(ws, project, draft.scene).scene;
    if (!/\.(md|txt)$/i.test(scene.path))
      throw new Error("DOCX 保留原文件，请导出候选 Markdown 交给原编辑器合稿");
    const path = sourcePath(data, scene.path);
    const before = fs.readFileSync(path, "utf8");
    const expected = operation === "undo" ? draft.applied?.afterHash : draft.sourceHash;
    if (hash(before) !== expected) throw new Error("正文已有修改，请先核对当前稿再合入或撤销");
    if (operation === "append" && draft.applied) throw new Error("该候选稿已经合入");
    if (operation === "undo" && !draft.applied) throw new Error("该候选稿尚未合入");
    const text =
      operation === "append" ? `${before}\n\n${draft.text}\n` : (draft.applied as { before: string }).before;
    if (operation === "append") {
      fs.mkdirSync(join(data.managedRoot, "source-backups"), { recursive: true });
      fs.writeFileSync(
        join(data.managedRoot, "source-backups", `${draft.id}.json`),
        JSON.stringify({ path: scene.path, hash: hash(before), text: before }),
        { mode: 0o600 },
      );
    }
    const temporary = `${path}.kaitu-${id()}.tmp`;
    fs.writeFileSync(temporary, text);
    fs.renameSync(temporary, path);
    if (operation === "append") draft.applied = { path: scene.path, before, afterHash: hash(text) };
    else draft.applied = undefined;
    scan(data);
    return { path: scene.path, operation };
  });
}
