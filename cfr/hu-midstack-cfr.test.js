"use strict";

const assert = require("assert");
const {
  PUBLIC_TREE,
  EquityRealizationContinuationOracle,
  HeadsUpMidstackCFRPlus
} = require("./hu-midstack-cfr");

function approx(actual, expected, tolerance, message) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message}: actual=${actual}, expected=${expected}, tolerance=${tolerance}`
  );
}

(function testTreeShape() {
  assert.deepStrictEqual(
    PUBLIC_TREE.ROOT.actions.map(x => x.name),
    ["fold", "limp", "minraise", "shove"]
  );

  assert.deepStrictEqual(
    PUBLIC_TREE.BB_LIMP.actions.map(x => x.name),
    ["check", "raise3", "shove"]
  );

  assert.deepStrictEqual(
    PUBLIC_TREE.BB_MINRAISE.actions.map(x => x.name),
    ["fold", "call", "threebet6", "shove"]
  );

  assert.deepStrictEqual(
    PUBLIC_TREE.SB_VS_3BET6.actions.map(x => x.name),
    ["fold", "call", "reshove"]
  );
})();

(function testContinuationOracle() {
  const oracle = new EquityRealizationContinuationOracle();

  const evenLimp = oracle.value({
    equity: 0.5,
    investSB: 1,
    investBB: 1,
    stackBB: 15
  });

  const strongLimp = oracle.value({
    equity: 0.8,
    investSB: 1,
    investBB: 1,
    stackBB: 15
  });

  const weakLimp = oracle.value({
    equity: 0.2,
    investSB: 1,
    investBB: 1,
    stackBB: 15
  });

  assert.ok(evenLimp > 0, "SB/button should receive a small IP realization bonus");
  assert.ok(strongLimp > evenLimp);
  assert.ok(weakLimp < evenLimp);
  assert.strictEqual(oracle.metadata().exactPostflopSolver, false);
})();

(function testTerminalUtilities() {
  const trainer = new HeadsUpMidstackCFRPlus({
    stackBB: 15,
    seed: 7
  });

  const aa = trainer.ranking.indexOf("AA");
  const sevenTwo = trainer.ranking.indexOf("72o");

  approx(
    trainer.terminalValue({ kind: "fixed", value: -2 }, aa, sevenTwo),
    -2,
    1e-12,
    "fixed fold payoff"
  );

  assert.ok(
    trainer.terminalValue({ kind: "allin" }, aa, sevenTwo) > 10,
    "AA should have a strongly positive all-in value vs 72o"
  );
})();

(function testCfrConvergence() {
  const trainer = new HeadsUpMidstackCFRPlus({
    stackBB: 15,
    seed: 12345
  });

  const profile = trainer.train(1000000);
  const metrics = trainer.metrics(profile);
  const root = metrics.rootActionFrequencies;

  console.log("15BB midstack metrics:", metrics);

  assert.ok(
    metrics.exploitability < 0.015,
    `exploitability too high: ${metrics.exploitability}`
  );

  approx(
    Object.values(root).reduce((a, b) => a + b, 0),
    1,
    1e-9,
    "root frequencies"
  );

  assert.ok(root.limp > 0.02, "midstack tree should learn some limping");
  assert.ok(root.minraise > 0.02, "midstack tree should learn some min-raising");
  assert.ok(root.shove < 0.65, "15BB should not collapse to pure push/fold");
})();

(function testStackDepthTrend() {
  const s12 = new HeadsUpMidstackCFRPlus({
    stackBB: 12,
    seed: 9912
  });
  const s20 = new HeadsUpMidstackCFRPlus({
    stackBB: 20,
    seed: 9920
  });

  const m12 = s12.metrics(s12.train(500000));
  const m20 = s20.metrics(s20.train(500000));

  console.log("12BB midstack metrics:", m12);
  console.log("20BB midstack metrics:", m20);

  assert.ok(m12.exploitability < 0.025);
  assert.ok(m20.exploitability < 0.025);

  assert.ok(
    m12.rootActionFrequencies.shove >
      m20.rootActionFrequencies.shove,
    "12BB should use direct shove more often than 20BB"
  );
})();

console.log("HU 12–20BB midstack CFR+ tests passed.");
