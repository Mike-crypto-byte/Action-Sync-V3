import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Users, Timer, Crown, Trophy, Settings, ArrowLeft } from 'lucide-react';
// ========== FIREBASE: Import real-time sync hooks ==========
import {
  useGameState,
  useLeaderboard,
  useChat,
  useUserData,
  usePresence,
  distributeBonusChips as fbDistributeBonusChips,
  resetSession
} from './useFirebaseSync';

const GAME_NAME = 'roulette';

const RouletteGame = ({ onBack, isDealerMode = false, playerUserId, playerName: propPlayerName, skipRegistration = false }) => {
  // Mobile detection
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);
  // User state
  const [userId] = useState(() => {
    let id = sessionStorage.getItem('roulette-userId');
    if (!id) { id = `user_${Math.random().toString(36).substr(2, 9)}`; sessionStorage.setItem('roulette-userId', id); }
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
  
  // Dealer chip management (was missing in original)
  const [customStartingChips, setCustomStartingChips] = useState(1000);
  const [bonusChipsAmount, setBonusChipsAmount] = useState(0);
  const [bonusRecipient, setBonusRecipient] = useState('all');
  const [countdownDuration, setCountdownDuration] = useState(15);
  
  // ========== FIREBASE: Game state from real-time listener ==========
  const defaultGameState = {
    spinResult: null, isSpinning: false, roundNumber: 0,
    bettingOpen: true, countdown: 15, spinHistory: []
  };
  const { gameState, updateGameState } = useGameState(GAME_NAME, defaultGameState);

  // Game state
  // FIREBASE: spinResult now comes from gameState
  // FIREBASE: isSpinning now comes from gameState
  // FIREBASE: roundNumber now comes from gameState
  // FIREBASE: bettingOpen now comes from gameState
  // FIREBASE: countdown ticks locally but syncs from gameState
  const [localCountdown, setLocalCountdown] = useState(15);
  // FIREBASE: spinHistory now comes from gameState
  
  // User bankroll and bets
  const [bankroll, setBankroll] = useState(1000);
  const [selectedChip, setSelectedChip] = useState(5);
  const [currentBets, setCurrentBets] = useState({});
  const [activeBets, setActiveBets] = useState({});
  const [betHistory, setBetHistory] = useState([]);
  const [showBetHistory, setShowBetHistory] = useState(false);
  // ========== RESULT BANNER ==========
  const [resultBanner, setResultBanner] = useState(null); // { type: 'win'|'loss'|'push', amount, message }
  
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
      setTimeout(() => setBettingNotification(null), 3000);
    }
    prevBettingOpen.current = gameState.bettingOpen;
  }, [gameState.bettingOpen]);

  
  // UI State
  const [sessionStats, setSessionStats] = useState({
    totalWagered: 0,
    biggestWin: 0,
    totalSpins: 0,
    startingBankroll: 1000
  });
  
  // ========== FIREBASE: Leaderboard from real-time listener ==========
  const { leaderboard, updateLeaderboardEntry, clearLeaderboard } = useLeaderboard();
  
  // Admin state
  const [adminNumber, setAdminNumber] = useState('');
  // FIREBASE: activeUsers from presence tracking
  const activeUsers = usePresence(isRegistered ? userId : null, userName);
  const [showSettings, setShowSettings] = useState(false);
  
  // ========== FIREBASE: Chat from real-time listener ==========
  const { chatMessages, sendMessage: fbSendMessage, clearChat } = useChat();
  const [chatInput, setChatInput] = useState('');
  
  // ========== FIREBASE: User data from real-time listener ==========
  const { userData, saveUserData: fbSaveUserData } = useUserData(userId);

  // Roulette numbers configuration
  const numbers = {
    red: [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36],
    black: [2, 4, 6, 8, 10, 11, 13, 15, 17, 20, 22, 24, 26, 28, 29, 31, 33, 35],
    green: ['0', '00']
  };

  const getNumberColor = (num) => {
    if (num === '0' || num === '00') return 'green';
    if (numbers.red.includes(parseInt(num))) return 'red';
    return 'black';
  };

  // ========== FIREBASE: Auto-load user data when it arrives from listener ==========
  useEffect(() => {
    if (userData) {
      // ALWAYS sync bankroll from shared session — this is what carries it across games
      if (userData.bankroll !== undefined) setBankroll(userData.bankroll);
      setIsAdmin(userData.isAdmin || isDealerMode);
      
      // Auto-register if user data exists but we haven't registered locally yet
      if (!isRegistered && userData.name) {
        setUserName(userData.name);
        setIsRegistered(true);
      }
      // Don't overwrite activeBets from session — they're game-specific and local
    }
  }, [userData]);
  
  // ========== FIREBASE: Sync local countdown from gameState ==========
  useEffect(() => {
    if (gameState.bettingOpen) setLocalCountdown(gameState.countdown || 15);
  }, [gameState.countdown, gameState.bettingOpen]);
  
  // ========== FIREBASE: Auto-resolve bets when dealer pushes spin result ==========
  const lastResolvedRound = useRef(0);
  useEffect(() => {
    if (gameState.spinResult !== null && gameState.roundNumber > lastResolvedRound.current) {
      lastResolvedRound.current = gameState.roundNumber;
      if (Object.keys(activeBets).length > 0) resolveSpin(gameState.spinResult);
    }
  }, [gameState.spinResult, gameState.roundNumber]);

  // Countdown timer — dealer controls start, auto-closes at 0
  useEffect(() => {
    if (gameState.bettingOpen && localCountdown > 0) {
      const timer = setTimeout(() => setLocalCountdown(localCountdown - 1), 1000);
      return () => clearTimeout(timer);
    } else if (gameState.bettingOpen && localCountdown === 0 && isAdmin) {
      // Auto-close betting when countdown hits 0 (dealer only pushes this)
      updateGameState({ bettingOpen: false, countdown: 0 });
    }
  }, [localCountdown, gameState.bettingOpen]);




  // ========== FIREBASE: Save user data wrapper ==========
  const saveUserData = async (updates) => {
    const data = { name: userName, bankroll, activeBets, userId, sessionStats, ...updates };
    await fbSaveUserData(data);
  };
  
  // ========== FIREBASE: Update leaderboard wrapper ==========
  const updateLeaderboard = async (newBankroll) => {
    await updateLeaderboardEntry(userId, userName, newBankroll);
  };

  const registerUser = async () => {
    if (userName.trim()) {
      const hasAdminAccess = isDealerMode;
      setIsRegistered(true);
      setIsAdmin(hasAdminAccess);
      // IMPORTANT: Use existing bankroll from shared session, never reset to 1000
      const existingBankroll = (userData && userData.bankroll !== undefined) ? userData.bankroll : bankroll;
      const finalBankroll = existingBankroll > 0 ? existingBankroll : 1000;
      setBankroll(finalBankroll);
      await saveUserData({ name: userName, bankroll: finalBankroll, isAdmin: hasAdminAccess });
      await updateLeaderboard(finalBankroll);
    }
  };

  const placeBet = (betType, betValue) => {
    if (!bettingOpen || bankroll < selectedChip) return;
    
    const betKey = `${betType}-${betValue}`;
    const newBets = { ...currentBets };
    newBets[betKey] = (newBets[betKey] || 0) + selectedChip;
    
    const totalBet = Object.values(newBets).reduce((sum, bet) => sum + bet, 0);
    if (totalBet <= bankroll) {
      setCurrentBets(newBets);
    }
  };

  const clearAllBets = () => {
    setCurrentBets({});
  };

  const confirmBets = async () => {
    const totalBet = Object.values(currentBets).reduce((sum, bet) => sum + bet, 0);
    if (totalBet > bankroll || totalBet === 0) return;
    
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
    clearAllBets();
    
    await saveUserData({ bankroll: newBankroll, activeBets: newActiveBets, sessionStats: newStats });
    await updateLeaderboardEntry(userId, userName, newBankroll);
  };

  const resolveSpin = async (number) => {
    let winnings = 0;
    let spinWinnings = 0;
    const newActiveBets = {};
    
    const numStr = number.toString();
    const numInt = numStr === '0' || numStr === '00' ? -1 : parseInt(numStr);
    const color = getNumberColor(numStr);
    
    Object.keys(activeBets).forEach(betKey => {
      const [betType, betValue] = betKey.split('-');
      const betAmount = activeBets[betKey];
      let won = false;
      let payout = 0;
      
      switch(betType) {
        case 'straight':
          if (betValue === numStr) {
            won = true;
            payout = betAmount * 36; // 35:1
          }
          break;
        case 'split':
          const splitNums = betValue.split(',');
          if (splitNums.includes(numStr)) {
            won = true;
            payout = betAmount * 18; // 17:1
          }
          break;
        case 'street':
          const streetNums = betValue.split(',');
          if (streetNums.includes(numStr)) {
            won = true;
            payout = betAmount * 12; // 11:1
          }
          break;
        case 'corner':
          const cornerNums = betValue.split(',');
          if (cornerNums.includes(numStr)) {
            won = true;
            payout = betAmount * 9; // 8:1
          }
          break;
        case 'line':
          const lineNums = betValue.split(',');
          if (lineNums.includes(numStr)) {
            won = true;
            payout = betAmount * 6; // 5:1
          }
          break;
        case 'dozen':
          if (betValue === '1st' && numInt >= 1 && numInt <= 12) won = true;
          if (betValue === '2nd' && numInt >= 13 && numInt <= 24) won = true;
          if (betValue === '3rd' && numInt >= 25 && numInt <= 36) won = true;
          if (won) payout = betAmount * 3; // 2:1
          break;
        case 'column':
          const colNum = parseInt(betValue);
          if (numInt > 0 && (numInt - colNum) % 3 === 0) {
            won = true;
            payout = betAmount * 3; // 2:1
          }
          break;
        case 'red':
          if (color === 'red') {
            won = true;
            payout = betAmount * 2; // 1:1
          }
          break;
        case 'black':
          if (color === 'black') {
            won = true;
            payout = betAmount * 2; // 1:1
          }
          break;
        case 'even':
          if (numInt > 0 && numInt % 2 === 0) {
            won = true;
            payout = betAmount * 2; // 1:1
          }
          break;
        case 'odd':
          if (numInt > 0 && numInt % 2 === 1) {
            won = true;
            payout = betAmount * 2; // 1:1
          }
          break;
        case 'low':
          if (numInt >= 1 && numInt <= 18) {
            won = true;
            payout = betAmount * 2; // 1:1
          }
          break;
        case 'high':
          if (numInt >= 19 && numInt <= 36) {
            won = true;
            payout = betAmount * 2; // 1:1
          }
          break;
      }
      
      if (won) {
        winnings += payout;
        spinWinnings += (payout - betAmount);
      } else {
        spinWinnings -= betAmount;
      }
    });
    
    const newBankroll = Math.round(bankroll + winnings);
    setBankroll(newBankroll);
    setActiveBets(newActiveBets);
    
    // Record bet history for this player
    if (Object.keys(activeBets).length > 0) {
      const historyEntry = {
        round: gameState.roundNumber || 0,
        result: numStr,
        color: color,
        bets: { ...activeBets },
        totalWagered: Object.values(activeBets).reduce((s, v) => s + v, 0),
        winnings: spinWinnings,
        timestamp: Date.now()
      };
      setBetHistory(prev => [historyEntry, ...prev].slice(0, 20));
    }
    
    // Show result banner
    if (Object.keys(activeBets).length > 0) {
      if (spinWinnings > 0) {
        showResultBanner('win', spinWinnings, `Number ${numStr} • ${color}`);
      } else if (spinWinnings === 0) {
        showResultBanner('push', 0, `Number ${numStr} • ${color}`);
      } else {
        showResultBanner('loss', spinWinnings, `Number ${numStr} • ${color}`);
      }
    }
    
    // FIREBASE: spinHistory is managed by gameState (dealer pushes it)
    
    const newStats = {
      ...sessionStats,
      totalSpins: sessionStats.totalSpins + 1,
      biggestWin: Math.max(sessionStats.biggestWin, spinWinnings)
    };
    setSessionStats(newStats);
    
    await saveUserData({ bankroll: newBankroll, activeBets: newActiveBets, sessionStats: newStats });
    await updateLeaderboardEntry(userId, userName, newBankroll);
  };

  // ========== FIREBASE: Admin spin writes to Firebase — all clients see instantly ==========
  const adminSpin = async () => {
    if (!adminNumber) return;
    await updateGameState({ isSpinning: true, bettingOpen: false });
    setTimeout(async () => {
      const newHistory = [
        { number: adminNumber, color: getNumberColor(adminNumber) },
        ...(gameState.spinHistory || []).slice(0, 19)
      ];
      await updateGameState({
        spinResult: adminNumber,
        roundNumber: (gameState.roundNumber || 0) + 1,
        isSpinning: false,
        spinHistory: newHistory
      });
      setAdminNumber('');
      await sendSystemMessage(`🎰 Result: ${adminNumber} — Round #${(gameState.roundNumber || 0) + 1}`);
    }, 3000);
  };

  // ========== Dealer countdown controls ==========
  const adminOpenBetting = async () => {
    await updateGameState({ spinResult: null, bettingOpen: true, countdown: countdownDuration, isSpinning: false });
    await sendSystemMessage(`🟢 Betting is OPEN — ${countdownDuration}s to place your bets!`);
  };
  
  const adminCloseBetting = async () => {
    await updateGameState({ bettingOpen: false, countdown: 0 });
    await sendSystemMessage('🔴 Betting is CLOSED — no more bets!');
  };
  
  // Keep old name for compatibility with UI
  const adminNewRound = adminOpenBetting;

  // ========== FIREBASE: Bonus chips via Firebase ==========
  const distributeBonusChips = async () => {
    if (bonusChipsAmount <= 0) { alert('Please enter a valid bonus amount'); return; }
    const targetName = bonusRecipient === 'all' ? `ALL ${leaderboard.length} players` : leaderboard.find(p => p.userId === bonusRecipient)?.name || 'Unknown';
    if (confirm(`Give $${bonusChipsAmount.toLocaleString()} to ${targetName}?`)) {
      await fbDistributeBonusChips(leaderboard, bonusRecipient, bonusChipsAmount, userId, setBankroll);
      alert(`✅ Distributed $${bonusChipsAmount.toLocaleString()} to ${targetName}!`);
      setBonusChipsAmount(0);
    }
  };

  // ========== FIREBASE: Reset session via Firebase ==========
  const adminResetSession = async () => {
    if (confirm('Reset entire session? This will clear all user data.')) {
      try {
        await resetSession(GAME_NAME);
        setBankroll(1000); setCurrentBets({}); setActiveBets({});
        setSessionStats({ totalWagered: 0, biggestWin: 0, totalSpins: 0, startingBankroll: 1000 });
        await saveUserData({ bankroll: 1000, activeBets: {}, sessionStats: { totalWagered: 0, biggestWin: 0, totalSpins: 0, startingBankroll: 1000 }});
      } catch (e) { console.error('Reset failed:', e); }
    }
  };

  // ========== FIREBASE: Chat via real-time hook ==========
  const sendChatMessage = async () => {
    if (!chatInput.trim()) return;
    await fbSendMessage(userId, userName, chatInput);
    setChatInput('');
  };
  
  // System message helper
  const sendSystemMessage = async (text) => {
    await fbSendMessage('system', '🎰 System', text);
  };

  // FIREBASE: activeUsers tracked via usePresence hook

  // ========== FIREBASE: Convenience aliases so JSX reads gameState transparently ==========
  const spinResult = gameState.spinResult;
  const isSpinning = gameState.isSpinning;
  const roundNumber = gameState.roundNumber || 0;
  const bettingOpen = gameState.bettingOpen;
  const countdown = localCountdown;
  const spinHistory = gameState.spinHistory || [];

  // Registration screen
  if (!isRegistered) {
    return (
      <div style={{
        minHeight: '100vh',
        background: '#1a1a1a',
        backgroundImage: `
          repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(0,0,0,.05) 10px, rgba(0,0,0,.05) 20px),
          radial-gradient(circle at 30% 50%, rgba(139, 0, 0, 0.1) 0%, transparent 70%)
        `,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: '"Courier New", monospace',
        padding: '20px'
      }}>
        <div style={{
          background: 'linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)',
          border: '3px solid #8b0000',
          borderRadius: '15px',
          padding: '50px 40px',
          maxWidth: '450px',
          width: '100%',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.8)'
        }}>
          <div style={{ textAlign: 'center', marginBottom: '35px' }}>
            <div style={{
              fontSize: '42px',
              fontWeight: 'bold',
              color: '#8b0000',
              marginBottom: '10px',
              letterSpacing: '3px'
            }}>
              🎰 ROULETTE
            </div>
            <div style={{
              color: '#888',
              fontSize: '13px',
              letterSpacing: '4px',
              textTransform: 'uppercase'
            }}>
              American Double-Zero
            </div>
          </div>
          
          <div style={{ marginBottom: '25px' }}>
            <label style={{
              display: 'block',
              color: '#8b0000',
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
                ? 'linear-gradient(135deg, #8b0000 0%, #b30000 100%)'
                : '#333',
              border: 'none',
              borderRadius: '8px',
              color: userName.trim() ? '#fff' : '#666',
              fontSize: '15px',
              fontWeight: 'bold',
              letterSpacing: '3px',
              cursor: userName.trim() ? 'pointer' : 'not-allowed',
              textTransform: 'uppercase',
              fontFamily: 'inherit',
              boxShadow: userName.trim() ? '0 8px 25px rgba(139, 0, 0, 0.4)' : 'none'
            }}
          >
            Join Table
          </button>
          
          <div style={{
            marginTop: '25px',
            padding: '18px',
            background: 'rgba(139, 0, 0, 0.1)',
            borderRadius: '8px',
            border: '1px solid rgba(139, 0, 0, 0.2)'
          }}>
            <div style={{ color: '#8b0000', fontSize: '12px', marginBottom: '12px', fontWeight: 'bold' }}>
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

  // Number button component
  const NumberButton = ({ number }) => {
    const color = getNumberColor(number);
    const betKey = `straight-${number}`;
    const hasBet = currentBets[betKey] || activeBets[betKey];
    
    return (
      <div
        onClick={() => placeBet('straight', number)}
        style={{
          background: color === 'green' ? '#0a6e0a' : color === 'red' ? '#8b0000' : '#000',
          border: '2px solid #d4af37',
          borderRadius: '8px',
          padding: '15px 10px',
          textAlign: 'center',
          cursor: bettingOpen ? 'pointer' : 'not-allowed',
          position: 'relative',
          opacity: bettingOpen ? 1 : 0.5,
          minWidth: '60px',
          transition: 'all 0.2s'
        }}
      >
        <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#fff' }}>
          {number}
        </div>
        {hasBet > 0 && (
          <div style={{
            position: 'absolute',
            top: '-8px',
            right: '-8px',
            background: '#d4af37',
            color: '#000',
            borderRadius: '50%',
            width: '24px',
            height: '24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '10px',
            fontWeight: 'bold',
            border: '2px solid #000'
          }}>
            ${hasBet}
          </div>
        )}
      </div>
    );
  };

  // Outside bet button component
  const OutsideBetButton = ({ label, betType, betValue, color = '#8b0000' }) => {
    const betKey = `${betType}-${betValue}`;
    const hasBet = currentBets[betKey] || activeBets[betKey];
    
    return (
      <div
        onClick={() => placeBet(betType, betValue)}
        style={{
          background: `linear-gradient(135deg, ${color} 0%, ${color}dd 100%)`,
          border: '3px solid #d4af37',
          borderRadius: '10px',
          padding: isMobile ? '12px 6px' : '20px 15px',
          textAlign: 'center',
          cursor: bettingOpen ? 'pointer' : 'not-allowed',
          position: 'relative',
          opacity: bettingOpen ? 1 : 0.5,
          transition: 'all 0.2s'
        }}
      >
        <div style={{ fontSize: isMobile ? '10px' : '14px', fontWeight: 'bold', color: '#fff', letterSpacing: isMobile ? '0px' : '1px' }}>
          {label}
        </div>
        {hasBet > 0 && (
          <div style={{
            position: 'absolute',
            top: '-10px',
            right: '-10px',
            background: '#d4af37',
            color: '#000',
            borderRadius: '50%',
            width: '30px',
            height: '30px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '11px',
            fontWeight: 'bold',
            border: '2px solid #000'
          }}>
            ${hasBet}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: '#1a1a1a',
      backgroundImage: `
        repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(0,0,0,.05) 10px, rgba(0,0,0,.05) 20px)
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
        borderBottom: '3px solid #8b0000',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        position: 'sticky',
        top: 0,
        zIndex: 1000
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? '8px' : '20px' }}>
          <div style={{ fontSize: isMobile ? '14px' : '20px', fontWeight: 'bold', color: '#8b0000', letterSpacing: '2px' }}>
            🎰 ROULETTE
          </div>
          <div style={{ fontSize: '11px', color: '#888' }}>
            <span style={{ color: '#aaa', fontSize: '12px' }}>{userName}</span>
              <span style={{ color: '#8b0000', fontSize: isMobile ? '16px' : '22px', fontWeight: 'bold', marginLeft: isMobile ? '5px' : '10px' }}>${Math.round(bankroll).toLocaleString()}</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          {onBack && isAdmin && (
            <button
              onClick={onBack}
              style={{
                background: 'rgba(139, 0, 0, 0.2)',
                border: '1px solid #8b0000',
                borderRadius: '6px',
                padding: '6px 12px',
                color: '#8b0000',
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
          border: '3px solid #8b0000',
          borderRadius: '10px',
          padding: '15px 20px',
          marginBottom: '20px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div>
            <div style={{ fontSize: '10px', color: '#888', marginBottom: '4px' }}>STATUS</div>
            <div style={{ fontSize: '18px', fontWeight: 'bold', color: isSpinning ? '#ff9800' : bettingOpen ? '#4caf50' : '#8b0000' }}>
              {isSpinning ? 'SPINNING...' : bettingOpen ? 'PLACE YOUR BETS' : 'NO MORE BETS'}
            </div>
          </div>
          {bettingOpen && !isSpinning && (
            <div style={{
              background: countdown <= 5 ? '#ff5252' : '#8b0000',
              color: '#fff',
              borderRadius: '8px',
              padding: '10px 20px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              <Timer size={18} />
              <span style={{ fontSize: '20px', fontWeight: 'bold' }}>{countdown}s</span>
            </div>
          )}
          <div>
            <div style={{ fontSize: '10px', color: '#888', marginBottom: '4px' }}>ROUND #{roundNumber}</div>
            {spinResult && (
              <div style={{
                fontSize: '32px',
                fontWeight: 'bold',
                color: getNumberColor(spinResult) === 'green' ? '#0a6e0a' : getNumberColor(spinResult) === 'red' ? '#ff4444' : '#fff',
                display: 'flex',
                alignItems: 'center',
                gap: '10px'
              }}>
                <div style={{
                  width: '50px',
                  height: '50px',
                  borderRadius: '50%',
                  background: getNumberColor(spinResult) === 'green' ? '#0a6e0a' : getNumberColor(spinResult) === 'red' ? '#8b0000' : '#000',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '3px solid #d4af37'
                }}>
                  {spinResult}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Roulette Table */}
        <div style={{
          background: '#0a4d0a',
          border: isMobile ? '3px solid #8b4513' : '8px solid #8b4513',
          borderRadius: isMobile ? '12px' : '20px',
          padding: isMobile ? '10px' : '20px',
          boxShadow: 'inset 0 0 50px rgba(0,0,0,0.5), 0 10px 40px rgba(0,0,0,0.8)',
          marginBottom: '20px',
          overflowX: 'auto'
        }}>
          {/* Interactive Roulette Board */}
          {(() => {
            // Standard roulette layout: 3 rows x 12 columns
            // Row 0 (top): 3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36
            // Row 1 (mid): 2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35
            // Row 2 (bot): 1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34
            const rows = [
              [3,6,9,12,15,18,21,24,27,30,33,36],
              [2,5,8,11,14,17,20,23,26,29,32,35],
              [1,4,7,10,13,16,19,22,25,28,31,34]
            ];
            
            const chipDot = (betKey) => {
              const amt = currentBets[betKey] || activeBets[betKey];
              if (!amt) return null;
              return (
                <div style={{
                  position: 'absolute', top: '50%', left: '50%',
                  transform: 'translate(-50%, -50%)',
                  background: '#d4af37', color: '#000',
                  borderRadius: '50%', width: isMobile ? '16px' : '22px', height: isMobile ? '16px' : '22px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: isMobile ? '6px' : '8px', fontWeight: 'bold', border: isMobile ? '1px solid #000' : '2px solid #000',
                  zIndex: 5, pointerEvents: 'none'
                }}>
                  {amt}
                </div>
              );
            };

            // Cell size — responsive
            const W = isMobile ? 28 : 52; // number cell width
            const H = isMobile ? 28 : 50; // number cell height
            const E = isMobile ? 6 : 12; // edge zone size (clickable split area)
            
            return (
              <div style={{ display: 'flex', gap: '8px', marginBottom: '15px' }}>
                {/* 0 and 00 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', justifyContent: 'center' }}>
                  {['0', '00'].map(n => {
                    const betKey = `straight-${n}`;
                    const hasBet = currentBets[betKey] || activeBets[betKey];
                    return (
                      <div key={n} onClick={() => placeBet('straight', n)} style={{
                        width: W, height: isMobile ? H * 1.2 : H * 1.5, background: '#0a6e0a',
                        border: '2px solid #d4af37', borderRadius: '8px',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: bettingOpen ? 'pointer' : 'not-allowed',
                        position: 'relative', opacity: bettingOpen ? 1 : 0.5
                      }}>
                        <span style={{ fontSize: isMobile ? '12px' : '18px', fontWeight: 'bold', color: '#fff' }}>{n}</span>
                        {hasBet > 0 && chipDot(betKey)}
                      </div>
                    );
                  })}
                </div>
                
                {/* Main grid with split zones */}
                <div style={{ position: 'relative' }}>
                  {/* Number cells - CSS grid */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: `repeat(12, ${W}px)`,
                    gridTemplateRows: `repeat(3, ${H}px)`,
                    gap: `${E}px`
                  }}>
                    {rows.flat().map(num => {
                      const n = num.toString();
                      const color = getNumberColor(n);
                      const betKey = `straight-${n}`;
                      const hasBet = currentBets[betKey] || activeBets[betKey];
                      return (
                        <div key={num} onClick={() => placeBet('straight', n)} style={{
                          background: color === 'red' ? '#8b0000' : '#111',
                          border: '2px solid #d4af37', borderRadius: '6px',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          cursor: bettingOpen ? 'pointer' : 'not-allowed',
                          position: 'relative', opacity: bettingOpen ? 1 : 0.5,
                          zIndex: 2
                        }}>
                          <span style={{ fontSize: isMobile ? '11px' : '16px', fontWeight: 'bold', color: '#fff' }}>{n}</span>
                          {hasBet > 0 && chipDot(betKey)}
                        </div>
                      );
                    })}
                  </div>
                  
                  {/* SPLIT ZONES — clickable areas between numbers */}
                  {/* Horizontal splits (between columns: left-right neighbors) */}
                  {rows.map((row, ri) => 
                    row.slice(0, -1).map((num, ci) => {
                      const n1 = num.toString();
                      const n2 = row[ci + 1].toString();
                      const sorted = [n1, n2].sort((a, b) => parseInt(a) - parseInt(b)).join(',');
                      const betKey = `split-${sorted}`;
                      const hasBet = currentBets[betKey] || activeBets[betKey];
                      const left = (ci + 1) * (W + E) - E / 2 - E / 2;
                      const top = ri * (H + E);
                      return (
                        <div key={`hsplit-${n1}-${n2}`}
                          onClick={() => placeBet('split', sorted)}
                          style={{
                            position: 'absolute',
                            left: left, top: top,
                            width: E + 4, height: H,
                            cursor: bettingOpen ? 'pointer' : 'default',
                            zIndex: 3,
                            borderRadius: '3px',
                            background: hasBet ? 'rgba(212,175,55,0.3)' : 'transparent'
                          }}
                          title={`Split ${n1}/${n2} (17:1)`}
                        >
                          {hasBet > 0 && chipDot(betKey)}
                        </div>
                      );
                    })
                  ).flat()}
                  
                  {/* Vertical splits (between rows: top-bottom neighbors) */}
                  {[0, 1].map(ri =>
                    rows[ri].map((num, ci) => {
                      const n1 = num.toString();
                      const n2 = rows[ri + 1][ci].toString();
                      const sorted = [n1, n2].sort((a, b) => parseInt(a) - parseInt(b)).join(',');
                      const betKey = `split-${sorted}`;
                      const hasBet = currentBets[betKey] || activeBets[betKey];
                      const left = ci * (W + E);
                      const top = (ri + 1) * (H + E) - E / 2 - E / 2;
                      return (
                        <div key={`vsplit-${n1}-${n2}`}
                          onClick={() => placeBet('split', sorted)}
                          style={{
                            position: 'absolute',
                            left: left, top: top,
                            width: W, height: E + 4,
                            cursor: bettingOpen ? 'pointer' : 'default',
                            zIndex: 3,
                            borderRadius: '3px',
                            background: hasBet ? 'rgba(212,175,55,0.3)' : 'transparent'
                          }}
                          title={`Split ${n1}/${n2} (17:1)`}
                        >
                          {hasBet > 0 && chipDot(betKey)}
                        </div>
                      );
                    })
                  ).flat()}
                  
                  {/* Corner zones (intersection of 4 numbers) */}
                  {[0, 1].map(ri =>
                    rows[ri].slice(0, -1).map((num, ci) => {
                      const tl = num;
                      const tr = rows[ri][ci + 1];
                      const bl = rows[ri + 1][ci];
                      const br = rows[ri + 1][ci + 1];
                      const sorted = [tl, tr, bl, br].sort((a, b) => a - b).map(String).join(',');
                      const betKey = `corner-${sorted}`;
                      const hasBet = currentBets[betKey] || activeBets[betKey];
                      const left = (ci + 1) * (W + E) - E / 2 - E / 2;
                      const top = (ri + 1) * (H + E) - E / 2 - E / 2;
                      return (
                        <div key={`corner-${sorted}`}
                          onClick={() => placeBet('corner', sorted)}
                          style={{
                            position: 'absolute',
                            left: left, top: top,
                            width: E + 4, height: E + 4,
                            cursor: bettingOpen ? 'pointer' : 'default',
                            zIndex: 4,
                            borderRadius: '50%',
                            background: hasBet ? 'rgba(212,175,55,0.4)' : 'transparent'
                          }}
                          title={`Corner ${tl}/${tr}/${bl}/${br} (8:1)`}
                        >
                          {hasBet > 0 && chipDot(betKey)}
                        </div>
                      );
                    })
                  ).flat()}

                  {/* Street bets (bottom edge of each column — covers all 3 in that column) */}
                  {Array.from({length: 12}, (_, ci) => {
                    const col = [rows[0][ci], rows[1][ci], rows[2][ci]];
                    const sorted = col.sort((a, b) => a - b).map(String).join(',');
                    const betKey = `street-${sorted}`;
                    const hasBet = currentBets[betKey] || activeBets[betKey];
                    const left = ci * (W + E);
                    const top = 3 * (H + E) - E / 2;
                    return (
                      <div key={`street-${sorted}`}
                        onClick={() => placeBet('street', sorted)}
                        style={{
                          position: 'absolute',
                          left: left, top: top,
                          width: W, height: E + 2,
                          cursor: bettingOpen ? 'pointer' : 'default',
                          zIndex: 3,
                          borderRadius: '3px',
                          background: hasBet ? 'rgba(212,175,55,0.3)' : 'rgba(255,255,255,0.05)'
                        }}
                        title={`Street ${col.join('/')} (11:1)`}
                      >
                        {hasBet > 0 && chipDot(betKey)}
                      </div>
                    );
                  })}
                </div>
                
                {/* Column bets on the right */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: `${E}px`, justifyContent: 'stretch' }}>
                  {[3, 2, 1].map(col => {
                    const betKey = `column-${col}`;
                    const hasBet = currentBets[betKey] || activeBets[betKey];
                    return (
                      <div key={col} onClick={() => placeBet('column', col.toString())} style={{
                        flex: 1, width: W, background: 'rgba(139,0,0,0.4)',
                        border: '2px solid #d4af37', borderRadius: '6px',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: bettingOpen ? 'pointer' : 'not-allowed',
                        position: 'relative', opacity: bettingOpen ? 1 : 0.5
                      }}>
                        <span style={{ fontSize: '10px', fontWeight: 'bold', color: '#fff', writingMode: 'vertical-rl' }}>2:1</span>
                        {hasBet > 0 && chipDot(betKey)}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* Bet type legend */}
          <div style={{
            display: 'flex', gap: '15px', justifyContent: 'center', marginBottom: '15px',
            fontSize: isMobile ? '7px' : '9px', color: '#aaa', flexWrap: 'wrap'
          }}>
            <span>Click number = Straight (35:1)</span>
            <span>Click edge = Split (17:1)</span>
            <span>Click corner = Corner (8:1)</span>
            <span>Click bottom edge = Street (11:1)</span>
          </div>

          {/* Outside Bets */}
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(3, 1fr)' : 'repeat(6, 1fr)', gap: isMobile ? '6px' : '10px', marginBottom: '15px' }}>
            <OutsideBetButton label="1-18" betType="low" betValue="low" />
            <OutsideBetButton label="EVEN" betType="even" betValue="even" />
            <OutsideBetButton label="RED" betType="red" betValue="red" color="#8b0000" />
            <OutsideBetButton label="BLACK" betType="black" betValue="black" color="#000" />
            <OutsideBetButton label="ODD" betType="odd" betValue="odd" />
            <OutsideBetButton label="19-36" betType="high" betValue="high" />
          </div>

          {/* Dozen Bets */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
            <OutsideBetButton label="1st 12" betType="dozen" betValue="1st" />
            <OutsideBetButton label="2nd 12" betType="dozen" betValue="2nd" />
            <OutsideBetButton label="3rd 12" betType="dozen" betValue="3rd" />
          </div>
        </div>


        {/* Active Bets Summary — shown when player has bets */}
        {Object.keys(activeBets).length > 0 && (
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
                Total: ${Object.values(activeBets).reduce((s, v) => s + v, 0).toLocaleString()}
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {Object.entries(activeBets).map(([key, amount]) => {
                const [type, value] = key.split('-');
                const label = type === 'straight' ? `#${value}`
                  : type === 'split' ? `Split ${value.replace(',','/')}`
                  : type === 'corner' ? `Corner`
                  : type === 'street' ? `Street`
                  : type === 'line' ? `Line`
                  : type === 'red' ? '🔴 Red'
                  : type === 'black' ? '⚫ Black'
                  : type === 'odd' ? 'Odd'
                  : type === 'even' ? 'Even'
                  : type === 'low' ? '1-18'
                  : type === 'high' ? '19-36'
                  : type === 'dozen' ? `${value} 12`
                  : type === 'column' ? `Col ${value}`
                  : key;
                return (
                  <div key={key} style={{
                    background: 'rgba(212, 175, 55, 0.15)',
                    border: '1px solid rgba(212, 175, 55, 0.3)',
                    borderRadius: '6px',
                    padding: '6px 12px',
                    fontSize: '11px',
                    color: '#d4af37'
                  }}>
                    {label} <span style={{ fontWeight: 'bold' }}>${amount}</span>
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
          border: '2px solid #8b0000',
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
                  width: isMobile ? '50px' : '70px',
                  height: isMobile ? '50px' : '70px',
                  borderRadius: '50%',
                  border: selectedChip === value ? '4px solid #8b0000' : '3px solid #555',
                  background: bankroll >= value
                    ? value <= 25 ? '#ff4444'
                    : value <= 100 ? '#4caf50'
                    : '#000'
                    : '#333',
                  color: bankroll >= value ? '#fff' : '#666',
                  fontSize: isMobile ? '12px' : '16px',
                  fontWeight: 'bold',
                  cursor: bankroll >= value ? 'pointer' : 'not-allowed',
                  fontFamily: 'inherit',
                  transition: 'all 0.2s',
                  boxShadow: selectedChip === value ? '0 0 20px rgba(139, 0, 0, 0.6)' : 'none'
                }}
              >
                ${value}
              </button>
            ))}
          </div>
          
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={confirmBets}
              disabled={Object.values(currentBets).every(v => v === 0) || !bettingOpen}
              style={{
                flex: 1,
                padding: '16px',
                background: Object.values(currentBets).some(v => v > 0) && bettingOpen
                  ? 'linear-gradient(135deg, #8b0000, #b30000)'
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
              ✅ CONFIRM BET — ${Object.values(currentBets).reduce((s, v) => s + v, 0)}
            </button>
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

        {/* Spin History */}
        <div style={{
          background: 'linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)',
          border: '2px solid #8b0000',
          borderRadius: '12px',
          padding: '20px',
          marginBottom: '20px'
        }}>
          <div style={{
            fontSize: '11px',
            letterSpacing: '2px',
            textTransform: 'uppercase',
            color: '#8b0000',
            marginBottom: '15px',
            fontWeight: 'bold'
          }}>
            🎲 Spin History
          </div>
          {spinHistory.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '20px', color: '#666', fontSize: '11px' }}>
              No spins yet
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {spinHistory.map((spin, idx) => (
                <div key={idx} style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '50%',
                  background: spin.color === 'green' ? '#0a6e0a' : spin.color === 'red' ? '#8b0000' : '#000',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '14px',
                  fontWeight: 'bold',
                  color: '#fff',
                  border: '2px solid #d4af37'
                }}>
                  {spin.number}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Session Stats */}
        <div style={{
          background: 'linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)',
          border: '2px solid #8b0000',
          borderRadius: '12px',
          padding: '20px',
          marginBottom: '20px'
        }}>
          <div style={{
            fontSize: '11px',
            letterSpacing: '2px',
            textTransform: 'uppercase',
            color: '#8b0000',
            marginBottom: '15px',
            fontWeight: 'bold'
          }}>
            📊 Session Stats
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '1fr 1fr 1fr 1fr', gap: isMobile ? '8px' : '15px' }}>
            <div>
              <div style={{ fontSize: isMobile ? '7px' : '9px', color: '#888', marginBottom: '4px' }}>Total Wagered</div>
              <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#fff' }}>
                ${sessionStats.totalWagered.toLocaleString()}
              </div>
            </div>
            <div>
              <div style={{ fontSize: isMobile ? '7px' : '9px', color: '#888', marginBottom: '4px' }}>Biggest Win</div>
              <div style={{ fontSize: '16px', fontWeight: 'bold', color: sessionStats.biggestWin > 0 ? '#4caf50' : '#888' }}>
                ${sessionStats.biggestWin.toLocaleString()}
              </div>
            </div>
            <div>
              <div style={{ fontSize: isMobile ? '7px' : '9px', color: '#888', marginBottom: '4px' }}>Total Spins</div>
              <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#fff' }}>
                {sessionStats.totalSpins}
              </div>
            </div>
            <div>
              <div style={{ fontSize: isMobile ? '7px' : '9px', color: '#888', marginBottom: '4px' }}>Net P/L</div>
              <div style={{ fontSize: '16px', fontWeight: 'bold', color: bankroll - sessionStats.startingBankroll >= 0 ? '#4caf50' : '#f44336' }}>
                {bankroll - sessionStats.startingBankroll >= 0 ? '+' : ''}${(bankroll - sessionStats.startingBankroll).toLocaleString()}
              </div>
            </div>
          </div>
        </div>

        {/* Leaderboard */}
        <div style={{
          background: 'linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)',
          border: '2px solid #8b0000',
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
            <Trophy size={18} color="#8b0000" />
            <div style={{
              fontSize: '13px',
              letterSpacing: '2px',
              textTransform: 'uppercase',
              color: '#8b0000',
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
                  ? 'rgba(139, 0, 0, 0.2)' 
                  : 'rgba(0, 0, 0, 0.3)',
                border: player.userId === userId 
                  ? '2px solid #8b0000'
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
                    color: player.userId === userId ? '#8b0000' : '#fff',
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
                  color: player.bankroll >= 1000 ? '#4caf50' : player.bankroll >= 500 ? '#ff9800' : '#f44336',
                  flexShrink: 0
                }}>
                  ${player.Math.round(bankroll).toLocaleString()}
                </div>
              </div>
            ))
          )}
        </div>


        {/* Bet History */}
        <div style={{
          background: 'linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)',
          border: '2px solid #8b0000',
          borderRadius: '12px',
          padding: '20px',
          marginBottom: '20px'
        }}>
          <div
            onClick={() => setShowBetHistory(!showBetHistory)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'pointer'
            }}
          >
            <div style={{
              fontSize: '11px',
              letterSpacing: '2px',
              textTransform: 'uppercase',
              color: '#8b0000',
              fontWeight: 'bold'
            }}>
              📋 My Bet History ({betHistory.length})
            </div>
            <div style={{ color: '#888', fontSize: '16px' }}>
              {showBetHistory ? '▲' : '▼'}
            </div>
          </div>
          {showBetHistory && (
            <div style={{ marginTop: '15px' }}>
              {betHistory.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '20px', color: '#666', fontSize: '11px' }}>
                  No bets placed yet
                </div>
              ) : (
                betHistory.map((entry, idx) => (
                  <div key={idx} style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '10px 12px',
                    background: entry.winnings >= 0 ? 'rgba(76, 175, 80, 0.1)' : 'rgba(244, 67, 54, 0.1)',
                    border: `1px solid ${entry.winnings >= 0 ? 'rgba(76, 175, 80, 0.3)' : 'rgba(244, 67, 54, 0.3)'}`,
                    borderRadius: '8px',
                    marginBottom: '6px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div style={{
                        width: '30px', height: '30px', borderRadius: '50%',
                        background: entry.color === 'green' ? '#0a6e0a' : entry.color === 'red' ? '#8b0000' : '#000',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '11px', fontWeight: 'bold', color: '#fff',
                        border: '2px solid #d4af37'
                      }}>
                        {entry.result}
                      </div>
                      <div>
                        <div style={{ fontSize: '11px', color: '#888' }}>Round #{entry.round}</div>
                        <div style={{ fontSize: '10px', color: '#666' }}>
                          {Object.keys(entry.bets).map(k => k.replace('-', ' ')).join(', ')}
                        </div>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '10px', color: '#888' }}>Wagered: ${entry.totalWagered}</div>
                      <div style={{
                        fontSize: '14px', fontWeight: 'bold',
                        color: entry.winnings >= 0 ? '#4caf50' : '#f44336'
                      }}>
                        {entry.winnings >= 0 ? '+' : ''}${entry.winnings.toLocaleString()}
                      </div>
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
          border: '2px solid #8b0000',
          borderRadius: '12px',
          padding: '20px',
          marginBottom: '20px'
        }}>
          <div style={{
            fontSize: '11px',
            letterSpacing: '2px',
            textTransform: 'uppercase',
            color: '#8b0000',
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
            ) : (
              chatMessages.map((msg, idx) => (
                <div key={idx} style={{
                  marginBottom: '10px',
                  padding: msg.userId === 'system' ? '10px 12px' : '8px',
                  background: msg.userId === 'system' ? 'rgba(212, 175, 55, 0.1)'
                    : msg.userId === userId ? 'rgba(139, 0, 0, 0.1)' : 'rgba(255,255,255,0.05)',
                  borderRadius: '6px',
                  borderLeft: msg.userId === 'system' ? '3px solid #d4af37'
                    : `3px solid ${msg.userId === userId ? '#8b0000' : '#555'}`
                }}>
                  {msg.userId !== 'system' && (
                    <div style={{ fontSize: '10px', color: msg.userId === userId ? '#8b0000' : '#888', marginBottom: '4px' }}>
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
              ))
            )}
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
                background: chatInput.trim() ? '#8b0000' : '#333',
                border: 'none',
                borderRadius: '6px',
                color: chatInput.trim() ? '#fff' : '#666',
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
            border: '2px solid #8b0000',
            borderRadius: '12px',
            padding: '25px',
            marginBottom: '20px'
          }}>
            <div style={{
              fontSize: '13px',
              letterSpacing: '2px',
              textTransform: 'uppercase',
              color: '#ff6666',
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
              background: 'rgba(139, 0, 0, 0.1)',
              padding: '15px',
              borderRadius: '8px',
              marginBottom: '20px',
              border: '1px solid rgba(139, 0, 0, 0.2)'
            }}>
              <div style={{ fontSize: '10px', color: '#888', marginBottom: '8px' }}>
                YOUR ACCOUNT
              </div>
              <div style={{ fontSize: '16px', color: '#fff', fontWeight: 'bold', marginBottom: '5px' }}>
                {userName}
              </div>
              <div style={{ fontSize: '12px', color: '#ff6666' }}>
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
                <div style={{ fontSize: isMobile ? '7px' : '9px', color: '#888', marginBottom: '4px' }}>
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
                <div style={{ fontSize: isMobile ? '7px' : '9px', color: '#888', marginBottom: '4px' }}>
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
                    totalSpins: 0,
                    startingBankroll: bankroll
                  });
                  saveUserData({ sessionStats: {
                    totalWagered: 0,
                    biggestWin: 0,
                    totalSpins: 0,
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
              background: 'rgba(139, 0, 0, 0.1)',
              borderRadius: '8px',
              border: '1px solid rgba(139, 0, 0, 0.2)',
              fontSize: '10px',
              color: '#888',
              lineHeight: '1.6'
            }}>
              💡 Your session stats track your performance since joining. Resetting stats will not affect your bankroll or leaderboard position.
            </div>
          </div>
        )}

        {/* Admin Controls */}
        {isAdmin && (
          <div style={{
            background: 'linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)',
            border: '3px solid #8b0000',
            borderRadius: '12px',
            padding: '25px'
          }}>
            <div style={{
              fontSize: '13px',
              letterSpacing: '2px',
              textTransform: 'uppercase',
              color: '#8b0000',
              marginBottom: '20px',
              fontWeight: 'bold'
            }}>
              🎰 DEALER CONTROLS
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
                    value={customStartingChips}
                    onChange={(e) => setCustomStartingChips(parseInt(e.target.value) || 1000)}
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
                    ${customStartingChips.toLocaleString()}
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
                        {player.name} (${player.Math.round(bankroll).toLocaleString()})
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
            
            <div style={{
              background: 'rgba(0, 0, 0, 0.3)',
              padding: '18px',
              borderRadius: '8px',
              marginBottom: '15px'
            }}>
              <div style={{ marginBottom: '15px' }}>
                <div style={{ fontSize: '10px', color: '#888', marginBottom: '6px' }}>Countdown Duration (seconds)</div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  {[10, 15, 20, 30, 45, 60].map(sec => (
                    <button key={sec} onClick={() => setCountdownDuration(sec)}
                      style={{
                        flex: 1, padding: '8px',
                        background: countdownDuration === sec ? '#8b0000' : 'rgba(0,0,0,0.3)',
                        border: `1px solid ${countdownDuration === sec ? '#8b0000' : '#555'}`,
                        borderRadius: '6px', color: '#fff', fontSize: '11px', fontWeight: 'bold',
                        cursor: 'pointer', fontFamily: 'inherit'
                      }}>
                      {sec}s
                    </button>
                  ))}
                </div>
              </div>
              
              <div style={{ fontSize: '11px', color: '#888', marginBottom: '8px' }}>
                Quick Pick — tap a number, then SPIN
              </div>
              {/* Green numbers */}
              <div style={{ display: 'flex', gap: '4px', marginBottom: '4px' }}>
                {['0', '00'].map(n => (
                  <button key={n} onClick={() => setAdminNumber(n)}
                    style={{
                      flex: 1, padding: '10px 0', borderRadius: '6px', fontSize: '13px', fontWeight: 'bold',
                      background: adminNumber === n ? '#d4af37' : '#0a6e0a',
                      color: adminNumber === n ? '#000' : '#fff',
                      border: adminNumber === n ? '2px solid #d4af37' : '1px solid #333',
                      cursor: 'pointer', fontFamily: 'inherit'
                    }}>
                    {n}
                  </button>
                ))}
              </div>
              {/* Number grid 1-36 */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(9, 1fr)', gap: '3px', marginBottom: '10px' }}>
                {Array.from({length: 36}, (_, i) => String(i + 1)).map(n => {
                  const redNums = ['1','3','5','7','9','12','14','16','18','19','21','23','25','27','30','32','34','36'];
                  const isRed = redNums.includes(n);
                  return (
                    <button key={n} onClick={() => setAdminNumber(n)}
                      style={{
                        padding: '8px 0', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold',
                        background: adminNumber === n ? '#d4af37' : isRed ? '#8b0000' : '#111',
                        color: adminNumber === n ? '#000' : '#fff',
                        border: adminNumber === n ? '2px solid #d4af37' : '1px solid #333',
                        cursor: 'pointer', fontFamily: 'inherit'
                      }}>
                      {n}
                    </button>
                  );
                })}
              </div>
              {/* Selected + Spin */}
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <div style={{
                  flex: 1, padding: '12px', background: 'rgba(255,255,255,0.1)',
                  border: '2px solid #8b0000', borderRadius: '8px',
                  color: adminNumber ? '#d4af37' : '#666', fontSize: '18px', fontWeight: 'bold',
                  textAlign: 'center', fontFamily: 'inherit'
                }}>
                  {adminNumber || '—'}
                </div>
                <button
                  onClick={adminSpin}
                  disabled={!adminNumber || isSpinning}
                  style={{
                    padding: '12px 30px',
                    background: adminNumber && !isSpinning ? 'linear-gradient(135deg, #8b0000, #b30000)' : '#333',
                    border: 'none', borderRadius: '8px', color: '#fff',
                    fontSize: '13px', fontWeight: 'bold',
                    cursor: adminNumber && !isSpinning ? 'pointer' : 'not-allowed',
                    fontFamily: 'inherit', letterSpacing: '2px', textTransform: 'uppercase'
                  }}
                >
                  {isSpinning ? 'SPINNING...' : 'SPIN'}
                </button>
              </div>
            </div>
            
            {/* Betting Controls */}
            <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
              <button
                onClick={adminOpenBetting}
                disabled={bettingOpen || isSpinning}
                style={{
                  flex: 1,
                  padding: '14px',
                  background: !bettingOpen && !isSpinning ? 'rgba(76, 175, 80, 0.3)' : '#333',
                  border: '1px solid #4caf50',
                  borderRadius: '8px',
                  color: !bettingOpen && !isSpinning ? '#4caf50' : '#666',
                  fontSize: '11px',
                  fontWeight: 'bold',
                  cursor: !bettingOpen && !isSpinning ? 'pointer' : 'not-allowed',
                  fontFamily: 'inherit',
                  textTransform: 'uppercase'
                }}
              >
                🟢 Open Betting
              </button>
              <button
                onClick={adminCloseBetting}
                disabled={!bettingOpen || isSpinning}
                style={{
                  flex: 1,
                  padding: '14px',
                  background: bettingOpen && !isSpinning ? 'rgba(255, 152, 0, 0.3)' : '#333',
                  border: '1px solid #ff9800',
                  borderRadius: '8px',
                  color: bettingOpen && !isSpinning ? '#ff9800' : '#666',
                  fontSize: '11px',
                  fontWeight: 'bold',
                  cursor: bettingOpen && !isSpinning ? 'pointer' : 'not-allowed',
                  fontFamily: 'inherit',
                  textTransform: 'uppercase'
                }}
              >
                🔴 Close Betting
              </button>
            </div>
            
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
              <div>Active Players: <span style={{ color: '#8b0000' }}>{activeUsers}</span></div>
              <div>Betting: <span style={{ color: bettingOpen ? '#4caf50' : '#f44336' }}>
                {bettingOpen ? 'Open' : 'Closed'}
              </span></div>
              <div>Spinning: <span style={{ color: isSpinning ? '#ff9800' : '#888' }}>
                {isSpinning ? 'Yes' : 'No'}
              </span></div>
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
        * {
          box-sizing: border-box;
        }
        
        input:focus {
          outline: none;
          border-color: #8b0000 !important;
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

export default RouletteGame;
