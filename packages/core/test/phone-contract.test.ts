import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { schemas } from "../src/index.js";

// iOS 端用同一批样例做解码测试；样例与 schema 不一致时，两端会各自按不同的格式实现。
const fixture = (name: string) =>
  readFileSync(new URL(`../../../schemas/fixtures/phone/${name}`, import.meta.url), "utf8");

it.each([
  ["today.json", "phone-today.schema.json"],
  ["week.json", "phone-week.schema.json"],
  ["map.json", "phone-map.schema.json"],
  ["receipts.json", "phone-receipts.schema.json"],
])("手机快照样例 %s 符合 %s", (file, schema) => {
  const validate = schemas().builtin(schema);
  expect(validate(JSON.parse(fixture(file))), JSON.stringify(validate.errors)).toBe(true);
});

it("手机操作样例逐行符合 schema，缺参数的操作不通过", () => {
  const validate = schemas().builtin("phone-action.schema.json");
  for (const line of fixture("actions.jsonl").trim().split("\n"))
    expect(validate(JSON.parse(line)), JSON.stringify(validate.errors)).toBe(true);
  expect(
    validate({
      client_id: "01JAZ1B2C3D4E5F6G7H8J9K0MP",
      at: "2026-10-18T07:20:00+08:00",
      device: "3fa9c1d2",
      op: "decide_proposal",
      args: { id: "b-0412" },
    }),
  ).toBe(false);
});
