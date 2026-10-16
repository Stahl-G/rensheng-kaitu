import { readFileSync, rmSync } from "node:fs";
import { expect, it } from "vitest";
import {
  addRecord,
  commitFinanceImport,
  discardFinanceImport,
  history,
  previewFinanceImport,
  readRecords,
  stageFinanceUpload,
} from "../src/index.js";
import { freshWorkspace } from "./helpers.js";

it("首次导入支付宝、微信和持仓时，预览不建账户，改名确认与重复导入保持一致", async () => {
  const ws = await freshWorkspace();
  try {
    for (const fixture of ["alipay-csv.csv", "wechat.csv", "holdings.xlsx"]) {
      const bytes = readFileSync(new URL(`./fixtures/finance/${fixture}`, import.meta.url));
      const file = stageFinanceUpload(ws, fixture, bytes);
      const before = readRecords(ws, "finance_account");
      const versions = await history(ws);
      const preview = await previewFinanceImport(ws, file);
      expect(preview.errors).toEqual([]);
      expect(preview.added).toBeGreaterThan(0);
      expect(readRecords(ws, "finance_account")).toEqual(before);
      expect(await history(ws)).toEqual(versions);
      const options = { accountName: `合成账户 ${fixture}` };
      const result = await commitFinanceImport(ws, file, options);
      const accounts = readRecords(ws, "finance_account");
      const created = accounts.find((a) => a.name === options.accountName);
      expect(created).toBeDefined();
      expect(accounts).toHaveLength(before.length + 1);
      const type = fixture === "holdings.xlsx" ? "finance_holding_snapshot" : "finance_transaction";
      expect(readRecords(ws, type).filter((r) => r.account === created?.id)).toHaveLength(result.added);
      expect(await history(ws)).toHaveLength(versions.length + 1);
      const after = await history(ws);
      expect(await commitFinanceImport(ws, file, options)).toMatchObject({ added: 0, version: null });
      const again = stageFinanceUpload(ws, fixture, bytes);
      const repeated = await previewFinanceImport(ws, again);
      expect(repeated.account).toBe(created?.id);
      expect(repeated.added).toBe(0);
      expect(await commitFinanceImport(ws, again, {})).toMatchObject({ added: 0, version: null });
      expect(readRecords(ws, "finance_account")).toEqual(accounts);
      expect(await history(ws)).toEqual(after);
    }
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});

it("放弃或错误账单不建账户，预览改选已有账户后按该账户去重", async () => {
  const ws = await freshWorkspace();
  try {
    const bad = stageFinanceUpload(
      ws,
      "bad.csv",
      Buffer.from("证券代码,持仓数量\n000002,1\n000003,invalid\n"),
    );
    expect((await previewFinanceImport(ws, bad)).errors).toHaveLength(1);
    await expect(commitFinanceImport(ws, bad, {})).rejects.toThrow();
    expect(readRecords(ws, "finance_account")).toEqual([]);
    expect(readRecords(ws, "finance_holding_snapshot")).toEqual([]);
    discardFinanceImport(ws, bad);
    const bytes = Buffer.from("证券代码,持仓数量,币种\n000002,1,人民币\n");
    const abandoned = stageFinanceUpload(ws, "holdings.csv", bytes);
    await previewFinanceImport(ws, abandoned);
    discardFinanceImport(ws, abandoned);
    expect(readRecords(ws, "finance_account")).toEqual([]);
    const account = addRecord(ws, "finance_account", {
      name: "已有合成账户",
      kind: "securities",
      currency: "CNY",
      source: "manual",
    }).record.id;
    const file = stageFinanceUpload(ws, "holdings.csv", bytes);
    expect((await previewFinanceImport(ws, file, { account })).added).toBe(1);
    await commitFinanceImport(ws, file, { account });
    const again = stageFinanceUpload(ws, "holdings.csv", bytes);
    expect((await previewFinanceImport(ws, again)).added).toBe(1);
    expect((await previewFinanceImport(ws, again, { account })).added).toBe(0);
    expect(await commitFinanceImport(ws, again, { account })).toMatchObject({ added: 0, version: null });
    expect(readRecords(ws, "finance_account")).toHaveLength(1);
    expect(readRecords(ws, "finance_holding_snapshot")[0]?.account).toBe(account);
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});
