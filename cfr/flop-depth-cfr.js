"use strict";

const {
  BUCKET_NAMES,
  buildDeck,
  showdownShare,
  flopBucket,
  normalizeRange,
  WeightedRangeSampler
} = require("./holdem-postflop");

const FLOP_TREE = {
  OOP_ROOT: {
    player: 0,
    actions: ["check", "bet33", "bet75", "jam"]
  },
  IP_AFTER_CHECK: {
    player: 1,
    actions: ["check", "bet33", "bet75", "jam"]
  },
  IP_VS_OOP_B33: {
    player: 1,
    actions: ["fold", "call", "jam"]
  },
  IP_VS_OOP_B75: {
    player: 1,
    actions: ["fold", "call", "jam"]
  },
  IP_VS_OOP_JAM: {
    player: 1,
    actions: ["fold", "call"]
  },
  OOP_VS_IP_B33: {
    player: 0,
    actions: ["fold", "call", "jam"]
  },
  OOP_VS_IP_B75: {
    player: 0,
    actions: ["fold", "call", "jam"]
  },
  OOP_VS_IP_JAM: {
    player: 0,
    actions: ["fold", "call"]
  },
  OOP_VS_IP_JAM_AFTER_B33: {
    player: 0,
    actions: ["fold", "call"]
  },
  OOP_VS_IP_JAM_AFTER_B75: {
    player: 0,
    actions: ["fold", "call"]
  },
  IP_VS_OOP_JAM_AFTER_B33: {
    player: 1,
    actions: ["fold", "call"]
  },
  IP_VS_OOP_JAM_AFTER_B75: {
    player: 1,
    actions: ["fold", "call"]
  }
};

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
  constructor(nodeId, player, actions, bucketCount) {
    this.nodeId = nodeId;
    this.player = player;
    this.actions = actions.slice();
    this.actionCount = actions.length;
    this.bucketCount = bucketCount;

    this.regrets = new Float64Array(
      bucketCount * this.actionCount
    );
    this.strategy = new Float64Array(
      bucketCount * this.actionCount
    );
    this.strategySum = new Float64Array(
      bucketCount * this.actionCount
    );
    this.visits = new Uint32Array(bucketCount);

    this.strategy.fill(1 / this.actionCount);
  }

  offset(bucket) {
    return bucket * this.actionCount;
  }

  refresh(bucket) {
    const offset = this.offset(bucket);
    let total = 0;

    for (let a = 0; a < this.actionCount; a++) {
      const r = Math.max(
        0,
        this.regrets[offset + a]
      );
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

    for (let bucket = 0; bucket < this.bucketCount; bucket++) {
      const offset = this.offset(bucket);
      let total = 0;

      for (let a = 0; a < this.actionCount; a++) {
        total += this.strategySum[offset + a];
      }

      if (total <= 1e-15) {
        for (let a = 0; a < this.actionCount; a++) {
          out[offset + a] =
            this.strategy[offset + a];
        }
      } else {
        for (let a = 0; a < this.actionCount; a++) {
          out[offset + a] =
            this.strategySum[offset + a] / total;
        }
      }
    }

    return out;
  }
}

function cloneState(state) {
  return {
    oopContribution: state.oopContribution,
    ipContribution: state.ipContribution
  };
}

class FlopDepthLimitedCFR {
  constructor(options) {
    if (!options || !Array.isArray(options.flop)) {
      throw new Error("flop is required");
    }

    if (options.flop.length !== 3) {
      throw new Error("flop must contain exactly three cards");
    }

    this.flop = options.flop.slice();
    this.potBB = Number(options.potBB ?? 4);
    this.stackBB = Number(options.stackBB ?? 20);

    if (
      !Number.isFinite(this.potBB) ||
      this.potBB <= 0 ||
      !Number.isFinite(this.stackBB) ||
      this.stackBB <= 0
    ) {
      throw new Error("invalid pot/stack");
    }

    this.oopRange = normalizeRange(
      options.oopRange,
      this.flop
    );
    this.ipRange = normalizeRange(
      options.ipRange,
      this.flop
    );

    this.oopSampler = new WeightedRangeSampler(
      this.oopRange
    );
    this.ipSampler = new WeightedRangeSampler(
      this.ipRange
    );

    this.rootNode = options.rootNode || "OOP_ROOT";
    if (!FLOP_TREE[this.rootNode]) {
      throw new Error("unknown flop CFR root node: " + this.rootNode);
    }

    const initialState = options.initialState || {};
    this.initialState = {
      oopContribution: Number(initialState.oopContribution || 0),
      ipContribution: Number(initialState.ipContribution || 0)
    };

    if (
      this.initialState.oopContribution < 0 ||
      this.initialState.ipContribution < 0 ||
      this.initialState.oopContribution > this.stackBB ||
      this.initialState.ipContribution > this.stackBB
    ) {
      throw new Error("invalid initial flop contribution state");
    }

    this.rng = new SeededRng(options.seed ?? 1);
    this.iterations = 0;

    this.families = new Map();
    for (const [nodeId, node] of Object.entries(FLOP_TREE)) {
      this.families.set(
        nodeId,
        new InfoSetFamily(
          nodeId,
          node.player,
          node.actions,
          BUCKET_NAMES.length
        )
      );
    }
  }

