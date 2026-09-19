"use strict";

const path = require("path");
const {
  HeadsUpMidstackCFRPlus
} = require("./hu-midstack-cfr");

const iterations = Number(process.argv[2] || 200000);
const stackBB = Number(process.argv[3] || 15);
const output =
  process.argv[4] ||
  path.join(
    __dirname,
    "blueprints",
    `hu-midstack-${stackBB}bb.json`
  );

const trainer = new HeadsUpMidstackCFRPlus({
  stackBB,
  seed: 1
});

const profile = trainer.train(iterations);
const payload = trainer.writeBlueprint(output, profile);

console.log(JSON.stringify({
  output,
  version: payload.version,
  iterations: payload.iterations,
  stackBB,
  metrics: payload.metrics,
  continuationValue: payload.abstraction.continuationValue
}, null, 2));
