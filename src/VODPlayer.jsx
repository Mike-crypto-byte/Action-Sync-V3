// VODPlayer.jsx — Player view for a VOD session
//
// Timing model:
//   Each round has { resultAt, winner }.
//   Betting windows are derived from adjacent timestamps:
//     round[0].betOpenAt  = vod.firstBetOpensAt  (dealer set, defaults 0)
//     round[N].betOpenAt  = round[N-1].resultAt
//     round[N].betCloseAt = round[N].resultAt
//
//   The YouTube player position drives everything — pausing freezes the
//   countdown naturally because countdown = betCloseAt - currentTime.

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { onValue, ref } from 'firebase/database';
import { database as db } from './firebase';
import { completeVOD, useVODLeaderboard, saveVODPlayerSession, loadVODPlayerSession } from './useFirebaseSync';

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

// ── Helpers ──────────────────────────────────────────────────────────────────
const CHIPS       = [5, 10, 25, 50, 100, 250, 500];
const WINNER_LABEL = { player: 'Player', banker: 'Banker', tie: 'Tie' };
const WINNER_COLOR = { player: '#3b82f6', banker: '#ef4444', tie: '#22c55e' };
const BET_TYPES   = ['player', 'banker', 'tie'];

function fmtMoney(n) { return '$' + Math.round(n).toLocaleString(); }

