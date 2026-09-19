const fs = require("fs");

const HTML_FILE = "zhang_family_texas_holdem_formal_v3_shuffle_below_cards.html";
const MIX = Number(process.env.BENCH_MIX || 1);
const STACK_BB = Number(process.env.BENCH_STACK_BB || 10);
const PAIRS = Number(process.env.BENCH_PAIRS || 100);
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
  const MIX_VALUE=${MIX};
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

  const actionCounts={
    old:{preflop:0,postflop:0,fold:0,call:0,check:0,bet:0,raise:0},
    new:{preflop:0,postflop:0,fold:0,call:0,check:0,bet:0,raise:0}
  };

  const cfrUsage={handled:0,sb:0,bb:0,shove:0,call:0,fold:0,fallback:0};

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

  const originalTryCfr=tryExecuteHuPushFoldCfr;
  tryExecuteHuPushFoldCfr=function(index,notation,toCall){
    const p=players[index];
    const result=originalTryCfr(index,notation,toCall);
    if(p&&p.benchmarkPolicy==="new"){
      if(result&&result.handled){
        cfrUsage.handled++;
        const dbg=pendingPreflopDecisionDebug[index]||{};
        if(dbg.huCfrRole==="SB")cfrUsage.sb++;
        if(dbg.huCfrRole==="BB")cfrUsage.bb++;
        if(dbg.huCfrAction==="shove")cfrUsage.shove++;
        else if(dbg.huCfrAction==="call")cfrUsage.call++;
        else if(dbg.huCfrAction==="fold")cfrUsage.fold++;
      }else{
        cfrUsage.fallback++;
      }
    }
    return result;
  };

  let policyRng={old:makeRng(1),new:makeRng(1)};

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
        const toCall=Math.max(0,currentBet-p.currentBet);
        pendingAiDebugInfo[index]={
          aiName:p.name,
          street,
          toCall,
          opponentRanges:getSafeOpponentRangeDebug(index)
        };
        executeHeuristicPostflopAction(index,toCall);
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
    const dealRng=makeRng(pairSeed);
    const policySeed=(pairSeed^0x9e3779b9)>>>0;
    policyRng={old:makeRng(policySeed),new:makeRng(policySeed)};
    Math.random=dealRng;

    players=[
      createPlayer(swapped?"NEW":"OLD",false,START,"gto",aiProfiles.TAG),
      createPlayer(swapped?"OLD":"NEW",false,START,"gto",aiProfiles.TAG)
    ];
    players[0].benchmarkPolicy=swapped?"new":"old";
    players[1].benchmarkPolicy=swapped?"old":"new";
    for(const p of players){
      p.huPushFoldCfrMix=p.benchmarkPolicy==="new"?MIX_VALUE:0;
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
    mix:MIX_VALUE,
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
    actionCounts,
    elapsedMs:Date.now()-started
  };
})()
`;

(async()=>{
  const runner=new Function("require","process",gameScript+"\n"+harness);
  const result=await runner(require,process);
  console.log("HU_CFR_AB_RESULT="+JSON.stringify(result));
})().catch(err=>{
  console.error(err&&err.stack?err.stack:err);
  process.exit(1);
});
