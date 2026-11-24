import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { openRelay } from "./files.js";
import { pullReplies } from "./pull.js";
import { previewSnapshot, publishSnapshot } from "./snapshot.js";

const usage = [
  "百度网盘接力 · Baidu Netdisk relay",
  "node packages/core/dist/baidu-netdisk/cli.js <preview|publish|pull> --dir <workspace> --relay <folder>",
  "preview / publish: --project <slug> [--txt] [--include-log]",
  "publish: 核对预览后输入 y；脚本传 --approve <preview-hash> / confirm the preview or supply its hash.",
  "pull: 将完整回件送进本机开图收件箱 / queue complete replies for local review.",
  "也可设置 / paths can also be set via KAITU_BAIDU_WORKSPACE, KAITU_BAIDU_RELAY.",
].join("\n");

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      dir: { type: "string" },
      relay: { type: "string" },
      project: { type: "string" },
      approve: { type: "string" },
      txt: { type: "boolean" },
      "include-log": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.log(usage);
    return;
  }
  const dir = values.dir ?? process.env.KAITU_BAIDU_WORKSPACE;
  const sync = values.relay ?? process.env.KAITU_BAIDU_RELAY;
  const command = positionals[0];
  if (!dir || !sync || positionals.length !== 1 || !["preview", "publish", "pull"].includes(command ?? ""))
    throw new Error(usage);
  const relay = openRelay(dir, sync);
  if (command === "pull") {
    if (values.project || values.approve || values.txt || values["include-log"]) throw new Error(usage);
    const result = pullReplies(relay);
    console.log(JSON.stringify(result, null, 2));
    if (result.issues.length) process.exitCode = 1;
    return;
  }
  if (!values.project || (command === "preview" && values.approve)) throw new Error(usage);
  const format = values.txt ? "txt" : "md";
  const includeLog = values["include-log"] ?? false;
  let approval = values.approve;
  if (command === "preview" || !approval) {
    const preview = previewSnapshot(relay, values.project, format, includeLog);
    console.log(
      `目标 / Destination: ${relay.sync}/资料/${preview.file}\n\n${preview.body}\n--approve ${preview.approval}`,
    );
    if (command === "preview") return;
    if (!process.stdin.isTTY) throw new Error("请先预览，再传 --approve / Preview and supply --approve");
    const reader = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const answer = await reader.question("确认以上内容均可发至所选目录？[y/N] / Approve these contents? ");
      if (answer.trim().toLowerCase() !== "y") return;
    } finally {
      reader.close();
    }
    approval = preview.approval;
  }
  console.log(JSON.stringify(publishSnapshot(relay, values.project, format, includeLog, approval), null, 2));
}

main().catch((error) => {
  console.error((error as Error).message);
  process.exitCode = 1;
});
