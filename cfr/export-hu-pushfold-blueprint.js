"use strict";

const path = require("path");
const { HeadsUpPushFoldCFRPlus } = require("./hu-pushfold-cfr");

const iterations = Number(process.argv[2] || 5000);
const stackBB = Number(process.argv[3] || 10);
const output = process.argv[4] || path.join(__dirname, "output", `hu-pushfold-${stackBB}bb.json`);

const trainer = new HeadsUpPushFoldCFRPlus({ stackBB });
const profile = trainer.train(iterations);
const payload = trainer.writeBlueprint(output, profile);

console.log(JSON.stringify({
  output,
  version: payload.version,
  iterations: payload.iterations,
  metrics: payload.metrics
}, null, 2));
