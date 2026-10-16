import { readRecords } from "../records.js";
import { localDate, parseTs } from "../time.js";
import type { Workspace } from "../workspace.js";
import { financeEffects, reconcileFinance } from "./accounting.js";
import { bankNotificationCandidates } from "./bank-notifications.js";
import { add, decimal, div, mul, neg, sub } from "./decimal.js";
import type {
  FinanceAccount,
  FinanceFxRate,
  FinanceHolding,
  FinanceNumber,
  FinanceTransaction,
} from "./types.js";

export interface FinanceViewOptions {
  asOf?: string;
  targetCurrency?: string;
}
interface Entry {
  currency: string | null;
  amount: string | null;
  ids: string[];
  missing: string[];
  date: string;
}
const ids = (values: string[]) => [...new Set(values)];
const number = (amount: string | null, record_ids: string[], missing: string[] = []): FinanceNumber => ({
  amount,
  record_ids: ids(record_ids),
  missing: ids(missing),
});
function sum(entries: Entry[]): FinanceNumber {
  const missing = entries.flatMap((e) => e.missing);
  return number(
    entries.some((e) => e.amount === null) ? null : entries.reduce((n, e) => add(n, e.amount ?? "0"), "0"),
    entries.flatMap((e) => e.ids),
    missing,
  );
}
function context(ws: Workspace, options: FinanceViewOptions) {
  const asOf = options.asOf ?? new Date().toISOString();
  parseTs(asOf);
  const until = Date.parse(asOf);
  const transactions = reconcileFinance(
    (readRecords(ws, "finance_transaction") as FinanceTransaction[]).filter((r) => Date.parse(r.ts) <= until),
  );
  return {
    asOf,
    transactions,
    accounts: (readRecords(ws, "finance_account") as FinanceAccount[]).filter(
      (r) => Date.parse(r.ts) <= until,
    ),
    holdings: (readRecords(ws, "finance_holding_snapshot") as FinanceHolding[]).filter(
      (r) => Date.parse(r.ts) <= until,
    ),
    rates: (readRecords(ws, "finance_fx_rate") as FinanceFxRate[]).filter((r) => Date.parse(r.ts) <= until),
  };
}
function convert(entries: Entry[], target: string, rates: FinanceFxRate[]) {
  if (!/^[A-Z]{3}$/.test(target)) throw new Error("折算币种无效");
  let amount = "0";
  const included: string[] = [];
  const excluded: { record_ids: string[]; currency: string | null; amount: string | null; reason: string }[] =
    [];
  const conversions: {
    record_ids: string[];
    original_amount: string;
    currency: string;
    amount: string;
    rate: string;
    rate_source: string;
    rate_date: string;
  }[] = [];
  for (const entry of entries) {
    if (!entry.ids.length && entry.amount === "0") continue;
    if (entry.amount === null || !entry.currency) {
      excluded.push({
        record_ids: entry.ids,
        currency: entry.currency,
        amount: entry.amount,
        reason: entry.missing.join(",") || "currency_missing",
      });
      continue;
    }
    if (entry.currency === target) {
      amount = add(amount, entry.amount);
      included.push(...entry.ids);
      continue;
    }
    const rate = rates
      .filter((r) => r.from_currency === entry.currency && r.to_currency === target && r.date <= entry.date)
      .sort((a, b) => b.date.localeCompare(a.date) || b.ts.localeCompare(a.ts))[0];
    if (!rate) {
      excluded.push({
        record_ids: entry.ids,
        currency: entry.currency,
        amount: entry.amount,
        reason: "fx_missing",
      });
      continue;
    }
    const converted = mul(entry.amount, rate.rate);
    amount = add(amount, converted);
    included.push(...entry.ids, rate.id);
    conversions.push({
      record_ids: [...entry.ids, rate.id],
      original_amount: entry.amount,
      currency: entry.currency,
      amount: converted,
      rate: rate.rate,
      rate_source: rate.source,
      rate_date: rate.date,
    });
  }
  return {
    currency: target,
    amount,
    record_ids: ids(included),
    complete: excluded.length === 0,
    excluded,
    conversions,
  };
}
function latestHoldings(holdings: FinanceHolding[]): FinanceHolding[] {
  const latest = new Map<string, number>();
  for (const h of holdings) latest.set(h.account, Math.max(latest.get(h.account) ?? 0, Date.parse(h.ts)));
  return holdings.filter((h) => Date.parse(h.ts) === latest.get(h.account));
}
function holdingValue(h: FinanceHolding): FinanceNumber {
  return number(
    h.market_value ?? (h.quantity !== null && h.price !== null ? mul(h.quantity, h.price) : null),
    [h.id],
    h.market_value === null && (h.quantity === null || h.price === null) ? ["holding_valuation_missing"] : [],
  );
}
function holdingCost(h: FinanceHolding): FinanceNumber {
  return number(
    h.cost !== null && h.quantity !== null ? mul(h.cost, h.quantity) : null,
    [h.id],
    h.cost === null || h.quantity === null ? ["holding_cost_or_quantity_missing"] : [],
  );
}
/** 只从明确的余额锚点加上其后流水计算；一段流水不能代表账户全部余额。 */
function accountBalance(a: FinanceAccount, transactions: FinanceTransaction[], asOf: string): FinanceNumber {
  if (a.balance == null || !a.balance_at || Date.parse(a.balance_at) > Date.parse(asOf))
    return number(null, [a.id], ["balance_snapshot_missing"]);
  const rows = transactions.filter(
    (r) =>
      r.account === a.id && r.currency === a.currency && Date.parse(r.ts) > Date.parse(a.balance_at ?? ""),
  );
  const missing = rows
    .filter((r) => r.reconciliation === "candidate_duplicate" || r.direction_unknown)
    .map((r) => `unreconciled:${r.id}`);
  return number(
    missing.length ? null : rows.reduce((sum, r) => add(sum, r.amount), a.balance),
    [a.id, ...rows.map((r) => r.id)],
    missing,
  );
}
const entry = (currency: string | null, metric: FinanceNumber, date: string): Entry => ({
  currency,
  amount: metric.amount,
  ids: metric.record_ids,
  missing: metric.missing,
  date,
});

