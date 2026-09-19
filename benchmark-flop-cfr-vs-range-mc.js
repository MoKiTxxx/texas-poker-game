const fs = require("fs");
const { FlopDepthLimitedCFR } = require("./cfr/flop-depth-cfr");
const { flopBucket } = require("./cfr/holdem-postflop");

const HTML_FILE = "zhang_family_texas_holdem_formal_v3_shuffle_below_cards.html";
const STACK_BB = Number(process.env.BENCH_STACK_BB || 18);
const PAIRS = Number(process.env.BENCH_PAIRS || 200);
const CFR_ITERATIONS = Number(process.env.BENCH_CFR_ITERATIONS || 600);
const MC_TRIALS = Number(process.env.BENCH_MC_TRIALS || 60);
const BASE_SEED = Number(process.env.BENCH_SEED || 930001);
const BIG_BLIND = 20;
const SMALL_BLIND = 10;
const START_CHIPS = Math.round(STACK_BB * BIG_BLIND);

class FakeClassList {
  add(){} remove(){} toggle(){return false;} contains(){return false;}
}
class FakeElement {
  constructor(){
    this.style={setProperty(){}};
    this.classList=new FakeClassList();
    this.innerHTML="";
    this.textContent="";
    this.value="";
    this.children=[];
    this.className="";
  }
  appendChild(x){this.children.push(x);return x;}
  addEventListener(){}
  closest(){return null;}
}
const elements=new Map();
globalThis.document={
  documentElement:{style:{setProperty(){}}},
  getElementById(id){if(!elements.has(id))elements.set(id,new FakeElement());return elements.get(id);},
  createElement(){return new FakeElement();},
  addEventListener(){}
};
globalThis.window={innerWidth:1500,innerHeight:900,addEventListener(){},onload:null};
globalThis.location={reload(){}};
globalThis.alert=()=>{};
globalThis.prompt=()=>null;

const html=fs.readFileSync(HTML_FILE,"utf8");
const start=html.indexOf("<script>")+"<script>".length;
const end=html.lastIndexOf("</script>");
if(start<8||end<=start)throw new Error("Cannot find game script");
const gameScript=html.slice(start,end);

