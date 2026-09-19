"use strict";

const fs = require("fs");
const path = require("path");
const {
  buildStartingHandRanking169,
  buildComboDistribution,
  PrecomputedEquityOracle
} = require("./holdem169");

function regretMatchedStrategy(regretA, regretB) {
  const a = Math.max(0, regretA);
  const b = Math.max(0, regretB);
  const total = a + b;
  if (total <= 1e-15) return [0.5, 0.5];
  return [a / total, b / total];
}

class HeadsUpPushFoldCFRPlus {
  constructor(options = {}) {
    this.stackBB = options.stackBB ?? 10;
    this.smallBlind = options.smallBlind ?? 0.5;
    this.bigBlind = options.bigBlind ?? 1;
    this.ranking = (options.ranking || buildStartingHandRanking169()).slice();
    this.typeProb = Float64Array.from(options.typeProb || buildComboDistribution(this.ranking));

    const oracle = options.equityOracle || new PrecomputedEquityOracle();
    this.equityMatrix = options.equityMatrix || oracle.matrix();

    this.n = this.ranking.length;
    if (this.n !== 169) throw new Error(`Expected 169 hand classes, got ${this.n}`);
    if (this.equityMatrix.length !== this.n * this.n) {
      throw new Error("equity matrix has wrong shape");
    }

    this.regretSB = new Float64Array(this.n * 2); // fold, shove
    this.regretBB = new Float64Array(this.n * 2); // fold, call
    this.strategySumSB = new Float64Array(this.n * 2);
    this.strategySumBB = new Float64Array(this.n * 2);
    this.strategySB = new Float64Array(this.n * 2);
    this.strategyBB = new Float64Array(this.n * 2);
    this.iterations = 0;

    this.showdownValue = new Float64Array(this.n * this.n);
    for (let i = 0; i < this.n; i++) {
      for (let j = 0; j < this.n; j++) {
        const equity = this.equityMatrix[i * this.n + j];
        this.showdownValue[i * this.n + j] = this.stackBB * (2 * equity - 1);
      }
    }

    this._refreshStrategies();
  }

  _refreshOne(regrets, strategy) {
    for (let i = 0; i < this.n; i++) {
      const [a, b] = regretMatchedStrategy(regrets[2 * i], regrets[2 * i + 1]);
      strategy[2 * i] = a;
      strategy[2 * i + 1] = b;
    }
  }

  _refreshStrategies() {
    this._refreshOne(this.regretSB, this.strategySB);
    this._refreshOne(this.regretBB, this.strategyBB);
  }

  _updateSmallBlind() {
    const callWeight = new Float64Array(this.n);
    for (let j = 0; j < this.n; j++) {
      callWeight[j] = this.typeProb[j] * this.strategyBB[2 * j + 1];
    }

    for (let i = 0; i < this.n; i++) {
      let shoveValue = this.bigBlind;

      const row = i * this.n;
      for (let j = 0; j < this.n; j++) {
        const calledValue = this.showdownValue[row + j];
        shoveValue += callWeight[j] * (calledValue - this.bigBlind);
      }

      const foldValue = -this.smallBlind;
      const foldProb = this.strategySB[2 * i];
      const shoveProb = this.strategySB[2 * i + 1];
      const nodeValue = foldProb * foldValue + shoveProb * shoveValue;

      this.regretSB[2 * i] = Math.max(0, this.regretSB[2 * i] + foldValue - nodeValue);
      this.regretSB[2 * i + 1] = Math.max(0, this.regretSB[2 * i + 1] + shoveValue - nodeValue);
    }
  }

