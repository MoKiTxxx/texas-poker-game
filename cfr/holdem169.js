"use strict";

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
  RankProxyEquityOracle
};