  _sampleDealAndRunout() {
    const boardBlocked = new Set(this.flop);
    const oopHole = this.oopSampler.sample(
      this.rng,
      boardBlocked
    );

    const blockedForIp = new Set([
      ...this.flop,
      ...oopHole
    ]);

    const ipHole = this.ipSampler.sample(
      this.rng,
      blockedForIp
    );

    const blocked = new Set([
      ...this.flop,
      ...oopHole,
      ...ipHole
    ]);

    const deck = buildDeck().filter(c => !blocked.has(c));

    const turnIndex = this.rng.int(deck.length);
    const turn = deck.splice(turnIndex, 1)[0];

    const riverIndex = this.rng.int(deck.length);
    const river = deck[riverIndex];

    const runout = [turn, river];
    const board5 = this.flop.concat(runout);
    const oopShare = showdownShare(
      oopHole,
      ipHole,
      board5
    );

    return {
      oopHole,
      ipHole,
      oopBucket: flopBucket(oopHole, this.flop),
      ipBucket: flopBucket(ipHole, this.flop),
      runout,
      oopShare
    };
  }

  _betAmount(fraction, currentState, player) {
    const currentPot =
      this.potBB +
      currentState.oopContribution +
      currentState.ipContribution;

    const ownContribution =
      player === 0
        ? currentState.oopContribution
        : currentState.ipContribution;

    const remaining = Math.max(
      0,
      this.stackBB - ownContribution
    );

    return Math.min(
      remaining,
      currentPot * fraction
    );
  }

  _foldUtility(state, foldingPlayer) {
    if (foldingPlayer === 0) {
      return -state.oopContribution;
    }

    return (
      this.potBB +
      state.ipContribution
    );
  }

  _showdownUtility(state, sample) {
    const totalPot =
      this.potBB +
      state.oopContribution +
      state.ipContribution;

    return (
      sample.oopShare * totalPot -
      state.oopContribution
    );
  }

  _callToMatch(state, caller) {
    const next = cloneState(state);

    if (caller === 0) {
      next.oopContribution =
        Math.min(
          this.stackBB,
          next.ipContribution
        );
    } else {
      next.ipContribution =
        Math.min(
          this.stackBB,
          next.oopContribution
        );
    }

    return next;
  }

  _jam(state, player) {
    const next = cloneState(state);

    if (player === 0) {
      next.oopContribution = this.stackBB;
    } else {
      next.ipContribution = this.stackBB;
    }

    return next;
  }

  _bet(state, player, fraction) {
    const next = cloneState(state);
    const amount = this._betAmount(
      fraction,
      next,
      player
    );

    if (player === 0) {
      next.oopContribution += amount;
    } else {
      next.ipContribution += amount;
    }

    return next;
  }

