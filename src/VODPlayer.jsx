// VODPlayer.jsx — Player view for a VOD session
//
// Timing model:
//   Each round has { resultAt, winner, revealDelay? }.
//   Betting windows are derived from adjacent timestamps:
//     round[0].betOpenAt  = vod.firstBetOpensAt  (dealer set, defaults 0)
//     round[N].betOpenAt  = round[N-1].resultAt
//     round[N].betCloseAt = round[N].resultAt
//     round[N].resolveAt  = round[N].resultAt + (round.revealDelay ?? vod.revealDelay ?? 5)
//
//   The YouTube player position drives everything — pausing freezes the
//   countdown naturally because countdown = betCloseAt - currentTime.

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { onValue, ref } from 'firebase/database';
import { database as db } from './firebase';
import { completeVOD, useVODLeaderboard, saveVODPlayerSession, loadVODPlayerSession, deleteVODPlayerSession } from './useFirebaseSync';

// ── YouTube IFrame API loader (shared singleton) ─────────────────────────────
let _ytLoading = false;
let _ytReady   = false;
const _ytCbs   = [];

function loadYouTubeAPI() {
  return new Promise((resolve) => {
    if (_ytReady && window.YT && window.YT.Player) { resolve(); return; }
    _ytCbs.push(resolve);
    if (!_ytLoading) {
      _ytLoading = true;
      window.onYouTubeIframeAPIReady = () => {
        _ytReady = true;
        _ytCbs.forEach(cb => cb());
        _ytCbs.length = 0;
      };
      if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
        const tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        document.head.appendChild(tag);
      }
    }
  });
}

// ── Baccarat bet resolution ──────────────────────────────────────────────────
function resolveBaccarat(winner, activeBets, bankrollAfterDeduction, odds) {
  const o = odds || {};
  let payout = 0;
  for (const [betType, amount] of Object.entries(activeBets || {})) {
    if (!amount || amount <= 0) continue;
    if (winner === 'tie' && (betType === 'player' || betType === 'banker')) {
      payout += amount; // push — return stake
    } else if (betType === winner) {
      if (betType === 'player') {
        const { num = 1, den = 1 } = o.player || {};
        payout += amount + Math.floor(amount * num / den);
      } else if (betType === 'banker') {
        const { num = 19, den = 20 } = o.banker || {};
        payout += amount + Math.floor(amount * num / den);
      } else if (betType === 'tie') {
        const { num = 8, den = 1 } = o.tie || {};
        payout += amount + Math.floor(amount * num / den);
      }
    }
  }
  return Math.max(0, bankrollAfterDeduction + payout);
}

// ── Roulette bet resolution ───────────────────────────────────────────────────
const ROULETTE_REDS = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
function resolveRoulette(spinResult, activeBets, bankrollAfterDeduction) {
  const n      = spinResult;
  const isZero = n === 0 || n === '00';
  const isRed  = !isZero && ROULETTE_REDS.has(Number(n));
  const isBlack= !isZero && !isRed;
  const num    = Number(n);
  let payout = 0;
  for (const [bt, amount] of Object.entries(activeBets || {})) {
    if (!amount || amount <= 0) continue;
    let ret = 0;
    if      (bt === 'red'   && isRed)                                   ret = amount * 2;
    else if (bt === 'black' && isBlack)                                 ret = amount * 2;
    else if (bt === 'odd'   && !isZero && num % 2 === 1)               ret = amount * 2;
    else if (bt === 'even'  && !isZero && num % 2 === 0)               ret = amount * 2;
    else if (bt === 'low'   && num >= 1 && num <= 18)                   ret = amount * 2;
    else if (bt === 'high'  && num >= 19 && num <= 36)                  ret = amount * 2;
    else if (bt === '1st12' && num >= 1  && num <= 12)                  ret = amount * 3;
    else if (bt === '2nd12' && num >= 13 && num <= 24)                  ret = amount * 3;
    else if (bt === '3rd12' && num >= 25 && num <= 36)                  ret = amount * 3;
    else if (bt === '0'     && n === 0)                                  ret = amount * 36;
    else if (bt === '00'    && n === '00')                               ret = amount * 36;
    else if (bt !== '00' && !isNaN(Number(bt)) && Number(bt) === num)   ret = amount * 36;
    payout += ret;
  }
  return Math.max(0, bankrollAfterDeduction + payout);
}

