// Adapted from double-entry-generator (Apache-2.0), Copyright deb-sig contributors
import { isoInZone, localTimeToInstant, parseTs } from "../../time.js";
import { classifyFinanceEntry } from "../accounting.js";
import { abs, decimal, neg, sub } from "../decimal.js";
import type { FinanceCategory } from "../types.js";

export function clean(value: string): string {
  return value
    .trim()
    .replace(/^="(.*)"$/, "$1")
    .replace(/^'/, "");
}
export function money(value: string): string | null {
  const text = clean(value).replace(/\(已退款[\d.]+\)$|\(已全额退款\)$/, "");
  if (!text || ["--", "-", "/", "N/A"].includes(text)) return null;
  const result = text.replace(/[,，￥¥\s]/g, "").replace(/^CNY|元$/g, "");
  decimal(result);
  return result;
}
export function requiredMoney(value: string): string {
  const result = money(value);
  if (result === null) throw new Error("金额缺失");
  return result;
}
export function currency(value: string): string {
  const result =
    ({ 人民币: "CNY", 人民币元: "CNY", 港币: "HKD", 港元: "HKD", 美元: "USD" } as Record<string, string>)[
      value
    ] ?? value.toUpperCase();
  if (!/^[A-Z]{3}$/.test(result)) throw new Error("币种无法识别");
  return result;
}
export function timestamp(value: string, time = ""): string {
  if (/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    parseTs(value);
    return value;
  }
  let wall = clean(value)
    .replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3")
    .replaceAll("/", "-");
  if (/^\d{4}-\d{2}-\d{2}$/.test(wall)) wall += `T${time || "00:00:00"}`;
  else wall = wall.replace(" ", "T");
  if (/T\d{2}:\d{2}$/.test(wall)) wall += ":00";
  return isoInZone(localTimeToInstant(wall, "Asia/Shanghai"), "Asia/Shanghai");
}
export function last4(value: string): string | null {
  return clean(value).match(/(?:^|\D)(\d{4})\)?$/)?.[1] ?? clean(value).match(/\d{4}$/)?.[0] ?? null;
}
export function netAmount(income: string, expense: string): string {
  const incoming = money(income) ?? "0";
  const outgoing = money(expense) ?? "0";
  if (decimal(incoming).units < 0n || decimal(outgoing).units < 0n) throw new Error("收入支出列金额不能为负");
  if (incoming === "0" && outgoing === "0") throw new Error("收支金额均为空或为零");
  if (decimal(outgoing).units === 0n) return incoming;
  if (decimal(incoming).units === 0n) return neg(outgoing);
  return sub(incoming, outgoing);
}
export interface EntryInput {
  ts: string;
  amount: string;
  currency?: string;
  direction?: string;
  classification?: string;
  description?: string;
  counterparty?: string;
  status?: string;
  id?: string;
  originalId?: string;
  last4?: string | null;
  category?: FinanceCategory;
  feesIncluded?: boolean;
}
export function transaction(input: EntryInput): Record<string, unknown> {
  const amount = requiredMoney(input.amount);
  const direction = input.direction ?? (decimal(amount).units < 0n ? "支出" : "收入");
  const classification = input.classification ?? "";
  const status = input.status ?? "";
  const classified = classifyFinanceEntry({
    classification,
    description: input.description ?? "",
    direction,
    status,
    amount: abs(amount),
  });
  const category = input.category ?? classified.category;
  return {
    ts: input.ts,
    ...classified,
    category,
    amount: input.category ? amount : classified.amount,
    currency: currency(input.currency || "CNY"),
    counterparty: input.counterparty || null,
    description: input.description || classification || null,
    source_transaction_id: input.id || null,
    original_source_transaction_id: input.originalId || null,
    source_status: input.status || null,
    source_direction: input.direction || direction,
    account_last4: input.last4 ?? null,
    related_ids: [],
    reconciliation: ["transfer", "refund"].includes(category) ? "pending_review" : "ok",
    ...(input.feesIncluded === undefined ? {} : { fees_included: input.feesIncluded }),
  };
}
export function directed(value: string, outgoing: boolean): string {
  const amount = abs(requiredMoney(value));
  return outgoing ? neg(amount) : amount;
}
