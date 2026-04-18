import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Users, Trophy, Settings, ArrowLeft } from 'lucide-react';
import { database as db, ref, onValue } from './firebase.js';
import { useSettings, DEFAULT_ODDS, DEFAULT_VISIBILITY } from './useSettings';
import {
  useGameState,
  useLeaderboard,
  useChat,
  useUserData,
  usePresence,
  distributeBonusChips as fbDistributeBonusChips,
  resetSession,
  logAuditEntry
} from './useFirebaseSync';

const GAME_NAME = 'blackjack';
const CARD_VALUES = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];

const calcScore = (cards) => {
  let total = 0, aces = 0;
  for (const c of cards) {
    if (c === 'A') { total += 11; aces++; }
    else if (['J','Q','K'].includes(c)) total += 10;
    else { const n = parseInt(c); if (!isNaN(n)) total += n; }
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
};

const isNaturalBJ = (cards) => cards.length === 2 && calcScore(cards) === 21;

const BlackjackGame = ({ onBack, isDealerMode = false, playerUserId, playerName: propPlayerName, skipRegistration = false, roomCode }) => {
  const { odds: settingsOdds, betVisibility: settingsVisibility } = useSettings(roomCode);
  const gameOdds = settingsOdds.blackjack || DEFAULT_ODDS.blackjack;
  const gameVis  = settingsVisibility.blackjack || DEFAULT_VISIBILITY.blackjack;

  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const [userId] = useState(() => {
    if (playerUserId) return playerUserId;
    let id = sessionStorage.getItem('actionsync-userId');
    if (!id) { id = `user_${Math.random().toString(36).substr(2, 9)}`; sessionStorage.setItem('actionsync-userId', id); }
    return id;
  });
  const [userName, setUserName] = useState(propPlayerName || '');
  const [isRegistered, setIsRegistered] = useState(skipRegistration && !!propPlayerName);
  const [regName, setRegName] = useState('');

  useEffect(() => {
    if (skipRegistration && propPlayerName && !isRegistered) {
      setUserName(propPlayerName);
      setIsRegistered(true);
      setIsAdmin(isDealerMode);
    }
  }, [skipRegistration, propPlayerName, isDealerMode]);

  const [isAdmin, setIsAdmin] = useState(isDealerMode);
  const [startingChips, setStartingChips] = useState(1000);
  const [bonusChipsAmount, setBonusChipsAmount] = useState(0);
  const [bonusRecipient, setBonusRecipient] = useState('all');
  const [countdownDuration, setCountdownDuration] = useState(15);

  // ── Card entry state (dealer only) ───────────────────────────────��────────────
  const [dealerCards, setDealerCards] = useState([]);
  const [houseCards, setHouseCards] = useState([]);
  const [cardTarget, setCardTarget] = useState('dealer'); // 'dealer' | 'house'

  const defaultGameState = {
    gamePhase: 'betting', winner: null, roundNumber: 0,
    bettingOpen: false, countdown: 0, history: [],
    dealerCards: [], houseCards: []
  };
  const { gameState, updateGameState } = useGameState(roomCode, GAME_NAME, defaultGameState);

  const [gamePhase, setGamePhase] = useState('betting');
  const [winner, setWinner] = useState(null);
  const [roundNumber, setRoundNumber] = useState(0);
  const [bettingOpen, setBettingOpen] = useState(false);
  const [history, setHistory] = useState([]);

  const [bankroll, setBankroll] = useState(1000);
  const [selectedChip, setSelectedChip] = useState(5);
  const [currentBets, setCurrentBets] = useState({ win: 0, lose: 0 });
  const [activeBets, setActiveBets] = useState({});
  const [lastConfirmedBets, setLastConfirmedBets] = useState(null);
  const [betHistory, setBetHistory] = useState([]);

  const [resultBanner, setResultBanner] = useState(null);
  const [prevBankroll, setPrevBankroll] = useState(null);
  const [lastRoundUndoable, setLastRoundUndoable] = useState(false);
  const [toast, setToast] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null);
  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2500); };

  const showResultBanner = (type, amount, message) => {
    setResultBanner({ type, amount, message });
    setTimeout(() => setResultBanner(null), 4000);
  };

  const [bettingNotification, setBettingNotification] = useState(null);
  const prevBettingOpen = useRef(null);
  useEffect(() => {
    if (prevBettingOpen.current !== null && prevBettingOpen.current !== gameState.bettingOpen) {
      setBettingNotification(gameState.bettingOpen ? 'open' : 'closed');
      if (gameState.bettingOpen) {
        try {
          if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
          const ctx = new (window.AudioContext || window.webkitAudioContext)();
          const osc = ctx.createOscillator(); const gain = ctx.createGain();
          osc.connect(gain); gain.connect(ctx.destination);
          osc.frequency.value = 880; osc.type = 'sine'; gain.gain.value = 0.15;
          osc.start();
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
          osc.stop(ctx.currentTime + 0.3);
        } catch (e) {}
      }
      setTimeout(() => setBettingNotification(null), 3000);
    }
    prevBettingOpen.current = gameState.bettingOpen;
  }, [gameState.bettingOpen]);

  const [sessionStats, setSessionStats] = useState({
    totalWagered: 0, biggestWin: 0, totalRounds: 0, startingBankroll: startingChips
  });

  const { leaderboard, updateLeaderboardEntry } = useLeaderboard(roomCode);
  const activeUsers = usePresence(roomCode, isRegistered ? userId : null, userName);
  const [showSettings, setShowSettings] = useState(false);
  const { chatMessages, sendMessage: fbSendMessage } = useChat(roomCode);
  const { userData, saveUserData: fbSaveUserData } = useUserData(roomCode, userId);
  const [chatInput, setChatInput] = useState('');
  const chatEndRef = useRef(null);

  useEffect(() => {
    if (!roomCode) return;
    const unsub = onValue(ref(db, `rooms/${roomCode}/settings/startingChips`), (snap) => {
      if (snap.exists()) setStartingChips(snap.val());
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (userData) {
      if (userData.bankroll !== undefined) setBankroll(userData.bankroll);
      setIsAdmin(userData.isAdmin || isDealerMode);
      if (!isRegistered && userData.name) { setUserName(userData.name); setIsRegistered(true); }
    }
  }, [userData]);

  useEffect(() => {
    setGamePhase(gameState.gamePhase || 'betting');
    setWinner(gameState.winner || null);
    setRoundNumber(gameState.roundNumber || 0);
    setBettingOpen(gameState.bettingOpen !== undefined ? gameState.bettingOpen : false);
    setHistory(gameState.history || []);
    // Sync cards from Firebase for player view
    if (!isAdmin) {
      setDealerCards(gameState.dealerCards || []);
      setHouseCards(gameState.houseCards || []);
    }
  }, [gameState]);

  const [localCountdown, setLocalCountdown] = useState(15);
  useEffect(() => {
    if (gameState.bettingOpen) setLocalCountdown(gameState.countdown || 15);
  }, [gameState.countdown, gameState.bettingOpen]);

  useEffect(() => {
    if (gameState.bettingOpen && localCountdown > 0) {
      if (localCountdown <= 5) {
        try {
          const ctx = new (window.AudioContext || window.webkitAudioContext)();
          const osc = ctx.createOscillator(); const gain = ctx.createGain();
          osc.connect(gain); gain.connect(ctx.destination);
          osc.frequency.value = localCountdown === 1 ? 1200 : 600;
          osc.type = 'sine'; gain.gain.value = 0.1; osc.start();
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
          osc.stop(ctx.currentTime + 0.15);
        } catch (e) {}
      }
      const timer = setTimeout(() => setLocalCountdown(localCountdown - 1), 1000);
      return () => clearTimeout(timer);
    } else if (gameState.bettingOpen && localCountdown === 0 && isAdmin) {
      updateGameState({ bettingOpen: false, countdown: 0 });
    }
  }, [localCountdown, gameState.bettingOpen, isAdmin, updateGameState]);

  const updateLeaderboard = useCallback(async (newBankroll) => {
    if (!isRegistered || !userName) return;
    await updateLeaderboardEntry(userId, userName, newBankroll);
  }, [isRegistered, userName, userId, updateLeaderboardEntry]);

  const saveUserData = useCallback(async (updates) => {
    await fbSaveUserData({ name: userName, bankroll, activeBets, userId, sessionStats, ...updates });
  }, [fbSaveUserData, userName, bankroll, activeBets, userId, sessionStats]);

  // ── Resolve bets ───────────────────────────────────────────────────────────────
  // Push = wash: all bets returned, no win no loss
  const lastResolvedRound = useRef(0);

  async function resolveRound(result) {
    setPrevBankroll(bankroll);
    setLastRoundUndoable(true);

    const newActiveBets = { ...activeBets };
    let winnings = 0;
    let roundWinnings = 0;
    const totalStaked = Object.values(newActiveBets).filter(v => v > 0).reduce((s, v) => s + v, 0);

    if (result === 'push') {
      // Wash: return all staked bets, no profit/loss
      winnings = totalStaked;
      roundWinnings = 0;
    } else {
      // Win bet: pays win odds on 'win', blackjack odds on 'blackjack'
      if (newActiveBets.win > 0) {
        if (result === 'win') {
          const payout = newActiveBets.win * (1 + gameOdds.win.num / gameOdds.win.den);
          winnings += payout; roundWinnings += payout - newActiveBets.win;
        } else if (result === 'blackjack') {
          const payout = newActiveBets.win * (1 + gameOdds.blackjack.num / gameOdds.blackjack.den);
          winnings += payout; roundWinnings += payout - newActiveBets.win;
        } else {
          roundWinnings -= newActiveBets.win;
        }
      }
      // Lose bet
      if (newActiveBets.lose > 0) {
        if (result === 'lose') {
          const payout = newActiveBets.lose * (1 + gameOdds.lose.num / gameOdds.lose.den);
          winnings += payout; roundWinnings += payout - newActiveBets.lose;
        } else {
          roundWinnings -= newActiveBets.lose;
        }
      }
    }

    for (const k of Object.keys(newActiveBets)) newActiveBets[k] = 0;

    const newBankroll = Math.round(bankroll + winnings);
    setBankroll(newBankroll);
    setActiveBets(newActiveBets);

    const newStats = {
      ...sessionStats,
      totalRounds: sessionStats.totalRounds + 1,
      biggestWin: Math.max(sessionStats.biggestWin, roundWinnings)
    };
    setSessionStats(newStats);

    const LABELS = { win: '✅ Win', blackjack: '🃏 Blackjack!', lose: '❌ Lose', push: '🤝 Push — bets returned' };
    if (totalStaked > 0) {
      if (result === 'push') showResultBanner('push', 0, LABELS.push);
      else if (roundWinnings > 0) showResultBanner('win', roundWinnings, LABELS[result]);
      else showResultBanner('loss', roundWinnings, LABELS[result]);
    }

    await saveUserData({ bankroll: newBankroll, activeBets: newActiveBets, sessionStats: newStats });
    await updateLeaderboard(newBankroll);
    if (totalStaked > 0) {
      await logAuditEntry(roomCode, {
        game: 'blackjack', playerUid: userId, playerName: userName,
        roundNumber: gameState.roundNumber || 0, result,
        bets: { ...activeBets }, totalWagered: totalStaked,
        winnings: roundWinnings, bankrollBefore: bankroll, bankrollAfter: newBankroll,
        timestamp: Date.now()
      });
    }
  }

  useEffect(() => {
    if (gameState.winner && gameState.roundNumber > lastResolvedRound.current) {
      lastResolvedRound.current = gameState.roundNumber;
      if (Object.values(activeBets).some(v => v > 0)) resolveRound(gameState.winner);
    }
  }, [gameState.winner, gameState.roundNumber, activeBets]);

  // ── Betting ────────────────────────────────────────────────────────────────────
  const placeBet = (betType) => {
    if (!bettingOpen || bankroll < selectedChip) return;
    const totalPending = Object.values(currentBets).reduce((s, v) => s + v, 0)
      + Object.values(activeBets).filter(v => v > 0).reduce((s, v) => s + v, 0);
    if (totalPending + selectedChip > bankroll) return;
    setCurrentBets(prev => ({ ...prev, [betType]: prev[betType] + selectedChip }));
  };

  const clearAllBets = () => setCurrentBets({ win: 0, lose: 0 });

  const confirmBets = async () => {
    const totalBet = Object.values(currentBets).reduce((s, v) => s + v, 0);
    if (totalBet > bankroll || totalBet === 0) return;
    const newBankroll = Math.round(bankroll - totalBet);
    const newActiveBets = {};
    for (const [k, v] of Object.entries(currentBets)) {
      newActiveBets[k] = (activeBets[k] || 0) + v;
    }
    setActiveBets(newActiveBets);
    setBankroll(newBankroll);
    setCurrentBets({ win: 0, lose: 0 });
    setLastConfirmedBets({ ...newActiveBets });
    const newStats = { ...sessionStats, totalWagered: sessionStats.totalWagered + totalBet };
    setSessionStats(newStats);
    await saveUserData({ bankroll: newBankroll, activeBets: newActiveBets, sessionStats: newStats });
  };

  const rebetLast = async () => {
    if (!lastConfirmedBets) return;
    const total = Object.values(lastConfirmedBets).reduce((s, v) => s + v, 0);
    if (total > bankroll) return;
    const newBankroll = Math.round(bankroll - total);
    const newActiveBets = { ...lastConfirmedBets };
    setActiveBets(newActiveBets);
    setBankroll(newBankroll);
    setCurrentBets({ win: 0, lose: 0 });
    const newStats = { ...sessionStats, totalWagered: sessionStats.totalWagered + total };
    setSessionStats(newStats);
    await saveUserData({ bankroll: newBankroll, activeBets: newActiveBets, sessionStats: newStats });
  };

  // ── Dealer card management ─────────────────────────────────────────────────────
  const addCard = async (value) => {
    const updated = cardTarget === 'dealer'
      ? { dealerCards: [...dealerCards, value] }
      : { houseCards: [...houseCards, value] };
    if (cardTarget === 'dealer') setDealerCards(prev => [...prev, value]);
    else setHouseCards(prev => [...prev, value]);
    await updateGameState(updated);
  };

  const removeCard = async (target, index) => {
    if (target === 'dealer') {
      const updated = dealerCards.filter((_, i) => i !== index);
      setDealerCards(updated);
      await updateGameState({ dealerCards: updated });
    } else {
      const updated = houseCards.filter((_, i) => i !== index);
      setHouseCards(updated);
      await updateGameState({ houseCards: updated });
    }
  };

  // ── Dealer controls ────────────────────────────────────────────────────────────
  const adminOpenBetting = async () => {
    setDealerCards([]); setHouseCards([]);
    await updateGameState({
      gamePhase: 'betting', winner: null,
      bettingOpen: true, countdown: countdownDuration,
      dealerCards: [], houseCards: []
    });
    await sendSystemMessage(`🟢 Betting is OPEN — ${countdownDuration}s!`);
  };

  const adminCloseBetting = async () => {
    await updateGameState({ bettingOpen: false, countdown: 0 });
    await sendSystemMessage('🔴 Betting is CLOSED');
  };

  const adminSetResult = async (result) => {
    const LABELS = { win: 'WIN', blackjack: 'BLACKJACK', lose: 'LOSE', push: 'PUSH' };
    const newHistory = [...(gameState.history || []), result].slice(-30);
    await updateGameState({
      gamePhase: 'complete', winner: result,
      roundNumber: (gameState.roundNumber || 0) + 1,
      bettingOpen: false, history: newHistory
    });
    await sendSystemMessage(`🃏 Result: ${LABELS[result]} — Round #${(gameState.roundNumber || 0) + 1}`);
  };

  const distributeBonusChips = () => {
    if (bonusChipsAmount <= 0) { showToast('Please enter a valid bonus amount'); return; }
    const targetName = bonusRecipient === 'all'
      ? `ALL ${leaderboard.length} players`
      : leaderboard.find(p => p.userId === bonusRecipient)?.name || 'Unknown';
    setConfirmAction({
      message: `Give $${bonusChipsAmount.toLocaleString()} to ${targetName}?`,
      onConfirm: async () => {
        await fbDistributeBonusChips(roomCode, leaderboard, bonusRecipient, bonusChipsAmount, userId, setBankroll);
        showToast(`Distributed $${bonusChipsAmount.toLocaleString()} to ${targetName}!`);
        setBonusChipsAmount(0);
      }
    });
  };

  const adminResetSession = () => {
    setConfirmAction({
      message: 'Reset entire session?',
      onConfirm: async () => {
        try {
          await resetSession(roomCode, GAME_NAME);
          setBankroll(startingChips); clearAllBets(); setActiveBets({});
          setSessionStats({ totalWagered: 0, biggestWin: 0, totalRounds: 0, startingBankroll: startingChips });
          await saveUserData({ bankroll: startingChips, activeBets: {}, sessionStats: { totalWagered: 0, biggestWin: 0, totalRounds: 0, startingBankroll: startingChips } });
        } catch (e) { console.error('Reset failed:', e); }
      }
    });
  };

  const undoLastResult = () => {
    if (prevBankroll === null) return;
    setConfirmAction({
      message: 'Undo last result? This will revert your bankroll to before the last round.',
      onConfirm: async () => {
        setBankroll(prevBankroll);
        await saveUserData({ bankroll: prevBankroll });
        await updateLeaderboard(prevBankroll);
        setLastRoundUndoable(false); setPrevBankroll(null); setResultBanner(null);
        await sendSystemMessage('⚠️ Last result was VOIDED by dealer');
      }
    });
  };

  const sendSystemMessage = async (text) => { await fbSendMessage('system', '🃏 System', text); };
  const sendChatMessage = async () => {
    if (!chatInput.trim()) return;
    await fbSendMessage(userId, userName, chatInput);
    setChatInput('');
  };
  useEffect(() => {
    if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // ── Registration ───────────────────────────────────────────────────────────────
  if (!isRegistered) {
    return (
      <div style={{ minHeight: '100vh', background: '#080b1a', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
        <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(212,175,55,0.2)', borderRadius: '16px', padding: '40px', maxWidth: '400px', width: '100%', textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>🃏</div>
          <div style={{ color: '#d4af37', fontSize: '22px', fontWeight: 'bold', letterSpacing: '2px', marginBottom: '32px' }}>BLACKJACK</div>
          <input
            placeholder="Your name"
            value={regName}
            onChange={e => setRegName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && regName.trim()) { setUserName(regName.trim()); setIsRegistered(true); } }}
            style={{ width: '100%', padding: '14px', background: '#111', border: '1px solid #333', borderRadius: '10px', color: '#fff', fontSize: '16px', outline: 'none', boxSizing: 'border-box', marginBottom: '16px', fontFamily: 'inherit' }}
          />
          <button
            onClick={() => { if (regName.trim()) { setUserName(regName.trim()); setIsRegistered(true); } }}
            style={{ width: '100%', padding: '14px', background: 'linear-gradient(135deg,#d4af37,#f4e5a1)', border: 'none', borderRadius: '10px', color: '#000', fontSize: '15px', fontWeight: 'bold', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Join Game
          </button>
        </div>
      </div>
    );
  }

  // ── Helpers ────────────────────────────────────────────────────────────────────
  const HIST_COLOR = {
    win:       { bg: 'rgba(34,197,94,0.2)',  border: 'rgba(34,197,94,0.6)',  text: '#4ade80', label: 'W'  },
    blackjack: { bg: 'rgba(212,175,55,0.2)', border: 'rgba(212,175,55,0.6)', text: '#d4af37', label: 'BJ' },
    lose:      { bg: 'rgba(239,68,68,0.2)',  border: 'rgba(239,68,68,0.6)',  text: '#f87171', label: 'L'  },
    push:      { bg: 'rgba(99,102,241,0.2)', border: 'rgba(99,102,241,0.6)', text: '#a5b4fc', label: 'P'  },
  };

  const CHIP_VALUES = [5, 25, 100, 500, 1000];
  const accentColor = '#d4af37';

  const totalCurrentBet = Object.values(currentBets).reduce((s, v) => s + v, 0);
  const totalActiveBet  = Object.values(activeBets).filter(v => v > 0).reduce((s, v) => s + v, 0);

  const dealerScore = calcScore(dealerCards);
  const houseScore  = calcScore(houseCards);

  // ── Card display component ────────────────────────────────────────────────────
  const CardChip = ({ value }) => (
    <div style={{
      width: '38px', height: '52px', background: '#fff', borderRadius: '6px',
      border: '2px solid #222', display: 'flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: '0 2px 8px rgba(0,0,0,0.4)', flexShrink: 0,
    }}>
      <span style={{ color: '#1a1a2e', fontWeight: 'bold', fontSize: value === '10' ? '13px' : '16px' }}>{value}</span>
    </div>
  );

  // ── Bet spot ──────────────────────────────────────────────────────────────────
  const BetSpot = ({ betKey, label, sublabel, color, borderColor, bgGradient }) => {
    if (gameVis[betKey] === false) return null;
    const pending = currentBets[betKey] || 0;
    const active  = activeBets[betKey]  || 0;
    const total   = pending + active;
    return (
      <div
        onClick={() => placeBet(betKey)}
        style={{
          flex: 1, padding: isMobile ? '16px 10px' : '22px 14px',
          borderRadius: '12px',
          border: `2px solid ${total > 0 ? borderColor : 'rgba(255,255,255,0.1)'}`,
          background: total > 0 ? bgGradient : 'rgba(255,255,255,0.03)',
          cursor: bettingOpen && bankroll >= selectedChip ? 'pointer' : 'default',
          textAlign: 'center', transition: 'all 0.15s ease', opacity: bettingOpen ? 1 : 0.6,
        }}
      >
        <div style={{ color, fontSize: isMobile ? '20px' : '26px', fontWeight: 'bold', letterSpacing: '1px' }}>{label}</div>
        {sublabel && <div style={{ color: '#888', fontSize: '11px', marginTop: '2px' }}>{sublabel}</div>}
        {total > 0 && (
          <div style={{ marginTop: '8px', background: 'rgba(0,0,0,0.4)', borderRadius: '6px', padding: '4px 8px', display: 'inline-block' }}>
            <span style={{ color: '#fff', fontSize: '14px', fontWeight: 'bold' }}>${total.toLocaleString()}</span>
          </div>
        )}
      </div>
    );
  };

  // ── Main render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: '#080b1a', color: '#fff', fontFamily: "'Inter', sans-serif" }}>

      {/* Confirm dialog */}
      {confirmAction && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ background: '#111', border: '1px solid #333', borderRadius: '16px', padding: '32px', maxWidth: '360px', width: '100%', textAlign: 'center' }}>
            <div style={{ color: '#fff', fontSize: '16px', marginBottom: '24px' }}>{confirmAction.message}</div>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              <button onClick={() => setConfirmAction(null)} style={{ padding: '10px 24px', background: 'transparent', border: '1px solid #444', borderRadius: '8px', color: '#aaa', cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
              <button onClick={() => { confirmAction.onConfirm(); setConfirmAction(null); }} style={{ padding: '10px 24px', background: 'rgba(212,175,55,0.15)', border: '1px solid rgba(212,175,55,0.5)', borderRadius: '8px', color: '#d4af37', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 'bold' }}>Confirm</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', top: '80px', left: '50%', transform: 'translateX(-50%)', background: '#1a1a1a', border: '1px solid #333', borderRadius: '10px', padding: '12px 24px', color: '#fff', zIndex: 999, fontSize: '14px' }}>
          {toast}
        </div>
      )}

      {/* Result banner */}
      {resultBanner && (
        <div style={{
          position: 'fixed', top: '80px', left: '50%', transform: 'translateX(-50%)',
          background: resultBanner.type === 'win' ? 'rgba(34,197,94,0.15)' : resultBanner.type === 'loss' ? 'rgba(239,68,68,0.15)' : 'rgba(99,102,241,0.15)',
          border: `1px solid ${resultBanner.type === 'win' ? 'rgba(34,197,94,0.5)' : resultBanner.type === 'loss' ? 'rgba(239,68,68,0.5)' : 'rgba(99,102,241,0.5)'}`,
          borderRadius: '12px', padding: '14px 28px', zIndex: 998, textAlign: 'center', minWidth: '240px',
        }}>
          <div style={{ color: resultBanner.type === 'win' ? '#4ade80' : resultBanner.type === 'loss' ? '#f87171' : '#a5b4fc', fontSize: '16px', fontWeight: 'bold' }}>
            {resultBanner.message}
          </div>
          {resultBanner.amount !== 0 && (
            <div style={{ color: resultBanner.type === 'win' ? '#4ade80' : '#f87171', fontSize: '22px', fontWeight: 'bold', marginTop: '4px' }}>
              {resultBanner.amount > 0 ? '+' : ''}${Math.abs(Math.round(resultBanner.amount)).toLocaleString()}
            </div>
          )}
        </div>
      )}

      {/* Betting notification */}
      {bettingNotification && (
        <div style={{
          position: 'fixed', top: '140px', left: '50%', transform: 'translateX(-50%)',
          background: bettingNotification === 'open' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
          border: `1px solid ${bettingNotification === 'open' ? 'rgba(34,197,94,0.5)' : 'rgba(239,68,68,0.5)'}`,
          borderRadius: '10px', padding: '10px 24px', zIndex: 997,
          color: bettingNotification === 'open' ? '#4ade80' : '#f87171',
          fontWeight: 'bold', fontSize: '14px', letterSpacing: '1px',
        }}>
          {bettingNotification === 'open' ? '🟢 BETS OPEN' : '🔴 BETS CLOSED'}
        </div>
      )}

      {/* Top bar */}
      <nav style={{ position: 'sticky', top: 0, zIndex: 100, background: 'rgba(8,11,26,0.9)', backdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(212,175,55,0.15)', padding: '0 16px' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', height: '56px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button onClick={onBack} style={{ background: 'transparent', border: 'none', color: '#666', cursor: 'pointer', padding: '8px', borderRadius: '8px', display: 'flex', alignItems: 'center' }}>
            <ArrowLeft size={20} />
          </button>
          <span style={{ fontSize: '18px' }}>🃏</span>
          <span style={{ fontWeight: '800', fontSize: '14px', color: accentColor, letterSpacing: '2px' }}>BLACKJACK</span>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Users size={14} color="#666" />
            <span style={{ color: '#666', fontSize: '13px' }}>{activeUsers.length}</span>
          </div>
          <div style={{ padding: '5px 12px', borderRadius: '16px', background: bettingOpen ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.1)', border: `1px solid ${bettingOpen ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.3)'}`, color: bettingOpen ? '#4ade80' : '#ef4444', fontSize: '11px', fontWeight: 'bold', letterSpacing: '0.5px' }}>
            {bettingOpen ? `BETS OPEN ${localCountdown > 0 ? `${localCountdown}s` : ''}` : 'BETS CLOSED'}
          </div>
          <span style={{ color: '#fff', fontSize: '15px', fontWeight: 'bold' }}>${Math.round(bankroll).toLocaleString()}</span>
          {isAdmin && (
            <button onClick={() => setShowSettings(s => !s)} style={{ background: 'transparent', border: 'none', color: '#666', cursor: 'pointer', padding: '8px', borderRadius: '8px' }}>
              <Settings size={18} />
            </button>
          )}
        </div>
      </nav>

      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: isMobile ? '16px' : '24px', display: 'flex', gap: '24px', flexDirection: isMobile ? 'column' : 'row' }}>

        {/* ── Main column ── */}
        <div style={{ flex: 1 }}>

          {/* History strip */}
          {history.length > 0 && (
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '16px' }}>
              {[...history].reverse().map((h, i) => {
                const c = HIST_COLOR[h] || HIST_COLOR.lose;
                return (
                  <div key={i} style={{ padding: '3px 10px', borderRadius: '12px', background: c.bg, border: `1px solid ${c.border}`, color: c.text, fontSize: '12px', fontWeight: 'bold' }}>
                    {c.label}
                  </div>
                );
              })}
            </div>
          )}

          {/* Card display — visible to all once cards are entered */}
          {(dealerCards.length > 0 || houseCards.length > 0) && (
            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '14px', padding: '18px', marginBottom: '16px' }}>
              {[
                { label: 'DEALER', cards: dealerCards, score: dealerScore },
                { label: 'HOUSE',  cards: houseCards,  score: houseScore  },
              ].map(({ label, cards, score }) => (
                cards.length > 0 && (
                  <div key={label} style={{ marginBottom: '14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                      <span style={{ color: '#555', fontSize: '11px', letterSpacing: '1px' }}>{label}</span>
                      {cards.length > 0 && (
                        <span style={{
                          padding: '2px 10px', borderRadius: '10px', fontSize: '13px', fontWeight: 'bold',
                          background: score > 21 ? 'rgba(239,68,68,0.15)' : score === 21 ? 'rgba(212,175,55,0.15)' : 'rgba(255,255,255,0.06)',
                          color: score > 21 ? '#f87171' : score === 21 ? '#d4af37' : '#ccc',
                          border: `1px solid ${score > 21 ? 'rgba(239,68,68,0.3)' : score === 21 ? 'rgba(212,175,55,0.3)' : 'rgba(255,255,255,0.1)'}`,
                        }}>
                          {score}{score > 21 ? ' BUST' : score === 21 && cards.length === 2 ? ' BJ' : ''}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      {cards.map((v, i) => <CardChip key={i} value={v} />)}
                    </div>
                  </div>
                )
              ))}
            </div>
          )}

          {/* Result display */}
          {gamePhase === 'complete' && winner && (
            <div style={{ textAlign: 'center', marginBottom: '20px', padding: '20px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '14px' }}>
              <div style={{ fontSize: '40px', marginBottom: '6px' }}>
                {winner === 'win' ? '✅' : winner === 'blackjack' ? '🃏' : winner === 'lose' ? '❌' : '🤝'}
              </div>
              <div style={{
                fontSize: isMobile ? '22px' : '32px', fontWeight: 'bold', letterSpacing: '2px',
                color: (winner === 'win' || winner === 'blackjack') ? '#4ade80' : winner === 'lose' ? '#f87171' : '#a5b4fc',
              }}>
                {winner === 'win' ? 'WIN' : winner === 'blackjack' ? 'BLACKJACK' : winner === 'lose' ? 'LOSE' : 'PUSH'}
              </div>
              {winner === 'push' && <div style={{ color: '#888', fontSize: '13px', marginTop: '4px' }}>All bets returned</div>}
              {winner === 'blackjack' && <div style={{ color: '#d4af37', fontSize: '13px', marginTop: '4px' }}>Win bets paid {gameOdds.blackjack.num}:{gameOdds.blackjack.den}</div>}
            </div>
          )}

          {/* Bet spots */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ color: '#555', fontSize: '11px', letterSpacing: '1px', marginBottom: '10px' }}>PLACE YOUR BET — Push washes all bets</div>
            <div style={{ display: 'flex', gap: '12px' }}>
              <BetSpot betKey="win"  label="WIN"  sublabel="1:1"
                color="#4ade80" borderColor="rgba(34,197,94,0.6)"
                bgGradient="linear-gradient(135deg,rgba(20,83,45,0.5),rgba(15,60,35,0.6))" />
              <BetSpot betKey="lose" label="LOSE" sublabel="1:1"
                color="#f87171" borderColor="rgba(239,68,68,0.6)"
                bgGradient="linear-gradient(135deg,rgba(127,29,29,0.5),rgba(80,10,10,0.6))" />
            </div>
          </div>

          {/* Chip selector */}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '14px' }}>
            {CHIP_VALUES.map(v => (
              <button key={v} onClick={() => setSelectedChip(v)} style={{
                padding: '8px 16px', borderRadius: '20px',
                border: `1px solid ${selectedChip === v ? accentColor : 'rgba(255,255,255,0.1)'}`,
                background: selectedChip === v ? 'rgba(212,175,55,0.15)' : 'transparent',
                color: selectedChip === v ? accentColor : '#555',
                fontSize: '13px', fontWeight: 'bold', cursor: bankroll >= v ? 'pointer' : 'not-allowed',
                opacity: bankroll >= v ? 1 : 0.4, fontFamily: 'inherit',
              }}>
                ${v.toLocaleString()}
              </button>
            ))}
          </div>

          {/* Bet action buttons */}
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '20px' }}>
            {totalCurrentBet > 0 && (
              <>
                <button onClick={clearAllBets} style={{ padding: '10px 20px', background: 'transparent', border: '1px solid #444', borderRadius: '8px', color: '#aaa', cursor: 'pointer', fontFamily: 'inherit', fontSize: '13px' }}>Clear</button>
                <button onClick={confirmBets} style={{ padding: '10px 24px', background: 'linear-gradient(135deg,#d4af37,#f4e5a1)', border: 'none', borderRadius: '8px', color: '#000', fontWeight: 'bold', cursor: 'pointer', fontFamily: 'inherit', fontSize: '13px' }}>
                  Confirm ${totalCurrentBet.toLocaleString()}
                </button>
              </>
            )}
            {totalCurrentBet === 0 && lastConfirmedBets && bettingOpen && (
              <button
                onClick={rebetLast}
                disabled={Object.values(lastConfirmedBets).reduce((s, v) => s + v, 0) > bankroll}
                style={{ padding: '10px 20px', background: 'transparent', border: '1px solid #e53935', borderRadius: '8px', color: '#e53935', cursor: 'pointer', fontFamily: 'inherit', fontSize: '13px' }}>
                Rebet ${Object.values(lastConfirmedBets).reduce((s, v) => s + v, 0).toLocaleString()}
              </button>
            )}
            {lastRoundUndoable && (
              <button onClick={undoLastResult} style={{ padding: '10px 20px', background: 'transparent', border: '1px solid #ff9800', borderRadius: '8px', color: '#ff9800', cursor: 'pointer', fontFamily: 'inherit', fontSize: '13px' }}>
                Undo Last
              </button>
            )}
          </div>

          {/* Active bets summary */}
          {totalActiveBet > 0 && (
            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '14px 18px', marginBottom: '20px' }}>
              <div style={{ color: '#666', fontSize: '11px', letterSpacing: '1px', marginBottom: '8px' }}>LOCKED BETS — ${totalActiveBet.toLocaleString()}</div>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                {Object.entries(activeBets).filter(([, v]) => v > 0).map(([k, v]) => (
                  <div key={k} style={{ padding: '4px 12px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', fontSize: '13px' }}>
                    <span style={{ color: '#aaa', textTransform: 'capitalize' }}>{k}: </span>
                    <span style={{ color: '#fff', fontWeight: 'bold' }}>${v.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Dealer controls ── */}
          {isAdmin && (
            <div style={{ background: 'rgba(212,175,55,0.04)', border: '1px solid rgba(212,175,55,0.2)', borderRadius: '16px', padding: '20px', marginBottom: '20px' }}>
              <div style={{ color: accentColor, fontSize: '11px', fontWeight: 'bold', letterSpacing: '1.5px', marginBottom: '16px' }}>DEALER CONTROLS</div>

              {/* Countdown */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' }}>
                <span style={{ color: '#666', fontSize: '12px' }}>Countdown:</span>
                {[10, 15, 20, 30, 45, 60].map(s => (
                  <button key={s} onClick={() => setCountdownDuration(s)} style={{
                    padding: '5px 12px', borderRadius: '16px', fontSize: '12px',
                    border: `1px solid ${countdownDuration === s ? accentColor : '#333'}`,
                    background: countdownDuration === s ? 'rgba(212,175,55,0.15)' : 'transparent',
                    color: countdownDuration === s ? accentColor : '#555',
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}>{s}s</button>
                ))}
              </div>

              {/* Open / close */}
              <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', flexWrap: 'wrap' }}>
                <button onClick={adminOpenBetting} style={{ padding: '12px 24px', background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.4)', borderRadius: '10px', color: '#4ade80', fontWeight: 'bold', cursor: 'pointer', fontFamily: 'inherit', fontSize: '14px' }}>
                  Open Betting
                </button>
                <button onClick={adminCloseBetting} disabled={!bettingOpen} style={{ padding: '12px 24px', background: bettingOpen ? 'rgba(239,68,68,0.15)' : 'transparent', border: `1px solid ${bettingOpen ? 'rgba(239,68,68,0.4)' : '#333'}`, borderRadius: '10px', color: bettingOpen ? '#f87171' : '#444', fontWeight: 'bold', cursor: bettingOpen ? 'pointer' : 'default', fontFamily: 'inherit', fontSize: '14px' }}>
                  Close Betting
                </button>
              </div>

              {/* ── Card entry ── */}
              <div style={{ background: 'rgba(0,0,0,0.25)', borderRadius: '12px', padding: '16px', marginBottom: '20px' }}>
                <div style={{ color: '#666', fontSize: '11px', letterSpacing: '1px', marginBottom: '12px' }}>CARD ENTRY</div>

                {/* Target selector */}
                <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                  {['dealer', 'house'].map(t => (
                    <button key={t} onClick={() => setCardTarget(t)} style={{
                      flex: 1, padding: '8px', borderRadius: '8px', fontSize: '12px', fontWeight: 'bold',
                      background: cardTarget === t ? 'rgba(212,175,55,0.2)' : 'transparent',
                      border: `1px solid ${cardTarget === t ? accentColor : '#333'}`,
                      color: cardTarget === t ? accentColor : '#555',
                      cursor: 'pointer', fontFamily: 'inherit', textTransform: 'uppercase', letterSpacing: '1px',
                    }}>
                      {t === 'dealer' ? `Dealer${dealerCards.length > 0 ? ` (${dealerScore}${dealerScore > 21 ? ' BUST' : ''})` : ''}` : `House${houseCards.length > 0 ? ` (${houseScore}${houseScore > 21 ? ' BUST' : ''})` : ''}`}
                    </button>
                  ))}
                </div>

                {/* Value grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', marginBottom: '10px' }}>
                  {CARD_VALUES.map(v => (
                    <button key={v} onClick={() => addCard(v)} style={{
                      padding: '8px 4px', borderRadius: '6px', fontSize: '13px', fontWeight: 'bold',
                      background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)',
                      color: '#fff', cursor: 'pointer', fontFamily: 'inherit',
                    }}>{v}</button>
                  ))}
                </div>

                {/* Current cards with remove */}
                {['dealer', 'house'].map(t => {
                  const cards = t === 'dealer' ? dealerCards : houseCards;
                  if (cards.length === 0) return null;
                  return (
                    <div key={t} style={{ marginBottom: '8px' }}>
                      <div style={{ color: '#555', fontSize: '10px', letterSpacing: '1px', marginBottom: '6px' }}>{t.toUpperCase()}</div>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        {cards.map((v, i) => (
                          <div key={i} onClick={() => removeCard(t, i)} style={{
                            padding: '4px 10px', borderRadius: '6px', background: 'rgba(255,255,255,0.1)',
                            border: '1px solid rgba(255,255,255,0.15)', color: '#fff', fontSize: '13px',
                            fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px',
                          }}>
                            {v} <span style={{ color: '#f87171', fontSize: '10px' }}>✕</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Result buttons */}
              <div style={{ color: '#555', fontSize: '11px', letterSpacing: '1px', marginBottom: '10px' }}>SET RESULT</div>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                {[
                  { result: 'win',       label: 'WIN',       color: '#4ade80', border: 'rgba(34,197,94,0.5)',   bg: 'rgba(34,197,94,0.15)'   },
                  { result: 'blackjack', label: 'BLACKJACK', color: '#d4af37', border: 'rgba(212,175,55,0.5)',  bg: 'rgba(212,175,55,0.15)'  },
                  { result: 'lose',      label: 'LOSE',      color: '#f87171', border: 'rgba(239,68,68,0.5)',   bg: 'rgba(239,68,68,0.15)'   },
                  { result: 'push',      label: 'PUSH',      color: '#a5b4fc', border: 'rgba(99,102,241,0.5)',  bg: 'rgba(99,102,241,0.15)'  },
                ].map(({ result, label, color, border, bg }) => (
                  <button key={result} onClick={() => adminSetResult(result)} style={{
                    padding: '13px 18px', background: bg, border: `2px solid ${border}`,
                    borderRadius: '12px', color, fontWeight: 'bold', cursor: 'pointer',
                    fontFamily: 'inherit', fontSize: '14px', letterSpacing: '1px',
                  }}>{label}</button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Right column ── */}
        <div style={{ width: isMobile ? '100%' : '280px', flexShrink: 0 }}>

          {/* Session stats */}
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '16px', marginBottom: '16px' }}>
            <div style={{ color: '#555', fontSize: '11px', letterSpacing: '1px', marginBottom: '12px' }}>SESSION</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              {[
                { label: 'Balance',  value: `$${Math.round(bankroll).toLocaleString()}`, color: '#fff' },
                { label: 'P&L',      value: `${bankroll - sessionStats.startingBankroll >= 0 ? '+' : ''}$${(bankroll - sessionStats.startingBankroll).toLocaleString()}`, color: bankroll >= sessionStats.startingBankroll ? '#4ade80' : '#f87171' },
                { label: 'Rounds',   value: sessionStats.totalRounds, color: '#ccc' },
                { label: 'Wagered',  value: `$${sessionStats.totalWagered.toLocaleString()}`, color: '#ccc' },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '8px', padding: '10px' }}>
                  <div style={{ color: '#555', fontSize: '10px', marginBottom: '4px' }}>{label}</div>
                  <div style={{ color, fontSize: '14px', fontWeight: 'bold' }}>{value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Leaderboard */}
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '16px', marginBottom: '16px' }}>
            <div style={{ color: '#555', fontSize: '11px', letterSpacing: '1px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Trophy size={12} color="#d4af37" /> LEADERBOARD
            </div>
            {leaderboard.slice(0, 8).map((player, i) => (
              <div key={player.userId} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0', borderBottom: i < Math.min(leaderboard.length, 8) - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
                <span style={{ color: i === 0 ? '#d4af37' : '#555', fontSize: '12px', width: '16px' }}>
                  {i === 0 ? '👑' : `${i + 1}.`}
                </span>
                <span style={{ flex: 1, color: player.userId === userId ? accentColor : '#ccc', fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {player.name}
                </span>
                <span style={{ color: player.bankroll >= startingChips ? '#4ade80' : '#f87171', fontSize: '13px', fontWeight: 'bold' }}>
                  ${Math.round(player.bankroll).toLocaleString()}
                </span>
              </div>
            ))}
            {leaderboard.length === 0 && <div style={{ color: '#444', fontSize: '12px' }}>No players yet</div>}
          </div>

          {/* Chat */}
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '16px' }}>
            <div style={{ color: '#555', fontSize: '11px', letterSpacing: '1px', marginBottom: '12px' }}>CHAT</div>
            <div style={{ height: '180px', overflowY: 'auto', marginBottom: '10px' }}>
              {chatMessages.map((msg, i) => (
                <div key={i} style={{ marginBottom: '6px' }}>
                  <span style={{ color: msg.userId === 'system' ? '#d4af37' : '#888', fontSize: '11px', marginRight: '6px' }}>{msg.name}:</span>
                  <span style={{ color: '#ccc', fontSize: '12px' }}>{msg.text}</span>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                value={chatInput} onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') sendChatMessage(); }}
                placeholder="Say something..."
                style={{ flex: 1, padding: '8px 12px', background: '#111', border: '1px solid #222', borderRadius: '8px', color: '#fff', fontSize: '13px', outline: 'none', fontFamily: 'inherit' }}
              />
              <button onClick={sendChatMessage} style={{ padding: '8px 14px', background: 'rgba(212,175,55,0.15)', border: '1px solid rgba(212,175,55,0.3)', borderRadius: '8px', color: accentColor, cursor: 'pointer', fontFamily: 'inherit', fontSize: '13px' }}>
                Send
              </button>
            </div>
          </div>

          {/* Admin panel */}
          {isAdmin && showSettings && (
            <div style={{ marginTop: '16px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '16px' }}>
              <div style={{ color: '#555', fontSize: '11px', letterSpacing: '1px', marginBottom: '16px' }}>ADMIN</div>
              <div style={{ marginBottom: '16px' }}>
                <div style={{ color: '#666', fontSize: '12px', marginBottom: '8px' }}>Bonus Chips</div>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                  <input type="number" value={bonusChipsAmount || ''} onChange={e => setBonusChipsAmount(Number(e.target.value))}
                    placeholder="Amount" min={0}
                    style={{ flex: 1, padding: '8px', background: '#111', border: '1px solid #333', borderRadius: '8px', color: '#fff', fontSize: '13px', outline: 'none', fontFamily: 'inherit' }}
                  />
                  <select value={bonusRecipient} onChange={e => setBonusRecipient(e.target.value)}
                    style={{ flex: 1, padding: '8px', background: '#111', border: '1px solid #333', borderRadius: '8px', color: '#fff', fontSize: '13px', outline: 'none', fontFamily: 'inherit' }}>
                    <option value="all">All Players</option>
                    {leaderboard.map(p => <option key={p.userId} value={p.userId}>{p.name}</option>)}
                  </select>
                </div>
                <button onClick={distributeBonusChips} style={{ width: '100%', padding: '8px', background: 'transparent', border: '1px solid #444', borderRadius: '8px', color: '#aaa', cursor: 'pointer', fontFamily: 'inherit', fontSize: '12px' }}>
                  Give Chips
                </button>
              </div>
              <button onClick={adminResetSession} style={{ width: '100%', padding: '10px', background: 'transparent', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', color: '#f87171', cursor: 'pointer', fontFamily: 'inherit', fontSize: '12px' }}>
                Reset Session
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BlackjackGame;
