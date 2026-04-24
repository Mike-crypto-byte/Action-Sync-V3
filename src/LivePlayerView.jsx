import React, { useState, useEffect, useRef, useCallback } from 'react';
import { database as db, ref, update } from './firebase.js';
import { useGameState, useUserData, usePresence, useLeaderboard, useChat } from './useFirebaseSync.js';
import { useSettings, DEFAULT_ODDS } from './useSettings.js';

// ── Chip colours (real casino palette) ───────────────────────────────────────
const CHIP_COLORS = {
  5:    { bg:'#dc2626', ring:'rgba(255,255,255,0.35)' },
  10:   { bg:'#2563eb', ring:'rgba(255,255,255,0.35)' },
  25:   { bg:'#16a34a', ring:'rgba(255,255,255,0.35)' },
  50:   { bg:'#ea580c', ring:'rgba(255,255,255,0.35)' },
  100:  { bg:'#1f2937', ring:'rgba(255,255,255,0.35)' },
  250:  { bg:'#7c3aed', ring:'rgba(255,255,255,0.35)' },
  500:  { bg:'#9f1239', ring:'rgba(255,255,255,0.35)' },
};
const CHIP_VALUES = [5, 10, 25, 50, 100, 250, 500];

// ── Roulette helpers ──────────────────────────────────────────────────────────
const ROULETTE_REDS = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
const rCol = (n) => { const i = parseInt(n); return isNaN(i)||i===0 ? 'green' : ROULETTE_REDS.has(i) ? 'red' : 'black'; };
const NUM_COLOR = { green:'#15803d', red:'#dc2626', black:'#1f2937' };

// Roulette grid: rows top→bottom = row3, row2, row1
const ROULETTE_COLS = [3,6,9,12,15,18,21,24,27,30,33,36];

// ── Game bet configs ──────────────────────────────────────────────────────────
const GAME_CONFIGS = {
  baccarat: {
    defaultState: { bettingOpen:false, countdown:15, roundNumber:0, winner:null, playerScore:0, bankerScore:0, playerCards:[], bankerCards:[] },
    resolveKey: 'roundNumber',
    sections: [
      { label:'MAIN BETS', cols:3, bets:[
        { id:'player',     label:'Player',    color:'#3b82f6' },
        { id:'banker',     label:'Banker',    color:'#ef4444' },
        { id:'tie',        label:'Tie',       color:'#22c55e' },
      ]},
      { label:'SIDE BETS', cols:4, bets:[
        { id:'playerPair', label:'Player Pair', color:'#8b5cf6' },
        { id:'bankerPair', label:'Banker Pair', color:'#8b5cf6' },
        { id:'dragon',     label:'🐉 Dragon', color:'#f59e0b' },
        { id:'panda',      label:'🐼 Panda',  color:'#10b981' },
      ]},
    ],
  },
  blackjack: {
    defaultState: { bettingOpen:false, countdown:15, roundNumber:0, winner:null },
    resolveKey: 'roundNumber',
    sections: [
      { label:'PLACE YOUR BET', cols:2, bets:[
        { id:'win',  label:'Win',  color:'#22c55e' },
        { id:'lose', label:'Lose', color:'#ef4444' },
      ]},
    ],
  },
  roulette: {
    defaultState: { bettingOpen:false, countdown:15, roundNumber:0, spinResult:null },
    resolveKey: 'roundNumber',
    sections: [], // rendered as full board below
  },
  craps: {
    defaultState: { bettingOpen:false, countdown:15, rollNumber:0, lastRoll:null, gamePhase:'come-out', point:null, gameMode:'standard' },
    resolveKey: 'rollNumber',
    sections: [
      { label:'LINE BETS', cols:2, bets:[
        { id:'passLine', label:'Pass Line',  color:'#22c55e' },
        { id:'dontPass', label:"Don't Pass", color:'#ef4444' },
      ]},
      { label:'ODDS', cols:2, bets:[
        { id:'passOdds',     label:'Pass Odds',      color:'#4ade80' },
        { id:'dontPassOdds', label:"Don't Pass Odds", color:'#f87171' },
      ]},
      { label:'PLACE BETS', cols:6, craplessCols:5, bets:[
        { id:'craplessPlace2',  label:'2',  color:'#3b82f6', craplessOnly:true },
        { id:'craplessPlace3',  label:'3',  color:'#3b82f6', craplessOnly:true },
        { id:'place4',  label:'4',  color:'#3b82f6' },
        { id:'place5',  label:'5',  color:'#3b82f6' },
        { id:'place6',  label:'6',  color:'#3b82f6' },
        { id:'place8',  label:'8',  color:'#3b82f6' },
        { id:'place9',  label:'9',  color:'#3b82f6' },
        { id:'place10', label:'10', color:'#3b82f6' },
        { id:'craplessPlace11', label:'11', color:'#3b82f6', craplessOnly:true },
        { id:'craplessPlace12', label:'12', color:'#3b82f6', craplessOnly:true },
      ]},
      { label:'HARD WAYS', cols:4, bets:[
        { id:'hard4',  label:'Hard 4',  color:'#f59e0b' },
        { id:'hard6',  label:'Hard 6',  color:'#f59e0b' },
        { id:'hard8',  label:'Hard 8',  color:'#f59e0b' },
        { id:'hard10', label:'Hard 10', color:'#f59e0b' },
      ]},
      { label:'ONE-ROLL PROPS', cols:4, bets:[
        { id:'field',    label:'Field',         color:'#8b5cf6' },
        { id:'any7',     label:'Any 7',         color:'#ef4444' },
        { id:'anyCraps', label:'Any Craps',     color:'#8b5cf6' },
        { id:'yo11',     label:'Yo (11)',        color:'#22c55e' },
        { id:'ace2',     label:'Aces (2)',       color:'#ec4899' },
        { id:'three',    label:'Ace Deuce (3)',  color:'#ec4899' },
        { id:'ace12',    label:'Boxcars (12)',   color:'#ec4899' },
      ]},
      { label:'HORN & COMBO', cols:2, bets:[
        { id:'horn', label:'Horn',  color:'#06b6d4' },
        { id:'ce',   label:'C & E', color:'#06b6d4' },
      ]},
    ],
  },
};