export function financeAccounts(ws: Workspace, options: FinanceViewOptions = {}) {
  const ctx = context(ws, options);
  return {
    period: { from: null, to: ctx.asOf, as_of: ctx.asOf },
    accounts: ctx.accounts.map((a) => {
      const rows = ctx.transactions.filter((t) => t.account === a.id);
      const imported = [...rows, ...ctx.holdings.filter((h) => h.account === a.id)]
        .filter((r) => r.imported_at)
        .sort((a, b) => String(b.imported_at).localeCompare(String(a.imported_at)))[0];
      const balance = accountBalance(a, rows, ctx.asOf);
      return {
        id: a.id,
        name: a.name,
        kind: a.kind,
        currency: a.currency,
        balance,
        transaction_count: { value: rows.length, record_ids: rows.map((r) => r.id) },
        latest_import: { at: imported?.imported_at ?? null, record_ids: imported ? [imported.id] : [] },
        sync_status: imported ? "imported" : "never_imported",
        converted_balance: options.targetCurrency
          ? convert([entry(a.currency, balance, ctx.asOf.slice(0, 10))], options.targetCurrency, ctx.rates)
          : null,
      };
    }),
  };
}
export function financeOverview(ws: Workspace, options: FinanceViewOptions = {}) {
  const ctx = context(ws, options);
  const holdings = latestHoldings(ctx.holdings);
  const cash: Entry[] = [];
  const liabilities: Entry[] = [];
  const investments: Entry[] = [];
  for (const a of ctx.accounts) {
    const balance = accountBalance(a, ctx.transactions, ctx.asOf);
    if (["credit", "loan"].includes(a.kind)) {
      // 负债账户的余额为尚欠本金正数，后续还本流水为负数。
      liabilities.push(entry(a.currency, balance, ctx.asOf.slice(0, 10)));
    } else cash.push(entry(a.currency, balance, ctx.asOf.slice(0, 10)));
  }
  for (const h of holdings) investments.push(entry(h.currency, holdingValue(h), h.ts.slice(0, 10)));
  const assets = [...cash, ...investments];
  const net = [
    ...assets,
    ...liabilities.map((e) => ({ ...e, amount: e.amount === null ? null : neg(e.amount) })),
  ];
  const groups = ids([...assets, ...liabilities].map((e) => e.currency ?? "unknown")).map((currency) => {
    const choose = (rows: Entry[]) => sum(rows.filter((e) => (e.currency ?? "unknown") === currency));
    return {
      currency,
      cash: choose(cash),
      investment_assets: choose(investments),
      liabilities: choose(liabilities),
      total_assets: choose(assets),
      net_assets: choose(net),
    };
  });
  return {
    period: { from: null, to: ctx.asOf, as_of: ctx.asOf },
    currencies: groups,
    records: [
      ...ctx.accounts.map((a) => ({
        id: a.id,
        date: a.balance_at ?? a.ts,
        description: `${a.name} · 余额基准`,
        currency: a.currency,
        amount: a.balance ?? null,
      })),
      ...ctx.transactions.map((r) => ({
        id: r.id,
        date: r.ts,
        description: [r.counterparty, r.description].filter(Boolean).join(" · ") || "交易记录",
        currency: r.currency,
        amount: r.amount,
      })),
      ...holdings.map((h) => ({
        id: h.id,
        date: h.ts,
        description: [h.security_code, h.name].filter(Boolean).join(" · ") || "持仓记录",
        currency: h.currency,
        amount: holdingValue(h).amount,
      })),
    ],
    pending: [
      ...ctx.transactions
        .filter((r) => r.reconciliation !== "ok")
        .map((r) => ({
          id: r.id,
          date: r.ts,
          amount: r.amount,
          currency: r.currency,
          description: [r.counterparty, r.description].filter(Boolean).join(" · ") || "交易记录",
          status: r.reconciliation,
          reason: r.review_reason ?? null,
        })),
      ...bankNotificationCandidates(ws, ctx.asOf)
        .filter((candidate) => !candidate.transaction_id)
        .map((candidate) => ({
          id: candidate.id,
          date: candidate.ts,
          amount: candidate.amount,
          currency: candidate.currency,
          description: `${{ cmb: "招商银行", icbc: "工商银行", ccb: "建设银行", boc: "中国银行" }[candidate.bank]}动账通知 · ${candidate.counterparty ?? "待核对"}`,
          status: "pending_review" as const,
          reason: "bank_notification",
        })),
    ],
    converted: options.targetCurrency
      ? {
          cash: convert(cash, options.targetCurrency, ctx.rates),
          investment_assets: convert(investments, options.targetCurrency, ctx.rates),
          liabilities: convert(liabilities, options.targetCurrency, ctx.rates),
          total_assets: convert(assets, options.targetCurrency, ctx.rates),
          net_assets: convert(net, options.targetCurrency, ctx.rates),
        }
      : null,
  };
}
export function financeCashflow(ws: Workspace, from: string, to: string, options: FinanceViewOptions = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to)
    throw new Error("统计日期区间无效");
  const ctx = context(ws, options);
  const rows = ctx.transactions.filter((r) => {
    const date = localDate(parseTs(r.ts), ws.timeZone());
    return date >= from && date <= to;
  });
  const keys = ["income", "consumption", "investment_flow", "returns", "principal", "realized_gain"] as const;
  const entries = Object.fromEntries(keys.map((key) => [key, [] as Entry[]])) as Record<
    (typeof keys)[number],
    Entry[]
  >;
  for (const r of rows) {
    const effects = financeEffects(r);
    for (const key of keys) {
      const duplicate = r.reconciliation === "candidate_duplicate" && effects[key] !== "0";
      entries[key].push({
        currency: r.currency,
        amount: duplicate ? null : effects[key],
        ids: effects[key] === "0" ? [] : [r.id, ...r.related_ids],
        missing: duplicate ? ["candidate_duplicate"] : effects[key] === null ? effects.missing : [],
        date: r.ts.slice(0, 10),
      });
    }
  }
  const surplus = entries.income.map((e, i) => {
    const expense = entries.consumption[i];
    return {
      ...e,
      ids: ids([...e.ids, ...(expense?.ids ?? [])]),
      amount: e.amount === null || expense?.amount === null ? null : sub(e.amount, expense?.amount ?? "0"),
      missing: [...e.missing, ...(expense?.missing ?? [])],
    };
  });
  const currencies = ids(rows.map((r) => r.currency)).map((currency) => {
    const choose = (items: Entry[]) => sum(items.filter((e) => e.currency === currency));
    return {
      currency,
      income: choose(entries.income),
      consumption: choose(entries.consumption),
      surplus: choose(surplus),
      investment_flow: choose(entries.investment_flow),
      returns: choose(entries.returns),
      principal: choose(entries.principal),
      realized_gain: choose(entries.realized_gain),
    };
  });
  return {
    period: { from, to, as_of: ctx.asOf },
    currencies,
    consumption_categories: ["expense", "interest", "refund"].flatMap((category) =>
      ids(rows.filter((r) => r.category === category).map((r) => r.currency)).map((currency) => ({
        category,
        currency,
        total: sum(
          rows
            .filter((r) => r.category === category && r.currency === currency)
            .map((r) => ({
              currency,
              amount: r.reconciliation === "candidate_duplicate" ? null : financeEffects(r).consumption,
              ids: [r.id],
              missing: r.reconciliation === "candidate_duplicate" ? ["candidate_duplicate"] : [],
              date: r.ts.slice(0, 10),
            })),
        ),
      })),
    ),
    excluded: ["transfer", "sale", "loan_in", "loan_repay", "refund"].flatMap((category) =>
      ids(rows.filter((r) => r.category === category).map((r) => r.currency)).map((currency) => ({
        category,
        currency,
        total: sum(
          rows
            .filter((r) => r.category === category && r.currency === currency)
            .map((r) => ({
              currency,
              amount:
                r.reconciliation === "candidate_duplicate" ||
                r.direction_unknown ||
                (category === "refund" && r.reconciliation !== "ok")
                  ? null
                  : category === "sale"
                    ? financeEffects(r).principal
                    : r.amount,
              ids: [r.id],
              missing: [],
              date: r.ts.slice(0, 10),
            })),
        ),
      })),
    ),
    pending: rows
      .filter((r) => r.reconciliation !== "ok")
      .map((r) => ({ record_ids: [r.id], status: r.reconciliation, reason: r.review_reason ?? null })),
    returns_fee_basis:
      rows.some((r) => r.category === "sale") &&
      rows.filter((r) => r.category === "sale").every((r) => r.fees_included === true)
        ? "sales_net_of_fees_plus_separate_fee_tax_records"
        : "fee_coverage_unknown_separate_fee_tax_records_included",
    converted: options.targetCurrency
      ? {
          income: convert(entries.income, options.targetCurrency, ctx.rates),
          consumption: convert(entries.consumption, options.targetCurrency, ctx.rates),
          surplus: convert(surplus, options.targetCurrency, ctx.rates),
          investment_flow: convert(entries.investment_flow, options.targetCurrency, ctx.rates),
          returns: convert(entries.returns, options.targetCurrency, ctx.rates),
        }
      : null,
  };
}
export function financeInvestments(ws: Workspace, options: FinanceViewOptions = {}) {
  const ctx = context(ws, options);
  const latest = latestHoldings(ctx.holdings);
  const holdings = latest.map((h) => {
    const value = holdingValue(h);
    const cost = holdingCost(h);
    const gain = number(
      value.amount === null || cost.amount === null ? null : sub(value.amount, cost.amount),
      [h.id],
      [...value.missing, ...cost.missing],
    );
    return {
      record_ids: [h.id],
      account: h.account,
      as_of: h.ts,
      security_code: h.security_code,
      name: h.name,
      currency: h.currency,
      quantity: number(h.quantity, [h.id], h.quantity === null ? ["quantity_missing"] : []),
      cost,
      valuation: value,
      unrealized_gain: gain,
      snapshot_return: number(
        gain.amount !== null && cost.amount !== null ? div(gain.amount, cost.amount) : null,
        [h.id],
        gain.amount === null
          ? gain.missing
          : cost.amount !== null && decimal(cost.amount).units === 0n
            ? ["zero_cost"]
            : [],
      ),
      snapshot_return_algorithm: "简单未实现收益率 = (估值 - 成本) / 成本，未计时间加权、分红与费用",
      period_return: number(null, [h.id], ["cashflow_history_incomplete"]),
      converted_valuation: options.targetCurrency
        ? convert([entry(h.currency, value, h.ts.slice(0, 10))], options.targetCurrency, ctx.rates)
        : null,
    };
  });
  const investmentRows = ctx.transactions.filter((r) =>
    ["sale", "dividend", "realized_gain", "fee", "tax"].includes(r.category),
  );
  const currencies = ids([
    ...latest.map((r) => r.currency ?? "unknown"),
    ...investmentRows.map((r) => r.currency),
  ]).map((currency) => {
    const hs = holdings.filter((h) => (h.currency ?? "unknown") === currency);
    const ts = investmentRows.filter((t) => t.currency === currency);
    const metric = (category: "dividend" | "realized_gain" | "fee" | "tax") => {
      const selected = ts.filter((t) =>
        category === "realized_gain"
          ? ["sale", "realized_gain"].includes(t.category)
          : t.category === category,
      );
      if (!selected.length)
        return number(
          null,
          hs.flatMap((h) => h.record_ids),
          [`${category}_history_missing`],
        );
      return sum(
        selected.map((t) => {
          const effects = financeEffects(t);
          const value = category === "realized_gain" ? effects.realized_gain : t.amount;
          return {
            currency,
            amount: t.reconciliation === "candidate_duplicate" ? null : value,
            ids: [t.id],
            missing:
              t.reconciliation === "candidate_duplicate"
                ? ["candidate_duplicate"]
                : value === null
                  ? effects.missing
                  : [],
            date: t.ts.slice(0, 10),
          };
        }),
      );
    };
    const aggregate = (key: "cost" | "valuation" | "unrealized_gain") =>
      sum(hs.map((h) => entry(h.currency, h[key], h.as_of.slice(0, 10))));
    return {
      currency,
      cost: aggregate("cost"),
      valuation: aggregate("valuation"),
      unrealized_gain: aggregate("unrealized_gain"),
      dividends: metric("dividend"),
      realized_gain: metric("realized_gain"),
      fees: metric("fee"),
      taxes: metric("tax"),
      period_return: number(
        null,
        [...hs.flatMap((h) => h.record_ids), ...ts.map((t) => t.id)],
        ["cashflow_history_incomplete"],
      ),
      fees_included:
        ts.some((t) => t.category === "sale") &&
        ts.filter((t) => t.category === "sale").every((t) => typeof t.fees_included === "boolean")
          ? ts.filter((t) => t.category === "sale").every((t) => t.fees_included === true)
          : null,
    };
  });
  return {
    period: { from: null, to: ctx.asOf, as_of: ctx.asOf },
    holdings,
    currencies,
    cashflow: null,
    cashflow_missing: ["snapshots_do_not_establish_period_cashflows"],
  };
}
