// 传入仅包含合成资料的 startUi 地址；不访问真实账号。
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
const project = resolve(import.meta.dirname, "../../..");
const { unzipSync } = createRequire(`${project}/packages/core/package.json`)("fflate");
const url = process.argv[2];
if (!url?.startsWith("http://127.0.0.1:")) throw new Error("Synthetic localhost URL required");
async function request(method, args) {
  const response = await fetch(`${url}/api/product/${method}`, {
    method: "POST",
    headers: { "X-Kaitu": "1", Origin: url, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(data));
  return data;
}
const started = await request("exportWorkspaceRequest", ["start"]);
const library = await request("library", [{ section: "summary" }]);
let state;
for (let i = 0; i < 1000; i++) {
  state = await request("exportWorkspaceRequest", ["status"]);
  if (state.status !== "running") break;
  await delay(25);
}
if (started.status !== "running" || state.status !== "ready") throw new Error("Export did not finish");
const result = await request("exportWorkspaceRequest", ["result"]);
const entries = unzipSync(Buffer.from(result.file.base64, "base64"));
if (!entries["chats/2026/10/99.jsonl"] || !entries["inbox/notes/2026-10-19/0094.md"])
  throw new Error("Export incomplete");
await request("exportWorkspaceRequest", ["start"]);
const cancel = await request("exportWorkspaceRequest", ["cancel"]);
const afterCancel = await request("exportWorkspaceRequest", ["status"]);
if (cancel.status !== "cancelled" || afterCancel.status !== "idle") throw new Error("Cancel failed");
console.log(
  JSON.stringify(
    {
      start: started.status,
      libraryResponsive: !!library,
      completed: state.status,
      exportedFileCount: Object.keys(entries).length,
      includesLastChat: true,
      includesLastNote: true,
      cancel: cancel.status,
      afterCancel: afterCancel.status,
      status: "passed",
    },
    null,
    2,
  ),
);
