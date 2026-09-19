# Heads-up preflop CFR abstraction

This is the second CFR milestone after the validated Kuhn Poker solver.

## Game

The current abstraction is a heads-up short-stack push/fold game:

- SB posts 0.5 BB.
- BB posts 1 BB.
- SB actions: fold / shove.
- BB response after a shove: fold / call.
- Private information: 169 standard Hold'em starting-hand classes.
- Chance model: exact blocker-aware weighting over all 1,624,350 ordered non-overlapping private deals (1326 × 1225).
- Default effective stack: 10 BB.

The solver uses alternating CFR+ with linear average-strategy weighting and reports exact best responses **inside this abstract game**.

## Important limitation

The default showdown equity oracle now uses a real-card 169×169 canonical preflop matrix.

Dataset provenance:

- source: `poker-yoga/poker-math`, `sims/data/preflop-equity.json`;
- method: stratified Monte Carlo, all-in preflop;
- 1,000,000 sampled boards per canonical class pair;
- fixed seed: 1;
- unit: `win + tie/2`;
- dataset license: CC0-1.0.

The matrix is stored as an upper triangle and expanded through the identity

```
E(A,B) + E(B,A) = 1
```

for the `win + tie/2` equity convention.

This is actual card-runout equity rather than a hand-ranking proxy. It is still a high-precision Monte Carlo dataset rather than exhaustive enumeration of every possible board, so the metadata is preserved and the code does not label it zero-error exact equity.

The old rank proxy remains available only for diagnostics/tests; it is no longer the solver default.

Private-hand chance is also no longer approximated as independent 169-class draws. Concrete 2-card combos are enumerated for each class, incompatible overlapping pairs are removed, and the solver uses exact conditional class distributions (P(H_{BB}\mid H_{SB})) and (P(H_{SB}\mid H_{BB})).

## Run

```bash
node cfr/hu-pushfold-cfr.test.js
node cfr/hu-pushfold-cfr.js 5000 10
node cfr/export-hu-pushfold-blueprint.js 5000 10
```

## Integration plan

1. Validate CFR convergence and stack-depth behavior.
2. Validate the real-equity blueprint against multiple stack depths and independent sanity checks.
3. Export 5BB / 8BB / 10BB / 12BB / 15BB blueprints.
4. Add a feature-flagged lookup to the existing heads-up short-stack preflop AI.
5. Blend CFR and v37 first; do not replace the current policy outright.
6. A/B test before any merge into the live strategy.
