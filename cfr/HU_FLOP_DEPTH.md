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

- all-in leaves: sampled turn/river showdown utility;
- non-all-in call/check leaves: sampled turn/river **checkdown** utility.

Therefore:

```
futureBettingSolved = false
```

The checkdown leaf is intentionally simple and testable. A later
milestone can replace it with a learned counterfactual value function or
a deeper turn resolver without rewriting the flop CFR tree.

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