  _updateBigBlind() {
    const shoveWeight = new Float64Array(this.n);
    let shoveMass = 0;

    for (let i = 0; i < this.n; i++) {
      const weight = this.typeProb[i] * this.strategySB[2 * i + 1];
      shoveWeight[i] = weight;
      shoveMass += weight;
    }

    for (let j = 0; j < this.n; j++) {
      // Values are for the BB player. If BB folds to a shove, SB wins +1 BB.
      const foldValue = -shoveMass;
      let callValue = 0;

      for (let i = 0; i < this.n; i++) {
        callValue += shoveWeight[i] * (-this.showdownValue[i * this.n + j]);
      }

      const foldProb = this.strategyBB[2 * j];
      const callProb = this.strategyBB[2 * j + 1];
      const nodeValue = foldProb * foldValue + callProb * callValue;

      this.regretBB[2 * j] = Math.max(0, this.regretBB[2 * j] + foldValue - nodeValue);
      this.regretBB[2 * j + 1] = Math.max(0, this.regretBB[2 * j + 1] + callValue - nodeValue);
    }
  }

  _accumulateAverage(weight) {
    for (let k = 0; k < this.n * 2; k++) {
      this.strategySumSB[k] += weight * this.strategySB[k];
      this.strategySumBB[k] += weight * this.strategyBB[k];
    }
  }

  train(iterations) {
    if (!Number.isInteger(iterations) || iterations <= 0) {
      throw new Error("iterations must be a positive integer");
    }

    for (let local = 1; local <= iterations; local++) {
      // Alternating CFR+.
      this._refreshStrategies();
      this._updateSmallBlind();

      this._refreshOne(this.regretSB, this.strategySB);
      this._updateBigBlind();

      this._refreshStrategies();
      const globalIteration = this.iterations + local;
      this._accumulateAverage(globalIteration);
    }

    this.iterations += iterations;
    return this.averageProfile();
  }

  _averageFrom(sum, fallback) {
    const out = new Float64Array(this.n * 2);
    for (let i = 0; i < this.n; i++) {
      const a = sum[2 * i];
      const b = sum[2 * i + 1];
      const total = a + b;
      if (total > 1e-15) {
        out[2 * i] = a / total;
        out[2 * i + 1] = b / total;
      } else {
        out[2 * i] = fallback[2 * i];
        out[2 * i + 1] = fallback[2 * i + 1];
      }
    }
    return out;
  }

  averageProfile() {
    return {
      sb: this._averageFrom(this.strategySumSB, this.strategySB),
      bb: this._averageFrom(this.strategySumBB, this.strategyBB)
    };
  }

  _profileValue(profile) {
    let value = 0;

    for (let i = 0; i < this.n; i++) {
      let shoveValue = this.bigBlind;
      for (let j = 0; j < this.n; j++) {
        const callProb = profile.bb[2 * j + 1];
        shoveValue += this.typeProb[j] * callProb *
          (this.showdownValue[i * this.n + j] - this.bigBlind);
      }

      const shoveProb = profile.sb[2 * i + 1];
      const handValue = (1 - shoveProb) * (-this.smallBlind) + shoveProb * shoveValue;
      value += this.typeProb[i] * handValue;
    }

    return value;
  }

  _bestResponseSmallBlind(profile) {
    let value = 0;

    for (let i = 0; i < this.n; i++) {
      let shoveValue = this.bigBlind;
      for (let j = 0; j < this.n; j++) {
        const callProb = profile.bb[2 * j + 1];
        shoveValue += this.typeProb[j] * callProb *
          (this.showdownValue[i * this.n + j] - this.bigBlind);
      }
      value += this.typeProb[i] * Math.max(-this.smallBlind, shoveValue);
    }

    return value;
  }

  _bestResponseBigBlind(profile) {
    let foldContribution = 0;
    let shoveMass = 0;
    const shoveWeight = new Float64Array(this.n);

    for (let i = 0; i < this.n; i++) {
      const shoveProb = profile.sb[2 * i + 1];
      foldContribution += this.typeProb[i] * (1 - shoveProb) * (-this.smallBlind);
      shoveWeight[i] = this.typeProb[i] * shoveProb;
      shoveMass += shoveWeight[i];
    }

    let responseContribution = 0;

    for (let j = 0; j < this.n; j++) {
      const p0IfBbFolds = shoveMass;
      let p0IfBbCalls = 0;

      for (let i = 0; i < this.n; i++) {
        p0IfBbCalls += shoveWeight[i] * this.showdownValue[i * this.n + j];
      }

      responseContribution += this.typeProb[j] * Math.min(p0IfBbFolds, p0IfBbCalls);
    }

    return foldContribution + responseContribution;
  }

