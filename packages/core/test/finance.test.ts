import { rmSync } from "node:fs";
import { expect, it } from "vitest";
import {
  type FinanceTransaction,
  addRecord,
  commitFinanceImport,
  discardFinanceImport,
  financeAccounts,
  financeCashflow,
  financeEffects,
  financeInvestments,
  financeOverview,
  history,
  previewFinanceImport,
  readRecords,
  reconcileFinance,
  snapshot,
  stageFinanceUpload,
  updateRecord,
  upgradeWorkspace,
  validateWorkspace,
  workspaceFileStamps,
} from "../src/index.js";
import { freshWorkspace } from "./helpers.js";

function account(ws: Awaited<ReturnType<typeof freshWorkspace>>, name = "Synthetic Wallet", kind = "wallet") {
  return addRecord(ws, "finance_account", {
    name,
    kind,
    source: "manual",
    currency: "CNY",
    ts: "2026-10-01T00:00:00+08:00",
  }).record.id;
}
function transaction(
  ws: Awaited<ReturnType<typeof freshWorkspace>>,
  account: string,
  data: Record<string, unknown>,
) {
  return addRecord(ws, "finance_transaction", {
    account,
    ts: "2026-10-10T12:00:00+08:00",
    amount: "1",
    currency: "CNY",
    category: "income",
    counterparty: "Synthetic Party",
    description: "Synthetic Item",
    source: "manual",
    source_transaction_id: null,
    related_ids: [],
    reconciliation: "ok",
    ...data,
  }).record as FinanceTransaction;
}

