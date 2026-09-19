"use strict";

const fs = require("fs");
const path = require("path");
const {
  buildStartingHandRanking169,
  buildJointClassDistribution,
  PrecomputedEquityOracle
} = require("./holdem169");

const PUBLIC_TREE = {
  ROOT: {
    player: 0,
    actions: [
      { name: "fold", terminal: { kind: "fixed", value: -0.5 } },
      { name: "limp", child: "BB_LIMP" },
      { name: "minraise", child: "BB_MINRAISE" },
      { name: "shove", child: "BB_VS_SHOVE" }
    ]
  },

  BB_LIMP: {
    player: 1,
    actions: [
      { name: "check", terminal: { kind: "continuation", investSB: 1, investBB: 1 } },
      { name: "raise3", child: "SB_VS_LIMP_RAISE3" },
      { name: "shove", child: "SB_VS_LIMP_SHOVE" }
    ]
  },

  SB_VS_LIMP_RAISE3: {
    player: 0,
    actions: [
      { name: "fold", terminal: { kind: "fixed", value: -1 } },
      { name: "call", terminal: { kind: "continuation", investSB: 3, investBB: 3 } },
      { name: "reshove", child: "BB_VS_LIMP_RESHOVE" }
    ]
  },

  BB_VS_LIMP_RESHOVE: {
    player: 1,
    actions: [
      { name: "fold", terminal: { kind: "fixed", value: 3 } },
      { name: "call", terminal: { kind: "allin" } }
    ]
  },

  SB_VS_LIMP_SHOVE: {
    player: 0,
    actions: [
      { name: "fold", terminal: { kind: "fixed", value: -1 } },
      { name: "call", terminal: { kind: "allin" } }
    ]
  },

  BB_MINRAISE: {
    player: 1,
    actions: [
      { name: "fold", terminal: { kind: "fixed", value: 1 } },
      { name: "call", terminal: { kind: "continuation", investSB: 2, investBB: 2 } },
      { name: "threebet6", child: "SB_VS_3BET6" },
      { name: "shove", child: "SB_VS_MINRAISE_SHOVE" }
    ]
  },

  SB_VS_3BET6: {
    player: 0,
    actions: [
      { name: "fold", terminal: { kind: "fixed", value: -2 } },
      { name: "call", terminal: { kind: "continuation", investSB: 6, investBB: 6 } },
      { name: "reshove", child: "BB_VS_3BET_RESHOVE" }
    ]
  },

  BB_VS_3BET_RESHOVE: {
    player: 1,
    actions: [
      { name: "fold", terminal: { kind: "fixed", value: 6 } },
      { name: "call", terminal: { kind: "allin" } }
    ]
  },

  SB_VS_MINRAISE_SHOVE: {
    player: 0,
    actions: [
      { name: "fold", terminal: { kind: "fixed", value: -2 } },
      { name: "call", terminal: { kind: "allin" } }
    ]
  },

  BB_VS_SHOVE: {
    player: 1,
    actions: [
      { name: "fold", terminal: { kind: "fixed", value: 1 } },
      { name: "call", terminal: { kind: "allin" } }
    ]
  }
};

function clamp(x, low, high) {
  return Math.max(low, Math.min(high, x));
}

class EquityRealizationContinuationOracle {
  constructor(options = {}) {
    this.baseRealization = options.baseRealization ?? 0.80;
    this.maxRealization = options.maxRealization ?? 0.94;
    this.positionBonus = options.positionBonus ?? 0.02;
    this.positionSprBonus = options.positionSprBonus ?? 0.01;
  }

  value({ equity, investSB, investBB, stackBB }) {
    const pot = investSB + investBB;
    const remaining = Math.max(0, stackBB - Math.max(investSB, investBB));
    const spr = remaining / Math.max(1e-9, pot);

    // Lower SPR means all-in equity is realized more directly. At high SPR,
    // future betting and folding compress raw showdown-equity differences.
    const pressure = 1 / (1 + spr);
    const realization =
      this.baseRealization +
      (this.maxRealization - this.baseRealization) * pressure;

    // The SB/button is in position postflop in heads-up Hold'em.
    const ipBonus =
      this.positionBonus +
      this.positionSprBonus * Math.min(1, spr / 5);

    const realizedEquity = clamp(
      0.5 + realization * (equity - 0.5) + ipBonus,
      0.02,
      0.98
    );

    return realizedEquity * pot - investSB;
  }

