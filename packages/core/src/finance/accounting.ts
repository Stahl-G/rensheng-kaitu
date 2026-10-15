import { abs, add, decimal, equal, neg, sub } from "./decimal.js";
import type { FinanceCategory, FinanceTransaction } from "./types.js";

/** 中国账单文字到统一类别与资金方向的确定性映射。 */
export function classifyFinanceEntry(input: {
  classification: string;
  description: string;
  direction: string;
  status: string;
  amount: string;
}) {
  const text = input.classification + input.description;
  const investment = /投资|理财|基金|证券|股票/.test(text);
  let category: FinanceCategory;
  if (input.status.includes("退款成功")) category = "refund";
  else if (investment && /卖出|赎回/.test(text)) category = "sale";
  else if (investment && /买入|申购/.test(text)) category = "buy";
  else if (/分红/.test(input.classification)) category = "dividend";
  else if (/手续费/.test(input.classification)) category = "fee";
  else if (/税/.test(input.classification)) category = "tax";
  else if (/还款/.test(input.classification)) category = "loan_repay";
  else if (/借款|贷款/.test(input.classification)) category = "loan_in";
  else if (/利息/.test(input.classification)) category = "interest";
  else if (input.direction === "不计收支" || /转账|提现|充值/.test(text)) category = "transfer";
  else category = input.direction === "收入" ? "income" : "expense";
  const outgoing = input.direction === "支出" || (input.direction === "不计收支" && /提现|转出/.test(text));
  return {
    category,
    amount: category === "refund" ? abs(input.amount) : outgoing ? neg(input.amount) : input.amount,
    direction_unknown:
      category === "transfer" && input.direction === "不计收支" && !/提现|转出|充值|转入/.test(text),
    reconciliation: ["transfer", "refund"].includes(category) ? ("pending_review" as const) : ("ok" as const),
  };
}

/** 四类口径共用的纯函数；金额带方向，消费输出正数，退款输出负消费。 */
export function financeEffects(t: FinanceTransaction) {
  const zero = "0";
  const result: {
    income: string;
    consumption: string;
    investment_flow: string;
    returns: string | null;
    principal: string | null;
    realized_gain: string | null;
    missing: string[];
    fees_included: boolean | null;
  } = {
    income: zero,
    consumption: zero,
    investment_flow: zero,
    returns: zero,
    principal: zero,
    realized_gain: zero,
    missing: [],
    fees_included: t.fees_included ?? null,
  };
  switch (t.category) {
    case "income":
      result.income = t.amount;
      break;
    case "expense":
    case "interest":
      result.consumption = neg(t.amount);
      break;
    case "refund":
      if (t.reconciliation === "ok" && t.related_ids.length) result.consumption = neg(t.amount);
      else result.missing.push("refund_original_missing");
      break;
    case "buy":
      result.investment_flow = t.amount;
      break;
    case "principal":
      result.investment_flow = t.amount;
      result.principal = t.amount;
      break;
    case "sale":
      result.investment_flow = t.amount;
      result.principal = t.cost ?? null;
      result.realized_gain = t.cost == null ? null : sub(t.amount, t.cost);
      result.returns = result.realized_gain;
      if (t.cost == null) result.missing.push("sale_cost_missing");
      break;
    case "dividend":
    case "realized_gain":
    case "tax":
    case "fee":
      result.returns = t.amount;
      if (t.category === "realized_gain") result.realized_gain = t.amount;
      break;
  }
  return result;
}

export function transactionKey(t: FinanceTransaction): string {
  if (t.source_transaction_id) return JSON.stringify([t.source, t.source_transaction_id]);
  return JSON.stringify([
    t.source,
    t.account,
    new Date(t.ts).toISOString(),
    add(t.amount, "0"),
    t.currency,
    t.counterparty,
    t.description,
  ]);
}
function duplicateFeature(t: FinanceTransaction): string {
  return JSON.stringify([
    t.account,
    t.ts.slice(0, 10),
    add(t.amount, "0"),
    t.currency,
    t.counterparty,
    t.description,
  ]);
}
const link = (a: FinanceTransaction, b: FinanceTransaction) => {
  a.related_ids = [...new Set([...a.related_ids, b.id])].sort();
  b.related_ids = [...new Set([...b.related_ids, a.id])].sort();
};

