const fs = require("fs");

const HTML_FILE = "zhang_family_texas_holdem_formal_v3_shuffle_below_cards.html";
const SEED = Number(process.env.BENCH_SEED || 101);
const HANDS = Number(process.env.BENCH_HANDS || 1000);
const MC_TRIALS = Number(process.env.BENCH_TRIALS || 60);
const CALIBRATION_ALPHA = Number(process.env.BENCH_ALPHA || 1);
const START_CHIPS = 2000;
const BIG_BLIND = 20;

class FakeClassList {
    add() {}
    remove() {}
    toggle() { return false; }
    contains() { return false; }
}

class FakeElement {
    constructor() {
        this.style = { setProperty() {} };
        this.classList = new FakeClassList();
        this.innerHTML = "";
        this.textContent = "";
        this.value = "";
        this.children = [];
        this.className = "";
    }
    appendChild(x) { this.children.push(x); return x; }
    addEventListener() {}
    closest() { return null; }
}

const elements = new Map();
globalThis.document = {
    documentElement: { style: { setProperty() {} } },
    getElementById(id) {
        if (!elements.has(id)) elements.set(id, new FakeElement());
        return elements.get(id);
    },
    createElement() { return new FakeElement(); },
    addEventListener() {}
};
globalThis.window = {
    innerWidth: 1500,
    innerHeight: 900,
    addEventListener() {},
    onload: null
};
globalThis.location = { reload() {} };
globalThis.alert = () => {};
globalThis.prompt = () => null;

const html = fs.readFileSync(HTML_FILE, "utf8");
const start = html.indexOf("<script>") + "<script>".length;
const end = html.lastIndexOf("</script>");
if (start < 8 || end <= start) throw new Error("Cannot find game script");
const gameScript = html.slice(start, end);

