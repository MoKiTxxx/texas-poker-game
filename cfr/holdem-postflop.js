"use strict";

const BUCKET_NAMES = [
  "air",
  "overcards",
  "gutshot",
  "openEnded",
  "flushDraw",
  "comboDraw",
  "weakPair",
  "topPair",
  "overPair",
  "twoPair",
  "trips",
  "straightPlus"
];

function cardRank(id) {
  return Math.floor(id / 4) + 2;
}

function cardSuit(id) {
  return id % 4;
}

function buildDeck() {
  return Array.from({ length: 52 }, (_, i) => i);
}

function compareHandValues(a, b) {
  if (a.category !== b.category) return a.category - b.category;

  const n = Math.max(a.tiebreak.length, b.tiebreak.length);
  for (let i = 0; i < n; i++) {
    const av = a.tiebreak[i] || 0;
    const bv = b.tiebreak[i] || 0;
    if (av !== bv) return av - bv;
  }

  return 0;
}

function straightHighFromRanks(ranks) {
  const unique = [...new Set(ranks)].sort((a, b) => b - a);
  if (unique.includes(14)) unique.push(1);

  for (let i = 0; i <= unique.length - 5; i++) {
    const window = unique.slice(i, i + 5);
    if (window[0] - window[4] === 4) return window[0];
  }

  return 0;
}

function evaluateFiveIds(ids) {
  if (!Array.isArray(ids) || ids.length !== 5) {
    throw new Error("evaluateFiveIds expects exactly five cards");
  }

  const ranks = ids.map(cardRank).sort((a, b) => b - a);
  const suits = ids.map(cardSuit);
  const counts = new Map();

  for (const rank of ranks) {
    counts.set(rank, (counts.get(rank) || 0) + 1);
  }

  const groups = [...counts.entries()]
    .map(([rank, count]) => ({ rank, count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return b.rank - a.rank;
    });

  const flush = suits.every(s => s === suits[0]);
  const straightHigh = straightHighFromRanks(ranks);

  if (flush && straightHigh) {
    return { category: 8, tiebreak: [straightHigh] };
  }

  if (groups[0].count === 4) {
    return {
      category: 7,
      tiebreak: [
        groups[0].rank,
        groups.find(g => g.count === 1).rank
      ]
    };
  }

  if (
    groups[0].count === 3 &&
    groups[1] &&
    groups[1].count === 2
  ) {
    return {
      category: 6,
      tiebreak: [groups[0].rank, groups[1].rank]
    };
  }

  if (flush) {
    return { category: 5, tiebreak: ranks.slice() };
  }

  if (straightHigh) {
    return { category: 4, tiebreak: [straightHigh] };
  }

  if (groups[0].count === 3) {
    const kickers = groups
      .filter(g => g.count === 1)
      .map(g => g.rank)
      .sort((a, b) => b - a);

    return {
      category: 3,
      tiebreak: [groups[0].rank, ...kickers]
    };
  }

  const pairs = groups
    .filter(g => g.count === 2)
    .map(g => g.rank)
    .sort((a, b) => b - a);

  if (pairs.length >= 2) {
    const kicker = groups
      .filter(g => g.count === 1)
      .map(g => g.rank)
      .sort((a, b) => b - a)[0];

    return {
      category: 2,
      tiebreak: [pairs[0], pairs[1], kicker]
    };
  }

  if (pairs.length === 1) {
    const kickers = groups
      .filter(g => g.count === 1)
      .map(g => g.rank)
      .sort((a, b) => b - a);

    return {
      category: 1,
      tiebreak: [pairs[0], ...kickers]
    };
  }

  return { category: 0, tiebreak: ranks.slice() };
}

function bestOfSevenIds(ids) {
  if (!Array.isArray(ids) || ids.length !== 7) {
    throw new Error("bestOfSevenIds expects exactly seven cards");
  }

  let best = null;

  for (let a = 0; a < 3; a++) {
    for (let b = a + 1; b < 4; b++) {
      for (let c = b + 1; c < 5; c++) {
        for (let d = c + 1; d < 6; d++) {
          for (let e = d + 1; e < 7; e++) {
            const value = evaluateFiveIds([
              ids[a], ids[b], ids[c], ids[d], ids[e]
            ]);

            if (
              best === null ||
              compareHandValues(value, best) > 0
            ) {
              best = value;
            }
          }
        }
      }
    }
  }

  return best;
}

function showdownShare(holeA, holeB, board5) {
  const a = bestOfSevenIds(holeA.concat(board5));
  const b = bestOfSevenIds(holeB.concat(board5));
  const cmp = compareHandValues(a, b);

  if (cmp > 0) return 1;
  if (cmp < 0) return 0;
  return 0.5;
}

function suitCounts(ids) {
  const counts = [0, 0, 0, 0];
  for (const id of ids) counts[cardSuit(id)]++;
  return counts;
}

function straightDrawInfo(ids) {
  const ranks = new Set(ids.map(cardRank));
  if (ranks.has(14)) ranks.add(1);

  let oneMissingWindows = 0;
  let interiorMissingWindows = 0;

  for (let low = 1; low <= 10; low++) {
    const needed = [
      low,
      low + 1,
      low + 2,
      low + 3,
      low + 4
    ];

    const present = needed.filter(r => ranks.has(r));

    if (present.length === 4) {
      oneMissingWindows++;
      const missing = needed.find(r => !ranks.has(r));
      if (missing !== low && missing !== low + 4) {
        interiorMissingWindows++;
      }
    }
  }

  return {
    openEnded: oneMissingWindows >= 2,
    gutshot:
      oneMissingWindows >= 1 &&
      oneMissingWindows < 2,
    interiorMissingWindows
  };
}

function flopBucket(hole, flop) {
  if (!Array.isArray(hole) || hole.length !== 2) {
    throw new Error("flopBucket expects two hole cards");
  }

  if (!Array.isArray(flop) || flop.length !== 3) {
    throw new Error("flopBucket expects three flop cards");
  }

  const five = hole.concat(flop);
  const made = evaluateFiveIds(five);
  const holeRanks = hole.map(cardRank);
  const boardRanks = flop.map(cardRank);
  const maxBoard = Math.max(...boardRanks);

  if (made.category >= 4) return 11;
  if (made.category === 3) return 10;
  if (made.category === 2) return 9;

  if (made.category === 1) {
    if (
      holeRanks[0] === holeRanks[1] &&
      !boardRanks.includes(holeRanks[0])
    ) {
      if (holeRanks[0] > maxBoard) return 8;
      return 6;
    }

    if (
      holeRanks.includes(maxBoard)
    ) {
      return 7;
    }

    return 6;
  }

  const suits = suitCounts(five);
  const flushDraw = suits.some(x => x === 4);
  const straight = straightDrawInfo(five);

  if (
    flushDraw &&
    (straight.openEnded || straight.gutshot)
  ) {
    return 5;
  }

  if (flushDraw) return 4;
  if (straight.openEnded) return 3;
  if (straight.gutshot) return 2;

  if (
    holeRanks[0] > maxBoard &&
    holeRanks[1] > maxBoard
  ) {
    return 1;
  }

  return 0;
}

function buildUniformRange(flop) {
  const blocked = new Set(flop);
  const cards = buildDeck().filter(c => !blocked.has(c));
  const range = [];

  for (let i = 0; i < cards.length - 1; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      range.push({
        cards: [cards[i], cards[j]],
        weight: 1
      });
    }
  }

  return range;
}