  metrics(profile = this.averageProfile()) {
    const value = this._profileValue(profile);
    const bestResponseSB = this._bestResponseSmallBlind(profile);
    const bestResponseBB = this._bestResponseBigBlind(profile);
    const nashConv = bestResponseSB - bestResponseBB;

    return {
      value,
      bestResponseSB,
      bestResponseBB,
      nashConv,
      exploitability: nashConv / 2,
      weightedShoveFrequency: this.weightedFrequency(profile.sb, 1),
      weightedCallFrequency: this.weightedFrequency(profile.bb, 1)
    };
  }

  weightedFrequency(strategy, actionIndex) {
    let total = 0;
    for (let i = 0; i < this.n; i++) {
      total += this.typeProb[i] * strategy[2 * i + actionIndex];
    }
    return total;
  }

  blueprint(profile = this.averageProfile()) {
    const sb = {};
    const bb = {};

    for (let i = 0; i < this.n; i++) {
      const hand = this.ranking[i];
      sb[hand] = {
        fold: profile.sb[2 * i],
        shove: profile.sb[2 * i + 1]
      };
      bb[hand] = {
        fold: profile.bb[2 * i],
        call: profile.bb[2 * i + 1]
      };
    }

    return {
      version: "hu-pushfold-cfr-v1",
      abstraction: {
        players: 2,
        effectiveStackBB: this.stackBB,
        smallBlindBB: this.smallBlind,
        bigBlindBB: this.bigBlind,
        handClasses: this.n,
        chanceModel: "independent-combo-weighted-169-class",
        equityOracle: "poker-yoga-preflop-equity-1m-seed1"
      },
      iterations: this.iterations,
      metrics: this.metrics(profile),
      sb,
      bb
    };
  }

  writeBlueprint(filePath, profile = this.averageProfile()) {
    const payload = this.blueprint(profile);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + "\n", "utf8");
    return payload;
  }
}

module.exports = {
  HeadsUpPushFoldCFRPlus,
  regretMatchedStrategy
};

if (require.main === module) {
  const iterations = Number(process.argv[2] || 5000);
  const stackBB = Number(process.argv[3] || 10);
  const outputPath = process.argv[4] || "";

  const trainer = new HeadsUpPushFoldCFRPlus({ stackBB });
  const profile = trainer.train(iterations);
  const metrics = trainer.metrics(profile);

  console.log(`HU push/fold CFR+ | stack=${stackBB}BB | iterations=${iterations}`);
  console.log(`value (SB bb/hand): ${metrics.value.toFixed(8)}`);
  console.log(`BR SB:              ${metrics.bestResponseSB.toFixed(8)}`);
  console.log(`BR BB (P0 value):   ${metrics.bestResponseBB.toFixed(8)}`);
  console.log(`NashConv:           ${metrics.nashConv.toExponential(4)}`);
  console.log(`exploitability:     ${metrics.exploitability.toExponential(4)}`);
  console.log(`shove frequency:    ${(100 * metrics.weightedShoveFrequency).toFixed(2)}%`);
  console.log(`call frequency:     ${(100 * metrics.weightedCallFrequency).toFixed(2)}%`);

  const bp = trainer.blueprint(profile);
  const strongest = trainer.ranking.slice(0, 12);
  const weakest = trainer.ranking.slice(-12);

  console.log("\nStrong hands:");
  for (const hand of strongest) {
    console.log(`${hand.padEnd(4)} shove=${bp.sb[hand].shove.toFixed(3)} call=${bp.bb[hand].call.toFixed(3)}`);
  }

  console.log("\nWeak hands:");
  for (const hand of weakest) {
    console.log(`${hand.padEnd(4)} shove=${bp.sb[hand].shove.toFixed(3)} call=${bp.bb[hand].call.toFixed(3)}`);
  }

  if (outputPath) {
    trainer.writeBlueprint(outputPath, profile);
    console.log(`\nBlueprint written to ${outputPath}`);
  }
}
