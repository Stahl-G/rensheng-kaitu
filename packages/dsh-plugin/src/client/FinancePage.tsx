import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type {
  FinanceAccountsData,
  FinanceCashflowData,
  FinanceImportCommitData,
  FinanceImportPreviewData,
  FinanceInvestmentsData,
  FinanceOverviewData,
  FinanceRemoteCommitOptions,
  FinanceRemoteImportOptions,
  FinanceRemoteViewOptions,
} from "../types.js";
import css from "./FinancePage.module.css";
import { useLocale, useT } from "./i18n.js";

export interface FinancePageProps {
  loadFinanceOverview: (options?: FinanceRemoteViewOptions) => Promise<FinanceOverviewData>;
  loadFinanceCashflow: (
    from: string,
    to: string,
    options?: FinanceRemoteViewOptions,
  ) => Promise<FinanceCashflowData>;
  loadFinanceInvestments: (options?: FinanceRemoteViewOptions) => Promise<FinanceInvestmentsData>;
  loadFinanceAccounts: (options?: FinanceRemoteViewOptions) => Promise<FinanceAccountsData>;
  previewFinanceImport: (
    name: string,
    base64: string,
    options?: FinanceRemoteImportOptions,
  ) => Promise<FinanceImportPreviewData>;
  commitFinanceImport: (
    file: string,
    options: FinanceRemoteCommitOptions,
  ) => Promise<FinanceImportCommitData>;
  discardFinanceImport: (file: string) => Promise<void>;
  onPrompt: (text: string) => void;
  today?: string;
  timeZone?: string;
}
type Metric = FinanceOverviewData["currencies"][number]["cash"];
type Conversion = NonNullable<FinanceOverviewData["converted"]>["cash"];
type Ledger = FinanceOverviewData["records"];
const tabs = ["总览", "收支", "投资", "账户"];
const overviewMetrics = [
  ["cash", "现金"],
  ["investment_assets", "投资资产"],
  ["liabilities", "负债"],
  ["total_assets", "总资产"],
  ["net_assets", "净资产"],
] as const;
const accountKinds = {
  cash: "现金",
  bank: "银行",
  wallet: "电子钱包",
  securities: "证券",
  credit: "信用",
  loan: "借贷",
};
const categories: Record<string, string> = {
  income: "收入",
  expense: "日常消费",
  interest: "利息",
  transfer: "转账",
  buy: "证券买入",
  sale: "证券卖出本金",
  principal: "投资本金",
  realized_gain: "已实现收益",
  dividend: "分红",
  tax: "税费",
  fee: "手续费",
  refund: "退款冲减",
  loan_in: "借入本金",
  loan_repay: "偿还本金",
};
const importSourceNames: Record<string, string> = {
  "alipay-csv": "支付宝",
  "holdings-csv": "持仓表",
  wechat: "微信",
  cmb: "招商银行",
  icbc: "工商银行",
  ccb: "建设银行",
  boc: "中国银行",
  jd: "京东",
  mt: "美团",
  hxsec: "华西证券",
  htsec: "海通证券 / 同花顺成交",
  ibkr: "IBKR",
};
const fields: Record<string, string> = {
  account_last4: "银行卡尾号",
  method: "支付方式",
  ts: "日期",
  direction: "收支方向",
  amount: "金额",
  status: "交易状态",
  currency: "币种",
  category: "类别",
  counterparty: "对手方",
  description: "说明",
  source_transaction_id: "交易单号",
  original_source_transaction_id: "原交易单号",
  security_code: "证券代码",
  name: "证券名称",
  quantity: "数量",
  cost: "单位成本",
  price: "市价",
  market_value: "市值",
  classification: "交易分类",
};
const reasons: Record<string, string> = {
  bank_notification: "银行动账通知，等待账单核对",
  fx_missing: "缺少汇率",
  currency_missing: "币种缺失",
  balance_snapshot_missing: "缺少余额基准",
  holding_valuation_missing: "缺少持仓估值",
  holding_cost_or_quantity_missing: "缺少成本或数量",
  sale_cost_missing: "缺少卖出证券的成本",
  refund_original_missing: "退款尚未关联原消费",
  realized_gain_history_missing: "暂无已实现收益记录",
  dividend_history_missing: "暂无分红记录",
  fee_history_missing: "暂无手续费记录",
  tax_history_missing: "暂无税费记录",
  candidate_duplicate: "疑似重复记录",
  transfer_counterpart_missing_or_ambiguous: "转账另一方缺失或有多个匹配",
  refund_original_missing_or_ambiguous: "退款原交易缺失、有多个匹配或累计退款超出原额",
};
const FINANCE_EN: Record<string, string> = {
  总览: "Overview",
  收支: "Cash flow",
  投资: "Investments",
  账户: "Accounts",
  现金: "Cash",
  投资资产: "Invested assets",
  负债: "Liabilities",
  总资产: "Total assets",
  净资产: "Net assets",
  银行: "Bank",
  电子钱包: "Wallet",
  证券: "Securities",
  信用: "Credit",
  借贷: "Loans",
  收入: "Income",
  日常消费: "Everyday spending",
  消费: "Spending",
  结余: "Surplus",
  利息: "Interest",
  转账: "Transfer",
  证券买入: "Security purchase",
  证券卖出本金: "Sale principal",
  投资本金: "Investment principal",
  已实现收益: "Realized gains",
  未实现收益: "Unrealized gains",
  分红: "Dividends",
  税费: "Taxes",
  手续费: "Fees",
  退款冲减: "Refund offset",
  借入本金: "Borrowed principal",
  偿还本金: "Loan principal repayment",
  支付宝: "Alipay",
  持仓表: "Holdings table",
  微信: "WeChat",
  招商银行: "China Merchants Bank",
  工商银行: "ICBC",
  建设银行: "CCB",
  中国银行: "Bank of China",
  京东: "JD",
  美团: "Meituan",
  华西证券: "Huaxi Securities",
  "海通证券 / 同花顺成交": "Haitong Securities / Tonghuashun trades",
  银行卡尾号: "Last four card digits",
  支付方式: "Payment method",
  日期: "Date",
  收支方向: "Direction",
  金额: "Amount",
  交易状态: "Transaction status",
  币种: "Currency",
  类别: "Category",
  对手方: "Counterparty",
  说明: "Description",
  交易单号: "Transaction ID",
  原交易单号: "Original transaction ID",
  证券代码: "Security code",
  证券名称: "Security name",
  数量: "Quantity",
  单位成本: "Unit cost",
  市价: "Price",
  市值: "Market value",
  交易分类: "Classification",
  "银行动账通知，等待账单核对": "Bank notification awaiting statement review",
  缺少汇率: "Exchange rate missing",
  币种缺失: "Currency missing",
  缺少余额基准: "Balance baseline missing",
  缺少持仓估值: "Holding valuation missing",
  缺少成本或数量: "Cost or quantity missing",
  缺少卖出证券的成本: "Cost of sold securities missing",
  退款尚未关联原消费: "Refund not linked to its purchase",
  暂无已实现收益记录: "No realized gains yet",
  暂无分红记录: "No dividends yet",
  暂无手续费记录: "No fees yet",
  暂无税费记录: "No taxes yet",
  疑似重复记录: "Possible duplicate",
  转账另一方缺失或有多个匹配: "Transfer counterpart missing or ambiguous",
  "退款原交易缺失、有多个匹配或累计退款超出原额": "Refund purchase missing, ambiguous or exceeded",
  存在待核对交易: "Transactions need review",
  暂无记录: "No records yet",
  "（币种未知）": "(currency unknown)",
  币种未知: "Currency unknown",
  资料不完整: "Incomplete data",
  查看组成记录: "View contributing records",
  " · 查看记录": " · View records",
  导入一份账单开始: "Start by importing a statement",
  导入账单: "Import statement",
  "先预览，再确认写入": "Preview before confirming import",
  "请选择不超过 36MB 的 CSV、XML、XLS 或 XLSX 文件。": "Choose a CSV, XML, XLS or XLSX file up to 36 MB.",
  导入到账户: "Import into account",
  新建账户: "New account",
  账户名: "Account name",
  更新预览: "Update preview",
  表格选项: "Table options",
  "银行卡尾号（账单未提供时）": "Last four card digits (if absent from the statement)",
  "成交日（成交表缺少日期时填写）": "Trade date (if absent from the trade table)",
  "工作表名称（多张账单时填写）": "Sheet name (for workbooks with multiple sheets)",
  选择账单或持仓文件: "Choose a statement or holdings file",
  查看列映射: "View column mapping",
  其他字段: "Other field",
  忽略: "Ignore",
  新增: "New",
  已存在: "Already imported",
  疑似重复: "Possible duplicate",
  待核对: "Needs review",
  行号: "Row",
  "对手方 / 证券": "Counterparty / security",
  "原币金额 / 持仓": "Original amount / holding",
  暂无成本: "Cost missing",
  "问题行 · 请修正文件后重新选择": "Rows to fix · Correct the file and choose it again",
  重新选文件: "Choose another file",
  确认导入: "Confirm import",
  放弃: "Cancel",
  "刷新中…": "Refreshing…",
  刷新: "Refresh",
  重新读取: "Reload",
  财务视图: "Finance views",
  "财务读取失败，请重新读取。": "Couldn’t load finance records. Try again.",
  "正在读取财务记录…": "Loading finance records…",
  回到对话核对: "Review in Ask",
  折算为: "Convert to",
  收支期间: "Cash flow period",
  本月: "This month",
  上月: "Last month",
  "近 3 个月": "Last 3 months",
  "正在读取所选期间…": "Loading this period…",
  "所选期间读取失败，请重新读取。": "Couldn’t load this period. Try again.",
  按类别的消费: "Spending by category",
  其他消费: "Other spending",
  暂无消费记录: "No spending yet",
  不计入收支: "Excluded from cash flow",
  其他: "Other",
  "暂无转账、卖出本金、借款本金或退款冲减记录":
    "No transfers, sale principal, loan principal or refund offsets yet",
  持仓: "Holdings",
  暂无持仓记录: "No holdings yet",
  "代码 / 名称": "Code / name",
  成本: "Cost",
  浮动收益: "Unrealized gain",
  暂无代码: "Code missing",
  暂无名称: "Name missing",
  没有行情: "No quote",
  "刷新失败，保留上次参考价": "Refresh failed; showing the last reference price",
  查看余额记录: "View balance records",
  " · 查看交易": " · View transactions",
  余额未知: "Balance unknown",
  已导入: "Imported",
  尚未导入: "Not imported yet",
  需要核对交易: "Transaction needs review",
};
function useFinanceText() {
  const t = useT();
  const label = (value: string) => t(value, FINANCE_EN[value] ?? value);
  function decimal(value: string | null | undefined) {
    if (value == null) return label("暂无记录");
    const [integer = "", fraction] = value.split(".");
    return integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (fraction === undefined ? "" : `.${fraction}`);
  }
  function money(value: string | null | undefined, currency?: string | null) {
    return value == null
      ? label("暂无记录")
      : `${decimal(value)} ${currency && currency !== "unknown" ? currency : label("（币种未知）")}`;
  }
  function reason(value: string | null, fallback: string) {
    if (!value) return label(fallback);
    return value
      .split(",")
      .map((r) =>
        reasons[r]
          ? label(reasons[r] ?? "")
          : r.startsWith("unreconciled:")
            ? label("存在待核对交易")
            : /[_:]/.test(r)
              ? label(fallback)
              : r,
      )
      .join(t("、", ", "));
  }
  return { t, label, decimal, money, reason };
}
function dateRange(today: string, period: string) {
  const [year = 0, month = 1] = today.split("-").map(Number);
  const offset = period === "previous" ? 1 : period === "quarter" ? 2 : 0;
  const from = new Date(Date.UTC(year, month - 1 - offset, 1)).toISOString().slice(0, 10);
  const to =
    period === "previous" ? new Date(Date.UTC(year, month - 1, 0)).toISOString().slice(0, 10) : today;
  return { from, to };
}
function Records({
  ids,
  records,
  stamp,
}: { ids: string[]; records: Ledger; stamp: (value: string) => string }) {
  const { label, money } = useFinanceText();
  const selected = new Set(ids);
  const rows = records.filter((r) => selected.has(r.id));
  return rows.length ? (
    <ul className={css.records}>
      {rows.map((r) => (
        <li key={r.id}>
          <span className={css.muted}>{stamp(r.date)}</span>
          <span>{r.description}</span>
          <strong>{money(r.amount, r.currency)}</strong>
        </li>
      ))}
    </ul>
  ) : (
    <p className={css.empty}>{label("暂无记录")}</p>
  );
}
function NumberDetail({
  label,
  metric,
  currency,
  records,
  stamp,
  note,
}: {
  label: string;
  metric: Metric;
  currency: string;
  records: Ledger;
  stamp: (value: string) => string;
  note?: string;
}) {
  const { t, label: text, money, reason } = useFinanceText();
  return (
    <details className={css.metric}>
      <summary aria-label={t(`${label}，展开记录`, `${label}, show records`)}>
        <span className={css.muted}>{label}</span>
        <strong>{money(metric.record_ids.length ? metric.amount : null, currency)}</strong>
        {note && <small>{note}</small>}
        {!!metric.missing.length && <small>{reason(metric.missing.join(","), "资料不完整")}</small>}
        <span className={css.link}>{text("查看组成记录")}</span>
      </summary>
      <Records ids={metric.record_ids} records={records} stamp={stamp} />
    </details>
  );
}
function Converted({
  value,
  records,
  stamp,
}: { value: Conversion; records: Ledger; stamp: (value: string) => string }) {
  const { t, label, money, decimal, reason } = useFinanceText();
  return (
    <div className={css.conversion}>
      <details>
        <summary>
          {t(
            `折算合计${!value.complete ? "（部分）" : ""}：`,
            `Converted total${!value.complete ? " (partial)" : ""}: `,
          )}
          <strong>{money(value.record_ids.length ? value.amount : null, value.currency)}</strong>
          <span className={css.link}>{label(" · 查看记录")}</span>
        </summary>
        <Records ids={value.record_ids} records={records} stamp={stamp} />
      </details>
      {value.conversions.map((r, i) => (
        <p className={css.muted} key={`${r.currency}-${i}`}>
          {money(r.original_amount, r.currency)} → {money(r.amount, value.currency)} · 1 {r.currency} ={" "}
          {decimal(r.rate)} {value.currency} · {r.rate_date} · {r.rate_source}
        </p>
      ))}
      {!!value.excluded.length && (
        <details className={css.excluded}>
          <summary>
            {t(`未计入合计 · ${value.excluded.length} 项`, `Excluded · ${value.excluded.length}`)}
          </summary>
          {value.excluded.map((r, i) => (
            <div key={`${r.currency}-${i}`}>
              <p>
                {money(r.amount, r.currency)} · {reason(r.reason, "资料不完整")}
              </p>
              <Records ids={r.record_ids} records={records} stamp={stamp} />
            </div>
          ))}
        </details>
      )}
    </div>
  );
}
function Section({ title, children, note }: { title: string; children: ReactNode; note?: string }) {
  return (
    <section className={css.card} aria-label={title}>
      <div className={css.heading}>
        <h2>{title}</h2>
        {note && <span className={css.muted}>{note}</span>}
      </div>
      {children}
    </section>
  );
}
function Empty({ onImport }: { onImport: () => void }) {
  const { label } = useFinanceText();
  return (
    <div className={css.empty}>
      <p>{label("导入一份账单开始")}</p>
      <button type="button" className={css.button} onClick={onImport}>
        {label("导入账单")}
      </button>
    </div>
  );
}
function ImportPanel({
  accounts,
  previewFinanceImport,
  commitFinanceImport,
  discardFinanceImport,
  onClose,
  onImported,
  stamp,
}: {
  accounts: FinanceAccountsData["accounts"];
  previewFinanceImport: FinancePageProps["previewFinanceImport"];
  commitFinanceImport: FinancePageProps["commitFinanceImport"];
  discardFinanceImport: FinancePageProps["discardFinanceImport"];
  onClose: () => void;
  onImported: (result: FinanceImportCommitData) => void;
  stamp: (value: string) => string;
}) {
  const { t, label, money, decimal } = useFinanceText();
  const [account, setAccount] = useState("");
  const [accountName, setAccountName] = useState("");
  const selectedFile = useRef<File>();
  const [tradeDate, setTradeDate] = useState("");
  const [sheet, setSheet] = useState("");
  const [accountLast4, setAccountLast4] = useState("");
  const [preview, setPreview] = useState<FinanceImportPreviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const staged = useRef<string | null>(null);
  const alive = useRef(true);
  const committing = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (staged.current && !committing.current) void discardFinanceImport(staged.current).catch(() => {});
    };
  }, [discardFinanceImport]);
  const upload = async (file?: File, target?: string, name?: string) => {
    if (!file) return;
    if (file.size > 36 * 1024 * 1024 || !/\.(csv|xml|xls|xlsx)$/i.test(file.name)) {
      setError(label("请选择不超过 36MB 的 CSV、XML、XLS 或 XLSX 文件。"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const result = await previewFinanceImport(file.name, base64, {
        account: target || undefined,
        accountName: target ? undefined : name,
        tradeDate: tradeDate || undefined,
        sheet: sheet || undefined,
        accountLast4: accountLast4 || undefined,
      });
      if (!alive.current) {
        await discardFinanceImport(result.file);
        return;
      }
      const previous = staged.current;
      staged.current = result.file;
      selectedFile.current = file;
      setAccount(result.preview.account ?? "");
      setAccountName(result.preview.suggestedAccount.name);
      setPreview(result);
      if (previous) await discardFinanceImport(previous);
    } catch (err) {
      if (alive.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const discard = async (close = true) => {
    setBusy(true);
    setError(null);
    try {
      if (staged.current) await discardFinanceImport(staged.current);
      staged.current = null;
      if (close) onClose();
      else {
        setPreview(null);
        setBusy(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };
  const commit = async () => {
    if (!preview || (!account && !accountName.trim())) return;
    setBusy(true);
    setError(null);
    try {
      committing.current = true;
      const result = await commitFinanceImport(preview.file, {
        account: account || undefined,
        accountName: account ? undefined : accountName,
        tradeDate: tradeDate || undefined,
        sheet: sheet || undefined,
        accountLast4: accountLast4 || undefined,
      });
      staged.current = null;
      if (alive.current) onImported(result);
    } catch (err) {
      if (alive.current) {
        setError(err instanceof Error ? err.message : String(err));
        setBusy(false);
      } else if (staged.current) {
        void discardFinanceImport(staged.current).catch(() => {});
      }
    } finally {
      committing.current = false;
    }
  };
  const p = preview?.preview;
  return (
    <Section title={label("导入账单")} note={label("先预览，再确认写入")}>
      {error && (
        <p role="alert" className={css.notice}>
          {error}
        </p>
      )}
      <>
        <div className={css.importFields}>
          {preview && (
            <label>
              {label("导入到账户")}
              <select
                value={account}
                disabled={busy}
                onChange={(e) => {
                  const value = e.target.value;
                  setAccount(value);
                  if (value) void upload(selectedFile.current, value);
                  else setAccountName("");
                }}
              >
                <option value="">{label("新建账户")}</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} · {a.currency}
                  </option>
                ))}
              </select>
            </label>
          )}
          {preview && !account && (
            <label>
              {label("账户名")}
              <input value={accountName} disabled={busy} onChange={(e) => setAccountName(e.target.value)} />
              {accountName.trim() && accountName.trim() !== preview.preview.suggestedAccount.name && (
                <button
                  type="button"
                  className={css.button}
                  disabled={busy}
                  onClick={() => void upload(selectedFile.current, "", accountName)}
                >
                  {label("更新预览")}
                </button>
              )}
            </label>
          )}
          {!preview && (
            <>
              <details>
                <summary>{label("表格选项")}</summary>
                <label>
                  {label("银行卡尾号（账单未提供时）")}
                  <input
                    inputMode="numeric"
                    maxLength={4}
                    value={accountLast4}
                    disabled={busy || !!preview}
                    onChange={(e) => setAccountLast4(e.target.value)}
                  />
                </label>
                <label>
                  {label("成交日（成交表缺少日期时填写）")}
                  <input
                    type="date"
                    value={tradeDate}
                    disabled={busy || !!preview}
                    onChange={(e) => setTradeDate(e.target.value)}
                  />
                </label>
                <label>
                  {label("工作表名称（多张账单时填写）")}
                  <input
                    value={sheet}
                    disabled={busy || !!preview}
                    onChange={(e) => setSheet(e.target.value)}
                  />
                </label>
              </details>
              <label>
                {label("选择账单或持仓文件")}
                <input
                  type="file"
                  accept=".csv,.xml,.xls,.xlsx"
                  disabled={busy}
                  onChange={(e) => {
                    void upload(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>
            </>
          )}
        </div>

        {busy && (
          <output className={css.muted}>
            {preview
              ? t("正在处理…", "Processing…")
              : t("正在读取文件并生成预览…", "Reading the file and preparing a preview…")}
          </output>
        )}
        {p && (
          <div className={css.preview}>
            <p>
              {label(importSourceNames[p.format] ?? p.format)} · {p.encoding.toUpperCase()}
            </p>
            <p className={css.muted}>
              {t("期间：", "Period: ")}
              {p.period.from ? stamp(p.period.from) : label("暂无记录")} –{" "}
              {p.period.to ? stamp(p.period.to) : label("暂无记录")} · {t("币种：", "Currencies: ")}
              {p.currencies.map((c) => c ?? t("未知", "Unknown")).join(t("、", ", ")) || label("暂无记录")}
            </p>
            <details>
              <summary className={css.link}>{label("查看列映射")}</summary>
              <dl className={css.mapping}>
                {Object.entries(p.mapping).map(([field, column]) => (
                  <div key={field}>
                    <dt>{label(fields[field] ?? "其他字段")}</dt>
                    <dd>{column ?? label("忽略")}</dd>
                  </div>
                ))}
              </dl>
            </details>
            <div className={css.counts}>
              {[
                ["新增", p.added],
                ["已存在", p.skipped],
                ["疑似重复", p.candidate_duplicate],
                ["待核对", p.pending_review],
              ].map(([title, count]) => (
                <span key={title}>
                  <strong>{count}</strong> {label(String(title))}
                </span>
              ))}
            </div>
            {!!p.ignored && (
              <p className={css.muted}>
                {t(
                  `另跳过 ${p.ignored} 行关闭交易或说明。`,
                  `Skipped ${p.ignored} closed transaction or description rows.`,
                )}
              </p>
            )}
            <h3>{t(`前 ${p.rows.length} 行`, `First ${p.rows.length} rows`)}</h3>
            <table className={css.table}>
              <thead>
                <tr>
                  {["行号", "日期", "对手方 / 证券", "原币金额 / 持仓", "说明"].map((title) => (
                    <th key={title}>{label(title ?? "")}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {p.rows.map((r) => (
                  <tr key={r.line}>
                    <td data-label={label("行号")}>{r.line}</td>
                    <td data-label={label("日期")}>{stamp(r.ts)}</td>
                    <td data-label={label("对手方 / 证券")}>
                      {[r.counterparty, r.security_code, r.name].filter(Boolean).join(" · ") ||
                        label("暂无记录")}
                    </td>
                    <td data-label={label("原币金额 / 持仓")}>
                      {r.amount !== null ? (
                        money(r.amount, r.currency)
                      ) : (
                        <>
                          <span>
                            {label("数量")} {decimal(r.quantity)}
                          </span>
                          <br />
                          <span>
                            {label("单位成本")}{" "}
                            {r.cost === null ? label("暂无成本") : money(r.cost, r.currency)}
                          </span>
                          <br />
                          <span>
                            {label("市值")} {money(r.market_value, r.currency)}
                          </span>
                        </>
                      )}
                    </td>
                    <td data-label={label("说明")}>
                      {r.description ??
                        (r.category ? label(categories[r.category] ?? r.category) : null) ??
                        label("暂无记录")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!!p.errors.length && (
              <div role="alert" className={css.notice}>
                <h3>{label("问题行 · 请修正文件后重新选择")}</h3>
                <ul>
                  {p.errors.map((r, i) => (
                    <li key={`${r.line}-${i}`}>
                      {t(`第 ${r.line} 行：`, `Row ${r.line}: `)}
                      {r.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </>
      <div className={css.actions}>
        {preview && (
          <button type="button" className={css.button} disabled={busy} onClick={() => void discard(false)}>
            {label("重新选文件")}
          </button>
        )}
        {preview && (
          <button
            type="button"
            className={`${css.button} ${css.primary}`}
            disabled={
              busy ||
              !!error ||
              !!p?.errors.length ||
              p?.account !== (account || null) ||
              (!account && (!accountName.trim() || accountName.trim() !== p?.suggestedAccount.name))
            }
            onClick={() => void commit()}
          >
            {label("确认导入")}
          </button>
        )}
        <button type="button" className={css.button} disabled={busy} onClick={() => void discard()}>
          {label("放弃")}
        </button>
      </div>
    </Section>
  );
}

export function FinancePage(props: FinancePageProps & { initialImport?: boolean }) {
  const { t, label, money, decimal, reason } = useFinanceText();
  const locale = useLocale();
  const {
    loadFinanceOverview,
    loadFinanceCashflow,
    loadFinanceInvestments,
    loadFinanceAccounts,
    onPrompt,
    timeZone,
  } = props;
  const [tab, setTab] = useState(0);
  const [period, setPeriod] = useState("month");
  const [currency, setCurrency] = useState("CNY");
  const [importing, setImporting] = useState(props.initialImport ?? false);
  const [data, setData] = useState<{
    overview: FinanceOverviewData;
    cashflow: FinanceCashflowData;
    investments: FinanceInvestmentsData;
    accounts: FinanceAccountsData;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const sequence = useRef(0);
  const today =
    props.today ??
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
      new Date(),
    );
  const { from, to } = dateRange(today, period);
  const refresh = useCallback(async () => {
    const seq = ++sequence.current;
    setLoading(true);
    setError(null);
    try {
      const options = { targetCurrency: currency, asOf: new Date().toISOString() };
      const [overview, cashflow, investments, accounts] = await Promise.all([
        loadFinanceOverview(options),
        loadFinanceCashflow(from, to, options),
        loadFinanceInvestments(options),
        loadFinanceAccounts(options),
      ]);
      if (seq === sequence.current) setData({ overview, cashflow, investments, accounts });
    } catch (err) {
      if (seq === sequence.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (seq === sequence.current) setLoading(false);
    }
  }, [
    loadFinanceOverview,
    loadFinanceCashflow,
    loadFinanceInvestments,
    loadFinanceAccounts,
    currency,
    from,
    to,
  ]);
  useEffect(() => {
    void refresh();
    return () => {
      sequence.current++;
    };
  }, [refresh]);
  const stamp = (value: string) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    return new Intl.DateTimeFormat(locale, {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(value));
  };
  const ask = (text: string) => {
    try {
      onPrompt(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  const openImport = () => {
    setMessage(null);
    setImporting(true);
  };
  const records = data?.overview.records ?? [];
  const currencies = [
    ...new Set([
      "CNY",
      ...(data?.overview.currencies.map((g) => g.currency) ?? []),
      ...(data?.cashflow.currencies.map((g) => g.currency) ?? []),
    ]),
  ].filter((c) => c !== "unknown");
  return (
    <div className={css.page} aria-busy={loading}>
      <header className={css.header}>
        <p className={css.muted}>
          {t(
            "财务记录与分析 · 明细保存在资料文件夹，随已开启的云盘同步",
            "Financial records and analysis · Details stay in your workspace and follow its cloud sync settings",
          )}
        </p>
        <div className={css.actions}>
          <button type="button" className={css.button} disabled={loading} onClick={() => void refresh()}>
            {loading ? label("刷新中…") : label("刷新")}
          </button>
          <button
            type="button"
            className={`${css.button} ${css.primary}`}
            onClick={openImport}
            disabled={importing || !data}
          >
            {label("导入账单")}
          </button>
        </div>
      </header>
      {error && (
        <p className={css.notice} role="alert">
          {error}{" "}
          <button type="button" className={css.link} onClick={() => void refresh()}>
            {label("重新读取")}
          </button>
        </p>
      )}
      {message && <output className={css.notice}>{message}</output>}
      {importing && data && (
        <ImportPanel
          {...props}
          accounts={data.accounts.accounts}
          stamp={stamp}
          onClose={() => setImporting(false)}
          onImported={(result) => {
            setImporting(false);
            setMessage(
              t(
                `已导入 ${result.added} 条，已存在 ${result.skipped} 条。`,
                `Imported ${result.added}; already present ${result.skipped}.`,
              ),
            );
            void refresh();
          }}
        />
      )}
      <nav className={css.tabs} aria-label={label("财务视图")}>
        {tabs.map((title, i) => (
          <button type="button" key={title} aria-pressed={tab === i} onClick={() => setTab(i)}>
            {label(title ?? "")}
          </button>
        ))}
      </nav>
      {!data ? (
        <p className={css.empty}>
          {error ? label("财务读取失败，请重新读取。") : label("正在读取财务记录…")}
        </p>
      ) : (
        <>
          {tab === 0 && (
            <>
              {!!data.overview.pending.length && (
                <Section
                  title={t(
                    `${data.overview.pending.length} 条待你核对`,
                    `${data.overview.pending.length} to review`,
                  )}
                >
                  <ul className={css.records}>
                    {data.overview.pending.map((r) => (
                      <li key={r.id}>
                        <span className={css.muted}>{stamp(r.date)}</span>
                        <strong>{money(r.amount, r.currency)}</strong>
                        <span>{r.description}</span>
                        <small>
                          {reason(
                            r.reason,
                            r.status === "candidate_duplicate" ? "疑似重复记录" : "需要核对交易",
                          )}
                        </small>
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    className={css.button}
                    onClick={() => ask(t("帮我核对这些财务记录", "Help me review these finance records"))}
                  >
                    {label("回到对话核对")}
                  </button>
                </Section>
              )}
              {!data.overview.currencies.length ? (
                <Empty onImport={openImport} />
              ) : (
                <>
                  <label className={css.currency}>
                    {label("折算为")}
                    <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                      {currencies.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </label>
                  <div className={css.overview}>
                    {overviewMetrics.map(([key, title]) => (
                      <Section key={key} title={label(title ?? "")}>
                        {data.overview.currencies.map((g) => (
                          <NumberDetail
                            key={g.currency}
                            label={g.currency === "unknown" ? label("币种未知") : g.currency}
                            metric={g[key]}
                            currency={g.currency}
                            records={records}
                            stamp={stamp}
                            note={t(
                              `统计截止 ${stamp(data.overview.period.as_of)}`,
                              `As of ${stamp(data.overview.period.as_of)}`,
                            )}
                          />
                        ))}
                        {data.overview.converted && (
                          <Converted value={data.overview.converted[key]} records={records} stamp={stamp} />
                        )}
                      </Section>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
          {tab === 1 && (
            <>
              <div className={css.heading}>
                <div className={css.periods} aria-label={label("收支期间")}>
                  {[
                    ["month", "本月"],
                    ["previous", "上月"],
                    ["quarter", "近 3 个月"],
                  ].map(([value, title]) => (
                    <button
                      type="button"
                      key={value}
                      aria-pressed={period === value}
                      onClick={() => setPeriod(value ?? "month")}
                    >
                      {label(title ?? "")}
                    </button>
                  ))}
                </div>
                <span className={css.muted}>
                  {loading
                    ? label("正在读取所选期间…")
                    : `${data.cashflow.period.from} – ${data.cashflow.period.to}`}
                </span>
              </div>
              {data.cashflow.period.from !== from || data.cashflow.period.to !== to ? (
                <p className={css.empty}>
                  {error ? label("所选期间读取失败，请重新读取。") : label("正在读取所选期间…")}
                </p>
              ) : !data.cashflow.currencies.length ? (
                <Empty onImport={openImport} />
              ) : (
                <>
                  {data.cashflow.currencies.map((g) => (
                    <Section key={g.currency} title={g.currency}>
                      <div className={css.three}>
                        {(
                          [
                            ["income", "收入"],
                            ["consumption", "消费"],
                            ["surplus", "结余"],
                          ] as const
                        ).map(([key, title]) => (
                          <NumberDetail
                            key={key}
                            label={label(title ?? "")}
                            metric={g[key]}
                            currency={g.currency}
                            records={records}
                            stamp={stamp}
                          />
                        ))}
                      </div>
                    </Section>
                  ))}
                  <Section title={label("按类别的消费")}>
                    {data.cashflow.consumption_categories.length ? (
                      data.cashflow.consumption_categories.map((g) => (
                        <NumberDetail
                          key={`${g.category}-${g.currency}`}
                          label={label(categories[g.category] ?? "其他消费")}
                          metric={g.total}
                          currency={g.currency}
                          records={records}
                          stamp={stamp}
                        />
                      ))
                    ) : (
                      <p className={css.empty}>{label("暂无消费记录")}</p>
                    )}
                  </Section>
                  <Section title={label("不计入收支")}>
                    {data.cashflow.excluded.length ? (
                      data.cashflow.excluded.map((g) => (
                        <NumberDetail
                          key={`${g.category}-${g.currency}`}
                          label={label(categories[g.category] ?? "其他")}
                          metric={g.total}
                          currency={g.currency}
                          records={records}
                          stamp={stamp}
                        />
                      ))
                    ) : (
                      <p className={css.empty}>{label("暂无转账、卖出本金、借款本金或退款冲减记录")}</p>
                    )}
                  </Section>
                </>
              )}
            </>
          )}
          {tab === 2 &&
            (!data.investments.holdings.length && !data.investments.currencies.length ? (
              <Empty onImport={openImport} />
            ) : (
              <>
                <Section
                  title={label("持仓")}
                  note={t(
                    `统计截止 ${stamp(data.investments.period.as_of)}`,
                    `As of ${stamp(data.investments.period.as_of)}`,
                  )}
                >
                  {!data.investments.holdings.length ? (
                    <p className={css.empty}>{label("暂无持仓记录")}</p>
                  ) : (
                    <table className={css.table}>
                      <thead>
                        <tr>
                          {["代码 / 名称", "数量", "成本", "市值", "浮动收益"].map((title) => (
                            <th key={title}>{label(title ?? "")}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {data.investments.holdings.map((h) => (
                          <tr key={h.record_ids.join("-")}>
                            <td data-label={label("代码 / 名称")}>
                              <strong>{h.security_code ?? label("暂无代码")}</strong>
                              <br />
                              {h.name ?? label("暂无名称")}
                              <small>
                                {data.accounts.accounts.find((a) => a.id === h.account)?.name ??
                                  label("账户")}{" "}
                                · {stamp(h.as_of)}
                              </small>
                            </td>
                            <td data-label={label("数量")}>{decimal(h.quantity.amount)}</td>
                            <td data-label={label("成本")}>
                              {h.cost.amount === null ? label("暂无成本") : money(h.cost.amount, h.currency)}
                            </td>
                            <td data-label={label("市值")}>
                              {money(h.valuation.amount, h.currency)}
                              <small>
                                {h.reference.price === null ? (
                                  label("没有行情")
                                ) : (
                                  <>
                                    {t("参考价", "Reference price")}{" "}
                                    {money(h.reference.price, h.reference.currency)} ·{" "}
                                    {h.reference.at ? stamp(h.reference.at) : ""} ·{" "}
                                    {t("来源 Yahoo", "Source: Yahoo")}
                                  </>
                                )}
                              </small>
                              {h.reference.value !== null && (
                                <small>
                                  {t("参考市值", "Reference value")}{" "}
                                  {money(h.reference.value, h.reference.currency)}
                                </small>
                              )}
                              {h.reference.status === "stale" && (
                                <small>{label("刷新失败，保留上次参考价")}</small>
                              )}
                            </td>
                            <td data-label={label("浮动收益")}>
                              {money(h.unrealized_gain.amount, h.currency)}
                              {h.snapshot_return.amount !== null && (
                                <small>
                                  {t("收益率（小数）：", "Return (decimal): ")}
                                  {decimal(h.snapshot_return.amount)}
                                  <br />
                                  {h.snapshot_return_algorithm}
                                </small>
                              )}
                              {h.converted_valuation && (
                                <Converted value={h.converted_valuation} records={records} stamp={stamp} />
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </Section>
                {data.investments.currencies.map((g) => (
                  <Section
                    key={g.currency}
                    title={`${g.currency === "unknown" ? label("币种未知") : g.currency} · ${t("收益", "Returns")}`}
                  >
                    <div className={css.two}>
                      <NumberDetail
                        label={label("已实现收益")}
                        metric={g.realized_gain}
                        currency={g.currency}
                        records={records}
                        stamp={stamp}
                      />
                      <NumberDetail
                        label={label("未实现收益")}
                        metric={g.unrealized_gain}
                        currency={g.currency}
                        records={records}
                        stamp={stamp}
                      />
                    </div>
                    <div className={css.three}>
                      {(
                        [
                          ["dividends", "分红"],
                          ["fees", "手续费"],
                          ["taxes", "税费"],
                        ] as const
                      ).map(([key, title]) => (
                        <NumberDetail
                          key={key}
                          label={label(title ?? "")}
                          metric={g[key]}
                          currency={g.currency}
                          records={records}
                          stamp={stamp}
                        />
                      ))}
                    </div>
                  </Section>
                ))}
              </>
            ))}
          {tab === 3 &&
            (!data.accounts.accounts.length ? (
              <Empty onImport={openImport} />
            ) : (
              <div className={css.overview}>
                {data.accounts.accounts.map((a) => (
                  <Section key={a.id} title={a.name} note={`${label(accountKinds[a.kind])} · ${a.currency}`}>
                    <details className={css.metric}>
                      <summary>
                        <strong>
                          {a.balance.amount === null
                            ? label("余额未知")
                            : money(a.balance.amount, a.currency)}
                        </strong>
                        <span className={css.link}>{label("查看余额记录")}</span>
                      </summary>
                      <Records ids={a.balance.record_ids} records={records} stamp={stamp} />
                    </details>
                    <details className={css.metric}>
                      <summary>
                        {t("交易数：", "Transactions: ")}
                        {a.transaction_count.value}
                        <span className={css.link}>{label(" · 查看交易")}</span>
                      </summary>
                      <Records ids={a.transaction_count.record_ids} records={records} stamp={stamp} />
                    </details>
                    <p className={css.muted}>
                      {t("最近导入：", "Last import: ")}
                      {a.latest_import.at ? stamp(a.latest_import.at) : label("暂无记录")}
                    </p>
                    <p className={css.muted}>
                      {a.sync_status === "imported" ? label("已导入") : label("尚未导入")} ·{" "}
                      {t("统计截止", "As of")} {stamp(data.accounts.period.as_of)}
                    </p>
                  </Section>
                ))}
              </div>
            ))}
        </>
      )}
    </div>
  );
}
