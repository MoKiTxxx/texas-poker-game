const fs = require("fs");

const HTML_FILE = "zhang_family_texas_holdem_formal_v3_shuffle_below_cards.html";
const BASE_SEED = Number(process.env.BENCH_SEED || 424242);
const PAIRS = Number(process.env.BENCH_PAIRS || 300);
const MC_TRIALS = Number(process.env.BENCH_TRIALS || 60);
const START_CHIPS = 2000;
const BIG_BLIND = 20;

class FakeClassList {
  add(){} remove(){} toggle(){return false;} contains(){return false;}
}
class FakeElement {
  constructor() {
    this.style = { setProperty(){} };
    this.classList = new FakeClassList();
    this.innerHTML = "";
    this.textContent = "";
    this.value = "";
    this.children = [];
  }
  appendChild(x){ this.children.push(x); return x; }
  addEventListener(){}
  closest(){ return null; }
}
const elements = new Map();
globalThis.document = {
  documentElement:{style:{setProperty(){}}},
  getElementById(id){
    if(!elements.has(id)) elements.set(id,new FakeElement());
    return elements.get(id);
  },
  createElement(){ return new FakeElement(); },
  addEventListener(){}
};
globalThis.window = {innerWidth:1500,innerHeight:900,addEventListener(){},onload:null};
globalThis.location = {reload(){}};
globalThis.alert = ()=>{};
globalThis.prompt = ()=>null;

const html = fs.readFileSync(HTML_FILE,"utf8");
const scriptStart = html.indexOf("<script>") + 8;
const scriptEnd = html.lastIndexOf("</script>");
if(scriptStart < 8 || scriptEnd <= scriptStart) throw new Error("Game script not found");
const gameScript = html.slice(scriptStart,scriptEnd);

