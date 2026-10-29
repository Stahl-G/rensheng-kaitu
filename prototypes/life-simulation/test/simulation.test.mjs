import assert from "node:assert/strict";
import { test } from "node:test";
import { blankCard, parseCard, sampleCard } from "../dist/card.js";
import { decisionYears, eligibility } from "../dist/decisions.js";
import { createEngine } from "../dist/engine.js";
import { events } from "../dist/events.js";
import { closeJournal, netWorth, openJournal, yuan } from "../dist/finance.js";
import { invest, marketFor, settleMarket } from "../dist/market.js";
import { YEARS, defaultHabits, initialState, parseSave, simulate, step } from "../dist/simulation.js";
const config = (seed = "A") => ({
  card: sampleCard(0, "zh"),
  worldSeed: seed,
  lifeSeed: `${seed}-life`,
  year: 2026,
  decisions: {},
  plans: {},
});
const kinds = ["career", "business", "abroad", "invest", "study", "stay", "custom"];
function play(seed, kind) {
  const c = config(seed);
  let s = initialState(c.card, c.lifeSeed);
  const rows = [];
  for (let i = 0; i < YEARS; i++) {
    if (decisionYears.includes(i)) {
      c.decisions[i] = eligibility(s, kind)
        ? { kind: "stay" }
        : { kind, funding: "loan", custom: "creative", investment: "index" };
    }
    const row = step(s, c, i);
    rows.push(row);
    s = row.state;
  }
  return { c, rows };
}
function overlap(a, b) {
  const counts = new Map();
  for (const x of a) counts.set(x, (counts.get(x) || 0) + 1);
  let same = 0;
  for (const x of b)
    if (counts.get(x) > 0) {
      same++;
      counts.set(x, counts.get(x) - 1);
    }
  return (2 * same) / (a.length + b.length);
}
const normalized = (text) =>
  text
    .replace(/[\d,.¥￥]+/g, "#")
    .replace(/林|Lin|周|Zhou|乔|Jo/g, "PERSON")
    .replace(/\s/g, "");
