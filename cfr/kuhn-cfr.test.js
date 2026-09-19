"use strict";

const assert = require("assert");
const {
  KuhnCFRPlusTrainer,
  computeMetrics
} = require("./kuhn-cfr");

function approx(actual, expected, tolerance, message) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message}: actual=${actual}, expected=${expected}, tolerance=${tolerance}`
  );
}

(function testCfrPlusConvergence() {
  const trainer = new KuhnCFRPlusTrainer();
  const profile = trainer.train(20000);
  const metrics = computeMetrics(profile);

  approx(metrics.value, -1 / 18, 0.0015, "Kuhn game value should converge to -1/18");
  assert.ok(metrics.exploitability < 0.001, `exploitability too high: ${metrics.exploitability}`);
  assert.ok(metrics.bestResponse0 >= metrics.value - 1e-12, "P0 best response cannot be worse than profile value");
  assert.ok(metrics.bestResponse1 <= metrics.value + 1e-12, "P1 best response cannot improve P0 value");

  for (const [key, entry] of Object.entries(profile)) {
    const sum = entry.strategy.reduce((a, b) => a + b, 0);
    approx(sum, 1, 1e-10, `strategy probabilities must sum to 1 at ${key}`);
    for (const p of entry.strategy) {
      assert.ok(p >= -1e-12 && p <= 1 + 1e-12, `invalid strategy probability ${p} at ${key}`);
    }
  }
})();

(function testIncrementalTraining() {
  const trainer = new KuhnCFRPlusTrainer();
  trainer.train(5000);
  const first = computeMetrics(trainer.getAverageProfile());
  trainer.train(5000);
  const second = computeMetrics(trainer.getAverageProfile());

  assert.strictEqual(trainer.iterations, 10000);
  assert.ok(second.exploitability < first.exploitability, "additional CFR+ training should reduce exploitability in this deterministic test");
})();

console.log("Kuhn CFR+ tests passed.");
