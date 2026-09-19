"use strict";

const CARDS = [0, 1, 2]; // J, Q, K
const CARD_NAMES = ["J", "Q", "K"];
const DEALS = [];
for (const c0 of CARDS) {
  for (const c1 of CARDS) {
    if (c0 !== c1) DEALS.push([c0, c1]);
  }
}

function currentPlayer(history) {
  if (history === "" || history === "cb") return 0;
  if (history === "c" || history === "b") return 1;
  return null;
}

function isTerminal(history) {
  return history === "cc" || history === "bf" || history === "bc" ||
    history === "cbf" || history === "cbc";
}

function legalActions(history) {
  if (history === "" || history === "c") return ["c", "b"];
  if (history === "b" || history === "cb") return ["f", "c"];
  throw new Error(`No legal actions for history: ${history}`);
}

function payoffForPlayer0(cards, history) {
  const player0Wins = cards[0] > cards[1];
  if (history === "cc") return player0Wins ? 1 : -1;
  if (history === "bf") return 1;
  if (history === "bc") return player0Wins ? 2 : -2;
  if (history === "cbf") return -1;
  if (history === "cbc") return player0Wins ? 2 : -2;
  throw new Error(`Non-terminal history: ${history}`);
}

class InfoSetNode {
  constructor(actions) {
    this.actions = actions.slice();
    this.regrets = Array(actions.length).fill(0);
    this.strategySum = Array(actions.length).fill(0);
  }

  currentStrategy() {
    const positive = this.regrets.map(r => Math.max(0, r));
    const total = positive.reduce((sum, x) => sum + x, 0);
    if (total > 1e-15) return positive.map(x => x / total);
    return positive.map(() => 1 / positive.length);
  }

  averageStrategy() {
    const total = this.strategySum.reduce((sum, x) => sum + x, 0);
    if (total > 1e-15) return this.strategySum.map(x => x / total);
    return this.currentStrategy();
  }
}

class KuhnCFRPlusTrainer {
  constructor() {
    this.nodes = new Map();
    this.iterations = 0;
  }

  infoSetKey(card, history) {
    return `${card}|${history}`;
  }

  getNode(key, actions) {
    let node = this.nodes.get(key);
    if (!node) {
      node = new InfoSetNode(actions);
      this.nodes.set(key, node);
    }
    return node;
  }

  cfr(cards, history, reach0, reach1, updatePlayer) {
    if (isTerminal(history)) return payoffForPlayer0(cards, history);

    const player = currentPlayer(history);
    const actions = legalActions(history);
    const key = this.infoSetKey(cards[player], history);
    const node = this.getNode(key, actions);
    const strategy = node.currentStrategy();

    const actionValues = Array(actions.length).fill(0);
    let nodeValue = 0;

    for (let a = 0; a < actions.length; a++) {
      const nextHistory = history + actions[a];
      const nextReach0 = player === 0 ? reach0 * strategy[a] : reach0;
      const nextReach1 = player === 1 ? reach1 * strategy[a] : reach1;
      actionValues[a] = this.cfr(cards, nextHistory, nextReach0, nextReach1, updatePlayer);
      nodeValue += strategy[a] * actionValues[a];
    }

    if (player === updatePlayer) {
      const opponentReach = player === 0 ? reach1 : reach0;
      const playerSign = player === 0 ? 1 : -1;

      for (let a = 0; a < actions.length; a++) {
        const instantaneousRegret = opponentReach * playerSign * (actionValues[a] - nodeValue);
        // CFR+: cumulative regret is clipped at zero after each update.
        node.regrets[a] = Math.max(0, node.regrets[a] + instantaneousRegret);
      }
    }

    return nodeValue;
  }

  accumulateAverageStrategy(cards, history, reach0, reach1, iterationWeight, chanceReach) {
    if (isTerminal(history)) return;

    const player = currentPlayer(history);
    const actions = legalActions(history);
    const key = this.infoSetKey(cards[player], history);
    const node = this.getNode(key, actions);
    const strategy = node.currentStrategy();
    const ownReach = player === 0 ? reach0 : reach1;

    for (let a = 0; a < actions.length; a++) {
      node.strategySum[a] += iterationWeight * chanceReach * ownReach * strategy[a];
    }

    for (let a = 0; a < actions.length; a++) {
      this.accumulateAverageStrategy(
        cards,
        history + actions[a],
        player === 0 ? reach0 * strategy[a] : reach0,
        player === 1 ? reach1 * strategy[a] : reach1,
        iterationWeight,
        chanceReach
      );
    }
  }

