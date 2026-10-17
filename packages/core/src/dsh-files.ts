import { resolve } from "node:path";
import {
  DEFAULT_FILE_SEARCH_EXCLUDED_DIRECTORIES,
  WorkspaceFileSearch,
} from "@deepseek-ai/dsh-file-reference-local/search";
import { openNativeAssociatedPath, revealNativePath } from "@deepseek-ai/dsh-native-command";
import { assertAgentPath } from "./agent-file-policy.js";
import { listProjects } from "./projects.js";
import type { Workspace } from "./workspace.js";

/** DSH 的文件候选与原生打开能力，服务于用户主动操作。 */
export interface DshFiles {
  invalidate(): void;
  dispose(): void;
  find(query: string): Promise<{ path: string; kind: "file" | "directory" }[]>;
  open(path: string, action?: "open" | "reveal"): Promise<{ opened: boolean }>;
}
export function dshFiles(ws: Workspace): DshFiles {
  let root = "";
  let search: WorkspaceFileSearch | undefined;
  return {
    invalidate() {
      search?.invalidate();
    },
    dispose() {
      search?.dispose();
    },
    async find(query: string) {
      if (root !== ws.root) {
        search?.dispose();
        root = ws.root;
        search = new WorkspaceFileSearch(root, {
          maxResults: 20,
          maxEntries: 50000,
          excludedDirectories: [...DEFAULT_FILE_SEARCH_EXCLUDED_DIRECTORIES, ".kaitu"],
        });
      }
      const rows = await (search as WorkspaceFileSearch).list(query, AbortSignal.timeout(10000));
      return rows.filter((row) => {
        try {
          assertAgentPath(root, row.path);
          return true;
        } catch {
          return false;
        }
      });
    },
    async open(path: string, action: "open" | "reveal" = "open") {
      const target = resolve(ws.root, path);
      const linked = listProjects(ws).some((project) =>
        project.links.some((link) => resolve(link.path) === target),
      );
      if (!linked) assertAgentPath(ws.root, target);
      await (action === "reveal" ? revealNativePath : openNativeAssociatedPath)(
        target,
        AbortSignal.timeout(10000),
      );
      return { opened: true };
    },
  };
}
