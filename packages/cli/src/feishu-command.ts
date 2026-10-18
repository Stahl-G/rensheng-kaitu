import { resolve } from "node:path";
import { parseArgs } from "node:util";

async function run() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(3),
    allowPositionals: true,
    options: {
      dir: { type: "string" },
      folder: { type: "string" },
      cli: { type: "string" },
      "timeout-ms": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.log(`kaitu feishu import --dir <工作区/workspace> --folder <folder_token> --cli <绝对路径/absolute CLI path> [--timeout-ms 30000]
手动导入直接 docx 子项到原文 / Manually import direct docx children as inbox notes.
仅 lark-cli 1.0.98；先由用户安装和认证 / User installs and authenticates lark-cli 1.0.98 first.
Ctrl-C 取消；无轮询和重试 / Ctrl-C cancels; no polling or retries.`);
    return;
  }
  if (positionals.length !== 1 || positionals[0] !== "import" || !values.dir || !values.folder || !values.cli)
    throw new Error(
      "使用 / Usage: kaitu feishu import --dir <workspace> --folder <token> --cli <absolute path>",
    );
  const abort = new AbortController();
  const cancel = () => abort.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  console.error("正在读取飞书文件夹 / Reading Feishu folder…");
  try {
    const { importFeishuFolder } = await import("./feishu.js");
    console.log(
      JSON.stringify(
        await importFeishuFolder({
          root: resolve(values.dir),
          folder: values.folder,
          cli: values.cli,
          timeoutMs: values["timeout-ms"] === undefined ? undefined : Number(values["timeout-ms"]),
          signal: abort.signal,
          progress: (requests) => console.error(`飞书只读调用 / Feishu read calls: ${requests}`),
        }),
        null,
        2,
      ),
    );
  } finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
}
run().catch((error: Error & { code?: string; report?: unknown }) => {
  console.error(JSON.stringify({ error: error.message, code: error.code, report: error.report }));
  process.exitCode = 2;
});
