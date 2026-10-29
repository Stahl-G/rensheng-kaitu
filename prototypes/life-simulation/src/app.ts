import {
  type Card,
  type Locale,
  blankCard,
  cardPrompt,
  dimensions,
  educationLabels,
  labels,
  parseCard,
  roleLabels,
  sampleCard,
  specialtyLabels,
  startingSettings,
} from "./card.js";
import { decisionYears, eligibility } from "./decisions.js";
import { liquid, netWorth, yuan } from "./finance.js";
import { escapeHtml as e, exportPng, mapSvg } from "./map.js";
import { marketConfig, marketFor } from "./market.js";
import {
  type Decision,
  type DecisionKind,
  type Focus,
  type State,
  type Story,
  decisionLabels,
  focusLabels,
} from "./model.js";
import { createYearTimer, yearDuration } from "./playback.js";
import { sceneSvg } from "./scene.js";
import {
  type Config,
  type Run,
  YEARS,
  defaultHabits,
  initialState,
  parseSave,
  simulate,
  step,
} from "./simulation.js";
let locale: Locale = navigator.language.startsWith("zh") ? "zh" : "en";
let page: "home" | "import" | "review" | "play" = "home";
let card = blankCard();
let run: Run | null = null;
let config: Config | null = null;
let playing = false;
let speed = 1;
let selected = 0;
let pasted = "";
let error = "";
let subchoice: DecisionKind | null = null;
let choiceCollapsed = false;
let sampleIndex = 0;
let restartWasPlaying: boolean | null = null;
const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("Missing app");
const t = (zh: string, en: string) => (locale === "zh" ? zh : en);
const pair = (v: readonly [string, string]) => v[locale === "zh" ? 0 : 1];
const money = (n: number) =>
  `${n < 0 ? "−" : ""}¥${(Math.abs(n) / 100).toLocaleString(locale === "zh" ? "zh-CN" : "en-US", { maximumFractionDigits: 0 })}`;
const seed = () => crypto.getRandomValues(new Uint32Array(1))[0].toString(36).toUpperCase();
const button = (id: string, label: string, cls = "") =>
  `<button type="button" id="${id}" class="${cls}">${label}</button>`;
const option = (value: string, label: string, current: string) =>
  `<option value="${e(value)}"${value === current ? " selected" : ""}>${e(label)}</option>`;
const state = (): State =>
  run?.changed.at(-1)?.state ?? run?.initial ?? initialState(sampleCard(0, locale), "home");
