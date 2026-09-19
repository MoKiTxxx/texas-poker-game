"use strict";

const fs = require("fs");
const path = require("path");

const RANK_SYMBOLS = ["A","K","Q","J","T","9","8","7","6","5","4","3","2"];

const EXPLICIT_STARTING_HAND_RANKING = [
  "AA","KK","QQ","AKs","JJ","AQs","KQs","AKo","TT","AJs",
  "KJs","QJs","JTs","99","AQo","ATs","KTs","QTs","T9s","88",
  "AJo","KQo","A9s","J9s","98s","77","A8s","K9s","T8s","87s",
  "A7s","KJo","QJo","A5s","A6s","Q9s","J8s","76s","66","ATo",
  "A4s","K8s","T7s","97s","65s","55","A3s","K7s","Q8s","86s",
  "54s","A2s","KTo","QTo","JTo","44","K6s","J7s","75s","64s",
  "T9o","33","K5s","Q7s","T6s","53s","98o","22","K4s","J9o",
  "Q9o","87o","K3s","Q6s","J6s","43s","K2s","T8o","76o","Q5s"
];

function rankValue(symbol) {
  if (symbol === "A") return 14;
  if (symbol === "K") return 13;
  if (symbol === "Q") return 12;
  if (symbol === "J") return 11;
  if (symbol === "T") return 10;
  return Number(symbol);
}

function buildAllStartingHandNotations() {
  const list = [];
  for (let i = 0; i < RANK_SYMBOLS.length; i++) {
    const high = RANK_SYMBOLS[i];
    list.push(high + high);
    for (let j = i + 1; j < RANK_SYMBOLS.length; j++) {
      const low = RANK_SYMBOLS[j];
      list.push(high + low + "s");
      list.push(high + low + "o");
    }
  }
  return list;
}

function scoreStartingHandNotation(notation) {
  const explicitIndex = EXPLICIT_STARTING_HAND_RANKING.indexOf(notation);
  if (explicitIndex !== -1) return 10000 - explicitIndex * 20;

  const r1 = rankValue(notation[0]);
  const r2 = rankValue(notation[1]);
  const suited = notation.endsWith("s");
  const pair = notation.length === 2;
  const high = Math.max(r1, r2);
  const low = Math.min(r1, r2);
  const gap = high - low;

  if (pair) return 7400 + high * 12;

  let score = high * 18 + low * 8;

  if (suited) score += 35;
  if (gap === 1) score += 26;
  else if (gap === 2) score += 14;
  else if (gap === 3) score += 4;
  else if (gap >= 5) score -= 30;

  if (high === 14) score += 45;
  if (high >= 13 && low >= 10) score += 25;
  if (low <= 5 && high < 14) score -= 18;
  if (!suited && gap >= 4 && low <= 8) score -= 36;

  return score;
}

function buildStartingHandRanking169() {
  return buildAllStartingHandNotations().sort((a, b) => {
    const diff = scoreStartingHandNotation(b) - scoreStartingHandNotation(a);
    if (diff !== 0) return diff;
    return a.localeCompare(b);
  });
}

function comboCount(notation) {
  if (notation.length === 2) return 6;
  if (notation.endsWith("s")) return 4;
  return 12;
}

function buildComboDistribution(ranking = buildStartingHandRanking169()) {
  const counts = ranking.map(comboCount);
  const total = counts.reduce((sum, x) => sum + x, 0);
  return counts.map(x => x / total);
}

function buildConcreteCombos(notation) {
  const suits = [0, 1, 2, 3];
  const rankA = rankValue(notation[0]);
  const rankB = rankValue(notation[1]);
  const combos = [];

  function cardId(rank, suit) {
    return (rank - 2) * 4 + suit;
  }

  if (notation.length === 2) {
    for (let s1 = 0; s1 < suits.length; s1++) {
      for (let s2 = s1 + 1; s2 < suits.length; s2++) {
        combos.push([cardId(rankA, s1), cardId(rankA, s2)]);
      }
    }
    return combos;
  }

  if (notation.endsWith("s")) {
    for (const suit of suits) {
      combos.push([cardId(rankA, suit), cardId(rankB, suit)]);
    }
    return combos;
  }

  for (const s1 of suits) {
    for (const s2 of suits) {
      if (s1 === s2) continue;
      combos.push([cardId(rankA, s1), cardId(rankB, s2)]);
    }
  }

  return combos;
}

function concreteCombosCompatible(a, b) {
  return a[0] !== b[0] && a[0] !== b[1] &&
    a[1] !== b[0] && a[1] !== b[1];
}

