"use strict";

const fs = require("fs");
const assert = require("assert");

class FakeClassList {
  add() {}
  remove() {}
  toggle() { return false; }
  contains() { return false; }
}

class FakeElement {
  constructor() {
    this.style = { setProperty() {} };
    this.classList = new FakeClassList();
    this.innerHTML = "";
    this.textContent = "";
    this.value = "";
    this.children = [];
  }
  appendChild(x) { this.children.push(x); return x; }
  addEventListener() {}
  closest() { return null; }
}

const elements = new Map();
globalThis.document = {
  documentElement: { style: { setProperty() {} } },
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, new FakeElement());
    return elements.get(id);
  },
  createElement() { return new FakeElement(); },
  addEventListener() {}
};
globalThis.window = {
  innerWidth: 1500,
  innerHeight: 900,
  addEventListener() {},
  onload: null
};
globalThis.location = { reload() {} };
globalThis.alert = () => {};
globalThis.prompt = () => null;

const html = fs.readFileSync(
  "zhang_family_texas_holdem_formal_v3_shuffle_below_cards.html",
  "utf8"
);

const start = html.indexOf("<script>") + "<script>".length;
const end = html.lastIndexOf("</script>");
if (start < "<script>".length || end <= start) {
  throw new Error("Cannot find game script");
}

const script = html.slice(start, end);