  train(iterations) {
    if (!Number.isInteger(iterations) || iterations <= 0) {
      throw new Error("iterations must be a positive integer");
    }

    for (let localIteration = 1; localIteration <= iterations; localIteration++) {
      // Alternating CFR+ updates.
      for (const updatePlayer of [0, 1]) {
        for (const cards of DEALS) {
          this.cfr(cards, "", 1, 1, updatePlayer);
        }
      }

      // Linear averaging emphasizes later strategies.
      const globalIteration = this.iterations + localIteration;
      const chanceReach = 1 / DEALS.length;
      for (const cards of DEALS) {
        this.accumulateAverageStrategy(cards, "", 1, 1, globalIteration, chanceReach);
      }
    }

    this.iterations += iterations;
    return this.getAverageProfile();
  }

  getAverageProfile() {
    const profile = {};
    for (const [key, node] of this.nodes.entries()) {
      profile[key] = {
        actions: node.actions.slice(),
        strategy: node.averageStrategy().slice()
      };
    }
    return profile;
  }
}

function strategyFor(profile, key, actions) {
  const entry = profile[key];
  if (!entry) return actions.map(() => 1 / actions.length);
  return entry.strategy;
}

function evaluateProfile(profile, overridePlayer = null, deterministicPolicy = null) {
  function recurse(cards, history) {
    if (isTerminal(history)) return payoffForPlayer0(cards, history);

    const player = currentPlayer(history);
    const actions = legalActions(history);
    const key = `${cards[player]}|${history}`;

    if (player === overridePlayer) {
      const actionIndex = deterministicPolicy[key] ?? 0;
      return recurse(cards, history + actions[actionIndex]);
    }

    const strategy = strategyFor(profile, key, actions);
    let value = 0;
    for (let a = 0; a < actions.length; a++) {
      value += strategy[a] * recurse(cards, history + actions[a]);
    }
    return value;
  }

  return DEALS.reduce((sum, cards) => sum + recurse(cards, ""), 0) / DEALS.length;
}

function bestResponseInfoSets(player) {
  const keys = [];
  if (player === 0) {
    for (const card of CARDS) {
      keys.push(`${card}|`);
      keys.push(`${card}|cb`);
    }
  } else {
    for (const card of CARDS) {
      keys.push(`${card}|c`);
      keys.push(`${card}|b`);
    }
  }
  return keys;
}

function bestResponseValue(profile, player) {
  const infoSets = bestResponseInfoSets(player);
  let best = player === 0 ? -Infinity : Infinity;

  // Six binary information sets -> exact enumeration of 2^6 deterministic BR policies.
  for (let mask = 0; mask < (1 << infoSets.length); mask++) {
    const policy = {};
    for (let i = 0; i < infoSets.length; i++) {
      policy[infoSets[i]] = (mask >> i) & 1;
    }

    const value = evaluateProfile(profile, player, policy);
    if (player === 0) best = Math.max(best, value);
    else best = Math.min(best, value);
  }

  return best;
}

function computeMetrics(profile) {
  const value = evaluateProfile(profile);
  const bestResponse0 = bestResponseValue(profile, 0);
  const bestResponse1 = bestResponseValue(profile, 1);
  const nashConv = bestResponse0 - bestResponse1;

  return {
    value,
    theoreticalValue: -1 / 18,
    valueError: Math.abs(value + 1 / 18),
    bestResponse0,
    bestResponse1,
    nashConv,
    exploitability: nashConv / 2
  };
}

function prettyProfile(profile) {
  const rows = [];
  const keys = Object.keys(profile).sort();
  for (const key of keys) {
    const [cardIndex, history] = key.split("|");
    const entry = profile[key];
    const parts = entry.actions.map((action, i) => `${action}:${entry.strategy[i].toFixed(4)}`);
    rows.push(`${CARD_NAMES[Number(cardIndex)]} @ ${history || "start"} -> ${parts.join("  ")}`);
  }
  return rows.join("\n");
}

module.exports = {
  KuhnCFRPlusTrainer,
  evaluateProfile,
  bestResponseValue,
  computeMetrics,
  prettyProfile,
  constants: { CARDS, CARD_NAMES, DEALS }
};

if (require.main === module) {
  const iterations = Number(process.argv[2] || 100000);
  const trainer = new KuhnCFRPlusTrainer();
  const profile = trainer.train(iterations);
  const metrics = computeMetrics(profile);

  console.log(`Kuhn CFR+ iterations: ${iterations}`);
  console.log(`value:          ${metrics.value.toFixed(8)} (theory -1/18 = ${metrics.theoreticalValue.toFixed(8)})`);
  console.log(`value error:    ${metrics.valueError.toExponential(4)}`);
  console.log(`BR0 value:      ${metrics.bestResponse0.toFixed(8)}`);
  console.log(`BR1 value(P0):  ${metrics.bestResponse1.toFixed(8)}`);
  console.log(`NashConv:       ${metrics.nashConv.toExponential(4)}`);
  console.log(`exploitability: ${metrics.exploitability.toExponential(4)}`);
  console.log("\nAverage strategy:\n" + prettyProfile(profile));
}
