import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { localStateRoot } from "../drive.js";
import { localDate, parseTs } from "../time.js";
import type { Workspace } from "../workspace.js";
import { decimal, mul, sub } from "./decimal.js";
import { type FinanceViewOptions, financeInvestments } from "./views.js";

export interface FinanceQuote {
  symbol: string;
  price: string;
  currency: string;
  at: string;
}
export type FinanceQuoteFetcher = (symbols: string[]) => Promise<FinanceQuote[]>;
interface QuoteCache {
  attempted_at: string | null;
  day: string;
  attempts: number;
  quotes: Record<string, FinanceQuote>;
  failed: string[];
}
export function yahooSymbol(code: string | null, currency: string | null): string | null {
  if (!code) return null;
  const value = code.trim().toUpperCase();
  const explicit = value.match(/^(?:SH|SS)(\d{6})$/) ?? value.match(/^(\d{6})\.(?:SH|SS)$/);
  if (explicit) return `${explicit[1]}.SS`;
  const sz = value.match(/^SZ(\d{6})$/) ?? value.match(/^(\d{6})\.SZ$/);
  if (sz) return `${sz[1]}.SZ`;
  const hk = value.match(/^(\d{1,5})\.HK$/) ?? (currency === "HKD" ? value.match(/^(\d{1,5})$/) : null);
  if (hk && Number(hk[1]) > 0) return `${String(Number(hk[1])).padStart(4, "0")}.HK`;
  if (currency === "CNY" || currency === null) {
    if (/^(?:600|601|603|605|688|689|50[1256]|51\d|56\d|58[89])\d{3}$/.test(value)) return `${value}.SS`;
    if (/^(?:000|001|002|003|300|301|159|16\d)\d{3}$/.test(value)) return `${value}.SZ`;
  }
  if (currency === "USD" && /^[A-Z][A-Z0-9]*(?:[.-][A-Z])?$/.test(value)) return value;
  return null;
}
function cacheDirectory(ws: Workspace, override?: string) {
  if (override) return override;
  const state = ws.readJson<{ state_dir?: string }>(".kaitu/config.json").state_dir;
  if (state && isAbsolute(state)) {
    const rel = relative(ws.root, state);
    if (rel.startsWith("..") || isAbsolute(rel)) return join(state, "finance");
  }
  const identity = createHash("sha256").update(ws.root).digest("hex").slice(0, 24);
  return join(localStateRoot(), "finance", identity);
}
function readCache(file: string): QuoteCache {
  const empty: QuoteCache = { attempted_at: null, day: "", attempts: 0, quotes: {}, failed: [] };
  if (!existsSync(file)) return empty;
  try {
    const cache = JSON.parse(readFileSync(file, "utf8")) as QuoteCache;
    if (!Array.isArray(cache.failed) || !cache.quotes || !Number.isInteger(cache.attempts)) return empty;
    return cache;
  } catch {
    return empty;
  }
}
function valid(quote: FinanceQuote, requested: Set<string>, now: Date) {
  try {
    parseTs(quote.at);
    return (
      requested.has(quote.symbol) &&
      decimal(quote.price).units > 0n &&
      /^[A-Z]{3}$/.test(quote.currency) &&
      Date.parse(quote.at) <= now.getTime() + 60000
    );
  } catch {
    return false;
  }
}
const active = new Map<string, Promise<QuoteCache>>();
async function cachedQuotes(
  ws: Workspace,
  symbols: string[],
  dependencies: { now?: Date; fetchQuotes?: FinanceQuoteFetcher; cacheDir?: string },
) {
  const directory = cacheDirectory(ws, dependencies.cacheDir);
  const file = join(directory, "quotes.json");
  const pending = active.get(file);
  if (pending) return pending;
  const run = async () => {
    const now = dependencies.now ?? new Date();
    const cache = readCache(file);
    const day = localDate(now, ws.timeZone());
    if (
      !symbols.length ||
      (cache.attempted_at && now.getTime() - Date.parse(cache.attempted_at) <= 3600000) ||
      (cache.day === day && cache.attempts >= 4)
    )
      return cache;
    const next: QuoteCache = {
      ...cache,
      day,
      attempts: (cache.day === day ? cache.attempts : 0) + 1,
      attempted_at: now.toISOString(),
      quotes: { ...cache.quotes },
      failed: [...symbols],
    };
    const write = () => {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const temp = join(directory, `${randomUUID()}.tmp`);
      writeFileSync(temp, JSON.stringify(next), { mode: 0o600 });
      renameSync(temp, file);
    };
    write();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const quotes = await Promise.race([
        (dependencies.fetchQuotes ?? fetchYahooQuotes)(symbols),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("行情请求超时")), 12000);
        }),
      ]);
      const requested = new Set(symbols);
      for (const quote of quotes) if (valid(quote, requested, now)) next.quotes[quote.symbol] = quote;
      next.failed = symbols.filter(
        (symbol) => !quotes.some((quote) => quote.symbol === symbol && valid(quote, requested, now)),
      );
    } catch {
      /* 上次有效行情与时间保留在缓存中。 */
    } finally {
      if (timer) clearTimeout(timer);
    }
    write();
    return next;
  };
  const operation = run();
  active.set(file, operation);
  try {
    return await operation;
  } finally {
    if (active.get(file) === operation) active.delete(file);
  }
}
async function fetchYahooQuotes(symbols: string[]): Promise<FinanceQuote[]> {
  const { default: YahooFinance } = await import("yahoo-finance2");
  const yahoo = new YahooFinance({
    suppressNotices: ["yahooSurvey"],
    validation: { logErrors: false },
    versionCheck: false,
    fetchOptions: { signal: AbortSignal.timeout(10000) },
    logger: { info() {}, warn() {}, error() {}, debug() {}, dir() {} },
  });
  const quotes = await yahoo.quote(symbols, {
    fields: ["symbol", "regularMarketPrice", "regularMarketTime", "currency"],
  });
  return quotes.flatMap((quote) =>
    typeof quote.regularMarketPrice === "number" && quote.regularMarketTime instanceof Date
      ? [
          {
            symbol: quote.symbol,
            price: String(quote.regularMarketPrice),
            currency: quote.currency ?? "",
            at: quote.regularMarketTime.toISOString(),
          },
        ]
      : [],
  );
}
export async function loadFinanceInvestments(
  ws: Workspace,
  options: FinanceViewOptions = {},
  dependencies: { now?: Date; fetchQuotes?: FinanceQuoteFetcher; cacheDir?: string } = {},
) {
  const imported = financeInvestments(ws, options);
  const target = options.targetCurrency ?? "CNY";
  if (!/^[A-Z]{3}$/.test(target)) throw new Error("折算币种无效");
  const symbols = [
    ...new Set(
      imported.holdings.flatMap((h) => {
        const symbol = yahooSymbol(h.security_code, h.currency);
        const currency =
          h.currency || (symbol?.endsWith(".HK") ? "HKD" : symbol?.match(/\.(SS|SZ)$/) ? "CNY" : null);
        return symbol ? [symbol, ...(currency && currency !== target ? [`${currency}${target}=X`] : [])] : [];
      }),
    ),
  ];
  let cache: QuoteCache;
  try {
    cache = symbols.length
      ? await cachedQuotes(ws, symbols, dependencies)
      : { attempted_at: null, day: "", attempts: 0, quotes: {}, failed: [] };
  } catch {
    cache = {
      ...readCache(join(cacheDirectory(ws, dependencies.cacheDir), "quotes.json")),
      failed: [...symbols],
    };
  }
  return {
    ...imported,
    holdings: imported.holdings.map((holding) => {
      const symbol = yahooSymbol(holding.security_code, holding.currency);
      const cached = symbol ? cache.quotes[symbol] : undefined;
      const quote =
        cached && (!holding.currency || holding.currency === cached.currency) ? cached : undefined;
      const value =
        quote && holding.quantity.amount !== null ? mul(holding.quantity.amount, quote.price) : null;
      const rate =
        quote && quote.currency !== target ? cache.quotes[`${quote.currency}${target}=X`] : undefined;
      const fx = rate?.currency === target ? rate : undefined;
      const reference = {
        source: "Yahoo" as const,
        symbol,
        price: quote?.price ?? null,
        currency: quote?.currency ?? null,
        at: quote?.at ?? null,
        status: !quote
          ? ("unavailable" as const)
          : symbol && cache.failed.includes(symbol)
            ? ("stale" as const)
            : ("ok" as const),
        value,
        unrealized_gain:
          value !== null && holding.cost.amount !== null && holding.currency === quote?.currency
            ? sub(value, holding.cost.amount)
            : null,
        converted_value:
          value === null ? null : quote?.currency === target ? value : fx ? mul(value, fx.price) : null,
        target_currency: target,
        fx: fx
          ? { rate: fx.price, at: fx.at, source: "Yahoo" as const, stale: cache.failed.includes(fx.symbol) }
          : null,
      };
      return { ...holding, reference };
    }),
    quote_refresh: {
      attempted_at: cache.attempted_at,
      attempts: cache.attempts,
      day: cache.day,
      failed: cache.failed.length > 0,
    },
  };
}