  metadata() {
    return {
      kind: "equity-realization-approximation-v1",
      baseRealization: this.baseRealization,
      maxRealization: this.maxRealization,
      positionBonus: this.positionBonus,
      positionSprBonus: this.positionSprBonus,
      exactPostflopSolver: false
    };
  }
}

class SeededRng {
  constructor(seed = 1) {
    this.state = seed >>> 0 || 1;
  }

  next() {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state / 4294967296;
  }

  int(maxExclusive) {
    return Math.floor(this.next() * maxExclusive);
  }
}

class InfoSetFamily {
  constructor(id, player, actions, handCount) {
    this.id = id;
    this.player = player;
    this.actions = actions.slice();
    this.actionCount = actions.length;
    this.handCount = handCount;
    this.regrets = new Float64Array(handCount * this.actionCount);
    this.strategy = new Float64Array(handCount * this.actionCount);
    this.strategySum = new Float64Array(handCount * this.actionCount);

    const uniform = 1 / this.actionCount;
    this.strategy.fill(uniform);
  }

  offset(handIndex) {
    return handIndex * this.actionCount;
  }

  refreshHand(handIndex) {
    const offset = this.offset(handIndex);
    let total = 0;

    for (let a = 0; a < this.actionCount; a++) {
      const r = Math.max(0, this.regrets[offset + a]);
      this.strategy[offset + a] = r;
      total += r;
    }

    if (total <= 1e-15) {
      const p = 1 / this.actionCount;
      for (let a = 0; a < this.actionCount; a++) {
        this.strategy[offset + a] = p;
      }
      return;
    }

    for (let a = 0; a < this.actionCount; a++) {
      this.strategy[offset + a] /= total;
    }
  }

  averageStrategy() {
    const out = new Float64Array(this.strategy.length);

    for (let hand = 0; hand < this.handCount; hand++) {
      const offset = this.offset(hand);
      let total = 0;

      for (let a = 0; a < this.actionCount; a++) {
        total += this.strategySum[offset + a];
      }

      if (total <= 1e-15) {
        for (let a = 0; a < this.actionCount; a++) {
          out[offset + a] = this.strategy[offset + a];
        }
      } else {
        for (let a = 0; a < this.actionCount; a++) {
          out[offset + a] = this.strategySum[offset + a] / total;
        }
      }
    }

    return out;
  }
}

function rankSymbol(rank) {
  if (rank === 14) return "A";
  if (rank === 13) return "K";
  if (rank === 12) return "Q";
  if (rank === 11) return "J";
  if (rank === 10) return "T";
  return String(rank);
}

function notationFromCardIds(cardA, cardB) {
  const rankA = Math.floor(cardA / 4) + 2;
  const rankB = Math.floor(cardB / 4) + 2;
  const suitA = cardA % 4;
  const suitB = cardB % 4;

  const high = Math.max(rankA, rankB);
  const low = Math.min(rankA, rankB);

  if (high === low) {
    return rankSymbol(high) + rankSymbol(low);
  }

  return (
    rankSymbol(high) +
    rankSymbol(low) +
    (suitA === suitB ? "s" : "o")
  );
}

class HeadsUpMidstackCFRPlus {
  constructor(options = {}) {
    this.stackBB = options.stackBB ?? 15;
    if (this.stackBB < 12 || this.stackBB > 20) {
      throw new Error("midstack solver is intended for 12–20BB");
    }

    this.smallBlind = 0.5;
    this.bigBlind = 1;
    this.ranking = (options.ranking || buildStartingHandRanking169()).slice();
    this.n = this.ranking.length;
    this.handIndex = new Map(this.ranking.map((hand, i) => [hand, i]));

    const chance = options.chanceModel || buildJointClassDistribution(this.ranking);
    this.jointProb = chance.joint;
    this.marginalSB = chance.marginalSB;
    this.marginalBB = chance.marginalBB;
    this.bbGivenSB = chance.bbGivenSB;
    this.sbGivenBB = chance.sbGivenBB;
    this.totalOrderedDeals = chance.totalOrderedDeals;

    const equityOracle = options.equityOracle || new PrecomputedEquityOracle();
    this.equityMatrix =
      options.equityMatrix || equityOracle.matrix(this.ranking);

    this.continuationOracle =
      options.continuationOracle ||
      new EquityRealizationContinuationOracle();

    this.families = new Map();
    for (const [id, node] of Object.entries(PUBLIC_TREE)) {
      this.families.set(
        id,
        new InfoSetFamily(
          id,
          node.player,
          node.actions.map(a => a.name),
          this.n
        )
      );
    }

    this.rng = new SeededRng(options.seed ?? 1);
    this.iterations = 0;
  }