// ── Craps bet resolution ──────────────────────────────────────────────────────
function resolveCraps(roundData, activeBets, bankrollAfterDeduction) {
  const total      = (roundData.dice?.[0] || 0) + (roundData.dice?.[1] || 0);
  const crapsResult= roundData.result; // 'pass' | 'dontpass'
  let payout = 0;
  for (const [bt, amount] of Object.entries(activeBets || {})) {
    if (!amount || amount <= 0) continue;
    let ret = 0;
    if      (bt === 'pass'     && crapsResult === 'pass')      ret = amount * 2;
    else if (bt === 'dontpass' && crapsResult === 'dontpass')  ret = amount * 2;
    else if (bt === 'field') {
      if      ([3,4,9,10,11].includes(total)) ret = amount * 2;
      else if (total === 2)                   ret = amount * 3;
      else if (total === 12)                  ret = amount * 4;
    }
    else if (bt === 'any7'     && total === 7)                 ret = amount * 5;
    else if (bt === 'yo'       && total === 11)                ret = amount * 16;
    else if (bt === 'anyCraps' && [2,3,12].includes(total))   ret = amount * 8;
    payout += ret;
  }
  return Math.max(0, bankrollAfterDeduction + payout);
}

// ── Blackjack bet resolution ──────────────────────────────────────────────────
function resolveBlackjack(winner, activeBets, bankrollAfterDeduction) {
  let payout = 0;
  for (const [bt, amount] of Object.entries(activeBets || {})) {
    if (!amount || amount <= 0) continue;
    let ret = 0;
    if      (bt === 'player' && winner === 'player') ret = amount * 2;
    else if (bt === 'dealer' && winner === 'dealer') ret = amount * 2;
    else if (winner === 'push')                      ret = amount; // return stake
    payout += ret;
  }
  return Math.max(0, bankrollAfterDeduction + payout);
}

// ── Per-game bet config ───────────────────────────────────────────────────────
const GAME_BETS = {
  baccarat: {
    types:  ['player', 'banker', 'tie'],
    labels: { player: 'Player', banker: 'Banker', tie: 'Tie' },
    colors: { player: '#3b82f6', banker: '#ef4444', tie: '#22c55e' },
    rows:   [['player', 'banker', 'tie']],
  },
  roulette: {
    types:  ['red','black','odd','even','low','high','1st12','2nd12','3rd12'],
    labels: { red:'Red', black:'Black', odd:'Odd', even:'Even', low:'1–18', high:'19–36', '1st12':'1st 12', '2nd12':'2nd 12', '3rd12':'3rd 12' },
    colors: { red:'#ef4444', black:'#374151', odd:'#8b5cf6', even:'#6366f1', low:'#0ea5e9', high:'#0284c7', '1st12':'#d97706', '2nd12':'#b45309', '3rd12':'#92400e' },
    rows:   [['red','black','odd','even','low','high'], ['1st12','2nd12','3rd12']],
  },
  craps: {
    types:  ['pass','dontpass','field','any7','yo','anyCraps'],
    labels: { pass:'Pass Line', dontpass:"Don't Pass", field:'Field', any7:'Any 7', yo:'Yo (11)', anyCraps:'Any Craps' },
    colors: { pass:'#22c55e', dontpass:'#ef4444', field:'#3b82f6', any7:'#f59e0b', yo:'#8b5cf6', anyCraps:'#ec4899' },
    rows:   [['pass','dontpass'], ['field','any7','yo','anyCraps']],
  },
  blackjack: {
    types:  ['player', 'dealer'],
    labels: { player: 'Player Wins', dealer: 'Dealer Wins' },
    colors: { player: '#22c55e', dealer: '#ef4444' },
    rows:   [['player', 'dealer']],
  },
};

function getGameBets(game) { return GAME_BETS[game] || GAME_BETS.baccarat; }