  _transition(nodeId, action, state, sample) {
    if (nodeId === "OOP_ROOT") {
      if (action === "check") {
        return { node: "IP_AFTER_CHECK", state };
      }
      if (action === "bet33") {
        return {
          node: "IP_VS_OOP_B33",
          state: this._bet(state, 0, 0.33)
        };
      }
      if (action === "bet75") {
        return {
          node: "IP_VS_OOP_B75",
          state: this._bet(state, 0, 0.75)
        };
      }
      if (action === "jam") {
        return {
          node: "IP_VS_OOP_JAM",
          state: this._jam(state, 0)
        };
      }
    }

    if (nodeId === "IP_AFTER_CHECK") {
      if (action === "check") {
        return {
          terminal: this._showdownUtility(
            state,
            sample
          )
        };
      }
      if (action === "bet33") {
        return {
          node: "OOP_VS_IP_B33",
          state: this._bet(state, 1, 0.33)
        };
      }
      if (action === "bet75") {
        return {
          node: "OOP_VS_IP_B75",
          state: this._bet(state, 1, 0.75)
        };
      }
      if (action === "jam") {
        return {
          node: "OOP_VS_IP_JAM",
          state: this._jam(state, 1)
        };
      }
    }

    if (
      nodeId === "IP_VS_OOP_B33" ||
      nodeId === "IP_VS_OOP_B75"
    ) {
      if (action === "fold") {
        return {
          terminal: this._foldUtility(state, 1)
        };
      }
      if (action === "call") {
        return {
          terminal: this._showdownUtility(
            this._callToMatch(state, 1),
            sample
          )
        };
      }
      if (action === "jam") {
        return {
          node:
            nodeId === "IP_VS_OOP_B33"
              ? "OOP_VS_IP_JAM_AFTER_B33"
              : "OOP_VS_IP_JAM_AFTER_B75",
          state: this._jam(state, 1)
        };
      }
    }

    if (
      nodeId === "OOP_VS_IP_B33" ||
      nodeId === "OOP_VS_IP_B75"
    ) {
      if (action === "fold") {
        return {
          terminal: this._foldUtility(state, 0)
        };
      }
      if (action === "call") {
        return {
          terminal: this._showdownUtility(
            this._callToMatch(state, 0),
            sample
          )
        };
      }
      if (action === "jam") {
        return {
          node:
            nodeId === "OOP_VS_IP_B33"
              ? "IP_VS_OOP_JAM_AFTER_B33"
              : "IP_VS_OOP_JAM_AFTER_B75",
          state: this._jam(state, 0)
        };
      }
    }

    if (
      nodeId === "IP_VS_OOP_JAM" ||
      nodeId === "IP_VS_OOP_JAM_AFTER_B33" ||
      nodeId === "IP_VS_OOP_JAM_AFTER_B75"
    ) {
      if (action === "fold") {
        return {
          terminal: this._foldUtility(state, 1)
        };
      }
      if (action === "call") {
        return {
          terminal: this._showdownUtility(
            this._callToMatch(state, 1),
            sample
          )
        };
      }
    }

    if (
      nodeId === "OOP_VS_IP_JAM" ||
      nodeId === "OOP_VS_IP_JAM_AFTER_B33" ||
      nodeId === "OOP_VS_IP_JAM_AFTER_B75"
    ) {
      if (action === "fold") {
        return {
          terminal: this._foldUtility(state, 0)
        };
      }
      if (action === "call") {
        return {
          terminal: this._showdownUtility(
            this._callToMatch(state, 0),
            sample
          )
        };
      }
    }

    throw new Error(
      "unsupported transition: " +
      nodeId +
      " / " +
      action
    );
  }

  _cfr(
    nodeId,
    state,
    sample,
    reachOop,
    reachIp,
    updatePlayer
  ) {
    const node = FLOP_TREE[nodeId];
    const family = this.families.get(nodeId);

    const bucket =
      node.player === 0
        ? sample.oopBucket
        : sample.ipBucket;

    const offset = family.offset(bucket);
    family.visits[bucket]++;

    const actionValues = new Float64Array(
      family.actionCount
    );

    let nodeValue = 0;

    for (let a = 0; a < family.actionCount; a++) {
      const action = family.actions[a];
      const p = family.strategy[offset + a];
      const transition = this._transition(
        nodeId,
        action,
        state,
        sample
      );

      const nextValue =
        transition.terminal !== undefined
          ? transition.terminal
          : this._cfr(
              transition.node,
              transition.state,
              sample,
              node.player === 0
                ? reachOop * p
                : reachOop,
              node.player === 1
                ? reachIp * p
                : reachIp,
              updatePlayer
            );

      actionValues[a] = nextValue;
      nodeValue += p * nextValue;
    }

    if (node.player === updatePlayer) {
      const opponentReach =
        node.player === 0
          ? reachIp
          : reachOop;

      const sign =
        node.player === 0 ? 1 : -1;

      for (let a = 0; a < family.actionCount; a++) {
        const regret =
          opponentReach *
          sign *
          (actionValues[a] - nodeValue);

        family.regrets[offset + a] =
          Math.max(
            0,
            family.regrets[offset + a] +
              regret
          );
      }

      family.refresh(bucket);
    }

    return nodeValue;
  }

