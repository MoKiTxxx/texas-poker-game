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


## Live integration

The standalone HTML now keeps the two preflop CFR regimes separate:

- 5–10BB: existing push/fold CFR path (unchanged);
- 12–20BB: this midstack tree;
- uncovered histories or off-tree bet sizes: safe fallback to the existing v37 preflop policy.

The live midstack classifier only recognizes the trained public action sizes (2BB / 3BB / 6BB / shove). A v37-style 2.5x raise is deliberately treated as off-tree rather than silently mapped to a CFR node.

A synthetic live-history regression covers all ten public nodes:

- ROOT
- BB_LIMP
- SB_VS_LIMP_RAISE3
- BB_VS_LIMP_RESHOVE
- SB_VS_LIMP_SHOVE
- BB_MINRAISE
- SB_VS_3BET6
- BB_VS_3BET_RESHOVE
- SB_VS_MINRAISE_SHOVE
- BB_VS_SHOVE

The 12–20BB midstack feature flag is enabled by default on this feature branch after holdout validation. It remains isolated from `main`.

## 3M blueprint grid

The deterministic grid generator uses seed 1 and 3,000,000 sampled CFR iterations per stack.

| Stack | Fold | Limp | Min-raise | Shove | Abstract-game exploitability |
| --- | ---: | ---: | ---: | ---: | ---: |
| 12BB | 18.39% | 45.93% | 0.16% | 35.52% | 0.01155 |
| 15BB | 8.37% | 66.50% | 0.23% | 24.91% | 0.01462 |
| 18BB | 2.29% | 77.82% | 0.47% | 19.42% | 0.01760 |
| 20BB | 1.06% | 81.31% | 1.27% | 16.36% | 0.01941 |

The very low min-raise frequency is a learned result of this abstraction and continuation model; it is not manually forced upward.

## Simulator A/B validation

Final holdout used unseen seeds, full CFR policy (`mix=1.0`), duplicate hands, and the same postflop heuristic policy for OLD and NEW.

| Stack | Hands | NEW vs v37 |
| --- | ---: | ---: |
| 12BB | 2,000 | +15.675 bb/100 |
| 15BB | 2,000 | +26.950 bb/100 |
| 18BB | 2,000 | +41.125 bb/100 |
| 20BB | 2,000 | +42.175 bb/100 |

Pooled over 8,000 hands:

```
+31.4812 bb/100
95% duplicate-pair CI: [+26.3409, +36.6216]
```

This is evidence that the midstack CFR integration materially improves performance **against the existing v37 AI inside this simulator**. It is not a claim that the continuation abstraction solves real 12–20BB heads-up no-limit Hold'em.
