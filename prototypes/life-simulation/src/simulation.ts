import { type Card, dimensions, parseCard, startingSettings } from "./card.js";
import { applyDecision, decisionYears, eligibility, progressChains } from "./decisions.js";
import { createEngine } from "./engine.js";
import { events, support } from "./events.js";
import {
  type BalanceSheet,
  type Journal,
  closeJournal,
  expense,
  income,
  liquid,
  netWorth,
  openJournal,
  repay,
  transfer,
  yuan,
} from "./finance.js";
import { invest, investBehavior, marketFor, settleMarket } from "./market.js";
import {
  type Chapter,
  type Decision,
  type Focus,
  type Habits,
  type Market,
  type State,
  type Story,
  changeProps,
} from "./model.js";
import { sample } from "./random.js";
export type { Chapter, Decision, State } from "./model.js";
export const YEARS = 12;
export interface Plan {
  focus: Focus;
  habits: Habits;
}
export interface Config {
  card: Card;
  worldSeed: string;
  lifeSeed: string;
  year: number;
  decisions: Record<number, Decision>;
  plans: Record<number, Plan>;
}
export interface Run {
  config: Config;
  initial: State;
  baseline: Chapter[];
  changed: Chapter[];
}
export const defaultHabits = (): Habits => ({ jobSearch: false, training: false, monthlyInvestment: 0 });
export function initialState(card: Card, seed: string): State {
  if (card.age === null) throw new Error("请填写当前年龄 / Enter your current age");
  const start = startingSettings(card);
  const assets: BalanceSheet = {
    cash: yuan(start.cash),
    deposits: yuan(start.deposits),
    bonds: 0,
    stocks: 0,
    property: 0,
    debt: 0,
    interestRate: 0.065,
  };
  // Synthetic financial starting point, never inferred from user profile scores.
  return {
    age: card.age,
    props: Object.fromEntries(dimensions.map((k) => [k, card.attributes[k].value ?? 50])) as State["props"],
    role: start.role,
    education: card.education,
    specialty: card.specialty,
    experience: start.experienceYears,
    assets,
    abroad: false,
    investor: false,
    housing: "rent",
    family: { partner: false, partnerCanSupport: false, children: 0, pet: false },
    flags: {},
    lastEvents: {},
    salaryFactor: 1,
    businessScale: 1,
    arrearsYears: 0,
    focus: "balanced",
    habits: defaultHabits(),
    habitsPending: [],
  };
}
export function annualIncome(s: State, m: Market) {
  const education = { secondary: 0.86, vocational: 1, degree: 1.12, postgraduate: 1.22, unknown: 1 }[
    s.education
  ];
  const specialty = { service: 0.88, technical: 1.15, creative: 0.95, general: 1 }[s.specialty];
  const base = { employed: 96000, founder: 110000, student: 24000, unemployed: 12000, retired: 36000 }[
    s.role
  ];
  return yuan(
    base *
      education *
      specialty *
      (1 + Math.min(25, s.experience) * 0.012) *
      s.salaryFactor *
      (s.role === "founder" ? s.businessScale : 1) *
      (1 + m.demand) *
      (s.focus === "work" ? 1.06 : 1) *
      (s.abroad ? 1.12 : 1),
  );
}
function focusYear(s: State) {
  const effects: Record<Focus, Partial<State["props"]>> = {
    work: { health: -3, knowledge: 2, relationships: -2, happiness: -1 },
    balanced: { health: 1, happiness: 1 },
    people: { relationships: 5, happiness: 2, knowledge: -1 },
    health: { health: 5, happiness: 1 },
    learning: { knowledge: 5, health: -1 },
    hobby: { happiness: 5, knowledge: 1 },
  };
  changeProps(s, effects[s.focus]);
  if (s.age > 55) changeProps(s, { health: -1 });
}
function habits(s: State, j: Journal, m: Market, seed: string, offset: number): Story[] {
  const stories: Story[] = [];
  s.habitsPending = [];
  if (offset < 1) return stories;
  if (s.habits.training && m.year - (s.flags.lastTraining ?? Number.NEGATIVE_INFINITY) >= 2) {
    if (liquid(s.assets) >= yuan(17000)) {
      s.flags.lastTraining = m.year;
      expense(s.assets, j, yuan(3500), "training");
      changeProps(s, { knowledge: 4 });
      stories.push({
        id: "habit-training",
        text: [
          "两年一次的职训按计划完成，你把新方法带回了日常工作。",
          "The scheduled vocational course gave you a method to try in everyday work.",
        ],
        kind: "habit",
      });
    } else s.habitsPending.push("training");
  }
  if (s.habits.jobSearch && m.year - (s.flags.lastJobSearch ?? Number.NEGATIVE_INFINITY) >= 2) {
    if (s.role === "employed" || s.role === "unemployed") {
      if (liquid(s.assets) >= yuan(14000)) {
        s.flags.lastJobSearch = m.year;
        expense(s.assets, j, yuan(1200), "job-search");
        const ok = sample(seed, m.year, "habit-job") < 0.23 + s.props.knowledge * 0.003 + m.demand * 0.4;
        if (ok) {
          s.role = "employed";
          s.salaryFactor *= 1.08;
        }
        stories.push({
          id: `habit-job-${ok ? "offer" : "waiting"}`,
          text: ok
            ? [
                "定期投递带来一份更合适的邀约，你接受了新工作。",
                "Regular applications brought a better-fitting offer; you accepted.",
              ]
            : [
                "这一轮投递没有合适的邀约，原来的收入安排继续。",
                "This round brought no suitable offer; your current income arrangement continued.",
              ],
          kind: "habit",
        });
      } else s.habitsPending.push("job-search");
    } else s.habitsPending.push("job-search");
  }
  return stories;
}
function debtConsequences(s: State, j: Journal, m: Market): Story[] {
  const stories: Story[] = [];
  const add = (id: string, text: Story["text"], sensitive = false) =>
    stories.push({ id, text, kind: "consequence", ...(sensitive ? { support } : {}) });
  if (j.arrears > 0) {
    s.arrearsYears++;
    changeProps(s, { happiness: -4, health: -2 });
    if (s.arrearsYears === 1)
      add("debt-notice", [
        "未付账单进入催缴，你先申请了宽限安排。本年欠款和利息仍留在账上。",
        "Unpaid bills triggered a collection notice. You requested a grace arrangement; debt and interest remained on the books.",
      ]);
    else if (s.arrearsYears === 2) {
      const sale = s.assets.stocks + s.assets.bonds + s.assets.property;
      for (const a of ["stocks", "bonds", "property"] as const)
        transfer(s.assets, j, a, "cash", s.assets[a], "debt-asset-sale");
      if (sale > 0) {
        expense(s.assets, j, Math.round(sale * 0.015), "sale-fees");
        repay(s.assets, j, s.assets.debt, yuan(12000));
        if (s.housing === "owned") s.housing = "rent";
        add("debt-sell", [
          "宽限期后仍未补齐欠款，你出售了可处置的资产。交易费用付出后，所得优先还债。",
          "After the grace period, arrears remained. You sold available assets and used proceeds, after fees, to repay debt.",
        ]);
      } else {
        s.housing = "shared";
        expense(s.assets, j, yuan(2400), "moving");
        add("debt-shared", [
          "你搬进合租房压低固定开支。打包时舍弃了一些家具，债务还需要新的收入来解决。",
          "You moved into shared housing to reduce fixed costs, leaving some furniture behind. Debt still required new income.",
        ]);
      }
    } else if (s.arrearsYears >= 3 && s.housing !== "shared" && s.housing !== "temporary") {
      s.housing = "shared";
      expense(s.assets, j, yuan(2400), "moving");
      add("debt-shared", [
        "你搬进合租房，把省下的租金排进还款计划。",
        "You moved into shared housing and put the rent saving into the repayment plan.",
      ]);
    } else if (
      s.arrearsYears >= 4 &&
      s.housing === "shared" &&
      s.role === "unemployed" &&
      liquid(s.assets) === 0 &&
      !s.family.partnerCanSupport &&
      s.props.relationships < 25
    ) {
      s.housing = "temporary";
      add(
        "housing-temporary",
        [
          "租约无法续上，你暂时没有固定住所，开始联系临时住宿和当地支持服务。",
          "Unable to renew the lease, you temporarily had no stable home and contacted temporary housing and local support services.",
        ],
        true,
      );
    }
  } else if (s.arrearsYears > 0) {
    s.arrearsYears = 0;
    add("debt-current", [
      "本年的账单终于按时付清。旧债还没消失，但催缴停止了，你继续按计划偿还。",
      "This year’s bills were paid on time. Older debt remained, but collection stopped while regular repayments continued.",
    ]);
  }
  if (s.housing === "temporary" && liquid(s.assets) > yuan(16000)) {
    expense(s.assets, j, yuan(4500), "moving");
    s.housing = "shared";
    add("housing-recovery", [
      "新的收入让你付得起押金，你搬回一间固定的合租房。",
      "New income covered a deposit and a stable room in shared housing.",
    ]);
  }
  return stories;
}
export function step(previous: State, config: Config, offset: number, baseline = false): Chapter {
  const s = structuredClone(previous);
  s.age++;
  const year = config.year + offset;
  const market = marketFor(config.worldSeed, year);
  const journal = openJournal(s.assets);
  const stories: Story[] = [];
  const plan = baseline ? undefined : config.plans[offset];
  if (plan) {
    s.focus = plan.focus;
    s.habits = structuredClone(plan.habits);
  }
  focusYear(s);
  if (s.role === "student" && s.flags.graduation === undefined) s.flags.graduation = year + 2;
  stories.push(...progressChains(s, journal, market, config.lifeSeed));
  const decision = decisionYears.includes(offset)
    ? baseline
      ? { kind: "stay" as const }
      : (config.decisions[offset] ?? { kind: "stay" as const })
    : undefined;
  if (decision) stories.push(...applyDecision(s, journal, market, decision, config.lifeSeed));
  stories.push(...habits(s, journal, market, config.lifeSeed, offset));
  const salary = annualIncome(s, market);
  income(s.assets, journal, salary, s.role === "founder" ? "business-income" : "salary");
  // Deliberately simplified game tax/social model, not a Chinese tax calculator.
  expense(s.assets, journal, Math.round(salary * 0.18), "tax-social");
  const living = yuan(
    (s.housing === "owned"
      ? 26000
      : s.housing === "shared"
        ? 32000
        : s.housing === "temporary"
          ? 22000
          : 46000) * (s.abroad ? 1.35 : 1),
  );
  expense(s.assets, journal, living, "living");
  if (s.family.children > 0) expense(s.assets, journal, yuan(18000 * s.family.children), "children");
  expense(s.assets, journal, Math.round(s.assets.debt * s.assets.interestRate), "interest");
  // Only principal paid changes both debt and cash; unpaid required principal is not a second expense.
  if (s.assets.debt > 0)
    repay(s.assets, journal, Math.max(yuan(6000), Math.round(s.assets.debt * 0.12)), yuan(6000));
  if (!s.investor && liquid(s.assets) > yuan(80000) && investBehavior(s, config.lifeSeed, year).start)
    invest(s, journal, yuan(12000), "index", true);
  settleMarket(s, journal, market, config.lifeSeed);
  if (s.flags.chased === year)
    stories.push({
      id: "investment-chase",
      kind: "consequence",
      text: [
        "上一年的大涨让你追加了一笔投入。买入按这年的价格，结果没有复制上一年的涨幅。",
        "Last year’s rally prompted an extra investment. You bought at this year’s prices; last year’s return did not repeat.",
      ],
    });
  if (s.flags.panic === year)
    stories.push({
      id: "investment-panic",
      kind: "consequence",
      text: [
        "下跌让你把股票换回存款。这次卖出锁定了账面结果，后面的行情将发生在账户之外。",
        "The downturn led you to move stocks back to deposits. Selling locked in the account result; later market moves would happen outside that holding.",
      ],
    });
  stories.push(
    ...createEngine(events).next(s, journal, market, sample(config.lifeSeed, year, "annual-event")),
  );
  stories.push(...debtConsequences(s, journal, market));
  if (s.role === "employed" || s.role === "founder") s.experience++;
  if (s.assets.cash > yuan(18000))
    transfer(s.assets, journal, "cash", "deposits", s.assets.cash - yuan(18000), "savings");
  closeJournal(s.assets, journal);
  return { year, age: s.age, offset, market, stories, state: s, journal, ...(decision ? { decision } : {}) };
}
export function simulate(input: Config, years = YEARS): Run {
  const config = structuredClone(input);
  const initial = initialState(config.card, config.lifeSeed);
  const run: Run = { config, initial, baseline: [], changed: [] };
  for (const baseline of [true, false]) {
    let state = structuredClone(initial);
    const chapters = baseline ? run.baseline : run.changed;
    for (let i = 0; i < years; i++) {
      const row = step(state, config, i, baseline);
      chapters.push(row);
      state = row.state;
    }
  }
  return run;
}
/** Save boundary: validate the entire versioned command log, never restore arbitrary runtime state. */
export function parseSave(text: string): Config {
  if (text.length > 100000) throw new Error("存档过长 / Save too large");
  const data = JSON.parse(text);
  if (!data || data.kind !== "kaitu-simulation" || data.version !== 2)
    throw new Error("需要 version 2 游戏存档 / Version 2 save required");
  const c = data.config;
  if (!c || !Number.isInteger(c.year) || c.year < 1900 || c.year > 2200)
    throw new Error("无效年份 / Invalid year");
  for (const k of ["worldSeed", "lifeSeed"])
    if (typeof c[k] !== "string" || c[k].length < 1 || c[k].length > 40)
      throw new Error("无效种子 / Invalid seed");
  const config: Config = {
    card: parseCard(JSON.stringify(c.card)),
    year: c.year,
    worldSeed: c.worldSeed,
    lifeSeed: c.lifeSeed,
    decisions: {},
    plans: {},
  };
  if (
    !c.decisions ||
    !c.plans ||
    typeof c.decisions !== "object" ||
    typeof c.plans !== "object" ||
    Array.isArray(c.decisions) ||
    Array.isArray(c.plans)
  )
    throw new Error("无效操作记录 / Invalid command log");
  for (const [key, value] of Object.entries(c.decisions)) {
    const d = value as Decision;
    const n = Number(key);
    if (
      !decisionYears.includes(n) ||
      !d ||
      !["career", "business", "abroad", "invest", "study", "stay", "custom"].includes(d.kind) ||
      (d.funding && !["self", "loan"].includes(d.funding)) ||
      (d.investment && !["bonds", "index", "property"].includes(d.investment)) ||
      (d.custom && !["creative", "learning", "community"].includes(d.custom))
    )
      throw new Error("无效决策 / Invalid decision");
    config.decisions[n] = {
      kind: d.kind,
      ...(d.funding ? { funding: d.funding } : {}),
      ...(d.investment ? { investment: d.investment } : {}),
      ...(d.custom ? { custom: d.custom } : {}),
    };
  }
  for (const [key, value] of Object.entries(c.plans)) {
    const p = value as Plan;
    const n = Number(key);
    if (
      !Number.isInteger(n) ||
      n < 0 ||
      n >= YEARS ||
      !p ||
      !["work", "balanced", "people", "health", "learning", "hobby"].includes(p.focus) ||
      !p.habits ||
      typeof p.habits.jobSearch !== "boolean" ||
      typeof p.habits.training !== "boolean" ||
      !Number.isSafeInteger(p.habits.monthlyInvestment) ||
      p.habits.monthlyInvestment < 0 ||
      p.habits.monthlyInvestment > yuan(10000)
    )
      throw new Error("无效年度计划 / Invalid annual plan");
    config.plans[n] = {
      focus: p.focus,
      habits: {
        jobSearch: p.habits.jobSearch,
        training: p.habits.training,
        monthlyInvestment: p.habits.monthlyInvestment,
      },
    };
  }
  return config;
}
