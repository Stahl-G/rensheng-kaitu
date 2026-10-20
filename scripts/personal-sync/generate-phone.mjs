import fs from "node:fs";
import { writePhoneSnapshots } from "../../packages/core/dist/phone-snapshots.js";
import { schemas } from "../../packages/core/dist/schema.js";
import { Workspace } from "../../packages/core/dist/workspace.js";
const root = process.argv[2];
const ws = new Workspace(root, { maintain: false });
await writePhoneSnapshots(ws, new Date(), { force: true });
for (const name of ["today", "week", "map", "library", "receipts"]) {
  const value = JSON.parse(fs.readFileSync(`${root}/phone/${name}.json`, "utf8"));
  if (!schemas().builtin(`phone-${name}.schema.json`)(value)) {
    throw new Error(`Invalid phone ${name} snapshot`);
  }
}
