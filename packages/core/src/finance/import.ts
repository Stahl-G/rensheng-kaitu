import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { KaituError } from "../errors.js";
import { snapshot } from "../history.js";
import { batchOverview } from "../overview.js";
import { type StoredRecord, addRecords, appendPreparedRecords, readRecords } from "../records.js";
import { isoInZone, localTimeToInstant, parseTs } from "../time.js";
import { discardUpload, stageUpload } from "../ui-imports.js";
import type { Workspace } from "../workspace.js";
import { classifyFinanceEntry, financeEffects, reconcileFinance, transactionKey } from "./accounting.js";
import { parseFinanceCsv } from "./csv.js";
import { decimal } from "./decimal.js";
import type { FinanceTransaction } from "./types.js";

export type FinanceFormat = "alipay-csv" | "holdings-csv";
/** 字段名 → 文件中的列名；null 表示忽略该列。 */
export type FinanceMapping = Record<string, string | null>;
export interface FinanceImportOptions {
  format?: FinanceFormat;
  mapping?: FinanceMapping;
  account?: string;
}
const aliases: Record<string, string[]> = {
  ts: ["交易时间", "快照时间"],
  category: ["交易分类"],
  counterparty: ["交易对方"],
  description: ["商品说明"],
  direction: ["收/支"],
  amount: ["金额"],
  status: ["交易状态"],
  source_transaction_id: ["交易订单号"],
  original_source_transaction_id: ["原交易订单号"],
  security_code: ["证券代码"],
  name: ["证券名称"],
  quantity: ["股票余额", "持仓数量"],
  cost: ["参考成本价", "成本价"],
  price: ["市价"],
  market_value: ["市值"],
  currency: ["币种"],
};
const staged = (file: string) => /^\.kaitu\/cache\/uploads\/[a-f0-9-]+\.csv$/.test(file);
const filePath = (ws: Workspace, file: string) =>
  isAbsolute(file) ? file : ws.resolve(file, { internal: true });