function getResultDisplay(round) {
  const g = round.game || 'baccarat';
  if (g === 'baccarat') {
    const labels = { player: 'Player', banker: 'Banker', tie: 'Tie' };
    return `${labels[round.winner] || round.winner} wins`;
  }
  if (g === 'roulette') {
    const n = round.spinResult;
    const isZero = n === 0 || n === '00';
    const color  = isZero ? 'Green' : ROULETTE_REDS.has(Number(n)) ? 'Red' : 'Black';
    return `${n} — ${color}`;
  }
  if (g === 'craps') {
    const total = (round.dice?.[0] || 0) + (round.dice?.[1] || 0);
    const label = round.result === 'pass' ? 'Pass wins' : "Don't Pass wins";
    return `${round.dice?.[0]}+${round.dice?.[1]}=${total} — ${label}`;
  }
  if (g === 'blackjack') {
    if (round.winner === 'push') return 'Push';
    return `${round.winner === 'player' ? 'Player' : 'Dealer'} wins`;
  }
  return '';
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const CHIPS = [5, 10, 25, 50, 100, 250, 500];

function fmtMoney(n) { return '$' + Math.round(n).toLocaleString(); }

// ── Inject result animation CSS (always update so hot-reload or code changes apply) ──
if (typeof document !== 'undefined') {
  let s = document.getElementById('vod-result-anim-css');
  if (!s) { s = document.createElement('style'); s.id = 'vod-result-anim-css'; document.head.appendChild(s); }
  s.textContent = `
    @keyframes vodBannerIn  { from { opacity:0; transform:scale(0.85) translateY(12px); } to { opacity:1; transform:scale(1) translateY(0); } }
    @keyframes vodBannerOut { from { opacity:1; transform:scale(1); } to { opacity:0; transform:scale(0.95) translateY(-8px); } }
    @keyframes vodShake     { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-6px)} 40%{transform:translateX(6px)} 60%{transform:translateX(-4px)} 80%{transform:translateX(4px)} }
  `;
}

// ════════════════════════════════════════════════════════════════════════════════
export default function VODPlayer({ dealerUid, vodId, playerUid, playerName, onBack }) {
  const [vodData, setVodData]         = useState(null);
  const [rounds, setRounds]           = useState([]);   // pre-computed with betOpenAt/betCloseAt

  const [bankroll, setBankroll]       = useState(null);
  const bankrollRef                   = useRef(null);
  const [currentBets, setCurrentBets] = useState({});
  const activeBetsRef                 = useRef(null);
  const [selectedChip, setSelectedChip] = useState(25);

  // 'open' = betting open, player hasn't confirmed yet
  // 'waiting' = bets confirmed, waiting for result
  // null = no active round
  const [bettingPhase, setBettingPhase]   = useState(null);
  const [currentRound, setCurrentRound]   = useState(null);
  const [countdownLeft, setCountdownLeft] = useState(0);

  const firedRef    = useRef(new Set());   // indices that have opened
  const lockedRef   = useRef(new Set());   // indices where bets are locked (betCloseAt passed)
  const resolvedRef = useRef(new Set());   // indices that have resolved (resolveAt passed)

  const [resultBanner, setResultBanner]   = useState(null);  // { net, winner, totalBet, exiting }
  const [completed, setCompleted]         = useState(false);
  const completedRef                      = useRef(false);
  const [restarting, setRestarting]       = useState(false);

  const ytPlayerRef    = useRef(null);
  const [ytReady, setYtReady] = useState(false);  // true once YT onReady fires
  const pollRef        = useRef(null);
  const playerDivRef   = useRef(null);
  const lastTimeRef    = useRef(0);   // tracks furthest position reached — blocks backward seeks

  // Refs that shadow mutable state — keep processTime stable (no closure on state)
  const oddsRef         = useRef(null);
  const currentRoundRef = useRef(null);
  const currentBetsRef  = useRef({});   // mirrors currentBets state — readable inside processTime

  const leaderboard = useVODLeaderboard(dealerUid, vodId);

  // ── Load VOD data + restore player session ────────────────────────────────
  useEffect(() => {
    if (!dealerUid || !vodId) return;
    const unsub = onValue(ref(db, `rooms/${dealerUid}/vods/${vodId}`), async (snap) => {
      if (!snap.exists()) return;
      const data = snap.val();
      setVodData(data);

      // Use VOD-specific odds; fall back to standard baccarat defaults
      oddsRef.current = data.odds || null;

      // Build rounds array with derived betting windows
      const raw = data.script
        ? Object.values(data.script).sort((a, b) => a.resultAt - b.resultAt)
        : [];
      const firstBetOpensAt = data.firstBetOpensAt ?? 0;
      const vodRevealDelay  = data.revealDelay ?? 20;
      const parsed = raw.map((r, i) => {
        const prevResolveAt = i === 0 ? firstBetOpensAt : raw[i - 1].resultAt + (raw[i - 1].revealDelay ?? vodRevealDelay);
        return {
          ...r,
          index:      i,
          betOpenAt:  prevResolveAt,
          betCloseAt: r.resultAt,
          resolveAt:  r.resultAt + (r.revealDelay ?? vodRevealDelay),
        };
      });
      setRounds(parsed);

      // Restore saved session if it exists; otherwise start fresh
      if (bankrollRef.current == null) {
        const saved = await loadVODPlayerSession(dealerUid, vodId, playerUid);
        if (saved) {
          bankrollRef.current = saved.bankroll;
          setBankroll(saved.bankroll);
          firedRef.current    = saved.firedIndices;
          lockedRef.current   = saved.lockedIndices;
          resolvedRef.current = saved.resolvedIndices;
          lastTimeRef.current = saved.lastTime;
        } else {
          const startingChips = data.startingChips || 1000;
          bankrollRef.current = startingChips;
          setBankroll(startingChips);
        }
      }
    }, { onlyOnce: true });
    return () => unsub();
  }, [dealerUid, vodId, playerUid]);

  // ── Core: process current video time ──────────────────────────────────────
  // No state in deps — uses refs for odds and currentRound so the callback
  // identity stays stable and never causes the poll interval to restart.
  const processTime = useCallback((currentTime, roundsSnap) => {
    if (completedRef.current) return;

    for (const round of roundsSnap) {
      const idx = round.index;

      // Open betting
      if (currentTime >= round.betOpenAt && !firedRef.current.has(idx)) {
        firedRef.current.add(idx);
        currentRoundRef.current = round;
        setBettingPhase('open');
        setCurrentRound(round);
        activeBetsRef.current = null;
      }

      // Lock bets at betCloseAt — auto-confirm any unconfirmed bets the player placed
      if (currentTime >= round.betCloseAt && firedRef.current.has(idx) && !lockedRef.current.has(idx)) {
        lockedRef.current.add(idx);
        // If player placed chips but didn't click Confirm, auto-confirm them now
        if (activeBetsRef.current === null && Object.keys(currentBetsRef.current).length > 0) {
          const pending = currentBetsRef.current;
          const total = Object.values(pending).reduce((s, v) => s + (v || 0), 0);
          if (total > 0) {
            const newBankroll = (bankrollRef.current ?? 0) - total;
            bankrollRef.current = newBankroll;
            setBankroll(newBankroll);
            activeBetsRef.current = { ...pending };
            currentBetsRef.current = {};
            setCurrentBets({});
          }
        }
        setBettingPhase('waiting');
      }

      // Reveal result at resolveAt
      if (currentTime >= round.resolveAt && lockedRef.current.has(idx) && !resolvedRef.current.has(idx)) {
        resolvedRef.current.add(idx);

        const locked      = activeBetsRef.current || {};
        const before      = bankrollRef.current ?? 0;
        const game        = round.game || 'baccarat';
        let newBankroll;
        if (game === 'baccarat') {
          newBankroll = resolveBaccarat(round.winner, locked, before, oddsRef.current);
        } else if (game === 'roulette') {
          newBankroll = resolveRoulette(round.spinResult, locked, before);
        } else if (game === 'craps') {
          newBankroll = resolveCraps(round, locked, before);
        } else if (game === 'blackjack') {
          newBankroll = resolveBlackjack(round.winner, locked, before);
        } else {
          newBankroll = before;
        }
        bankrollRef.current = newBankroll;
        setBankroll(newBankroll);

        const totalBet = Object.values(locked).reduce((s, v) => s + (v || 0), 0);
        const net = newBankroll - (before + totalBet);
        setResultBanner({ net, game, resultDisplay: getResultDisplay(round), totalBet, exiting: false });

        currentRoundRef.current = null;
        currentBetsRef.current = {};
        setBettingPhase(null);
        setCurrentRound(null);
        activeBetsRef.current = null;
        setCurrentBets({});

        // Fade-out then clear
        setTimeout(() => setResultBanner(b => b ? { ...b, exiting: true } : null), 3000);
        setTimeout(() => setResultBanner(null), 3500);
      }
    }

    // Live countdown — read from ref, no state dependency
    if (currentRoundRef.current) {
      setCountdownLeft(Math.max(0, Math.ceil(currentRoundRef.current.betCloseAt - currentTime)));
    }
  }, []);  // stable — all mutable data accessed via refs

  // ── Handle video ended ─────────────────────────────────────────────────────
  const handleVideoEnded = useCallback(async () => {
    if (completedRef.current) return;
    completedRef.current = true;
    setCompleted(true);
    setBettingPhase(null);
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    try {
      await completeVOD(dealerUid, vodId, playerUid, playerName, bankrollRef.current ?? 0);
    } catch (e) {
      console.error('Failed to record VOD completion:', e);
    }
  }, [dealerUid, vodId, playerUid, playerName]);

  // ── Restart session ────────────────────────────────────────────────────────
  const restartSession = useCallback(async () => {
    setRestarting(true);
    try { await deleteVODPlayerSession(dealerUid, vodId, playerUid); } catch (_) {}
    // Reset all in-memory state
    const startingChips = vodData?.startingChips || 1000;
    bankrollRef.current     = startingChips;
    firedRef.current        = new Set();
    lockedRef.current       = new Set();
    resolvedRef.current     = new Set();
    lastTimeRef.current     = 0;
    completedRef.current    = false;
    activeBetsRef.current   = null;
    setBankroll(startingChips);
    setCompleted(false);
    setBettingPhase(null);
    currentBetsRef.current = {};
    currentRoundRef.current = null;
    setCurrentRound(null);
    setCurrentBets({});
    setResultBanner(null);
    // Seek YouTube back to start and restart poll
    if (ytPlayerRef.current) {
      try { ytPlayerRef.current.seekTo(0, true); ytPlayerRef.current.playVideo(); } catch (_) {}
    }
    setRestarting(false);
  }, [dealerUid, vodId, playerUid, vodData]);

  // ── Init YouTube player once VOD data arrives ──────────────────────────────
  useEffect(() => {
    if (!vodData?.youtubeVideoId || !playerDivRef.current) return;
    let player;
    let cancelled = false;

    loadYouTubeAPI().then(() => {
      if (cancelled || !playerDivRef.current) return;
      const containerId = `vod-ytplayer-${vodId}`;
      let el = document.getElementById(containerId);
      if (!el) {
        el = document.createElement('div');
        el.id = containerId;
        playerDivRef.current.appendChild(el);
      }
      player = new window.YT.Player(containerId, {
        videoId: vodData.youtubeVideoId,
        width: '100%',
        height: '100%',
        playerVars: { rel: 0, modestbranding: 1, playsinline: 1 },
        events: {
          onReady: () => { ytPlayerRef.current = player; setYtReady(true); },
          onStateChange: (e) => {
            if (e.data === window.YT.PlayerState.ENDED) handleVideoEnded();
          },
        },
      });
    });

    return () => {
      cancelled = true;
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      if (player) { try { player.destroy(); } catch (_) {} }
      ytPlayerRef.current = null;
      setYtReady(false);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vodData?.youtubeVideoId]);

  // ── Persist player session every 10 s ─────────────────────────────────────
  useEffect(() => {
    if (!dealerUid || !vodId || !playerUid) return;
    const id = setInterval(() => {
      if (completedRef.current || bankrollRef.current == null) return;
      saveVODPlayerSession(dealerUid, vodId, playerUid, {
        bankroll:        bankrollRef.current,
        firedIndices:    firedRef.current,
        lockedIndices:   lockedRef.current,
        resolvedIndices: resolvedRef.current,
        lastTime:        lastTimeRef.current,
      }).catch(() => {});
    }, 10000);
    return () => clearInterval(id);
  }, [dealerUid, vodId, playerUid]);

  // ── Single poll: starts once YT is ready AND rounds are loaded ───────────────
  // processTime is stable ([] deps), rounds only changes once on load,
  // ytReady flips once — so this effect fires exactly once in normal operation.
  useEffect(() => {
    if (!ytReady || rounds.length === 0) return;
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => {
      if (!ytPlayerRef.current) return;
      try {
        const t = ytPlayerRef.current.getCurrentTime();
        if (t < lastTimeRef.current - 1) {
          ytPlayerRef.current.seekTo(lastTimeRef.current, true);
          return;
        }
        if (t > lastTimeRef.current) lastTimeRef.current = t;
        processTime(t, rounds);
      } catch (_) {}
    }, 250);
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [ytReady, rounds, processTime]);

  // ── Betting actions ────────────────────────────────────────────────────────
  const placeBet = (betType) => {
    if (bettingPhase !== 'open') return;
    if ((bankroll ?? 0) < selectedChip) return;
    setCurrentBets(prev => {
      const next = { ...prev, [betType]: (prev[betType] || 0) + selectedChip };
      currentBetsRef.current = next;
      return next;
    });
  };

  const confirmBets = () => {
    if (bettingPhase !== 'open') return;
    const total = Object.values(currentBets).reduce((s, v) => s + v, 0);
    if (total === 0) return;
    const newBankroll = (bankrollRef.current ?? 0) - total;
    bankrollRef.current = newBankroll;
    setBankroll(newBankroll);
    activeBetsRef.current = { ...currentBets };
    currentBetsRef.current = {};
    setCurrentBets({});
    setBettingPhase('waiting');
  };

  // ── Loading ────────────────────────────────────────────────────────────────
  if (!vodData) {
    return (
      <div style={{ minHeight: '100vh', background: '#080b1a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#d4af37', fontSize: '13px', letterSpacing: '3px' }}>LOADING VOD...</div>
      </div>
    );
  }

  // ── Completion screen ──────────────────────────────────────────────────────
  if (completed) {
    const startingChips = vodData.startingChips || 1000;
    const finalBankroll = bankrollRef.current ?? 0;
    const pnl           = Math.round(finalBankroll - startingChips);

    return (
      <div style={{ minHeight: '100vh', background: 'radial-gradient(ellipse at 50% 0%, rgba(212,175,55,0.08) 0%, transparent 60%), #080b1a', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
        <div style={{ maxWidth: '480px', width: '100%', textAlign: 'center' }}>
          <div style={{ fontSize: '3rem', marginBottom: '16px' }}>🏆</div>
          <h2 style={{ fontSize: '1.75rem', fontWeight: 'bold', color: '#d4af37', marginBottom: '8px', letterSpacing: '2px' }}>VOD COMPLETE</h2>
          <p style={{ color: '#8892a4', fontSize: '13px', marginBottom: '32px' }}>{vodData.title}</p>

          <div style={{ border: `2px solid ${pnl >= 0 ? '#4caf50' : '#ef5350'}`, borderRadius: '14px', padding: '24px', marginBottom: '28px', background: pnl >= 0 ? 'rgba(76,175,80,0.08)' : 'rgba(239,83,80,0.08)' }}>
            <div style={{ color: 'rgba(136,146,164,0.6)', fontSize: '11px', letterSpacing: '2px', marginBottom: '10px' }}>YOUR RESULT</div>
            <div style={{ fontSize: '2.5rem', fontWeight: 'bold', color: pnl >= 0 ? '#4ade80' : '#f87171', marginBottom: '6px' }}>
              {pnl >= 0 ? '+' : ''}{fmtMoney(pnl)}
            </div>
            <div style={{ color: '#8892a4', fontSize: '13px' }}>Final balance: {fmtMoney(finalBankroll)}</div>
          </div>

          {leaderboard.length > 0 && (
            <div style={{ background: 'rgba(12,15,35,0.7)', border: '1px solid rgba(212,175,55,0.12)', borderRadius: '14px', padding: '20px', marginBottom: '24px', textAlign: 'left' }}>
              <div style={{ color: '#d4af37', fontSize: '11px', fontWeight: '700', letterSpacing: '2px', marginBottom: '14px' }}>📋 VOD LEADERBOARD</div>
              {leaderboard.slice(0, 10).map((entry, i) => {
                const entryPnl = Math.round(entry.bankroll - startingChips);
                const isMe     = entry.playerUid === playerUid;
                return (
                  <div key={entry.playerUid} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                      <span style={{ fontSize: '13px', width: '22px', color: i === 0 ? '#d4af37' : i === 1 ? '#9ca3af' : i === 2 ? '#cd7f32' : 'rgba(136,146,164,0.4)' }}>
                        {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
                      </span>
                      <span style={{ color: isMe ? '#d4af37' : 'rgba(255,255,255,0.75)', fontSize: '13px', fontWeight: isMe ? '700' : '400' }}>
                        {entry.name}{isMe ? ' (you)' : ''}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                      <span style={{ color: '#fff', fontSize: '13px', fontWeight: '700' }}>{fmtMoney(entry.bankroll)}</span>
                      <span style={{ fontSize: '12px', minWidth: '50px', textAlign: 'right', color: entryPnl >= 0 ? '#4ade80' : '#f87171', fontWeight: '600' }}>
                        {entryPnl >= 0 ? '+' : ''}{fmtMoney(entryPnl)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={restartSession} disabled={restarting} style={{ padding: '12px 28px', background: restarting ? 'rgba(255,255,255,0.04)' : 'linear-gradient(135deg,#d4af37,#f4e5a1)', border: 'none', borderRadius: '10px', color: restarting ? '#555' : '#000', fontSize: '13px', fontWeight: '800', cursor: restarting ? 'not-allowed' : 'pointer' }}>
              {restarting ? 'Restarting...' : '↺ Play Again'}
            </button>
            <button onClick={onBack} style={{ padding: '12px 28px', background: 'rgba(212,175,55,0.1)', border: '1px solid rgba(212,175,55,0.3)', borderRadius: '10px', color: '#d4af37', fontSize: '13px', fontWeight: '700', cursor: 'pointer' }}>
              ← Back to Lobby
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Main player UI ─────────────────────────────────────────────────────────
  const totalCurrentBet = Object.values(currentBets).reduce((s, v) => s + v, 0);

  return (
    <div style={{ minHeight: '100vh', background: '#080b1a', display: 'flex', flexDirection: 'column' }}>

      {/* Top bar */}
      <div style={{ position: 'sticky', top: 0, zIndex: 50, background: 'rgba(8,11,26,0.92)', backdropFilter: 'blur(16px)', borderBottom: '1px solid rgba(212,175,55,0.1)', padding: '0 20px', display: 'flex', alignItems: 'center', gap: '16px', height: '52px' }}>
        <button onClick={onBack} style={{ padding: '5px 12px', background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: 'rgba(136,146,164,0.6)', fontSize: '12px', cursor: 'pointer' }}>
          ← Exit
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ color: '#d4af37', fontSize: '13px', fontWeight: '700', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{vodData.title}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          <span style={{ color: 'rgba(136,146,164,0.5)', fontSize: '11px' }}>{playerName}</span>
          <div style={{ padding: '4px 12px', background: 'rgba(212,175,55,0.1)', border: '1px solid rgba(212,175,55,0.25)', borderRadius: '20px', color: '#d4af37', fontSize: '13px', fontWeight: '800' }}>
            {bankroll != null ? fmtMoney(bankroll) : '...'}
          </div>
          <button onClick={restartSession} disabled={restarting} title="Restart session" style={{ padding: '4px 10px', background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: 'rgba(136,146,164,0.5)', fontSize: '12px', cursor: restarting ? 'not-allowed' : 'pointer' }}>
            ↺
          </button>
        </div>
      </div>

      {/* Video + betting */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', maxWidth: '900px', width: '100%', margin: '0 auto', padding: '16px' }}>

        {/* YouTube embed */}
        <div ref={playerDivRef} style={{ width: '100%', aspectRatio: '16/9', background: '#000', borderRadius: '12px', overflow: 'hidden', marginBottom: '16px' }} />

        {/* Result banner — animated, sits in the betting area */}
        {resultBanner && (() => {
          const hasBet  = resultBanner.totalBet > 0;
          const win     = hasBet && resultBanner.net > 0;
          const isPush  = hasBet && resultBanner.net === 0;
          const lose    = hasBet && resultBanner.net < 0;
          const color   = win ? '#4ade80' : isPush ? '#d4af37' : lose ? '#f87171' : 'rgba(136,146,164,0.5)';
          const bg      = win ? 'rgba(74,222,128,0.1)' : isPush ? 'rgba(212,175,55,0.08)' : lose ? 'rgba(248,113,113,0.1)' : 'rgba(255,255,255,0.04)';
          const border  = win ? 'rgba(74,222,128,0.4)' : isPush ? 'rgba(212,175,55,0.3)' : lose ? 'rgba(248,113,113,0.4)' : 'rgba(255,255,255,0.08)';
          const glow    = win ? '0 0 32px rgba(74,222,128,0.25)' : lose ? '0 0 32px rgba(248,113,113,0.2)' : 'none';
          const emoji   = win ? '🏆' : isPush ? '🤝' : lose ? '💸' : null;
          const label   = win ? 'YOU WIN' : isPush ? 'PUSH' : lose ? 'YOU LOSE' : null;
          const anim    = resultBanner.exiting ? 'vodBannerOut 0.5s ease-in forwards' : (lose ? 'vodBannerIn 0.35s cubic-bezier(0.34,1.56,0.64,1) forwards, vodShake 0.4s ease 0.35s' : 'vodBannerIn 0.35s cubic-bezier(0.34,1.56,0.64,1) forwards');
          return (
            <div style={{
              marginBottom: '16px', borderRadius: '14px', textAlign: 'center',
              padding: hasBet ? '24px 20px' : '14px 20px',
              background: bg, border: `2px solid ${border}`,
              boxShadow: glow, animation: anim,
            }}>
              {hasBet ? (
                <>
                  <div style={{ fontSize: '40px', lineHeight: 1, marginBottom: '8px' }}>{emoji}</div>
                  <div style={{ fontSize: '14px', fontWeight: '800', color, letterSpacing: '3px', marginBottom: '6px' }}>{label}</div>
                  <div style={{ fontSize: '2rem', fontWeight: '900', color }}>
                    {resultBanner.net > 0 ? '+' : ''}{fmtMoney(resultBanner.net)}
                  </div>
                  <div style={{ fontSize: '11px', color: 'rgba(136,146,164,0.5)', letterSpacing: '1px', marginTop: '6px' }}>
                    {resultBanner.resultDisplay}
                  </div>
                </>
              ) : (
                <div style={{ fontSize: '12px', color: 'rgba(136,146,164,0.4)', letterSpacing: '2px' }}>
                  {resultBanner.resultDisplay} · no bets placed
                </div>
              )}
            </div>
          );
        })()}

        {/* Betting panel */}
        {(bettingPhase === 'open' || bettingPhase === 'waiting') && currentRound && (
          <div style={{ background: 'rgba(12,15,35,0.8)', backdropFilter: 'blur(20px)', border: '1px solid rgba(212,175,55,0.2)', borderRadius: '14px', padding: '20px' }}>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: bettingPhase === 'open' ? '#4ade80' : '#d4af37', boxShadow: `0 0 8px ${bettingPhase === 'open' ? 'rgba(74,222,128,0.8)' : 'rgba(212,175,55,0.8)'}` }} className="animate-pulse" />
                <span style={{ color: bettingPhase === 'open' ? '#4ade80' : '#d4af37', fontSize: '12px', fontWeight: '700', letterSpacing: '1px' }}>
                  {bettingPhase === 'open' ? 'BETTING OPEN' : 'BETS LOCKED IN'}
                </span>
              </div>
              {bettingPhase === 'open' && (
                <div style={{ fontSize: '1.25rem', fontWeight: '800', color: countdownLeft <= 10 ? '#f87171' : '#fff' }}>
                  {countdownLeft}s
                </div>
              )}
            </div>

            {bettingPhase === 'open' && (
              <>
                {/* Chip selector */}
                <div style={{ marginBottom: '14px' }}>
                  <div style={{ color: 'rgba(136,146,164,0.5)', fontSize: '10px', letterSpacing: '2px', marginBottom: '8px' }}>SELECT CHIP</div>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {CHIPS.map(c => {
                      const canAfford = (bankroll ?? 0) >= c;
                      return (
                        <button
                          key={c}
                          onClick={() => canAfford && setSelectedChip(c)}
                          disabled={!canAfford}
                          style={{
                            padding: '7px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: '700', cursor: canAfford ? 'pointer' : 'not-allowed', border: '1px solid',
                            background: selectedChip === c ? '#d4af37' : canAfford ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.02)',
                            borderColor: selectedChip === c ? '#d4af37' : canAfford ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)',
                            color: selectedChip === c ? '#000' : canAfford ? 'rgba(136,146,164,0.8)' : 'rgba(136,146,164,0.2)',
                          }}
                        >
                          ${c}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Bet buttons — layout adapts to current round's game */}
                {(() => {
                  const gb = getGameBets(currentRound?.game);
                  const canBet = (bankroll ?? 0) >= selectedChip;
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '14px' }}>
                      {gb.rows.map((row, ri) => (
                        <div key={ri} style={{ display: 'flex', gap: '8px' }}>
                          {row.map(bt => {
                            const betAmt = currentBets[bt] || 0;
                            return (
                              <button
                                key={bt}
                                onClick={() => placeBet(bt)}
                                disabled={!canBet}
                                style={{
                                  flex: 1, padding: '12px 6px', borderRadius: '10px', cursor: canBet ? 'pointer' : 'not-allowed',
                                  background: betAmt > 0 ? gb.colors[bt] : 'rgba(255,255,255,0.04)',
                                  border: `2px solid ${betAmt > 0 ? gb.colors[bt] : 'rgba(255,255,255,0.1)'}`,
                                  color: betAmt > 0 ? '#fff' : 'rgba(136,146,164,0.7)',
                                  textAlign: 'center',
                                }}
                              >
                                <div style={{ fontSize: '12px', fontWeight: '800', marginBottom: betAmt > 0 ? '3px' : 0 }}>{gb.labels[bt]}</div>
                                {betAmt > 0 && <div style={{ fontSize: '11px', fontWeight: '700' }}>{fmtMoney(betAmt)}</div>}
                              </button>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  );
                })()}

                {/* Confirm / clear */}
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={confirmBets}
                    disabled={totalCurrentBet === 0}
                    style={{
                      flex: 1, padding: '11px', borderRadius: '8px', fontSize: '13px', fontWeight: '800', cursor: totalCurrentBet > 0 ? 'pointer' : 'not-allowed', border: 'none',
                      background: totalCurrentBet > 0 ? 'linear-gradient(135deg, #22c55e, #4ade80)' : '#1a2a1a',
                      color: totalCurrentBet > 0 ? '#000' : 'rgba(136,146,164,0.3)',
                    }}
                  >
                    {totalCurrentBet > 0 ? `Confirm — ${fmtMoney(totalCurrentBet)}` : 'Place a bet'}
                  </button>
                  {totalCurrentBet > 0 && (
                    <button onClick={() => { currentBetsRef.current = {}; setCurrentBets({}); }} style={{ padding: '11px 14px', background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: 'rgba(136,146,164,0.6)', fontSize: '13px', cursor: 'pointer' }}>
                      Clear
                    </button>
                  )}
                </div>
              </>
            )}

            {bettingPhase === 'waiting' && (
              <div style={{ textAlign: 'center', padding: '8px 0' }}>
                <div style={{ color: '#d4af37', fontSize: '13px', marginBottom: '6px' }}>
                  Bets locked in · {fmtMoney(Object.values(activeBetsRef.current || {}).reduce((s, v) => s + (v || 0), 0))} wagered
                </div>
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' }}>
                  {(() => {
                    const gb = getGameBets(currentRound?.game);
                    return Object.entries(activeBetsRef.current || {}).map(([bt, amt]) =>
                      amt > 0 ? (
                        <span key={bt} style={{ padding: '4px 10px', background: gb.colors[bt] || '#555', borderRadius: '20px', fontSize: '12px', fontWeight: '700', color: '#fff' }}>
                          {gb.labels[bt] || bt} {fmtMoney(amt)}
                        </span>
                      ) : null
                    );
                  })()}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Idle */}
        {!bettingPhase && !resultBanner && rounds.length > 0 && (
          <div style={{ background: 'rgba(12,15,35,0.5)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#d4af37', flexShrink: 0 }} className="animate-pulse" />
            <div>
              <div style={{ color: 'rgba(136,146,164,0.6)', fontSize: '12px' }}>
                Watching · {rounds.length} betting {rounds.length === 1 ? 'round' : 'rounds'} in this VOD
              </div>
              <div style={{ color: 'rgba(136,146,164,0.3)', fontSize: '11px', marginTop: '2px' }}>
                Betting opens automatically — just watch.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