function normalizeRange(range, flop) {
  if (!Array.isArray(range) || range.length === 0) {
    return buildUniformRange(flop);
  }

  const blocked = new Set(flop);
  const out = [];

  for (const entry of range) {
    if (
      !entry ||
      !Array.isArray(entry.cards) ||
      entry.cards.length !== 2
    ) {
      continue;
    }

    const [a, b] = entry.cards;
    const weight = Number(entry.weight);

    if (
      a === b ||
      blocked.has(a) ||
      blocked.has(b) ||
      !Number.isFinite(weight) ||
      weight <= 0
    ) {
      continue;
    }

    out.push({
      cards: [a, b],
      weight
    });
  }

  if (out.length === 0) {
    throw new Error("range has no legal positive-weight combos");
  }

  return out;
}

class WeightedRangeSampler {
  constructor(range) {
    this.range = range;
    this.totalWeight = range.reduce(
      (sum, x) => sum + x.weight,
      0
    );
  }

  sample(rng, extraBlocked = null) {
    for (let attempt = 0; attempt < 64; attempt++) {
      let target = rng.next() * this.totalWeight;
      let chosen = this.range[this.range.length - 1];

      for (const entry of this.range) {
        target -= entry.weight;
        if (target <= 0) {
          chosen = entry;
          break;
        }
      }

      if (!extraBlocked) return chosen.cards.slice();

      const [a, b] = chosen.cards;
      if (
        !extraBlocked.has(a) &&
        !extraBlocked.has(b)
      ) {
        return chosen.cards.slice();
      }
    }

    const legal = this.range.filter(entry => {
      const [a, b] = entry.cards;
      return (
        !extraBlocked ||
        (
          !extraBlocked.has(a) &&
          !extraBlocked.has(b)
        )
      );
    });

    if (legal.length === 0) {
      throw new Error("no compatible private combo in range");
    }

    let total = legal.reduce((s, x) => s + x.weight, 0);
    let target = rng.next() * total;

    for (const entry of legal) {
      target -= entry.weight;
      if (target <= 0) return entry.cards.slice();
    }

    return legal[legal.length - 1].cards.slice();
  }
}

module.exports = {
  BUCKET_NAMES,
  cardRank,
  cardSuit,
  buildDeck,
  compareHandValues,
  evaluateFiveIds,
  bestOfSevenIds,
  showdownShare,
  flopBucket,
  buildUniformRange,
  normalizeRange,
  WeightedRangeSampler
};