// ════════════════════════════════════════════════════════════════════════════════
export default function VODPlayer({ dealerUid, vodId, playerUid, playerName, onBack }) {
  const [vodData, setVodData]         = useState(null);
  const [rounds, setRounds]           = useState([]);   // pre-computed with betOpenAt/betCloseAt
  const [odds, setOdds]               = useState(null);

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

  const [resultBanner, setResultBanner] = useState(null);
  const [completed, setCompleted]       = useState(false);
  const completedRef                    = useRef(false);

  const ytPlayerRef    = useRef(null);
  const pollRef        = useRef(null);
  const playerDivRef   = useRef(null);
  const lastTimeRef    = useRef(0);   // tracks furthest position reached — blocks backward seeks

  const leaderboard = useVODLeaderboard(dealerUid, vodId);

  // ── Load VOD data + restore player session ────────────────────────────────
  useEffect(() => {
    if (!dealerUid || !vodId) return;
    const unsub = onValue(ref(db, `rooms/${dealerUid}/vods/${vodId}`), async (snap) => {
      if (!snap.exists()) return;
      const data = snap.val();
      setVodData(data);

      // Use VOD-specific odds; fall back to standard baccarat defaults
      setOdds(data.odds || null);

      // Build rounds array with derived betting windows
      const raw = data.script
        ? Object.values(data.script).sort((a, b) => a.resultAt - b.resultAt)
        : [];
      const firstBetOpensAt = data.firstBetOpensAt ?? 0;
      const parsed = raw.map((r, i) => ({
        ...r,
        index:      i,
        betOpenAt:  i === 0 ? firstBetOpensAt : raw[i - 1].resultAt,
        betCloseAt: r.resultAt,
        resolveAt:  r.resultAt + 5,
      }));
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
  const processTime = useCallback((currentTime, roundsSnap) => {
    if (completedRef.current) return;

    for (const round of roundsSnap) {
      const idx = round.index;

      // Open betting
      if (currentTime >= round.betOpenAt && !firedRef.current.has(idx)) {
        firedRef.current.add(idx);
        setBettingPhase('open');
        setCurrentRound(round);
        activeBetsRef.current = null;
      }

      // Lock bets at betCloseAt — switch to 'waiting', freeze bet UI
      if (currentTime >= round.betCloseAt && firedRef.current.has(idx) && !lockedRef.current.has(idx)) {
        lockedRef.current.add(idx);
        setBettingPhase('waiting');
      }

      // Reveal result 5 s later at resolveAt
      if (currentTime >= round.resolveAt && lockedRef.current.has(idx) && !resolvedRef.current.has(idx)) {
        resolvedRef.current.add(idx);

        const locked      = activeBetsRef.current || {};
        const before      = bankrollRef.current ?? 0;
        const newBankroll = resolveBaccarat(round.winner, locked, before, odds);
        bankrollRef.current = newBankroll;
        setBankroll(newBankroll);

        const totalBet = Object.values(locked).reduce((s, v) => s + (v || 0), 0);
        setResultBanner({ net: newBankroll - before, winner: round.winner, totalBet });

        setBettingPhase(null);
        setCurrentRound(null);
        activeBetsRef.current = null;
        setCurrentBets({});

        setTimeout(() => setResultBanner(null), 4000);
      }
    }

    // Live countdown update
    if (currentRound) {
      setCountdownLeft(Math.max(0, Math.ceil(currentRound.betCloseAt - currentTime)));
    }
  }, [currentRound, odds]);

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
          onReady: () => { ytPlayerRef.current = player; },
          onStateChange: (e) => {
            if (e.data === window.YT.PlayerState.ENDED) handleVideoEnded();
          },
        },
      });

      pollRef.current = setInterval(() => {
        if (!ytPlayerRef.current) return;
        try {
          const t = ytPlayerRef.current.getCurrentTime();
          // Block backward seeks — snap player forward to furthest reached position
          if (t < lastTimeRef.current - 1) {
            ytPlayerRef.current.seekTo(lastTimeRef.current, true);
            return;
          }
          if (t > lastTimeRef.current) lastTimeRef.current = t;
          processTime(t, rounds);
        } catch (_) {}
      }, 500);
    });

    return () => {
      cancelled = true;
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      if (player) { try { player.destroy(); } catch (_) {} }
      ytPlayerRef.current = null;
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

  // Re-attach poll when rounds or processTime changes (e.g. odds load after player ready)
  useEffect(() => {
    if (!ytPlayerRef.current) return;
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
    }, 500);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [rounds, processTime]);

  // ── Betting actions ────────────────────────────────────────────────────────
  const placeBet = (betType) => {
    if (bettingPhase !== 'open') return;
    if ((bankroll ?? 0) < selectedChip) return;
    setCurrentBets(prev => ({ ...prev, [betType]: (prev[betType] || 0) + selectedChip }));
  };

  const confirmBets = () => {
    if (bettingPhase !== 'open') return;
    const total = Object.values(currentBets).reduce((s, v) => s + v, 0);
    if (total === 0) return;
    const newBankroll = (bankrollRef.current ?? 0) - total;
    bankrollRef.current = newBankroll;
    setBankroll(newBankroll);
    activeBetsRef.current = { ...currentBets };
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

          <button onClick={onBack} style={{ padding: '12px 32px', background: 'rgba(212,175,55,0.1)', border: '1px solid rgba(212,175,55,0.3)', borderRadius: '10px', color: '#d4af37', fontSize: '13px', fontWeight: '700', cursor: 'pointer' }}>
            ← Back to Lobby
          </button>
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
        </div>
      </div>

      {/* Video + betting */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', maxWidth: '900px', width: '100%', margin: '0 auto', padding: '16px' }}>

        {/* YouTube embed */}
        <div ref={playerDivRef} style={{ width: '100%', aspectRatio: '16/9', background: '#000', borderRadius: '12px', overflow: 'hidden', marginBottom: '16px' }} />

        {/* Result banner */}
        {resultBanner && (
          <div style={{
            marginBottom: '16px', padding: '16px 20px', borderRadius: '12px', textAlign: 'center',
            background: resultBanner.net > 0 ? 'rgba(76,175,80,0.15)' : resultBanner.net === 0 ? 'rgba(212,175,55,0.1)' : 'rgba(239,68,68,0.12)',
            border: `1px solid ${resultBanner.net > 0 ? 'rgba(76,175,80,0.4)' : resultBanner.net === 0 ? 'rgba(212,175,55,0.3)' : 'rgba(239,68,68,0.4)'}`,
          }}>
            <div style={{ fontSize: '12px', color: 'rgba(136,146,164,0.7)', letterSpacing: '2px', marginBottom: '6px' }}>
              {WINNER_LABEL[resultBanner.winner]} wins
            </div>
            <div style={{ fontSize: '1.75rem', fontWeight: '800', color: resultBanner.net > 0 ? '#4ade80' : resultBanner.net === 0 ? '#d4af37' : '#f87171' }}>
              {resultBanner.net > 0 ? '+' : ''}{fmtMoney(resultBanner.net)}
            </div>
            {resultBanner.totalBet === 0 && (
              <div style={{ color: 'rgba(136,146,164,0.4)', fontSize: '11px', marginTop: '4px' }}>No bets placed</div>
            )}
          </div>
        )}

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

                {/* Bet buttons */}
                <div style={{ display: 'flex', gap: '10px', marginBottom: '14px' }}>
                  {BET_TYPES.map(bt => {
                    const betAmt = currentBets[bt] || 0;
                    return (
                      <button
                        key={bt}
                        onClick={() => placeBet(bt)}
                        disabled={(bankroll ?? 0) < selectedChip}
                        style={{
                          flex: 1, padding: '14px 8px', borderRadius: '10px', cursor: (bankroll ?? 0) >= selectedChip ? 'pointer' : 'not-allowed',
                          background: betAmt > 0 ? WINNER_COLOR[bt] : 'rgba(255,255,255,0.04)',
                          border: `2px solid ${betAmt > 0 ? WINNER_COLOR[bt] : 'rgba(255,255,255,0.1)'}`,
                          color: betAmt > 0 ? '#fff' : 'rgba(136,146,164,0.7)',
                          textAlign: 'center',
                        }}
                      >
                        <div style={{ fontSize: '13px', fontWeight: '800', marginBottom: betAmt > 0 ? '4px' : 0 }}>{WINNER_LABEL[bt]}</div>
                        {betAmt > 0 && <div style={{ fontSize: '12px', fontWeight: '700' }}>{fmtMoney(betAmt)}</div>}
                      </button>
                    );
                  })}
                </div>

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
                    <button onClick={() => setCurrentBets({})} style={{ padding: '11px 14px', background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: 'rgba(136,146,164,0.6)', fontSize: '13px', cursor: 'pointer' }}>
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
                  {Object.entries(activeBetsRef.current || {}).map(([bt, amt]) =>
                    amt > 0 ? (
                      <span key={bt} style={{ padding: '4px 10px', background: WINNER_COLOR[bt], borderRadius: '20px', fontSize: '12px', fontWeight: '700', color: '#fff' }}>
                        {WINNER_LABEL[bt]} {fmtMoney(amt)}
                      </span>
                    ) : null
                  )}
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
