import { rmSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  type FinanceQuoteFetcher,
  addRecord,
  financeInvestments,
  loadFinanceInvestments,
  readRecords,
} from "../src/index.js";
import { freshWorkspace, tmp } from "./helpers.js";

it("参考价和汇率独立于导入记录，失败保留时间，每小时与每日限额都生效", async () => {
  const ws = await freshWorkspace();
  const cacheDir = tmp();
  try {
    const account = addRecord(ws, "finance_account", {
      name: "Synthetic Securities",
      kind: "securities",
      source: "manual",
      currency: "CNY",
    }).record.id;
    for (const [code, currency] of [
      ["600000", "CNY"],
      ["000001", "CNY"],
      ["00700", "HKD"],
      ["SYNTH", "USD"],
      ["unknown-code", "CNY"],
      ["600001", null],
    ])
      addRecord(ws, "finance_holding_snapshot", {
        account,
        security_code: code,
        name: "Synthetic Security",
        quantity: "2",
        cost: code === "600001" ? "8" : null,
        price: "8",
        market_value: null,
        currency,
        source: "synthetic",
        ts: "2026-10-01T00:00:00+08:00",
      });
    const records = readRecords(ws, "finance_holding_snapshot");
    const imported = financeInvestments(ws);
    let requests = 0;
    const at = "2026-10-15T00:00:00Z";
    const prices: Record<string, [string, string]> = {
      "600000.SS": ["12.5", "CNY"],
      "600001.SS": ["13", "CNY"],
      "000001.SZ": ["10", "CNY"],
      "0700.HK": ["20", "HKD"],
      SYNTH: ["30", "USD"],
      "USDCNY=X": ["7", "CNY"],
      "HKDCNY=X": ["0.9", "CNY"],
    };
    const fetchQuotes: FinanceQuoteFetcher = async (symbols) => {
      requests++;
      if (requests > 1) throw new Error("synthetic offline");
      return symbols.flatMap((symbol) => {
        const price = prices[symbol];
        return price ? [{ symbol, price: price[0], currency: price[1], at }] : [];
      });
    };
    const load = (hour: number) =>
      loadFinanceInvestments(
        ws,
        { targetCurrency: "CNY" },
        {
          cacheDir: join(cacheDir, "quotes"),
          now: new Date(Date.parse(at) + hour * 3600000 + 1),
          fetchQuotes,
        },
      );
    const first = await load(0);
    expect(first.holdings.find((h) => h.security_code === "600000")?.reference).toMatchObject({
      price: "12.5",
      value: "25",
      unrealized_gain: null,
    });
    expect(first.holdings.find((h) => h.security_code === "000001")?.reference.value).toBe("20");
    expect(first.holdings.find((h) => h.security_code === "00700")?.reference.converted_value).toBe("36");
    expect(first.holdings.find((h) => h.security_code === "SYNTH")?.reference.converted_value).toBe("420");
    expect(first.holdings.find((h) => h.security_code === "unknown-code")?.reference).toMatchObject({
      price: null,
      status: "unavailable",
    });
    expect(first.holdings.find((h) => h.security_code === "600001")?.reference).toMatchObject({
      value: "26",
      unrealized_gain: null,
    });
    await load(0.5);
    expect(requests).toBe(1);
    const failed = await load(2);
    expect(failed.holdings.find((h) => h.security_code === "600000")?.reference).toMatchObject({
      price: "12.5",
      at,
      status: "stale",
    });
    await load(4);
    await load(6);
    await load(8);
    expect(requests).toBe(4);
    expect(readRecords(ws, "finance_holding_snapshot")).toEqual(records);
    expect(financeInvestments(ws)).toMatchObject({
      holdings: imported.holdings,
      currencies: imported.currencies,
    });
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
    rmSync(cacheDir, { recursive: true, force: true });
  }
});
