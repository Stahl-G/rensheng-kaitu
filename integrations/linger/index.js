import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const bridge = fileURLToPath(new URL("./bridge.py", import.meta.url));

export const name = "kaitu-linger-inbox";
export const inject = ["commands"];

export function apply(ctx) {
  let active;
  ctx.effect(() => () => active?.abort());
  ctx.commands.register({
    name: "linger-inbox",
    description: "在本机预览一份 Linger Markdown 并选择开图收件箱",
    recordInput: false,
    async handler({ rawInput, signal }) {
      if (rawInput.trim()) return { kind: "error", text: "请只输入 /linger-inbox，在本机窗口选择文件。" };
      if (process.platform === "win32")
        return { kind: "error", text: "收件桥需要 macOS 或 Linux 图形桌面。" };
      if (active) return { kind: "error", text: "本机已有预览窗口。" };
      active = new AbortController();
      try {
        const result = await run("python3", ["-I", "-B", bridge, "review"], {
          signal: AbortSignal.any([signal, active.signal]),
        });
        return {
          kind: "success",
          text: result.stdout.trim() === "queued" ? "已投递开图收件箱。" : "已取消。",
        };
      } catch {
        return { kind: "error", text: "本机预览未完成。请检查图形桌面及 Python 3 的 Tk 支持。" };
      } finally {
        active = undefined;
      }
    },
  });
}