const shownState = (): State => run?.changed[selected - 1]?.state ?? state();
const nextOffset = () => run?.changed.length ?? 0;
const pending = () => !!run && decisionYears.includes(nextOffset()) && !config?.decisions[nextOffset()];
const yearTimer = createYearTimer(
  () => page === "play" && playing && !document.hidden && !pending() && nextOffset() < YEARS,
  () => {
    try {
      advance();
    } catch (reason) {
      report(reason);
    }
  },
);
function header() {
  return `<header>${button("home", `<span class="brand-icon">开</span><span>开图 <b>KAITU</b></span>`, "brand")}<div class="header-right"><span class="edition">${t("人生往后推 · 原型", "THE NEXT CHAPTER · PROTOTYPE")}</span>${button("language", locale === "zh" ? "EN" : "中文", "quiet")}${page === "play" ? `<details id="game-menu" class="game-menu"><summary aria-label="${t("更多操作", "More actions")}">···</summary><div>${button("restart", t("重玩同一开局", "Replay this start"), "text-button")}</div></details>` : ""}</div></header>`;
}
function home() {
  return `<main class="welcome"><section class="intro"><div class="eyebrow">${t("下一页，怎么过", "HOW WILL THE NEXT CHAPTER GO")}</div><h1>${t("把人生往后推。<br>这次，你来选。", "A life ahead.<br>Your turn to choose.")}</h1><div class="entry-actions">${button("random", t("随机人生 ↗", "A random life ↗"), "entry primary")}${button("personal", t("用我的资料 ↗", "Use my profile ↗"), "entry")}</div><div class="welcome-bottom"><span>${t("免登录 · 免安装", "No login · No installation")}</span>${button("load", t("载入这局人生", "Load a saved life"), "text-button")}<input id="load-file" type="file" accept=".json,application/json" hidden></div></section><section class="home-scene">${sceneSvg(initialState(sampleCard(0, locale), "home"), locale)}</section></main>`;
}
function importPage() {
  return `<main class="import-page"><h1>${t("从你开始。", "Begin with you.")}</h1><div class="import-grid"><section class="panel"><h2>ChatGPT / Claude / Gemini</h2>${button("copy-prompt", t("复制角色卡提示词", "Copy character prompt"), "primary")}<details><summary>${t("查看提示词", "View prompt")}</summary><textarea id="prompt" readonly>${e(cardPrompt(locale))}</textarea></details></section><section class="panel"><label for="paste">${t("粘贴角色卡 JSON", "Paste character JSON")}</label><textarea id="paste">${e(pasted)}</textarea>${button("parse", t("检查角色卡 →", "Review character →"), "primary")}${button("manual", t("自己填写", "Fill in myself"), "text-button")}</section></div></main>`;
}
function reviewPage() {
  const bg = card.background ?? {
    education: "",
    major: "",
    industry: "",
    occupation: "",
    experienceYears: null,
    source: "",
  };
  const start = startingSettings(card);
  const field = (name: string, label: string, value: string, max = 100) =>
    `<label>${label}<input name="${name}" value="${e(value)}" maxlength="${max}"></label>`;
  const select = (name: string, label: string, options: Record<string, [string, string]>, value: string) =>
    `<label>${label}<select name="${name}">${Object.entries(options)
      .map(([k, v]) => option(k, pair(v), value))
      .join("")}</select></label>`;
  return `<main class="review-page"><h1>${t("带上现在的你。", "Bring who you are today.")}</h1><form id="review-form"><section class="panel"><h2>${t("个人资料", "Personal background")}</h2><div class="field-row">${field("name", t("昵称", "Alias"), card.name, 24)}<label>${t("年龄", "Age")}<input name="age" type="number" min="18" max="90" required value="${card.age ?? ""}"></label>${select("role", t("就业状态", "Employment status"), roleLabels, card.role)}</div><div class="field-row">${field("bg-education", t("已完成学历层次", "Completed qualification"), bg.education, 80)}${field("bg-major", t("具体所学专业", "Field of study"), bg.major)}</div><div class="field-row">${field("bg-industry", t("行业", "Industry"), bg.industry)}${field("bg-occupation", t("具体岗位", "Occupation"), bg.occupation)}<label>${t("实际工作年数", "Known work experience")}<input name="experience" type="number" min="0" max="76" placeholder="${t("未知", "Unknown")}" value="${bg.experienceYears ?? ""}"></label></div>${field("background-source", t("资料依据 / 无法读取项", "Evidence / inaccessible items"), bg.source, 500)}${field("project", t("你想做的一件事", "Something you want to do"), card.project, 80)}<h2>${t("游戏状态", "Game stats")}</h2><div class="attributes">${dimensions.map((k) => `<div class="attribute-row"><label for="${k}">${pair(labels[k])}</label><input id="${k}" name="${k}" type="number" min="0" max="100" placeholder="${t("未知", "Unknown")}" value="${card.attributes[k].value ?? ""}"><input name="source-${k}" value="${e(card.attributes[k].source)}" maxlength="160" aria-label="${pair(labels[k])} ${t("依据", "source")}" placeholder="${t("来源 / 游戏设定", "Source / game setting")}"></div>`).join("")}</div><details open><summary>${t("模拟开局设定", "Simulation starting settings")}</summary><div class="field-row">${select("game-role", t("游戏就业状态", "Game employment"), Object.fromEntries(Object.entries(roleLabels).filter(([k]) => k !== "unknown")), start.role)}<label>${t("游戏工龄", "Game experience")}<input name="game-experience" type="number" min="0" max="76" required value="${start.experienceYears}"></label></div><div class="field-row"><label>${t("模拟现金 · RMB", "Simulated cash · RMB")}<input name="game-cash" type="number" min="0" max="1000000000" required value="${start.cash}"></label><label>${t("模拟存款 · RMB", "Simulated deposits · RMB")}<input name="game-deposits" type="number" min="0" max="1000000000" required value="${start.deposits}"></label></div><div class="field-row">${select("education", t("学历规则标签", "Education rule tag"), educationLabels, card.education)}${select("specialty", t("专业规则标签", "Field rule tag"), specialtyLabels, card.specialty)}</div></details><div class="form-actions">${button("edit-paste", t("返回原文", "Back to pasted text"), "text-button")}<button class="primary" type="submit">${t("开始这局人生 →", "Start this life →")}</button></div></section></form></main>`;
}
function readReview(form: HTMLFormElement) {
  const d = new FormData(form);
  const num = (name: string) => (d.get(name) === "" ? null : Number(d.get(name)));
  return parseCard(
    JSON.stringify({
      ...card,
      name: d.get("name"),
      age: num("age"),
      role: d.get("role"),
      education: d.get("education"),
      specialty: d.get("specialty"),
      project: d.get("project"),
      background: {
        education: d.get("bg-education"),
        major: d.get("bg-major"),
        industry: d.get("bg-industry"),
        occupation: d.get("bg-occupation"),
        experienceYears: num("experience"),
        source: d.get("background-source"),
      },
      starting: {
        role: d.get("game-role"),
        experienceYears: num("game-experience"),
        cash: num("game-cash"),
        deposits: num("game-deposits"),
      },
      attributes: Object.fromEntries(
        dimensions.map((k) => [k, { value: num(k), source: d.get(`source-${k}`) }]),
      ),
    }),
  );
}
function identity(s: State) {
  return `<aside class="identity panel"><div class="portrait" aria-hidden="true">${e(card.name.slice(0, 1) || "·")}</div><h2>${e(card.name || t("玩家", "Player"))}</h2><div class="identity-age">${s.age} ${t("岁", "years")}</div><div class="tag">${pair(roleLabels[s.role])}${s.abroad ? ` · ${t("海外", "Abroad")}` : ""}</div><div class="stat-list">${dimensions.map((k) => `<div><span>${pair(labels[k])}</span><b>${s.props[k]}</b><progress max="100" value="${s.props[k]}" aria-label="${pair(labels[k])}"></progress></div>`).join("")}</div><div class="networth"><span>${t("模拟净资产", "Simulated net assets")}</span><strong>${money(netWorth(s.assets))}</strong></div><details><summary>${t("开局资料", "Starting profile")}</summary><p>${e([card.background?.education, card.background?.major, card.background?.industry, card.background?.occupation].filter(Boolean).join(" · "))}</p><p>${t("原始就业状态", "Original employment")}: ${pair(roleLabels[card.role])} · ${t("实际工龄", "Known experience")}: ${card.background?.experienceYears ?? t("未知", "Unknown")}</p>${dimensions.map((k) => `<p>${pair(labels[k])}：${card.attributes[k].value ?? t("未知", "Unknown")} ${e(card.attributes[k].source)}</p>`).join("")}</details></aside>`;
}
function story(st: Story) {
  return `<article class="event ${st.kind}"><span class="event-dot"></span><p>${e(pair(st.text))}</p>${st.support ? `<div class="support">${st.support.map((s) => `<a href="${e(s.url)}" target="_blank" rel="noreferrer">${e(s.label)} ↗</a>`).join(" · ")}</div>` : ""}</article>`;
}
function controls() {
  const finished = nextOffset() >= YEARS;
  const current = run?.changed.at(-1);
  return `<div class="timebar"><div class="time-heading"><strong>${current?.year ?? config?.year} <small>· ${state().age} ${t("岁", "years")}</small></strong><span class="play-status">${finished ? t("本局回顾", "Life review") : pending() ? t("等待抉择", "Awaiting your choice") : playing ? t("时间流动中", "Time is running") : t("已暂停", "Paused")}</span></div><div class="playback-toolbar">${button("pause", playing ? t("暂停", "Pause") : t("继续", "Continue"), "primary")}<div class="speed-group">${[1, 2, 4].map((n) => `<button type="button" data-speed="${n}" aria-pressed="${speed === n}">${n}×</button>`).join("")}</div><span class="year-duration">${t("约", "About")} ${yearDuration(speed) / 1000} ${t("秒 / 年", "sec / year")}</span>${button("skip", t("到下个抉择 ↠", "Next choice ↠"), "quiet")}</div></div>`;
}
function focusPanel() {
  if (nextOffset() >= YEARS) return "";
  return `<section class="focus-panel panel"><div class="section-heading"><h2>${t("下一年重心", "Next year’s focus")}</h2><span>${(config?.year ?? 2026) + nextOffset()}</span></div><div class="focus-row">${Object.entries(
    focusLabels,
  )
    .map(
      ([k, v]) =>
        `<button type="button" data-focus="${k}" aria-pressed="${(config?.plans[nextOffset()]?.focus ?? state().focus) === k}">${pair(v)}</button>`,
    )
    .join("")}</div></section>`;
}
function decisionArea() {
  if (!pending()) return "";
  if (choiceCollapsed)
    return `<section class="decision-waiting"><b>${t("抉择待定 · 时间暂停", "Decision pending · Time paused")}</b>${button("choice-expand", t("展开抉择", "Show choices"))}</section>`;
  return `<div class="decision-area">${button("choice-collapse", t("收起抉择", "Collapse choices"), "text-button")}${choicePanel()}</div>`;
}
function choicePanel() {
  if (!pending()) return "";
  const s = state();
  const k = subchoice;
  if (k === "business") {
    const cost = yuan(
      42000 * (1 + marketFor(config?.worldSeed ?? "", (config?.year ?? 2026) + nextOffset()).demand),
    );
    return `<section class="decision-panel"><div class="eyebrow">${t("创业 · 启动资金", "BUSINESS · FUNDING")}</div><h2>${t("先开起来，钱怎么来？", "How will you fund the start?")}</h2><div class="decision-options"><button data-funding="self" ${liquid(s.assets) < cost + yuan(12000) ? "disabled" : ""}>${t("自筹", "Self-fund")} · ${money(cost)}<small>${t("保留 ¥12,000 缓冲", "Keep ¥12,000 reserve")}</small></button><button data-funding="loan">${t("借款 ¥60,000", "Borrow ¥60,000")}<small>${t("模拟年利率 6.5%", "Simulated annual interest 6.5%")}</small></button></div>${button("choice-back", t("返回", "Back"), "text-button")}</section>`;
  }
  if (k === "invest")
    return `<section class="decision-panel"><h2>${t("这笔钱放在哪里？", "Where will this money go?")}</h2><div class="decision-options"><button data-investment="bonds">${t("债券基金", "Bond fund")}</button><button data-investment="index">${t("股票指数", "Stock index")}</button><button data-investment="property" ${liquid(s.assets) < yuan(262000) ? "disabled" : ""}>${t("房产", "Property")}<small>¥250,000 + ¥12,000 ${t("缓冲", "reserve")}</small></button></div>${button("choice-back", t("返回", "Back"), "text-button")}</section>`;
  if (k === "custom")
    return `<section class="decision-panel"><h2>${e(card.project || t("你想做的一件事", "Something you want to do"))}</h2><div class="decision-options">${[
      ["creative", t("创作 / 做作品", "Create something")],
      ["learning", t("学一项技能", "Learn a skill")],
      ["community", t("组织 / 连接他人", "Bring people together")],
    ]
      .map(([v, label]) => `<button data-custom="${v}">${label}</button>`)
      .join(
        "",
      )}</div><div class="tag">${t("选择对应事件路线 · 无在线模型", "Choose an event route · No online model")}</div>${button("choice-back", t("返回", "Back"), "text-button")}</section>`;
  const costs: Record<DecisionKind, string> = {
    career: t("求职 ¥4,500 · 可能待业", "Search ¥4,500 · Job-gap risk"),
    business: t("客户、回款与融资", "Customers, cash flow, financing"),
    abroad: t("搬迁最高 ¥48,000", "Relocation up to ¥48,000"),
    invest: t("流动资金的 40% · 有涨有跌", "40% of available cash · Gains or losses"),
    study: t("学费 ¥28,000 · 暂停全职", "Tuition ¥28,000 · Leave full-time work"),
    stay: t("维持安排 · 风险仍在", "Keep routines · Risks remain"),
    custom: t("试作 ¥4,500", "An experiment · ¥4,500"),
  };
  return `<section class="decision-panel"><div class="eyebrow">${t("人生抉择", "A LIFE DECISION")} / ${s.age} → ${s.age + 1}</div><h2>${t("这一段，往哪里走？", "Where next?")}</h2><div class="decision-options">${Object.entries(
    decisionLabels,
  )
    .map(([key, label]) => {
      const blocked = eligibility(s, key as DecisionKind);
      return `<button type="button" data-decision="${key}"${blocked ? " disabled" : ""}>${pair(label)}<small>${blocked ? pair(blocked) : costs[key as DecisionKind]}</small></button>`;
    })
    .join("")}</div></section>`;
}
const entryLabels: Record<string, [string, string]> = {
  salary: ["工资 / 生活收入", "Earned income"],
  "business-income": ["经营收入", "Business income"],
  "extra-income": ["额外收入", "Extra income"],
  "tax-social": ["税与社保", "Tax & social"],
  living: ["生活支出", "Living"],
  interest: ["利息", "Interest"],
  principal: ["归还本金（转账）", "Principal (transfer)"],
  children: ["养育", "Children"],
  "partner-support": ["伴侣支持", "Partner support"],
  "investment-fees": ["投资费用", "Investment fees"],
  unexpected: ["意外支出", "Unexpected costs"],
  stocks: ["股票盈亏", "Stock return"],
  bonds: ["债券盈亏", "Bond return"],
  deposits: ["存款利息", "Deposit return"],
  property: ["房产涨跌", "Property return"],
  startup: ["创业启动", "Startup"],
  "business-closure": ["停业损失", "Closure"],
  tuition: ["学费", "Tuition"],
  relocation: ["搬迁", "Relocation"],
  moving: ["搬家", "Moving"],
  "fraud-loss": ["诈骗损失", "Fraud loss"],
  "career-cost": ["转职成本", "Career cost"],
  "custom-project": ["自定义试作", "Custom experiment"],
  training: ["职训", "Training"],
  "job-search": ["定期求职", "Job search"],
  rest: ["休整", "Rest"],
  "sale-fees": ["出售费用", "Sale fees"],
};
function habitsPanel(s: State) {
  if (nextOffset() >= YEARS) return "";
  return `<section class="habits panel"><details id="habits-panel"><summary>${t("长期习惯", "Long-term habits")}</summary><label class="check"><input id="habit-job" type="checkbox" ${(config?.plans[nextOffset()]?.habits ?? state().habits).jobSearch ? "checked" : ""}>${t("每两年找一次转职", "Job search every two years")}</label><label class="check"><input id="habit-training" type="checkbox" ${(config?.plans[nextOffset()]?.habits ?? state().habits).training ? "checked" : ""}>${t("每两年一次职训", "Training every two years")}</label><label>${t("每月定投 · RMB", "Monthly investment · RMB")}<select id="habit-invest">${[0, 500, 1000, 2000].map((n) => option(String(n), money(yuan(n)), String((config?.plans[nextOffset()]?.habits ?? state().habits).monthlyInvestment / 100))).join("")}</select></label>${s.habitsPending.length ? `<div class="tag">${t("等待资金或身份条件", "Waiting for funds or role")}: ${s.habitsPending.map((k) => (k === "training" ? t("职训", "Training") : k === "investment" ? t("定投", "Investment") : t("转职", "Search"))).join("、")}</div>` : ""}</details></section>`;
}
function householdPanel(s: State) {
  return `<section class="household-panel panel"><h2>${t("模拟生活", "Life in this game")}</h2><div class="household"><span>${t({ rent: "租住", shared: "合租", owned: "自有住房", temporary: "临时住宿" }[s.housing], s.housing)}</span><span>${pair(roleLabels[s.role])}</span>${s.abroad ? `<span>${t("海外生活", "Living abroad")}</span>` : ""}${s.family.partner ? `<span>${t("伴侣", "Partner")}</span>` : ""}${s.family.children ? `<span>${t("孩子", "Children")} × ${s.family.children}</span>` : ""}${s.family.pet ? `<span>${t("宠物", "Pet")}</span>` : ""}</div></section>`;
}
function ledgerPanel(s: State) {
  const row = run?.changed[selected - 1];
  const groups = new Map<string, number>();
  for (const en of row?.journal.entries ?? []) {
    if (en.kind === "transfer") continue;
    groups.set(en.label, (groups.get(en.label) ?? 0) + (en.kind === "expense" ? -en.amount : en.amount));
  }
  const gross =
    row?.journal.entries.filter((e) => e.kind === "income").reduce((n, e) => n + e.amount, 0) ?? 0;
  const costs =
    row?.journal.entries.filter((e) => e.kind === "expense").reduce((n, e) => n + e.amount, 0) ?? 0;
  const tax =
    row?.journal.entries.filter((e) => e.label === "tax-social").reduce((n, e) => n + e.amount, 0) ?? 0;
  const living =
    row?.journal.entries
      .filter((e) => e.label === "living" || e.label === "children")
      .reduce((n, e) => n + e.amount, 0) ?? 0;
  const ratios = gross
    ? ([
        ["税社保", "Tax & social", tax],
        ["生活", "Living", living],
        ["其他开支", "Other costs", costs - tax - living],
        ["结余", "Saved income", gross - costs],
      ] as const)
    : [];
  const balances: [string, string][] = [
    ["cash", t("现金", "Cash")],
    ["deposits", t("存款", "Deposits")],
    ["bonds", t("债券", "Bonds")],
    ["stocks", t("股票", "Stocks")],
    ["property", t("房产", "Property")],
    ["debt", t("负债", "Debt")],
  ];
  const balanceRow = ([key, label]: [string, string]) =>
    `<div><dt>${label}</dt><dd>${money(s.assets[key as keyof Omit<State["assets"], "interestRate">])}</dd></div>`;
  const zero = balances.filter(([key]) => s.assets[key as keyof Omit<State["assets"], "interestRate">] === 0);
  return `<section class="finances panel"><div class="section-heading"><h2>${t("资产与收支", "Money")}</h2><span class="tag">${t("模拟 RMB", "SIM RMB")}</span></div><div class="money-total"><span>${t("净资产", "Net assets")}</span><strong>${money(netWorth(s.assets))}</strong></div><dl class="balance">${balances
    .filter(([key]) => s.assets[key as keyof Omit<State["assets"], "interestRate">] !== 0)
    .map(balanceRow)
    .join(
      "",
    )}${s.assets.debt ? `<div><dt>${t("借款利率", "Debt rate")}</dt><dd>${(s.assets.interestRate * 100).toFixed(1)}%</dd></div>` : ""}</dl>${zero.length ? `<details id="zero-balances"><summary>${t("零余额账户", "Zero balances")} · ${zero.length}</summary><dl>${zero.map(balanceRow).join("")}</dl></details>` : ""}<h3>${row?.year ?? config?.year} · ${t("年度收支", "Annual cash flow")}</h3><dl class="annual-summary"><div><dt>${t("收入", "Income")}</dt><dd>${money(gross)}</dd></div><div><dt>${t("支出", "Expenses")}</dt><dd>${money(costs)}</dd></div><div><dt>${t("净资产变化", "Net change")}</dt><dd>${row ? money(row.journal.closing - row.journal.opening) : "—"}</dd></div></dl><details id="journal-panel"><summary>${t("年度明细", "Annual breakdown")}</summary><dl class="journal">${[
    ...groups,
  ]
    .filter(([, v]) => v !== 0)
    .map(
      ([k, v]) =>
        `<div><dt>${entryLabels[k] ? pair(entryLabels[k]) : e(k)}</dt><dd>${v > 0 ? "+" : ""}${money(v)}</dd></div>`,
    )
    .join(
      "",
    )}</dl>${row?.journal.principalPaid ? `<div class="principal-note">${t("归还本金 · 转账", "Principal · transfer")}: ${money(row.journal.principalPaid)}</div>` : ""}</details><details id="allocation-panel"><summary>${t("收入去向 · 估算", "Income allocation · estimate")}</summary><dl>${ratios.map(([zh, en, value]) => `<div><dt>${t(zh, en)}</dt><dd>${Math.round((value / gross) * 100)}%</dd></div>`).join("")}</dl></details></section>`;
}
function conclusion() {
  if (nextOffset() < YEARS || !run) return "";
  const a = run.baseline.at(-1)?.state;
  const b = state();
  return `<section class="ending-card"><div class="eyebrow">${t("十二年之后", "TWELVE YEARS LATER")}</div><h2>${t("你走过的路，留下了这些变化。", "These choices left their marks.")}</h2><table><thead><tr><th></th><th>${t("照现在过", "As things are")}</th><th>${t("你的选择", "Your choices")}</th></tr></thead><tbody><tr><td>${t("模拟净资产", "Simulated net assets")}</td><td>${money(a ? netWorth(a.assets) : 0)}</td><td>${money(netWorth(b.assets))}</td></tr>${dimensions.map((k) => `<tr><td>${pair(labels[k])}</td><td>${a?.props[k]}</td><td>${b.props[k]}</td></tr>`).join("")}</tbody></table><div class="ending-actions">${button("again", t("再来一局 ↗", "Another life ↗"), "primary")}${button("save", t("导出这局人生 JSON", "Export this life JSON"))}${button("png", t("导出对照卡 PNG", "Export comparison PNG"))}</div></section>`;
}
function playPage() {
  if (!run || !config) return "";
  const s = shownState();
  const row = run.changed[selected - 1];
  return `${controls()}<main class="game-shell">${identity(s)}<section class="game-main"><div class="scene-top"><span>${row?.year ?? config.year} · ${s.age} ${t("岁", "years")}</span><span>${row?.market.crisis ? t("市场冲击", "Market shock") : t("日子继续", "Life goes on")} · ${t("指数", "Index")} ${((row?.market.returns.stocks ?? 0) * 100).toFixed(1)}%</span></div><div class="life-scene">${sceneSvg(s, locale, true)}</div>${focusPanel()}${decisionArea()}<section class="events-feed panel" aria-label="${t("年度事件", "Annual events")}"><div class="section-heading"><h2>${t("人生记录", "Life journal")}</h2><span>${row?.year} · ${s.age} ${t("岁", "years")}</span></div><nav class="year-nav" aria-label="${t("年份回顾", "Year review")}">${run.changed.map((r, i) => `<button type="button" data-year="${i + 1}" aria-current="${selected === i + 1 ? "true" : "false"}">${r.age}${r.decision ? " ◆" : ""}</button>`).join("")}</nav>${row?.stories.map(story).join("") ?? ""}${selected < nextOffset() ? button("latest", t("回到现在", "Back to now"), "text-button") : ""}</section>${conclusion()}<details id="route-panel" class="route-review"><summary>${t("双线回顾", "Two paths")} · ${t("同一个世界", "One shared world")}</summary>${mapSvg(run, selected, locale)}<div class="baseline-story">${run.baseline[selected - 1]?.stories.map(story).join("") ?? ""}</div></details><details id="rules-panel" class="rules"><summary>${t("规则、参数与来源", "Rules, parameters & sources")}</summary><p>${t("人民币为游戏金额；初始资产采用可修改的模拟设定。四属性未知用中性 50，原卡仍保留未知。行情均值、波动、税社保和事件概率是作者设定，不是个人预测。", "RMB amounts and editable starting balances are simulated. Unknown stats use neutral 50; the source card retains unknown. Return means, volatility, tax/social rates and event odds are authored game assumptions, not personal predictions.")}</p><p>${t("一般知识对投资行为只有弱关联；性格随机项独立。知识不改变市场回报。定投按每月末结算，年内用平滑路径复合到同一年度行情。", "General knowledge has a weak game association with investment behavior; temperament is independent. Knowledge never changes market returns. Recurring investments settle at each month-end on a smooth path compounding to the shared annual return.")}</p><ul>${(["deposits", "bonds", "stocks", "property"] as const).map((k) => `<li>${pair(entryLabels[k])}: μ ${(marketConfig[k].mean * 100).toFixed(1)}%, σ ${(marketConfig[k].volatility * 100).toFixed(1)}% · <a href="${marketConfig[k].reference}" target="_blank" rel="noreferrer">${t("机制参考", "Mechanism reference")}</a></li>`).join("")}</ul><code>${e(config.worldSeed)} / ${e(config.lifeSeed)}</code></details></section><aside class="life-sidebar">${householdPanel(s)}${ledgerPanel(s)}${habitsPanel(state())}</aside></main>`;
}
function restartDialog() {
  return `<dialog id="restart-dialog" aria-labelledby="restart-title"><h2 id="restart-title">${t("重新开始这一局？", "Restart this life?")}</h2><p>${t("当前进度会被替换。", "This will replace your current progress.")}</p><div class="dialog-actions">${button("restart-cancel", t("取消", "Cancel"), "primary")}${button("restart-confirm", t("确认重玩", "Restart"))}</div></dialog>`;
}
function requestRestart() {
  if (!config) return;
  if (nextOffset() >= YEARS) {
    begin({ ...structuredClone(config), decisions: {}, plans: {} });
    return;
  }
  restartWasPlaying = playing;
  playing = false;
  render();
}
function cancelRestart() {
  if (restartWasPlaying === null) return;
  playing = restartWasPlaying && !document.hidden;
  restartWasPlaying = null;
  render();
}
function report(reason: unknown) {
  playing = false;
  error = reason instanceof Error ? reason.message : String(reason);
  render();
}
function click(id: string, fn: () => void | Promise<void>) {
  document.getElementById(id)?.addEventListener("click", () => {
    Promise.resolve().then(fn).catch(report);
  });
}
function onAll(selector: string, fn: (el: HTMLElement) => void) {
  for (const el of document.querySelectorAll<HTMLElement>(selector)) {
    el.addEventListener("click", () => {
      try {
        fn(el);
      } catch (reason) {
        report(reason);
      }
    });
  }
}
function begin(c?: Config) {
  yearTimer.stop();
  restartWasPlaying = null;
  config = c ?? {
    card: structuredClone(card),
    worldSeed: seed(),
    lifeSeed: seed(),
    year: new Date().getUTCFullYear(),
    decisions: {},
    plans: {},
  };
  card = config.card;
  run = { config, initial: initialState(card, config.lifeSeed), baseline: [], changed: [] };
  page = "play";
  playing = true;
  error = "";
  subchoice = null;
  choiceCollapsed = false;
  advance();
  window.scrollTo(0, 0);
}
function randomStart() {
  performance.mark("kaitu:random-input");
  card = sampleCard(sampleIndex++, locale);
  begin();
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      performance.measure("kaitu:random-to-paint", "kaitu:random-input");
    }),
  );
}
function advance(renderNow = true) {
  if (!run || !config) return;
  if (pending() || nextOffset() >= YEARS) {
    playing = false;
    if (renderNow) render();
    return;
  }
  const i = nextOffset();
  const b = step(run.baseline.at(-1)?.state ?? run.initial, config, i, true);
  const c = step(state(), config, i);
  run.baseline.push(b);
  run.changed.push(c);
  selected = nextOffset();
  if (pending() || nextOffset() >= YEARS) playing = false;
  if (renderNow) render();
}
function decide(d: Decision) {
  if (!config || !pending()) return;
  performance.mark("kaitu:decision-input");
  const i = nextOffset();
  config.decisions[i] = d;
  subchoice = null;
  choiceCollapsed = false;
  playing = true;
  try {
    advance();
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        performance.measure("kaitu:decision-to-paint", "kaitu:decision-input");
      }),
    );
  } catch (reason) {
    delete config.decisions[i];
    report(reason);
  }
}
function updatePlan(patch: Partial<{ focus: Focus; habits: State["habits"] }>) {
  if (!config || nextOffset() >= YEARS) return;
  config.plans[nextOffset()] = {
    ...(config.plans[nextOffset()] ?? { focus: state().focus, habits: structuredClone(state().habits) }),
    ...patch,
  };
  render();
}
function save() {
  if (!config) return;
  const url = URL.createObjectURL(
    new Blob([JSON.stringify({ kind: "kaitu-simulation", version: 2, config }, null, 2)], {
      type: "application/json",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "kaitu-life.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function render() {
  yearTimer.stop();
  if (!root) return;
  const openPanels = [...document.querySelectorAll<HTMLDetailsElement>("details[id][open]")].map(
    (el) => el.id,
  );
  document.body.classList.toggle("playing-game", page === "play");
  document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  root.innerHTML = `${
    header() +
    (error ? `<div class="error" role="alert">${e(error)}</div>` : "") +
    (page === "home"
      ? home()
      : page === "import"
        ? importPage()
        : page === "review"
          ? reviewPage()
          : playPage())
  }${page === "play" ? restartDialog() : ""}<footer><span>KAITU · ${t("推演", "SIMULATION")}</span><a href="./vendor/remake/LICENSE" target="_blank" rel="noreferrer">Remake · MIT</a></footer>`;
  for (const id of openPanels) {
    const panel = document.getElementById(id);
    if (panel instanceof HTMLDetailsElement) panel.open = true;
  }
  click("home", () => {
    playing = false;
    page = "home";
    error = "";
    render();
  });
  click("language", () => {
    const form = document.getElementById("review-form");
    if (form instanceof HTMLFormElement) card = readReview(form);
    pasted = document.querySelector<HTMLTextAreaElement>("#paste")?.value ?? pasted;
    locale = locale === "zh" ? "en" : "zh";
    render();
  });
  click("random", randomStart);
  click("again", randomStart);
  click("personal", () => {
    page = "import";
    error = "";
    render();
  });
  click("manual", () => {
    pasted = document.querySelector<HTMLTextAreaElement>("#paste")?.value ?? pasted;
    card = blankCard();
    error = "";
    page = "review";
    render();
  });
  click("edit-paste", () => {
    page = "import";
    error = "";
    render();
  });
  click("copy-prompt", async () => {
    await navigator.clipboard.writeText(cardPrompt(locale));
    const b = document.getElementById("copy-prompt");
    if (b) b.textContent = t("已复制", "Copied");
  });
  click("parse", () => {
    pasted = document.querySelector<HTMLTextAreaElement>("#paste")?.value ?? pasted;
    card = parseCard(pasted);
    page = "review";
    error = "";
    render();
  });
  document.getElementById("review-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      card = readReview(event.target as HTMLFormElement);
      begin();
    } catch (reason) {
      report(reason);
    }
  });
  for (const [fact, game] of [
    ["role", "game-role"],
    ["experience", "game-experience"],
  ]) {
    const source = document.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${fact}"]`);
    const target = document.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${game}"]`);
    target?.addEventListener("change", () => {
      target.dataset.edited = "true";
    });
    source?.addEventListener("change", () => {
      if (target && !target.dataset.edited && source.value && source.value !== "unknown")
        target.value = source.value;
    });
  }
  for (const id of ["pause", "skip"]) {
    const control = document.getElementById(id);
    if (control instanceof HTMLButtonElement) control.disabled = pending() || nextOffset() >= YEARS;
  }
  click("pause", () => {
    if (pending() || nextOffset() >= YEARS) return;
    playing = !playing;
    selected = nextOffset();
    render();
  });
  click("skip", () => {
    playing = false;
    while (!pending() && nextOffset() < YEARS) advance(false);
    render();
  });
  click("restart", requestRestart);
  click("restart-cancel", cancelRestart);
  click("restart-confirm", () => {
    if (restartWasPlaying !== null && config) begin({ ...structuredClone(config), decisions: {}, plans: {} });
  });
  const restart = document.getElementById("restart-dialog");
  if (restart instanceof HTMLDialogElement) {
    restart.addEventListener("cancel", (event) => {
      event.preventDefault();
      cancelRestart();
    });
    if (restartWasPlaying !== null) {
      restart.showModal();
      document.getElementById("restart-cancel")?.focus();
    }
  }
  onAll("[data-speed]", (el) => {
    speed = Number(el.dataset.speed);
    render();
  });
  onAll("[data-focus]", (el) => updatePlan({ focus: el.dataset.focus as Focus }));
  onAll("[data-year]", (el) => {
    selected = Number(el.dataset.year);
    playing = false;
    render();
  });
  onAll("[data-decision]", (el) => {
    if (!pending()) return;
    const kind = el.dataset.decision as DecisionKind;
    if (["business", "invest", "custom"].includes(kind)) {
      subchoice = kind;
      render();
    } else decide({ kind });
  });
  onAll("[data-funding]", (el) =>
    decide({ kind: "business", funding: el.dataset.funding as Decision["funding"] }),
  );
  onAll("[data-investment]", (el) =>
    decide({ kind: "invest", investment: el.dataset.investment as Decision["investment"] }),
  );
  onAll("[data-custom]", (el) => decide({ kind: "custom", custom: el.dataset.custom as Decision["custom"] }));
  click("latest", () => {
    selected = nextOffset();
    render();
  });
  click("choice-collapse", () => {
    choiceCollapsed = true;
    playing = false;
    render();
  });
  click("choice-expand", () => {
    choiceCollapsed = false;
    playing = false;
    render();
  });
  click("choice-back", () => {
    subchoice = null;
    render();
  });
  for (const id of ["habit-job", "habit-training", "habit-invest"])
    document.getElementById(id)?.addEventListener("change", () => {
      const h = { ...(config?.plans[nextOffset()]?.habits ?? state().habits) };
      if (id === "habit-job") h.jobSearch = (document.getElementById(id) as HTMLInputElement).checked;
      if (id === "habit-training") h.training = (document.getElementById(id) as HTMLInputElement).checked;
      if (id === "habit-invest")
        h.monthlyInvestment = yuan(Number((document.getElementById(id) as HTMLSelectElement).value));
      updatePlan({ habits: h });
    });
  click("save", save);
  click("png", () => exportPng(mapSvg(run, nextOffset(), locale, true)));
  click("load", () => document.getElementById("load-file")?.click());
  document.getElementById("load-file")?.addEventListener("change", async (event) => {
    try {
      const f = (event.target as HTMLInputElement).files?.[0];
      if (!f) return;
      if (f.size > 100000) throw new Error("存档过长 / Save too large");
      config = parseSave(await f.text());
      run = simulate(config);
      card = config.card;
      selected = YEARS;
      page = "play";
      playing = false;
      error = "";
      render();
    } catch (reason) {
      report(reason);
    }
  });
  // A user opening/closing details pauses the year without rerendering the disclosure.
  // Listen to summary clicks, not toggle: default-open panels also emit toggle on render.
  for (const summary of document.querySelectorAll(".game-shell summary")) {
    summary.addEventListener("click", () => {
      playing = false;
      yearTimer.stop();
      const pause = document.getElementById("pause");
      if (pause) pause.textContent = t("继续", "Continue");
      const status = document.querySelector(".play-status");
      if (status && !pending() && nextOffset() < YEARS) status.textContent = t("已暂停", "Paused");
    });
  }
  yearTimer.schedule(speed);
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden && restartWasPlaying !== null) restartWasPlaying = false;
  if (document.hidden && playing) {
    playing = false;
    render();
  }
});
render();
