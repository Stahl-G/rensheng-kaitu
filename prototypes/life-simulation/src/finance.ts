/** All balances and journal amounts are integer fen (1 RMB = 100 fen). */
export const yuan = (value: number) => Math.round(value * 100);
export type Account = "cash" | "deposits" | "bonds" | "stocks" | "property" | "debt";
export interface BalanceSheet {
  cash: number;
  deposits: number;
  bonds: number;
  stocks: number;
  property: number;
  debt: number;
  interestRate: number;
}
export interface Entry {
  label: string;
  kind: "income" | "expense" | "return" | "transfer";
  amount: number;
}
export interface Journal {
  opening: number;
  entries: Entry[];
  closing: number;
  arrears: number;
  principalPaid: number;
}
export const netWorth = (b: BalanceSheet) => b.cash + b.deposits + b.bonds + b.stocks + b.property - b.debt;
export const liquid = (b: BalanceSheet) => b.cash + b.deposits;
export function openJournal(b: BalanceSheet): Journal {
  return { opening: netWorth(b), closing: netWorth(b), entries: [], arrears: 0, principalPaid: 0 };
}
export function income(b: BalanceSheet, j: Journal, requested: number, label: string) {
  const amount = Math.max(0, Math.round(requested));
  b.cash += amount;
  j.entries.push({ label, kind: "income", amount });
}
export function transfer(
  b: BalanceSheet,
  j: Journal,
  from: Exclude<Account, "debt">,
  to: Exclude<Account, "debt">,
  requested: number,
  label: string,
) {
  const amount = Math.min(b[from], Math.max(0, Math.round(requested)));
  b[from] -= amount;
  b[to] += amount;
  j.entries.push({ label, kind: "transfer", amount });
  return amount;
}
export function borrow(b: BalanceSheet, j: Journal, requested: number) {
  const amount = Math.max(0, Math.round(requested));
  b.cash += amount;
  b.debt += amount;
  j.entries.push({ label: "loan", kind: "transfer", amount });
}
function makeCash(b: BalanceSheet, j: Journal, amount: number) {
  if (b.cash < amount) transfer(b, j, "deposits", "cash", amount - b.cash, "withdrawal");
}
export function expense(b: BalanceSheet, j: Journal, requested: number, label: string) {
  const amount = Math.max(0, Math.round(requested));
  makeCash(b, j, amount);
  const unpaid = Math.max(0, amount - b.cash);
  b.debt += unpaid;
  b.cash = Math.max(0, b.cash - amount);
  j.arrears += unpaid;
  j.entries.push({ label, kind: "expense", amount });
}
export function repay(b: BalanceSheet, j: Journal, requested: number, reserve = 0) {
  const due = Math.min(b.debt, Math.max(0, Math.round(requested)));
  const paid = Math.min(due, Math.max(0, liquid(b) - reserve));
  makeCash(b, j, paid);
  b.cash -= paid;
  b.debt -= paid;
  j.principalPaid += paid;
  j.arrears += due - paid;
  j.entries.push({ label: "principal", kind: "transfer", amount: paid });
  return paid;
}
export function assetReturn(
  b: BalanceSheet,
  j: Journal,
  asset: "deposits" | "bonds" | "stocks" | "property",
  rate: number,
) {
  const gain = Math.max(-b[asset], Math.round(b[asset] * rate));
  b[asset] += gain;
  j.entries.push({ label: asset, kind: "return", amount: gain });
}
export function closeJournal(b: BalanceSheet, j: Journal) {
  j.closing = netWorth(b);
  const expected =
    j.opening +
    j.entries.reduce(
      (sum, e) => sum + (e.kind === "expense" ? -e.amount : e.kind === "transfer" ? 0 : e.amount),
      0,
    );
  if (expected !== j.closing) throw new Error(`Unbalanced journal: ${expected} != ${j.closing}`);
  if (
    Object.entries(b).some(
      ([key, value]) => key !== "interestRate" && (!Number.isSafeInteger(value) || value < 0),
    )
  )
    throw new Error("Invalid balance");
  return j;
}
