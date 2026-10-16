// Adapted from double-entry-generator (Apache-2.0), Copyright deb-sig contributors
// Parsing only: pkg/provider/{wechat,alipay,cmb,icbc,ccb,boc,jd,mt,hxsec,htsec}.
import { KaituError } from "../../errors.js";
import type { CsvRow } from "../csv.js";
import { abs, add, decimal, neg } from "../decimal.js";
import type { FinanceCategory } from "../types.js";
import { clean, directed, last4, money, netAmount, requiredMoney, timestamp, transaction } from "./shared.js";

export type FinanceFormat =
  | "alipay-csv"
  | "holdings-csv"
  | "wechat"
  | "cmb"
  | "icbc"
  | "ccb"
  | "boc"
  | "jd"
  | "mt"
  | "hxsec"
  | "htsec"
  | "ibkr";
export type FinanceMapping = Record<string, string | null>;
export const supportedFinanceSources = [
  "微信",
  "支付宝",
  "招商银行",
  "工商银行",
  "建设银行",
  "中国银行",
  "京东",
  "美团",
  "华西证券",
  "海通证券",
  "IBKR Flex XML",
  "同花顺持仓/成交",
];
export const holdingAliases: Record<string, string[]> = {
  ts: ["交易时间", "快照时间"],
  security_code: ["证券代码"],
  name: ["证券名称"],
  quantity: ["股票余额", "持仓数量"],
  cost: ["参考成本价", "成本价"],
  price: ["市价"],
  market_value: ["市值"],
  currency: ["币种"],
};
const walletAliases: Record<string, string[]> = {
  ts: ["交易时间", "交易创建时间"],
  category: ["交易分类", "交易类型"],
  counterparty: ["交易对方", "商户名称"],
  description: ["商品说明", "商品", "交易说明", "订单标题"],
  direction: ["收/支", "收支"],
  amount: ["金额", "金额(元)", "实付金额"],
  status: ["交易状态", "当前状态"],
  source_transaction_id: ["交易订单号", "交易单号"],
  original_source_transaction_id: ["原交易订单号", "原交易单号"],
  method: ["收/付款方式", "支付方式", "收/付方式"],
  currency: ["币种"],
  account_last4: ["卡号末四位"],
};
const normalizeHeader = (c: string) => clean(c).replaceAll("（", "(").replaceAll("）", ")");
export function detectFinanceTable(rows: CsvRow[]) {
  for (const [index, row] of rows.entries()) {
    const c = row.cells.map(normalizeHeader);
    const has = (...names: string[]) => names.every((n) => c.includes(n));
    let format: FinanceFormat | undefined;
    if (has("交易时间", "交易类型", "交易对方", "商品")) format = "wechat";
    else if (has("交易时间", "商户名称", "交易说明")) format = "jd";
    else if (has("交易创建时间", "实付金额", "订单标题")) format = "mt";
    else if (has("交易时间", "商品说明", "交易状态")) format = "alipay-csv";
    else if (has("记账日期", "联机余额", "交易金额")) format = "cmb";
    else if (has("交易摘要", "人民币金额", "卡号末四位")) format = "cmb";
    else if (has("记账金额(收入)", "记账金额(支出)", "记账币种")) format = "icbc";
    else if (has("记账日", "支出", "收入") || has("记账日期", "支出金额", "收入金额")) format = "ccb";
    else if (has("记账日期", "记账时间", "借记卡号") || has("银行记账日", "卡号后四位", "存入"))
      format = "boc";
    else if (has("交收日期", "业务名称", "清算金额")) format = "hxsec";
    else if (has("证券代码", "成交数量", "成交价格") && (c.includes("操作") || c.includes("买卖标志")))
      format = "htsec";
    else if ((has("证券代码") || has("证券名称")) && !c.some((n) => /成交|业务名称/.test(n)))
      format = "holdings-csv";
    if (format) return { index, columns: c, format };
  }
  throw new KaituError(`无法识别文件格式。可识别：${supportedFinanceSources.join("、")}`, "INVALID_IMPORT");
}
export function parseFinanceTable(
  rows: CsvRow[],
  options: { format?: FinanceFormat; mapping?: FinanceMapping; tradeDate?: string },
  snapshotAt: string,
) {
  const { index, columns, format } = detectFinanceTable(rows);
  if (options.format && options.format !== format)
    throw new KaituError("文件列结构与指定格式不匹配", "INVALID_IMPORT");
  const aliases = format === "holdings-csv" ? holdingAliases : walletAliases;
  const mapping: FinanceMapping = {};
  for (const [field, names] of Object.entries(aliases))
    mapping[field] = names.find((n) => columns.includes(n)) ?? null;
  for (const [field, name] of Object.entries(options.mapping ?? {})) {
    if (!Object.hasOwn(aliases, field) || (name !== null && !columns.includes(normalizeHeader(name))))
      throw new KaituError(`字段映射无效：${field}`, "INVALID_IMPORT");
    mapping[field] = name === null ? null : normalizeHeader(name);
  }
  const candidates: { line: number; data: Record<string, unknown> }[] = [];
  const errors: { line: number; reason: string }[] = [];
  let ignored = 0;
  const preamble = rows
    .slice(0, index)
    .map((r) => r.cells.join(" "))
    .join("\n");
  const fileTail = last4(
    preamble.match(/(?:卡号|账号|帐[号戶]|账[号户])[:：\s]*([\d* -]{4,})/)?.[1]?.trim() ?? "",
  );
  const body =
    format === "htsec" ? mergeHtsecAllotments(rows.slice(index + 1), columns) : rows.slice(index + 1);
  for (const row of body) {
    if (
      /^(?:[-=]{3,}|说明|注[:：]|统计|合计|人民币合计|共[:：\s]*\d|以上数据|具体内容|导出|账单|收入[:：]|支出[:：]|不计收支[:：]|温馨提示|特别提示|注意事项)/.test(
        row.cells[0] ?? "",
      )
    )
      continue;
    const cells = row.cells.map(clean);
    if (!cells.some(Boolean)) continue;
    const get = (...names: string[]) => {
      const name = names.find((n) => columns.includes(n));
      return name ? (cells[columns.indexOf(name)] ?? "") : "";
    };
    const field = (name: string) => (mapping[name] ? get(mapping[name]) : "");
    try {
      if (cells.length > columns.length && cells.slice(columns.length).some(Boolean))
        throw new Error("列数超过表头");
      if (format === "holdings-csv") {
        const security = field("security_code") || null;
        if (!security && !field("name")) throw new Error("证券代码和名称均缺失");
        candidates.push({
          line: row.line,
          data: {
            ts: field("ts") ? timestamp(field("ts")) : snapshotAt,
            security_code: security,
            name: field("name") || null,
            quantity: money(field("quantity")),
            cost: money(field("cost")),
            price: money(field("price")),
            market_value: money(field("market_value")),
            currency: field("currency") || null,
          },
        });
        continue;
      }
      let data: Record<string, unknown> | null;
      if (["alipay-csv", "wechat", "jd", "mt"].includes(format)) {
        const status = field("status");
        if (/交易关闭|已关闭|已取消|支付失败|已撤销/.test(status)) {
          ignored++;
          continue;
        }
        if (
          format !== "mt" &&
          !/交易成功|退款成功|支付成功|已支付|已收钱|已到账|已存入|已转账|已退款|已全额退款|对方已收钱|朋友已确认收钱|充值成功|充值完成|提现成功|提现完成|还款成功|还款完成|等待确认收货|已付款|已发货/.test(
            status,
          )
        )
          throw new Error("交易状态尚未完成或无法识别");
        const direction = field("direction");
        if (!["收入", "支出", "不计收支", "/", ""].includes(direction)) throw new Error("收支方向无效");
        const value = requiredMoney(field("amount"));
        if (decimal(value).units < 0n) throw new Error("金额不能为负");
        const classification = field("category");
        const refund =
          /退款/.test(classification) || (/退款成功|已退款/.test(status) && direction === "收入");
        data = transaction({
          ts: timestamp(field("ts")),
          amount: value,
          direction: direction === "/" || !direction ? "不计收支" : direction,
          classification,
          status,
          description: field("description"),
          counterparty: field("counterparty"),
          currency: field("currency"),
          id: field("source_transaction_id"),
          originalId: field("original_source_transaction_id"),
          last4: last4(field("account_last4")) ?? last4(field("method")),
          ...(refund ? { category: "refund" as const } : {}),
        });
        data.source_direction = direction;
        if (refund) data.amount = abs(value);
      } else if (["cmb", "icbc", "ccb", "boc"].includes(format)) {
        let at = get("记账日期", "交易日期", "记账日", "银行记账日");
        let value: string;
        let description = get("交易摘要", "摘要", "交易名称", "交易描述");
        let tail = last4(get("卡号末四位", "卡号后四位", "借记卡号")) ?? fileTail;
        if (format === "cmb" && columns.includes("人民币金额")) {
          const title = preamble.match(/(\d{4})年(\d{2})月/);
          if (!title) throw new Error("信用卡账单缺少年月");
          at = get("交易日") || get("记账日");
          const [month, day] = at.split("/");
          if (!month || !day) throw new Error("信用卡交易日期无效");
          const year = Number(title[1]) - (Number(month) > Number(title[2]) ? 1 : 0);
          at = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
          value = neg(requiredMoney(get("人民币金额")));
          tail = last4(get("卡号末四位"));
        } else if (format === "cmb" || (format === "boc" && columns.includes("借记卡号")))
          value = requiredMoney(get("交易金额", "金额"));
        else
          value = netAmount(
            get("记账金额(收入)", "收入", "收入金额", "存入"),
            get("记账金额(支出)", "支出", "支出金额"),
          );
        description = [description, get("客户摘要", "交易详情", "附言", "交易地点")]
          .filter(Boolean)
          .join(" · ");
        data = transaction({
          ts: timestamp(at, get("交易时间", "记账时间")),
          amount: value,
          currency: get("记账币种", "币种", "币别", "货币") || "CNY",
          classification: description,
          description,
          counterparty: get("对方户名", "对手信息", "对方账户名", "交易场所"),
          last4: tail,
          id: get("交易流水号", "流水号"),
          status: get("交易状态"),
        });
      } else data = parseSecurity(get, format, options.tradeDate);
      if (data) candidates.push({ line: row.line, data });
      else ignored++;
    } catch (error) {
      errors.push({ line: row.line, reason: (error as Error).message });
    }
  }
  return {
    format,
    kind: format === "holdings-csv" ? "finance_holding_snapshot" : "finance_transaction",
    columns,
    mapping,
    candidates,
    errors,
    ignored,
  };
}
function parseSecurity(get: (...names: string[]) => string, format: FinanceFormat, tradeDate?: string) {
  const op = get("业务名称", "操作", "买卖标志");
  if (["指定交易", "新增证券"].includes(op) || get("证券名称") === "新增证券") return null;
  const categories: Record<string, FinanceCategory> = {
    买: "buy",
    卖: "sale",
    买入: "buy",
    卖出: "sale",
    证券买入: "buy",
    证券卖出: "sale",
    融券回购: "buy",
    融券购回: "sale",
    银行转证券: "transfer",
    证券转银行: "transfer",
    红利入账: "dividend",
    利息归本: "dividend",
    新股申购: "buy",
    新股缴款: "buy",
    新债申购: "buy",
    新债缴款: "buy",
  };
  const category = categories[op];
  if (!category) throw new Error(`不支持的证券业务：${op}`);
  const outgoing = ["buy"].includes(category) || op === "证券转银行";
  const settled = get("清算金额", "发生金额");
  const gross = get("成交金额");
  let value = money(settled) ?? money(gross);
  if (value === null) throw new Error("缺少成交/清算金额");
  if (value === "0" && ["buy", "sale"].includes(category)) throw new Error("零金额交割需与缴款行核对后导入");
  value = directed(value, outgoing);
  const fees =
    format === "hxsec"
      ? money(get("总费用"))
      : ["手续费", "印花税", "过户费", "其他费"].reduce((sum, key) => add(sum, money(get(key)) ?? "0"), "0");
  if (!settled && fees && fees !== "0") value = add(value, neg(abs(fees)));
  const date = get("交收日期", "成交日期", "日期") || tradeDate || "";
  const time = get("成交时间");
  const ts = date ? timestamp(date, time) : "";
  if (!ts) throw new Error("成交表缺少日期，请填写成交日或导出含日期的表格");
  const description = [
    op,
    get("证券代码"),
    get("证券名称"),
    get("成交数量"),
    get("成交价格"),
    fees ? `费用 ${fees}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return transaction({
    ts,
    amount: value,
    currency: get("币种") || "CNY",
    category,
    classification: op,
    description,
    id: get("成交编号", "成交号"),
    last4: last4(get("资金帐号", "资金账号")),
    direction: outgoing ? "支出" : "收入",
    feesIncluded:
      !!settled ||
      (format === "hxsec"
        ? fees !== null
        : ["手续费", "印花税", "过户费", "其他费"].every((column) => get(column) !== "")),
  });
}

function mergeHtsecAllotments(rows: CsvRow[], columns: string[]): CsvRow[] {
  const at = (row: CsvRow, name: string) => clean(row.cells[columns.indexOf(name)] ?? "");
  const zero = (row: CsvRow, name: string) => {
    try {
      return decimal(money(at(row, name)) ?? "0").units === 0n;
    } catch {
      return false;
    }
  };
  const removed = new Set<number>();
  const replacements = new Map<number, CsvRow>();
  for (const row of rows) {
    if (zero(row, "成交价格") || zero(row, "成交数量") || !zero(row, "成交金额")) continue;
    const peers = rows.filter(
      (other) =>
        other !== row &&
        at(other, "证券代码") === at(row, "证券代码") &&
        Math.abs(Date.parse(timestamp(at(other, "成交日期"))) - Date.parse(timestamp(at(row, "成交日期")))) <=
          7 * 86400000,
    );
    const pay = peers.filter(
      (other) => zero(other, "成交价格") && zero(other, "成交数量") && !zero(other, "成交金额"),
    );
    if (pay.length !== 1 || peers.some((other) => !zero(other, "成交数量"))) continue;
    const counterpart = pay[0];
    if (!counterpart || removed.has(counterpart.line)) continue;
    const cells = [...row.cells];
    for (const name of ["成交金额", "发生金额"]) {
      const i = columns.indexOf(name);
      if (i >= 0) cells[i] = at(counterpart, name);
    }
    replacements.set(row.line, { ...row, cells });
    removed.add(counterpart.line);
  }
  return rows.filter((row) => !removed.has(row.line)).map((row) => replacements.get(row.line) ?? row);
}