test("card source and unknown survive; invalid card/save operations are rejected", () => {
  const card = blankCard();
  card.age = 36;
  card.name = "<script>bad</script>";
  card.attributes.knowledge = { value: 71, source: "AI game estimate" };
  assert.deepEqual(parseCard(JSON.stringify(card)), card);
  assert.equal(card.attributes.health.value, null);
  for (const patch of [
    { age: -1 },
    { age: 2.5 },
    { attributes: [] },
    { attributes: { health: { value: 101 } } },
    { role: "both" },
    { version: 1 },
  ])
    assert.throws(() => parseCard(JSON.stringify({ ...card, ...patch })));
  const c = config();
  const run = simulate(c);
  assert.deepEqual(parseSave(JSON.stringify({ kind: "kaitu-simulation", version: 2, config: c })), c);
  assert.throws(() =>
    parseSave(
      JSON.stringify({
        kind: "kaitu-simulation",
        version: 2,
        config: {
          ...c,
          plans: { 0: { focus: "work", habits: { ...defaultHabits(), monthlyInvestment: -1 } } },
        },
      }),
    ),
  );
  assert.equal(run.changed[0].age, c.card.age + 1);
  assert.deepEqual(c, config());
});
test("160 fixed seeds: replay, all decision outcomes, current-state selection, shared markets and accounting", () => {
  const report = {};
  for (const kind of kinds) {
    const runs = [];
    const outcomes = new Set();
    for (let i = 0; i < 160; i++) {
      const seed = `acceptance-${String(i).padStart(3, "0")}`;
      const a = play(seed, kind);
      const replay = simulate(a.c);
      assert.deepEqual(a.rows, replay.changed);
      for (const [index, row] of a.rows.entries()) {
        assert.deepEqual(row.market, replay.baseline[index].market);
        assert.deepEqual(row.market, marketFor(seed, row.year));
        assert.ok(["employed", "founder", "student", "unemployed", "retired"].includes(row.state.role));
        assert.deepEqual(Object.keys(row.state.props).sort(), [
          "happiness",
          "health",
          "knowledge",
          "relationships",
        ]);
        assert.equal(
          row.journal.opening +
            row.journal.entries.reduce(
              (n, e) => n + (e.kind === "expense" ? -e.amount : e.kind === "transfer" ? 0 : e.amount),
              0,
            ),
          row.journal.closing,
        );
        for (const event of row.stories) {
          if (event.id.startsWith(`decision-${kind}-`)) outcomes.add(event.outcome);
          if (event.id === "housing-temporary" || event.id === "fraud-guaranteed")
            assert.ok(event.support?.every((s) => s.url.startsWith("https://")));
        }
      }
      runs.push(a.rows.flatMap((r) => r.stories));
    }
    // Fixed pairing: 0↔1, 2↔3, …, 158↔159. Same character and deterministic decision policy.
    const ids = [];
    const texts = [];
    for (let i = 0; i < 160; i += 2) {
      ids.push(
        overlap(
          runs[i].map((e) => e.id),
          runs[i + 1].map((e) => e.id),
        ),
      );
      texts.push(
        overlap(
          runs[i].map((e) => normalized(e.text[0])),
          runs[i + 1].map((e) => normalized(e.text[0])),
        ),
      );
    }
    const mean = (x) => x.reduce((a, b) => a + b, 0) / x.length;
    report[kind] = {
      templateMean: mean(ids),
      normalizedTextMean: mean(texts),
      maxPair: Math.max(...texts),
      outcomes: [...outcomes],
    };
    assert.ok(mean(ids) < 0.5, `${kind} template overlap ${mean(ids)}`);
    assert.ok(mean(texts) < 0.5, `${kind} body overlap ${mean(texts)}`);
    assert.deepEqual([...outcomes].sort(), ["failure", "success"]);
  }
  console.log("160-seed fixed-pair overlap", JSON.stringify(report));
  const a = initialState(config().card, "A");
  const b = structuredClone(a);
  b.props.health = 15;
  b.props.knowledge = 10;
  b.props.relationships = 15;
  b.props.happiness = 15;
  const engine = createEngine(events);
  assert.notDeepEqual(engine.weights(a, marketFor("A", 2026)), engine.weights(b, marketFor("A", 2026)));
  for (const e of events) if (e.sensitive) assert.ok(e.support?.length);
});
test("event cooldown, conditional eligibility and per-instance state hold", () => {
  const c = config();
  const run = simulate(c);
  for (const path of [run.baseline, run.changed]) {
    const last = new Map();
    for (const row of path) {
      for (const s of row.stories.filter((x) => x.kind === "ordinary")) {
        const event = events.find((e) => e.id === s.id);
        if (last.has(s.id)) assert.ok(row.year - last.get(s.id) > event.cooldown);
        last.set(s.id, row.year);
      }
    }
  }
  run.baseline[0].state.props.health = 0;
  assert.notEqual(run.changed[0].state.props.health, 0);
  const s = initialState(c.card, "A");
  s.role = "student";
  assert.ok(
    createEngine(events)
      .weights(s, marketFor("A", 2026))
      .every(([id]) => !id.startsWith("work-") && !id.startsWith("business-")),
  );
});
test("debt has grace, collection, conditional housing consequences and recovery; partner support requires capability", () => {
  const c = config("debt");
  let s = initialState(c.card, c.lifeSeed);
  s.role = "unemployed";
  s.props.relationships = 5;
  s.props.health = 5;
  s.assets = {
    cash: 0,
    deposits: 0,
    bonds: 0,
    stocks: 0,
    property: 0,
    debt: yuan(800000),
    interestRate: 0.1,
  };
  const seen = [];
  for (let i = 0; i < 5; i++) {
    const r = step(s, c, i);
    seen.push(...r.stories);
    s = r.state;
  }
  assert.ok(seen.some((e) => e.id === "debt-notice"));
  assert.ok(seen.some((e) => e.id === "debt-shared"));
  assert.ok(seen.some((e) => e.id === "housing-temporary"));
  assert.ok(!seen.some((e) => e.id === "partner-support"));
  s.role = "employed";
  s.assets.cash = yuan(1000000);
  const recovered = step(s, c, 6);
  assert.equal(recovered.state.housing, "shared");
  assert.ok(recovered.stories.some((e) => e.id === "housing-recovery"));
});
test("1000 paired market seeds: knowledge changes behavior, never gross return; investment distributions overlap", () => {
  const high = [];
  const low = [];
  function investmentRun(i, knowledge) {
    const seed = `investment-${String(i).padStart(4, "0")}`;
    const s = initialState(config().card, seed);
    s.props.knowledge = knowledge;
    s.assets = {
      cash: yuan(112000),
      deposits: 0,
      bonds: 0,
      stocks: 0,
      property: 0,
      debt: 0,
      interestRate: 0.065,
    };
    s.habits.monthlyInvestment = 0;
    const start = netWorth(s.assets);
    const j = openJournal(s.assets);
    invest(s, j, yuan(100000), "index", false);
    closeJournal(s.assets, j);
    for (let year = 2026; year < 2038; year++) {
      const j = openJournal(s.assets);
      settleMarket(s, j, marketFor(seed, year), seed);
      closeJournal(s.assets, j);
    }
    return netWorth(s.assets) / start - 1;
  }
  for (let i = 0; i < 1000; i++) {
    low.push(investmentRun(i, 25));
    high.push(investmentRun(i, 85));
  }
  const mean = (a) => a.reduce((n, x) => n + x, 0) / a.length;
  const quant = (a, p) => [...a].sort((x, y) => x - y)[Math.floor((a.length - 1) * p)];
  const bins = Array.from({ length: 42 }, () => [0, 0]);
  for (const [g, values] of [low, high].entries())
    for (const v of values) bins[Math.min(41, Math.max(0, Math.floor((v + 1) * 10)))][g]++;
  const histogramOverlap = bins.reduce((n, [l, h]) => n + Math.min(l, h), 0) / 1000;
  const summary = {
    low: {
      mean: mean(low),
      p10: quant(low, 0.1),
      p50: quant(low, 0.5),
      p90: quant(low, 0.9),
      losses: low.filter((x) => x < 0).length,
    },
    high: {
      mean: mean(high),
      p10: quant(high, 0.1),
      p50: quant(high, 0.5),
      p90: quant(high, 0.9),
      losses: high.filter((x) => x < 0).length,
    },
    histogramOverlap,
  };
  console.log("1000 paired investment seeds", JSON.stringify(summary));
  assert.ok(mean(high) > mean(low));
  assert.ok(mean(high) - mean(low) < 0.1);
  assert.ok(histogramOverlap > 0.75);
  assert.ok(high.some((x) => x < 0));
  assert.ok(low.some((x) => x > 0));
});

