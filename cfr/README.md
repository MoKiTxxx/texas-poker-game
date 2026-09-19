# CFR blueprint work

This directory is the first game-theoretic training layer for the poker AI.

## Milestone 1: Kuhn Poker CFR+

The first implementation deliberately uses Kuhn Poker rather than full no-limit Hold'em so the solver can be checked against a known equilibrium before it is connected to the existing v37 / Range-MC policy.

Implemented:

- alternating CFR+ regret updates;
- linear average-strategy weighting;
- exact expected-value evaluation;
- exact deterministic best-response enumeration;
- NashConv / exploitability measurement;
- regression tests against the known Kuhn value `-1/18`.

Run:

```bash
node cfr/kuhn-cfr.test.js
node cfr/kuhn-cfr.js 100000
```

A healthy 100k-iteration run should have value very close to `-1/18` and exploitability around `1e-4` or below.

## Next milestones

1. Add a small reusable extensive-form-game interface around the trainer.
2. Implement a heads-up preflop abstraction with discrete actions.
3. Train a mixed-strategy blueprint and export it as JSON.
4. Blend the blueprint into the current AI behind a feature flag.
5. A/B test blueprint mixtures before allowing any CFR policy to replace v37 rules.