  _accumulate(
    nodeId,
    state,
    sample,
    reachOop,
    reachIp,
    weight
  ) {
    const node = FLOP_TREE[nodeId];
    const family = this.families.get(nodeId);

    const bucket =
      node.player === 0
        ? sample.oopBucket
        : sample.ipBucket;

    const offset = family.offset(bucket);
    const ownReach =
      node.player === 0
        ? reachOop
        : reachIp;

    for (let a = 0; a < family.actionCount; a++) {
      const p = family.strategy[offset + a];

      family.strategySum[offset + a] +=
        weight * ownReach * p;

      const transition = this._transition(
        nodeId,
        family.actions[a],
        state,
        sample
      );

      if (transition.terminal !== undefined) {
        continue;
      }

      this._accumulate(
        transition.node,
        transition.state,
        sample,
        node.player === 0
          ? reachOop * p
          : reachOop,
        node.player === 1
          ? reachIp * p
          : reachIp,
        weight
      );
    }
  }

  train(iterations) {
    if (!Number.isInteger(iterations) || iterations <= 0) {
      throw new Error(
        "iterations must be a positive integer"
      );
    }

    for (let local = 1; local <= iterations; local++) {
      const sample = this._sampleDealAndRunout();
      const rootState = cloneState(this.initialState);

      this._cfr(
        this.rootNode,
        rootState,
        sample,
        1,
        1,
        0
      );

      this._cfr(
        this.rootNode,
        rootState,
        sample,
        1,
        1,
        1
      );

      const weight = this.iterations + local;

      this._accumulate(
        this.rootNode,
        rootState,
        sample,
        1,
        1,
        weight
      );
    }

    this.iterations += iterations;
    return this.averageProfile();
  }

  averageProfile() {
    const profile = {};

    for (const [nodeId, family] of this.families.entries()) {
      profile[nodeId] = family.averageStrategy();
    }

    return profile;
  }

  normalizedRegret() {
    let total = 0;
    let count = 0;

    for (const family of this.families.values()) {
      for (const regret of family.regrets) {
        total += regret;
        count++;
      }
    }

    return (
      total /
      Math.max(1, count) /
      Math.max(1, this.iterations)
    );
  }

  nodeBucketStrategy(
    nodeId,
    bucket,
    profile = this.averageProfile()
  ) {
    const family = this.families.get(nodeId);
    if (!family) {
      throw new Error("unknown flop CFR node: " + nodeId);
    }

    if (
      !Number.isInteger(bucket) ||
      bucket < 0 ||
      bucket >= BUCKET_NAMES.length
    ) {
      throw new Error("invalid flop bucket: " + bucket);
    }

    const offset = family.offset(bucket);
    const strategy = profile[nodeId];
    const out = {};

    for (let a = 0; a < family.actionCount; a++) {
      out[family.actions[a]] =
        strategy[offset + a];
    }

    return out;
  }

  rootBucketStrategy(
    bucket,
    profile = this.averageProfile()
  ) {
    return this.nodeBucketStrategy(
      this.rootNode,
      bucket,
      profile
    );
  }

  metadata() {
    return {
      version: "flop-depth-cfr-v1",
      flop: this.flop.slice(),
      potBB: this.potBB,
      effectiveStackBB: this.stackBB,
      bucketNames: BUCKET_NAMES.slice(),
      publicNodes: Object.keys(FLOP_TREE),
      rootNode: this.rootNode,
      initialState: { ...this.initialState },
      leafModel: {
        allIn: "sampled-turn-river-showdown",
        nonAllIn:
          "sampled-turn-river-checkdown",
        futureBettingSolved: false
      },
      hiddenCardPolicy:
        "sample-from-range; strategy keyed only by own flop bucket"
    };
  }
}

module.exports = {
  FLOP_TREE,
  SeededRng,
  FlopDepthLimitedCFR
};