const harness = String.raw`
return (() => {
  if (ENABLE_FLOP_DEPTH_CFR !== false) {
    throw new Error("flop CFR live flag must remain off during first adapter milestone");
  }

  bigBlind = 20;
  smallBlind = 10;
  dealerIndex = 0; // IP/button
  street = "flop";
  board = [
    { rank: 13, suit: "S" },
    { rank: 8, suit: "H" },
    { rank: 3, suit: "D" }
  ];

  players = [
    {
      name: "IP",
      chips: 300,
      currentBet: 0,
      totalBet: 40,
      folded: false,
      allIn: false,
      hole: [
        { rank: 14, suit: "C" },
        { rank: 12, suit: "C" }
      ]
    },
    {
      name: "OOP",
      chips: 300,
      currentBet: 0,
      totalBet: 40,
      folded: false,
      allIn: false,
      hole: [
        { rank: 11, suit: "C" },
        { rank: 10, suit: "C" }
      ]
    }
  ];

  const IP = 0;
  const OOP = 1;

  function check(playerIndex) {
    return {
      street: "flop",
      playerIndex,
      action: "check",
      amountPaid: 0,
      potAfterAction: 100,
      isAllIn: false
    };
  }

  function bet(playerIndex, amount, potBefore = 100) {
    return {
      street: "flop",
      playerIndex,
      action: "bet",
      amountPaid: amount,
      potAfterAction: potBefore + amount,
      isAllIn: false
    };
  }

  function jamRaise(playerIndex, potAfterAction = 400) {
    return {
      street: "flop",
      playerIndex,
      action: "raise",
      amountPaid: 300,
      potAfterAction,
      isAllIn: true
    };
  }

  const cases = [
    ["OOP_ROOT", OOP, [], "OOP_ROOT"],
    ["IP_AFTER_CHECK", IP, [check(OOP)], "IP_AFTER_CHECK"],
    ["IP_VS_OOP_B33", IP, [bet(OOP, 33)], "IP_VS_OOP_B33"],
    ["IP_VS_OOP_B75", IP, [bet(OOP, 75)], "IP_VS_OOP_B75"],
    ["IP_VS_OOP_JAM", IP, [{
      street: "flop", playerIndex: OOP, action: "bet",
      amountPaid: 300, potAfterAction: 400, isAllIn: true
    }], "IP_VS_OOP_JAM"],
    ["OOP_VS_IP_B33", OOP, [check(OOP), bet(IP, 33)], "OOP_VS_IP_B33"],
    ["OOP_VS_IP_B75", OOP, [check(OOP), bet(IP, 75)], "OOP_VS_IP_B75"],
    ["OOP_VS_IP_JAM", OOP, [check(OOP), {
      street: "flop", playerIndex: IP, action: "bet",
      amountPaid: 300, potAfterAction: 400, isAllIn: true
    }], "OOP_VS_IP_JAM"],
    ["OOP_VS_IP_JAM_AFTER_B33", OOP, [bet(OOP, 33), jamRaise(IP)], "OOP_VS_IP_JAM_AFTER_B33"],
    ["OOP_VS_IP_JAM_AFTER_B75", OOP, [bet(OOP, 75), jamRaise(IP)], "OOP_VS_IP_JAM_AFTER_B75"],
    ["IP_VS_OOP_JAM_AFTER_B33", IP, [check(OOP), bet(IP, 33), jamRaise(OOP)], "IP_VS_OOP_JAM_AFTER_B33"],
    ["IP_VS_OOP_JAM_AFTER_B75", IP, [check(OOP), bet(IP, 75), jamRaise(OOP)], "IP_VS_OOP_JAM_AFTER_B75"]
  ];

  const observed = {};

  for (const [name, index, history, expected] of cases) {
    handActionHistory = history;
    const actual = classifyFlopDepthCfrNode(index);
    observed[name] = actual;

    if (actual !== expected) {
      throw new Error(
        name + " mismatch: expected " + expected + ", got " + actual
      );
    }
  }

  // An off-tree half-pot bet should not be silently coerced.
  handActionHistory = [bet(OOP, 50)];
  const offTree = classifyFlopDepthCfrNode(IP);
  if (offTree !== null) {
    throw new Error("50% off-tree bet was misclassified as " + offTree);
  }

  const uniformWeights = initializeDefaultRange();

  const previousSelf = globalThis.self;
  let workerResult = null;

  globalThis.self = {
    postMessage(value) {
      workerResult = value;
    }
  };

  flopCfrWorkerBootstrap();

  globalThis.self.onmessage({
    data: {
      flop: board.map(cardToFlopCfrId),
      heroHole: players[OOP].hole.map(cardToFlopCfrId),
      potBB: 5,
      stackBB: 15,
      rootNode: "OOP_ROOT",
      initialState: {
        oopContribution: 0,
        ipContribution: 0
      },
      oopRangeWeights: uniformWeights,
      ipRangeWeights: uniformWeights,
      seed: 123456,
      timeLimitMs: 20,
      minIterations: 150,
      maxIterations: 300
    }
  });

  globalThis.self = previousSelf;

  if (!workerResult || workerResult.ok !== true) {
    throw new Error(
      "worker bootstrap failed: " +
      JSON.stringify(workerResult)
    );
  }

  if (workerResult.rootNode !== "OOP_ROOT") {
    throw new Error("worker returned wrong root node");
  }

  if (
    !Array.isArray(workerResult.actions) ||
    !Array.isArray(workerResult.probabilities) ||
    workerResult.actions.length !== 4 ||
    workerResult.probabilities.length !== 4
  ) {
    throw new Error("worker returned invalid strategy shape");
  }

  const sum = workerResult.probabilities.reduce(
    (a, b) => a + b,
    0
  );

  if (Math.abs(sum - 1) > 1e-9) {
    throw new Error("worker probabilities do not sum to one: " + sum);
  }

  for (const p of workerResult.probabilities) {
    if (!(p >= 0 && p <= 1)) {
      throw new Error("invalid worker probability: " + p);
    }
  }

  return {
    mapping: observed,
    offTree,
    worker: {
      rootNode: workerResult.rootNode,
      heroBucket: workerResult.heroBucket,
      heroBucketName: workerResult.heroBucketName,
      actions: workerResult.actions,
      probabilities: workerResult.probabilities,
      bucketVisits: workerResult.bucketVisits,
      iterations: workerResult.iterations,
      normalizedRegret: workerResult.normalizedRegret
    }
  };
})()
`;

const runner = new Function(
  "require",
  "process",
  script + "\n" + harness
);

const result = runner(require, process);

assert.ok(result.worker.iterations >= 150);
console.log(
  "FLOP_CFR_LIVE_ADAPTER_OK=" +
  JSON.stringify(result)
);
