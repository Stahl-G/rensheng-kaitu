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
  const native: Record<string, string> = {
    wechat: "wechat.xlsx",
    ccb: "ccb.xls",
    hxsec: "hxsec.xls",
    htsec: "htsec.xlsx",
  };
  for (const fixtureName of [
    fixture,
    ...(native[format] ? [native[format]] : []),
    ...(format === "htsec" ? ["htsec-today.csv"] : []),
  ]) {
    const ws = await freshWorkspace();
    try {
      const account = addRecord(ws, "finance_account", {
        name: "Synthetic Account",
        kind: "bank",
        currency: "CNY",
        source: "manual",
      }).record.id;
      const options = { account, ...(format === "htsec" ? { tradeDate: "2026-10-01" } : {}) };
      const bytes = readFileSync(new URL(`./fixtures/finance/${fixtureName}`, import.meta.url));
      const file = stageFinanceUpload(ws, fixtureName, bytes);
      const preview = await previewFinanceImport(ws, file, options);
      expect(preview).toMatchObject({ format, added: 1, errors: [] });
      expect(preview.rows[0]).toMatchObject({ amount, category });
      expect(readRecords(ws, "finance_transaction")).toHaveLength(0);
      const committed = await commitFinanceImport(ws, file, options);
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
      const again = stageFinanceUpload(ws, fixtureName, bytes);
      expect(await commitFinanceImport(ws, again, options)).toMatchObject({
        added: 0,
        skipped: 1,
        version: null,
      });
      const abandoned = stageFinanceUpload(ws, fixtureName, bytes);
      discardFinanceImport(ws, abandoned);
      expect(ws.exists(abandoned)).toBe(false);
      expect(readRecords(ws, "finance_transaction")).toHaveLength(1);
    } finally {
      rmSync(ws.root, { recursive: true, force: true });
    }
  }
});
