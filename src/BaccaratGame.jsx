import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Users, Timer, Crown, Trophy, Settings, ArrowLeft } from 'lucide-react';
// ========== FIREBASE: Import real-time sync hooks ==========
import { database as db, ref, onValue, set as fbSet } from './firebase.js';
import {
  useGameState,
  useLeaderboard,
  useChat,
  useUserData,
  usePresence,
  distributeBonusChips as fbDistributeBonusChips,
  resetSession
} from './useFirebaseSync';

const GAME_NAME = 'baccarat';

const BaccaratGame = ({ onBack, isDealerMode = false, playerUserId, playerName: propPlayerName, skipRegistration = false }) => {
  // Mobile detection
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);
  // User state
  const [userId] = useState(() => {
    if (playerUserId) return playerUserId;
    let id = sessionStorage.getItem('actionsync-userId');
    if (!id) { id = `user_${Math.random().toString(36).substr(2, 9)}`; sessionStorage.setItem('actionsync-userId', id); }
    return id;
  });
  const [userName, setUserName] = useState(propPlayerName || '');
  const [isRegistered, setIsRegistered] = useState(skipRegistration && !!propPlayerName);
  
  // Auto-register if coming from App with skipRegistration
  // Don't write to Firebase here — let userData listener sync the real bankroll
  useEffect(() => {
    if (skipRegistration && propPlayerName && !isRegistered) {
      setUserName(propPlayerName);
      setIsRegistered(true);
      setIsAdmin(isDealerMode);
      // Bankroll will be set by the userData listener below (from shared session)
    }
  }, [skipRegistration, propPlayerName, isDealerMode]);
  const [isAdmin, setIsAdmin] = useState(isDealerMode);
  
  // Admin password protection
  const [showUserSettings, setShowUserSettings] = useState(false);
  
  // Dealer chip management
  const [startingChips, setStartingChips] = useState(1000);
  const [bonusChipsAmount, setBonusChipsAmount] = useState(0);
  const [bonusRecipient, setBonusRecipient] = useState('all');
  const [countdownDuration, setCountdownDuration] = useState(15);
  
  // ========== FIREBASE: Game state from real-time listener ==========
  const defaultGameState = {
    gamePhase: 'betting', playerCards: [], bankerCards: [],
    playerScore: 0, bankerScore: 0, winner: null,
    roundNumber: 0, bettingOpen: false, countdown: 0, roadmap: []
  };
  const { gameState, updateGameState } = useGameState(GAME_NAME, defaultGameState);
  
  // Game state (synced from Firebase)
  // FIREBASE: gamePhase, playerCards, bankerCards, etc. come from gameState
  const [gamePhase, setGamePhase] = useState('betting'); // 'betting' or 'dealt'
  const [playerCards, setPlayerCards] = useState([]);
  const [bankerCards, setBankerCards] = useState([]);
  const [playerScore, setPlayerScore] = useState(0);
  const [bankerScore, setBankerScore] = useState(0);
  const [winner, setWinner] = useState(null); // 'player', 'banker', 'tie'
  const [roundNumber, setRoundNumber] = useState(0);
  const [bettingOpen, setBettingOpen] = useState(true);
  const [countdown, setCountdown] = useState(15);
  
  // User bankroll and bets
  const [bankroll, setBankroll] = useState(1000);
  const [selectedChip, setSelectedChip] = useState(5);
  const [currentBets, setCurrentBets] = useState({
    player: 0,
    banker: 0,
    tie: 0,
    playerPair: 0,
    bankerPair: 0,
    dragon: 0, // Natural 9 winner by 4+ points
    panda: 0   // Natural 8 winner
  });
  const [activeBets, setActiveBets] = useState({});
  const [lastConfirmedBets, setLastConfirmedBets] = useState(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [betHistory, setBetHistory] = useState([]);
  const [showBetHistory, setShowBetHistory] = useState(false);
  // ========== RESULT BANNER ==========
  const [resultBanner, setResultBanner] = useState(null);
  const [prevBankroll, setPrevBankroll] = useState(null);
  const [lastRoundUndoable, setLastRoundUndoable] = useState(false); // { type: 'win'|'loss'|'push', amount, message }
  
  const showResultBanner = (type, amount, message) => {
    setResultBanner({ type, amount, message });
    setTimeout(() => setResultBanner(null), 4000);
  };

  // ========== BETTING NOTIFICATION ==========
  const [bettingNotification, setBettingNotification] = useState(null); // 'open' | 'closed' | null
  const prevBettingOpen = useRef(null);
  
  useEffect(() => {
    if (prevBettingOpen.current !== null && prevBettingOpen.current !== gameState.bettingOpen) {
      setBettingNotification(gameState.bettingOpen ? 'open' : 'closed');
      // Sound + vibration when betting opens
      if (gameState.bettingOpen) {
        try {
          if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
          const ctx = new (window.AudioContext || window.webkitAudioContext)();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.frequency.value = 880;
          osc.type = 'sine';
          gain.gain.value = 0.15;
          osc.start();
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
          osc.stop(ctx.currentTime + 0.3);
        } catch (e) { /* audio not available */ }
      }
      setTimeout(() => setBettingNotification(null), 3000);
    }
    prevBettingOpen.current = gameState.bettingOpen;
  }, [gameState.bettingOpen]);

  
  // History and stats
  const [roadmap, setRoadmap] = useState([]); // B, P, T tracking
  const [sessionStats, setSessionStats] = useState({
    totalWagered: 0,
    biggestWin: 0,
    totalRounds: 0,
    startingBankroll: startingChips
  });
  
  // ========== FIREBASE: Leaderboard ==========
  const { leaderboard, updateLeaderboardEntry, clearLeaderboard } = useLeaderboard();
  
  // Admin state
  const [adminPlayerCards, setAdminPlayerCards] = useState(['', '']);
  const [adminBankerCards, setAdminBankerCards] = useState(['', '']);
  const [adminPlayerThird, setAdminPlayerThird] = useState('');
  const [adminBankerThird, setAdminBankerThird] = useState('');
  const [qpValue, setQpValue] = useState('');
  const [qpTarget, setQpTarget] = useState('p1');
  // FIREBASE: activeUsers from presence
  const activeUsers = usePresence(isRegistered ? userId : null, userName);
  const [showSettings, setShowSettings] = useState(false);
  
  // ========== FIREBASE: Chat + User hooks ==========
  const { chatMessages, sendMessage: fbSendMessage, clearChat } = useChat();
  const { userData, saveUserData: fbSaveUserData } = useUserData(userId);
  const [chatInput, setChatInput] = useState('');
  const chatEndRef = useRef(null);

  // Card values for baccarat
  const getCardValue = (card) => {
    if (!card) return 0;
    const value = card.substring(0, card.length - 1);
    if (value === 'A') return 1;
    if (['J', 'Q', 'K', '10'].includes(value)) return 0;
    return parseInt(value);
  };

  const calculateScore = (cards) => {
    return cards.reduce((sum, card) => sum + getCardValue(card), 0) % 10;
  };

  const isPair = (card1, card2) => {
    if (!card1 || !card2) return false;
    return card1.substring(0, card1.length - 1) === card2.substring(0, card2.length - 1);
  };

  // Read startingChips from Firebase settings
  useEffect(() => {
    const chipsRef = ref(db, 'session/settings/startingChips');
    const unsub = onValue(chipsRef, (snapshot) => {
      if (snapshot.exists()) {
        setStartingChips(snapshot.val());
      }
    });
    return () => unsub();
  }, []);

  // ========== FIREBASE: Auto-load user data from listener ==========
  useEffect(() => {
    if (userData) {
      // ALWAYS sync bankroll from shared session — carries across games
      if (userData.bankroll !== undefined) setBankroll(userData.bankroll);
      setIsAdmin(userData.isAdmin || isDealerMode);
      
      if (!isRegistered && userData.name) {
        setUserName(userData.name);
        setIsRegistered(true);
      }
    }
  }, [userData]);
  
  // ========== FIREBASE: Sync game state from Firebase ==========
  useEffect(() => {
    setGamePhase(gameState.gamePhase || 'betting');
    setPlayerCards(gameState.playerCards || []);
    setBankerCards(gameState.bankerCards || []);
    setPlayerScore(gameState.playerScore || 0);
    setBankerScore(gameState.bankerScore || 0);
    setWinner(gameState.winner || null);
    setRoundNumber(gameState.roundNumber || 0);
    setBettingOpen(gameState.bettingOpen !== undefined ? gameState.bettingOpen : true);
    setRoadmap(gameState.roadmap || []);
  }, [gameState]);
  
  // ========== FIREBASE: Sync countdown ==========
  const [localCountdown, setLocalCountdown] = useState(15);
  useEffect(() => {
    if (gameState.bettingOpen) setLocalCountdown(gameState.countdown || 15);
  }, [gameState.countdown, gameState.bettingOpen]);
  
  // ========== FIREBASE: Auto-resolve bets when dealer pushes deal result ==========
  const lastResolvedRound = useRef(0);
  useEffect(() => {
    if (gameState.winner && gameState.roundNumber > lastResolvedRound.current) {
      lastResolvedRound.current = gameState.roundNumber;
      if (Object.values(activeBets).some(v => v > 0)) {
        resolveRound(gameState.playerCards || [], gameState.bankerCards || []);
      }
    }
  }, [gameState.winner, gameState.roundNumber]);

  // Countdown timer — auto-closes at 0
  useEffect(() => {
    if (gameState.bettingOpen && localCountdown > 0) {
      // Beep on last 5 seconds
      if (localCountdown <= 5) {
        try {
          const ctx = new (window.AudioContext || window.webkitAudioContext)();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.frequency.value = localCountdown === 1 ? 1200 : 600;
          osc.type = 'sine';
          gain.gain.value = 0.1;
          osc.start();
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
          osc.stop(ctx.currentTime + 0.15);
        } catch (e) { /* audio not available */ }
      }
      const timer = setTimeout(() => setLocalCountdown(localCountdown - 1), 1000);
      return () => clearTimeout(timer);
    } else if (gameState.bettingOpen && localCountdown === 0 && isAdmin) {
      updateGameState({ bettingOpen: false, countdown: 0 });
    }
  }, [localCountdown, gameState.bettingOpen]);









  // ========== FIREBASE: Save user data ==========
  const saveUserData = async (updates) => {
    const data = { name: userName, bankroll, activeBets, userId, sessionStats, ...updates };
    await fbSaveUserData(data);
  };

  // ========== FIREBASE: Update leaderboard ==========
  const updateLeaderboard = async (newBankroll) => {
    await updateLeaderboardEntry(userId, userName, newBankroll, isAdmin);
  };

  const registerUser = async () => {
    if (userName.trim()) {
      const hasAdminAccess = isDealerMode;
      setIsRegistered(true);
      setIsAdmin(hasAdminAccess);
      // IMPORTANT: Use existing bankroll from shared session, never reset to 1000
      const existingBankroll = (userData && userData.bankroll !== undefined) ? userData.bankroll : bankroll;
      const finalBankroll = existingBankroll > 0 ? existingBankroll : startingChips;
      setBankroll(finalBankroll);
      await saveUserData({ name: userName, bankroll: finalBankroll, isAdmin: hasAdminAccess });
      await updateLeaderboard(finalBankroll);
    }
  };

  const placeBet = (betType) => {
    if (!bettingOpen || bankroll < selectedChip) return;
    
    const newBets = { ...currentBets };
    newBets[betType] = (newBets[betType] || 0) + selectedChip;
    
    const totalBet = Object.values(newBets).reduce((sum, bet) => sum + bet, 0);
    if (totalBet <= bankroll) {
      setCurrentBets(newBets);
    }
  };

  const clearBet = (betType) => {
    setCurrentBets(prev => ({ ...prev, [betType]: 0 }));
  };

  const clearAllBets = () => {
    setCurrentBets({
      player: 0,
      banker: 0,
      tie: 0,
      playerPair: 0,
      bankerPair: 0,
      dragon: 0,
      panda: 0
    });
  };


  // Remove a single bet (refund to bankroll)
  const removeSingleBet = (betKey) => {
    if (!bettingOpen) return;
    const amount = currentBets[betKey];
    if (!amount || amount <= 0) return;
    setCurrentBets(prev => {
      const updated = { ...prev };
      delete updated[betKey];
      return updated;
    });
  };


  // Repeat last confirmed bet
  const repeatLastBet = () => {
    if (!lastConfirmedBets || !bettingOpen) return;
    const totalNeeded = Object.values(lastConfirmedBets).reduce((s, v) => s + v, 0);
    if (totalNeeded > bankroll) return;
    setCurrentBets({ ...lastConfirmedBets });
  };

  const confirmBets = async () => {
    if (isConfirming) return;
    const totalBet = Object.values(currentBets).reduce((sum, bet) => sum + bet, 0);
    if (totalBet > bankroll || totalBet === 0) return;
    setIsConfirming(true);
    
    const newBankroll = Math.round(bankroll - totalBet);
    setBankroll(newBankroll);
    
    const newActiveBets = { ...activeBets };
    Object.keys(currentBets).forEach(key => {
      if (currentBets[key] > 0) {
        newActiveBets[key] = (newActiveBets[key] || 0) + currentBets[key];
      }
    });
    
    setActiveBets(newActiveBets);
    const newStats = {
      ...sessionStats,
      totalWagered: sessionStats.totalWagered + totalBet
    };
    setSessionStats(newStats);
    setLastConfirmedBets({ ...currentBets });
    clearAllBets();
    
    await saveUserData({ bankroll: newBankroll, activeBets: newActiveBets, sessionStats: newStats });
    await updateLeaderboard(newBankroll);
    setIsConfirming(false);
  };

  const resolveRound = async (pCards, bCards) => {
    setPrevBankroll(bankroll);
    setLastRoundUndoable(true);
    const pScore = calculateScore(pCards);
    const bScore = calculateScore(bCards);
    
    let roundWinner = null;
    if (pScore > bScore) roundWinner = 'player';
    else if (bScore > pScore) roundWinner = 'banker';
    else roundWinner = 'tie';
    
    let winnings = 0;
    let roundWinnings = 0;
    const newActiveBets = { ...activeBets };
    
    // Player bet (1:1)
    if (newActiveBets.player > 0) {
      if (roundWinner === 'player') {
        const payout = newActiveBets.player * 2;
        winnings += payout;
        roundWinnings += payout - newActiveBets.player;
      } else {
        roundWinnings -= newActiveBets.player;
      }
      newActiveBets.player = 0;
    }
    
    // Banker bet (0.95:1 - 5% commission)
    if (newActiveBets.banker > 0) {
      if (roundWinner === 'banker') {
        const payout = Math.round(newActiveBets.banker + (newActiveBets.banker * 0.95));
        winnings += payout;
        roundWinnings += payout - newActiveBets.banker;
      } else {
        roundWinnings -= newActiveBets.banker;
      }
      newActiveBets.banker = 0;
    }
    
    // Tie bet (8:1)
    if (newActiveBets.tie > 0) {
      if (roundWinner === 'tie') {
        const payout = newActiveBets.tie * 9;
        winnings += payout;
        roundWinnings += payout - newActiveBets.tie;
      } else {
        roundWinnings -= newActiveBets.tie;
      }
      newActiveBets.tie = 0;
    }
    
    // Player Pair (11:1)
    if (newActiveBets.playerPair > 0) {
      if (isPair(pCards[0], pCards[1])) {
        const payout = newActiveBets.playerPair * 12;
        winnings += payout;
        roundWinnings += payout - newActiveBets.playerPair;
      } else {
        roundWinnings -= newActiveBets.playerPair;
      }
      newActiveBets.playerPair = 0;
    }
    
    // Banker Pair (11:1)
    if (newActiveBets.bankerPair > 0) {
      if (isPair(bCards[0], bCards[1])) {
        const payout = newActiveBets.bankerPair * 12;
        winnings += payout;
        roundWinnings += payout - newActiveBets.bankerPair;
      } else {
        roundWinnings -= newActiveBets.bankerPair;
      }
      newActiveBets.bankerPair = 0;
    }
    
    // Dragon Bonus (Natural 9 wins by 4+)
    if (newActiveBets.dragon > 0) {
      const isNatural = pCards.length === 2 && bCards.length === 2;
      const margin = Math.abs(pScore - bScore);
      
      if (isNatural && ((pScore === 9 && margin >= 4) || (bScore === 9 && margin >= 4))) {
        const payout = newActiveBets.dragon * 31; // 30:1
        winnings += payout;
        roundWinnings += payout - newActiveBets.dragon;
      } else {
        roundWinnings -= newActiveBets.dragon;
      }
      newActiveBets.dragon = 0;
    }
    
    // Panda Bonus (Natural 8 winner)
    if (newActiveBets.panda > 0) {
      const isNatural = pCards.length === 2 && bCards.length === 2;
      
      if (isNatural && (pScore === 8 || bScore === 8) && roundWinner !== 'tie') {
        const payout = newActiveBets.panda * 26; // 25:1
        winnings += payout;
        roundWinnings += payout - newActiveBets.panda;
      } else {
        roundWinnings -= newActiveBets.panda;
      }
      newActiveBets.panda = 0;
    }
    
    const newBankroll = Math.round(bankroll + winnings);
    setBankroll(newBankroll);
    setActiveBets(newActiveBets);
    
    // Update roadmap
    const newRoadmap = [...roadmap, roundWinner === 'player' ? 'P' : roundWinner === 'banker' ? 'B' : 'T'];
    setRoadmap(newRoadmap.slice(-50));
    
    const newStats = {
      ...sessionStats,
      totalRounds: sessionStats.totalRounds + 1,
      biggestWin: Math.max(sessionStats.biggestWin, roundWinnings)
    };
    setSessionStats(newStats);
    
    // Record bet history
    const totalWagered = Object.values(activeBets).reduce((s, v) => s + (v > 0 ? v : 0), 0);
    if (totalWagered > 0) {
      setBetHistory(prev => [{
        round: gameState.roundNumber || 0,
        winner: roundWinner,
        playerScore: pScore,
        bankerScore: bScore,
        totalWagered,
        winnings: roundWinnings,
        timestamp: Date.now()
      }, ...prev].slice(0, 20));
    }
    
    // Show result banner
    const totalBetAmount = Object.values(activeBets).filter(v => v > 0).reduce((s, v) => s + v, 0);
    if (totalBetAmount > 0) {
      const winnerLabel = roundWinner === 'player' ? '👤 Player Wins' : roundWinner === 'banker' ? '🏦 Banker Wins' : '🤝 Tie';
      const netResult = newBankroll - bankroll;
      if (roundWinnings > 0) {
        showResultBanner('win', roundWinnings, `${winnerLabel} — P:${pScore} B:${bScore}`);
      } else if (roundWinnings === 0) {
        showResultBanner('push', 0, `${winnerLabel} — P:${pScore} B:${bScore}`);
      } else {
        showResultBanner('loss', roundWinnings, `${winnerLabel} — P:${pScore} B:${bScore}`);
      }
    }

    await saveUserData({ bankroll: newBankroll, activeBets: newActiveBets, sessionStats: newStats });
    await updateLeaderboard(newBankroll);
    
    return roundWinner;
  };

  // ========== FIREBASE: Admin deal writes to Firebase — all clients auto-resolve ==========
  const adminDealCards = async () => {
    const pCards = [adminPlayerCards[0], adminPlayerCards[1]];
    const bCards = [adminBankerCards[0], adminBankerCards[1]];
    if (adminPlayerThird) pCards.push(adminPlayerThird);
    if (adminBankerThird) bCards.push(adminBankerThird);
    
    const pScore = calculateScore(pCards);
    const bScore = calculateScore(bCards);
    let roundWinner = null;
    if (pScore > bScore) roundWinner = 'player';
    else if (bScore > pScore) roundWinner = 'banker';
    else roundWinner = 'tie';
    
    const newRoadmap = [...(gameState.roadmap || []), roundWinner === 'player' ? 'P' : roundWinner === 'banker' ? 'B' : 'T'].slice(-50);
    
    // Push to Firebase — all clients will auto-resolve via useEffect
    await updateGameState({
      gamePhase: 'dealt',
      playerCards: pCards,
      bankerCards: bCards,
      playerScore: pScore,
      bankerScore: bScore,
      winner: roundWinner,
      roundNumber: (gameState.roundNumber || 0) + 1,
      bettingOpen: false,
      roadmap: newRoadmap
    });
    
    setAdminPlayerCards(['', '']);
    setAdminBankerCards(['', '']);
    setAdminPlayerThird('');
    setAdminBankerThird('');
    
    const winLabel = roundWinner === 'player' ? '👤 Player Wins' : roundWinner === 'banker' ? '🏦 Banker Wins' : '🤝 Tie';
    await sendSystemMessage(`🃏 ${winLabel}! Player: ${pScore} | Banker: ${bScore} — Round #${(gameState.roundNumber || 0) + 1}`);
  };

  // ========== Dealer betting controls ==========
  const adminOpenBetting = async () => {
    await updateGameState({
      gamePhase: 'betting', playerCards: [], bankerCards: [],
      playerScore: 0, bankerScore: 0, winner: null,
      bettingOpen: true, countdown: countdownDuration
    });
    await sendSystemMessage(`🟢 Betting is OPEN — ${countdownDuration}s to place your bets!`);
  };
  
  const adminCloseBetting = async () => {
    await updateGameState({ bettingOpen: false, countdown: 0 });
    await sendSystemMessage('🔴 Betting is CLOSED — no more bets!');
  };
  
  const adminStartNewRound = adminOpenBetting;

  // ========== FIREBASE: Bonus chips ==========
  const distributeBonusChips = async () => {
    if (bonusChipsAmount <= 0) { alert('Please enter a valid bonus amount'); return; }
    const targetName = bonusRecipient === 'all' ? `ALL ${leaderboard.length} players` : leaderboard.find(p => p.userId === bonusRecipient)?.name || 'Unknown';
    if (confirm(`Give $${bonusChipsAmount.toLocaleString()} to ${targetName}?`)) {
      await fbDistributeBonusChips(leaderboard, bonusRecipient, bonusChipsAmount, userId, setBankroll);
      alert(`Distributed $${bonusChipsAmount.toLocaleString()} to ${targetName}!`);
      setBonusChipsAmount(0);
    }
  };

  // ========== FIREBASE: Reset ==========
  const adminResetSession = async () => {
    if (confirm('Reset entire session?')) {
      try {
        await resetSession(GAME_NAME);
        setBankroll(startingChips); clearAllBets(); setActiveBets({});
        setSessionStats({ totalWagered: 0, biggestWin: 0, totalRounds: 0, startingBankroll: startingChips });
        await saveUserData({ bankroll: startingChips, activeBets: {}, sessionStats: { totalWagered: 0, biggestWin: 0, totalRounds: 0, startingBankroll: startingChips }});
      } catch (e) { console.error('Reset failed:', e); }
    }
  };

  // ========== FIREBASE: Chat ==========
  const sendChatMessage = async () => {
    if (!chatInput.trim()) return;
    await fbSendMessage(userId, userName, chatInput);
    setChatInput('');
  };
  
  // Auto-scroll chat to bottom
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages]);


  // Undo last result — reverts bankroll to before the last round
  const undoLastResult = async () => {
    if (prevBankroll === null) return;
    if (!confirm('Undo last result? This will revert your bankroll to before the last round.')) return;
    setBankroll(prevBankroll);
    await saveUserData({ bankroll: prevBankroll });
    await updateLeaderboard(prevBankroll);
    setLastRoundUndoable(false);
    setPrevBankroll(null);
    setResultBanner(null);
    await sendSystemMessage('⚠️ Last result was VOIDED by dealer');
  };

  // System message helper
  const sendSystemMessage = async (text) => {
    await fbSendMessage('system', '🎰 System', text);
  };


  // FIREBASE: activeUsers tracked via usePresence hook

  // Card rendering component
  const Card = ({ card, hidden = false }) => {
    if (hidden) {
      return (
        <div style={{
          width: isMobile ? '50px' : '70px',
          height: isMobile ? '72px' : '100px',
          background: 'linear-gradient(135deg, #1a5f7a 0%, #0d3d4d 100%)',
          borderRadius: '8px',
          border: '2px solid #d4af37',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          position: 'relative',
          overflow: 'hidden'
        }}>
          <div style={{
            position: 'absolute',
            width: '100%',
            height: '100%',
            background: 'repeating-linear-gradient(45deg, rgba(212,175,55,0.1), rgba(212,175,55,0.1) 10px, transparent 10px, transparent 20px)'
          }} />
        </div>
      );
    }

    if (!card) return null;
    
    const suit = card.slice(-1);
    const value = card.slice(0, -1);
    const isRed = suit === '♥' || suit === '♦';
    
    return (
      <div style={{
        width: isMobile ? '50px' : '70px',
        height: isMobile ? '72px' : '100px',
        background: '#fff',
        borderRadius: '8px',
        border: '2px solid #333',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        position: 'relative'
      }}>
        <div style={{ 
          fontSize: '18px', 
          fontWeight: 'bold', 
          color: isRed ? '#dc143c' : '#000',
          lineHeight: '1'
        }}>
          {value}
        </div>
        <div style={{ fontSize: '32px', color: isRed ? '#dc143c' : '#000' }}>
          {suit}
        </div>
        <div style={{ 
          fontSize: '18px', 
          fontWeight: 'bold', 
          color: isRed ? '#dc143c' : '#000',
          lineHeight: '1',
          transform: 'rotate(180deg)'
        }}>
          {value}
        </div>
      </div>
    );
  };

  if (!isRegistered) {
    return (
      <div style={{
        minHeight: '100vh',
        background: '#1a5f1a',
        backgroundImage: `
          repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(0,0,0,.05) 10px, rgba(0,0,0,.05) 20px),
          radial-gradient(circle at 30% 50%, rgba(255,255,255,0.03) 0%, transparent 70%)
        `,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: '"Courier New", monospace',
        padding: '20px'
      }}>
        <div style={{
          background: 'linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)',
          border: '3px solid #d4af37',
          borderRadius: '15px',
          padding: '50px 40px',
          maxWidth: '450px',
          width: '100%',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.8), inset 0 1px 0 rgba(255, 255, 255, 0.1)'
        }}>
          <div style={{ textAlign: 'center', marginBottom: '35px' }}>
            <div style={{
              fontSize: '42px',
              fontWeight: 'bold',
              color: '#d4af37',
              marginBottom: '10px',
              letterSpacing: '3px',
              textShadow: '0 0 20px rgba(212, 175, 55, 0.5)'
            }}>
              ACTION SYNC
            </div>
            <div style={{
              color: '#888',
              fontSize: '13px',
              letterSpacing: '4px',
              textTransform: 'uppercase'
            }}>
              Live Casino Baccarat
            </div>
          </div>
          
          <div style={{ marginBottom: '25px' }}>
            <label style={{
              display: 'block',
              color: '#d4af37',
              fontSize: '11px',
              letterSpacing: '2px',
              textTransform: 'uppercase',
              marginBottom: '8px'
            }}>
              Your Name
            </label>
            <input
              type="text"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && registerUser()}
              placeholder="Enter player name"
              style={{
                width: '100%',
                padding: '14px',
                background: '#0a0a0a',
                border: '2px solid #444',
                borderRadius: '8px',
                color: '#fff',
                fontSize: '15px',
                outline: 'none',
                transition: 'all 0.3s ease',
                fontFamily: 'inherit'
              }}
            />
          </div>
          
          <button
            onClick={registerUser}
            disabled={!userName.trim()}
            style={{
              width: '100%',
              padding: '16px',
              background: userName.trim() 
                ? 'linear-gradient(135deg, #d4af37 0%, #f4e5a1 100%)'
                : '#333',
              border: 'none',
              borderRadius: '8px',
              color: userName.trim() ? '#000' : '#666',
              fontSize: '15px',
              fontWeight: 'bold',
              letterSpacing: '3px',
              cursor: userName.trim() ? 'pointer' : 'not-allowed',
              transition: 'all 0.3s ease',
              textTransform: 'uppercase',
              fontFamily: 'inherit',
              boxShadow: userName.trim() ? '0 8px 25px rgba(212, 175, 55, 0.4)' : 'none'
            }}
          >
            Join Table
          </button>
          
          <div style={{
            marginTop: '25px',
            padding: '18px',
            background: 'rgba(212, 175, 55, 0.1)',
            borderRadius: '8px',
            border: '1px solid rgba(212, 175, 55, 0.2)'
          }}>
            <div style={{ color: '#d4af37', fontSize: '12px', marginBottom: '12px', fontWeight: 'bold' }}>
              Starting Chips: $1,000
            </div>
            <div style={{ color: '#888', fontSize: '10px', lineHeight: '1.6' }}>
              Virtual entertainment only. No real money. 18+ only.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#1a5f1a',
      backgroundImage: `
        repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(0,0,0,.05) 10px, rgba(0,0,0,.05) 20px),
        radial-gradient(circle at 30% 50%, rgba(255,255,255,0.03) 0%, transparent 70%)
      `,
      fontFamily: '"Courier New", monospace',
      color: '#fff',
      paddingBottom: '20px',
      overflow: 'auto'
    }}>
      {/* Header */}
      <div style={{
        padding: isMobile ? '8px 10px' : '12px 20px',
        background: 'linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)',
        borderBottom: '3px solid #d4af37',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        position: 'sticky',
        top: 0,
        zIndex: 1000
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? '8px' : '20px' }}>
          <div style={{ fontSize: isMobile ? '14px' : '20px', fontWeight: 'bold', color: '#d4af37', letterSpacing: '2px' }}>
            ACTION SYNC
          </div>
          <div style={{ fontSize: '11px', color: '#888' }}>
            <span style={{ color: '#aaa', fontSize: '12px' }}>{userName}</span>
              <span style={{ color: '#d4af37', fontSize: isMobile ? '16px' : '22px', fontWeight: 'bold', marginLeft: isMobile ? '5px' : '10px' }}>${Math.round(bankroll).toLocaleString()}</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          {onBack && isAdmin && (
            <button
              onClick={onBack}
              style={{
                background: 'rgba(33, 150, 243, 0.2)',
                border: '1px solid #2196f3',
                borderRadius: '6px',
                padding: '6px 12px',
                color: '#2196f3',
                cursor: 'pointer',
                fontSize: '11px',
                fontFamily: 'inherit',
                display: 'flex',
                alignItems: 'center',
                gap: '5px'
              }}
            >
              <ArrowLeft size={14} /> Games
            </button>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: '#888' }}>
            <Users size={14} />
            {activeUsers}
          </div>
        </div>
      </div>

      {/* Main Container */}
      <div style={{ maxWidth: '1400px', margin: '20px auto', padding: isMobile ? '0 8px' : '0 20px' }}>
        
        {/* Status Bar */}
        <div style={{
          background: 'linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)',
          border: '3px solid #d4af37',
          borderRadius: '10px',
          padding: '15px 20px',
          marginBottom: '20px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div>
            <div style={{ fontSize: '10px', color: '#888', marginBottom: '4px' }}>GAME</div>
            <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#d4af37' }}>
              BACCARAT
            </div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '10px', color: '#888', marginBottom: '4px' }}>STATUS</div>
            <div style={{ fontSize: '18px', fontWeight: 'bold', color: gamePhase === 'betting' ? '#4caf50' : '#ff9800' }}>
              {gamePhase === 'betting' ? 'BETTING' : 'HAND DEALT'}
            </div>
          </div>
          {bettingOpen && (
            <div style={{
              background: countdown <= 5 ? '#ff5252' : '#d4af37',
              color: '#000',
              borderRadius: '8px',
              padding: '10px 20px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              animation: countdown <= 5 ? 'pulse 1s infinite' : 'none'
            }}>
              <Timer size={18} />
              <span style={{ fontSize: '20px', fontWeight: 'bold' }}>{countdown}s</span>
            </div>
          )}
          <div>
            <div style={{ fontSize: '10px', color: '#888', marginBottom: '4px' }}>ROUND #{roundNumber}</div>
            {winner && (
              <div style={{
                fontSize: '16px',
                fontWeight: 'bold',
                color: winner === 'player' ? '#2196f3' : winner === 'banker' ? '#f44336' : '#ffc107'
              }}>
                {winner === 'player' ? 'PLAYER WINS' : winner === 'banker' ? 'BANKER WINS' : 'TIE'}
              </div>
            )}
          </div>
        </div>

        {/* Baccarat Table */}
        <div style={{
          background: '#0d3d0d',
          border: '8px solid #8b4513',
          borderRadius: '20px',
          padding: '40px',
          boxShadow: 'inset 0 0 50px rgba(0,0,0,0.5), 0 10px 40px rgba(0,0,0,0.8)',
          marginBottom: '20px'
        }}>
          
          {/* Card Display Area */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
            gap: '40px',
            marginBottom: '40px'
          }}>
            {/* Player Side */}
            <div>
              <div style={{
                fontSize: '14px',
                color: '#2196f3',
                fontWeight: 'bold',
                marginBottom: '15px',
                textAlign: 'center',
                letterSpacing: '2px'
              }}>
                PLAYER
              </div>
              <div style={{
                display: 'flex',
                gap: '15px',
                justifyContent: 'center',
                marginBottom: '15px',
                minHeight: '100px'
              }}>
                {gamePhase === 'betting' ? (
                  <>
                    <Card hidden />
                    <Card hidden />
                  </>
                ) : (
                  playerCards.map((card, idx) => <Card key={idx} card={card} />)
                )}
              </div>
              {gamePhase === 'dealt' && (
                <div style={{
                  textAlign: 'center',
                  fontSize: '32px',
                  fontWeight: 'bold',
                  color: '#2196f3',
                  background: 'rgba(33, 150, 243, 0.2)',
                  padding: '15px',
                  borderRadius: '10px',
                  border: '2px solid #2196f3'
                }}>
                  {playerScore}
                </div>
              )}
            </div>

            {/* Banker Side */}
            <div>
              <div style={{
                fontSize: '14px',
                color: '#f44336',
                fontWeight: 'bold',
                marginBottom: '15px',
                textAlign: 'center',
                letterSpacing: '2px'
              }}>
                BANKER
              </div>
              <div style={{
                display: 'flex',
                gap: '15px',
                justifyContent: 'center',
                marginBottom: '15px',
                minHeight: '100px'
              }}>
                {gamePhase === 'betting' ? (
                  <>
                    <Card hidden />
                    <Card hidden />
                  </>
                ) : (
                  bankerCards.map((card, idx) => <Card key={idx} card={card} />)
                )}
              </div>
              {gamePhase === 'dealt' && (
                <div style={{
                  textAlign: 'center',
                  fontSize: '32px',
                  fontWeight: 'bold',
                  color: '#f44336',
                  background: 'rgba(244, 67, 54, 0.2)',
                  padding: '15px',
                  borderRadius: '10px',
                  border: '2px solid #f44336'
                }}>
                  {bankerScore}
                </div>
              )}
            </div>
          </div>

          {/* Betting Areas */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            gap: '20px',
            marginBottom: '20px'
          }}>
            {/* Player Bet */}
            <div
              onClick={() => bettingOpen && placeBet('player')}
              style={{
                background: currentBets.player + (activeBets.player || 0) > 0 
                  ? 'linear-gradient(135deg, #2196f3 0%, #42a5f5 100%)'
                  : 'rgba(33, 150, 243, 0.3)',
                border: '3px solid #2196f3',
                borderRadius: '15px',
                padding: '30px 20px',
                textAlign: 'center',
                cursor: bettingOpen ? 'pointer' : 'not-allowed',
                position: 'relative',
                transition: 'all 0.2s',
                opacity: bettingOpen ? 1 : 0.5
              }}
            >
              <div style={{
                fontSize: '20px',
                fontWeight: 'bold',
                color: currentBets.player + (activeBets.player || 0) > 0 ? '#000' : '#fff',
                marginBottom: '8px',
                letterSpacing: '2px'
              }}>
                PLAYER
              </div>
              <div style={{
                fontSize: '12px',
                color: currentBets.player + (activeBets.player || 0) > 0 ? '#000' : 'rgba(255,255,255,0.7)'
              }}>
                Pays 1:1
              </div>
              {(currentBets.player + (activeBets.player || 0)) > 0 && (
                <div style={{
                  position: 'absolute',
                  top: '-15px',
                  right: '-15px',
                  background: '#000',
                  color: '#d4af37',
                  borderRadius: '50%',
                  width: isMobile ? '42px' : '50px',
                  height: isMobile ? '42px' : '50px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '14px',
                  fontWeight: 'bold',
                  border: '3px solid #d4af37',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.5)'
                }}>
                  ${currentBets.player + (activeBets.player || 0)}
                </div>
              )}
            </div>

            {/* Tie Bet */}
            <div
              onClick={() => bettingOpen && placeBet('tie')}
              style={{
                background: currentBets.tie + (activeBets.tie || 0) > 0 
                  ? 'linear-gradient(135deg, #ffc107 0%, #ffd54f 100%)'
                  : 'rgba(255, 193, 7, 0.3)',
                border: '3px solid #ffc107',
                borderRadius: '15px',
                padding: '30px 20px',
                textAlign: 'center',
                cursor: bettingOpen ? 'pointer' : 'not-allowed',
                position: 'relative',
                transition: 'all 0.2s',
                opacity: bettingOpen ? 1 : 0.5
              }}
            >
              <div style={{
                fontSize: '20px',
                fontWeight: 'bold',
                color: currentBets.tie + (activeBets.tie || 0) > 0 ? '#000' : '#fff',
                marginBottom: '8px',
                letterSpacing: '2px'
              }}>
                TIE
              </div>
              <div style={{
                fontSize: '12px',
                color: currentBets.tie + (activeBets.tie || 0) > 0 ? '#000' : 'rgba(255,255,255,0.7)'
              }}>
                Pays 8:1
              </div>
              {(currentBets.tie + (activeBets.tie || 0)) > 0 && (
                <div style={{
                  position: 'absolute',
                  top: '-15px',
                  right: '-15px',
                  background: '#000',
                  color: '#d4af37',
                  borderRadius: '50%',
                  width: isMobile ? '42px' : '50px',
                  height: isMobile ? '42px' : '50px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '14px',
                  fontWeight: 'bold',
                  border: '3px solid #d4af37',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.5)'
                }}>
                  ${currentBets.tie + (activeBets.tie || 0)}
                </div>
              )}
            </div>

            {/* Banker Bet */}
            <div
              onClick={() => bettingOpen && placeBet('banker')}
              style={{
                background: currentBets.banker + (activeBets.banker || 0) > 0 
                  ? 'linear-gradient(135deg, #f44336 0%, #ef5350 100%)'
                  : 'rgba(244, 67, 54, 0.3)',
                border: '3px solid #f44336',
                borderRadius: '15px',
                padding: '30px 20px',
                textAlign: 'center',
                cursor: bettingOpen ? 'pointer' : 'not-allowed',
                position: 'relative',
                transition: 'all 0.2s',
                opacity: bettingOpen ? 1 : 0.5
              }}
            >
              <div style={{
                fontSize: '20px',
                fontWeight: 'bold',
                color: currentBets.banker + (activeBets.banker || 0) > 0 ? '#000' : '#fff',
                marginBottom: '8px',
                letterSpacing: '2px'
              }}>
                BANKER
              </div>
              <div style={{
                fontSize: '12px',
                color: currentBets.banker + (activeBets.banker || 0) > 0 ? '#000' : 'rgba(255,255,255,0.7)'
              }}>
                Pays 0.95:1
              </div>
              {(currentBets.banker + (activeBets.banker || 0)) > 0 && (
                <div style={{
                  position: 'absolute',
                  top: '-15px',
                  right: '-15px',
                  background: '#000',
                  color: '#d4af37',
                  borderRadius: '50%',
                  width: isMobile ? '42px' : '50px',
                  height: isMobile ? '42px' : '50px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '14px',
                  fontWeight: 'bold',
                  border: '3px solid #d4af37',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.5)'
                }}>
                  ${currentBets.banker + (activeBets.banker || 0)}
                </div>
              )}
            </div>
          </div>

          {/* Side Bets */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: '15px'
          }}>
            {/* Player Pair */}
            <div
              onClick={() => bettingOpen && placeBet('playerPair')}
              style={{
                background: currentBets.playerPair + (activeBets.playerPair || 0) > 0 
                  ? '#9c27b0' 
                  : 'rgba(156, 39, 176, 0.3)',
                border: '2px solid #9c27b0',
                borderRadius: '10px',
                padding: '15px 10px',
                textAlign: 'center',
                cursor: bettingOpen ? 'pointer' : 'not-allowed',
                position: 'relative',
                fontSize: '11px',
                fontWeight: 'bold',
                color: currentBets.playerPair + (activeBets.playerPair || 0) > 0 ? '#fff' : 'rgba(255,255,255,0.8)',
                opacity: bettingOpen ? 1 : 0.5
              }}
            >
              <div>PLAYER PAIR</div>
              <div style={{ fontSize: '9px', marginTop: '4px', opacity: 0.8 }}>11:1</div>
              {(currentBets.playerPair + (activeBets.playerPair || 0)) > 0 && (
                <div style={{
                  position: 'absolute',
                  top: '-10px',
                  right: '-10px',
                  background: '#000',
                  color: '#d4af37',
                  borderRadius: '50%',
                  width: '30px',
                  height: '30px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '10px',
                  fontWeight: 'bold',
                  border: '2px solid #d4af37'
                }}>
                  ${currentBets.playerPair + (activeBets.playerPair || 0)}
                </div>
              )}
            </div>

            {/* Banker Pair */}
            <div
              onClick={() => bettingOpen && placeBet('bankerPair')}
              style={{
                background: currentBets.bankerPair + (activeBets.bankerPair || 0) > 0 
                  ? '#9c27b0' 
                  : 'rgba(156, 39, 176, 0.3)',
                border: '2px solid #9c27b0',
                borderRadius: '10px',
                padding: '15px 10px',
                textAlign: 'center',
                cursor: bettingOpen ? 'pointer' : 'not-allowed',
                position: 'relative',
                fontSize: '11px',
                fontWeight: 'bold',
                color: currentBets.bankerPair + (activeBets.bankerPair || 0) > 0 ? '#fff' : 'rgba(255,255,255,0.8)',
                opacity: bettingOpen ? 1 : 0.5
              }}
            >
              <div>BANKER PAIR</div>
              <div style={{ fontSize: '9px', marginTop: '4px', opacity: 0.8 }}>11:1</div>
              {(currentBets.bankerPair + (activeBets.bankerPair || 0)) > 0 && (
                <div style={{
                  position: 'absolute',
                  top: '-10px',
                  right: '-10px',
                  background: '#000',
                  color: '#d4af37',
                  borderRadius: '50%',
                  width: '30px',
                  height: '30px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '10px',
                  fontWeight: 'bold',
                  border: '2px solid #d4af37'
                }}>
                  ${currentBets.bankerPair + (activeBets.bankerPair || 0)}
                </div>
              )}
            </div>

            {/* Dragon Bonus */}
            <div
              onClick={() => bettingOpen && placeBet('dragon')}
              style={{
                background: currentBets.dragon + (activeBets.dragon || 0) > 0 
                  ? 'linear-gradient(135deg, #ff5722 0%, #ff7043 100%)' 
                  : 'rgba(255, 87, 34, 0.3)',
                border: '2px solid #ff5722',
                borderRadius: '10px',
                padding: '15px 10px',
                textAlign: 'center',
                cursor: bettingOpen ? 'pointer' : 'not-allowed',
                position: 'relative',
                fontSize: '11px',
                fontWeight: 'bold',
                color: currentBets.dragon + (activeBets.dragon || 0) > 0 ? '#fff' : 'rgba(255,255,255,0.8)',
                opacity: bettingOpen ? 1 : 0.5
              }}
            >
              <div>🐉 DRAGON</div>
              <div style={{ fontSize: '9px', marginTop: '4px', opacity: 0.8 }}>Nat 9 Win 30:1</div>
              {(currentBets.dragon + (activeBets.dragon || 0)) > 0 && (
                <div style={{
                  position: 'absolute',
                  top: '-10px',
                  right: '-10px',
                  background: '#000',
                  color: '#d4af37',
                  borderRadius: '50%',
                  width: '30px',
                  height: '30px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '10px',
                  fontWeight: 'bold',
                  border: '2px solid #d4af37'
                }}>
                  ${currentBets.dragon + (activeBets.dragon || 0)}
                </div>
              )}
            </div>

            {/* Panda Bonus */}
            <div
              onClick={() => bettingOpen && placeBet('panda')}
              style={{
                background: currentBets.panda + (activeBets.panda || 0) > 0 
                  ? 'linear-gradient(135deg, #4caf50 0%, #66bb6a 100%)' 
                  : 'rgba(76, 175, 80, 0.3)',
                border: '2px solid #4caf50',
                borderRadius: '10px',
                padding: '15px 10px',
                textAlign: 'center',
                cursor: bettingOpen ? 'pointer' : 'not-allowed',
                position: 'relative',
                fontSize: '11px',
                fontWeight: 'bold',
                color: currentBets.panda + (activeBets.panda || 0) > 0 ? '#fff' : 'rgba(255,255,255,0.8)',
                opacity: bettingOpen ? 1 : 0.5
              }}
            >
              <div>🐼 PANDA</div>
              <div style={{ fontSize: '9px', marginTop: '4px', opacity: 0.8 }}>Nat 8 Win 25:1</div>
              {(currentBets.panda + (activeBets.panda || 0)) > 0 && (
                <div style={{
                  position: 'absolute',
                  top: '-10px',
                  right: '-10px',
                  background: '#000',
                  color: '#d4af37',
                  borderRadius: '50%',
                  width: '30px',
                  height: '30px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '10px',
                  fontWeight: 'bold',
                  border: '2px solid #d4af37'
                }}>
                  ${currentBets.panda + (activeBets.panda || 0)}
                </div>
              )}
            </div>
          </div>
        </div>


        {/* Active Bets Summary */}
        {Object.keys(activeBets).some(k => activeBets[k] > 0) && (
          <div style={{
            background: 'linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)',
            border: !bettingOpen ? '2px solid #f44336' : '2px solid #4caf50',
            borderRadius: '12px',
            padding: '15px 20px',
            marginBottom: '20px'
          }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px'
            }}>
              <div style={{
                fontSize: '11px', letterSpacing: '2px', textTransform: 'uppercase',
                color: !bettingOpen ? '#f44336' : '#4caf50', fontWeight: 'bold'
              }}>
                {!bettingOpen ? '🔒 Your Locked Bets' : '📋 Your Active Bets'}
              </div>
              <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#d4af37' }}>
                Total: ${(Object.values(activeBets).filter(v => v > 0).reduce((s, v) => s + v, 0) + Object.values(currentBets).filter(v => v > 0).reduce((s, v) => s + v, 0)).toLocaleString()}
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {Object.entries(activeBets).filter(([_, v]) => v > 0).map(([key, amount]) => {
                const label = key === 'player' ? '👤 Player'
                  : key === 'banker' ? '🏦 Banker'
                  : key === 'tie' ? '🤝 Tie'
                  : key === 'playerPair' ? '👤 Pair'
                  : key === 'bankerPair' ? '🏦 Pair'
                  : key;
                return (
                  <div key={'locked-' + key} style={{
                    background: 'rgba(212, 175, 55, 0.15)',
                    border: '1px solid rgba(212, 175, 55, 0.3)',
                    borderRadius: '20px',
                    padding: '5px 12px',
                    fontSize: '11px',
                    color: '#d4af37'
                  }}>
                    🔒 {label} <span style={{ fontWeight: 'bold' }}>${amount}</span>
                  </div>
                );
              })}
              {Object.entries(currentBets).filter(([_, v]) => v > 0).map(([key, amount]) => {
                const label = key === 'player' ? '👤 Player'
                  : key === 'banker' ? '🏦 Banker'
                  : key === 'tie' ? '🤝 Tie'
                  : key === 'playerPair' ? '👤 Pair'
                  : key === 'bankerPair' ? '🏦 Pair'
                  : key;
                return (
                  <div key={'pending-' + key} onClick={() => removeSingleBet(key)} style={{
                    background: 'rgba(76, 175, 80, 0.15)',
                    border: '1px solid rgba(76, 175, 80, 0.4)',
                    borderRadius: '20px',
                    padding: '5px 12px',
                    fontSize: '11px',
                    color: '#4caf50',
                    cursor: 'pointer',
                    transition: 'all 0.15s'
                  }}>
                    ✕ {label} <span style={{ fontWeight: 'bold' }}>${amount}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Chip Selector and Controls */}
        <div style={{
          position: isMobile ? 'sticky' : 'relative',
          bottom: isMobile ? 0 : 'auto',
          zIndex: isMobile ? 100 : 'auto',
          background: 'linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)',
          border: '2px solid #d4af37',
          borderRadius: '12px',
          padding: '20px',
          marginBottom: '20px'
        }}>
          <div style={{ fontSize: '11px', color: '#888', marginBottom: '12px', letterSpacing: '1px' }}>
            SELECT CHIP VALUE
          </div>
          <div style={{ display: 'flex', gap: '10px', marginBottom: '15px', flexWrap: 'wrap' }}>
            {[5, 10, 25, 50, 100, 500].map(value => (
              <button
                key={value}
                onClick={() => setSelectedChip(value)}
                disabled={bankroll < value}
                style={{
                  width: isMobile ? '52px' : '68px',
                  height: isMobile ? '52px' : '68px',
                  borderRadius: '50%',
                  border: selectedChip === value ? '3px solid #fff' : '3px solid transparent',
                  background: bankroll >= value
                    ? `radial-gradient(circle at 35% 35%, ${
                        value === 5 ? '#ff6b6b, #c0392b'
                        : value === 10 ? '#5dade2, #2471a3'
                        : value === 25 ? '#2ecc71, #1e8449'
                        : value === 50 ? '#f39c12, #d68910'
                        : value === 100 ? '#1a1a1a, #000'
                        : '#9b59b6, #6c3483'
                      })`
                    : 'radial-gradient(circle, #444, #222)',
                  color: bankroll >= value ? '#fff' : '#666',
                  fontSize: isMobile ? '11px' : '14px',
                  fontWeight: 'bold',
                  cursor: bankroll >= value ? 'pointer' : 'not-allowed',
                  fontFamily: 'inherit',
                  transition: 'all 0.15s',
                  boxShadow: selectedChip === value
                    ? '0 0 20px rgba(255,255,255,0.4), inset 0 0 15px rgba(255,255,255,0.15)'
                    : bankroll >= value
                      ? '0 3px 8px rgba(0,0,0,0.4), inset 0 0 12px rgba(255,255,255,0.1)'
                      : 'none',
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  outline: selectedChip === value ? '2px dashed rgba(255,255,255,0.5)' : '2px dashed rgba(255,255,255,0.15)',
                  outlineOffset: '-7px',
                  transform: selectedChip === value ? 'scale(1.1)' : 'scale(1)',
                  textShadow: '0 1px 2px rgba(0,0,0,0.5)'
                }}
              >
                ${value}
              </button>
            ))}
          </div>
          
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={confirmBets}
              disabled={Object.values(currentBets).every(v => v === 0) || !bettingOpen || isConfirming}
              style={{
                flex: 1,
                padding: '16px',
                background: Object.values(currentBets).some(v => v > 0) && bettingOpen
                  ? 'linear-gradient(135deg, #4caf50, #66bb6a)'
                  : '#333',
                border: 'none',
                borderRadius: '8px',
                color: Object.values(currentBets).some(v => v > 0) && bettingOpen ? '#fff' : '#666',
                fontSize: '14px',
                fontWeight: 'bold',
                letterSpacing: '2px',
                cursor: Object.values(currentBets).some(v => v > 0) && bettingOpen ? 'pointer' : 'not-allowed',
                textTransform: 'uppercase',
                fontFamily: 'inherit'
              }}
            >
              {isConfirming ? '⏳ CONFIRMING...' : `✅ CONFIRM BET — $${Object.values(currentBets).reduce((s, v) => s + v, 0).toLocaleString()}`}
            </button>
            {lastConfirmedBets && bettingOpen && (
              <button
                onClick={repeatLastBet}
                disabled={Object.values(lastConfirmedBets).reduce((s, v) => s + v, 0) > bankroll}
                style={{
                  padding: '16px 20px',
                  background: Object.values(lastConfirmedBets).reduce((s, v) => s + v, 0) <= bankroll
                    ? 'rgba(33, 150, 243, 0.3)' : '#333',
                  border: '1px solid #2196f3',
                  borderRadius: '8px',
                  color: Object.values(lastConfirmedBets).reduce((s, v) => s + v, 0) <= bankroll ? '#2196f3' : '#666',
                  fontSize: '11px',
                  fontWeight: 'bold',
                  cursor: Object.values(lastConfirmedBets).reduce((s, v) => s + v, 0) <= bankroll ? 'pointer' : 'not-allowed',
                  fontFamily: 'inherit',
                  textTransform: 'uppercase',
                  letterSpacing: '1px'
                }}
              >
                🔁 Repeat
              </button>
            )}
            <button
              onClick={clearAllBets}
              disabled={Object.values(currentBets).every(v => v === 0)}
              style={{
                padding: '16px 24px',
                background: Object.values(currentBets).some(v => v > 0) ? 'rgba(244, 67, 54, 0.3)' : '#333',
                border: '1px solid #f44336',
                borderRadius: '8px',
                color: Object.values(currentBets).some(v => v > 0) ? '#f44336' : '#666',
                fontSize: '12px',
                fontWeight: 'bold',
                cursor: Object.values(currentBets).some(v => v > 0) ? 'pointer' : 'not-allowed',
                fontFamily: 'inherit'
              }}
            >
              Clear All
            </button>
          </div>
        </div>

        {/* Roadmap */}
        <div style={{
          background: 'linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)',
          border: '2px solid #d4af37',
          borderRadius: '12px',
          padding: '20px',
          marginBottom: '20px'
        }}>
          <div style={{
            fontSize: '11px',
            letterSpacing: '2px',
            textTransform: 'uppercase',
            color: '#d4af37',
            marginBottom: '15px',
            fontWeight: 'bold'
          }}>
            📊 Roadmap
          </div>
          {roadmap.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '20px', color: '#666', fontSize: '11px' }}>
              No rounds yet
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {roadmap.map((result, idx) => (
                <div key={idx} style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '50%',
                  background: result === 'P' ? '#2196f3' : result === 'B' ? '#f44336' : '#ffc107',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '16px',
                  fontWeight: 'bold',
                  color: '#fff',
                  border: '2px solid rgba(255,255,255,0.3)'
                }}>
                  {result}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Session Stats */}
        <div style={{
          background: 'linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)',
          border: '2px solid #d4af37',
          borderRadius: '12px',
          padding: '20px',
          marginBottom: '20px'
        }}>
          <div style={{
            fontSize: '11px',
            letterSpacing: '2px',
            textTransform: 'uppercase',
            color: '#d4af37',
            marginBottom: '15px',
            fontWeight: 'bold'
          }}>
            📊 Session Stats
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '1fr 1fr 1fr 1fr', gap: isMobile ? '8px' : '15px' }}>
            <div>
              <div style={{ fontSize: '9px', color: '#888', marginBottom: '4px' }}>Total Wagered</div>
              <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#fff' }}>
                ${sessionStats.totalWagered.toLocaleString()}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '9px', color: '#888', marginBottom: '4px' }}>Biggest Win</div>
              <div style={{ fontSize: '16px', fontWeight: 'bold', color: sessionStats.biggestWin > 0 ? '#4caf50' : '#888' }}>
                ${sessionStats.biggestWin.toLocaleString()}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '9px', color: '#888', marginBottom: '4px' }}>Total Rounds</div>
              <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#fff' }}>
                {sessionStats.totalRounds}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '9px', color: '#888', marginBottom: '4px' }}>Net P/L</div>
              <div style={{ fontSize: '16px', fontWeight: 'bold', color: bankroll - sessionStats.startingBankroll >= 0 ? '#4caf50' : '#f44336' }}>
                {bankroll - sessionStats.startingBankroll >= 0 ? '+' : ''}${(bankroll - sessionStats.startingBankroll).toLocaleString()}
              </div>
            </div>
          </div>
        </div>

        {/* Leaderboard */}
        <div style={{
          background: 'linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)',
          border: '2px solid #d4af37',
          borderRadius: '12px',
          padding: '20px',
          marginBottom: '20px'
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            marginBottom: '18px'
          }}>
            <Trophy size={18} color="#d4af37" />
            <div style={{
              fontSize: '13px',
              letterSpacing: '2px',
              textTransform: 'uppercase',
              color: '#d4af37',
              fontWeight: 'bold'
            }}>
              Top Players <span style={{ fontSize: '8px', color: '#4caf50', marginLeft: '8px', animation: 'pulse 2s infinite' }}>● LIVE</span>
            </div>
          </div>
          
          {leaderboard.length === 0 ? (
            <div style={{
              textAlign: 'center',
              padding: '25px',
              color: '#666',
              fontSize: '12px'
            }}>
              Waiting for players...
            </div>
          ) : (
            leaderboard.map((player, idx) => (
              <div key={player.userId} style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '12px',
                background: player.userId === userId 
                  ? 'rgba(212, 175, 55, 0.2)' 
                  : 'rgba(0, 0, 0, 0.3)',
                border: player.userId === userId 
                  ? '2px solid #d4af37'
                  : '1px solid rgba(255, 255, 255, 0.05)',
                borderRadius: '8px',
                marginBottom: '8px'
              }}>
                <div style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  background: idx === 0 ? '#d4af37' 
                    : idx === 1 ? '#c0c0c0'
                    : idx === 2 ? '#cd7f32'
                    : 'rgba(255, 255, 255, 0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '12px',
                  fontWeight: 'bold',
                  color: idx < 3 ? '#000' : '#fff',
                  flexShrink: 0
                }}>
                  {idx < 3 ? <Crown size={14} /> : idx + 1}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: '13px',
                    fontWeight: player.userId === userId ? 'bold' : 'normal',
                    color: player.userId === userId ? '#d4af37' : '#fff',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}>
                    {player.name}
                  </div>
                </div>
                <div style={{
                  fontSize: '14px',
                  fontWeight: 'bold',
                  color: player.bankroll >= startingChips ? '#4caf50' : player.bankroll >= startingChips / 2 ? '#ff9800' : '#f44336',
                  flexShrink: 0
                }}>
                  ${Math.round(player.bankroll).toLocaleString()}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Bet History */}
        <div style={{
          background: 'linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)',
          border: '2px solid #d4af37',
          borderRadius: '12px',
          padding: '20px',
          marginBottom: '20px'
        }}>
          <div
            onClick={() => setShowBetHistory(!showBetHistory)}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
          >
            <div style={{ fontSize: '11px', letterSpacing: '2px', textTransform: 'uppercase', color: '#d4af37', fontWeight: 'bold' }}>
              📋 My Bet History ({betHistory.length})
            </div>
            <div style={{ color: '#888', fontSize: '16px' }}>{showBetHistory ? '▲' : '▼'}</div>
          </div>
          {showBetHistory && (
            <div style={{ marginTop: '15px' }}>
              {betHistory.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '20px', color: '#666', fontSize: '11px' }}>No bets placed yet</div>
              ) : (
                betHistory.map((entry, idx) => (
                  <div key={idx} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '10px 12px',
                    background: entry.winnings >= 0 ? 'rgba(76, 175, 80, 0.1)' : 'rgba(244, 67, 54, 0.1)',
                    border: `1px solid ${entry.winnings >= 0 ? 'rgba(76, 175, 80, 0.3)' : 'rgba(244, 67, 54, 0.3)'}`,
                    borderRadius: '8px', marginBottom: '6px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div style={{
                        padding: '6px 12px',
                        background: entry.winner === 'player' ? 'rgba(33, 150, 243, 0.3)' : entry.winner === 'banker' ? 'rgba(244, 67, 54, 0.3)' : 'rgba(76, 175, 80, 0.3)',
                        borderRadius: '6px', border: '1px solid rgba(255,255,255,0.2)'
                      }}>
                        <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#fff', textTransform: 'uppercase' }}>
                          {entry.winner === 'player' ? 'P' : entry.winner === 'banker' ? 'B' : 'T'} {entry.playerScore}-{entry.bankerScore}
                        </span>
                      </div>
                      <div>
                        <div style={{ fontSize: '11px', color: '#888' }}>Round #{entry.round}</div>
                        <div style={{ fontSize: '10px', color: '#666' }}>Wagered: ${entry.totalWagered}</div>
                      </div>
                    </div>
                    <div style={{
                      fontSize: '14px', fontWeight: 'bold',
                      color: entry.winnings >= 0 ? '#4caf50' : '#f44336'
                    }}>
                      {entry.winnings >= 0 ? '+' : ''}${entry.winnings.toLocaleString()}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Chat */}
        <div style={{
          background: 'linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)',
          border: '2px solid #d4af37',
          borderRadius: '12px',
          padding: '20px',
          marginBottom: '20px'
        }}>
          <div style={{
            fontSize: '11px',
            letterSpacing: '2px',
            textTransform: 'uppercase',
            color: '#d4af37',
            marginBottom: '15px',
            fontWeight: 'bold'
          }}>
            💬 Table Chat
          </div>
          <div style={{
            height: '200px',
            overflowY: 'auto',
            marginBottom: '12px',
            padding: '10px',
            background: 'rgba(0,0,0,0.3)',
            borderRadius: '6px',
            border: '1px solid rgba(255,255,255,0.1)'
          }}>
            {chatMessages.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '20px', color: '#666', fontSize: '11px' }}>
                No messages yet. Say hello!
              </div>
            ) : (<>
              {chatMessages.map((msg, idx) => (
                <div key={idx} style={{
                  marginBottom: '10px',
                  padding: msg.userId === 'system' ? '10px 12px' : '8px',
                  background: msg.userId === 'system' ? 'rgba(212, 175, 55, 0.1)'
                    : msg.userId === userId ? 'rgba(212, 175, 55, 0.1)' : 'rgba(255,255,255,0.05)',
                  borderRadius: '6px',
                  borderLeft: msg.userId === 'system' ? '3px solid #d4af37'
                    : `3px solid ${msg.userId === userId ? '#d4af37' : '#555'}`
                }}>
                  {msg.userId !== 'system' && (
                    <div style={{ fontSize: '10px', color: msg.userId === userId ? '#d4af37' : '#888', marginBottom: '4px' }}>
                      {msg.userName}
                    </div>
                  )}
                  <div style={{
                    fontSize: msg.userId === 'system' ? '11px' : '12px',
                    color: msg.userId === 'system' ? '#d4af37' : '#fff',
                    fontStyle: msg.userId === 'system' ? 'italic' : 'normal'
                  }}>
                    {msg.text}
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </>)}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && sendChatMessage()}
              placeholder="Type a message..."
              maxLength={150}
              style={{
                flex: 1,
                padding: '12px',
                background: 'rgba(0,0,0,0.3)',
                border: '1px solid #555',
                borderRadius: '6px',
                color: '#fff',
                fontSize: '12px',
                outline: 'none',
                fontFamily: 'inherit'
              }}
            />
            <button
              onClick={sendChatMessage}
              disabled={!chatInput.trim()}
              style={{
                padding: isMobile ? '8px 10px' : '12px 20px',
                background: chatInput.trim() ? '#d4af37' : '#333',
                border: 'none',
                borderRadius: '6px',
                color: chatInput.trim() ? '#000' : '#666',
                fontSize: '12px',
                fontWeight: 'bold',
                cursor: chatInput.trim() ? 'pointer' : 'not-allowed',
                fontFamily: 'inherit'
              }}
            >
              Send
            </button>
          </div>
        </div>

        {/* User Settings Panel (Players Only) */}
        {false && (
          <div style={{
            background: 'linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)',
            border: '2px solid #2196f3',
            borderRadius: '12px',
            padding: '25px',
            marginBottom: '20px'
          }}>
            <div style={{
              fontSize: '13px',
              letterSpacing: '2px',
              textTransform: 'uppercase',
              color: '#2196f3',
              marginBottom: '20px',
              fontWeight: 'bold',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              <Settings size={16} />
              PLAYER SETTINGS
            </div>
            
            <div style={{
              background: 'rgba(33, 150, 243, 0.1)',
              padding: '15px',
              borderRadius: '8px',
              marginBottom: '20px',
              border: '1px solid rgba(33, 150, 243, 0.2)'
            }}>
              <div style={{ fontSize: '10px', color: '#888', marginBottom: '8px' }}>
                YOUR ACCOUNT
              </div>
              <div style={{ fontSize: '16px', color: '#fff', fontWeight: 'bold', marginBottom: '5px' }}>
                {userName}
              </div>
              <div style={{ fontSize: '12px', color: '#2196f3' }}>
                Balance: ${Math.round(bankroll).toLocaleString()}
              </div>
            </div>
            
            <div style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
              gap: '10px',
              marginBottom: '20px'
            }}>
              <div style={{
                background: 'rgba(0, 0, 0, 0.3)',
                padding: '12px',
                borderRadius: '8px',
                textAlign: 'center'
              }}>
                <div style={{ fontSize: '9px', color: '#888', marginBottom: '4px' }}>
                  Session P/L
                </div>
                <div style={{
                  fontSize: '16px',
                  fontWeight: 'bold',
                  color: bankroll - sessionStats.startingBankroll >= 0 ? '#4caf50' : '#f44336'
                }}>
                  {bankroll - sessionStats.startingBankroll >= 0 ? '+' : ''}
                  ${(bankroll - sessionStats.startingBankroll).toLocaleString()}
                </div>
              </div>
              <div style={{
                background: 'rgba(0, 0, 0, 0.3)',
                padding: '12px',
                borderRadius: '8px',
                textAlign: 'center'
              }}>
                <div style={{ fontSize: '9px', color: '#888', marginBottom: '4px' }}>
                  Total Wagered
                </div>
                <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#fff' }}>
                  ${sessionStats.totalWagered.toLocaleString()}
                </div>
              </div>
            </div>
            
            <button
              onClick={() => {
                if (confirm('Reset your session stats? Your bankroll will not be affected.')) {
                  setSessionStats({
                    totalWagered: 0,
                    biggestWin: 0,
                    totalRounds: 0,
                    startingBankroll: bankroll
                  });
                  saveUserData({ sessionStats: {
                    totalWagered: 0,
                    biggestWin: 0,
                    totalRounds: 0,
                    startingBankroll: bankroll
                  }});
                }
              }}
              style={{
                width: '100%',
                padding: '12px',
                background: 'rgba(244, 67, 54, 0.2)',
                border: '1px solid #f44336',
                borderRadius: '8px',
                color: '#f44336',
                fontSize: '11px',
                fontWeight: 'bold',
                cursor: 'pointer',
                fontFamily: 'inherit',
                textTransform: 'uppercase',
                letterSpacing: '1px'
              }}
            >
              Reset Session Stats
            </button>
            
            <div style={{
              marginTop: '15px',
              padding: '12px',
              background: 'rgba(33, 150, 243, 0.1)',
              borderRadius: '8px',
              border: '1px solid rgba(33, 150, 243, 0.2)',
              fontSize: '10px',
              color: '#888',
              lineHeight: '1.6'
            }}>
              💡 Your session stats track your performance since joining. Resetting stats will not affect your bankroll or leaderboard position.
            </div>
          </div>
        )}

        {/* Admin / Dealer Controls */}
        {isAdmin && (
          <div style={{
            background: 'linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)',
            border: '3px solid #9c27b0',
            borderRadius: '12px',
            padding: '25px'
          }}>
            <div style={{
              fontSize: '13px',
              letterSpacing: '2px',
              textTransform: 'uppercase',
              color: '#ce93d8',
              marginBottom: '20px',
              fontWeight: 'bold'
            }}>
              🎴 DEALER CONTROLS
            </div>
            
            {/* Chip Management */}
            <div style={{
              background: 'rgba(76, 175, 80, 0.1)',
              padding: '15px',
              borderRadius: '8px',
              marginBottom: '15px',
              border: '1px solid rgba(76, 175, 80, 0.3)'
            }}>
              <div style={{ fontSize: '11px', color: '#4caf50', marginBottom: '12px', fontWeight: 'bold' }}>
                💰 CHIP MANAGEMENT
              </div>
              
              <div style={{ marginBottom: '15px' }}>
                <div style={{ fontSize: '10px', color: '#888', marginBottom: '6px' }}>
                  Starting Chips (for new players)
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="number"
                    value={startingChips}
                    onChange={(e) => setStartingChips(parseInt(e.target.value) || 1000)}
                    min="100"
                    step="100"
                    style={{
                      flex: 1,
                      padding: '10px',
                      background: 'rgba(0, 0, 0, 0.3)',
                      border: '1px solid #4caf50',
                      borderRadius: '6px',
                      color: '#fff',
                      fontSize: '14px',
                      fontWeight: 'bold',
                      fontFamily: 'inherit',
                      textAlign: 'center'
                    }}
                  />
                  <div style={{
                    padding: '10px 15px',
                    background: 'rgba(76, 175, 80, 0.2)',
                    borderRadius: '6px',
                    fontSize: '12px',
                    color: '#4caf50',
                    display: 'flex',
                    alignItems: 'center'
                  }}>
                    ${startingChips.toLocaleString()}
                  </div>
                </div>
              </div>
              
              <div>
                <div style={{ fontSize: '10px', color: '#888', marginBottom: '6px' }}>
                  Distribute Bonus Chips
                </div>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                  <input
                    type="number"
                    value={bonusChipsAmount}
                    onChange={(e) => setBonusChipsAmount(parseInt(e.target.value) || 0)}
                    placeholder="Amount"
                    min="0"
                    step="100"
                    style={{
                      flex: 1,
                      padding: '10px',
                      background: 'rgba(0, 0, 0, 0.3)',
                      border: '1px solid #4caf50',
                      borderRadius: '6px',
                      color: '#fff',
                      fontSize: '14px',
                      fontWeight: 'bold',
                      fontFamily: 'inherit',
                      textAlign: 'center'
                    }}
                  />
                  <select
                    value={bonusRecipient}
                    onChange={(e) => setBonusRecipient(e.target.value)}
                    style={{
                      flex: 1,
                      padding: '10px',
                      background: 'rgba(0, 0, 0, 0.3)',
                      border: '1px solid #4caf50',
                      borderRadius: '6px',
                      color: '#fff',
                      fontSize: '12px',
                      fontFamily: 'inherit',
                      cursor: 'pointer'
                    }}
                  >
                    <option value="all">All Players</option>
                    {leaderboard.map(player => (
                      <option key={player.userId} value={player.userId}>
                        {player.name} (${Math.round(player.bankroll).toLocaleString()})
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={distributeBonusChips}
                  disabled={bonusChipsAmount <= 0}
                  style={{
                    width: '100%',
                    padding: '10px',
                    background: bonusChipsAmount > 0 ? 'linear-gradient(135deg, #4caf50, #66bb6a)' : '#333',
                    border: 'none',
                    borderRadius: '6px',
                    color: bonusChipsAmount > 0 ? '#fff' : '#666',
                    fontSize: '11px',
                    fontWeight: 'bold',
                    cursor: bonusChipsAmount > 0 ? 'pointer' : 'not-allowed',
                    fontFamily: 'inherit',
                    textTransform: 'uppercase',
                    letterSpacing: '1px'
                  }}
                >
                  {bonusRecipient === 'all' 
                    ? `Give $${bonusChipsAmount.toLocaleString()} to All`
                    : `Give $${bonusChipsAmount.toLocaleString()} to Player`
                  }
                </button>
              </div>
            </div>
            
            {/* Countdown Duration */}
            <div style={{
              background: 'rgba(0, 0, 0, 0.3)',
              padding: '15px',
              borderRadius: '8px',
              marginBottom: '15px'
            }}>
              <div style={{ fontSize: '10px', color: '#888', marginBottom: '6px' }}>Countdown Duration (seconds)</div>
              <div style={{ display: 'flex', gap: '6px' }}>
                {[10, 15, 20, 30, 45, 60].map(sec => (
                  <button key={sec} onClick={() => setCountdownDuration(sec)}
                    style={{
                      flex: 1, padding: '8px',
                      background: countdownDuration === sec ? '#2196f3' : 'rgba(0,0,0,0.3)',
                      border: `1px solid ${countdownDuration === sec ? '#2196f3' : '#555'}`,
                      borderRadius: '6px', color: '#fff', fontSize: '11px', fontWeight: 'bold',
                      cursor: 'pointer', fontFamily: 'inherit'
                    }}>
                    {sec}s
                  </button>
                ))}
              </div>
            </div>
            
            {/* Card Entry */}
            <div style={{
              background: 'rgba(0, 0, 0, 0.3)',
              padding: '18px',
              borderRadius: '8px',
              marginBottom: '15px'
            }}>
              <div style={{ fontSize: '11px', color: '#888', marginBottom: '8px' }}>
                Quick Pick Cards — tap value then suit
              </div>
              {(() => {
                const values = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
                const suits = ['♠','♥','♦','♣'];
                const applyCard = (val, suit) => {
                  const card = val + suit;
                  if (qpTarget === 'p1') setAdminPlayerCards([card, adminPlayerCards[1]]);
                  else if (qpTarget === 'p2') setAdminPlayerCards([adminPlayerCards[0], card]);
                  else if (qpTarget === 'p3') setAdminPlayerThird(card);
                  else if (qpTarget === 'b1') setAdminBankerCards([card, adminBankerCards[1]]);
                  else if (qpTarget === 'b2') setAdminBankerCards([adminBankerCards[0], card]);
                  else if (qpTarget === 'b3') setAdminBankerThird(card);
                };
                return (
                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ display: 'flex', gap: '4px', marginBottom: '6px', flexWrap: 'wrap' }}>
                      {['p1','p2','p3','b1','b2','b3'].map(t => (
                        <button key={t} onClick={() => setQpTarget(t)} style={{
                          flex: 1, padding: '6px', fontSize: '9px', fontWeight: 'bold',
                          background: qpTarget === t ? '#d4af37' : 'rgba(0,0,0,0.3)',
                          color: qpTarget === t ? '#000' : '#888',
                          border: `1px solid ${qpTarget === t ? '#d4af37' : '#555'}`,
                          borderRadius: '4px', cursor: 'pointer', fontFamily: 'inherit'
                        }}>
                          {t.startsWith('p') ? `P${t[1]}` : `B${t[1]}`}
                        </button>
                      ))}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '3px', marginBottom: '4px' }}>
                      {values.map(v => (
                        <button key={v} onClick={() => setQpValue(v)} style={{
                          padding: '6px 0', fontSize: '11px', fontWeight: 'bold',
                          background: qpValue === v ? '#d4af37' : 'rgba(33,150,243,0.2)',
                          color: qpValue === v ? '#000' : '#fff',
                          border: `1px solid ${qpValue === v ? '#d4af37' : '#2196f3'}`,
                          borderRadius: '4px', cursor: 'pointer', fontFamily: 'inherit'
                        }}>{v}</button>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      {suits.map(s => (
                        <button key={s} onClick={() => { if (qpValue) applyCard(qpValue, s); }} style={{
                          flex: 1, padding: '8px', fontSize: '16px',
                          background: 'rgba(33,150,243,0.2)',
                          color: (s === '♥' || s === '♦') ? '#f44336' : '#fff',
                          border: '1px solid #2196f3',
                          borderRadius: '4px', cursor: qpValue ? 'pointer' : 'not-allowed',
                          opacity: qpValue ? 1 : 0.4, fontFamily: 'inherit'
                        }}>{s}</button>
                      ))}
                    </div>
                  </div>
                );
              })()}
              <div style={{ fontSize: '11px', color: '#888', marginBottom: '12px' }}>
                Player Cards
              </div>
              <div style={{ display: 'flex', gap: '10px', marginBottom: '12px' }}>
                <input
                  type="text"
                  value={adminPlayerCards[0]}
                  onChange={(e) => setAdminPlayerCards([e.target.value, adminPlayerCards[1]])}
                  placeholder="Card 1"
                  style={{
                    flex: 1,
                    padding: '12px',
                    background: 'rgba(255, 255, 255, 0.1)',
                    border: '2px solid #2196f3',
                    borderRadius: '8px',
                    color: '#fff',
                    fontSize: '16px',
                    textAlign: 'center',
                    fontFamily: 'inherit'
                  }}
                />
                <input
                  type="text"
                  value={adminPlayerCards[1]}
                  onChange={(e) => setAdminPlayerCards([adminPlayerCards[0], e.target.value])}
                  placeholder="Card 2"
                  style={{
                    flex: 1,
                    padding: '12px',
                    background: 'rgba(255, 255, 255, 0.1)',
                    border: '2px solid #2196f3',
                    borderRadius: '8px',
                    color: '#fff',
                    fontSize: '16px',
                    textAlign: 'center',
                    fontFamily: 'inherit'
                  }}
                />
                <input
                  type="text"
                  value={adminPlayerThird}
                  onChange={(e) => setAdminPlayerThird(e.target.value)}
                  placeholder="3rd (opt)"
                  style={{
                    flex: 1,
                    padding: '12px',
                    background: 'rgba(255, 255, 255, 0.1)',
                    border: '2px solid #2196f3',
                    borderRadius: '8px',
                    color: '#fff',
                    fontSize: '16px',
                    textAlign: 'center',
                    fontFamily: 'inherit'
                  }}
                />
              </div>
              
              <div style={{ fontSize: '11px', color: '#888', marginBottom: '12px' }}>
                Banker Cards
              </div>
              <div style={{ display: 'flex', gap: '10px', marginBottom: '12px' }}>
                <input
                  type="text"
                  value={adminBankerCards[0]}
                  onChange={(e) => setAdminBankerCards([e.target.value, adminBankerCards[1]])}
                  placeholder="Card 1"
                  style={{
                    flex: 1,
                    padding: '12px',
                    background: 'rgba(255, 255, 255, 0.1)',
                    border: '2px solid #f44336',
                    borderRadius: '8px',
                    color: '#fff',
                    fontSize: '16px',
                    textAlign: 'center',
                    fontFamily: 'inherit'
                  }}
                />
                <input
                  type="text"
                  value={adminBankerCards[1]}
                  onChange={(e) => setAdminBankerCards([adminBankerCards[0], e.target.value])}
                  placeholder="Card 2"
                  style={{
                    flex: 1,
                    padding: '12px',
                    background: 'rgba(255, 255, 255, 0.1)',
                    border: '2px solid #f44336',
                    borderRadius: '8px',
                    color: '#fff',
                    fontSize: '16px',
                    textAlign: 'center',
                    fontFamily: 'inherit'
                  }}
                />
                <input
                  type="text"
                  value={adminBankerThird}
                  onChange={(e) => setAdminBankerThird(e.target.value)}
                  placeholder="3rd (opt)"
                  style={{
                    flex: 1,
                    padding: '12px',
                    background: 'rgba(255, 255, 255, 0.1)',
                    border: '2px solid #f44336',
                    borderRadius: '8px',
                    color: '#fff',
                    fontSize: '16px',
                    textAlign: 'center',
                    fontFamily: 'inherit'
                  }}
                />
              </div>
              
              <button
                onClick={adminDealCards}
                disabled={!adminPlayerCards[0] || !adminPlayerCards[1] || !adminBankerCards[0] || !adminBankerCards[1]}
                style={{
                  width: '100%',
                  padding: '14px',
                  background: adminPlayerCards[0] && adminPlayerCards[1] && adminBankerCards[0] && adminBankerCards[1]
                    ? 'linear-gradient(135deg, #9c27b0, #ba68c8)'
                    : '#333',
                  border: 'none',
                  borderRadius: '8px',
                  color: '#fff',
                  fontSize: '13px',
                  fontWeight: 'bold',
                  cursor: adminPlayerCards[0] && adminPlayerCards[1] && adminBankerCards[0] && adminBankerCards[1] ? 'pointer' : 'not-allowed',
                  fontFamily: 'inherit',
                  letterSpacing: '2px',
                  textTransform: 'uppercase'
                }}
              >
                Deal Cards
              </button>
            </div>
            
            {/* Controls */}
            {/* Betting Controls */}
            <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
              <button
                onClick={adminOpenBetting}
                disabled={bettingOpen}
                style={{
                  flex: 1,
                  padding: '14px',
                  background: !bettingOpen ? 'rgba(76, 175, 80, 0.3)' : '#333',
                  border: '1px solid #4caf50',
                  borderRadius: '8px',
                  color: !bettingOpen ? '#4caf50' : '#666',
                  fontSize: '11px',
                  fontWeight: 'bold',
                  cursor: !bettingOpen ? 'pointer' : 'not-allowed',
                  fontFamily: 'inherit',
                  textTransform: 'uppercase'
                }}
              >
                🟢 Open Betting
              </button>
              <button
                onClick={adminCloseBetting}
                disabled={!bettingOpen}
                style={{
                  flex: 1,
                  padding: '14px',
                  background: bettingOpen ? 'rgba(255, 152, 0, 0.3)' : '#333',
                  border: '1px solid #ff9800',
                  borderRadius: '8px',
                  color: bettingOpen ? '#ff9800' : '#666',
                  fontSize: '11px',
                  fontWeight: 'bold',
                  cursor: bettingOpen ? 'pointer' : 'not-allowed',
                  fontFamily: 'inherit',
                  textTransform: 'uppercase'
                }}
              >
                🔴 Close Betting
              </button>
            </div>

            {/* Undo Last Result */}
            {lastRoundUndoable && isAdmin && (
              <button
                onClick={undoLastResult}
                style={{
                  width: '100%',
                  padding: '12px',
                  marginBottom: '10px',
                  background: 'rgba(255, 152, 0, 0.2)',
                  border: '2px solid #ff9800',
                  borderRadius: '8px',
                  color: '#ff9800',
                  fontSize: '12px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  textTransform: 'uppercase',
                  letterSpacing: '1px'
                }}
              >
                ⚠️ Undo Last Result
              </button>
            )}

            <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
              <button
                onClick={adminResetSession}
                style={{
                  flex: 1,
                  padding: '14px',
                  background: 'rgba(244, 67, 54, 0.3)',
                  border: '1px solid #f44336',
                  borderRadius: '8px',
                  color: '#f44336',
                  fontSize: '11px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  textTransform: 'uppercase'
                }}
              >
                Reset Session
              </button>
            </div>
            
            {/* Status */}
            <div style={{
              fontSize: '10px',
              color: '#888',
              padding: '12px',
              background: 'rgba(0, 0, 0, 0.2)',
              borderRadius: '6px',
              display: 'grid',
              gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
              gap: '10px'
            }}>
              <div>Active Players: <span style={{ color: '#d4af37' }}>{activeUsers}</span></div>
              <div>Betting: <span style={{ color: bettingOpen ? '#4caf50' : '#f44336' }}>
                {bettingOpen ? 'Open' : 'Closed'}
              </span></div>
              <div>Phase: <span style={{ color: '#ce93d8' }}>{gamePhase === 'betting' ? 'Betting' : 'Dealt'}</span></div>
              <div>Round: <span style={{ color: '#ff9800' }}>#{roundNumber}</span></div>
            </div>
          </div>
        )}
      </div>


        {/* ========== RESULT BANNER OVERLAY ========== */}
        {resultBanner && (
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 9999, pointerEvents: 'none',
            animation: 'bannerFadeIn 0.3s ease-out'
          }}>
            <div style={{
              background: resultBanner.type === 'win' 
                ? 'linear-gradient(135deg, rgba(0, 100, 0, 0.95), rgba(0, 60, 0, 0.95))'
                : resultBanner.type === 'push'
                ? 'linear-gradient(135deg, rgba(80, 80, 0, 0.95), rgba(50, 50, 0, 0.95))'
                : 'linear-gradient(135deg, rgba(120, 0, 0, 0.95), rgba(60, 0, 0, 0.95))',
              border: `3px solid ${resultBanner.type === 'win' ? '#4caf50' : resultBanner.type === 'push' ? '#ff9800' : '#f44336'}`,
              borderRadius: '20px',
              padding: isMobile ? '20px 25px' : '30px 50px',
              textAlign: 'center',
              boxShadow: `0 0 60px ${resultBanner.type === 'win' ? 'rgba(76, 175, 80, 0.5)' : resultBanner.type === 'push' ? 'rgba(255, 152, 0, 0.5)' : 'rgba(244, 67, 54, 0.5)'}`,
              animation: 'bannerPop 0.4s cubic-bezier(0.68, -0.55, 0.27, 1.55)'
            }}>
              <div style={{ fontSize: isMobile ? '36px' : '48px', marginBottom: '10px' }}>
                {resultBanner.type === 'win' ? '🎉' : resultBanner.type === 'push' ? '🤝' : '😔'}
              </div>
              <div style={{
                fontSize: isMobile ? '20px' : '28px', fontWeight: 'bold', letterSpacing: isMobile ? '1px' : '3px',
                color: resultBanner.type === 'win' ? '#4caf50' : resultBanner.type === 'push' ? '#ff9800' : '#f44336',
                marginBottom: '8px'
              }}>
                {resultBanner.type === 'win' ? 'YOU WON!' : resultBanner.type === 'push' ? 'PUSH' : 'NO WIN'}
              </div>
              <div style={{
                fontSize: isMobile ? '24px' : '36px', fontWeight: 'bold', color: '#fff', marginBottom: '5px'
              }}>
                {resultBanner.type === 'win' ? '+' : ''}{resultBanner.amount >= 0 ? '+' : ''}${Math.round(Math.abs(resultBanner.amount)).toLocaleString()}
              </div>
              <div style={{ fontSize: '13px', color: '#ccc', letterSpacing: '1px' }}>
                {resultBanner.message}
              </div>
            </div>
          </div>
        )}

        {/* ========== BETTING NOTIFICATION ========== */}
        {bettingNotification && (
          <div style={{
            position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)',
            zIndex: 9998,
            background: bettingNotification === 'open'
              ? 'linear-gradient(135deg, rgba(0, 100, 0, 0.95), rgba(0, 60, 0, 0.95))'
              : 'linear-gradient(135deg, rgba(120, 0, 0, 0.95), rgba(60, 0, 0, 0.95))',
            border: `2px solid ${bettingNotification === 'open' ? '#4caf50' : '#f44336'}`,
            borderRadius: '12px',
            padding: '15px 35px',
            boxShadow: `0 0 30px ${bettingNotification === 'open' ? 'rgba(76, 175, 80, 0.4)' : 'rgba(244, 67, 54, 0.4)'}`,
            animation: 'bannerSlideDown 0.4s ease-out',
            pointerEvents: 'none'
          }}>
            <div style={{
              fontSize: '18px', fontWeight: 'bold', letterSpacing: '3px',
              color: bettingNotification === 'open' ? '#4caf50' : '#f44336',
              textAlign: 'center'
            }}>
              {bettingNotification === 'open' ? '🟢 PLACE YOUR BETS' : '🔴 BETS LOCKED'}
            </div>
          </div>
        )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.8; transform: scale(0.98); }
        }
        
        * {
          box-sizing: border-box;
        }
        
        input:focus {
          outline: none;
          border-color: #d4af37 !important;
        }
        
        button:hover:not(:disabled) {
          transform: translateY(-1px);
          filter: brightness(1.1);
        }
        

        @keyframes bannerFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes bannerPop {
          0% { transform: scale(0.5); opacity: 0; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes bannerSlideDown {
          0% { transform: translateX(-50%) translateY(-100%); opacity: 0; }
          100% { transform: translateX(-50%) translateY(0); opacity: 1; }
        }
        button:active:not(:disabled) {
          transform: translateY(0);
        }
      `}</style>
    </div>
  );
};

export default BaccaratGame;
