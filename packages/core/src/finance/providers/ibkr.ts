// Adapted from double-entry-generator (Apache-2.0), Copyright deb-sig contributors
// Parsing only: pkg/provider/ibkr/ibkr.go. Copyright deb-sig contributors.
import { SaxesParser } from "saxes";
import { parseTs } from "../../time.js";
import { abs, add, neg } from "../decimal.js";
import { directed, requiredMoney, transaction } from "./shared.js";

export function parseIbkr(text: string) {
  const candidates: { line: number; data: Record<string, unknown> }[] = [];
  const errors: { line: number; reason: string }[] = [];
  let ignored = 0;
  let root = false;
  const parser = new SaxesParser({ xmlns: false });
  parser.on("doctype", () => {
    throw new Error("不支持 XML DTD");
  });
  parser.on("opentag", (tag) => {
    if (tag.name === "FlexQueryResponse") root = true;
    if (!["Trade", "CashTransaction"].includes(tag.name)) return;
    const a = tag.attributes as Record<string, string>;
    const line = parser.line;
    try {
      const ts = ibkrTime(a.dateTime, a.tradeDate || a.settleDate);
      const id = a.transactionID || a.tradeID || a.ibExecID;
      const common = {
        ts,
        currency: a.currency,
        id,
        description: [a.symbol, a.type, a.description].filter(Boolean).join(" · "),
        counterparty: "IBKR",
      };
      if (tag.name === "CashTransaction") {
        const value = requiredMoney(a.amount ?? "");
        if (Number(value) === 0) {
          ignored++;
          return;
        }
        const kind = (a.type || "").toLowerCase();
        const category = /dividend|interest/.test(kind)
          ? "dividend"
          : /tax/.test(kind)
            ? "tax"
            : /fee/.test(kind)
              ? "fee"
              : /deposit|withdraw/.test(kind)
                ? "transfer"
                : null;
        if (!category) throw new Error(`不支持的 IBKR 现金业务：${a.type}`);
        candidates.push({
          line,
          data: transaction({ ...common, amount: value, category, classification: a.type }),
        });
      } else if (a.assetCategory === "STK") {
        if (!["BUY", "SELL"].includes(a.buySell ?? "")) throw new Error("IBKR 买卖方向无效");
        const outgoing = a.buySell === "BUY";
        requiredMoney(a.quantity ?? "");
        requiredMoney(a.tradePrice ?? "");
        let value = directed(a.tradeMoney ?? "", outgoing);
        if (a.netCash) value = requiredMoney(a.netCash);
        else if (a.ibCommission) {
          if (a.ibCommissionCurrency && a.ibCommissionCurrency !== a.currency)
            throw new Error("异币种佣金缺少 netCash");
          value = add(value, neg(abs(requiredMoney(a.ibCommission))));
        }
        candidates.push({
          line,
          data: transaction({
            ...common,
            amount: value,
            category: outgoing ? "buy" : "sale",
            direction: a.buySell,
            description: [common.description, `数量 ${a.quantity}`, `价格 ${a.tradePrice}`].join(" · "),
            feesIncluded: !!a.netCash || !!a.ibCommission,
          }),
        });
      } else if (a.assetCategory === "CASH") {
        const currencies = a.symbol?.split(".") ?? [];
        if (currencies.length !== 2 || currencies.some((c) => !/^[A-Z]{3}$/.test(c)))
          throw new Error("外汇币种无法识别");
        if (!["BUY", "SELL"].includes(a.buySell ?? "")) throw new Error("IBKR 买卖方向无效");
        const buy = a.buySell === "BUY";
        for (const [i, currency] of currencies.entries())
          candidates.push({
            line,
            data: transaction({
              ...common,
              id: id ? `${id}:${currency}` : undefined,
              currency,
              category: "transfer",
              direction: a.buySell,
              amount: directed(i === 0 ? (a.quantity ?? "") : (a.tradeMoney ?? ""), i === 0 ? !buy : buy),
            }),
          });
      } else throw new Error(`不支持的 IBKR 资产类型：${a.assetCategory}`);
    } catch (error) {
      errors.push({ line, reason: (error as Error).message });
    }
  });
  parser.write(text).close();
  if (!root) throw new Error("不是 IBKR Flex XML");
  return {
    format: "ibkr" as const,
    kind: "finance_transaction",
    columns: [],
    mapping: {},
    candidates,
    errors,
    ignored,
  };
}
function ibkrTime(value = "", date = "") {
  if (!value) {
    const ts = `${date}T00:00:00Z`;
    parseTs(ts);
    return ts;
  }
  const normalized = value
    .replace(",", "T")
    .replace(/ EST$/, "-05:00")
    .replace(/ EDT$/, "-04:00")
    .replace(/ (?:UTC|GMT)$/, "Z");
  parseTs(normalized);
  return normalized;
}
