"use strict";

const fs = require("fs");
const path = require("path");
const { HeadsUpMidstackCFRPlus } = require("./hu-midstack-cfr");

const iterations = Number(process.argv[2] || 3000000);
const stacks = [12, 15, 18, 20];
const outputDir = path.join(__dirname, "blueprints");
const summary = {
  version: "hu-midstack-cfr-grid-v1",
  iterations,
  seed: 1,
  stacks: {}
};

fs.mkdirSync(outputDir, { recursive: true });

for (const stackBB of stacks) {
  const trainer = new HeadsUpMidstackCFRPlus({
    stackBB,
    seed: 1
  });

  const profile = trainer.train(iterations);
  const filePath = path.join(
    outputDir,
    `hu-midstack-${stackBB}bb.json`
  );

  const payload = trainer.writeBlueprint(filePath, profile);

  summary.stacks[String(stackBB)] = {
    file: path.basename(filePath),
    metrics: payload.metrics,
    continuationValue: payload.abstraction.continuationValue
  };

  console.log(
    `generated ${stackBB}BB: exploitability=` +
    payload.metrics.exploitability.toFixed(8) +
    " root=" +
    JSON.stringify(payload.metrics.rootActionFrequencies)
  );
}

fs.writeFileSync(
  path.join(outputDir, "hu-midstack-summary.json"),
  JSON.stringify(summary, null, 2) + "\n",
  "utf8"
);

console.log("midstack blueprint grid generated");