/** 只返回新对象，不写记录。歧义配对留待核对，跨来源记录保留两份。 */
export function reconcileFinance(input: FinanceTransaction[]): FinanceTransaction[] {
  const rows: FinanceTransaction[] = input.map((r) => ({ ...r, related_ids: [...r.related_ids] }));
  const duplicateGroups = new Map<string, FinanceTransaction[]>();
  for (const row of rows) {
    const key = duplicateFeature(row);
    const group = duplicateGroups.get(key) ?? [];
    for (const other of group) {
      if (row.source === other.source || row.corrected_by_user || other.corrected_by_user) continue;
      row.reconciliation = other.reconciliation = "candidate_duplicate";
      link(row, other);
    }
    group.push(row);
    duplicateGroups.set(key, group);
  }
  const transfers = rows.filter(
    (r) => r.category === "transfer" && r.reconciliation !== "candidate_duplicate" && !r.corrected_by_user,
  );
  const transferGroups = new Map<string, FinanceTransaction[]>();
  for (const row of transfers) {
    const key = JSON.stringify([row.currency, add(row.amount, "0")]);
    const group = transferGroups.get(key) ?? [];
    group.push(row);
    transferGroups.set(key, group);
  }
  const peers = (a: FinanceTransaction) =>
    (transferGroups.get(JSON.stringify([a.currency, add(neg(a.amount), "0")])) ?? []).filter(
      (b) =>
        a.id !== b.id &&
        a.account !== b.account &&
        !a.direction_unknown &&
        !b.direction_unknown &&
        a.currency === b.currency &&
        !equal(a.amount, "0") &&
        equal(a.amount, neg(b.amount)) &&
        Math.abs(Date.parse(a.ts) - Date.parse(b.ts)) <= 3 * 86400000,
    );
  for (const a of transfers) {
    const matches = peers(a);
    const b = matches[0];
    if (b && matches.length === 1 && peers(b).length === 1) {
      link(a, b);
      a.reconciliation = b.reconciliation = "ok";
      a.review_reason = b.review_reason = null;
    } else {
      a.reconciliation = "pending_review";
      a.review_reason = "transfer_counterpart_missing_or_ambiguous";
    }
  }
  for (const refund of rows.filter(
    (r) => r.category === "refund" && r.reconciliation !== "candidate_duplicate" && !r.corrected_by_user,
  )) {
    const explicit = rows.filter((r) => refund.related_ids.includes(r.id) && r.category === "expense");
    const candidates = explicit.length
      ? explicit
      : rows.filter(
          (r) =>
            r.category === "expense" &&
            r.account === refund.account &&
            r.currency === refund.currency &&
            r.counterparty === refund.counterparty &&
            r.description === refund.description &&
            Date.parse(r.ts) <= Date.parse(refund.ts) &&
            decimal(sub(abs(r.amount), abs(refund.amount))).units >= 0n &&
            r.reconciliation !== "candidate_duplicate",
        );
    const original = candidates[0];
    if (candidates.length === 1 && original) {
      const totalRefunds = rows
        .filter(
          (r) =>
            r.id !== refund.id &&
            r.category === "refund" &&
            r.reconciliation === "ok" &&
            r.related_ids.includes(original.id),
        )
        .reduce((sum, r) => add(sum, abs(r.amount)), abs(refund.amount));
      if (decimal(sub(abs(original.amount), totalRefunds)).units >= 0n) {
        link(refund, original);
        refund.reconciliation = "ok";
        refund.review_reason = null;
        continue;
      }
    }
    refund.reconciliation = "pending_review";
    refund.review_reason = "refund_original_missing_or_ambiguous";
  }
  return rows;
}
