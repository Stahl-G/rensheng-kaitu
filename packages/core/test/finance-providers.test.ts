import { readFileSync, rmSync } from "node:fs";
import { expect, it } from "vitest";
import {
  addRecord,
  commitFinanceImport,
  discardFinanceImport,
  previewFinanceImport,
  readRecords,
  stageFinanceUpload,
} from "../src/index.js";
import { freshWorkspace } from "./helpers.js";

const cases = [
  ["wechat", "wechat.csv", "-12.34", "expense"],
  ["alipay-csv", "alipay-csv.csv", "4.20", "refund"],
  ["cmb", "cmb.csv", "-1234.50", "transfer"],
  ["icbc", "icbc.csv", "-13.40", "expense"],
  ["ccb", "ccb.csv", "-3.40", "expense"],
  ["boc", "boc.csv", "-71.89", "expense"],
  ["jd", "jd.csv", "-60.90", "expense"],
  ["mt", "mt.csv", "21.17", "refund"],
  ["hxsec", "hxsec.csv", "19", "sale"],
  ["htsec", "htsec.csv", "-21", "buy"],
  ["ibkr", "ibkr.xml", "-20.35", "buy"],
] as const;
it.each(cases)("%s 示例：解析方向、确认写入、去重与放弃", async (format, fixture, amount, category) => {
  const ws = await freshWorkspace();
  try {
    const account = addRecord(ws, "finance_account", {
      name: "Synthetic Account",
      kind: "bank",
      currency: "CNY",
      source: "manual",
    }).record.id;
    const bytes = readFileSync(new URL(`./fixtures/finance/${fixture}`, import.meta.url));
    const file = stageFinanceUpload(ws, fixture, bytes);
    const preview = previewFinanceImport(ws, file, { account });
    expect(preview).toMatchObject({ format, added: 1, errors: [] });
    expect(preview.rows[0]).toMatchObject({ amount, category });
    expect(readRecords(ws, "finance_transaction")).toHaveLength(0);
    const committed = await commitFinanceImport(ws, file, { account });
    expect(committed.added).toBe(1);
    const record = readRecords(ws, "finance_transaction")[0];
    expect(record).toMatchObject({ amount, category, account });
    if (format === "alipay-csv")
      expect(record).toMatchObject({
        source_status: "退款成功",
        source_direction: "收入",
        original_source_transaction_id: "s-old",
      });
    if (["wechat", "boc", "jd", "mt"].includes(format)) expect(record?.account_last4).toBe("1234");
    const again = stageFinanceUpload(ws, fixture, bytes);
    expect(await commitFinanceImport(ws, again, { account })).toMatchObject({
      added: 0,
      skipped: 1,
      version: null,
    });
    const abandoned = stageFinanceUpload(ws, fixture, bytes);
    discardFinanceImport(ws, abandoned);
    expect(ws.exists(abandoned)).toBe(false);
    expect(readRecords(ws, "finance_transaction")).toHaveLength(1);
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});