const harness=String.raw`
return (async()=>{
  const STACK=${STACK_BB};
  const CFR_ITERATIONS_VALUE=${CFR_ITERATIONS};
  const MC_TRIALS_VALUE=${MC_TRIALS};
  const PAIR_COUNT=${PAIRS};
  const SEED=${BASE_SEED};
  const START=${START_CHIPS};
  const BB=${BIG_BLIND};

  function makeRng(seed){
    let s=seed>>>0;
    return function(){
      s=(Math.imul(s,1664525)+1013904223)>>>0;
      return s/4294967296;
    };
  }

  render=()=>{};
  renderDebugPanel=()=>{};
  log=()=>{};
  startTurnWatchdog=()=>{};
  clearTurnWatchdog=()=>{};

  startOpeningShuffleAndDealAnimation=function(dealOrder,onDone){
    deckShuffleAnimationInProgress=false;
    holeDealAnimationInProgress=false;
    visualHoleCardCounts={};
    lastDealtSeatIndex=null;
    for(let round=0;round<2;round++){
      for(const idx of dealOrder){
        const p=players[idx];
        if(p&&p.chips>0&&p.hole.length<2)p.hole.push(deck.pop());
      }
    }
    if(typeof onDone==="function")onDone();
  };

  revealCommunityCardsTo=function(targetCount,onDone){
    visibleBoardCount=Math.max(0,Math.min(5,targetCount,board.length));
    communityRevealInProgress=false;
    lastCommunityRevealIndex=-1;
    if(typeof onDone==="function")onDone();
  };

  updateBlindByRemainingPlayers=function(){
    smallBlind=${SMALL_BLIND};
    bigBlind=${BIG_BLIND};
    minRaise=bigBlind;
    lastBlindSmallBlind=smallBlind;
    lastBlindBigBlind=bigBlind;
    return false;
  };

  checkTournamentGameOver=()=>false;


  function shuffleWithRng(arr,rng){
    for(let i=arr.length-1;i>0;i--){
      const j=Math.floor(rng()*(i+1));
      [arr[i],arr[j]]=[arr[j],arr[i]];
    }
  }

  function buildWeightedPool(rangeWeights,deckContext){
    const pool=[];
    let totalWeight=0;
    for(let i=0;i<deckContext.length;i++){
      for(let j=i+1;j<deckContext.length;j++){
        const c1=deckContext[i];
        const c2=deckContext[j];
        const notation=getHandNotation(c1,c2);
        const weight=rangeWeights&&rangeWeights[notation]?rangeWeights[notation]:0;
        if(weight>0){
          totalWeight+=weight;
          pool.push({c1,c2,cumulativeWeight:totalWeight});
        }
      }
    }
    return {pool,totalWeight};
  }

  function sampleWeighted(poolObject,usedCards,rng){
    if(!poolObject||poolObject.totalWeight<=0||poolObject.pool.length===0)return null;
    for(let retry=0;retry<20;retry++){
      const target=rng()*poolObject.totalWeight;
      let selected=poolObject.pool[poolObject.pool.length-1];
      for(const item of poolObject.pool){
        if(target<=item.cumulativeWeight){
          selected=item;
          break;
        }
      }
      const k1=cardKey(selected.c1);
      const k2=cardKey(selected.c2);
      if(!usedCards.has(k1)&&!usedCards.has(k2)){
        usedCards.add(k1);
        usedCards.add(k2);
        return [selected.c1,selected.c2];
      }
    }
    return null;
  }

  function monteCarloEquity(index,trials,rng){
    const hero=players[index];
    const opponents=players
      .map((p,i)=>({p,i}))
      .filter(x=>x.i!==index&&x.p&&!x.p.folded&&x.p.hole&&x.p.hole.length===2);

    if(!opponents.length)return estimateHeuristicPostflopEquity(index);

    const deckContext=getUnknownDeckForGto(hero);
    const pools=opponents.map(x=>{
      let range={};
      try{range=estimateOpponentRange(x.i);}catch(err){}
      return buildWeightedPool(range,deckContext);
    });

    let equityShareTotal=0;

    for(let t=0;t<trials;t++){
      const trialDeck=deckContext.slice();
      shuffleWithRng(trialDeck,rng);
      const usedCards=new Set();
      const opponentHands=[];

      for(let oi=0;oi<opponents.length;oi++){
        let hand=sampleWeighted(pools[oi],usedCards,rng);
        if(!hand){
          hand=[];
          while(hand.length<2&&trialDeck.length>0){
            const card=trialDeck.pop();
            const key=cardKey(card);
            if(!usedCards.has(key)){
              usedCards.add(key);
              hand.push(card);
            }
          }
        }
        if(hand.length===2)opponentHands.push(hand);
      }

      const runout=board.slice();
      while(runout.length<5&&trialDeck.length>0){
        const card=trialDeck.pop();
        const key=cardKey(card);
        if(!usedCards.has(key)){
          usedCards.add(key);
          runout.push(card);
        }
      }

      const heroHand=bestOfSeven(hero.hole.concat(runout));
      const opponentResults=opponentHands.map(h=>bestOfSeven(h.concat(runout)));
      let bestOpponent=null;

      for(const result of opponentResults){
        if(bestOpponent===null||compareHands(result,bestOpponent)>0){
          bestOpponent=result;
        }
      }

      if(bestOpponent===null){
        equityShareTotal+=1;
      }else{
        const cmp=compareHands(heroHand,bestOpponent);
        if(cmp>0){
          equityShareTotal+=1;
        }else if(cmp===0){
          const tied=opponentResults.filter(result=>compareHands(result,heroHand)===0).length;
          equityShareTotal+=1/Math.max(1,tied+1);
        }
      }
    }

    return equityShareTotal/trials;
  }

  const mcUsage={old:0,new:0};

  const actionCounts={
    old:{preflop:0,postflop:0,fold:0,call:0,check:0,bet:0,raise:0},
    new:{preflop:0,postflop:0,fold:0,call:0,check:0,bet:0,raise:0}
  };

  const cfrUsage={attempts:0,handled:0,fallback:0,insufficientVisits:0,nodes:{},actions:{},totalIterations:0,totalBucketVisits:0};

  const originalRecordAction=recordAction;
  recordAction=function(index,actionType,amountPaid,extra){
    const p=players[index];
    if(p&&p.benchmarkPolicy&&actionCounts[p.benchmarkPolicy]){
      const bucket=actionCounts[p.benchmarkPolicy];
      if(street==="preflop")bucket.preflop++;else bucket.postflop++;
      if(Object.prototype.hasOwnProperty.call(bucket,actionType))bucket[actionType]++;
    }
    return originalRecordAction(index,actionType,amountPaid,extra);
  };


  let currentPairSeed=1;
  let solverDecisionCounter=0;

  function buildConcreteRange(weights){
    const range=[];
    for(const [notation,weightRaw] of Object.entries(weights||{})){
      const weight=Number(weightRaw);
      if(!Number.isFinite(weight)||weight<=0)continue;
      const combos=buildCombosForNotation(notation,board);
      for(const combo of combos){
        range.push({
          cards:combo.map(cardToFlopCfrId),
          weight
        });
      }
    }
    return range;
  }

  function resolveFlopCfrSync(index){
    cfrUsage.attempts++;

    if(street!=="flop"||board.length!==3){
      cfrUsage.fallback++;
      return {handled:false,reason:"not-flop"};
    }

    const nodeId=classifyFlopDepthCfrNode(index);
    if(!nodeId){
      cfrUsage.fallback++;
      return {handled:false,reason:"off-tree"};
    }

    const state=getFlopCfrState();
    if(!state||state.stackBB<=1||state.stackBB>FLOP_DEPTH_CFR_MAX_EFFECTIVE_STACK_BB){
      cfrUsage.fallback++;
      return {handled:false,reason:"stack-or-state"};
    }

    const oopRangeWeights=estimateOpponentRange(state.seats.oopIndex);
    const ipRangeWeights=estimateOpponentRange(state.seats.ipIndex);

    const seed=(
      currentPairSeed ^
      Math.imul(++solverDecisionCounter,0x9e3779b1)
    )>>>0;

    const solver=new FlopDepthLimitedCFR({
      flop:board.map(cardToFlopCfrId),
      potBB:state.potBB,
      stackBB:state.stackBB,
      rootNode:nodeId,
      initialState:state.initialState,
      oopRange:buildConcreteRange(oopRangeWeights),
      ipRange:buildConcreteRange(ipRangeWeights),
      seed
    });

    const profile=solver.train(CFR_ITERATIONS_VALUE);
    const heroBucket=flopBucket(
      players[index].hole.map(cardToFlopCfrId),
      board.map(cardToFlopCfrId)
    );

    const family=solver.families.get(nodeId);
    const visits=family.visits[heroBucket];

    if(visits<FLOP_DEPTH_CFR_MIN_BUCKET_VISITS){
      cfrUsage.insufficientVisits++;
      cfrUsage.fallback++;
      return {handled:false,reason:"insufficient-visits",nodeId,heroBucket,visits};
    }

    const strategy=solver.nodeBucketStrategy(nodeId,heroBucket,profile);
    const actions=Object.keys(strategy);
    const probabilities=actions.map(action=>strategy[action]);
    const sampled=sampleFlopCfrAction(actions,probabilities);

    cfrUsage.handled++;
    cfrUsage.totalIterations+=CFR_ITERATIONS_VALUE;
    cfrUsage.totalBucketVisits+=visits;
    cfrUsage.nodes[nodeId]=(cfrUsage.nodes[nodeId]||0)+1;
    cfrUsage.actions[sampled.action]=(cfrUsage.actions[sampled.action]||0)+1;

    return {
      handled:true,
      nodeId,
      action:sampled.action,
      visits
    };
  }

  let policyRng={old:makeRng(1),new:makeRng(1)};
  let mcRng={old:makeRng(2),new:makeRng(2)};

  function scheduleNext(index){
    actionIndex=nextPlayableIndex(index);
    Promise.resolve().then(proceedTurn);
  }


  performGTODecision=function(index){
    const p=players[index];
    if(!p||!canAct(p)){
      scheduleNext(index>=0?index:dealerIndex);
      return;
    }

    const saved=Math.random;
    Math.random=policyRng[p.benchmarkPolicy]||saved;

    try{
      if(street==="preflop"){
        executePreflopAction(index);
      }else{
        let usedCfr=false;

        if(street==="flop"&&p.benchmarkPolicy==="new"){
          const result=resolveFlopCfrSync(index);
          if(result.handled){
            usedCfr=executeFlopDepthCfrAction(index,result.action);
          }
        }

        if(!usedCfr){
          const toCall=Math.max(0,currentBet-p.currentBet);
          pendingAiDebugInfo[index]={
            aiName:p.name,
            street,
            toCall,
            opponentRanges:getSafeOpponentRangeDebug(index)
          };

          const heuristic=estimateHeuristicPostflopEquity(index);
          const mc=monteCarloEquity(
            index,
            MC_TRIALS_VALUE,
            mcRng[p.benchmarkPolicy]
          );
          const equity=
            heuristic+
            RANGE_MC_STRATEGY_ALPHA*(mc-heuristic);

          mcUsage[p.benchmarkPolicy]++;
          executeGTOAction(index,equity,toCall);
        }
      }
    }finally{
      Math.random=saved;
    }

    scheduleNext(index);
  };

  let resolveHand=null;
  showHandEndSequence=function(){
    if(resolveHand){
      const r=resolveHand;
      resolveHand=null;
      r();
    }
  };

  async function runHand(swapped,pairSeed){
    currentPairSeed=pairSeed;
    solverDecisionCounter=0;
    const dealRng=makeRng(pairSeed);
    const policySeed=(pairSeed^0x9e3779b9)>>>0;
    const mcSeed=(pairSeed^0xa5a5a5a5)>>>0;
    policyRng={old:makeRng(policySeed),new:makeRng(policySeed)};
    mcRng={old:makeRng(mcSeed),new:makeRng(mcSeed)};
    Math.random=dealRng;

    players=[
      createPlayer(swapped?"NEW":"OLD",false,START,"gto",aiProfiles.TAG),
      createPlayer(swapped?"OLD":"NEW",false,START,"gto",aiProfiles.TAG)
    ];
    players[0].benchmarkPolicy=swapped?"new":"old";
    players[1].benchmarkPolicy=swapped?"old":"new";
    for(const p of players){
      p.huPushFoldCfrMix=0;
      p.huMidstackCfrMix=1;
      p.flopDepthCfrMix=p.benchmarkPolicy==="new"?1:0;
    }

    initialChips=START;
    autoPlayMode=true;
    humanTestMode="none";
    isAssigningSeats=false;
    tournamentGameOver=false;
    // startNewHand() advances dealer once; set to seat 1 so seat 0 is SB/button.
    dealerIndex=1;
    handNumber=0;
    globalActionHistory=[];
    handActionHistory=[];
    board=[];
    pot=0;
    visibleBoardCount=0;
    street="preflop";
    currentBet=0;
    minRaise=BB;
    lastFullRaiseTo=BB;
    handInProgress=false;
    waitingForHuman=false;
    handEndPhase="none";

    await new Promise(resolve=>{
      resolveHand=resolve;
      startNewHand();
    });

    const ni=players.findIndex(p=>p.benchmarkPolicy==="new");
    const oi=players.findIndex(p=>p.benchmarkPolicy==="old");
    const newProfit=players[ni].chips-START;
    const oldProfit=players[oi].chips-START;

    if(Math.abs(newProfit+oldProfit)>1e-9){
      throw new Error("Chip conservation failed: "+newProfit+" + "+oldProfit);
    }

    return newProfit/BB;
  }

  const paired=[];
  let positive=0,negative=0,split=0;
  const started=Date.now();

  for(let k=0;k<PAIR_COUNT;k++){
    const pairSeed=(SEED+Math.imul(k+1,2654435761))>>>0;
    const first=await runHand(false,pairSeed);
    const second=await runHand(true,pairSeed);
    const x=(first+second)/2;
    paired.push(x);
    if(x>0)positive++;else if(x<0)negative++;else split++;
  }

  const n=paired.length;
  const mean=paired.reduce((a,b)=>a+b,0)/Math.max(1,n);
  const variance=n>1?paired.reduce((s,x)=>s+(x-mean)*(x-mean),0)/(n-1):0;
  const sd=Math.sqrt(variance);
  const se=sd/Math.sqrt(Math.max(1,n));
  const bb100=mean*100;
  const ci=1.96*se*100;

  return {
    stackBB:STACK,
    cfrIterations:CFR_ITERATIONS_VALUE,
    pairs:n,
    hands:n*2,
    newBb100:Number(bb100.toFixed(4)),
    ci95Low:Number((bb100-ci).toFixed(4)),
    ci95High:Number((bb100+ci).toFixed(4)),
    pairSdBB:Number(sd.toFixed(4)),
    positivePairs:positive,
    negativePairs:negative,
    splitPairs:split,
    cfrUsage,
    mcTrials:MC_TRIALS_VALUE,
    mcUsage,
    rangeMcAlpha:RANGE_MC_STRATEGY_ALPHA,
    actionCounts,
    elapsedMs:Date.now()-started
  };
})()
`;

(async()=>{
  const runner=new Function("require","process","FlopDepthLimitedCFR","flopBucket",gameScript+"\n"+harness);
  const result=await runner(require,process,FlopDepthLimitedCFR,flopBucket);
  console.log("FLOP_CFR_VS_RANGE_MC_RESULT="+JSON.stringify(result));
})().catch(err=>{
  console.error(err&&err.stack?err.stack:err);
  process.exit(1);
});