  samplePrivateHandClasses() {
    const cards = [];
    while (cards.length < 4) {
      const c = this.rng.int(52);
      if (!cards.includes(c)) cards.push(c);
    }

    const sbNotation = notationFromCardIds(cards[0], cards[1]);
    const bbNotation = notationFromCardIds(cards[2], cards[3]);

    const sb = this.handIndex.get(sbNotation);
    const bb = this.handIndex.get(bbNotation);

    if (sb === undefined || bb === undefined) {
      throw new Error("sampled hand class not found");
    }

    return [sb, bb];
  }

  terminalValue(terminal, sbHand, bbHand) {
    if (terminal.kind === "fixed") {
      return terminal.value;
    }

    const equity = this.equityMatrix[sbHand * this.n + bbHand];

    if (terminal.kind === "allin") {
      return this.stackBB * (2 * equity - 1);
    }

    if (terminal.kind === "continuation") {
      return this.continuationOracle.value({
        equity,
        investSB: terminal.investSB,
        investBB: terminal.investBB,
        stackBB: this.stackBB
      });
    }

    throw new Error("unknown terminal kind: " + terminal.kind);
  }

  _childValue(action, sbHand, bbHand, reachSB, reachBB, updatePlayer) {
    if (action.terminal) {
      return this.terminalValue(action.terminal, sbHand, bbHand);
    }

    return this._cfr(
      action.child,
      sbHand,
      bbHand,
      reachSB,
      reachBB,
      updatePlayer
    );
  }

  _cfr(nodeId, sbHand, bbHand, reachSB, reachBB, updatePlayer) {
    const node = PUBLIC_TREE[nodeId];
    const family = this.families.get(nodeId);
    const hand = node.player === 0 ? sbHand : bbHand;
    const offset = family.offset(hand);
    const actionValues = new Float64Array(family.actionCount);

    let nodeValue = 0;

    for (let a = 0; a < family.actionCount; a++) {
      const p = family.strategy[offset + a];
      const nextReachSB = node.player === 0 ? reachSB * p : reachSB;
      const nextReachBB = node.player === 1 ? reachBB * p : reachBB;

      actionValues[a] = this._childValue(
        node.actions[a],
        sbHand,
        bbHand,
        nextReachSB,
        nextReachBB,
        updatePlayer
      );

      nodeValue += p * actionValues[a];
    }

    if (node.player === updatePlayer) {
      const opponentReach = node.player === 0 ? reachBB : reachSB;
      const sign = node.player === 0 ? 1 : -1;

      for (let a = 0; a < family.actionCount; a++) {
        const regret =
          opponentReach * sign * (actionValues[a] - nodeValue);

        family.regrets[offset + a] =
          Math.max(0, family.regrets[offset + a] + regret);
      }

      family.refreshHand(hand);
    }

    return nodeValue;
  }

  _accumulate(nodeId, sbHand, bbHand, reachSB, reachBB, weight) {
    const node = PUBLIC_TREE[nodeId];
    const family = this.families.get(nodeId);
    const hand = node.player === 0 ? sbHand : bbHand;
    const offset = family.offset(hand);
    const ownReach = node.player === 0 ? reachSB : reachBB;

    for (let a = 0; a < family.actionCount; a++) {
      const p = family.strategy[offset + a];
      family.strategySum[offset + a] += weight * ownReach * p;

      const action = node.actions[a];
      if (!action.child) continue;

      this._accumulate(
        action.child,
        sbHand,
        bbHand,
        node.player === 0 ? reachSB * p : reachSB,
        node.player === 1 ? reachBB * p : reachBB,
        weight
      );
    }
  }