it("AC03：GBK 账单预览无写入，跨来源保留候选，重复提交没有记录和版本", async () => {
  const ws = await freshWorkspace();
  try {
    const id = account(ws);
    const manual = transaction(ws, id, {
      amount: "-12.3400",
      category: "expense",
      ts: "2026-10-10T10:00:00+08:00",
      counterparty: "Synthetic Shop",
      description: 'Synthetic "Item", A',
    });
    await snapshot(ws, "合成手记");
    const bytes = GBK_BILL;
    const file = stageFinanceUpload(ws, "synthetic.csv", bytes);
    const stamps = workspaceFileStamps(ws);
    const versions = await history(ws);
    const preview = previewFinanceImport(ws, file, { account: id });
    expect(preview).toMatchObject({
      encoding: "gbk",
      added: 2,
      skipped: 0,
      candidate_duplicate: 1,
      ignored: 1,
      errors: [],
    });
    expect(workspaceFileStamps(ws)).toEqual(stamps);
    expect(await history(ws)).toEqual(versions);
    expect(readRecords(ws, "finance_transaction")).toHaveLength(1);
    const result = await commitFinanceImport(ws, file, { account: id });
    expect(result.added).toBe(2);
    expect(result.version).not.toBeNull();
    expect(await history(ws)).toHaveLength(versions.length + 1);
    expect(ws.exists(file)).toBe(false);
    const rows = readRecords(ws, "finance_transaction") as FinanceTransaction[];
    const imported = rows.find((r) => r.source_transaction_id === "synth-1");
    expect(imported).toMatchObject({
      amount: "-12.3400",
      reconciliation: "candidate_duplicate",
      by: "import:alipay-csv",
    });
    expect(imported?.related_ids).toContain(manual.id);
    expect(rows.find((r) => r.id === manual.id)?.related_ids).toContain(imported?.id);
    expect(rows.find((r) => r.source_transaction_id === "synth-2")?.amount).toBe("30.000000000000000001");
    const saved = await history(ws);
    expect(await commitFinanceImport(ws, file, { account: id })).toMatchObject({ added: 0, version: null });
    const second = stageFinanceUpload(ws, "synthetic-again.csv", bytes);
    expect(await commitFinanceImport(ws, second, { account: id })).toMatchObject({
      added: 0,
      skipped: 2,
      version: null,
    });
    expect(readRecords(ws, "finance_transaction")).toEqual(rows);
    expect(await history(ws)).toEqual(saved);
    expect(validateWorkspace(ws)).toEqual([]);
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});

it("AC07：转账配对、卖出缺成本、退款和借贷分流，缺汇率不进入折算合计", async () => {
  const ws = await freshWorkspace();
  try {
    const a = account(ws);
    const b = account(ws, "Synthetic Bank", "bank");
    const out = transaction(ws, a, {
      category: "transfer",
      amount: "-100.001",
      reconciliation: "pending_review",
    });
    const incoming = transaction(ws, b, {
      category: "transfer",
      amount: "100.001",
      ts: "2026-10-12T12:00:00+08:00",
      reconciliation: "pending_review",
    });
    const expense = transaction(ws, a, { category: "expense", amount: "-20.10" });
    const refund = transaction(ws, a, {
      category: "refund",
      amount: "5.03",
      related_ids: [expense.id],
      reconciliation: "pending_review",
    });
    const sale = transaction(ws, b, { category: "sale", amount: "80", cost: null });
    transaction(ws, a, { category: "income", amount: "10.000000000000000001" });
    const foreign = transaction(ws, a, { category: "income", amount: "2.2", currency: "EUR" });
    transaction(ws, a, { category: "loan_in", amount: "100" });
    transaction(ws, a, { category: "loan_repay", amount: "-20" });
    transaction(ws, a, { category: "interest", amount: "-2" });
    transaction(ws, b, { category: "dividend", amount: "3" });
    transaction(ws, b, { category: "fee", amount: "-1" });
    const reconciled = reconcileFinance(readRecords(ws, "finance_transaction") as FinanceTransaction[]);
    expect(reconciled.find((r) => r.id === out.id)).toMatchObject({
      reconciliation: "ok",
      related_ids: [incoming.id],
    });
    expect(reconciled.find((r) => r.id === incoming.id)?.related_ids).toContain(out.id);
    expect(reconciled.find((r) => r.id === refund.id)?.reconciliation).toBe("ok");
    expect(financeEffects(sale)).toMatchObject({
      income: "0",
      principal: null,
      realized_gain: null,
      returns: null,
    });
    const cashflow = financeCashflow(ws, "2026-10-01", "2026-10-31", { targetCurrency: "CNY" });
    const cny = cashflow.currencies.find((c) => c.currency === "CNY");
    expect(cny?.income.amount).toBe("10.000000000000000001");
    expect(cny?.consumption.amount).toBe("17.07");
    expect(cny?.surplus.amount).toBe("-7.069999999999999999");
    expect(cny?.investment_flow).toMatchObject({ amount: "80" });
    expect(cny?.realized_gain.amount).toBeNull();
    expect(cny?.returns.amount).toBeNull();
    expect(cny?.consumption.record_ids).toEqual(expect.arrayContaining([expense.id, refund.id]));
    expect(cashflow.converted?.income).toMatchObject({ amount: "10.000000000000000001", complete: false });
    expect(cashflow.converted?.income.excluded).toContainEqual(
      expect.objectContaining({ record_ids: [foreign.id], reason: "fx_missing" }),
    );
    const rate = addRecord(ws, "finance_fx_rate", {
      ts: "2026-10-01T00:00:00+08:00",
      date: "2026-10-01",
      from_currency: "EUR",
      to_currency: "CNY",
      rate: "7.0001",
      source: "synthetic-rate",
    }).record;
    const converted = financeCashflow(ws, "2026-10-01", "2026-10-31", { targetCurrency: "CNY" }).converted
      ?.income;
    expect(converted?.amount).toBe("25.400220000000000001");
    expect(converted?.record_ids).toContain(rate.id);
    expect(converted?.conversions).toContainEqual(
      expect.objectContaining({ rate_source: "synthetic-rate", rate_date: "2026-10-01" }),
    );
    expect(
      financeInvestments(ws).currencies.find((c) => c.currency === "CNY")?.realized_gain.amount,
    ).toBeNull();
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});

it("持仓导入保留缺值、校验整批、弃用删除原件；升级补模块并保持余额未知", async () => {
  const ws = await freshWorkspace();
  try {
    rmSync(ws.resolve("finance"), { recursive: true });
    const config = ws.readJson<Record<string, unknown>>(".kaitu/config.json");
    ws.writeJson(".kaitu/config.json", { ...config, template_version: "old" }, { internal: true });
    await upgradeWorkspace(ws);
    const id = account(ws, "Synthetic Securities", "securities");
    const bytes = Buffer.from(
      '证券代码,证券名称,持仓数量,市价,币种\r\n000001,"Synthetic, A",3.0000,7.10,人民币\r\n',
    );
    const file = stageFinanceUpload(ws, "holdings.csv", bytes);
    const preview = previewFinanceImport(ws, file, { account: id });
    expect(preview).toMatchObject({ format: "holdings-csv", encoding: "utf-8", added: 1, errors: [] });
    expect(preview.rows[0]).toMatchObject({
      cost: null,
      market_value: null,
      quantity: "3.0000",
      security_code: "000001",
    });
    const before = await history(ws);
    await commitFinanceImport(ws, file, { account: id });
    expect(await history(ws)).toHaveLength(before.length + 1);
    const again = stageFinanceUpload(ws, "holdings-again.csv", bytes);
    expect(await commitFinanceImport(ws, again, { account: id })).toMatchObject({ added: 0, version: null });
    const investments = financeInvestments(ws);
    expect(investments.holdings[0]?.valuation.amount).toBe("21.3");
    expect(investments.holdings[0]?.cost.amount).toBeNull();
    expect(investments.holdings[0]?.unrealized_gain.amount).toBeNull();
    expect(investments.holdings[0]?.period_return.amount).toBeNull();
    expect(investments.currencies[0]?.realized_gain.amount).toBeNull();
    expect(financeAccounts(ws).accounts[0]?.balance.amount).toBeNull();
    const overview = financeOverview(ws).currencies[0];
    expect(overview?.investment_assets.amount).toBe("21.3");
    expect(overview?.total_assets.amount).toBeNull();
    expect(overview?.net_assets.amount).toBeNull();
    updateRecord(ws, "finance_account", id, { balance: "100", balance_at: "2026-10-01T00:00:00+08:00" });
    const debt = addRecord(ws, "finance_account", {
      name: "Synthetic Loan",
      kind: "loan",
      currency: "CNY",
      source: "manual",
      balance: "30",
      balance_at: "2026-10-01T00:00:00+08:00",
      ts: "2026-10-01T00:00:00+08:00",
    }).record;
    const known = financeOverview(ws).currencies[0];
    expect(known?.cash.amount).toBe("100");
    expect(known?.liabilities).toMatchObject({ amount: "30", record_ids: [debt.id] });
    expect(known?.total_assets.amount).toBe("121.3");
    expect(known?.net_assets.amount).toBe("91.3");
    const bad = stageFinanceUpload(
      ws,
      "invalid.csv",
      Buffer.from("证券代码,持仓数量\n000002,1\n000003,invalid\n"),
    );
    const records = readRecords(ws, "finance_holding_snapshot");
    expect(previewFinanceImport(ws, bad).errors).toHaveLength(1);
    await expect(commitFinanceImport(ws, bad, { account: id })).rejects.toThrow();
    expect(readRecords(ws, "finance_holding_snapshot")).toEqual(records);
    discardFinanceImport(ws, bad);
    expect(ws.exists(bad)).toBe(false);
    expect(validateWorkspace(ws)).toEqual([]);
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});

const GBK_BILL = Buffer.from(
  [
    "cbb5c3f7a3babacfb3c9b2e2cad4d5cbb5a50d0a20bdbbd2d7cab1bce4202cbdbbd2d7b7d6c0e02cbdbbd2d7b6d4b7bd2cb6",
    "d4b7bdd5cbbac52cc9ccc6b7cbb5c3f72ccad52fd6a72cbdf0b6ee2ccad52fb8b6bfeeb7bdcabd2cbdbbd2d7d7b4ccac2cbd",
    "bbd2d7b6a9b5a5bac52cc9ccbcd2b6a9b5a5bac52cb1b8d7a20d0a323032362d31302d31302031303a30303a30302cc8d5d3",
    "c32c53796e7468657469632053686f702c73796e74682c2253796e7468657469632022224974656d22222c2041222cd6a7b3",
    "f62c31322e333430302cd3e0b6ee2cbdbbd2d7b3c9b9a62c73796e74682d312c2c0d0a323032362d31302d31302031313a30",
    "303a30302ccad5c8eb2c53796e74686574696320496e636f6d652c73796e74682c53796e74686574696320696e636f6d652c",
    "cad5c8eb2c33302e3030303030303030303030303030303030312cd3e0b6ee2cbdbbd2d7b3c9b9a62c73796e74682d322c2c",
    "0d0a323032362d31302d31302031313a30303a30302cc8d5d3c32c53796e74686574696320436c6f7365642c73796e74682c",
    "53796e74686574696320636c6f7365642cd6a7b3f62c39392cd3e0b6ee2cbdbbd2d7b9d8b1d52c73796e74682d332c2c0d0a",
    "cbb5c3f7a3bad2d4c9cfbef9ceaad0e9b9b9cafdbedd0d0a",
  ].join(""),
  "hex",
);