const harness = String.raw`
return (async () => {
    const START = ${START_CHIPS};
    const TRIALS = ${MC_TRIALS};
    const HANDS_TO_RUN = ${HANDS};
    const INITIAL_SEED = ${SEED};
    const ALPHA = ${CALIBRATION_ALPHA};

    let seed = INITIAL_SEED >>> 0;
    Math.random = function() {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 4294967296;
    };

    render = function() {};
    renderDebugPanel = function() {};
    updateAiDebugInfo = function(index) { delete pendingAiDebugInfo[index]; };
    log = function() {};
    startTurnWatchdog = function() {};
    clearTurnWatchdog = function() {};

    startOpeningShuffleAndDealAnimation = function(dealOrder, onDone) {
        deckShuffleAnimationInProgress = false;
        holeDealAnimationInProgress = false;
        visualHoleCardCounts = {};
        lastDealtSeatIndex = null;

        for (let r = 0; r < 2; r++) {
            for (const idx of dealOrder) {
                const p = players[idx];
                if (p && p.chips > 0 && p.hole.length < 2) {
                    p.hole.push(deck.pop());
                }
            }
        }

        if (typeof onDone === "function") onDone();
    };

    revealCommunityCardsTo = function(targetCount, onDone) {
        visibleBoardCount = Math.max(0, Math.min(5, targetCount, board.length));
        communityRevealInProgress = false;
        lastCommunityRevealIndex = -1;
        if (typeof onDone === "function") onDone();
    };

    updateBlindByRemainingPlayers = function() {
        smallBlind = 10;
        bigBlind = 20;
        minRaise = 20;
        lastBlindSmallBlind = 10;
        lastBlindBigBlind = 20;
        return false;
    };

    checkTournamentGameOver = function() { return false; };

    function buildWeightedPool(rangeWeights, deckContext) {
        const pool = [];
        let totalWeight = 0;

        for (let i = 0; i < deckContext.length; i++) {
            for (let j = i + 1; j < deckContext.length; j++) {
                const c1 = deckContext[i];
                const c2 = deckContext[j];
                const notation = getHandNotation(c1, c2);
                const weight = rangeWeights && rangeWeights[notation] ? rangeWeights[notation] : 0;

                if (weight > 0) {
                    totalWeight += weight;
                    pool.push({ c1, c2, cumulativeWeight: totalWeight });
                }
            }
        }

        return { pool, totalWeight };
    }

    function sampleWeighted(poolObject, usedCards) {
        if (!poolObject || poolObject.totalWeight <= 0 || poolObject.pool.length === 0) return null;

        for (let retry = 0; retry < 20; retry++) {
            const target = Math.random() * poolObject.totalWeight;
            let selected = poolObject.pool[poolObject.pool.length - 1];

            for (const item of poolObject.pool) {
                if (target <= item.cumulativeWeight) {
                    selected = item;
                    break;
                }
            }

            const k1 = cardKey(selected.c1);
            const k2 = cardKey(selected.c2);

            if (!usedCards.has(k1) && !usedCards.has(k2)) {
                usedCards.add(k1);
                usedCards.add(k2);
                return [selected.c1, selected.c2];
            }
        }

        return null;
    }

    function monteCarloEquity(index, trials) {
        const hero = players[index];
        const opponents = players
            .map((p, i) => ({ p, i }))
            .filter(x => x.i !== index && x.p && !x.p.folded && x.p.hole && x.p.hole.length === 2);

        if (!opponents.length) return estimateHeuristicPostflopEquity(index);

        const deckContext = getUnknownDeckForGto(hero);
        const pools = opponents.map(x => {
            let range = {};
            try { range = estimateOpponentRange(x.i); } catch (err) {}
            return buildWeightedPool(range, deckContext);
        });

        let equityShareTotal = 0;

        for (let t = 0; t < trials; t++) {
            const trialDeck = deckContext.slice();
            shuffle(trialDeck);

            const usedCards = new Set();
            const opponentHands = [];

            for (let oi = 0; oi < opponents.length; oi++) {
                let hand = sampleWeighted(pools[oi], usedCards);

                if (!hand) {
                    hand = [];
                    while (hand.length < 2 && trialDeck.length > 0) {
                        const c = trialDeck.pop();
                        const k = cardKey(c);
                        if (!usedCards.has(k)) {
                            usedCards.add(k);
                            hand.push(c);
                        }
                    }
                }

                if (hand.length === 2) opponentHands.push(hand);
            }

            const runout = board.slice();

            while (runout.length < 5 && trialDeck.length > 0) {
                const c = trialDeck.pop();
                const k = cardKey(c);

                if (!usedCards.has(k)) {
                    usedCards.add(k);
                    runout.push(c);
                }
            }

            const heroHand = bestOfSeven(hero.hole.concat(runout));
            const opponentResults = opponentHands.map(h => bestOfSeven(h.concat(runout)));
            let bestOpponent = null;

            for (const result of opponentResults) {
                if (bestOpponent === null || compareHands(result, bestOpponent) > 0) {
                    bestOpponent = result;
                }
            }

            if (bestOpponent === null) {
                equityShareTotal += 1;
            } else {
                const cmp = compareHands(heroHand, bestOpponent);

                if (cmp > 0) {
                    equityShareTotal += 1;
                } else if (cmp === 0) {
                    const tiedOpponents = opponentResults.filter(
                        result => compareHands(result, heroHand) === 0
                    ).length;
                    equityShareTotal += 1 / Math.max(1, tiedOpponents + 1);
                }
            }
        }

        return equityShareTotal / trials;
    }

    const actionCounts = {
        old: { preflop: 0, postflop: 0, fold: 0, call: 0, check: 0, bet: 0, raise: 0 },
        new: { preflop: 0, postflop: 0, fold: 0, call: 0, check: 0, bet: 0, raise: 0 }
    };

    const originalRecordAction = recordAction;
    recordAction = function(index, actionType, amountPaid, extra) {
        const p = players[index];
        if (p && p.benchmarkPolicy && actionCounts[p.benchmarkPolicy]) {
            const c = actionCounts[p.benchmarkPolicy];
            if (street === "preflop") c.preflop++;
            else c.postflop++;
            if (Object.prototype.hasOwnProperty.call(c, actionType)) c[actionType]++;
        }
        return originalRecordAction(index, actionType, amountPaid, extra);
    };

    function scheduleNext(index) {
        actionIndex = nextPlayableIndex(index);
        Promise.resolve().then(proceedTurn);
    }

    let monteCarloDecisionCount = 0;

    performGTODecision = function(index) {
        const p = players[index];

        if (!p || !canAct(p)) {
            scheduleNext(index >= 0 ? index : dealerIndex);
            return;
        }

        if (street === "preflop") {
            executePreflopAction(index);
            scheduleNext(index);
            return;
        }

        const toCall = Math.max(0, currentBet - p.currentBet);

        pendingAiDebugInfo[index] = {
            aiName: p.name,
            street,
            toCall,
            opponentRanges: getSafeOpponentRangeDebug(index)
        };

        const heuristicEquity = estimateHeuristicPostflopEquity(index);
        const monteCarlo = monteCarloEquity(index, TRIALS);
        const equity = heuristicEquity + ALPHA * (monteCarlo - heuristicEquity);
        monteCarloDecisionCount++;

        if (p.benchmarkPolicy === "new") {
            executeRangeAwareGTOAction(index, equity, monteCarlo, toCall);
        } else {
            executeGTOAction(index, equity, toCall);
        }
        scheduleNext(index);
    };

    let handResolve = null;

    showHandEndSequence = function() {
        if (handResolve) {
            const resolve = handResolve;
            handResolve = null;
            resolve();
        }
    };

    players = [
        createPlayer("OLD", false, START, "gto", aiProfiles.TAG),
        createPlayer("NEW", false, START, "gto", aiProfiles.TAG)
    ];

    players[0].benchmarkPolicy = "old";
    players[1].benchmarkPolicy = "new";

    initialChips = START;
    autoPlayMode = true;
    isAssigningSeats = false;
    tournamentGameOver = false;
    dealerIndex = 0;
    handNumber = 0;
    globalActionHistory = [];
    handActionHistory = [];

    const newProfitBB = [];
    let oldPositiveHands = 0;
    let newPositiveHands = 0;
    let splitHands = 0;
    let showdownHands = 0;
    let foldResolvedHands = 0;

    const startedAt = Date.now();

    for (let h = 0; h < HANDS_TO_RUN; h++) {
        for (const p of players) {
            p.chips = START;
            p.folded = false;
            p.allIn = false;
            p.currentBet = 0;
            p.totalBet = 0;
            p.acted = false;
            p.lastAction = "";
            p.revealed = false;
            p.showdownResult = null;
            p.eliminatedLogged = false;
        }

        handInProgress = false;
        waitingForHuman = false;
        tournamentGameOver = false;
        pot = 0;
        board = [];
        visibleBoardCount = 0;
        street = "preflop";
        currentBet = 0;
        minRaise = 20;
        lastFullRaiseTo = 0;

        await new Promise(resolve => {
            handResolve = resolve;
            startNewHand();
        });

        const oldProfit = players[0].chips - START;
        const newProfit = players[1].chips - START;

        if (Math.abs(oldProfit + newProfit) > 0.0001) {
            throw new Error("Chip conservation failed on hand " + handNumber + ": " + oldProfit + " + " + newProfit);
        }

        newProfitBB.push(newProfit / 20);

        if (newProfit > 0) newPositiveHands++;
        else if (oldProfit > 0) oldPositiveHands++;
        else splitHands++;

        if (players.some(p => p.showdownResult)) showdownHands++;
        else foldResolvedHands++;
    }

    const elapsedMs = Date.now() - startedAt;
    const n = newProfitBB.length;
    const mean = newProfitBB.reduce((a, b) => a + b, 0) / Math.max(1, n);
    const variance = n > 1
        ? newProfitBB.reduce((sum, x) => sum + Math.pow(x - mean, 2), 0) / (n - 1)
        : 0;
    const sd = Math.sqrt(variance);
    const se = sd / Math.sqrt(Math.max(1, n));
    const newBb100 = mean * 100;
    const ci95 = 1.96 * se * 100;

    return {
        seed: INITIAL_SEED,
        hands: n,
        mcTrialsPerNewPostflopDecision: TRIALS,
        calibrationAlpha: ALPHA,
        monteCarloDecisionCount,
        newNetBB: Number(newProfitBB.reduce((a, b) => a + b, 0).toFixed(4)),
        oldNetBB: Number((-newProfitBB.reduce((a, b) => a + b, 0)).toFixed(4)),
        newBb100: Number(newBb100.toFixed(4)),
        oldBb100: Number((-newBb100).toFixed(4)),
        newBb100Ci95Low: Number((newBb100 - ci95).toFixed(4)),
        newBb100Ci95High: Number((newBb100 + ci95).toFixed(4)),
        perHandSdBB: Number(sd.toFixed(4)),
        newPositiveHands,
        oldPositiveHands,
        splitHands,
        showdownHands,
        foldResolvedHands,
        newPositiveHandRate: Number((newPositiveHands / n).toFixed(6)),
        showdownRate: Number((showdownHands / n).toFixed(6)),
        oldStats: players[0].stats,
        newStats: players[1].stats,
        actionCounts,
        postflopAggressionRatio: Number((
            (actionCounts.new.bet + actionCounts.new.raise) /
            Math.max(1, actionCounts.old.bet + actionCounts.old.raise)
        ).toFixed(6)),
        elapsedMs
    };
})()
`;

(async () => {
    const runner = new Function("require", "process", gameScript + "\n" + harness);
    const result = await runner(require, process);
    console.log("SESSION_RESULT=" + JSON.stringify(result));
})().catch(err => {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
});

// Trigger benchmark workflow after PR creation.
