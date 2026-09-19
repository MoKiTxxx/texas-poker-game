# HU flop depth-limited CFR resolver

This is the first postflop re-solving prototype.

## Scope

The resolver solves one public flop betting round for heads-up play.

OOP root actions:

- check
- 33% pot
- 75% pot
- jam

After OOP checks, IP has the same four actions.

Facing a 33% or 75% bet, the responder can:

- fold
- call
- jam

Facing a jam, the responder can:

- fold
- call

A jam over a non-all-in bet gives the original bettor a final
fold/call decision.

## Private information

The solver never receives or conditions on the opponent's actual hidden
cards in live use.

Each player is represented by a weighted range of legal concrete
2-card combinations. Chance sampling draws one compatible private hand
for each player, but strategy information sets are keyed only by:

- public action history;
- that player's own 12-way flop bucket.

The current bucket abstraction is:

1. air
2. overcards
3. gutshot
4. open-ended draw
5. flush draw
6. combo draw
7. weak pair
8. top pair
9. overpair
10. two pair
11. trips
12. straight or better

## Depth limit / leaf model

This is **not** a full turn/river solver.

For each sampled CFR iteration, turn and river are sampled once and the
same runout is used across all action alternatives in that traversal.

- all-in flop leaves: sampled turn/river showdown utility;
- non-all-in flop leaves: enter a simplified **turn betting round**;
- turn OOP/IP actions: check / 50% pot / jam;
- facing a 50% turn bet: fold / call / jam;
- facing a turn jam: fold / call;
- non-all-in turn leaves: sampled river checkdown utility.

Therefore:

```
turnBettingSolved = true
riverBettingSolved = false
futureBettingSolved = false
```

This is still depth-limited: river betting is not solved. The first
flop-only checkdown version failed to beat v37 in a 6,000-hand holdout,
so the extra turn betting round was added specifically to improve the
continuation value seen by flop actions.

## Validation targets

The first milestone checks:

- real 5-card / 7-card evaluator correctness;
- deterministic flop bucket classification;
- legal strategy probabilities;
- normalized regret decreases with more training;
- strong made-hand buckets choose large aggressive sizes more often than
  air on a dry reference flop;
- metadata explicitly states that opponent hidden cards are sampled from
  range rather than observed.

No live AI policy is changed in this milestone.


## Live Web Worker adapter

The standalone HTML now contains a feature-flagged live adapter.

Current guardrails:

- `ENABLE_FLOP_DEPTH_CFR = true` after two positive unseen-seed holdouts;
- heads-up only;
- flop only;
- effective stack capped at 25BB;
- only public histories representable by the trained flop tree are resolved;
- approximate 33% / 75% observed bets are mapped into the action abstraction;
- other bet sizes are treated as off-tree and fall back to v37;
- a bucket needs at least 8 sampled visits before its CFR strategy is allowed to act;
- worker error, timeout, invalid output, or insufficient visits all fall back to the existing Range-MC / v37 decision path.

Live ranges are built from the existing public range model for **both** seats. The worker receives notation weights, not the opponent's real hole cards. The acting player's actual cards are sent only to identify that player's own flop information bucket.

The live worker now runs the same flop+turn depth resolver as the Node
research implementation.

The live worker returns:

- current public flop node;
- acting player's own bucket;
- mixed strategy;
- sampled bucket visits;
- CFR iterations;
- normalized regret;
- worker elapsed time.

The main thread samples the final action and applies it to the existing poker engine.

### Current live compute budget

Validated live target:

```
minIterations = 600
maxIterations = 600
```

The worker timeout remains as a safety guard, but strategy quality is aligned to the tested fixed 600-iteration budget.

A separate Node regression executes the exact worker bootstrap and validates all 12 supported public flop nodes, probability normalization, off-tree fallback, and a real solve payload.

The live flag must remain disabled until duplicate A/B holdout shows a reproducible advantage over the existing postflop policy.


## Validation history

### Flop-only leaf model

The first live version used flop CFR with turn+river checkdown leaves.

Unseen-seed duplicate holdout:

- 15BB: -0.8125 bb/100
- 18BB: -1.4050 bb/100
- 20BB: -2.9650 bb/100
- pooled 6,000 hands: -1.7275 bb/100
- pooled 95% duplicate-pair CI: [-7.1538, +3.6988]

Coverage was high, so the problem was not adapter fallback. The checkdown leaf was too crude.

### Flop + simplified turn betting

The resolver was then extended with a turn betting round:

- turn OOP/IP: check / 50% pot / jam
- facing 50%: fold / call / jam
- facing jam: fold / call
- river remains checkdown-only

First unseen-seed holdout at 600 CFR iterations per eligible flop decision:

- 15BB: +12.050 bb/100, CI [+4.500, +19.600]
- 18BB: +20.028 bb/100, CI [+10.403, +29.652]
- 20BB: +21.340 bb/100, CI [+11.489, +31.191]
- pooled 6,000 hands: +17.806 bb/100
- pooled 95% CI: [+12.570, +23.041]

### Iteration sensitivity

Tuning sweep across 12/15/18/20BB:

- 300 iterations: ~+18.21 bb/100 pooled
- 600 iterations: ~+18.75 bb/100 pooled
- 1,200 iterations: ~+15.85 bb/100 pooled

More CFR iterations did not monotonically improve live EV because the remaining river leaf abstraction is still approximate. The validated live budget is therefore fixed at 600 iterations.

### Second unseen-seed holdout

Using 600 iterations:

- 12BB: +6.775 bb/100, CI [+2.496, +11.054]
- 15BB: +17.010 bb/100, CI [+9.854, +24.166]
- 18BB: +14.623 bb/100, CI [+4.701, +24.544]
- 20BB: +20.608 bb/100, CI [+10.128, +31.087]

Pooled over 8,000 hands:

```
+14.7538 bb/100
95% duplicate-pair CI: [+10.5857, +18.9218]
```

This reproduced the positive result on a fully independent seed set.

## Current live status

The feature branch now uses:

```
ENABLE_FLOP_DEPTH_CFR = true
minIterations = 600
maxIterations = 600
```

Live guardrails remain:

- heads-up only;
- flop entry only;
- effective stack capped at 25BB;
- off-tree public histories fall back to Range-MC / v37;
- insufficient bucket visits fall back;
- worker timeout/error/invalid output falls back;
- opponent hidden cards are never supplied to the resolver;
- opponent range comes from the existing public range model.

The current evidence supports enabling the flop+turn resolver **inside this simulator**. It is still not a complete postflop HUNL solution because river betting remains depth-limited to checkdown.