test("paused habits start when funds recover, focus affects future state, and baseline ignores player plans", () => {
  const c = config("habit-recovery");
  const s = initialState(c.card, c.lifeSeed);
  s.role = "unemployed";
  s.assets.cash = 0;
  s.assets.deposits = 0;
  s.habits.training = true;
  const pending = step(s, c, 1);
  assert.ok(pending.state.habitsPending.includes("training"));
  const funded = structuredClone(pending.state);
  funded.assets.cash = yuan(60000);
  const resumed = step(funded, c, 2);
  assert.ok(resumed.stories.some((e) => e.id === "habit-training"));
  const next = step(resumed.state, c, 3);
  assert.ok(!next.stories.some((e) => e.id === "habit-training"));
  const plan = { ...c, plans: { 0: { focus: "health", habits: defaultHabits() } } };
  const before = simulate(c);
  const after = simulate(plan);
  assert.deepEqual(before.baseline, after.baseline);
  assert.notDeepEqual(before.changed[0].state.props, after.changed[0].state.props);
});

test("PNG comparison redacts source profile and marks every decision; original scene changes with state", async () => {
  const { mapSvg } = await import("../dist/map.js");
  const { sceneSvg } = await import("../dist/scene.js");
  const c = config();
  c.card.name = "<script>PRIVATE-ALIAS</script>";
  c.card.project = "PRIVATE-PROJECT";
  c.card.attributes.health.source = "PRIVATE-SOURCE";
  const run = simulate(c);
  const svg = mapSvg(run, 12, "zh", true);
  for (const word of ["PRIVATE-ALIAS", "PRIVATE-PROJECT", "PRIVATE-SOURCE", "<script>"])
    assert.ok(!svg.includes(word));
  assert.ok(mapSvg(run, 12, "zh").includes("&lt;script&gt;"));
  assert.equal((svg.match(/r="6"/g) || []).length, 4);
  const s = run.initial;
  const home = sceneSvg(s, "zh");
  assert.notEqual(sceneSvg({ ...s, role: "founder" }, "zh"), home);
  assert.notEqual(sceneSvg({ ...s, housing: "shared" }, "zh"), home);
});
