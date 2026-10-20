import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Run against this PR plus #62 in an independent integration copy. No clock/Git replacement.
const code = resolve(process.argv[2] ?? fileURLToPath(new URL("..", import.meta.url)));
const output = resolve(process.argv[3] ?? mkdtempSync(join(tmpdir(), "kaitu-nutrition-evidence-")));
const root = mkdtempSync(join(tmpdir(), "kaitu-nutrition-cli-"));
const env = { ...process.env, KAITU_LOCAL_STATE_DIR: join(root, "state") };
const cli = join(code, "packages/cli/dist/main.js");
const run = (...args) => execFileSync(process.execPath, [cli, ...args], { env, encoding: "utf8" });
const read = (file) => JSON.parse(readFileSync(join(root, "data", file), "utf8"));
const save = (stage) => {
  const dir = join(output, stage);
  mkdirSync(dir, { recursive: true });
  for (const file of [
    "phone/today.json",
    "phone/receipts.json",
    ".kaitu/phone-records.json",
    ".kaitu/inbox-records.json",
  ])
    copyFileSync(join(root, "data", file), join(dir, `${file.replaceAll("/", "__")}.txt`));
};
run("init", join(root, "data"), "--timezone", "Asia/Shanghai");
run("phone", "run", "--dir", join(root, "data"));
const day = read("phone/today.json").today;
const fixture = JSON.parse(readFileSync(join(code, "schemas/fixtures/phone/records.jsonl"), "utf8").trim());
const meal = { ...fixture, ts: `${day}T12:40:00+08:00` };
const names = ["01JAZ1B2C3D4E5F6G7H8J9K0MP", "01JAZ1B2C3D4E5F6G7H8J9K0MQ", "01JAZ1B2C3D4E5F6G7H8J9K0MR"].map(
  (id) => `ios-3fa9c1d2-${id}.records.jsonl`,
);
const deliver = (name, rows) =>
  writeFileSync(
    join(root, "data/inbox/agents", name),
    `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
  );
const consume = () => run("phone", "run", "--dir", join(root, "data"));
const check = (kcal, protein, refs) => {
  const today = read("phone/today.json");
  assert.deepEqual(today.nutrition, {
    version: 1,
    kcal,
    protein_g: protein,
    accounted_refs: refs.slice().sort(),
  });
};
deliver(names[0], [meal]);
consume();
check(720, 38, [names[0]]);
save("01-confirmed");
// Removing display receipts models retention without falsifying clocks; private ledger must suffice.
const receipts = read("phone/receipts.json");
receipts.items = [];
writeFileSync(join(root, "data/phone/receipts.json"), JSON.stringify(receipts));
deliver(names[0], [meal]);
consume();
check(720, 38, [names[0]]);
save("02-replayed-without-receipts");
deliver(names[1], [
  { replaces: names[0], agent: "iPhone" },
  { ...meal, kcal: 500, protein_g: 30 },
]);
consume();
check(500, 30, names.slice(0, 2));
save("03-replaced");
deliver(names[2], [{ replaces: names[1], agent: "iPhone" }]);
consume();
check(0, 0, names);
save("04-withdrawn");
deliver(names[0], [meal]);
consume();
check(0, 0, names);
save("05-old-source-replayed");
// Exact official CLI, with one explicit filesystem fault before consumed ledger rename.
const hook = join(root, "interrupt.cjs");
// A fresh ref ensures this interruption concerns a newly prepared plan.
const interruptedName = "ios-3fa9c1d2-01JAZ1B2C3D4E5F6G7H8J9K0MS.records.jsonl";
writeFileSync(
  hook,
  `const fs=require('node:fs'),m=require('node:module');const rename=fs.renameSync;
fs.renameSync=function(from,to){if(String(to).endsWith('phone-records.json') && JSON.parse(fs.readFileSync(from,'utf8'))['${interruptedName}']?.consumed)throw new Error('synthetic interruption before consumed ledger rename');return rename.apply(this,arguments)};m.syncBuiltinESMExports();`,
);
deliver(interruptedName, [meal]);
let failed = false;
try {
  execFileSync(process.execPath, ["--require", hook, cli, "phone", "run", "--dir", join(root, "data")], {
    env,
    stdio: "pipe",
  });
} catch (error) {
  failed = true;
  writeFileSync(join(output, "interruption.log"), error.stderr);
}
assert(failed);
assert.equal(read(".kaitu/phone-records.json")[interruptedName].consumed, undefined);
const preparedId = read(".kaitu/phone-records.json")[interruptedName].entries[0].record.id;
save("06-interrupted");
consume();
check(720, 38, [...names, interruptedName]);
save("07-recovered");
const rows = run("record", "list", "meal", "--json-out", "--dir", join(root, "data"));
writeFileSync(join(output, "canonical-meals.json.txt"), rows);
assert.equal(JSON.parse(rows).length, 1);
assert.equal(JSON.parse(rows)[0].id, preparedId);
writeFileSync(
  join(output, "result.json"),
  `${JSON.stringify(
    { code, root, output, day, refs: [...names, interruptedName], preparedId, result: "passed" },
    null,
    2,
  )}\n`,
);
console.log(JSON.stringify({ output, root, result: "passed" }));
