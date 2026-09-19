# Heads-up preflop CFR abstraction

This is the second CFR milestone after the validated Kuhn Poker solver.

## Game

The current abstraction is a heads-up short-stack push/fold game:

- SB posts 0.5 BB.
- BB posts 1 BB.
- SB actions: fold / shove.
- BB response after a shove: fold / call.
- Private information: 169 standard Hold'em starting-hand classes.
- Chance weights: 6 pair combos, 4 suited combos, 12 offsuit combos.
- Default effective stack: 10 BB.

The solver uses alternating CFR+ with linear average-strategy weighting and reports exact best responses **inside this abstract game**.

## Important limitation

The CFR layer is real, but the initial showdown equity oracle is intentionally a replaceable proxy based on the existing 169-hand ranking. It is symmetric and deterministic, which makes solver convergence testable, but it is **not** a claim of exact Hold'em preflop equity.

This separation is deliberate:

```
169 information sets
        |
      CFR+
        |
equity oracle interface
        |
  rank proxy today
  precomputed / Monte Carlo matrix next
```

The next equity upgrade can therefore replace the oracle without changing the CFR implementation.

## Run

```bash
node cfr/hu-pushfold-cfr.test.js
node cfr/hu-pushfold-cfr.js 5000 10
node cfr/export-hu-pushfold-blueprint.js 5000 10
```

## Integration plan

1. Validate CFR convergence and stack-depth behavior.
2. Replace the proxy oracle with a deterministic precomputed equity matrix.
3. Export 5BB / 8BB / 10BB / 12BB / 15BB blueprints.
4. Add a feature-flagged lookup to the existing heads-up short-stack preflop AI.
5. Blend CFR and v37 first; do not replace the current policy outright.
6. A/B test before any merge into the live strategy.
