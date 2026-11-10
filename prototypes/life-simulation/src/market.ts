import { type Journal, assetReturn, expense, liquid, transfer, yuan } from "./finance.js";
import type { Market, State } from "./model.js";
import { normal, sample } from "./random.js";
/** Exact means/SDs below are authored GAME PARAMETERS, not fitted estimates or forecasts.
 * Numeric provenance: this configuration; qualitative references are listed alongside.
 * Returns are nominal RMB total-return proxies; no additional dividend credit.
 */
export const marketConfig = {
  deposits: {
    mean: 0.01,
    volatility: 0,
    source: "Game assumption; ICBC rate schedule is a reference, not this simulated rate.",
    reference: "https://www.icbc.com.cn/en/column/1438058387111035027.html",
  },
  bonds: {
    mean: 0.028,
    volatility: 0.055,
    source: "Game assumption for a bond-fund total return, not a deposit guarantee.",
    reference:
      "https://www.investor.gov/introduction-investing/investing-basics/investment-products/bonds-or-fixed-income-products/bonds",
  },
  stocks: {
    mean: 0.065,
    volatility: 0.24,
    source: "Game assumption for a broad index, not an estimate of future Chinese equity returns.",
    reference: "https://www.investor.gov/introduction-investing/getting-started/asset-allocation",
  },
  property: {
    mean: 0.025,
    volatility: 0.12,
    source: "Game assumption for owner-occupied property price appreciation; no rent/dividend credited.",
    reference: "https://www.investor.gov/introduction-investing/getting-started/asset-allocation",
  },
  crisisProbability: 0.09,
};
export function marketFor(seed: string, year: number): Market {
  const crisis = sample(seed, year, "crisis") < marketConfig.crisisProbability;
  const returns = Object.fromEntries(
    Object.entries(marketConfig)
      .filter(([k]) => k !== "crisisProbability")
      .map(([key, value]) => {
        const c = value as typeof marketConfig.stocks;
        const crisisLoss = crisis
          ? ({ deposits: 0, bonds: 0.02, stocks: 0.23, property: 0.14 }[key] ?? 0)
          : 0;
        return [
          key,
          Math.max(-0.8, Math.min(0.8, c.mean + c.volatility * normal(seed, year, key) - crisisLoss)),
        ];
      }),
  ) as Market["returns"];
  return {
    year,
    crisis,
    demand: crisis ? -0.3 : Math.max(-0.2, Math.min(0.2, normal(seed, year, "demand") * 0.09)),
    returns,
  };
}
/** Knowledge weakly changes behavior, with a larger independent temperament term.
 * This is a declared game association, not a claim that education implies financial literacy.
 * It never modifies market returns. */
export function investBehavior(s: State, lifeSeed: string, year: number) {
  const steadiness = Math.max(
    0,
    Math.min(1, 0.25 + s.props.knowledge * 0.003 + sample(lifeSeed, 0, "financial-temperament") * 0.35),
  );
  return {
    diversify: sample(lifeSeed, year, "diversify") < steadiness,
    panic: sample(lifeSeed, year, "panic") > 0.86 + steadiness * 0.1,
    chase: sample(lifeSeed, year, "chase") < 0.18 - steadiness * 0.12,
    fee: 0.007 - steadiness * 0.004,
    start: sample(lifeSeed, year, "start-investing") < 0.05 + steadiness * 0.1,
  };
}
export function invest(
  s: State,
  j: Journal,
  requested: number,
  kind: "bonds" | "index" | "property",
  diversify = false,
) {
  const amount = Math.min(Math.max(0, Math.round(requested)), Math.max(0, liquid(s.assets) - yuan(12000)));
  if (s.assets.cash < amount) transfer(s.assets, j, "deposits", "cash", amount - s.assets.cash, "withdrawal");
  if (kind === "property") {
    transfer(s.assets, j, "cash", "property", amount, "property-purchase");
    s.housing = "owned";
  } else if (kind === "bonds") transfer(s.assets, j, "cash", "bonds", amount, "bond-purchase");
  else {
    transfer(s.assets, j, "cash", "bonds", diversify ? Math.round(amount * 0.2) : 0, "bond-purchase");
    transfer(s.assets, j, "cash", "stocks", diversify ? Math.round(amount * 0.8) : amount, "index-purchase");
  }
  s.investor = true;
  return amount;
}
export function settleMarket(s: State, j: Journal, m: Market, lifeSeed: string) {
  const b = s.assets;
  const behavior = investBehavior(s, lifeSeed, m.year);
  if (s.investor && (s.flags.previousStockReturn ?? 0) > 0.18 && behavior.chase && liquid(b) > yuan(30000)) {
    invest(s, j, Math.round((liquid(b) - yuan(12000)) * 0.35), "index", false);
    s.flags.chased = m.year;
  }
  // Annual recurring investment is booked as 12 end-of-month equal contributions.
  // Smooth monthly path compounds to exactly the shared annual return (not new random draws).
  const monthly = s.habits.monthlyInvestment;
  for (let month = 0; month < 12; month++) {
    for (const asset of ["deposits", "bonds", "stocks", "property"] as const)
      assetReturn(b, j, asset, (1 + m.returns[asset]) ** (1 / 12) - 1);
    if (monthly > 0) {
      const budget = liquid(b) - yuan(12000);
      if (budget >= monthly) invest(s, j, monthly, "index", behavior.diversify);
      else if (!s.habitsPending.includes("investment")) s.habitsPending.push("investment");
    }
  }
  if (b.stocks + b.bonds > 0)
    expense(b, j, Math.round((b.stocks + b.bonds) * behavior.fee), "investment-fees");
  if (m.returns.stocks < -0.12 && behavior.panic && b.stocks > 0) {
    transfer(b, j, "stocks", "deposits", b.stocks, "panic-sale");
    s.flags.panic = m.year;
  }
  s.flags.previousStockReturn = m.returns.stocks;
}
