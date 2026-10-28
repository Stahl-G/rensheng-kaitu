import assert from "node:assert/strict";
import { test } from "node:test";
import { blankCard, parseCard, sampleCard } from "../dist/card.js";
import { createEngine } from "../dist/engine.js";
import { mapSvg } from "../dist/map.js";
import { simulate } from "../dist/simulation.js";
const config = (seed = "A") => ({
  card: sampleCard(0, "zh"),
  worldSeed: seed,
  lifeSeed: `${seed}-life`,
  year: 2026,
  choice: "learn",
  world: "everyday",
});

test("role-card round trip preserves unknown and source; malformed inputs fail before simulation", () => {
  const card = blankCard();
  card.name = "<img src=x>";
  card.age = 36;
  card.attributes.knowledge = { value: 4, source: "AI estimate based on a synthetic project" };
  assert.deepEqual(parseCard(`Here is your card:\n\`\`\`json\n${JSON.stringify(card)}\n\`\`\``), card);
  assert.equal(parseCard(JSON.stringify(card)).attributes.energy.value, null);
  for (const bad of [
    { ...card, age: -1 },
    { ...card, age: 1.1 },
    { ...card, attributes: [] },
    { ...card, attributes: { joy: { value: 6 } } },
    { ...card, role: "has-own-company-maybe" },
  ])
    assert.throws(() => parseCard(JSON.stringify(bad)));
  assert.throws(() => parseCard("x".repeat(16001)));
  assert.throws(() => simulate({ ...config(), card: blankCard() }));
  const run = simulate({ ...config(), card });
  assert.equal(run.baseline[0].age, 37);
  assert.equal(card.attributes.energy.value, null);
});

test("replay, branch isolation and year-addressed shocks survive choice changes and interleaved instances", () => {
  for (let i = 0; i < 160; i++) {
    const input = config(String(i));
    const before = structuredClone(input);
    const a = simulate(input);
    simulate({ ...config("unrelated"), choice: "rest" });
    assert.deepEqual(simulate(input), a);
    assert.deepEqual(input, before);
    const loosened = simulate({ ...input, secondHalf: false });
    assert.deepEqual(a.changed.slice(0, 5), loosened.changed.slice(0, 5));
    assert.deepEqual(a.baseline, loosened.baseline);
    for (const choice of ["learn", "connect", "rest"]) {
      const other = simulate({ ...input, choice });
      assert.deepEqual(
        other.baseline.map((r) => [r.year, r.worldId]),
        a.changed.map((r) => [r.year, r.worldId]),
      );
    }
    const old = a.changed[0].state.props.energy;
    a.baseline[0].state.props.energy = 999;
    assert.equal(a.changed[0].state.props.energy, old);
  }
});

test("event prerequisites, work transitions, chain guards and repeated progress are enforced", () => {
  let foundTransition = false;
  let foundFullChain = false;
  for (let i = 0; i < 160; i++) {
    const run = simulate(config(String(i)));
    if (run.changed.at(-1).state.props.STAGE >= 5) foundFullChain = true;
    for (const path of [run.baseline, run.changed]) {
      let employed = true;
      for (const row of path) {
        if (row.eventIds.includes("work-pause")) {
          assert.equal(employed, true);
          employed = false;
          foundTransition = true;
        }
        if (row.eventIds.includes("work-return")) {
          assert.equal(employed, false);
          employed = true;
        }
        assert.equal(row.state.flags.includes("employed"), employed);
        assert.equal(row.state.flags.includes("between-work"), !employed);
      }
    }
    const founder = simulate({ ...config(String(i)), card: { ...run.config.card, role: "founder" } });
    assert.ok(
      [...founder.baseline, ...founder.changed].every(
        (row) => !row.eventIds.some((id) => id.startsWith("work-")),
      ),
    );
  }
  assert.ok(foundTransition);
  assert.ok(foundFullChain);
  const engine = createEngine([
    { id: "start", text: ["", ""], branch: [{ condition: "AGE>=0", event: "end" }] },
    {
      id: "end",
      NoRandom: true,
      text: ["", ""],
      requires: ["employed"],
      clears: ["employed"],
      sets: ["founder"],
    },
  ]);
  assert.deepEqual(engine.next(engine.start(28, {}, ["employed"]), 0).state.flags, ["founder"]);
  assert.deepEqual(engine.next(engine.start(28, {}, ["student"]), 0).state.flags, ["student"]);
  const cycle = createEngine([
    { id: "loop", text: ["", ""], branch: [{ condition: "AGE>=0", event: "loop" }] },
  ]);
  assert.throws(() => cycle.next(cycle.start(28, {}), 0), /chain/);
  assert.throws(() =>
    createEngine([{ id: "x", text: ["", ""], branch: [{ condition: "AGE=1", event: "missing" }] }]),
  );
  assert.throws(() => createEngine([]).next(engine.start(28, {}), 0), /No event/);
});

test("exported map omits profile content and escapes unsafe labels", () => {
  const input = config();
  input.card.name = "<script>alert(1)</script>";
  input.card.project = "PRIVATE-PROJECT";
  const run = simulate(input);
  const shared = mapSvg(run, 10, "zh", true);
  assert.ok(!shared.includes("PRIVATE-PROJECT"));
  assert.ok(!shared.includes("alert(1)"));
  const local = mapSvg(run, 10, "zh");
  assert.ok(local.includes("&lt;script&gt;"));
  assert.ok(!local.includes("<script>"));
});