  train(iterations) {
    if (!Number.isInteger(iterations) || iterations <= 0) {
      throw new Error("iterations must be a positive integer");
    }

    for (let local = 1; local <= iterations; local++) {
      const [sbHand, bbHand] = this.samplePrivateHandClasses();

      this._cfr("ROOT", sbHand, bbHand, 1, 1, 0);
      this._cfr("ROOT", sbHand, bbHand, 1, 1, 1);

      const globalIteration = this.iterations + local;
      this._accumulate(
        "ROOT",
        sbHand,
        bbHand,
        1,
        1,
        globalIteration
      );
    }

    this.iterations += iterations;
    return this.averageProfile();
  }

  averageProfile() {
    const profile = {};
    for (const [id, family] of this.families.entries()) {
      profile[id] = family.averageStrategy();
    }
    return profile;
  }

  _pairProfileValue(nodeId, sbHand, bbHand, profile) {
    const node = PUBLIC_TREE[nodeId];
    const family = this.families.get(nodeId);
    const hand = node.player === 0 ? sbHand : bbHand;
    const strategy = profile[nodeId];
    const offset = family.offset(hand);

    let value = 0;

    for (let a = 0; a < family.actionCount; a++) {
      const action = node.actions[a];
      const childValue = action.terminal
        ? this.terminalValue(action.terminal, sbHand, bbHand)
        : this._pairProfileValue(action.child, sbHand, bbHand, profile);

      value += strategy[offset + a] * childValue;
    }

    return value;
  }

  profileValue(profile = this.averageProfile()) {
    let value = 0;

    for (let i = 0; i < this.n; i++) {
      for (let j = 0; j < this.n; j++) {
        const chance = this.jointProb[i * this.n + j];
        if (chance <= 0) continue;
        value += chance * this._pairProfileValue("ROOT", i, j, profile);
      }
    }

    return value;
  }

  _terminalExpectedValue(terminal, brPlayer, heroHand, opponentWeights) {
    let value = 0;

    for (let oppHand = 0; oppHand < this.n; oppHand++) {
      const w = opponentWeights[oppHand];
      if (w <= 0) continue;

      const sbHand = brPlayer === 0 ? heroHand : oppHand;
      const bbHand = brPlayer === 1 ? heroHand : oppHand;

      value += w * this.terminalValue(terminal, sbHand, bbHand);
    }

    return value;
  }

  _bestResponseNode(nodeId, brPlayer, heroHand, opponentWeights, profile) {
    const node = PUBLIC_TREE[nodeId];
    const family = this.families.get(nodeId);

    if (node.player === brPlayer) {
      let best = brPlayer === 0 ? -Infinity : Infinity;

      for (const action of node.actions) {
        const v = action.terminal
          ? this._terminalExpectedValue(
              action.terminal,
              brPlayer,
              heroHand,
              opponentWeights
            )
          : this._bestResponseNode(
              action.child,
              brPlayer,
              heroHand,
              opponentWeights,
              profile
            );

        if (brPlayer === 0) best = Math.max(best, v);
        else best = Math.min(best, v);
      }

      return best;
    }

    let total = 0;

    for (let a = 0; a < family.actionCount; a++) {
      const nextWeights = new Float64Array(this.n);
      let branchMass = 0;

      for (let oppHand = 0; oppHand < this.n; oppHand++) {
        const w = opponentWeights[oppHand];
        if (w <= 0) continue;

        const offset = family.offset(oppHand);
        const p = profile[nodeId][offset + a];
        const next = w * p;
        nextWeights[oppHand] = next;
        branchMass += next;
      }

      if (branchMass <= 1e-15) continue;

      for (let oppHand = 0; oppHand < this.n; oppHand++) {
        nextWeights[oppHand] /= branchMass;
      }

      const action = node.actions[a];
      const branchValue = action.terminal
        ? this._terminalExpectedValue(
            action.terminal,
            brPlayer,
            heroHand,
            nextWeights
          )
        : this._bestResponseNode(
            action.child,
            brPlayer,
            heroHand,
            nextWeights,
            profile
          );

      total += branchMass * branchValue;
    }

    return total;
  }

  bestResponseValue(player, profile = this.averageProfile()) {
    let value = 0;

    for (let heroHand = 0; heroHand < this.n; heroHand++) {
      const weights = new Float64Array(this.n);

      if (player === 0) {
        const row = heroHand * this.n;
        for (let opp = 0; opp < this.n; opp++) {
          weights[opp] = this.bbGivenSB[row + opp];
        }

        value +=
          this.marginalSB[heroHand] *
          this._bestResponseNode(
            "ROOT",
            0,
            heroHand,
            weights,
            profile
          );
      } else {
        const row = heroHand * this.n;
        for (let opp = 0; opp < this.n; opp++) {
          weights[opp] = this.sbGivenBB[row + opp];
        }

        value +=
          this.marginalBB[heroHand] *
          this._bestResponseNode(
            "ROOT",
            1,
            heroHand,
            weights,
            profile
          );
      }
    }

    return value;
  }

