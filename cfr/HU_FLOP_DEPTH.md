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

- `ENABLE_FLOP_DEPTH_CFR = false` by default;
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

Autoplay target:

```
timeLimitMs = 80
minIterations = 400
maxIterations = 6000
```

Interactive target:

```
timeLimitMs = 260
minIterations = 1200
maxIterations = 20000
```

A separate Node regression executes the exact worker bootstrap and validates all 12 supported public flop nodes, probability normalization, off-tree fallback, and a real solve payload.

The live flag must remain disabled until duplicate A/B holdout shows a reproducible advantage over the existing postflop policy.
