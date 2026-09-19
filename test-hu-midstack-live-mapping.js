"use strict";

const fs = require("fs");

const HTML_FILE = "zhang_family_texas_holdem_formal_v3_shuffle_below_cards.html";

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

const html = fs.readFileSync(HTML_FILE, "utf8");
const start = html.indexOf("<script>") + "<script>".length;
const end = html.lastIndexOf("</script>");
if (start < "<script>".length || end <= start) {
  throw new Error("Cannot find game script");
}

const gameScript = html.slice(start, end);

const harness = String.raw`
return (() => {
  bigBlind = 20;
  smallBlind = 10;
  dealerIndex = 0;
  street = "preflop";

  players = [
    {
      name: "SB",
      chips: 300,
      folded: false,
      allIn: false,
      hole: [{rank:14,suit:"S"},{rank:13,suit:"H"}]
    },
    {
      name: "BB",
      chips: 300,
      folded: false,
      allIn: false,
      hole: [{rank:12,suit:"S"},{rank:11,suit:"H"}]
    }
  ];

  const SB = 0;
  const BB = 1;

  function call(playerIndex, amountPaid = 10) {
    return {
      street: "preflop",
      playerIndex,
      action: "call",
      amountPaid,
      isAllIn: false,
      forcedBlind: false
    };
  }

  function raise(playerIndex, multiple, allIn = false) {
    return {
      street: "preflop",
      playerIndex,
      action: "raise",
      amountPaid: 1,
      raiseTo: multiple * bigBlind,
      isAllIn: allIn,
      forcedBlind: false
    };
  }

  const cases = [
    {
      name: "ROOT",
      index: SB,
      history: [],
      expected: "ROOT"
    },
    {
      name: "BB_LIMP",
      index: BB,
      history: [call(SB)],
      expected: "BB_LIMP"
    },
    {
      name: "BB_VS_SHOVE",
      index: BB,
      history: [raise(SB, 15, true)],
      expected: "BB_VS_SHOVE"
    },
    {
      name: "BB_MINRAISE",
      index: BB,
      history: [raise(SB, 2, false)],
      expected: "BB_MINRAISE"
    },
    {
      name: "SB_VS_LIMP_RAISE3",
      index: SB,
      history: [call(SB), raise(BB, 3, false)],
      expected: "SB_VS_LIMP_RAISE3"
    },
    {
      name: "SB_VS_LIMP_SHOVE",
      index: SB,
      history: [call(SB), raise(BB, 15, true)],
      expected: "SB_VS_LIMP_SHOVE"
    },
    {
      name: "SB_VS_3BET6",
      index: SB,
      history: [raise(SB, 2, false), raise(BB, 6, false)],
      expected: "SB_VS_3BET6"
    },
    {
      name: "SB_VS_MINRAISE_SHOVE",
      index: SB,
      history: [raise(SB, 2, false), raise(BB, 15, true)],
      expected: "SB_VS_MINRAISE_SHOVE"
    },
    {
      name: "BB_VS_LIMP_RESHOVE",
      index: BB,
      history: [call(SB), raise(BB, 3, false), raise(SB, 15, true)],
      expected: "BB_VS_LIMP_RESHOVE"
    },
    {
      name: "BB_VS_3BET_RESHOVE",
      index: BB,
      history: [raise(SB, 2, false), raise(BB, 6, false), raise(SB, 15, true)],
      expected: "BB_VS_3BET_RESHOVE"
    }
  ];

  const observed = {};

  for (const test of cases) {
    handActionHistory = test.history;
    const actual = classifyHuMidstackCfrNode(test.index);
    observed[test.name] = actual;

    if (actual !== test.expected) {
      throw new Error(
        test.name + " classifier mismatch: expected " +
        test.expected + ", got " + actual
      );
    }
  }

  // Guard: a v37-ish 2.5x open must not be silently treated as CFR's 2x node.
  handActionHistory = [raise(SB, 2.5, false)];
  const mismatchedRaise = classifyHuMidstackCfrNode(BB);
  if (mismatchedRaise !== null) {
    throw new Error(
      "2.5x non-CFR raise was misclassified as " + mismatchedRaise
    );
  }

  // Ensure the embedded strategy has every public node used by the classifier.
  const requiredNodes = [...new Set(cases.map(x => x.expected))];
  for (const nodeId of requiredNodes) {
    if (!HU_MIDSTACK_CFR_NODE_ACTIONS[nodeId]) {
      throw new Error("Missing embedded actions for " + nodeId);
    }
    for (const stack of HU_MIDSTACK_CFR_STACKS) {
      const node = HU_MIDSTACK_CFR_BLUEPRINTS[String(stack)]?.[nodeId];
      if (!node || !node.AA || !Array.isArray(node.AA)) {
        throw new Error(
          "Missing embedded blueprint node " + nodeId + " at " + stack + "BB"
        );
      }
    }
  }

  return {
    cases: observed,
    nonCfrRaiseGuard: mismatchedRaise,
    stackGrid: HU_MIDSTACK_CFR_STACKS,
    nodeCount: Object.keys(HU_MIDSTACK_CFR_NODE_ACTIONS).length
  };
})()
`;

const runner = new Function("require", "process", gameScript + "\n" + harness);
const result = runner(require, process);

console.log("HU_MIDSTACK_LIVE_MAPPING_OK=" + JSON.stringify(result));