  rootActionFrequencies(profile = this.averageProfile()) {
    const family = this.families.get("ROOT");
    const strategy = profile.ROOT;
    const out = {};

    for (let a = 0; a < family.actionCount; a++) {
      let frequency = 0;
      for (let hand = 0; hand < this.n; hand++) {
        frequency +=
          this.marginalSB[hand] *
          strategy[family.offset(hand) + a];
      }
      out[family.actions[a]] = frequency;
    }

    return out;
  }

  metrics(profile = this.averageProfile()) {
    const value = this.profileValue(profile);
    const bestResponseSB = this.bestResponseValue(0, profile);
    const bestResponseBB = this.bestResponseValue(1, profile);
    const nashConv = bestResponseSB - bestResponseBB;

    return {
      value,
      bestResponseSB,
      bestResponseBB,
      nashConv,
      exploitability: nashConv / 2,
      rootActionFrequencies: this.rootActionFrequencies(profile)
    };
  }

  blueprint(profile = this.averageProfile()) {
    const nodes = {};

    for (const [id, family] of this.families.entries()) {
      const strategy = profile[id];
      const byHand = {};

      for (let hand = 0; hand < this.n; hand++) {
        const row = {};
        const offset = family.offset(hand);

        for (let a = 0; a < family.actionCount; a++) {
          row[family.actions[a]] = strategy[offset + a];
        }

        byHand[this.ranking[hand]] = row;
      }

      nodes[id] = {
        player: family.player,
        actions: family.actions.slice(),
        strategy: byHand
      };
    }

    return {
      version: "hu-midstack-cfr-v1",
      abstraction: {
        players: 2,
        effectiveStackBB: this.stackBB,
        smallBlindBB: 0.5,
        bigBlindBB: 1,
        rootActions: ["fold", "limp", "minraise", "shove"],
        limpRaiseToBB: 3,
        minraiseToBB: 2,
        threebetToBB: 6,
        chanceModel: "exact-blocker-weighted-1326x1225",
        equityOracle: "poker-yoga-preflop-equity-1m-seed1",
        continuationValue:
          this.continuationOracle.metadata(),
        exactPostflopSolver: false
      },
      iterations: this.iterations,
      metrics: this.metrics(profile),
      nodes
    };
  }

  writeBlueprint(filePath, profile = this.averageProfile()) {
    const payload = this.blueprint(profile);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      JSON.stringify(payload, null, 2) + "\n",
      "utf8"
    );
    return payload;
  }
}

module.exports = {
  PUBLIC_TREE,
  EquityRealizationContinuationOracle,
  HeadsUpMidstackCFRPlus
};

if (require.main === module) {
  const iterations = Number(process.argv[2] || 200000);
  const stackBB = Number(process.argv[3] || 15);
  const outputPath = process.argv[4] || "";

  const trainer = new HeadsUpMidstackCFRPlus({
    stackBB,
    seed: 1
  });

  const profile = trainer.train(iterations);
  const metrics = trainer.metrics(profile);

  console.log(
    `HU midstack CFR+ | stack=${stackBB}BB | iterations=${iterations}`
  );
  console.log(
    `value (SB bb/hand): ${metrics.value.toFixed(8)}`
  );
  console.log(
    `BR SB:              ${metrics.bestResponseSB.toFixed(8)}`
  );
  console.log(
    `BR BB (P0 value):   ${metrics.bestResponseBB.toFixed(8)}`
  );
  console.log(
    `NashConv:           ${metrics.nashConv.toExponential(4)}`
  );
  console.log(
    `exploitability:     ${metrics.exploitability.toExponential(4)}`
  );
  console.log(
    "root frequencies:   " +
    JSON.stringify(metrics.rootActionFrequencies)
  );

  if (outputPath) {
    trainer.writeBlueprint(outputPath, profile);
    console.log("\nBlueprint written to " + outputPath);
  }
}
