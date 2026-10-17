import { realpathSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { assertAgentPath, assertAgentWrite } from "../core/dist/agent-file-policy.js";

export function confinedFileSystem(LocalFileSystem, FsError, root, attachments = new Set(), attachmentRoot) {
  const contains = (path) => {
    if (attachments.has(path)) return true;
    try {
      assertAgentPath(root, path);
      return true;
    } catch {
      return false;
    }
  };
  return class KaituFileSystem extends LocalFileSystem {
    get sandboxMode() {
      return "workspace-write";
    }
    async resolve(path, options) {
      const target = await super.resolve(path, options);
      if (!contains(target.displayPath) || !contains(target.targetKey))
        throw new FsError("只能访问开图资料", "FS_SANDBOX_DENIED");
      return target;
    }
    async checked(target) {
      return this.resolve(target.displayPath);
    }
    async lstat(path, options, signal) {
      await this.resolve(path, options);
      return super.lstat(path, options, signal);
    }
    async listDir(target, signal) {
      const fresh = await this.checked(target);
      signal?.throwIfAborted();
      const entries = [];
      for (const name of await readdir(fresh.targetKey)) {
        try {
          const child = await this.resolve(join(fresh.targetKey, name));
          const info = await this.stat(child, signal);
          if (info) entries.push({ name, target: child, ...info });
        } catch (error) {
          if (error.code !== "FS_SANDBOX_DENIED") throw error;
        }
      }
      return entries;
    }
    processPath(target) {
      if (!contains(target.displayPath) || !contains(target.targetKey))
        throw new FsError("只能访问开图资料", "FS_SANDBOX_DENIED");
      return super.processPath(target);
    }
    processPathFromHostPath(path) {
      try {
        const real = realpathSync(path);
        // DSH 在准备已上传附件时调用此映射；目录本身和其他程序状态不开放。
        if (attachmentRoot && real.startsWith(`${realpathSync(attachmentRoot)}/`) && statSync(real).isFile())
          attachments.add(real);
        return contains(real) ? real : undefined;
      } catch {
        return undefined;
      }
    }
    async stat(target, ...args) {
      return super.stat(await this.checked(target), ...args);
    }
    async readText(target, ...args) {
      return super.readText(await this.checked(target), ...args);
    }
    async streamText(target, ...args) {
      return super.streamText(await this.checked(target), ...args);
    }
    async readBytes(target, ...args) {
      return super.readBytes(await this.checked(target), ...args);
    }
    async readByteRange(target, ...args) {
      return super.readByteRange(await this.checked(target), ...args);
    }
    async watch(target, ...args) {
      return super.watch(await this.checked(target), ...args);
    }
    async writeText(target, ...args) {
      const checked = await this.checked(target);
      assertAgentWrite(root, checked.targetKey);
      return super.writeText(checked, ...args);
    }
    async editText(target, ...args) {
      const checked = await this.checked(target);
      assertAgentWrite(root, checked.targetKey);
      return super.editText(checked, ...args);
    }
  };
}