// ── Resolve ───────────────────────────────────────────────────────────────────
function resolveGame(gameName, gameState, activeBets, odds) {
  const ab = { ...activeBets };
  let winnings = 0, net = 0, label = '';
  const isPair = (c1,c2) => c1&&c2&&c1.value===c2.value;

  if (gameName === 'baccarat') {
    const w = gameState.winner; if (!w) return null;
    const o = odds;
    const pay = (k,p) => { winnings+=p; net+=p-ab[k]; ab[k]=0; };
    const lose = (k)  => { net-=ab[k]; ab[k]=0; };
    if (ab.player>0) w==='player' ? pay('player', ab.player*(1+o.player.num/o.player.den)) : lose('player');
    if (ab.banker>0) w==='banker' ? pay('banker', Math.round(ab.banker+ab.banker*(o.banker.num/o.banker.den)*0.95)) : lose('banker');
    if (ab.tie>0)    w==='tie'    ? pay('tie',    ab.tie*(1+o.tie.num/o.tie.den))           : lose('tie');
    if (ab.playerPair>0) { gameState.playerPairHit ? pay('playerPair', ab.playerPair*(1+o.playerPair.num/o.playerPair.den)) : lose('playerPair'); }
    if (ab.bankerPair>0) { gameState.bankerPairHit ? pay('bankerPair', ab.bankerPair*(1+o.bankerPair.num/o.bankerPair.den)) : lose('bankerPair'); }
    if (ab.dragon>0)  { gameState.dragonHit ? pay('dragon', ab.dragon*(1+o.dragon.num/o.dragon.den)) : lose('dragon'); }
    if (ab.panda>0)   { gameState.pandaHit  ? pay('panda',  ab.panda*(1+o.panda.num/o.panda.den))   : lose('panda'); }
    label = w==='player'?'👤 Player Wins':w==='banker'?'🏦 Banker Wins':'🤝 Tie';
    if (gameState.playerScore!==undefined) label+=` — ${gameState.playerScore}:${gameState.bankerScore}`;
  }
  else if (gameName === 'blackjack') {
    const w=gameState.winner; if (!w) return null;
    const o=odds;
    if (w==='push') { winnings=Object.values(ab).reduce((s,v)=>s+(v||0),0); for(const k of Object.keys(ab)) ab[k]=0; label='🤝 Push'; }
    else {
      if (ab.win>0)  { if(w==='win'){const p=ab.win*(1+o.win.num/o.win.den);winnings+=p;net+=p-ab.win;}else if(w==='blackjack'){const p=ab.win*(1+o.blackjack.num/o.blackjack.den);winnings+=p;net+=p-ab.win;}else net-=ab.win; ab.win=0; }
      if (ab.lose>0) { if(w==='lose'){const p=ab.lose*(1+o.lose.num/o.lose.den);winnings+=p;net+=p-ab.lose;}else net-=ab.lose; ab.lose=0; }
      label = w==='win'?'✅ Win':w==='blackjack'?'🃏 Blackjack!':'❌ Lose';
    }
  }
  else if (gameName === 'roulette') {
    const num=gameState.spinResult; if (num===null||num===undefined) return null;
    const numStr=num.toString(), numInt=(numStr==='0'||numStr==='00')?-1:parseInt(numStr), color=rCol(numStr);
    const o=odds; const em=o.evenMoney||{num:1,den:1};
    Object.entries(ab).forEach(([key,amt]) => {
      if (!amt) return;
      const dash=key.indexOf('-'); const type=key.slice(0,dash<0?key.length:dash), val=dash<0?'':key.slice(dash+1);
      let won=false,payout=0;
      const ROULETTE_TYPES = new Set(['straight','split','corner','street','dozen','column','red','black','even','odd','low','high']);
      if (!ROULETTE_TYPES.has(type)) return; // skip stale non-roulette bets
      if(type==='straight')  { won=val===numStr; payout=amt*(1+(o.straightUp||{num:35,den:1}).num/(o.straightUp||{num:35,den:1}).den); }
      else if(type==='split')  { won=val.split(',').includes(numStr); payout=amt*(1+(o.split||{num:17,den:1}).num/(o.split||{num:17,den:1}).den); }
      else if(type==='corner') { won=val.split(',').includes(numStr); payout=amt*(1+(o.corner||{num:8,den:1}).num/(o.corner||{num:8,den:1}).den); }
      else if(type==='street') { won=val.split(',').includes(numStr); payout=amt*(1+(o.street||{num:11,den:1}).num/(o.street||{num:11,den:1}).den); }
      else if(type==='red')   { won=color==='red';   payout=amt*(1+em.num/em.den); }
      else if(type==='black') { won=color==='black'; payout=amt*(1+em.num/em.den); }
      else if(type==='even')  { won=numInt>0&&numInt%2===0; payout=amt*(1+em.num/em.den); }
      else if(type==='odd')   { won=numInt>0&&numInt%2===1; payout=amt*(1+em.num/em.den); }
      else if(type==='low')   { won=numInt>=1&&numInt<=18;  payout=amt*(1+em.num/em.den); }
      else if(type==='high')  { won=numInt>=19&&numInt<=36; payout=amt*(1+em.num/em.den); }
      else if(type==='dozen') { const dO=o.dozen||{num:2,den:1}; if(val==='1st')won=numInt>=1&&numInt<=12;else if(val==='2nd')won=numInt>=13&&numInt<=24;else if(val==='3rd')won=numInt>=25&&numInt<=36; payout=amt*(1+dO.num/dO.den); }
      else if(type==='column'){ const cO=o.column||{num:2,den:1}; won=numInt>0&&(numInt-parseInt(val))%3===0; payout=amt*(1+cO.num/cO.den); }
      if(won){winnings+=payout;net+=payout-amt;}else net-=amt;
      ab[key]=0;
    });
    label=`🎡 ${numStr} — ${color.charAt(0).toUpperCase()+color.slice(1)}`;
  }
  else if (gameName === 'craps') {
    const {lastRoll,gamePhase,point}=gameState; if (!lastRoll) return null;
    const d1=lastRoll.dice1||0,d2=lastRoll.dice2||0,total=d1+d2,isHard=d1===d2;
    const o=odds;
    const or1=(k,wins,mult)=>{ if(!ab[k])return; if(wins){winnings+=ab[k]*mult;net+=ab[k]*mult-ab[k];}else net-=ab[k]; ab[k]=0; };

    const isCrapless = gameState.gameMode === 'crapless';
    // Pass Line
    if (ab.passLine>0) {
      if(gamePhase==='come-out'){
        if(total===7||total===11){const p=ab.passLine*2;winnings+=p;net+=p-ab.passLine;ab.passLine=0;}
        else if([2,3,12].includes(total)&&!isCrapless){net-=ab.passLine;ab.passLine=0;}
      } else {
        if(total===point){
          const mult=isCrapless&&(point===2||point===12)?7:isCrapless&&(point===3||point===11)?4:2;
          const p=ab.passLine*mult;winnings+=p;net+=p-ab.passLine;ab.passLine=0;
        }else if(total===7){net-=ab.passLine;ab.passLine=0;}
      }
    }
    // Don't Pass
    if (ab.dontPass>0) {
      if(gamePhase==='come-out'){if([2,3].includes(total)){const p=ab.dontPass*2;winnings+=p;net+=p-ab.dontPass;ab.dontPass=0;}else if(total===12){winnings+=ab.dontPass;ab.dontPass=0;}else if(total===7||total===11){net-=ab.dontPass;ab.dontPass=0;}}
      else{if(total===7){const p=ab.dontPass*2;winnings+=p;net+=p-ab.dontPass;ab.dontPass=0;}else if(total===point){net-=ab.dontPass;ab.dontPass=0;}}
    }
    // Odds bets (pay true odds)
    const trueOdds={4:2,5:1.5,6:1.2,8:1.2,9:1.5,10:2};
    if (ab.passOdds>0&&gamePhase!=='come-out') {
      if(total===point){const p=ab.passOdds*(1+trueOdds[point]||1);winnings+=p;net+=p-ab.passOdds;ab.passOdds=0;}
      else if(total===7){net-=ab.passOdds;ab.passOdds=0;}
    }
    if (ab.dontPassOdds>0&&gamePhase!=='come-out') {
      if(total===7){const p=ab.dontPassOdds*(1+(1/trueOdds[point]||1));winnings+=p;net+=p-ab.dontPassOdds;ab.dontPassOdds=0;}
      else if(total===point){net-=ab.dontPassOdds;ab.dontPassOdds=0;}
    }
    // Place bets
    const placeP={4:o.place4_10||{num:9,den:5},5:o.place5_9||{num:7,den:5},6:o.place6_8||{num:7,den:6},8:o.place6_8||{num:7,den:6},9:o.place5_9||{num:7,den:5},10:o.place4_10||{num:9,den:5}};
    [4,5,6,8,9,10].forEach(n=>{ if(!ab[`place${n}`])return; if(total===n){const pp=placeP[n];const p=ab[`place${n}`]*(1+pp.num/pp.den);winnings+=p;net+=p-ab[`place${n}`];}else if(total===7){net-=ab[`place${n}`];ab[`place${n}`]=0;} });
    // Crapless place bets (2,3,11,12) — only active in crapless mode
    if (isCrapless) {
      const craplessP={2:7,3:3,11:3,12:7};
      [2,3,11,12].forEach(n=>{ const k=`craplessPlace${n}`; if(!ab[k])return; if(total===n){const p=ab[k]*(1+craplessP[n]);winnings+=p;net+=p-ab[k];ab[k]=0;}else if(total===7){net-=ab[k];ab[k]=0;} });
    }
    // Hard ways
    const hwP={4:o.hardWay4_10||{num:7,den:1},6:o.hardWay6_8||{num:9,den:1},8:o.hardWay6_8||{num:9,den:1},10:o.hardWay4_10||{num:7,den:1}};
    [4,6,8,10].forEach(n=>{ if(!ab[`hard${n}`])return; if(total===n&&isHard){const hp=hwP[n];const p=ab[`hard${n}`]*(1+hp.num/hp.den);winnings+=p;net+=p-ab[`hard${n}`];ab[`hard${n}`]=0;}else if(total===n||total===7){net-=ab[`hard${n}`];ab[`hard${n}`]=0;} });
    // One-roll props
    or1('field',[2,3,4,9,10,11,12].includes(total),total===2?1+(o.field2||{num:2,den:1}).num/(o.field2||{num:2,den:1}).den:total===12?1+(o.field12||{num:3,den:1}).num/(o.field12||{num:3,den:1}).den:2);
    or1('any7',total===7,1+(o.anySeven||{num:4,den:1}).num/(o.anySeven||{num:4,den:1}).den);
    or1('anyCraps',[2,3,12].includes(total),1+(o.anyCraps||{num:7,den:1}).num/(o.anyCraps||{num:7,den:1}).den);
    or1('yo11',total===11,1+(o.hop||{num:15,den:1}).num/(o.hop||{num:15,den:1}).den);
    or1('ace2',total===2,1+(o.hop||{num:15,den:1}).num/(o.hop||{num:15,den:1}).den);
    or1('ace12',total===12,1+(o.hop||{num:15,den:1}).num/(o.hop||{num:15,den:1}).den);
    or1('three',total===3,1+(o.hop||{num:15,den:1}).num/(o.hop||{num:15,den:1}).den);
    if(ab.horn>0){if(total===2||total===12){const p=ab.horn*7.5;winnings+=p;net+=p-ab.horn;}else if(total===3||total===11){const p=ab.horn*4;winnings+=p;net+=p-ab.horn;}else net-=ab.horn;ab.horn=0;}
    if(ab.ce>0){if([2,3,12].includes(total)){const p=ab.ce*1.5;winnings+=p;net+=p-ab.ce;}else if(total===11){const p=ab.ce*3.5;winnings+=p;net+=p-ab.ce;}else net-=ab.ce;ab.ce=0;}
    label=`🎲 ${total} (${d1}–${d2})${point?`  Point: ${point}`:''}`;
  }
  return { winnings:Math.round(winnings), net:Math.round(net), newActiveBets:ab, label };
}

