import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { KaituError, defaultRoot } from "@kaitu/core/phone-run";
import { phoneGenerator, phonePreviewText, previewPhone, runPhone } from "./phone.js";

async function run() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(3),
    allowPositionals: true,
    options: {
      dir: { type: "string" },
      as: { type: "string" },
      "dry-run": { type: "boolean" },
      "json-out": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.log("kaitu phone run [--as <名字>] [--dry-run] [--dir <目录>] [--json-out]");
    return;
  }
  if (positionals.length !== 1 || positionals[0] !== "run")
    throw new KaituError("使用 phone run", "BAD_ARGS");
  const root = values.dir ? resolve(values.dir) : defaultRoot();
  const generator = phoneGenerator(values.as);
  if (values["dry-run"]) {
    const result = await previewPhone(root, generator);
    console.log(
      values["json-out"] ? JSON.stringify(result, null, 2) : phonePreviewText(result) || "没有变化",
    );
  } else console.log(JSON.stringify(await runPhone(root, generator), null, 2));
}
run().catch((error: Error & { code?: string }) => {
  console.error(
    error instanceof KaituError || error.code?.startsWith("ERR_PARSE_ARGS") ? error.message : error.stack,
  );
  process.exitCode = 2;
});
