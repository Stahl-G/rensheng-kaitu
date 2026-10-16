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
function decimal(value: string | null | undefined) {
  if (value == null) return "暂无记录";
  const [integer = "", fraction] = value.split(".");
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (fraction === undefined ? "" : `.${fraction}`);
}
function money(value: string | null | undefined, currency?: string | null) {
  return value == null
    ? "暂无记录"
    : `${decimal(value)} ${currency && currency !== "unknown" ? currency : "（币种未知）"}`;
}
function reason(value: string | null, fallback: string) {
  if (!value) return fallback;
  return value
    .split(",")
    .map(
      (r) => reasons[r] ?? (r.startsWith("unreconciled:") ? "存在待核对交易" : /[_:]/.test(r) ? fallback : r),
    )
    .join("、");
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
    <p className={css.empty}>暂无记录</p>
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
  return (
    <details className={css.metric}>
      <summary aria-label={`${label}，展开记录`}>
        <span className={css.muted}>{label}</span>
        <strong>{money(metric.record_ids.length ? metric.amount : null, currency)}</strong>
        {note && <small>{note}</small>}
        {!!metric.missing.length && <small>{reason(metric.missing.join(","), "资料不完整")}</small>}
        <span className={css.link}>查看组成记录</span>
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
  return (
    <div className={css.conversion}>
      <details>
        <summary>
          折算合计{!value.complete && "（部分）"}：
          <strong>{money(value.record_ids.length ? value.amount : null, value.currency)}</strong>
          <span className={css.link}> · 查看记录</span>
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
          <summary>未计入合计 · {value.excluded.length} 项</summary>
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
  return (
    <div className={css.empty}>
      <p>导入一份账单开始</p>
      <button type="button" className={css.button} onClick={onImport}>
        导入账单
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
      setError("请选择不超过 36MB 的 CSV、XML、XLS 或 XLSX 文件。");
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
    <Section title="导入账单" note="先预览，再确认写入">
      {error && (
        <p role="alert" className={css.notice}>
          {error}
        </p>
      )}
      <>
        <div className={css.importFields}>
          {preview && (
            <label>
              导入到账户
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
                <option value="">新建账户</option>
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
              账户名
              <input value={accountName} disabled={busy} onChange={(e) => setAccountName(e.target.value)} />
              {accountName.trim() && accountName.trim() !== preview.preview.suggestedAccount.name && (
                <button
                  type="button"
                  className={css.button}
                  disabled={busy}
                  onClick={() => void upload(selectedFile.current, "", accountName)}
                >
                  更新预览
                </button>
              )}
            </label>
          )}
          {!preview && (
            <>
              <details>
                <summary>表格选项</summary>
                <label>
                  银行卡尾号（账单未提供时）
                  <input
                    inputMode="numeric"
                    maxLength={4}
                    value={accountLast4}
                    disabled={busy || !!preview}
                    onChange={(e) => setAccountLast4(e.target.value)}
                  />
                </label>
                <label>
                  成交日（成交表缺少日期时填写）
                  <input
                    type="date"
                    value={tradeDate}
                    disabled={busy || !!preview}
                    onChange={(e) => setTradeDate(e.target.value)}
                  />
                </label>
                <label>
                  工作表名称（多张账单时填写）
                  <input
                    value={sheet}
                    disabled={busy || !!preview}
                    onChange={(e) => setSheet(e.target.value)}
                  />
                </label>
              </details>
              <label>
                选择账单或持仓文件
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

        {busy && <output className={css.muted}>{preview ? "正在处理…" : "正在读取文件并生成预览…"}</output>}
        {p && (
          <div className={css.preview}>
            <p>
              {importSourceNames[p.format] ?? p.format} · {p.encoding.toUpperCase()}
            </p>
            <p className={css.muted}>
              期间：{p.period.from ? stamp(p.period.from) : "暂无记录"} –{" "}
              {p.period.to ? stamp(p.period.to) : "暂无记录"} · 币种：
              {p.currencies.map((c) => c ?? "未知").join("、") || "暂无记录"}
            </p>
            <details>
              <summary className={css.link}>查看列映射</summary>
              <dl className={css.mapping}>
                {Object.entries(p.mapping).map(([field, column]) => (
                  <div key={field}>
                    <dt>{fields[field] ?? "其他字段"}</dt>
                    <dd>{column ?? "忽略"}</dd>
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
              ].map(([label, count]) => (
                <span key={label}>
                  <strong>{count}</strong> {label}
                </span>
              ))}
            </div>
            {!!p.ignored && <p className={css.muted}>另跳过 {p.ignored} 行关闭交易或说明。</p>}
            <h3>前 {p.rows.length} 行</h3>
            <table className={css.table}>
              <thead>
                <tr>
                  {["行号", "日期", "对手方 / 证券", "原币金额 / 持仓", "说明"].map((label) => (
                    <th key={label}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {p.rows.map((r) => (
                  <tr key={r.line}>
                    <td data-label="行号">{r.line}</td>
                    <td data-label="日期">{stamp(r.ts)}</td>
                    <td data-label="对手方 / 证券">
                      {[r.counterparty, r.security_code, r.name].filter(Boolean).join(" · ") || "暂无记录"}
                    </td>
                    <td data-label="原币金额 / 持仓">
                      {r.amount !== null ? (
                        money(r.amount, r.currency)
                      ) : (
                        <>
                          <span>数量 {decimal(r.quantity)}</span>
                          <br />
                          <span>单位成本 {r.cost === null ? "暂无成本" : money(r.cost, r.currency)}</span>
                          <br />
                          <span>市值 {money(r.market_value, r.currency)}</span>
                        </>
                      )}
                    </td>
                    <td data-label="说明">
                      {r.description ?? (r.category ? categories[r.category] : null) ?? "暂无记录"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!!p.errors.length && (
              <div role="alert" className={css.notice}>
                <h3>问题行 · 请修正文件后重新选择</h3>
                <ul>
                  {p.errors.map((r, i) => (
                    <li key={`${r.line}-${i}`}>
                      第 {r.line} 行：{r.reason}
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
            重新选文件
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
            确认导入
          </button>
        )}
        <button type="button" className={css.button} disabled={busy} onClick={() => void discard()}>
          放弃
        </button>
      </div>
    </Section>
  );
}

export function FinancePage(props: FinancePageProps & { initialImport?: boolean }) {
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
    return new Intl.DateTimeFormat("zh-CN", {
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
        <p className={css.muted}>只记录和分析，不连交易账户 · 明细只在本机</p>
        <div className={css.actions}>
          <button type="button" className={css.button} disabled={loading} onClick={() => void refresh()}>
            {loading ? "刷新中…" : "刷新"}
          </button>
          <button
            type="button"
            className={`${css.button} ${css.primary}`}
            onClick={openImport}
            disabled={importing || !data}
          >
            导入账单
          </button>
        </div>
      </header>
      {error && (
        <p className={css.notice} role="alert">
          {error}{" "}
          <button type="button" className={css.link} onClick={() => void refresh()}>
            重新读取
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
            setMessage(`已导入 ${result.added} 条，已存在 ${result.skipped} 条。`);
            void refresh();
          }}
        />
      )}
      <nav className={css.tabs} aria-label="财务视图">
        {tabs.map((label, i) => (
          <button type="button" key={label} aria-pressed={tab === i} onClick={() => setTab(i)}>
            {label}
          </button>
        ))}
      </nav>
      {!data ? (
        <p className={css.empty}>{error ? "财务读取失败，请重新读取。" : "正在读取财务记录…"}</p>
      ) : (
        <>
          {tab === 0 && (
            <>
              {!!data.overview.pending.length && (
                <Section title={`${data.overview.pending.length} 条待你核对`}>
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
                  <button type="button" className={css.button} onClick={() => ask("帮我核对这些财务记录")}>
                    回到对话核对
                  </button>
                </Section>
              )}
              {!data.overview.currencies.length ? (
                <Empty onImport={openImport} />
              ) : (
                <>
                  <label className={css.currency}>
                    折算为
                    <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                      {currencies.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </label>
                  <div className={css.overview}>
                    {overviewMetrics.map(([key, label]) => (
                      <Section key={key} title={label}>
                        {data.overview.currencies.map((g) => (
                          <NumberDetail
                            key={g.currency}
                            label={g.currency === "unknown" ? "币种未知" : g.currency}
                            metric={g[key]}
                            currency={g.currency}
                            records={records}
                            stamp={stamp}
                            note={`统计截止 ${stamp(data.overview.period.as_of)}`}
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
                <div className={css.periods} aria-label="收支期间">
                  {[
                    ["month", "本月"],
                    ["previous", "上月"],
                    ["quarter", "近 3 个月"],
                  ].map(([value, label]) => (
                    <button
                      type="button"
                      key={value}
                      aria-pressed={period === value}
                      onClick={() => setPeriod(value ?? "month")}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <span className={css.muted}>
                  {loading
                    ? "正在读取所选期间…"
                    : `${data.cashflow.period.from} – ${data.cashflow.period.to}`}
                </span>
              </div>
              {data.cashflow.period.from !== from || data.cashflow.period.to !== to ? (
                <p className={css.empty}>{error ? "所选期间读取失败，请重新读取。" : "正在读取所选期间…"}</p>
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
                        ).map(([key, label]) => (
                          <NumberDetail
                            key={key}
                            label={label}
                            metric={g[key]}
                            currency={g.currency}
                            records={records}
                            stamp={stamp}
                          />
                        ))}
                      </div>
                    </Section>
                  ))}
                  <Section title="按类别的消费">
                    {data.cashflow.consumption_categories.length ? (
                      data.cashflow.consumption_categories.map((g) => (
                        <NumberDetail
                          key={`${g.category}-${g.currency}`}
                          label={categories[g.category] ?? "其他消费"}
                          metric={g.total}
                          currency={g.currency}
                          records={records}
                          stamp={stamp}
                        />
                      ))
                    ) : (
                      <p className={css.empty}>暂无消费记录</p>
                    )}
                  </Section>
                  <Section title="不计入收支" note="转账和本金不算收入或消费；退款只冲减消费">
                    <p className={css.muted}>转账、借款本金按净流入显示，转出为负数。</p>
                    {data.cashflow.excluded.length ? (
                      data.cashflow.excluded.map((g) => (
                        <NumberDetail
                          key={`${g.category}-${g.currency}`}
                          label={categories[g.category] ?? "其他"}
                          metric={g.total}
                          currency={g.currency}
                          records={records}
                          stamp={stamp}
                        />
                      ))
                    ) : (
                      <p className={css.empty}>暂无转账、卖出本金、借款本金或退款冲减记录</p>
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
                <Section title="持仓" note={`统计截止 ${stamp(data.investments.period.as_of)}`}>
                  {!data.investments.holdings.length ? (
                    <p className={css.empty}>暂无持仓记录</p>
                  ) : (
                    <table className={css.table}>
                      <thead>
                        <tr>
                          {["代码 / 名称", "数量", "成本", "市值", "浮动收益"].map((label) => (
                            <th key={label}>{label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {data.investments.holdings.map((h) => (
                          <tr key={h.record_ids.join("-")}>
                            <td data-label="代码 / 名称">
                              <strong>{h.security_code ?? "暂无代码"}</strong>
                              <br />
                              {h.name ?? "暂无名称"}
                              <small>
                                {data.accounts.accounts.find((a) => a.id === h.account)?.name ?? "账户"} ·{" "}
                                {stamp(h.as_of)}
                              </small>
                            </td>
                            <td data-label="数量">{decimal(h.quantity.amount)}</td>
                            <td data-label="成本">
                              {h.cost.amount === null ? "暂无成本" : money(h.cost.amount, h.currency)}
                            </td>
                            <td data-label="市值">
                              {money(h.valuation.amount, h.currency)}
                              <small>
                                {h.reference.price === null ? (
                                  "没有行情"
                                ) : (
                                  <>
                                    参考价 {money(h.reference.price, h.reference.currency)} ·{" "}
                                    {h.reference.at ? stamp(h.reference.at) : ""} · 来源 Yahoo
                                  </>
                                )}
                              </small>
                              {h.reference.value !== null && (
                                <small>参考市值 {money(h.reference.value, h.reference.currency)}</small>
                              )}
                              {h.reference.status === "stale" && <small>刷新失败，保留上次参考价</small>}
                            </td>
                            <td data-label="浮动收益">
                              {money(h.unrealized_gain.amount, h.currency)}
                              {h.snapshot_return.amount !== null && (
                                <small>
                                  收益率（小数）：{decimal(h.snapshot_return.amount)}
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
                    title={`${g.currency === "unknown" ? "币种未知" : g.currency} · 收益`}
                  >
                    <div className={css.two}>
                      <NumberDetail
                        label="已实现收益"
                        metric={g.realized_gain}
                        currency={g.currency}
                        records={records}
                        stamp={stamp}
                      />
                      <NumberDetail
                        label="未实现收益"
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
                      ).map(([key, label]) => (
                        <NumberDetail
                          key={key}
                          label={label}
                          metric={g[key]}
                          currency={g.currency}
                          records={records}
                          stamp={stamp}
                        />
                      ))}
                    </div>
                    <p className={css.muted}>
                      {g.fees_included === true
                        ? "卖出收益已计费用，分红、独立手续费与税费另列。"
                        : g.fees_included === false
                          ? "卖出收益未全部计入费用，手续费与税费另列。"
                          : "暂无完整费用记录，手续费与税费另列。"}
                    </p>
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
                  <Section key={a.id} title={a.name} note={`${accountKinds[a.kind]} · ${a.currency}`}>
                    <details className={css.metric}>
                      <summary>
                        <strong>
                          {a.balance.amount === null ? "余额未知" : money(a.balance.amount, a.currency)}
                        </strong>
                        <span className={css.link}>查看余额记录</span>
                      </summary>
                      <Records ids={a.balance.record_ids} records={records} stamp={stamp} />
                    </details>
                    <details className={css.metric}>
                      <summary>
                        交易数：{a.transaction_count.value}
                        <span className={css.link}> · 查看交易</span>
                      </summary>
                      <Records ids={a.transaction_count.record_ids} records={records} stamp={stamp} />
                    </details>
                    <p className={css.muted}>
                      最近导入：{a.latest_import.at ? stamp(a.latest_import.at) : "暂无记录"}
                    </p>
                    <p className={css.muted}>
                      {a.sync_status === "imported" ? "已导入" : "尚未导入"} · 统计截止{" "}
                      {stamp(data.accounts.period.as_of)}
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
