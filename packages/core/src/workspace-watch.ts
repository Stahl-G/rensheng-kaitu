import { relative } from "node:path";
import { watch } from "chokidar";
import { ignoredWorkspaceChange } from "./workbench.js";

/** 在遍历前排除内部历史、缓存等目录；事件范围与既有工作区失效规则一致。 */
export function watchWorkspace(root: string, changed: (file: string) => void) {
  const file = (path: string) => relative(root, path).replaceAll("\\", "/");
  return (
    watch(root, {
      ignoreInitial: true,
      followSymlinks: false,
      atomic: false,
      ignored: (path) => ignoredWorkspaceChange(file(path)),
    })
      .on("all", (_event, path) => changed(file(path)))
      // 异步建立监听期间的改动也要补读，不能把首次扫描当成资料没变。
      .on("ready", () => changed(""))
  );
}