// ── CSS ───────────────────────────────────────────────────────────────────────
let cssInjected=false;
function injectCSS(){
  if(cssInjected)return; cssInjected=true;
  const el=document.createElement('style');
  el.textContent=`
    @keyframes lpIn  {from{opacity:0;transform:scale(0.85) translateY(-10px)}to{opacity:1;transform:scale(1) translateY(0)}}
    @keyframes lpOut {from{opacity:1;transform:scale(1)}to{opacity:0;transform:scale(0.9)}}
    .lp-chip:hover { transform: scale(1.12); }
    .lp-bet-btn:hover:not(:disabled) { filter: brightness(1.15); }
  `;
  document.head.appendChild(el);
}

const GAME_LABELS = { baccarat:'BACCARAT', blackjack:'BLACKJACK', roulette:'ROULETTE', craps:'CRAPS' };

// ── Chip component ────────────────────────────────────────────────────────────
function Chip({ value, selected, onClick }) {
  const c = CHIP_COLORS[value] || { bg:'#6b7280', ring:'rgba(255,255,255,0.3)' };
  const label = value >= 1000 ? `${value/1000}k` : `$${value}`;
  return (
    <div
      className="lp-chip"
      onClick={onClick}
      style={{
        width:36, height:36, borderRadius:'50%', flexShrink:0,
        background: c.bg,
        boxShadow: selected
          ? `0 0 0 2px #fff, 0 0 0 4px ${c.bg}, 0 0 12px rgba(255,255,255,0.4)`
          : `inset 0 0 0 3px ${c.ring}, 0 2px 4px rgba(0,0,0,0.5)`,
        display:'flex', alignItems:'center', justifyContent:'center',
        color:'#fff', fontSize:9, fontWeight:800, cursor:'pointer',
        transition:'transform 0.1s, box-shadow 0.1s',
        userSelect:'none',
      }}
    >
      {label}
    </div>
  );
}