const receiptPath = (file: string) => file.replace(/\.csv$/, ".receipt.json");
const queues = new Map<string, Promise<unknown>>();
export function stageFinanceUpload(ws: Workspace, name: string, bytes: Uint8Array): string {
  return stageUpload(ws, "finance", name, bytes);
}
export function discardFinanceImport(ws: Workspace, file: string): void {
  discardUpload(ws, file);
}
function number(value: string): string | null {
  if (!value || ["--", "-", "N/A"].includes(value)) return null;
  const cleaned = value.replace(/[,，￥¥\s]/g, "");
  decimal(cleaned);
  return cleaned;
}
function currency(value: string): string {
  const code =
    ({ 人民币: "CNY", 人民币元: "CNY", 港币: "HKD", 港元: "HKD", 美元: "USD" } as Record<string, string>)[
      value
    ] ?? value.toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw new Error("币种无效");
  return code;
}
function timestamp(value: string): string {
  if (/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    parseTs(value);
    return value;
  }
  const wall = value.replace(" ", "T");
  // 支付宝账单时间为北京时间；持仓自带时间也按同一已验证的中国券商格式解释。
  return isoInZone(localTimeToInstant(wall, "Asia/Shanghai"), "Asia/Shanghai");
}
function parse(ws: Workspace, file: string, options: FinanceImportOptions) {
  const path = filePath(ws, file);
  const bytes = readFileSync(path);
  let text: string;
  let encoding: "utf-8" | "gbk" = "utf-8";
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder("gbk", { fatal: true }).decode(bytes);
    encoding = "gbk";
  }
  const csv = parseFinanceCsv(text.replace(/^\uFEFF/, ""));
  const rows = csv.rows;
  const headerIndex = rows.findIndex((r) =>
    r.cells.some((c) => ["交易时间", "证券代码", "证券名称"].includes(c.trim())),
  );
  const header = rows[headerIndex];
  if (!header) throw new KaituError("未找到支持的账单或持仓表头", "INVALID_IMPORT");
  const columns = header.cells.map((c) => c.trim());
  const detected: FinanceFormat = columns.includes("交易时间") ? "alipay-csv" : "holdings-csv";
  const format = options.format ?? detected;
  if (format !== detected) throw new KaituError("文件列结构与指定格式不匹配", "INVALID_IMPORT");
  const mapping: FinanceMapping = {};
  for (const [field, names] of Object.entries(aliases))
    mapping[field] = names.find((n) => columns.includes(n)) ?? null;
  for (const [field, column] of Object.entries(options.mapping ?? {})) {
    if (!Object.hasOwn(aliases, field) || (column !== null && !columns.includes(column.trim())))
      throw new KaituError(`字段映射无效：${field}`, "INVALID_IMPORT");
    mapping[field] = column?.trim() ?? null;
  }
  const required = format === "alipay-csv" ? ["ts", "direction", "amount", "status"] : [];
  if (required.some((field) => !mapping[field])) throw new KaituError("缺少必需列映射", "INVALID_IMPORT");
  const now = new Date().toISOString();
  const snapshotAt = isoInZone(statSync(path).mtime, ws.timeZone());
  const hash = createHash("sha256").update(bytes).digest("hex");
  const candidates: { line: number; data: Record<string, unknown> }[] = [];
  const errors = [...csv.errors];
  let ignored = 0;
  for (const row of rows.slice(headerIndex + 1)) {
    if (
      row.cells.length === 1 &&
      /^(?:[-=]+|说明|注[:：]|统计|共\s*\d|导出|账单|收入[:：]|支出[:：]|不计收支[:：]|温馨提示|特别提示|注意事项)/.test(
        row.cells[0] ?? "",
      )
    )
      continue;
    const get = (field: string) => {
      const column = mapping[field];
      return column ? (row.cells[columns.indexOf(column)]?.trim() ?? "") : "";
    };
    try {
      if (row.cells.length !== columns.length) throw new Error("列数与表头不一致");
      const common = {
        schema_version: 1,
        created_at: now,
        updated_at: now,
        source_ids: [format],
        visibility: "private",
        corrected_by_user: false,
        source: format,
        account: options.account ?? "preview-account",
        imported_at: now,
      };
      if (format === "alipay-csv") {
        const status = get("status");
        if (status.includes("交易关闭")) {
          ignored++;
          continue;
        }
        if (!/交易成功|退款成功/.test(status)) throw new Error("交易状态尚未完成或无法识别");
        const direction = get("direction");
        if (!["收入", "支出", "不计收支"].includes(direction)) throw new Error("收支方向无效");
        const amount = number(get("amount"));
        if (amount == null || amount.startsWith("-")) throw new Error("金额缺失或为负数");
        const classified = classifyFinanceEntry({
          classification: get("category"),
          description: get("description"),
          direction,
          status,
          amount,
        });
        const data = {
          ...common,
          ts: timestamp(get("ts")),
          ...classified,
          currency: get("currency") ? currency(get("currency")) : "CNY",
          counterparty: get("counterparty") || null,
          description: get("description") || null,
          source_transaction_id: get("source_transaction_id") || null,
          original_source_transaction_id: get("original_source_transaction_id") || null,
          related_ids: [],
        };
        candidates.push({ line: row.line, data });
      } else {
        const security = get("security_code").replace(/^['=" ]+|[" ]+$/g, "") || null;
        if (!security && !get("name")) throw new Error("证券代码和名称均缺失");
        candidates.push({
          line: row.line,
          data: {
            ...common,
            ts: get("ts") ? timestamp(get("ts")) : snapshotAt,
            security_code: security,
            name: get("name") || null,
            quantity: number(get("quantity")),
            cost: number(get("cost")),
            price: number(get("price")),
            market_value: number(get("market_value")),
            currency: get("currency") ? currency(get("currency")) : null,
            // 成本列为每单位成本，估值时乘数量。文件哈希仅用于识别外部快照重投。
            import_key: `${hash}:${row.line}`,
          },
        });
      }
    } catch (error) {
      errors.push({ line: row.line, reason: (error as Error).message });
    }
  }
  return { format, encoding, columns, mapping, candidates, errors, ignored };
}
function plan(ws: Workspace, parsed: ReturnType<typeof parse>, account?: string) {
  const type = parsed.format === "alipay-csv" ? "finance_transaction" : "finance_holding_snapshot";
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
export function previewFinanceImport(ws: Workspace, file: string, options: FinanceImportOptions = {}) {
  const parsed = parse(ws, file, options);
  const batch = plan(ws, parsed, options.account);
  const timestamps = parsed.candidates
    .map((r) => String(r.data.ts))
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  return {
    format: parsed.format,
    encoding: parsed.encoding,
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
  const parsed = parse(ws, file, options);
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
