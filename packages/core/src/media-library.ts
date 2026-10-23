import { existsSync, realpathSync, statSync } from "node:fs";
import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, sep } from "node:path";
import { KaituError } from "./errors.js";
import { schemas } from "./schema.js";
import { setMediaRootBinding, stateBinding } from "./state-binding.js";
import type { Workspace } from "./workspace.js";

function inside(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
}

export function mediaLibraryLocation(ws: Workspace): string {
  return stateBinding(ws.root).mediaRoot ?? join(dirname(ws.root), "kaitu-media");
}

/** The user selects an existing folder; rebinding neither moves nor imports files. */
export function selectMediaLibrary(ws: Workspace, folder: string): string {
  if (!isAbsolute(folder)) throw new KaituError("请选择媒体库文件夹", "INVALID_MEDIA_ROOT");
  const root = realpathSync(folder);
  const workspace = realpathSync(ws.root);
  if (!statSync(root).isDirectory() || inside(workspace, root) || inside(root, workspace))
    throw new KaituError("媒体库必须独立于工作区", "INVALID_MEDIA_ROOT");
  for (let parent = root; ; parent = dirname(parent)) {
    if (existsSync(join(parent, ".git")))
      throw new KaituError("请选择不在 Git 仓库内的媒体库文件夹", "INVALID_MEDIA_ROOT");
    if (parent === dirname(parent)) break;
  }
  setMediaRootBinding(ws.root, root);
  return root;
}

/** UI-only pixel read. A missing local library/image does not invalidate the referring text. */
export async function readMediaImage(ws: Workspace, reference: string) {
  if (!schemas().builtin("media-reference.schema.json")(reference))
    throw new KaituError("媒体引用路径不合法", "INVALID_MEDIA_REFERENCE");
  const types: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".heic": "image/heic",
    ".heif": "image/heif",
  };
  const contentType = types[extname(reference).toLowerCase()];
  if (!contentType) throw new KaituError("此媒体暂不能显示为图片", "UNSUPPORTED_MEDIA");
  try {
    const root = await realpath(mediaLibraryLocation(ws));
    const target = join(root, reference.slice("media:".length));
    if (!inside(root, await realpath(target)))
      throw new KaituError("媒体引用超出所选媒体库", "INVALID_MEDIA_REFERENCE");
    const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      if (!(await file.stat()).isFile()) throw new KaituError("媒体不是普通文件", "INVALID_MEDIA_REFERENCE");
      return { bytes: await file.readFile(), contentType };
    } finally {
      await file.close();
    }
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) return null;
    throw error;
  }
}