function buildJointClassDistribution(ranking = buildStartingHandRanking169()) {
  const n = ranking.length;
  const combos = ranking.map(buildConcreteCombos);
  const compatibleCounts = new Uint16Array(n * n);
  let totalOrderedDeals = 0;

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let count = 0;
      for (const a of combos[i]) {
        for (const b of combos[j]) {
          if (concreteCombosCompatible(a, b)) count++;
        }
      }
      compatibleCounts[i * n + j] = count;
      totalOrderedDeals += count;
    }
  }

  const expectedDeals = 1326 * 1225;
  if (totalOrderedDeals !== expectedDeals) {
    throw new Error(`compatible combo count mismatch: ${totalOrderedDeals} !== ${expectedDeals}`);
  }

  const joint = new Float64Array(n * n);
  const marginalSB = new Float64Array(n);
  const marginalBB = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const p = compatibleCounts[i * n + j] / totalOrderedDeals;
      joint[i * n + j] = p;
      marginalSB[i] += p;
      marginalBB[j] += p;
    }
  }

  const bbGivenSB = new Float64Array(n * n);
  const sbGivenBB = new Float64Array(n * n);

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const p = joint[i * n + j];
      bbGivenSB[i * n + j] = p / marginalSB[i];
      // Stored with row=BB class j, column=SB class i.
      sbGivenBB[j * n + i] = p / marginalBB[j];
    }
  }

  return {
    compatibleCounts,
    totalOrderedDeals,
    joint,
    marginalSB,
    marginalBB,
    bbGivenSB,
    sbGivenBB
  };
}

class PrecomputedEquityOracle {
  constructor(options = {}) {
    const dataPath = options.dataPath ||
      path.join(__dirname, "data", "preflop-equity-169.json");
    const payload = options.payload || JSON.parse(fs.readFileSync(dataPath, "utf8"));

    if (!Array.isArray(payload.classes) || payload.classes.length !== 169) {
      throw new Error("preflop equity dataset must contain 169 classes");
    }

    const expectedUpper = 169 * 170 / 2;
    if (!Array.isArray(payload.upper) || payload.upper.length !== expectedUpper) {
      throw new Error("preflop equity upper triangle has wrong length");
    }

    this.meta = payload._meta || {};
    this.classes = payload.classes.slice();
    this.upper = Float64Array.from(payload.upper);
    this.index = new Map(this.classes.map((hand, i) => [hand, i]));

    if (this.meta.unit && this.meta.unit !== "fraction, win + tie/2") {
      throw new Error("unsupported preflop equity unit: " + this.meta.unit);
    }
  }

  _upperOffset(i, j) {
    // Row i stores j=i..168. Number of entries before row i:
    // i*n - i*(i-1)/2, with n=169.
    return i * 169 - (i * (i - 1)) / 2 + (j - i);
  }

  equity(handA, handB) {
    const i = this.index.get(handA);
    const j = this.index.get(handB);

    if (i === undefined || j === undefined) {
      throw new Error(`Unknown hand class: ${handA} vs ${handB}`);
    }

    if (i <= j) {
      return this.upper[this._upperOffset(i, j)];
    }

    return 1 - this.upper[this._upperOffset(j, i)];
  }

  matrix(ranking = buildStartingHandRanking169()) {
    const n = ranking.length;
    const out = new Float64Array(n * n);

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        out[i * n + j] = this.equity(ranking[i], ranking[j]);
      }
    }

    return out;
  }
}

class RankProxyEquityOracle {
  constructor(ranking = buildStartingHandRanking169(), options = {}) {
    this.ranking = ranking.slice();
    this.maxSwing = options.maxSwing ?? 0.38;
    this.temperature = options.temperature ?? 2.2;
    this.strength = new Map();

    const denom = Math.max(1, ranking.length - 1);
    ranking.forEach((hand, index) => {
      this.strength.set(hand, 1 - index / denom);
    });
  }

  equity(handA, handB) {
    const a = this.strength.get(handA);
    const b = this.strength.get(handB);
    if (a === undefined || b === undefined) {
      throw new Error(`Unknown hand class: ${handA} vs ${handB}`);
    }

    const delta = a - b;
    return 0.5 + this.maxSwing * Math.tanh(this.temperature * delta);
  }

  matrix() {
    const n = this.ranking.length;
    const out = new Float64Array(n * n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        out[i * n + j] = this.equity(this.ranking[i], this.ranking[j]);
      }
    }
    return out;
  }
}

module.exports = {
  RANK_SYMBOLS,
  EXPLICIT_STARTING_HAND_RANKING,
  rankValue,
  buildAllStartingHandNotations,
  scoreStartingHandNotation,
  buildStartingHandRanking169,
  comboCount,
  buildComboDistribution,
  buildConcreteCombos,
  concreteCombosCompatible,
  buildJointClassDistribution,
  PrecomputedEquityOracle,
  RankProxyEquityOracle
};
