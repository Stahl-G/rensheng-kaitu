import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { KaituError } from "../errors.js";
import { snapshot } from "../history.js";
import { batchOverview } from "../overview.js";
import { type StoredRecord, addRecords, appendPreparedRecords, readRecords } from "../records.js";
import { isoInZone } from "../time.js";
import { discardUpload, stageUpload } from "../ui-imports.js";
import type { Workspace } from "../workspace.js";
import { financeEffects, reconcileFinance, transactionKey } from "./accounting.js";
import { refreshBankNotificationMatches } from "./bank-notifications.js";
import { readFinanceDocument } from "./document.js";
import { parseIbkr } from "./providers/ibkr.js";
import { currency } from "./providers/shared.js";
import { type FinanceFormat, type FinanceMapping, parseFinanceTable } from "./providers/tables.js";
import type { FinanceTransaction } from "./types.js";

export type { FinanceFormat, FinanceMapping } from "./providers/tables.js";
export interface FinanceImportOptions {
  format?: FinanceFormat;
  mapping?: FinanceMapping;
  sheet?: string;
  tradeDate?: string;
  accountLast4?: string;
  account?: string;
}
const staged = (file: string) => /^\.kaitu\/cache\/uploads\/[a-f0-9-]+\.(csv|xml|xls|xlsx)$/.test(file);
const filePath = (ws: Workspace, file: string) =>
  isAbsolute(file) ? file : ws.resolve(file, { internal: true });
