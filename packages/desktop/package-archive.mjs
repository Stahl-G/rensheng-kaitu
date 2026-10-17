import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const directory = dirname(fileURLToPath(import.meta.url));
export async function rewriteArchive({ destination, archive, asar, asarPath, changes }) {
  const extracted = join(dirname(destination), "extracted");
  asar.extractAll(archive, extracted);
  const unpack = [];
  const unpackDotFiles = [];
  const unpackDir = [];
  const escapeGlob = (path) => path.replace(/[\\*?[\]{}()!+@]/g, "\\$&");
  const visit = (entry, path = "", parentUnpacked = false) => {
    const unpacked = parentUnpacked || entry.unpacked === true;
    if (entry.files) {
      if (entry.unpacked) unpackDir.push(escapeGlob(path));
      const start = unpack.length;
      const children = Object.entries(entry.files).map(([name, child]) =>
        visit(child, path ? `${path}/${name}` : name, unpacked),
      );
      const allUnpacked = children.length > 0 && children.every(Boolean);
      // 将整棵 unpacked 子树合并为一个 glob，避免为每个文件展开巨大匹配式。
      if (path && allUnpacked) {
        unpack.splice(
          start,
          unpack.length - start,
          `${escapeGlob(join(extracted, path).replaceAll("\\", "/"))}/**`,
        );
      }
      return allUnpacked;
    }
    if (unpacked) {
      unpack.push(escapeGlob(join(extracted, path).replaceAll("\\", "/")));
      // asar 的 unpack glob 默认不匹配点文件，须为这些原件保留精确路径。
      if (path.split("/").some((part) => part.startsWith("."))) {
        unpackDotFiles.push(escapeGlob(join(extracted, path).replaceAll("\\", "/")));
      }
      // extractAll 仅恢复 header 的 executable 标记；unpacked 原件的权限来自磁盘。
      if (!entry.link) chmodSync(join(extracted, path), statSync(join(`${archive}.unpacked`, path)).mode);
    }
    return unpacked;
  };
  visit(asar.getRawHeader(archive).header);
  for (const [path, body] of changes) {
    mkdirSync(dirname(join(extracted, path)), { recursive: true });
    writeFileSync(join(extracted, path), body);
  }
  const pattern = (paths) => (paths.length > 1 ? `{${paths.join(",")}}` : paths[0]);
  // asar 3.4.1 的 Promise 在输出流 finish 前返回；子进程退出后才复制归档，确保尾部落盘。
  execFileSync(
    process.execPath,
    [
      join(directory, "repack-asar.mjs"),
      asarPath,
      extracted,
      destination,
      JSON.stringify({ unpack: pattern([...unpack, ...unpackDotFiles]), unpackDir: pattern(unpackDir) }),
    ],
    { stdio: "inherit" },
  );
}
