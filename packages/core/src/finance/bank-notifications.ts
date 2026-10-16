import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { readRecords } from "../records.js";
import { isoInZone, localTimeToInstant, parseTs } from "../time.js";
import { ulid } from "../ulid.js";
import { type Workspace, stateDirectory } from "../workspace.js";
import { abs, decimal, equal, neg } from "./decimal.js";
import type { FinanceTransaction } from "./types.js";

export interface BankMail {
  sender: string;
  subject: string;
  text: string;
  time: string;
}
export interface BankNotification {
  bank: "cmb" | "icbc" | "ccb" | "boc";
  amount: string;
  currency: string;
  direction: "income" | "expense";
  account_last4: string;
  counterparty: string | null;
  ts: string;
  received_at: string;
  time_basis: "transaction" | "received";
}
export interface BankNotificationCandidate extends BankNotification {
  id: string;
  transaction_id: string | null;
}
// 待核对的银行通知只存本机状态目录，不进同步盘。
const save = (ws: Workspace, rows: BankNotificationCandidate[]) => {
  mkdirSync(dirname(file(ws)), { recursive: true });
  writeFileSync(file(ws), `${JSON.stringify(rows, null, 2)}\n`, { mode: 0o600 });
};
const file = (ws: Workspace) => join(stateDirectory(ws.root), "finance-notifications.json");

