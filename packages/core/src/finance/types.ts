import type { StoredRecord } from "../records.js";
export type FinanceCategory =
  | "income"
  | "expense"
  | "transfer"
  | "buy"
  | "sale"
  | "principal"
  | "realized_gain"
  | "dividend"
  | "tax"
  | "fee"
  | "refund"
  | "loan_in"
  | "loan_repay"
  | "interest";
export interface FinanceAccount extends StoredRecord {
  name: string;
  kind: "cash" | "bank" | "wallet" | "securities" | "credit" | "loan";
  currency: string;
  source: string;
  balance?: string | null;
  balance_at?: string;
}
export interface FinanceTransaction extends StoredRecord {
  account: string;
  amount: string;
  currency: string;
  category: FinanceCategory;
  counterparty: string | null;
  description: string | null;
  source: string;
  source_transaction_id: string | null;
  related_ids: string[];
  reconciliation: "ok" | "pending_review" | "candidate_duplicate";
  source_status?: string | null;
  source_direction?: string | null;
  account_last4?: string | null;
  direction_unknown?: boolean;
  original_source_transaction_id?: string | null;
  cost?: string | null;
  fees_included?: boolean | null;
  review_reason?: string | null;
  imported_at?: string;
}
export interface FinanceHolding extends StoredRecord {
  account: string;
  security_code: string | null;
  name: string | null;
  quantity: string | null;
  cost: string | null;
  price: string | null;
  market_value: string | null;
  currency: string | null;
  source: string;
  imported_at?: string;
}
export interface FinanceFxRate extends StoredRecord {
  date: string;
  from_currency: string;
  to_currency: string;
  rate: string;
  source: string;
}
export interface FinanceNumber {
  amount: string | null;
  record_ids: string[];
  missing: string[];
}
export interface FinancePeriod {
  from: string | null;
  to: string | null;
  as_of: string;
}
