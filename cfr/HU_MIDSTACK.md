# Heads-up 12–20BB midstack CFR

This solver is separate from the validated 5–10BB push/fold CFR.

## Public action tree

SB/button root:

- fold
- limp
- min-raise to 2BB
- shove

After a limp, BB can:

- check
- raise to 3BB
- shove

After the 3BB raise, SB can:

- fold
- call
- reshove

After a 2BB min-raise, BB can:

- fold
- call
- 3-bet to 6BB
- shove

After the 6BB 3-bet, SB can:

- fold
- call
- reshove

Any reshove gives the other player a final fold/call decision.

## Important limitation: postflop continuation leaves

All-in leaves use the real 169×169 preflop equity matrix.

Non-all-in calls/checks that reach the flop are **not** treated as exact
no-limit Hold'em solutions. They use an explicit continuation-value
abstraction:

- raw all-in equity is shrunk toward 50% at high SPR;
- realization approaches raw equity as SPR falls;
- the SB/button receives a small in-position postflop realization bonus.

The metadata is exported with every blueprint and contains
`exactPostflopSolver: false`.

This is intentionally a bridge between pure push/fold and a future
depth-limited postflop resolver. It must not be described as a solved
12–20BB HUNL game.

## Training

Training uses chance-sampled alternating CFR+ over real non-overlapping
private-card deals. Information sets remain the standard 169 preflop
hand classes with exact blocker-aware chance probabilities.

Run:

```bash
node cfr/hu-midstack-cfr.test.js
node cfr/hu-midstack-cfr.js 200000 15
node cfr/export-hu-midstack-blueprint.js 200000 15
```

Target blueprint grid:

- 12BB
- 15BB
- 18BB
- 20BB

The existing 5/8/10BB push/fold blueprints remain unchanged.