export function parseBankNotification(mail: BankMail): BankNotification | null {
  try {
    const received = parseTs(mail.time);
    const address = mail.sender.match(/<?([^<>\s]+@[^<>\s]+)>?/)?.[1]?.toLowerCase();
    const domain = address?.split("@")[1];
    const banks = [
      ["cmb", "招商银行", /(?:^|\.)cmbchina\.com$/],
      ["icbc", "工商银行", /(?:^|\.)icbc\.com\.cn$/],
      ["ccb", "建设银行", /(?:^|\.)ccb\.(?:com|cn|com\.cn)$/],
      ["boc", "中国银行", /(?:^|\.)boc\.(?:cn|com)$/],
    ] as const;
    const bank = banks.find(
      ([, name, pattern]) => domain && pattern.test(domain) && (mail.subject + mail.text).includes(name),
    );
    if (!bank || !/动账|交易|消费|账户变动|收支|入账|扣款/.test(mail.subject)) return null;
    if (/未成功|交易失败|支付失败|验证码|还款提醒|应还金额/.test(mail.text)) return null;
    const text = mail.text.replaceAll("，", ",").replaceAll("：", ":");
    const tails = [...text.matchAll(/(?:尾号|末四位|卡号后四位)\D{0,6}(\d{4})(?!\d)/g)];
    const tail = tails[0]?.[1];
    if (!tail || new Set(tails.map((m) => m[1])).size !== 1) return null;
    const amounts = [
      ...text.matchAll(
        /(消费|支付|支出|扣款|入账|收入|存入|转入|转出|收款|取款|退款)(?:金额)?\s*[:为]?\s*(人民币|RMB|CNY|美元|USD|港币|HKD)?\s*([\d,]+(?:\.\d+)?)\s*(元|人民币|RMB|CNY|美元|USD|港币|HKD)?/g,
      ),
    ];
    if (amounts.length !== 1) return null;
    const matched = amounts[0];
    if (!matched) return null;
    const code = matched[2] || matched[4];
    const currency =
      code &&
      (
        {
          人民币: "CNY",
          RMB: "CNY",
          CNY: "CNY",
          元: "CNY",
          美元: "USD",
          USD: "USD",
          港币: "HKD",
          HKD: "HKD",
        } as Record<string, string>
      )[code];
    if (!currency) return null;
    const amount = (matched[3] ?? "").replaceAll(",", "");
    if (decimal(amount).units <= 0n) return null;
    const direction = /入账|收入|存入|转入|收款|退款/.test(matched[1] ?? "") ? "income" : "expense";
    let ts = received.toISOString();
    let timeBasis: "received" | "transaction" = "received";
    const full = text.match(/(\d{4})[-年/](\d{1,2})[-月/](\d{1,2})日?[ T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    const short = text.match(/(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (full || short) {
      const zoneDate = isoInZone(received, "Asia/Shanghai");
      let year = full ? Number(full[1]) : Number(zoneDate.slice(0, 4));
      const month = full ? full[2] : short?.[1];
      const day = full ? full[3] : short?.[2];
      if (!full && Number(month) === 12 && zoneDate.slice(5, 7) === "01") year--;
      const hour = full ? full[4] : short?.[3];
      const minute = full ? full[5] : short?.[4];
      const second = (full ? full[6] : short?.[5]) || "00";
      const wall = `${year}-${month?.padStart(2, "0")}-${day?.padStart(2, "0")}T${hour?.padStart(2, "0")}:${minute}:${second}`;
      ts = isoInZone(localTimeToInstant(wall, "Asia/Shanghai"), "Asia/Shanghai");
      timeBasis = "transaction";
    }
    const merchant =
      text.match(/(?:商户(?:名称)?|对方(?:户名)?|交易对手)\s*:\s*([^,。;\n]+)/)?.[1] ??
      text.match(/在([^,。;\n]{1,80}?)(?:消费|支付)/)?.[1] ??
      null;
    return {
      bank: bank[0],
      amount: direction === "expense" ? neg(abs(amount)) : amount,
      currency,
      direction,
      account_last4: tail,
      counterparty: merchant?.trim() || null,
      ts,
      received_at: mail.time,
      time_basis: timeBasis,
    };
  } catch {
    return null;
  }
}
function savedCandidates(ws: Workspace): BankNotificationCandidate[] {
  return existsSync(file(ws))
    ? (JSON.parse(readFileSync(file(ws), "utf8")) as BankNotificationCandidate[])
    : [];
}
function key(c: BankNotification) {
  return JSON.stringify([c.bank, c.account_last4, c.currency, c.amount, c.ts, c.counterparty]);
}
function matchCandidates(candidates: BankNotificationCandidate[], records: FinanceTransaction[]) {
  const matches = (candidate: BankNotificationCandidate) =>
    records.filter(
      (record) =>
        (!["cmb", "icbc", "ccb", "boc"].includes(record.source) || record.source === candidate.bank) &&
        record.account_last4 === candidate.account_last4 &&
        record.currency === candidate.currency &&
        equal(record.amount, candidate.amount) &&
        Math.abs(Date.parse(record.ts) - Date.parse(candidate.ts)) <= 86400000,
    );
  const results = new Map(candidates.map((c) => [c.id, matches(c)]));
  return candidates.map((candidate) => {
    const rows = results.get(candidate.id) ?? [];
    const row = rows[0];
    const unique =
      row &&
      rows.length === 1 &&
      candidates.filter((c) => results.get(c.id)?.some((r) => r.id === row.id)).length === 1;
    return { ...candidate, transaction_id: unique ? row.id : null };
  });
}
export function bankNotificationCandidates(ws: Workspace, asOf?: string): BankNotificationCandidate[] {
  const until = asOf ? parseTs(asOf).getTime() : Number.POSITIVE_INFINITY;
  return matchCandidates(
    savedCandidates(ws).filter((c) => Date.parse(c.ts) <= until),
    (readRecords(ws, "finance_transaction") as FinanceTransaction[]).filter((r) => Date.parse(r.ts) <= until),
  );
}
export function refreshBankNotificationMatches(ws: Workspace): void {
  if (!existsSync(file(ws))) return;
  const old = savedCandidates(ws);
  const matched = bankNotificationCandidates(ws);
  if (!isDeepStrictEqual(old, matched)) save(ws, matched);
}
export function receiveBankNotification(ws: Workspace, mail: BankMail) {
  const parsed = parseBankNotification(mail);
  if (!parsed) return { recognized: false, added: false, candidate: null };
  const rows = savedCandidates(ws);
  const existing = rows.find((c) => key(c) === key(parsed));
  if (existing)
    return {
      recognized: true,
      added: false,
      candidate: bankNotificationCandidates(ws).find((c) => c.id === existing.id) ?? existing,
    };
  const candidate: BankNotificationCandidate = { ...parsed, id: ulid(), transaction_id: null };
  rows.push(candidate);
  const matched = matchCandidates(rows, readRecords(ws, "finance_transaction") as FinanceTransaction[]);
  save(ws, matched);
  return {
    recognized: true,
    added: true,
    candidate: matched.find((c) => c.id === candidate.id) ?? candidate,
  };
}
