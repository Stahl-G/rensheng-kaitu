#!/usr/bin/env node
import { createHash, sign } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { zipSync } from "fflate";
import semver from "semver";
import { DSH_VERSION, HOST_API } from "./payload-loader.mjs";

const { values } = parseArgs({
  options: {
    payload: { type: "string" },
    output: { type: "string" },
    key: { type: "string" },
    url: { type: "string" },
    notes: { type: "string", default: "" },
  },
});
if (!values.payload || !values.output || !values.key || !values.url)
  throw new Error(
    "用法：node packages/desktop/package-update.mjs --payload <功能目录> --output <新目录> --key <私钥文件> --url <更新包HTTPS地址> [--notes <说明>]",
  );
const payload = resolve(values.payload);
const metadata = JSON.parse(readFileSync(join(payload, "payload.json"), "utf8"));
if (
  !semver.valid(metadata.version) ||
  metadata.version.includes("+") ||
  metadata.dshVersion !== DSH_VERSION ||
  metadata.hostApi !== HOST_API
)
  throw new Error("功能包版本或内核适配版本不匹配");
const files = {};
const walk = (directory, prefix) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const name = `${prefix}${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error(`功能包不能包含链接：${name}`);
    if (entry.isDirectory()) walk(path, `${name}/`);
    else files[name] = new Uint8Array(readFileSync(path));
  }
};
for (const name of ["dist", "web", "schemas", "templates", "data", "licenses"])
  walk(join(payload, name), `${name}/`);
for (const name of ["package.json", "payload.json"])
  files[name] = new Uint8Array(readFileSync(join(payload, name)));
const bytes = zipSync(files, { level: 6 });
const manifest = JSON.stringify({
  ...metadata,
  url: values.url,
  size: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  notes: values.notes,
});
const envelope = {
  manifest,
  signature: sign(null, Buffer.from(manifest), readFileSync(resolve(values.key))).toString("base64"),
};
const output = resolve(values.output);
mkdirSync(output); // Publishing never overwrites an existing release.
writeFileSync(join(output, "kaitu-features.zip"), bytes);
writeFileSync(join(output, "latest.json"), JSON.stringify(envelope, null, 2));
console.log(`已生成 ${output}（${bytes.length} 字节），未上传或发布。`);