const harness = String.raw`
return (async()=>{
  const START = ${START_CHIPS};
  const PAIR_COUNT = ${PAIRS};
  const TRIALS = ${MC_TRIALS};
  const BASE = ${BASE_SEED};

  function makeRng(seed){
    let s = seed >>> 0;
    return function(){
      s = (Math.imul(s,1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  render = function(){};
  renderDebugPanel = function(){};
  updateAiDebugInfo = function(index){ delete pendingAiDebugInfo[index]; };
  log = function(){};
  startTurnWatchdog = function(){};
  clearTurnWatchdog = function(){};

  startOpeningShuffleAndDealAnimation = function(dealOrder,onDone){
    deckShuffleAnimationInProgress = false;
    holeDealAnimationInProgress = false;
    visualHoleCardCounts = {};
    lastDealtSeatIndex = null;
    for(let round=0; round<2; round++){
      for(const idx of dealOrder){
        const p = players[idx];
        if(p && p.chips>0 && p.hole.length<2) p.hole.push(deck.pop());
      }
    }
    if(typeof onDone === "function") onDone();
  };

  revealCommunityCardsTo = function(targetCount,onDone){
    visibleBoardCount = Math.max(0,Math.min(5,targetCount,board.length));
    communityRevealInProgress = false;
    lastCommunityRevealIndex = -1;
    if(typeof onDone === "function") onDone();
  };

  updateBlindByRemainingPlayers = function(){
    smallBlind = 10;
    bigBlind = 20;
    minRaise = 20;
    lastBlindSmallBlind = 10;
    lastBlindBigBlind = 20;
    return false;
  };

  checkTournamentGameOver = function(){ return false; };

  function shuffleWithRng(arr,rng){
    for(let i=arr.length-1;i>0;i--){
      const j = Math.floor(rng()*(i+1));
      [arr[i],arr[j]] = [arr[j],arr[i]];
    }
  }

  function buildWeightedPool(rangeWeights,deckContext){
    const combos = [];
    let totalWeight = 0;
    for(let i=0;i<deckContext.length;i++){
      for(let j=i+1;j<deckContext.length;j++){
        const c1 = deckContext[i];
        const c2 = deckContext[j];
        const notation = getHandNotation(c1,c2);
        const weight = rangeWeights && rangeWeights[notation] ? rangeWeights[notation] : 0;
        if(weight>0){
          totalWeight += weight;
          combos.push({c1,c2,cumulativeWeight:totalWeight});
        }
      }
    }
    return {combos,totalWeight};
  }

  function sampleWeighted(pool,used,rng){
    if(!pool || pool.totalWeight<=0 || pool.combos.length===0) return null;
    for(let retry=0;retry<20;retry++){
      const target = rng()*pool.totalWeight;
      let selected = pool.combos[pool.combos.length-1];
      for(const item of pool.combos){
        if(target<=item.cumulativeWeight){ selected=item; break; }
      }
      const k1 = cardKey(selected.c1);
      const k2 = cardKey(selected.c2);
      if(!used.has(k1) && !used.has(k2)){
        used.add(k1); used.add(k2);
        return [selected.c1,selected.c2];
      }
    }
    return null;
  }

  function monteCarloEquity(index,trials,rng){
    const hero = players[index];
    const opponents = players
      .map((p,i)=>({p,i}))
      .filter(x=>x.i!==index && x.p && !x.p.folded && x.p.hole && x.p.hole.length===2);

    if(!opponents.length) return estimateHeuristicPostflopEquity(index);

    const deckContext = getUnknownDeckForGto(hero);
    const pools = opponents.map(x=>{
      let range = {};
      try { range = estimateOpponentRange(x.i); } catch(err) {}
      return buildWeightedPool(range,deckContext);
    });

    let equityShareTotal = 0;

    for(let t=0;t<trials;t++){
      const trialDeck = deckContext.slice();
      shuffleWithRng(trialDeck,rng);
      const used = new Set();
      const opponentHands = [];

      for(let oi=0;oi<opponents.length;oi++){
        let hand = sampleWeighted(pools[oi],used,rng);
        if(!hand){
          hand = [];
          while(hand.length<2 && trialDeck.length){
            const c = trialDeck.pop();
            const k = cardKey(c);
            if(!used.has(k)){ used.add(k); hand.push(c); }
          }
        }
        if(hand.length===2) opponentHands.push(hand);
      }

      const runout = board.slice();
      while(runout.length<5 && trialDeck.length){
        const c = trialDeck.pop();
        const k = cardKey(c);
        if(!used.has(k)){ used.add(k); runout.push(c); }
      }

      const heroHand = bestOfSeven(hero.hole.concat(runout));
      const opponentResults = opponentHands.map(h=>bestOfSeven(h.concat(runout)));
      let bestOpponent = null;
      for(const oh of opponentResults){
        if(bestOpponent===null || compareHands(oh,bestOpponent)>0) bestOpponent = oh;
      }

      if(bestOpponent===null){
        equityShareTotal += 1;
      } else {
        const cmp = compareHands(heroHand,bestOpponent);
        if(cmp>0){
          equityShareTotal += 1;
        } else if(cmp===0){
          const tied = opponentResults.filter(oh=>compareHands(oh,heroHand)===0).length;
          equityShareTotal += 1/Math.max(1,tied+1);
        }
      }
    }
    return equityShareTotal/trials;
  }

  const actionCounts = {
    old:{preflop:0,postflop:0,fold:0,call:0,check:0,bet:0,raise:0},
    new:{preflop:0,postflop:0,fold:0,call:0,check:0,bet:0,raise:0}
  };

  const originalRecordAction = recordAction;
  recordAction = function(index,actionType,amountPaid,extra){
    const p = players[index];
    if(p && p.benchmarkPolicy && actionCounts[p.benchmarkPolicy]){
      const bucket = actionCounts[p.benchmarkPolicy];
      if(street==="preflop") bucket.preflop++; else bucket.postflop++;
      if(Object.prototype.hasOwnProperty.call(bucket,actionType)) bucket[actionType]++;
    }
    return originalRecordAction(index,actionType,amountPaid,extra);
  };

  let policyRng = {old:makeRng(1),new:makeRng(1)};
  let mcRng = makeRng(2);

  function scheduleNext(index){
    actionIndex = nextPlayableIndex(index);
    Promise.resolve().then(proceedTurn);
  }

  performGTODecision = function(index){
    const p = players[index];
    if(!p || !canAct(p)){ scheduleNext(index); return; }

    const savedRandom = Math.random;
    Math.random = policyRng[p.benchmarkPolicy];

    try {
      if(street==="preflop"){
        executePreflopAction(index);
      } else {
        const toCall = Math.max(0,currentBet-p.currentBet);
        pendingAiDebugInfo[index] = {
          aiName:p.name,
          street,
          toCall,
          opponentRanges:getSafeOpponentRangeDebug(index)
        };
        const heuristic = estimateHeuristicPostflopEquity(index);
        const rawMc = monteCarloEquity(index,TRIALS,mcRng);
        const strategyEquity = heuristic + RANGE_MC_STRATEGY_ALPHA*(rawMc-heuristic);

        if(p.benchmarkPolicy==="new"){
          executeRangeAwareGTOAction(index,strategyEquity,rawMc,toCall);
        } else {
          executeGTOAction(index,strategyEquity,toCall);
        }
      }
    } finally {
      Math.random = savedRandom;
    }
    scheduleNext(index);
  };

  let resolveHand = null;
  showHandEndSequence = function(){
    if(resolveHand){
      const resolve = resolveHand;
      resolveHand = null;
      resolve();
    }
  };

  async function runOneHand(swapped,pairSeed){
    const dealRng = makeRng(pairSeed);
    const policySeed = (pairSeed ^ 0x9e3779b9) >>> 0;

    policyRng = {
      old:makeRng(policySeed),
      new:makeRng(policySeed)
    };
    mcRng = makeRng((pairSeed ^ 0xa5a5a5a5) >>> 0);
    Math.random = dealRng;

    players = [
      createPlayer(swapped ? "NEW" : "OLD",false,START,"gto",aiProfiles.TAG),
      createPlayer(swapped ? "OLD" : "NEW",false,START,"gto",aiProfiles.TAG)
    ];
    players[0].benchmarkPolicy = swapped ? "new" : "old";
    players[1].benchmarkPolicy = swapped ? "old" : "new";

    initialChips = START;
    autoPlayMode = true;
    isAssigningSeats = false;
    tournamentGameOver = false;
    dealerIndex = 0;
    handNumber = 0;
    globalActionHistory = [];
    handActionHistory = [];
    board = [];
    pot = 0;
    visibleBoardCount = 0;
    street = "preflop";
    currentBet = 0;
    minRaise = 20;
    lastFullRaiseTo = 0;
    handInProgress = false;
    waitingForHuman = false;

    await new Promise(resolve=>{
      resolveHand = resolve;
      startNewHand();
    });

    const newIndex = players.findIndex(p=>p.benchmarkPolicy==="new");
    const oldIndex = players.findIndex(p=>p.benchmarkPolicy==="old");
    const newProfit = players[newIndex].chips - START;
    const oldProfit = players[oldIndex].chips - START;

    if(Math.abs(newProfit+oldProfit)>0.0001){
      throw new Error("Chip conservation failed: "+newProfit+" + "+oldProfit);
    }

    return newProfit/20;
  }

  const pairedResults = [];
  let positivePairs=0,negativePairs=0,splitPairs=0;
  const startedAt = Date.now();

  for(let pair=0;pair<PAIR_COUNT;pair++){
    const pairSeed = (BASE + Math.imul(pair+1,2654435761)) >>> 0;
    const first = await runOneHand(false,pairSeed);
    const second = await runOneHand(true,pairSeed);
    const paired = (first+second)/2;
    pairedResults.push(paired);
    if(paired>0) positivePairs++;
    else if(paired<0) negativePairs++;
    else splitPairs++;
  }

  const n = pairedResults.length;
  const mean = pairedResults.reduce((a,b)=>a+b,0)/Math.max(1,n);
  const variance = n>1
    ? pairedResults.reduce((s,x)=>s+Math.pow(x-mean,2),0)/(n-1)
    : 0;
  const sd = Math.sqrt(variance);
  const se = sd/Math.sqrt(Math.max(1,n));
  const bb100 = mean*100;
  const ci = 1.96*se*100;

  return {
    seed:BASE,
    pairs:n,
    hands:n*2,
    trialsPerPostflopDecision:TRIALS,
    newBb100:Number(bb100.toFixed(4)),
    ci95Low:Number((bb100-ci).toFixed(4)),
    ci95High:Number((bb100+ci).toFixed(4)),
    pairSdBB:Number(sd.toFixed(4)),
    positivePairs,
    negativePairs,
    splitPairs,
    actionCounts,
    postflopAggressionRatio:Number((
      (actionCounts.new.bet+actionCounts.new.raise)/
      Math.max(1,actionCounts.old.bet+actionCounts.old.raise)
    ).toFixed(6)),
    elapsedMs:Date.now()-startedAt
  };
})()
`;

(async()=>{
  const runner = new Function("require","process",gameScript+"\n"+harness);
  const result = await runner(require,process);
  console.log("DUPLICATE_RESULT="+JSON.stringify(result));
})().catch(err=>{
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