// ── Roulette board — horizontal casino layout with split/corner hit zones ────
// Rows: top=3,6,9..36 / mid=2,5,8..35 / bot=1,4,7..34
// Left: 0/00  |  Right: 2:1 per row  |  Below: dozens then even-money
function RouletteBoard({ activeBets, currentBets, bettingOpen, onBet, onRemoveBet }) {
  const boardRef = useRef(null);
  const [boardWidth, setBoardWidth] = useState(0);
  useEffect(() => {
    if (!boardRef.current) return;
    const ro = new ResizeObserver(e => setBoardWidth(e[0].contentRect.width));
    ro.observe(boardRef.current);
    setBoardWidth(boardRef.current.offsetWidth);
    return () => ro.disconnect();
  }, []);

  const allBets = {};
  Object.entries(activeBets).forEach(([k,v]) => { if(v) allBets[k]=(allBets[k]||0)+v; });
  Object.entries(currentBets).forEach(([k,v]) => { if(v) allBets[k]=(allBets[k]||0)+v; });

  // Layout constants
  const G = 2, ZERO_W = 24, COL21_W = 26, NH = 27, CS = 13;
  const PAD = 16;
  const numCols = 12;
  // W = cell width computed from available space
  const W = boardWidth > 0
    ? Math.max(16, Math.floor((boardWidth - PAD - ZERO_W - COL21_W - (numCols + 2) * G) / numCols))
    : 18;

  // rows[0]=[3,6,...,36]  rows[1]=[2,5,...,35]  rows[2]=[1,4,...,34]
  const rows = [
    [3,6,9,12,15,18,21,24,27,30,33,36],
    [2,5,8,11,14,17,20,23,26,29,32,35],
    [1,4,7,10,13,16,19,22,25,28,31,34],
  ];

  // Chip colour by denomination
  const chipBg = (amt) => {
    if (amt >= 500) return '#9f1239';
    if (amt >= 250) return '#7c3aed';
    if (amt >= 100) return '#1f2937';
    if (amt >= 50)  return '#ea580c';
    if (amt >= 25)  return '#16a34a';
    if (amt >= 10)  return '#2563eb';
    return '#dc2626';
  };

  // Build chip overlay positions (straight, H-split, V-split, corner)
  const chips = [];
  rows.forEach((row, ri) => row.forEach((num, ci) => {
    const amt = allBets[`straight-${num}`];
    if (amt) chips.push({ k:`s${num}`, amt, x:ci*(W+G)+W/2, y:ri*(NH+G)+NH/2 });
  }));
  rows.forEach((row, ri) => row.slice(0,-1).forEach((num, ci) => {
    const key = `split-${[num,row[ci+1]].sort((a,b)=>a-b).join(',')}`;
    const amt = allBets[key];
    if (amt) chips.push({ k:key, amt, x:(ci+1)*(W+G)-G/2, y:ri*(NH+G)+NH/2 });
  }));
  rows.slice(0,-1).forEach((row, ri) => row.forEach((num, ci) => {
    const key = `split-${[num,rows[ri+1][ci]].sort((a,b)=>a-b).join(',')}`;
    const amt = allBets[key];
    if (amt) chips.push({ k:`v${key}`, amt, x:ci*(W+G)+W/2, y:(ri+1)*(NH+G)-G/2 });
  }));
  rows.slice(0,-1).forEach((row, ri) => row.slice(0,-1).forEach((num, ci) => {
    const key = `corner-${[num,row[ci+1],rows[ri+1][ci],rows[ri+1][ci+1]].sort((a,b)=>a-b).join(',')}`;
    const amt = allBets[key];
    if (amt) chips.push({ k:key, amt, x:(ci+1)*(W+G)-G/2, y:(ri+1)*(NH+G)-G/2 });
  }));

  // Outside bet button helper
  const mk = (key, label, bg, color, style={}) => {
    const amt = allBets[key];
    return (
      <div key={key} onClick={() => bettingOpen && onBet(key)}
        onContextMenu={(e)=>{ e.preventDefault(); onRemoveBet && onRemoveBet(key, e); }}
        style={{
          background: amt ? `${bg}cc` : bg,
          border: amt ? '2px solid rgba(255,255,255,0.8)' : '1px solid rgba(255,255,255,0.15)',
          borderRadius:2, display:'flex', flexDirection:'column', alignItems:'center',
          justifyContent:'center', cursor: bettingOpen ? 'pointer' : 'default',
          color, fontWeight:700, userSelect:'none', opacity: bettingOpen ? 1 : 0.7, ...style,
        }}>
        <span style={{lineHeight:1,fontSize:'inherit'}}>{label}</span>
        {amt ? <span style={{fontSize:6,color:'#fff',background:'rgba(0,0,0,0.75)',borderRadius:3,padding:'0 2px',marginTop:1}}>${amt}</span> : null}
      </div>
    );
  };

  return (
    <div ref={boardRef} style={{padding:`6px ${PAD/2}px`, userSelect:'none', width:'100%', boxSizing:'border-box', overflowX:'auto'}}>

      {/* Number area: zeros | grid + hit zones | 2:1 */}
      <div style={{display:'flex', gap:G, marginBottom:G}}>

        {/* 0 / 00 stacked */}
        <div style={{display:'flex', flexDirection:'column', gap:G, width:ZERO_W, flexShrink:0}}>
          {mk('straight-0',  '0',  '#15803d', '#fff', {flex:1, height:NH, fontSize:10})}
          {mk('straight-00', '00', '#15803d', '#fff', {flex:1, height:NH, fontSize:9})}
        </div>

        {/* Number grid + transparent hit zones + chip overlays */}
        <div style={{position:'relative', flexShrink:0, lineHeight:0,
          width: numCols*W + (numCols-1)*G,
          height: 3*NH + 2*G,
        }}>
          {/* Number cells */}
          {rows.map((row, ri) => row.map((num, ci) => {
            const isRed = ROULETTE_REDS.has(num);
            const hasBet = allBets[`straight-${num}`];
            return (
              <div key={num}
                onClick={() => bettingOpen && onBet(`straight-${num}`)}
                onContextMenu={(e)=>{ e.preventDefault(); onRemoveBet && onRemoveBet(`straight-${num}`, e); }}
                style={{
                  position:'absolute',
                  left: ci*(W+G), top: ri*(NH+G),
                  width: W, height: NH,
                  background: isRed ? '#b91c1c' : '#1f2937',
                  border: hasBet ? '2px solid #fff' : '1px solid rgba(255,255,255,0.15)',
                  borderRadius:2,
                  display:'flex', alignItems:'center', justifyContent:'center',
                  cursor: bettingOpen ? 'pointer' : 'default',
                  color:'#fff', fontWeight:800, fontSize:9,
                  opacity: bettingOpen ? 1 : 0.7,
                }}>
                {num}
              </div>
            );
          }))}

          {/* H-split hit zones (between horizontally adjacent cells, same row) */}
          {rows.map((row, ri) => row.slice(0,-1).map((num, ci) => {
            const sorted = [num, row[ci+1]].sort((a,b)=>a-b).join(',');
            return (
              <div key={`hs-${sorted}`}
                onClick={() => bettingOpen && onBet(`split-${sorted}`)}
                onContextMenu={(e)=>{ e.preventDefault(); onRemoveBet && onRemoveBet(`split-${sorted}`, e); }}
                style={{
                  position:'absolute',
                  left: (ci+1)*(W+G) - (G+4)/2, top: ri*(NH+G),
                  width: G+4, height: NH,
                  cursor: bettingOpen ? 'pointer' : 'default',
                  zIndex:3,
                }}
              />
            );
          }))}

          {/* V-split hit zones (between vertically adjacent cells, same column) */}
          {rows.slice(0,-1).map((row, ri) => row.map((num, ci) => {
            const sorted = [num, rows[ri+1][ci]].sort((a,b)=>a-b).join(',');
            return (
              <div key={`vs-${sorted}`}
                onClick={() => bettingOpen && onBet(`split-${sorted}`)}
                onContextMenu={(e)=>{ e.preventDefault(); onRemoveBet && onRemoveBet(`split-${sorted}`, e); }}
                style={{
                  position:'absolute',
                  left: ci*(W+G), top: (ri+1)*(NH+G) - (G+4)/2,
                  width: W, height: G+4,
                  cursor: bettingOpen ? 'pointer' : 'default',
                  zIndex:3,
                }}
              />
            );
          }))}

          {/* Corner hit zones (at the intersection of 4 cells) */}
          {rows.slice(0,-1).map((row, ri) => row.slice(0,-1).map((num, ci) => {
            const sorted = [num, row[ci+1], rows[ri+1][ci], rows[ri+1][ci+1]].sort((a,b)=>a-b).join(',');
            return (
              <div key={`c-${sorted}`}
                onClick={() => bettingOpen && onBet(`corner-${sorted}`)}
                onContextMenu={(e)=>{ e.preventDefault(); onRemoveBet && onRemoveBet(`corner-${sorted}`, e); }}
                style={{
                  position:'absolute',
                  left: (ci+1)*(W+G) - (G+6)/2, top: (ri+1)*(NH+G) - (G+6)/2,
                  width: G+6, height: G+6,
                  cursor: bettingOpen ? 'pointer' : 'default',
                  zIndex:4, borderRadius:'50%',
                }}
              />
            );
          }))}

          {/* Chip overlays */}
          {chips.map(({k, amt, x, y}) => (
            <div key={k} style={{
              position:'absolute',
              left: Math.round(x - CS/2), top: Math.round(y - CS/2),
              width: CS, height: CS,
              background: chipBg(amt), color:'#fff', borderRadius:'50%',
              display:'flex', alignItems:'center', justifyContent:'center',
              fontSize:6, fontWeight:800,
              border:'1.5px solid rgba(255,255,255,0.7)',
              boxShadow:'0 1px 4px rgba(0,0,0,0.8)',
              zIndex:6, pointerEvents:'none',
            }}>${amt}</div>
          ))}
        </div>

        {/* 2:1 column bets (row 0 → col 3, row 1 → col 2, row 2 → col 1) */}
        <div style={{display:'flex', flexDirection:'column', gap:G, width:COL21_W, flexShrink:0}}>
          {mk('column-3', '2:1', 'rgba(25,35,55,0.95)', '#d4af37', {flex:1, height:NH, fontSize:7})}
          {mk('column-2', '2:1', 'rgba(25,35,55,0.95)', '#d4af37', {flex:1, height:NH, fontSize:7})}
          {mk('column-1', '2:1', 'rgba(25,35,55,0.95)', '#d4af37', {flex:1, height:NH, fontSize:7})}
        </div>
      </div>

      {/* Dozens — aligned under number grid */}
      <div style={{display:'flex', gap:G, marginBottom:G, marginLeft:ZERO_W+G, marginRight:COL21_W+G}}>
        {mk('dozen-1st', '1st 12', 'rgba(25,35,55,0.95)', '#9ca3af', {flex:1, height:19, fontSize:8})}
        {mk('dozen-2nd', '2nd 12', 'rgba(25,35,55,0.95)', '#9ca3af', {flex:1, height:19, fontSize:8})}
        {mk('dozen-3rd', '3rd 12', 'rgba(25,35,55,0.95)', '#9ca3af', {flex:1, height:19, fontSize:8})}
      </div>

      {/* Even-money — aligned under number grid */}
      <div style={{display:'flex', gap:G, marginLeft:ZERO_W+G, marginRight:COL21_W+G}}>
        {mk('low-low',    '1-18',  'rgba(25,35,55,0.95)', '#9ca3af', {flex:1, height:19, fontSize:8})}
        {mk('even-even',  'Even',  'rgba(25,35,55,0.95)', '#9ca3af', {flex:1, height:19, fontSize:8})}
        {mk('red-red',    'Red',   '#b91c1c',             '#fff',     {flex:1, height:19, fontSize:8})}
        {mk('black-black','Black', '#111827',             '#fff',     {flex:1, height:19, fontSize:8})}
        {mk('odd-odd',    'Odd',   'rgba(25,35,55,0.95)', '#9ca3af', {flex:1, height:19, fontSize:8})}
        {mk('high-high',  '19-36', 'rgba(25,35,55,0.95)', '#9ca3af', {flex:1, height:19, fontSize:8})}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function LivePlayerView({ dealerUid, playerUserId, playerName, selectedGame, streamVideoId, startingChips, onBack }) {
  injectCSS();
  const config = GAME_CONFIGS[selectedGame]; if (!config) return null;

  const { odds: settingsOdds } = useSettings(dealerUid);
  const gameOdds = settingsOdds?.[selectedGame] || DEFAULT_ODDS[selectedGame] || {};
  const { gameState } = useGameState(dealerUid, selectedGame, config.defaultState);
  const { userData, isLoaded, saveUserData, updateUserField } = useUserData(dealerUid, playerUserId);
  const { leaderboard } = useLeaderboard(dealerUid);
  const { chatMessages, sendMessage } = useChat(dealerUid);
  usePresence(dealerUid, playerUserId, playerName);

  const [isMobile, setIsMobile] = useState(window.innerWidth < 900);
  useEffect(() => { const h=()=>setIsMobile(window.innerWidth<900); window.addEventListener('resize',h); return ()=>window.removeEventListener('resize',h); }, []);

  // Player data
  const [bankroll, setBankroll]         = useState(startingChips||1000);
  const [activeBets, setActiveBets]     = useState({});
  const [sessionStats, setSessionStats] = useState({totalRounds:0,biggestWin:0});
  const [betHistory, setBetHistory]     = useState([]);
  useEffect(() => {
    if (!isLoaded||!userData) return;
    if (userData.bankroll!==undefined) setBankroll(userData.bankroll);
    if (userData.activeBets)   setActiveBets(userData.activeBets);
    if (userData.sessionStats) setSessionStats(userData.sessionStats);
  }, [isLoaded, userData]);

  const [selectedChip, setSelectedChip]   = useState(25);
  const [currentBets, setCurrentBets]     = useState({});
  const [betsConfirmed, setBetsConfirmed] = useState(false);
  const [activeTab, setActiveTab]         = useState('leaderboard');
  const [chatInput, setChatInput]         = useState('');

  // Clear bet state when the game changes — refund active bets and wipe Firebase
  const prevGameRef = useRef(selectedGame);
  useEffect(() => {
    if (prevGameRef.current !== selectedGame) {
      const refund = Object.values(activeBets).reduce((s,v)=>s+(v||0),0);
      setActiveBets({});
      setCurrentBets({});
      setBetsConfirmed(false);
      lastResolved.current = 0;
      const newBankroll = bankroll + refund;
      if (refund > 0) setBankroll(newBankroll);
      // Clear activeBets in Firebase so the userData listener doesn't restore stale bets
      updateUserField({ activeBets: null, ...(refund > 0 ? { bankroll: newBankroll } : {}) });
    }
    prevGameRef.current = selectedGame;
  }, [selectedGame]);
  const [secOpen, setSecOpen]             = useState({leaderboard:true,chat:true,history:true});
  const chatEndRef = useRef(null);
  const histEndRef = useRef(null);
  const toggleSec = (k) => setSecOpen(s=>({...s,[k]:!s[k]}));
  useEffect(() => { histEndRef.current?.scrollIntoView({behavior:'smooth'}); }, [betHistory]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({behavior:'smooth'}); }, [chatMessages]);

  // Countdown
  const [localCountdown, setLocalCountdown] = useState(0);
  const prevBettingOpen = useRef(null);
  const bettingOpen = gameState.bettingOpen ?? false;
  const resolveKey  = config.resolveKey;

  useEffect(() => { if(bettingOpen){setLocalCountdown(gameState.countdown||15);setCurrentBets({});setBetsConfirmed(false);} }, [bettingOpen, gameState.countdown]);
  useEffect(() => { if(!bettingOpen||localCountdown<=0)return; const t=setTimeout(()=>setLocalCountdown(n=>n-1),1000); return()=>clearTimeout(t); }, [bettingOpen, localCountdown]);
  useEffect(() => {
    if(prevBettingOpen.current===true&&!bettingOpen){const tot=Object.values(currentBets).reduce((s,v)=>s+(v||0),0);if(tot>0&&!betsConfirmed)confirmBets(true);}
    prevBettingOpen.current=bettingOpen;
  }, [bettingOpen]);

  // Banner
  const [banner, setBanner] = useState(null);
  const bannerTimer = useRef(null);
  const showBanner = useCallback((type,amount,label)=>{
    if(bannerTimer.current)clearTimeout(bannerTimer.current);
    setBanner({type,amount,label,out:false});
    bannerTimer.current=setTimeout(()=>{setBanner(b=>b?{...b,out:true}:null);setTimeout(()=>setBanner(null),400);},3000);
  },[]);

  // Resolve
  const lastResolved = useRef(0);
  useEffect(()=>{
    const key=gameState[resolveKey]||0; if(key<=lastResolved.current)return;
    const totalActive=Object.values(activeBets).reduce((s,v)=>s+(v||0),0);
    if(totalActive===0){lastResolved.current=key;return;}
    const result=resolveGame(selectedGame,gameState,activeBets,gameOdds);
    if(!result)return;
    lastResolved.current=key;
    const newBankroll=Math.round(bankroll+result.winnings);
    setBankroll(newBankroll); setActiveBets(result.newActiveBets);
    const newStats={totalRounds:(sessionStats.totalRounds||0)+1,biggestWin:Math.max(sessionStats.biggestWin||0,result.net)};
    setSessionStats(newStats);
    if(totalActive>0) setBetHistory(h=>[...h,{round:key,label:result.label,net:result.net,wagered:totalActive,timestamp:Date.now()}].slice(-10));
    if(result.net>0)       showBanner('win', result.net, result.label);
    else if(result.net===0) showBanner('push',0,          result.label);
    else                    showBanner('loss',result.net, result.label);
    saveUserData({bankroll:newBankroll,activeBets:result.newActiveBets,sessionStats:newStats,name:playerName});
    update(ref(db,`rooms/${dealerUid}/session/leaderboard/${playerUserId}`),{bankroll:newBankroll,name:playerName,timestamp:Date.now()});
  },[gameState[resolveKey]]);

  const placeBet = (betId)=>{
    if(!bettingOpen||bankroll<selectedChip)return;
    const pending={...currentBets,[betId]:(currentBets[betId]||0)+selectedChip};
    const pTot=Object.values(pending).reduce((s,v)=>s+v,0);
    const aTot=Object.values(activeBets).reduce((s,v)=>s+(v||0),0);
    if(pTot+aTot<=bankroll)setCurrentBets(pending);
  };

  const removePendingBet = (betId, e) => {
    if (e) e.preventDefault();
    if (!bettingOpen || !(currentBets[betId] > 0)) return;
    const newAmt = (currentBets[betId] || 0) - selectedChip;
    if (newAmt <= 0) {
      const { [betId]: _, ...rest } = currentBets;
      setCurrentBets(rest);
    } else {
      setCurrentBets({ ...currentBets, [betId]: newAmt });
    }
  };

  const confirmBets = useCallback(async(auto=false)=>{
    const tot=Object.values(currentBets).reduce((s,v)=>s+(v||0),0); if(tot===0)return;
    const aTot=Object.values(activeBets).reduce((s,v)=>s+(v||0),0); if(tot+aTot>bankroll)return;
    const merged={...activeBets}; for(const[k,v]of Object.entries(currentBets)){if(v>0)merged[k]=(merged[k]||0)+v;}
    const nb=Math.round(bankroll-tot);
    setBankroll(nb);setActiveBets(merged);setCurrentBets({});setBetsConfirmed(true);
    await saveUserData({bankroll:nb,activeBets:merged,sessionStats,name:playerName});
    await update(ref(db,`rooms/${dealerUid}/session/leaderboard/${playerUserId}`),{bankroll:nb,name:playerName,timestamp:Date.now()});
  },[currentBets,activeBets,bankroll,sessionStats,playerName,dealerUid,playerUserId,saveUserData]);

  const sendChat = async()=>{
    if(!chatInput.trim())return;
    await sendMessage(playerUserId,playerName,chatInput.trim());
    setChatInput('');
  };

  const pendingTotal = Object.values(currentBets).reduce((s,v)=>s+(v||0),0);
  const embedSrc = `https://www.youtube.com/embed/${streamVideoId}?rel=0&modestbranding=1`;

  const isCrapless = selectedGame === 'craps' && gameState.gameMode === 'crapless';
  const activeSections = config.sections;
  const allBetDefs = activeSections.flatMap(s=>s.bets.filter(b=>!b.craplessOnly||isCrapless));

  return (
    <div style={{height:'100vh',overflow:'hidden',background:'#080b1a',display:'flex',flexDirection:'column'}}>
      {/* Top bar */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'8px 16px',background:'rgba(8,11,26,0.95)',borderBottom:'1px solid rgba(212,175,55,0.12)',flexShrink:0,height:44}}>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <span style={{color:'#d4af37',fontWeight:800,fontSize:13,letterSpacing:'2px'}}>ACTION SYNC</span>
          <span style={{color:'rgba(136,146,164,0.4)',fontSize:11,letterSpacing:'1px'}}>{GAME_LABELS[selectedGame]}</span>
        </div>
        <div style={{background:'rgba(212,175,55,0.1)',border:'1px solid rgba(212,175,55,0.25)',borderRadius:20,padding:'3px 12px',color:'#d4af37',fontSize:13,fontWeight:700}}>
          💰 ${Math.round(bankroll).toLocaleString()}
        </div>
      </div>

      {/* Body */}
      <div style={{flex:1,display:'flex',flexDirection:isMobile?'column':'row',overflow:'hidden',minHeight:0}}>

        {/* ── Stream ── */}
        <div style={{flex:isMobile?'0 0 36%':'0 0 57%',background:'#000',display:'flex',alignItems:'center',justifyContent:'center',overflow:'hidden'}}>
          {isMobile ? (
            <div style={{position:'relative',width:'100%',paddingTop:'56.25%'}}>
              <iframe src={embedSrc} style={{position:'absolute',inset:0,width:'100%',height:'100%',border:'none'}} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen title="Live"/>
            </div>
          ) : (
            <iframe src={embedSrc} style={{width:'100%',height:'100%',border:'none',display:'block'}} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen title="Live"/>
          )}
        </div>

        {/* ── Right panel ── */}
        <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden',borderLeft:isMobile?'none':'1px solid rgba(212,175,55,0.1)',minHeight:0}}>

          {/* Status + countdown */}
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'7px 12px',borderBottom:'1px solid rgba(255,255,255,0.06)',flexShrink:0}}>
            <div style={{display:'flex',alignItems:'center',gap:6}}>
              <div style={{width:7,height:7,borderRadius:'50%',background:bettingOpen?'#4ade80':'#6b7280',boxShadow:bettingOpen?'0 0 7px rgba(74,222,128,0.7)':'none'}}/>
              <span style={{color:bettingOpen?'#4ade80':'#6b7280',fontSize:11,fontWeight:700,letterSpacing:'1px'}}>
                {bettingOpen?'BETTING OPEN':betsConfirmed?'✓ BETS PLACED':'BETTING CLOSED'}
              </span>
            </div>
            {bettingOpen&&localCountdown>0&&<span style={{color:localCountdown<=5?'#f87171':'#d4af37',fontSize:20,fontWeight:800,fontVariantNumeric:'tabular-nums'}}>{localCountdown}s</span>}
          </div>

          {/* Chips */}
          <div style={{padding:'6px 12px',borderBottom:'1px solid rgba(255,255,255,0.06)',flexShrink:0}}>
            <div style={{fontSize:9,color:'rgba(136,146,164,0.4)',letterSpacing:'1.5px',fontWeight:700,marginBottom:5}}>SELECT CHIP</div>
            <div style={{display:'flex',gap:6,alignItems:'center'}}>
              {CHIP_VALUES.map(v=><Chip key={v} value={v} selected={selectedChip===v} onClick={()=>setSelectedChip(v)}/>)}
            </div>
          </div>

          {/* Bets */}
          <div style={{flex:'0 0 auto',display:'flex',flexDirection:'column'}}>
            {selectedGame==='roulette' ? (
              <div style={{padding:'25px'}}>
              <RouletteBoard activeBets={activeBets} currentBets={currentBets} bettingOpen={bettingOpen} onBet={placeBet} onRemoveBet={removePendingBet}/>
              </div>
            ) : selectedGame==='blackjack' ? (
              <div style={{display:'flex',flexDirection:'column',gap:6,padding:'6px 12px'}}>
                {[
                  { id:'win',  label:'WIN',  color:'#22c55e' },
                  { id:'lose', label:'LOSE', color:'#ef4444' },
                  { id:'none', label:'NO BET / SKIP', color:'#6b7280' },
                ].map(bet=>{
                  const pending=currentBets[bet.id]||0, active=activeBets[bet.id]||0, total=pending+active;
                  const isNone = bet.id==='none';
                  return(
                    <button key={bet.id} onClick={()=>{ if(!bettingOpen) return; if(isNone){Object.keys(currentBets).forEach(k=>placeBet(k,true));} else placeBet(bet.id); }}
                      onContextMenu={(e)=>{ if(!isNone) removePendingBet(bet.id, e); else e.preventDefault(); }}
                      disabled={!bettingOpen}
                      style={{height:isNone?36:52,borderRadius:8,fontSize:isNone?11:15,fontWeight:700,cursor:bettingOpen?'pointer':'default',border:'2px solid',fontFamily:'inherit',lineHeight:1.2,textAlign:'center',transition:'all 0.15s',display:'flex',alignItems:'center',justifyContent:'center',gap:8,
                        background:total>0?`${bet.color}22`:isNone?'rgba(255,255,255,0.02)':'rgba(255,255,255,0.03)',
                        borderColor:total>0?`${bet.color}66`:isNone?'rgba(255,255,255,0.06)':`${bet.color}33`,
                        color:bettingOpen?(total>0?bet.color:isNone?'#6b7280':bet.color):'rgba(136,146,164,0.3)',
                      }}>
                      <div>{bet.label}</div>
                      {total>0&&<div style={{fontSize:10,color:bet.color}}>${total}</div>}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div style={{padding:'6px 12px'}}>
                {activeSections.map((section,si)=>{
                  const visibleBets = section.bets.filter(b=>!b.craplessOnly||isCrapless);
                  const cols = isCrapless&&section.craplessCols ? section.craplessCols : section.cols;
                  return(
                  <div key={si} style={{marginBottom:si<activeSections.length-1?7:0}}>
                    <div style={{fontSize:9,color:'rgba(136,146,164,0.4)',letterSpacing:'1.5px',fontWeight:700,marginBottom:3}}>{section.label}</div>
                    <div style={{display:'grid',gridTemplateColumns:`repeat(${cols},1fr)`,gap:3}}>
                      {visibleBets.map(bet=>{
                        const pending=currentBets[bet.id]||0, active=activeBets[bet.id]||0, total=pending+active;
                        return(
                          <button key={bet.id} className="lp-bet-btn" onClick={()=>placeBet(bet.id)} onContextMenu={(e)=>removePendingBet(bet.id,e)} disabled={!bettingOpen}
                            style={{padding:'7px 4px',borderRadius:5,fontSize:10,fontWeight:700,cursor:bettingOpen?'pointer':'default',border:'1px solid',fontFamily:'inherit',lineHeight:1.2,textAlign:'center',
                              background:total>0?`${bet.color}22`:'rgba(255,255,255,0.03)',
                              borderColor:total>0?`${bet.color}66`:'rgba(255,255,255,0.07)',
                              color:bettingOpen?(total>0?bet.color:'#9ca3af'):'rgba(136,146,164,0.3)',
                            }}>
                            <div>{bet.label}</div>
                            {total>0&&<div style={{fontSize:8,marginTop:1,color:bet.color}}>${total}</div>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Active bets */}
          {(() => {
            const merged = {...activeBets,...currentBets};
            if (selectedGame === 'roulette') {
              const RTYPES = new Set(['straight','split','corner','street','dozen','column','red','black','even','odd','low','high']);
              return Object.entries(merged).some(([k,v]) => v>0 && RTYPES.has(k.split('-')[0]));
            }
            return allBetDefs.some(b => (merged[b.id]||0) > 0);
          })() && (
            <div style={{padding:'4px 12px',borderTop:'1px solid rgba(255,255,255,0.05)',flexShrink:0}}>
              <div style={{display:'flex',gap:3,flexWrap:'wrap'}}>
                {selectedGame==='roulette'
                  ? (() => {
                      const RTYPES = new Set(['straight','split','corner','street','dozen','column','red','black','even','odd','low','high']);
                      return Object.entries({...activeBets,...currentBets})
                        .filter(([k,v]) => v>0 && RTYPES.has(k.split('-')[0]))
                        .slice(0,6)
                        .map(([k,v])=>(
                          <span key={k} style={{padding:'2px 6px',borderRadius:8,background:'rgba(255,255,255,0.08)',color:'#9ca3af',fontSize:9,fontWeight:700}}>{k.replace(/-/g,' ')} ${v}</span>
                        ));
                    })()
                  : allBetDefs.filter(b=>(activeBets[b.id]||0)+(currentBets[b.id]||0)>0).map(b=>(
                      <span key={b.id} style={{padding:'2px 6px',borderRadius:8,background:`${b.color}22`,border:`1px solid ${b.color}44`,color:b.color,fontSize:9,fontWeight:700}}>
                        {b.label} ${(activeBets[b.id]||0)+(currentBets[b.id]||0)}
                      </span>
                    ))
                }
              </div>
            </div>
          )}

          {/* Confirm */}
          <div style={{padding:'6px 12px',flexShrink:0,display:'flex',gap:6}}>
            {bettingOpen && pendingTotal > 0 && (
              <button onClick={()=>setCurrentBets({})}
                style={{padding:'10px 14px',borderRadius:7,fontSize:11,fontWeight:800,border:'1px solid rgba(239,68,68,0.4)',cursor:'pointer',fontFamily:'inherit',flexShrink:0,
                  background:'rgba(239,68,68,0.12)',color:'#f87171',
                }}>
                Clear
              </button>
            )}
            <button onClick={()=>confirmBets(false)} disabled={!bettingOpen||pendingTotal===0}
              style={{flex:1,padding:'10px',borderRadius:7,fontSize:12,fontWeight:800,border:'none',cursor:bettingOpen&&pendingTotal>0?'pointer':'default',fontFamily:'inherit',
                background:bettingOpen&&pendingTotal>0?'linear-gradient(135deg,#16a34a,#22c55e)':'rgba(255,255,255,0.05)',
                color:bettingOpen&&pendingTotal>0?'#fff':'rgba(136,146,164,0.3)',
                boxShadow:bettingOpen&&pendingTotal>0?'0 3px 12px rgba(34,197,94,0.3)':'none',
              }}>
              {bettingOpen?(pendingTotal>0?`Place $${pendingTotal}`:'Place a bet'):(betsConfirmed?'✓ Bets Placed':'Bets Locked')}
            </button>
          </div>

          {/* Bottom panel */}
          {(() => {
            const playerMsgs = chatMessages.filter(m => m.playerUid !== 'system');
            const tabList    = ['leaderboard','chat','history'];
            const tabLabels  = { leaderboard:'🏆 Board', chat:'💬 Chat', history:'📋 History' };

            const sec = (key, label, content, opts={}) => {
              const open = secOpen[key];
              return (
                <div style={{borderBottom:'1px solid rgba(255,255,255,0.05)'}}>
                  <div onClick={()=>toggleSec(key)}
                    style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'5px 10px',cursor:'pointer',userSelect:'none'}}>
                    <div style={{fontSize:8,color:'rgba(212,175,55,0.5)',fontWeight:700,letterSpacing:'1.5px'}}>{label}</div>
                    <span style={{color:'rgba(212,175,55,0.4)',fontSize:9}}>{open?'▲':'▼'}</span>
                  </div>
                  {open && <div style={{padding:'0 10px 6px'}}>{content}</div>}
                </div>
              );
            };

            const lbRows = (max,fs) => {
              if (leaderboard.length===0) return <div style={{color:'rgba(136,146,164,0.3)',fontSize:fs}}>No players yet</div>;
              const top10 = leaderboard.slice(0,10);
              const myRank = leaderboard.findIndex(p=>p.playerUid===playerUserId);
              const inTop10 = myRank!==-1 && myRank<10;
              const myEntry = myRank!==-1 ? leaderboard[myRank] : null;
              const renderRow = (p,i,opts={}) => (
                <div key={opts.key||p.playerUid||p.name} style={{display:'flex',alignItems:'center',gap:6,padding:'2px 0',borderBottom:`1px solid ${opts.divider?'rgba(212,175,55,0.15)':'rgba(255,255,255,0.04)'}`,background:opts.highlight?'rgba(212,175,55,0.05)':'transparent'}}>
                  <span style={{color:i===0?'#d4af37':'rgba(136,146,164,0.4)',fontSize:fs-1,width:14}}>{i===0?'👑':`${i+1}.`}</span>
                  <span style={{flex:1,color:p.playerUid===playerUserId?'#d4af37':'#d1d5db',fontSize:fs,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontWeight:p.playerUid===playerUserId?700:400}}>{p.name}</span>
                  <span style={{color:p.bankroll>=(startingChips||1000)?'#4ade80':'#f87171',fontSize:fs,fontWeight:700}}>${Math.round(p.bankroll).toLocaleString()}</span>
                </div>
              );
              return (
                <>
                  {top10.map((p,i)=>renderRow(p,i))}
                  {!inTop10 && myEntry && (
                    <>
                      <div style={{borderTop:'1px dashed rgba(212,175,55,0.2)',margin:'2px 0'}}/>
                      {renderRow(myEntry, myRank, {key:'me', highlight:true})}
                    </>
                  )}
                </>
              );
            };

            const chatScroll = (fs,height) => (
              <div style={{height,overflowY:'auto',marginBottom:0}}>
                {playerMsgs.length===0
                  ? <div style={{color:'rgba(136,146,164,0.3)',fontSize:fs}}>No messages yet</div>
                  : [...playerMsgs].slice(-30).map((m,i)=>(
                    <div key={i} style={{marginBottom:2}}>
                      <span style={{color:'#a78bfa',fontSize:fs,fontWeight:700}}>{m.userName}: </span>
                      <span style={{color:'#d1d5db',fontSize:fs}}>{m.text}</span>
                    </div>
                  ))
                }
                <div ref={chatEndRef}/>
              </div>
            );

            const histRows = (fs, height='130px') => (
              <div style={{height, overflowY:'auto'}}>
                {betHistory.length===0
                  ? <div style={{color:'rgba(136,146,164,0.3)',fontSize:fs}}>No bets yet</div>
                  : betHistory.map((h,i)=>{
                      const isWin=h.net>0, isPush=h.net===0;
                      const badge = isWin ? 'WIN' : isPush ? 'PUSH' : 'LOSS';
                      const badgeColor = isWin ? '#4ade80' : isPush ? '#a5b4fc' : '#f87171';
                      return (
                        <div key={i} style={{display:'flex',alignItems:'center',gap:5,padding:'3px 0',borderBottom:'1px solid rgba(255,255,255,0.04)'}}>
                          <span style={{fontSize:fs-1,fontWeight:700,color:badgeColor,minWidth:28,textAlign:'center',background:`${badgeColor}22`,borderRadius:3,padding:'1px 3px'}}>{badge}</span>
                          <span style={{flex:1,color:'#9ca3af',fontSize:fs,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{h.label}</span>
                          <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',flexShrink:0}}>
                            <span style={{fontSize:fs,fontWeight:700,color:badgeColor,lineHeight:1.2}}>{isWin?'+':isPush?'':'-'}${Math.abs(h.net)}</span>
                            <span style={{fontSize:fs-2,color:'rgba(156,163,175,0.5)',lineHeight:1.2}}>bet ${h.wagered||0}</span>
                          </div>
                        </div>
                      );
                    })
                }
                <div ref={histEndRef}/>
              </div>
            );

            const chatInput_ = (fs,pad) => (
              <div style={{display:'flex',gap:3,marginTop:4,flexShrink:0}}>
                <input value={chatInput} onChange={e=>setChatInput(e.target.value)} onKeyPress={e=>e.key==='Enter'&&sendChat()} placeholder="Message…"
                  style={{flex:1,padding:pad,background:'rgba(255,255,255,0.06)',border:'1px solid rgba(255,255,255,0.1)',borderRadius:4,color:'#fff',fontSize:fs,outline:'none',fontFamily:'inherit'}}/>
                <button onClick={sendChat} style={{padding:pad,background:'rgba(212,175,55,0.15)',border:'1px solid rgba(212,175,55,0.3)',borderRadius:4,color:'#d4af37',fontSize:fs,cursor:'pointer',fontFamily:'inherit'}}>Send</button>
              </div>
            );

            if (selectedGame !== 'craps') {
              return (
                <div style={{borderTop:'1px solid rgba(212,175,55,0.12)',flex:1,overflowY:'auto',minHeight:0}}>
                  {sec('leaderboard', '🏆 LEADERBOARD', lbRows(10,10))}
                  {sec('chat',        '💬 PLAYER CHAT',  <>{chatScroll(9,'120px')}{chatInput_(10,'3px 6px')}</>)}
                  {sec('history',     '📋 HISTORY',      histRows(9))}
                </div>
              );
            } else {
              return (
                <div style={{borderTop:'1px solid rgba(212,175,55,0.12)',flex:1,display:'flex',flexDirection:'column',minHeight:0}}>
                  <div style={{display:'flex',borderBottom:'1px solid rgba(255,255,255,0.06)',flexShrink:0}}>
                    {tabList.map(tab=>(
                      <button key={tab} onClick={()=>setActiveTab(tab)}
                        style={{flex:1,padding:'6px 2px',fontSize:8,fontWeight:700,letterSpacing:'0.5px',textTransform:'uppercase',border:'none',cursor:'pointer',fontFamily:'inherit',
                          background:activeTab===tab?'rgba(212,175,55,0.1)':'transparent',
                          color:activeTab===tab?'#d4af37':'rgba(136,146,164,0.4)',
                          borderBottom:activeTab===tab?'2px solid #d4af37':'2px solid transparent',
                        }}>
                        {tabLabels[tab]}
                      </button>
                    ))}
                  </div>
                  <div style={{flex:1,overflowY:'auto',padding:'6px 10px'}}>
                    {activeTab==='leaderboard' && lbRows(10,11)}
                    {activeTab==='chat'        && (
                      <div style={{display:'flex',flexDirection:'column',height:'100%'}}>
                        <div style={{flex:1,overflowY:'auto',marginBottom:4}}>{chatScroll(11,'100%')}</div>
                        {chatInput_(11,'4px 8px')}
                      </div>
                    )}
                    {activeTab==='history'     && histRows(11)}
                  </div>
                </div>
              );
            }
          })()}

        </div>
      </div>

      {/* Banner */}
      {banner&&(
        <div style={{position:'fixed',top:0,bottom:0,left:isMobile?0:'57%',right:0,display:'flex',alignItems:'center',justifyContent:'center',zIndex:500,pointerEvents:'none'}}>
          <div style={{padding:'20px 32px',borderRadius:16,textAlign:'center',maxWidth:280,
            background:banner.type==='win'?'rgba(16,185,129,0.15)':banner.type==='loss'?'rgba(239,68,68,0.15)':'rgba(99,102,241,0.15)',
            border:`2px solid ${banner.type==='win'?'rgba(16,185,129,0.6)':banner.type==='loss'?'rgba(239,68,68,0.6)':'rgba(99,102,241,0.5)'}`,
            backdropFilter:'blur(20px)',
            animation:banner.out?'lpOut 0.4s ease forwards':'lpIn 0.35s cubic-bezier(0.34,1.56,0.64,1) forwards',
          }}>
            <div style={{fontSize:'2rem',marginBottom:6}}>{banner.type==='win'?'🏆':banner.type==='loss'?'💸':'🤝'}</div>
            <div style={{fontSize:12,color:'rgba(212,212,212,0.7)',marginBottom:5}}>{banner.label}</div>
            {banner.amount!==0&&<div style={{fontSize:'1.75rem',fontWeight:900,color:banner.type==='win'?'#4ade80':banner.type==='loss'?'#f87171':'#a5b4fc'}}>{banner.type==='win'?'+':''}${Math.abs(banner.amount).toLocaleString()}</div>}
            <div style={{fontSize:11,color:'rgba(212,212,212,0.5)',marginTop:5}}>Balance: ${Math.round(bankroll).toLocaleString()}</div>
          </div>
        </div>
      )}
    </div>
  );
}