const receiptPath = (file: string) => file.replace(/\.(csv|xml|xls|xlsx)$/, ".receipt.json");
const queues = new Map<string, Promise<unknown>>();
export function stageFinanceUpload(ws: Workspace, name: string, bytes: Uint8Array): string {
  return stageUpload(ws, "finance", name, bytes);
}
export function discardFinanceImport(ws: Workspace, file: string): void {
  discardUpload(ws, file);
}
async function parse(ws: Workspace, file: string, options: FinanceImportOptions) {
  if (
    options.accountLast4 !== undefined &&
    (typeof options.accountLast4 !== "string" || !/^\d{4}$/.test(options.accountLast4))
  )
    throw new KaituError("银行卡尾号须为四位数字", "INVALID_IMPORT");
  const path = filePath(ws, file);
  const bytes = readFileSync(path);
  const document = await readFinanceDocument(bytes, options.sheet);
  const { text, encoding } = document;
  const snapshotAt = isoInZone(statSync(path).mtime, ws.timeZone());
  const isXml = /^\s*(?:<\?xml[^>]*>\s*)?<FlexQueryResponse[\s>]/.test(text);
  const parsed = isXml ? parseIbkr(text) : parseFinanceTable(document.rows, options, snapshotAt);
  if (options.format && options.format !== parsed.format)
    throw new KaituError("文件列结构与指定格式不匹配", "INVALID_IMPORT");
  const now = new Date().toISOString();
  const hash = createHash("sha256").update(bytes).digest("hex");
  const candidates: { line: number; data: Record<string, unknown> }[] = parsed.candidates.map((row) => ({
    ...row,
    data: {
      schema_version: 1,
      created_at: now,
      updated_at: now,
      source_ids: [parsed.format],
      visibility: "private",
      corrected_by_user: false,
      source: parsed.format,
      account: options.account ?? "preview-account",
      imported_at: now,
      ...row.data,
      ...(parsed.kind === "finance_transaction"
        ? { account_last4: row.data.account_last4 ?? options.accountLast4 ?? null }
        : {}),
      ...(parsed.kind === "finance_holding_snapshot"
        ? {
            currency: row.data.currency ? currency(String(row.data.currency)) : null,
            import_key: `${hash}:${row.line}`,
          }
        : {}),
    },
  }));
  return {
    ...parsed,
    candidates,
    encoding,
    sheet: document.sheet,
    errors: [...(isXml ? [] : document.errors), ...parsed.errors],
  };
}
function plan(ws: Workspace, parsed: Awaited<ReturnType<typeof parse>>, account?: string) {
  const type = parsed.kind;
  const existing = readRecords(ws, type);
  const key = (r: StoredRecord) =>
    type === "finance_transaction"
      ? transactionKey(r as FinanceTransaction)
      : JSON.stringify([r.source, account ? r.account : "", r.import_key]);
  const keys = new Set(existing.map(key));
  const data: Record<string, unknown>[] = [];
  let skipped = 0;
  for (const candidate of parsed.candidates) {
    const record = candidate.data as StoredRecord;
    const natural = key(record);
    if (keys.has(natural)) skipped++;
    else {
      keys.add(natural);
      data.push(candidate.data);
    }
  }
  const prepared = addRecords(ws, type, data, { by: `import:${parsed.format}`, dryRun: true });
  let records = prepared.map((p) => p.record);
  let updates: StoredRecord[] = [];
  if (type === "finance_transaction") {
    const all = ([...existing, ...records] as FinanceTransaction[]).map((r) => ({
      ...r,
      related_ids: [...r.related_ids],
    }));
    for (const row of all) {
      const sourceId = row.original_source_transaction_id;
      if (row.category === "refund" && sourceId) {
        const original = all.find(
          (r) => r.source === row.source && r.source_transaction_id === sourceId && r.category === "expense",
        );
        if (original) row.related_ids = [...new Set([...row.related_ids, original.id])];
      }
    }
    const reconciled = reconcileFinance(all);
    const newIds = new Set(records.map((r) => r.id));
    records = reconciled
      .filter((r) => newIds.has(r.id))
      .map((r) => {
        const effects = financeEffects(r);
        return effects.missing.length && !r.review_reason
          ? { ...r, review_reason: effects.missing.join(",") }
          : r;
      });
    // 只有新增时才调整既存记录；重复投递绝不生成版本。
    if (records.length)
      updates = reconciled
        .filter(
          (r) =>
            !newIds.has(r.id) &&
            !isDeepStrictEqual(
              r,
              existing.find((p) => p.id === r.id),
            ),
        )
        .map((r) => ({
          ...r,
          rev: (r.rev ?? 1) + 1,
          by: `import:${parsed.format}`,
          updated_at: new Date().toISOString(),
        }));
  }
  return { type, records, updates, skipped };
}
export async function previewFinanceImport(ws: Workspace, file: string, options: FinanceImportOptions = {}) {
  const parsed = await parse(ws, file, options);
  const batch = plan(ws, parsed, options.account);
  const timestamps = parsed.candidates
    .map((r) => String(r.data.ts))
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  return {
    format: parsed.format,
    encoding: parsed.encoding,
    sheet: parsed.sheet,
    columns: parsed.columns,
    mapping: parsed.mapping,
    account: options.account ?? null,
    period: { from: timestamps[0] ?? null, to: timestamps.at(-1) ?? null },
    currencies: [...new Set(parsed.candidates.map((r) => r.data.currency as string | null))],
    rows: parsed.candidates.slice(0, 20).map((r) => ({
      line: r.line,
      ts: String(r.data.ts),
      account: String(r.data.account),
      amount: (r.data.amount as string | null | undefined) ?? null,
      currency: (r.data.currency as string | null | undefined) ?? null,
      category: (r.data.category as string | null | undefined) ?? null,
      counterparty: (r.data.counterparty as string | null | undefined) ?? null,
      description: (r.data.description as string | null | undefined) ?? null,
      source: String(r.data.source),
      source_transaction_id: (r.data.source_transaction_id as string | null | undefined) ?? null,
      source_status: (r.data.source_status as string | null | undefined) ?? null,
      source_direction: (r.data.source_direction as string | null | undefined) ?? null,
      account_last4: (r.data.account_last4 as string | null | undefined) ?? null,
      original_source_transaction_id:
        (r.data.original_source_transaction_id as string | null | undefined) ?? null,
      reconciliation: (r.data.reconciliation as string | null | undefined) ?? null,
      security_code: (r.data.security_code as string | null | undefined) ?? null,
      name: (r.data.name as string | null | undefined) ?? null,
      quantity: (r.data.quantity as string | null | undefined) ?? null,
      cost: (r.data.cost as string | null | undefined) ?? null,
      price: (r.data.price as string | null | undefined) ?? null,
      market_value: (r.data.market_value as string | null | undefined) ?? null,
    })),
    added: batch.records.length,
    skipped: batch.skipped,
    ignored: parsed.ignored,
    candidate_duplicate: batch.records.filter((r) => r.reconciliation === "candidate_duplicate").length,
    pending_review: batch.records.filter((r) => r.reconciliation === "pending_review").length,
    errors: parsed.errors,
  };
}
async function commit(ws: Workspace, file: string, options: FinanceImportOptions & { account: string }) {
  if (!readRecords(ws, "finance_account").some((a) => a.id === options.account))
    throw new KaituError("请先选择已存在的财务账户", "INVALID_IMPORT");
  const receipt = staged(file) ? receiptPath(file) : null;
  if (!existsSync(filePath(ws, file)) && receipt && ws.exists(receipt)) {
    const saved = ws.readJson<{ options: FinanceImportOptions; added: number; skipped: number }>(receipt);
    if (!isDeepStrictEqual(saved.options, options))
      throw new KaituError("已提交文件的参数不能修改，请重新上传", "INVALID_IMPORT");
    return { added: 0, skipped: saved.added + saved.skipped, updated: 0, version: null };
  }
  const parsed = await parse(ws, file, options);
  if (parsed.errors.length)
    throw new KaituError(
      `整批未写入：${parsed.errors.map((r) => `${r.line} 行 ${r.reason}`).join("；")}`,
      "INVALID_IMPORT",
    );
  const batch = plan(ws, parsed, options.account);
  let version: string | null = null;
  if (batch.records.length) {
    await batchOverview(ws, async () =>
      appendPreparedRecords(
        ws,
        [...batch.records, ...batch.updates].map((record) => ({ type: batch.type, record })),
      ),
    );
    version = await snapshot(ws, `导入财务（${parsed.format}）${batch.records.length} 条`);
  }
  refreshBankNotificationMatches(ws);
  const result = {
    added: batch.records.length,
    skipped: batch.skipped,
    updated: batch.updates.length,
    version,
  };
  if (receipt) {
    ws.writeJson(receipt, { ...result, options }, { internal: true, mode: 0o600 });
    discardUpload(ws, file);
  }
  return result;
}
export async function commitFinanceImport(
  ws: Workspace,
  file: string,
  options: FinanceImportOptions & { account: string },
) {
  const previous = queues.get(ws.root) ?? Promise.resolve();
  const operation = previous.catch(() => {}).then(() => commit(ws, file, options));
  queues.set(ws.root, operation);
  try {
    return await operation;
  } finally {
    if (queues.get(ws.root) === operation) queues.delete(ws.root);
  }
}
