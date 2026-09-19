"use strict";

const assert = require("assert");
const {
  buildStartingHandRanking169,
  comboCount,
  buildComboDistribution,
  RankProxyEquityOracle
} = require("./holdem169");
const {
  HeadsUpPushFoldCFRPlus
} = require("./hu-pushfold-cfr");

function approx(actual, expected, tolerance, message) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message}: actual=${actual}, expected=${expected}, tolerance=${tolerance}`
  );
}

(function test169HandSpace() {
  const ranking = buildStartingHandRanking169();
  assert.strictEqual(ranking.length, 169);
  assert.strictEqual(new Set(ranking).size, 169);
  assert.strictEqual(ranking[0], "AA");
  assert.strictEqual(ranking[ranking.length - 1], "72o");

  const combos = ranking.reduce((sum, hand) => sum + comboCount(hand), 0);
  assert.strictEqual(combos, 1326);

  const distribution = buildComboDistribution(ranking);
  approx(distribution.reduce((a, b) => a + b, 0), 1, 1e-12, "combo distribution");
})();

(function testEquityOracleSymmetry() {
  const ranking = buildStartingHandRanking169();
  const oracle = new RankProxyEquityOracle(ranking);

  for (let i = 0; i < ranking.length; i += 13) {
    for (let j = 0; j < ranking.length; j += 17) {
      const a = oracle.equity(ranking[i], ranking[j]);
      const b = oracle.equity(ranking[j], ranking[i]);
      approx(a + b, 1, 1e-12, `equity symmetry ${ranking[i]} vs ${ranking[j]}`);
    }
  }

  assert.ok(oracle.equity("AA", "72o") > 0.8);
  assert.ok(oracle.equity("72o", "AA") < 0.2);
  approx(oracle.equity("AKs", "AKs"), 0.5, 1e-12, "same class equity");
})();

(function testCfrConvergenceAt10BB() {
  const trainer = new HeadsUpPushFoldCFRPlus({ stackBB: 10 });
  const profile = trainer.train(2000);
  const metrics = trainer.metrics(profile);

  assert.ok(metrics.exploitability < 1e-4, `exploitability too high: ${metrics.exploitability}`);
  assert.ok(metrics.weightedShoveFrequency > 0.35 && metrics.weightedShoveFrequency < 0.55);
  assert.ok(metrics.weightedCallFrequency > 0.18 && metrics.weightedCallFrequency < 0.35);

  const bp = trainer.blueprint(profile);
  for (const hand of trainer.ranking.slice(0, 10)) {
    assert.ok(bp.sb[hand].shove > 0.95, `strong hand should shove: ${hand}`);
    assert.ok(bp.bb[hand].call > 0.95, `strong hand should call: ${hand}`);
  }
  for (const hand of trainer.ranking.slice(-10)) {
    assert.ok(bp.sb[hand].shove < 0.05, `weak hand should mostly fold SB: ${hand}`);
    assert.ok(bp.bb[hand].call < 0.05, `weak hand should mostly fold BB: ${hand}`);
  }
})();

(function testStackDepthChangesRanges() {
  const short = new HeadsUpPushFoldCFRPlus({ stackBB: 5 });
  const deep = new HeadsUpPushFoldCFRPlus({ stackBB: 15 });

  const shortMetrics = short.metrics(short.train(1200));
  const deepMetrics = deep.metrics(deep.train(1200));

  assert.ok(
    shortMetrics.weightedShoveFrequency > deepMetrics.weightedShoveFrequency + 0.15,
    `5BB should shove substantially wider than 15BB: ${shortMetrics.weightedShoveFrequency} vs ${deepMetrics.weightedShoveFrequency}`
  );
  assert.ok(
    shortMetrics.weightedCallFrequency > deepMetrics.weightedCallFrequency + 0.12,
    `5BB should call substantially wider than 15BB: ${shortMetrics.weightedCallFrequency} vs ${deepMetrics.weightedCallFrequency}`
  );
})();

console.log("HU preflop push/fold CFR+ tests passed.");
