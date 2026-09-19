"use strict";

const assert = require("assert");
const {
  BUCKET_NAMES,
  evaluateFiveIds,
  bestOfSevenIds,
  showdownShare,
  flopBucket,
  buildUniformRange
} = require("./holdem-postflop");
const {
  FLOP_TREE,
  FlopDepthLimitedCFR
} = require("./flop-depth-cfr");

function card(rank, suit) {
  return (rank - 2) * 4 + suit;
}

function sumObject(obj) {
  return Object.values(obj).reduce(
    (a, b) => a + b,
    0
  );
}

(function testEvaluator() {
  const royal = evaluateFiveIds([
    card(14, 0),
    card(13, 0),
    card(12, 0),
    card(11, 0),
    card(10, 0)
  ]);

  assert.strictEqual(royal.category, 8);

  const quads = bestOfSevenIds([
    card(9, 0),
    card(9, 1),
    card(9, 2),
    card(9, 3),
    card(14, 0),
    card(2, 1),
    card(3, 2)
  ]);

  assert.strictEqual(quads.category, 7);

  const tie = showdownShare(
    [card(14, 0), card(13, 1)],
    [card(14, 2), card(13, 3)],
    [
      card(12, 0),
      card(11, 1),
      card(10, 2),
      card(2, 0),
      card(3, 1)
    ]
  );

  assert.strictEqual(tie, 0.5);
})();

(function testBuckets() {
  const flop = [
    card(10, 0),
    card(7, 1),
    card(2, 2)
  ];

  assert.strictEqual(
    BUCKET_NAMES[
      flopBucket(
        [card(14, 0), card(14, 1)],
        flop
      )
    ],
    "overPair"
  );

  assert.strictEqual(
    BUCKET_NAMES[
      flopBucket(
        [card(10, 1), card(9, 1)],
        flop
      )
    ],
    "topPair"
  );

  const drawFlop = [
    card(9, 0),
    card(8, 0),
    card(2, 1)
  ];

  const drawName =
    BUCKET_NAMES[
      flopBucket(
        [card(7, 0), card(6, 2)],
        drawFlop
      )
    ];

  assert.ok(
    drawName === "openEnded" ||
    drawName === "comboDraw"
  );
})();

(function testTreeShape() {
  assert.deepStrictEqual(
    FLOP_TREE.OOP_ROOT.actions,
    ["check", "bet33", "bet75", "jam"]
  );

  assert.deepStrictEqual(
    FLOP_TREE.IP_VS_OOP_B33.actions,
    ["fold", "call", "jam"]
  );

  assert.deepStrictEqual(
    FLOP_TREE.IP_VS_OOP_JAM.actions,
    ["fold", "call"]
  );
})();

(function testRangePrivacyMetadata() {
  const flop = [
    card(14, 0),
    card(7, 1),
    card(2, 2)
  ];

  const solver = new FlopDepthLimitedCFR({
    flop,
    potBB: 4,
    stackBB: 16,
    oopRange: buildUniformRange(flop),
    ipRange: buildUniformRange(flop),
    seed: 11
  });

  const meta = solver.metadata();

  assert.ok(
    meta.hiddenCardPolicy.includes(
      "sample-from-range"
    )
  );

  assert.strictEqual(
    meta.leafModel.futureBettingSolved,
    false
  );
})();

(function testTrainingAndStrategyLegality() {
  const flop = [
    card(13, 0),
    card(8, 1),
    card(3, 2)
  ];

  const solver = new FlopDepthLimitedCFR({
    flop,
    potBB: 4,
    stackBB: 14,
    seed: 123
  });

  solver.train(30000);
  const r1 = solver.normalizedRegret();

  solver.train(90000);
  const r2 = solver.normalizedRegret();

  console.log(
    "normalized regret checkpoints:",
    { r1, r2 }
  );

  assert.ok(
    r2 < r1,
    `normalized regret did not fall: ${r1} -> ${r2}`
  );

  const profile = solver.averageProfile();

  for (const [nodeId, family] of solver.families.entries()) {
    const avg = profile[nodeId];

    for (let bucket = 0; bucket < BUCKET_NAMES.length; bucket++) {
      const offset = family.offset(bucket);
      let total = 0;

      for (let a = 0; a < family.actionCount; a++) {
        const p = avg[offset + a];
        assert.ok(
          p >= -1e-12 && p <= 1 + 1e-12,
          `invalid probability at ${nodeId}`
        );
        total += p;
      }

      assert.ok(
        Math.abs(total - 1) < 1e-9,
        `strategy does not sum to one at ${nodeId}/${bucket}: ${total}`
      );
    }
  }

  const air = solver.rootBucketStrategy(0);
  const overpair = solver.rootBucketStrategy(8);
  const rootFamily = solver.families.get("OOP_ROOT");
  const straightPlusVisits = rootFamily.visits[11];

  console.log("root air:", air);
  console.log("root overpair:", overpair);
  console.log("straightPlus visits:", straightPlusVisits);

  assert.ok(
    sumObject(air) > 0.999999
  );

  assert.ok(
    overpair.jam + overpair.bet75 >
      air.jam + air.bet75,
    "strong made hands should use large aggression more often than air on this dry flop"
  );

  assert.strictEqual(
    straightPlusVisits,
    0,
    "straight+ is unreachable on the K83 rainbow reference flop and must not be treated as a learned bucket"
  );
})();

console.log(
  "HU flop depth-limited CFR tests passed."
);
