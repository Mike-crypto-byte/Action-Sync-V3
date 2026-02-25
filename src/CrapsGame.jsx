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

const GAME_NAME = 'craps';

const CrapsGame = ({ onBack, isDealerMode = false, playerUserId, playerName: propPlayerName, skipRegistration = false }) => {
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
    gamePhase: 'come-out', point: null, rollNumber: 0,
    lastRoll: null, bettingOpen: false, countdown: 0, rollHistory: []
  };
  const { gameState, updateGameState } = useGameState(GAME_NAME, defaultGameState);
  
  // Game state (local UI)
  const [gameMode, setGameMode] = useState('standard'); // 'standard' or 'crapless'
  
  // Sync gameMode from Firebase
  useEffect(() => {
    if (gameState.gameMode && gameState.gameMode !== gameMode) {
      setGameMode(gameState.gameMode);
    }
  }, [gameState.gameMode]);
  // FIREBASE: gamePhase from gameState
  // FIREBASE: point from gameState
  // FIREBASE: rollNumber from gameState
  // FIREBASE: lastRoll from gameState
  // FIREBASE: bettingOpen from gameState
  // FIREBASE: countdown ticks locally
  const [localCountdown, setLocalCountdown] = useState(15);
  // FIREBASE: rollHistory from gameState
  
  // User bankroll and bets
  const [bankroll, setBankroll] = useState(1000);
  const [selectedChip, setSelectedChip] = useState(5);
  const [currentBets, setCurrentBets] = useState({
    passLine: 0,
    dontPass: 0,
    come: 0,
    dontCome: 0,
    field: 0,
    place4: 0, place5: 0, place6: 0, place8: 0, place9: 0, place10: 0,
    hard4: 0, hard6: 0, hard8: 0, hard10: 0,
    any7: 0, anyCraps: 0,
    ace2: 0, ace12: 0, yo11: 0, three: 0,
    small: 0, tall: 0, all: 0,
    craplessPlace2: 0, craplessPlace3: 0, craplessPlace11: 0, craplessPlace12: 0,
    // Odds bets
    passOdds: 0, dontPassOdds: 0, comeOdds: 0, dontComeOdds: 0,
    // Buy/Lay bets
    buy4: 0, buy5: 0, buy6: 0, buy8: 0, buy9: 0, buy10: 0,
    lay4: 0, lay5: 0, lay6: 0, lay8: 0, lay9: 0, lay10: 0,
    // Hop bets (all possible combinations)
    hop11: 0, hop22: 0, hop33: 0, hop44: 0, hop55: 0, hop66: 0, // Hard hops
    hop12: 0, hop13: 0, hop14: 0, hop15: 0, hop16: 0, // Soft hops
    hop23: 0, hop24: 0, hop25: 0, hop26: 0,
    hop34: 0, hop35: 0, hop36: 0,
    hop45: 0, hop46: 0, hop56: 0,
    // Horn & C&E
    horn: 0, ce: 0,
    // Big 6/8
    big6: 0, big8: 0
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

  
  // UI State
  const [showPayouts, setShowPayouts] = useState(false);
  const [showHopBets, setShowHopBets] = useState(false);
  const [showBuyLay, setShowBuyLay] = useState(false);
  // FIREBASE: chatMessages from useChat hook
  const [chatInput, setChatInput] = useState('');
  const chatEndRef = useRef(null);
  
  // ========== FIREBASE: Chat + User data hooks ==========
  const { chatMessages: fbChatMessages, sendMessage: fbSendMessage, clearChat } = useChat();
  const { userData, saveUserData: fbSaveUserData } = useUserData(userId);
  
  const [sessionStats, setSessionStats] = useState({
    totalWagered: 0,
    biggestWin: 0,
    totalRolls: 0,
    startingBankroll: startingChips
  });
  
  // ========== FIREBASE: Leaderboard ==========
  const { leaderboard, updateLeaderboardEntry, clearLeaderboard } = useLeaderboard();
  
  // Admin state
  const [adminDice1, setAdminDice1] = useState('');
  const [adminDice2, setAdminDice2] = useState('');
  // FIREBASE: activeUsers from presence
  const activeUsers = usePresence(isRegistered ? userId : null, userName);
  const [showSettings, setShowSettings] = useState(false);

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
  
  // ========== FIREBASE: Sync countdown from gameState ==========
  useEffect(() => {
    if (gameState.bettingOpen) setLocalCountdown(gameState.countdown || 15);
  }, [gameState.countdown, gameState.bettingOpen]);
  
  // ========== FIREBASE: Auto-resolve when dealer pushes a roll ==========
  const lastResolvedRoll = useRef(0);

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
      passLine: 0, dontPass: 0, come: 0, dontCome: 0, field: 0,
      place4: 0, place5: 0, place6: 0, place8: 0, place9: 0, place10: 0,
      hard4: 0, hard6: 0, hard8: 0, hard10: 0,
      any7: 0, anyCraps: 0, ace2: 0, ace12: 0, yo11: 0, three: 0,
      small: 0, tall: 0, all: 0,
      craplessPlace2: 0, craplessPlace3: 0, craplessPlace11: 0, craplessPlace12: 0,
      passOdds: 0, dontPassOdds: 0, comeOdds: 0, dontComeOdds: 0,
      buy4: 0, buy5: 0, buy6: 0, buy8: 0, buy9: 0, buy10: 0,
      lay4: 0, lay5: 0, lay6: 0, lay8: 0, lay9: 0, lay10: 0,
      hop11: 0, hop22: 0, hop33: 0, hop44: 0, hop55: 0, hop66: 0,
      hop12: 0, hop13: 0, hop14: 0, hop15: 0, hop16: 0,
      hop23: 0, hop24: 0, hop25: 0, hop26: 0,
      hop34: 0, hop35: 0, hop36: 0,
      hop45: 0, hop46: 0, hop56: 0,
      horn: 0, ce: 0, big6: 0, big8: 0
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
    
    // Merge current bets into active bets
    const newActiveBets = { ...activeBets };
    Object.keys(currentBets).forEach(key => {
      if (currentBets[key] > 0) {
        newActiveBets[key] = (newActiveBets[key] || 0) + currentBets[key];
      }
    });
    
    setActiveBets(newActiveBets);
    setSessionStats(prev => ({
      ...prev,
      totalWagered: prev.totalWagered + totalBet
    }));
    setLastConfirmedBets({ ...currentBets });
    clearAllBets();

    await saveUserData({ bankroll: newBankroll, activeBets: newActiveBets });
    await updateLeaderboard(newBankroll);
    setIsConfirming(false);
  };

  // Remove bet (for multi-roll bets that can be taken down)
  const removeBet = async (betKey) => {
    if (activeBets[betKey] > 0) {
      const returnAmount = activeBets[betKey];
      setBankroll(bankroll + returnAmount);
      const newActiveBets = { ...activeBets };
      newActiveBets[betKey] = 0;
      setActiveBets(newActiveBets);
      await saveUserData({ bankroll: bankroll + returnAmount, activeBets: newActiveBets });
      await updateLeaderboard(bankroll + returnAmount);
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



  // FIREBASE: Chat messages come from useChat hook (fbChatMessages)

  const resolveRoll = async (dice1, dice2) => {
    setPrevBankroll(bankroll);
    setLastRoundUndoable(true);
    const total = dice1 + dice2;
    const isHard = dice1 === dice2;
    const diceCombo = dice1 <= dice2 ? `${dice1}${dice2}` : `${dice2}${dice1}`;
    let winnings = 0;
    let newActiveBets = { ...activeBets };
    let rollWinnings = 0; // Track this roll's winnings for stats
    
    // === ONE ROLL BETS ===
    
    // Field bet (2,3,4,9,10,11,12 - pays 2x on 2,12)
    if (newActiveBets.field > 0) {
      if ([2, 3, 4, 9, 10, 11, 12].includes(total)) {
        if (total === 2 || total === 12) {
          const payout = newActiveBets.field * 3; // 2:1 payout
          winnings += payout;
          rollWinnings += payout - newActiveBets.field;
        } else {
          const payout = newActiveBets.field * 2; // 1:1 payout
          winnings += payout;
          rollWinnings += payout - newActiveBets.field;
        }
      } else {
        rollWinnings -= newActiveBets.field;
      }
      newActiveBets.field = 0;
    }
    
    // Any 7
    if (newActiveBets.any7 > 0) {
      if (total === 7) {
        const payout = newActiveBets.any7 * 5; // 4:1 payout
        winnings += payout;
        rollWinnings += payout - newActiveBets.any7;
      } else {
        rollWinnings -= newActiveBets.any7;
      }
      newActiveBets.any7 = 0;
    }
    
    // Any Craps (2,3,12)
    if (newActiveBets.anyCraps > 0) {
      if ([2, 3, 12].includes(total)) {
        const payout = newActiveBets.anyCraps * 8; // 7:1 payout
        winnings += payout;
        rollWinnings += payout - newActiveBets.anyCraps;
      } else {
        rollWinnings -= newActiveBets.anyCraps;
      }
      newActiveBets.anyCraps = 0;
    }
    
    // Individual prop bets
    if (newActiveBets.ace2 > 0) {
      if (total === 2) {
        const payout = newActiveBets.ace2 * 31; // 30:1
        winnings += payout;
        rollWinnings += payout - newActiveBets.ace2;
      } else {
        rollWinnings -= newActiveBets.ace2;
      }
      newActiveBets.ace2 = 0;
    }
    if (newActiveBets.ace12 > 0) {
      if (total === 12) {
        const payout = newActiveBets.ace12 * 31; // 30:1
        winnings += payout;
        rollWinnings += payout - newActiveBets.ace12;
      } else {
        rollWinnings -= newActiveBets.ace12;
      }
      newActiveBets.ace12 = 0;
    }
    if (newActiveBets.three > 0) {
      if (total === 3) {
        const payout = newActiveBets.three * 16; // 15:1
        winnings += payout;
        rollWinnings += payout - newActiveBets.three;
      } else {
        rollWinnings -= newActiveBets.three;
      }
      newActiveBets.three = 0;
    }
    if (newActiveBets.yo11 > 0) {
      if (total === 11) {
        const payout = newActiveBets.yo11 * 16; // 15:1
        winnings += payout;
        rollWinnings += payout - newActiveBets.yo11;
      } else {
        rollWinnings -= newActiveBets.yo11;
      }
      newActiveBets.yo11 = 0;
    }
    
    // Horn Bet (2, 3, 11, 12)
    if (newActiveBets.horn > 0) {
      if (total === 2 || total === 12) {
        const payout = newActiveBets.horn * 7.5; // 30:1 on winner minus 3 losers
        winnings += payout;
        rollWinnings += payout - newActiveBets.horn;
      } else if (total === 3 || total === 11) {
        const payout = newActiveBets.horn * 4; // 15:1 on winner minus 3 losers
        winnings += payout;
        rollWinnings += payout - newActiveBets.horn;
      } else {
        rollWinnings -= newActiveBets.horn;
      }
      newActiveBets.horn = 0;
    }
    
    // C&E (Any Craps + Eleven)
    if (newActiveBets.ce > 0) {
      if ([2, 3, 12].includes(total)) {
        const payout = newActiveBets.ce * 1.5; // 3:1 on craps half minus eleven half
        winnings += payout;
        rollWinnings += payout - newActiveBets.ce;
      } else if (total === 11) {
        const payout = newActiveBets.ce * 3.5; // 7:1 on eleven half minus craps half
        winnings += payout;
        rollWinnings += payout - newActiveBets.ce;
      } else {
        rollWinnings -= newActiveBets.ce;
      }
      newActiveBets.ce = 0;
    }
    
    // Hop Bets (one roll)
    const hopBets = [
      'hop11', 'hop22', 'hop33', 'hop44', 'hop55', 'hop66',
      'hop12', 'hop13', 'hop14', 'hop15', 'hop16',
      'hop23', 'hop24', 'hop25', 'hop26',
      'hop34', 'hop35', 'hop36',
      'hop45', 'hop46', 'hop56'
    ];
    
    hopBets.forEach(hopBet => {
      if (newActiveBets[hopBet] > 0) {
        const hopCombo = hopBet.substring(3);
        const isHardHop = hopCombo[0] === hopCombo[1];
        
        if (diceCombo === hopCombo) {
          const payout = isHardHop 
            ? newActiveBets[hopBet] * 31  // 30:1 for hard hops
            : newActiveBets[hopBet] * 16; // 15:1 for easy hops
          winnings += payout;
          rollWinnings += payout - newActiveBets[hopBet];
        } else {
          rollWinnings -= newActiveBets[hopBet];
        }
        newActiveBets[hopBet] = 0;
      }
    });
    
    // === MULTI-ROLL BETS ===
    
    // Hard ways (lose on easy way or 7)
    const hardWayPayouts = { 4: 8, 6: 10, 8: 10, 10: 8 }; // 7:1 and 9:1
    [4, 6, 8, 10].forEach(num => {
      const betKey = `hard${num}`;
      if (newActiveBets[betKey] > 0) {
        if (total === num && isHard) {
          const payout = newActiveBets[betKey] * hardWayPayouts[num];
          winnings += payout;
          rollWinnings += payout - newActiveBets[betKey];
          newActiveBets[betKey] = 0;
        } else if (total === num || total === 7) {
          rollWinnings -= newActiveBets[betKey];
          newActiveBets[betKey] = 0;
        }
      }
    });
    
    // Place bets (standard craps)
    const placePayouts = { 4: 1.8, 5: 1.4, 6: 1.16667, 8: 1.16667, 9: 1.4, 10: 1.8 };
    [4, 5, 6, 8, 9, 10].forEach(num => {
      const betKey = `place${num}`;
      if (newActiveBets[betKey] > 0) {
        if (total === num) {
          const payout = newActiveBets[betKey] * (1 + placePayouts[num]);
          winnings += payout;
          rollWinnings += payout - newActiveBets[betKey];
        } else if (total === 7) {
          rollWinnings -= newActiveBets[betKey];
          newActiveBets[betKey] = 0;
        }
      }
    });
    
    // Buy bets (true odds with 5% commission)
    const buyPayouts = { 4: 2, 5: 1.5, 6: 1.2, 8: 1.2, 9: 1.5, 10: 2 }; // True odds
    [4, 5, 6, 8, 9, 10].forEach(num => {
      const betKey = `buy${num}`;
      if (newActiveBets[betKey] > 0) {
        if (total === num) {
          const payout = newActiveBets[betKey] + (newActiveBets[betKey] * buyPayouts[num] * 0.95); // -5% commission
          winnings += payout;
          rollWinnings += payout - newActiveBets[betKey];
        } else if (total === 7) {
          rollWinnings -= newActiveBets[betKey];
          newActiveBets[betKey] = 0;
        }
      }
    });
    
    // Lay bets (opposite of buy, betting on 7)
    const layPayouts = { 4: 0.5, 5: 0.667, 6: 0.833, 8: 0.833, 9: 0.667, 10: 0.5 };
    [4, 5, 6, 8, 9, 10].forEach(num => {
      const betKey = `lay${num}`;
      if (newActiveBets[betKey] > 0) {
        if (total === 7) {
          const payout = newActiveBets[betKey] + (newActiveBets[betKey] * layPayouts[num] * 0.95); // -5% commission
          winnings += payout;
          rollWinnings += payout - newActiveBets[betKey];
          newActiveBets[betKey] = 0;
        } else if (total === num) {
          rollWinnings -= newActiveBets[betKey];
          newActiveBets[betKey] = 0;
        }
      }
    });
    
    // Big 6 / Big 8 (pays even money, worse than place bet)
    if (newActiveBets.big6 > 0) {
      if (total === 6) {
        const payout = newActiveBets.big6 * 2;
        winnings += payout;
        rollWinnings += payout - newActiveBets.big6;
      } else if (total === 7) {
        rollWinnings -= newActiveBets.big6;
        newActiveBets.big6 = 0;
      }
    }
    if (newActiveBets.big8 > 0) {
      if (total === 8) {
        const payout = newActiveBets.big8 * 2;
        winnings += payout;
        rollWinnings += payout - newActiveBets.big8;
      } else if (total === 7) {
        rollWinnings -= newActiveBets.big8;
        newActiveBets.big8 = 0;
      }
    }
    
    // Crapless place bets (2, 3, 11, 12)
    if (gameMode === 'crapless') {
      const craplessPayouts = { 2: 7, 3: 3, 11: 3, 12: 7 };
      [2, 3, 11, 12].forEach(num => {
        const betKey = `craplessPlace${num}`;
        if (newActiveBets[betKey] > 0) {
          if (total === num) {
            const payout = newActiveBets[betKey] * (1 + craplessPayouts[num]);
            winnings += payout;
            rollWinnings += payout - newActiveBets[betKey];
          } else if (total === 7) {
            rollWinnings -= newActiveBets[betKey];
            newActiveBets[betKey] = 0;
          }
        }
      });
    }
    
    // === LINE BETS & ODDS ===
    
    if (gamePhase === 'come-out') {
      // Pass Line resolution (standard craps)
      if (gameMode === 'standard') {
        if (newActiveBets.passLine > 0) {
          if (total === 7 || total === 11) {
            const payout = newActiveBets.passLine * 2;
            winnings += payout;
            rollWinnings += payout - newActiveBets.passLine;
            newActiveBets.passLine = 0;
          } else if (total === 2 || total === 3 || total === 12) {
            rollWinnings -= newActiveBets.passLine;
            newActiveBets.passLine = 0;
          }
        }
        
        // Don't Pass resolution
        if (newActiveBets.dontPass > 0) {
          if (total === 2 || total === 3) {
            const payout = newActiveBets.dontPass * 2;
            winnings += payout;
            rollWinnings += payout - newActiveBets.dontPass;
            newActiveBets.dontPass = 0;
          } else if (total === 12) {
            winnings += newActiveBets.dontPass; // Push
            newActiveBets.dontPass = 0;
          } else if (total === 7 || total === 11) {
            rollWinnings -= newActiveBets.dontPass;
            newActiveBets.dontPass = 0;
          }
        }
      } else {
        // Crapless craps - only 7 and 11 win on come out
        if (newActiveBets.passLine > 0) {
          if (total === 7 || total === 11) {
            const payout = newActiveBets.passLine * 2;
            winnings += payout;
            rollWinnings += payout - newActiveBets.passLine;
            newActiveBets.passLine = 0;
          }
        }
      }
      
      // Establish point if applicable
      const pointNumbers = gameMode === 'standard' 
        ? [4, 5, 6, 8, 9, 10] 
        : [2, 3, 4, 5, 6, 8, 9, 10, 11, 12];
      
      if (pointNumbers.includes(total) && newActiveBets.passLine > 0) {
        setGamePhase('point');
        setPoint(total);
      }
    } else {
      // Point phase
      if (total === point) {
        // Point hit - Pass Line wins
        if (newActiveBets.passLine > 0) {
          let linePayout = 2;
          if (gameMode === 'crapless') {
            if (point === 2 || point === 12) linePayout = 7;
            else if (point === 3 || point === 11) linePayout = 4;
          }
          const payout = newActiveBets.passLine * linePayout;
          winnings += payout;
          rollWinnings += payout - newActiveBets.passLine;
          newActiveBets.passLine = 0;
        }
        
        // Pass Odds win at true odds
        if (newActiveBets.passOdds > 0) {
          const oddsPayouts = { 4: 2, 5: 1.5, 6: 1.2, 8: 1.2, 9: 1.5, 10: 2 };
          const payout = newActiveBets.passOdds * (1 + oddsPayouts[point]);
          winnings += payout;
          rollWinnings += payout - newActiveBets.passOdds;
          newActiveBets.passOdds = 0;
        }
        
        setGamePhase('come-out');
        setPoint(null);
      } else if (total === 7) {
        // Seven out - all line bets and place bets lose
        if (newActiveBets.passLine > 0) rollWinnings -= newActiveBets.passLine;
        if (newActiveBets.passOdds > 0) rollWinnings -= newActiveBets.passOdds;
        
        newActiveBets.passLine = 0;
        newActiveBets.passOdds = 0;
        newActiveBets.dontPass = 0;
        newActiveBets.dontPassOdds = 0;
        
        [4, 5, 6, 8, 9, 10].forEach(num => {
          if (newActiveBets[`place${num}`] > 0) rollWinnings -= newActiveBets[`place${num}`];
          newActiveBets[`place${num}`] = 0;
        });
        if (gameMode === 'crapless') {
          [2, 3, 11, 12].forEach(num => {
            if (newActiveBets[`craplessPlace${num}`] > 0) rollWinnings -= newActiveBets[`craplessPlace${num}`];
            newActiveBets[`craplessPlace${num}`] = 0;
          });
        }
        setGamePhase('come-out');
        setPoint(null);
      }
      
      // Don't Pass wins on 7 out
      if (total === 7 && newActiveBets.dontPass > 0) {
        const payout = newActiveBets.dontPass * 2;
        winnings += payout;
        rollWinnings += payout - newActiveBets.dontPass;
        newActiveBets.dontPass = 0;
        
        // Don't Pass Odds
        if (newActiveBets.dontPassOdds > 0) {
          const oddsPayouts = { 4: 0.5, 5: 0.667, 6: 0.833, 8: 0.833, 9: 0.667, 10: 0.5 };
          const payout = newActiveBets.dontPassOdds * (1 + oddsPayouts[point]);
          winnings += payout;
          rollWinnings += payout - newActiveBets.dontPassOdds;
          newActiveBets.dontPassOdds = 0;
        }
      } else if (total === point && newActiveBets.dontPass > 0) {
        rollWinnings -= newActiveBets.dontPass;
        if (newActiveBets.dontPassOdds > 0) rollWinnings -= newActiveBets.dontPassOdds;
        newActiveBets.dontPass = 0;
        newActiveBets.dontPassOdds = 0;
      }
    }
    
    const newBankroll = Math.round(bankroll + winnings);
    setBankroll(newBankroll);
    setActiveBets(newActiveBets);
    setRollHistory(prev => [{ dice1, dice2, total, winnings: rollWinnings }, ...prev.slice(0, 19)]);
    
    // Update stats
    setSessionStats(prev => ({
      ...prev,
      totalRolls: prev.totalRolls + 1,
      biggestWin: Math.max(prev.biggestWin, rollWinnings)
    }));
    
    // Record bet history
    const totalWagered = Object.values(activeBets).reduce((s, v) => s + (v > 0 ? v : 0), 0);
    if (totalWagered > 0) {
      setBetHistory(prev => [{
        round: gameState.rollNumber || 0,
        dice: [dice1, dice2],
        total: dice1 + dice2,
        totalWagered,
        winnings: rollWinnings,
        timestamp: Date.now()
      }, ...prev].slice(0, 20));
    }
    
    // Show result banner
    const netResult = newBankroll - bankroll;
    if (totalWagered > 0) {
      if (netResult > 0) {
        showResultBanner('win', netResult, `Roll: ${dice1 + dice2} (${dice1}-${dice2})`);
      } else if (netResult === 0) {
        showResultBanner('push', 0, `Roll: ${dice1 + dice2} (${dice1}-${dice2})`);
      } else {
        showResultBanner('loss', netResult, `Roll: ${dice1 + dice2} (${dice1}-${dice2})`);
      }
    }

    await saveUserData({ bankroll: newBankroll, activeBets: newActiveBets });
    await updateLeaderboard(newBankroll);
  };

  // ========== FIREBASE: Auto-resolve when dealer pushes a roll ==========
  useEffect(() => {
    if (gameState.lastRoll && gameState.rollNumber > lastResolvedRoll.current) {
      lastResolvedRoll.current = gameState.rollNumber;
      if (Object.values(activeBets).some(v => v > 0)) {
        resolveRoll(gameState.lastRoll.dice1, gameState.lastRoll.dice2);
      }
    }
  }, [gameState.lastRoll, gameState.rollNumber]);

  // ========== FIREBASE: Admin roll writes to Firebase — all clients auto-resolve ==========
  const adminSubmitRoll = async () => {
    const d1 = parseInt(adminDice1);
    const d2 = parseInt(adminDice2);
    if (d1 >= 1 && d1 <= 6 && d2 >= 1 && d2 <= 6) {
      const newRoll = { dice1: d1, dice2: d2, total: d1 + d2, timestamp: Date.now() };
      const newHistory = [{ dice1: d1, dice2: d2, total: d1 + d2 }, ...(gameState.rollHistory || []).slice(0, 19)];
      await updateGameState({
        lastRoll: newRoll,
        rollNumber: (gameState.rollNumber || 0) + 1,
        bettingOpen: false,
        countdown: 0,
        rollHistory: newHistory
      });
      setAdminDice1('');
      setAdminDice2('');
      await sendSystemMessage(`🎲 Roll: ${d1 + d2} (${d1}-${d2}) — Roll #${(gameState.rollNumber || 0) + 1}`);
    }
  };

  // ========== Dealer betting controls ==========
  const adminOpenBetting = async () => {
    await updateGameState({ bettingOpen: true, countdown: countdownDuration });
    await sendSystemMessage(`🟢 Betting is OPEN — ${countdownDuration}s to place your bets!`);
  };
  
  const adminCloseBetting = async () => {
    await updateGameState({ bettingOpen: false, countdown: 0 });
    await sendSystemMessage('🔴 Betting is CLOSED — no more bets!');
  };
  
  const adminStartNewRoll = adminOpenBetting;

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
        setBankroll(startingChips);
        clearAllBets();
        setActiveBets({});
        setSessionStats({ totalWagered: 0, biggestWin: 0, totalRolls: 0, startingBankroll: startingChips });
        await saveUserData({ bankroll: startingChips, activeBets: {}, sessionStats: { totalWagered: 0, biggestWin: 0, totalRolls: 0, startingBankroll: startingChips }});
      } catch (e) { console.error('Reset failed:', e); }
    }
  };

  // FIREBASE: activeUsers from usePresence

  // ========== FIREBASE: Convenience aliases ==========
  const gamePhase = gameState.gamePhase || 'come-out';
  const point = gameState.point;
  const rollNumber = gameState.rollNumber || 0;
  const lastRoll = gameState.lastRoll;
  const bettingOpen = gameState.bettingOpen;
  const countdown = localCountdown;
  const rollHistory = gameState.rollHistory || [];
  const chatMessages = fbChatMessages;

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
              Live Casino Craps
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

  // Craps table component
  const CrapsBetArea = ({ label, value, onClick, style = {}, disabled = false }) => (
    <div
      onClick={disabled ? null : onClick}
      style={{
        position: 'relative',
        border: '2px solid #fff',
        padding: '8px',
        textAlign: 'center',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.3 : 1,
        transition: 'all 0.2s',
        background: value > 0 ? '#d4af37' : 'transparent',
        color: value > 0 ? '#000' : '#fff',
        fontWeight: value > 0 ? 'bold' : 'normal',
        userSelect: 'none',
        ...style
      }}
    >
      <div style={{ fontSize: '10px', lineHeight: '1.2' }}>{label}</div>
      {value > 0 && (
        <div style={{
          position: 'absolute',
          top: '-12px',
          right: '-12px',
          background: '#000',
          color: '#d4af37',
          borderRadius: '50%',
          width: '24px',
          height: '24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '10px',
          fontWeight: 'bold',
          border: '2px solid #d4af37',
          boxShadow: '0 2px 8px rgba(0,0,0,0.5)'
        }}>
          ${value}
        </div>
      )}
    </div>
  );

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
                background: 'rgba(212, 175, 55, 0.2)',
                border: '1px solid #d4af37',
                borderRadius: '6px',
                padding: '6px 12px',
                color: '#d4af37',
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

      {/* Main Table Container */}
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
            <div style={{ fontSize: '10px', color: '#888', marginBottom: '4px' }}>GAME MODE</div>
            <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#d4af37' }}>
              {gameMode === 'standard' ? 'STANDARD CRAPS' : 'CRAPLESS CRAPS'}
            </div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '10px', color: '#888', marginBottom: '4px' }}>STATUS</div>
            <div style={{ fontSize: '18px', fontWeight: 'bold', color: gamePhase === 'come-out' ? '#4caf50' : '#ff9800' }}>
              {gamePhase === 'come-out' ? 'COME OUT' : `POINT: ${point}`}
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
            <div style={{ fontSize: '10px', color: '#888', marginBottom: '4px' }}>ROLL #{rollNumber}</div>
            {lastRoll && (
              <div style={{ display: 'flex', gap: '6px' }}>
                <div style={{
                  width: '28px', height: '28px', background: '#fff', borderRadius: '4px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '16px', fontWeight: 'bold', color: '#000'
                }}>
                  {lastRoll.dice1}
                </div>
                <div style={{
                  width: '28px', height: '28px', background: '#fff', borderRadius: '4px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '16px', fontWeight: 'bold', color: '#000'
                }}>
                  {lastRoll.dice2}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Craps Table */}
        <div style={{
          background: '#0d3d0d',
          border: '8px solid #8b4513',
          borderRadius: '20px',
          padding: '30px',
          boxShadow: 'inset 0 0 50px rgba(0,0,0,0.5), 0 10px 40px rgba(0,0,0,0.8)',
          marginBottom: '20px'
        }}>
          
          {/* Top Section - Proposition Bets */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : '1fr 2fr 1fr',
            gap: '10px',
            marginBottom: '15px',
            padding: '15px',
            background: 'rgba(0,0,0,0.2)',
            borderRadius: '10px',
            border: '2px solid rgba(255,255,255,0.1)'
          }}>
            {/* Left Props */}
            <div style={{ display: 'grid', gap: '8px' }}>
              <CrapsBetArea 
                label="HARD 4 (7:1)" 
                value={currentBets.hard4 + (activeBets.hard4 || 0)}
                onClick={() => placeBet('hard4')}
                disabled={!bettingOpen}
              />
              <CrapsBetArea 
                label="HARD 10 (7:1)" 
                value={currentBets.hard10 + (activeBets.hard10 || 0)}
                onClick={() => placeBet('hard10')}
                disabled={!bettingOpen}
              />
            </div>
            
            {/* Center Props */}
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '1fr 1fr 1fr', gap: isMobile ? '6px' : '8px' }}>
              <CrapsBetArea 
                label="ACE DEUCE (3) 15:1" 
                value={currentBets.three + (activeBets.three || 0)}
                onClick={() => placeBet('three')}
                disabled={!bettingOpen}
                style={{ fontSize: '8px' }}
              />
              <CrapsBetArea 
                label="ANY 7 (4:1)" 
                value={currentBets.any7 + (activeBets.any7 || 0)}
                onClick={() => placeBet('any7')}
                disabled={!bettingOpen}
              />
              <CrapsBetArea 
                label="YO (11) 15:1" 
                value={currentBets.yo11 + (activeBets.yo11 || 0)}
                onClick={() => placeBet('yo11')}
                disabled={!bettingOpen}
                style={{ fontSize: '8px' }}
              />
              <CrapsBetArea 
                label="SNAKE EYES (2) 30:1" 
                value={currentBets.ace2 + (activeBets.ace2 || 0)}
                onClick={() => placeBet('ace2')}
                disabled={!bettingOpen}
                style={{ fontSize: '7px' }}
              />
              <CrapsBetArea 
                label="ANY CRAPS 7:1" 
                value={currentBets.anyCraps + (activeBets.anyCraps || 0)}
                onClick={() => placeBet('anyCraps')}
                disabled={!bettingOpen}
                style={{ fontSize: '8px' }}
              />
              <CrapsBetArea 
                label="BOXCARS (12) 30:1" 
                value={currentBets.ace12 + (activeBets.ace12 || 0)}
                onClick={() => placeBet('ace12')}
                disabled={!bettingOpen}
                style={{ fontSize: '7px' }}
              />
              <CrapsBetArea 
                label="HORN" 
                value={currentBets.horn + (activeBets.horn || 0)}
                onClick={() => placeBet('horn')}
                disabled={!bettingOpen}
                style={{ fontSize: '9px', gridColumn: '1' }}
              />
              <CrapsBetArea 
                label="C & E" 
                value={currentBets.ce + (activeBets.ce || 0)}
                onClick={() => placeBet('ce')}
                disabled={!bettingOpen}
                style={{ fontSize: '9px', gridColumn: '2' }}
              />
              <button
                onClick={() => setShowHopBets(!showHopBets)}
                style={{
                  background: showHopBets ? '#d4af37' : 'rgba(212, 175, 55, 0.3)',
                  color: showHopBets ? '#000' : '#d4af37',
                  border: '2px solid #d4af37',
                  fontSize: '8px',
                  padding: '4px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontWeight: 'bold'
                }}
              >
                HOP BETS
              </button>
            </div>
            
            {/* Right Props */}
            <div style={{ display: 'grid', gap: '8px' }}>
              <CrapsBetArea 
                label="HARD 6 (9:1)" 
                value={currentBets.hard6 + (activeBets.hard6 || 0)}
                onClick={() => placeBet('hard6')}
                disabled={!bettingOpen}
              />
              <CrapsBetArea 
                label="HARD 8 (9:1)" 
                value={currentBets.hard8 + (activeBets.hard8 || 0)}
                onClick={() => placeBet('hard8')}
                disabled={!bettingOpen}
              />
            </div>
          </div>

          {/* Hop Bets Overlay */}
          {showHopBets && (
            <div style={{
              marginBottom: '15px',
              padding: '15px',
              background: 'rgba(212, 175, 55, 0.1)',
              border: '2px solid #d4af37',
              borderRadius: '10px'
            }}>
              <div style={{ fontSize: '10px', color: '#d4af37', marginBottom: '10px', fontWeight: 'bold' }}>
                HOP BETS (One Roll Only)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(3, 1fr)' : 'repeat(6, 1fr)', gap: isMobile ? '4px' : '6px', marginBottom: '10px' }}>
                <CrapsBetArea label="1-1 (30:1)" value={currentBets.hop11 + (activeBets.hop11 || 0)} onClick={() => placeBet('hop11')} disabled={!bettingOpen} style={{ fontSize: '8px' }} />
                <CrapsBetArea label="2-2 (30:1)" value={currentBets.hop22 + (activeBets.hop22 || 0)} onClick={() => placeBet('hop22')} disabled={!bettingOpen} style={{ fontSize: '8px' }} />
                <CrapsBetArea label="3-3 (30:1)" value={currentBets.hop33 + (activeBets.hop33 || 0)} onClick={() => placeBet('hop33')} disabled={!bettingOpen} style={{ fontSize: '8px' }} />
                <CrapsBetArea label="4-4 (30:1)" value={currentBets.hop44 + (activeBets.hop44 || 0)} onClick={() => placeBet('hop44')} disabled={!bettingOpen} style={{ fontSize: '8px' }} />
                <CrapsBetArea label="5-5 (30:1)" value={currentBets.hop55 + (activeBets.hop55 || 0)} onClick={() => placeBet('hop55')} disabled={!bettingOpen} style={{ fontSize: '8px' }} />
                <CrapsBetArea label="6-6 (30:1)" value={currentBets.hop66 + (activeBets.hop66 || 0)} onClick={() => placeBet('hop66')} disabled={!bettingOpen} style={{ fontSize: '8px' }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(3, 1fr)' : 'repeat(6, 1fr)', gap: isMobile ? '4px' : '6px' }}>
                <CrapsBetArea label="1-2 (15:1)" value={currentBets.hop12 + (activeBets.hop12 || 0)} onClick={() => placeBet('hop12')} disabled={!bettingOpen} style={{ fontSize: '8px' }} />
                <CrapsBetArea label="1-3 (15:1)" value={currentBets.hop13 + (activeBets.hop13 || 0)} onClick={() => placeBet('hop13')} disabled={!bettingOpen} style={{ fontSize: '8px' }} />
                <CrapsBetArea label="1-4 (15:1)" value={currentBets.hop14 + (activeBets.hop14 || 0)} onClick={() => placeBet('hop14')} disabled={!bettingOpen} style={{ fontSize: '8px' }} />
                <CrapsBetArea label="1-5 (15:1)" value={currentBets.hop15 + (activeBets.hop15 || 0)} onClick={() => placeBet('hop15')} disabled={!bettingOpen} style={{ fontSize: '8px' }} />
                <CrapsBetArea label="1-6 (15:1)" value={currentBets.hop16 + (activeBets.hop16 || 0)} onClick={() => placeBet('hop16')} disabled={!bettingOpen} style={{ fontSize: '8px' }} />
                <CrapsBetArea label="2-3 (15:1)" value={currentBets.hop23 + (activeBets.hop23 || 0)} onClick={() => placeBet('hop23')} disabled={!bettingOpen} style={{ fontSize: '8px' }} />
                <CrapsBetArea label="2-4 (15:1)" value={currentBets.hop24 + (activeBets.hop24 || 0)} onClick={() => placeBet('hop24')} disabled={!bettingOpen} style={{ fontSize: '8px' }} />
                <CrapsBetArea label="2-5 (15:1)" value={currentBets.hop25 + (activeBets.hop25 || 0)} onClick={() => placeBet('hop25')} disabled={!bettingOpen} style={{ fontSize: '8px' }} />
                <CrapsBetArea label="2-6 (15:1)" value={currentBets.hop26 + (activeBets.hop26 || 0)} onClick={() => placeBet('hop26')} disabled={!bettingOpen} style={{ fontSize: '8px' }} />
                <CrapsBetArea label="3-4 (15:1)" value={currentBets.hop34 + (activeBets.hop34 || 0)} onClick={() => placeBet('hop34')} disabled={!bettingOpen} style={{ fontSize: '8px' }} />
                <CrapsBetArea label="3-5 (15:1)" value={currentBets.hop35 + (activeBets.hop35 || 0)} onClick={() => placeBet('hop35')} disabled={!bettingOpen} style={{ fontSize: '8px' }} />
                <CrapsBetArea label="3-6 (15:1)" value={currentBets.hop36 + (activeBets.hop36 || 0)} onClick={() => placeBet('hop36')} disabled={!bettingOpen} style={{ fontSize: '8px' }} />
                <CrapsBetArea label="4-5 (15:1)" value={currentBets.hop45 + (activeBets.hop45 || 0)} onClick={() => placeBet('hop45')} disabled={!bettingOpen} style={{ fontSize: '8px' }} />
                <CrapsBetArea label="4-6 (15:1)" value={currentBets.hop46 + (activeBets.hop46 || 0)} onClick={() => placeBet('hop46')} disabled={!bettingOpen} style={{ fontSize: '8px' }} />
                <CrapsBetArea label="5-6 (15:1)" value={currentBets.hop56 + (activeBets.hop56 || 0)} onClick={() => placeBet('hop56')} disabled={!bettingOpen} style={{ fontSize: '8px' }} />
              </div>
            </div>
          )}

          {/* Main Betting Area */}
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '120px 1fr 120px', gap: '15px' }}>
            
            {/* Left Pass/Don't Pass */}
            <div style={{ display: 'grid', gap: '10px' }}>
              <div>
                <CrapsBetArea 
                  label="PASS LINE" 
                  value={currentBets.passLine + (activeBets.passLine || 0)}
                  onClick={() => placeBet('passLine')}
                  disabled={!bettingOpen || (gamePhase === 'point' && activeBets.passLine > 0)}
                  style={{ 
                    height: '60px', 
                    background: currentBets.passLine + (activeBets.passLine || 0) > 0 ? '#d4af37' : 'rgba(255,255,255,0.1)',
                    border: '3px solid #fff',
                    fontSize: '10px',
                    marginBottom: '5px'
                  }}
                />
                {gamePhase === 'point' && activeBets.passLine > 0 && (
                  <CrapsBetArea 
                    label="ODDS" 
                    value={currentBets.passOdds + (activeBets.passOdds || 0)}
                    onClick={() => placeBet('passOdds')}
                    disabled={!bettingOpen}
                    style={{ 
                      height: '40px',
                      fontSize: '9px',
                      background: currentBets.passOdds + (activeBets.passOdds || 0) > 0 ? '#4caf50' : 'rgba(76, 175, 80, 0.2)',
                      border: '2px solid #4caf50'
                    }}
                  />
                )}
              </div>
              <div>
                <CrapsBetArea 
                  label="DON'T PASS" 
                  value={currentBets.dontPass + (activeBets.dontPass || 0)}
                  onClick={() => placeBet('dontPass')}
                  disabled={!bettingOpen || gamePhase === 'point'}
                  style={{ height: '50px', fontSize: '9px', marginBottom: '5px' }}
                />
                {gamePhase === 'point' && activeBets.dontPass > 0 && (
                  <CrapsBetArea 
                    label="ODDS" 
                    value={currentBets.dontPassOdds + (activeBets.dontPassOdds || 0)}
                    onClick={() => placeBet('dontPassOdds')}
                    disabled={!bettingOpen}
                    style={{ 
                      height: '30px',
                      fontSize: '9px',
                      background: currentBets.dontPassOdds + (activeBets.dontPassOdds || 0) > 0 ? '#ff5722' : 'rgba(255, 87, 34, 0.2)',
                      border: '2px solid #ff5722'
                    }}
                  />
                )}
              </div>
              <button
                onClick={() => setShowBuyLay(!showBuyLay)}
                style={{
                  background: showBuyLay ? '#d4af37' : 'rgba(212, 175, 55, 0.3)',
                  color: showBuyLay ? '#000' : '#d4af37',
                  border: '2px solid #d4af37',
                  fontSize: '9px',
                  padding: '8px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontWeight: 'bold'
                }}
              >
                BUY/LAY
              </button>
            </div>

            {/* Center - Point Boxes and Field */}
            <div>
              {/* Buy/Lay Bets Overlay */}
              {showBuyLay && (
                <div style={{
                  marginBottom: '12px',
                  padding: '12px',
                  background: 'rgba(212, 175, 55, 0.1)',
                  border: '2px solid #d4af37',
                  borderRadius: '8px'
                }}>
                  <div style={{ fontSize: '9px', color: '#d4af37', marginBottom: '8px', fontWeight: 'bold' }}>
                    BUY BETS (True Odds -5%)
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(3, 1fr)' : 'repeat(6, 1fr)', gap: isMobile ? '4px' : '6px', marginBottom: '10px' }}>
                    <CrapsBetArea label="BUY 4" value={currentBets.buy4 + (activeBets.buy4 || 0)} onClick={() => placeBet('buy4')} disabled={!bettingOpen} style={{ fontSize: '8px' }} />
                    <CrapsBetArea label="BUY 5" value={currentBets.buy5 + (activeBets.buy5 || 0)} onClick={() => placeBet('buy5')} disabled={!bettingOpen} style={{ fontSize: '8px' }} />
                    <CrapsBetArea label="BUY 6" value={currentBets.buy6 + (activeBets.buy6 || 0)} onClick={() => placeBet('buy6')} disabled={!bettingOpen} style={{ fontSize: '8px' }} />
                    <CrapsBetArea label="BUY 8" value={currentBets.buy8 + (activeBets.buy8 || 0)} onClick={() => placeBet('buy8')} disabled={!bettingOpen} style={{ fontSize: '8px' }} />
                    <CrapsBetArea label="BUY 9" value={currentBets.buy9 + (activeBets.buy9 || 0)} onClick={() => placeBet('buy9')} disabled={!bettingOpen} style={{ fontSize: '8px' }} />
                    <CrapsBetArea label="BUY 10" value={currentBets.buy10 + (activeBets.buy10 || 0)} onClick={() => placeBet('buy10')} disabled={!bettingOpen} style={{ fontSize: '8px' }} />
                  </div>
                  <div style={{ fontSize: '9px', color: '#d4af37', marginBottom: '8px', fontWeight: 'bold' }}>
                    LAY BETS (Bet on 7 -5%)
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(3, 1fr)' : 'repeat(6, 1fr)', gap: isMobile ? '4px' : '6px' }}>
                    <CrapsBetArea label="LAY 4" value={currentBets.lay4 + (activeBets.lay4 || 0)} onClick={() => placeBet('lay4')} disabled={!bettingOpen} style={{ fontSize: '8px' }} />
                    <CrapsBetArea label="LAY 5" value={currentBets.lay5 + (activeBets.lay5 || 0)} onClick={() => placeBet('lay5')} disabled={!bettingOpen} style={{ fontSize: '8px' }} />
                    <CrapsBetArea label="LAY 6" value={currentBets.lay6 + (activeBets.lay6 || 0)} onClick={() => placeBet('lay6')} disabled={!bettingOpen} style={{ fontSize: '8px' }} />
                    <CrapsBetArea label="LAY 8" value={currentBets.lay8 + (activeBets.lay8 || 0)} onClick={() => placeBet('lay8')} disabled={!bettingOpen} style={{ fontSize: '8px' }} />
                    <CrapsBetArea label="LAY 9" value={currentBets.lay9 + (activeBets.lay9 || 0)} onClick={() => placeBet('lay9')} disabled={!bettingOpen} style={{ fontSize: '8px' }} />
                    <CrapsBetArea label="LAY 10" value={currentBets.lay10 + (activeBets.lay10 || 0)} onClick={() => placeBet('lay10')} disabled={!bettingOpen} style={{ fontSize: '8px' }} />
                  </div>
                </div>
              )}

              {/* Place Bets / Crapless Numbers */}
              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: gameMode === 'crapless' ? (isMobile ? 'repeat(5, 1fr)' : 'repeat(10, 1fr)') : (isMobile ? 'repeat(3, 1fr)' : 'repeat(6, 1fr)'),
                gap: '8px',
                marginBottom: '12px'
              }}>
                {gameMode === 'crapless' && (
                  <>
                    <CrapsBetArea 
                      label="2" 
                      value={currentBets.craplessPlace2 + (activeBets.craplessPlace2 || 0)}
                      onClick={() => placeBet('craplessPlace2')}
                      disabled={!bettingOpen}
                      style={{ fontSize: '16px', fontWeight: 'bold', height: '55px' }}
                    />
                    <CrapsBetArea 
                      label="3" 
                      value={currentBets.craplessPlace3 + (activeBets.craplessPlace3 || 0)}
                      onClick={() => placeBet('craplessPlace3')}
                      disabled={!bettingOpen}
                      style={{ fontSize: '16px', fontWeight: 'bold', height: '55px' }}
                    />
                  </>
                )}
                <CrapsBetArea 
                  label="4" 
                  value={currentBets.place4 + (activeBets.place4 || 0)}
                  onClick={() => placeBet('place4')}
                  disabled={!bettingOpen}
                  style={{ 
                    fontSize: '18px', 
                    fontWeight: 'bold', 
                    height: '55px',
                    background: point === 4 ? '#ff9800' : (currentBets.place4 + (activeBets.place4 || 0) > 0 ? '#d4af37' : 'transparent')
                  }}
                />
                <CrapsBetArea 
                  label="5" 
                  value={currentBets.place5 + (activeBets.place5 || 0)}
                  onClick={() => placeBet('place5')}
                  disabled={!bettingOpen}
                  style={{ 
                    fontSize: '18px', 
                    fontWeight: 'bold', 
                    height: '55px',
                    background: point === 5 ? '#ff9800' : (currentBets.place5 + (activeBets.place5 || 0) > 0 ? '#d4af37' : 'transparent')
                  }}
                />
                <CrapsBetArea 
                  label="6" 
                  value={currentBets.place6 + (activeBets.place6 || 0)}
                  onClick={() => placeBet('place6')}
                  disabled={!bettingOpen}
                  style={{ 
                    fontSize: '18px', 
                    fontWeight: 'bold', 
                    height: '55px',
                    background: point === 6 ? '#ff9800' : (currentBets.place6 + (activeBets.place6 || 0) > 0 ? '#d4af37' : 'transparent')
                  }}
                />
                <CrapsBetArea 
                  label="8" 
                  value={currentBets.place8 + (activeBets.place8 || 0)}
                  onClick={() => placeBet('place8')}
                  disabled={!bettingOpen}
                  style={{ 
                    fontSize: '18px', 
                    fontWeight: 'bold', 
                    height: '55px',
                    background: point === 8 ? '#ff9800' : (currentBets.place8 + (activeBets.place8 || 0) > 0 ? '#d4af37' : 'transparent')
                  }}
                />
                <CrapsBetArea 
                  label="9" 
                  value={currentBets.place9 + (activeBets.place9 || 0)}
                  onClick={() => placeBet('place9')}
                  disabled={!bettingOpen}
                  style={{ 
                    fontSize: '18px', 
                    fontWeight: 'bold', 
                    height: '55px',
                    background: point === 9 ? '#ff9800' : (currentBets.place9 + (activeBets.place9 || 0) > 0 ? '#d4af37' : 'transparent')
                  }}
                />
                <CrapsBetArea 
                  label="10" 
                  value={currentBets.place10 + (activeBets.place10 || 0)}
                  onClick={() => placeBet('place10')}
                  disabled={!bettingOpen}
                  style={{ 
                    fontSize: '18px', 
                    fontWeight: 'bold', 
                    height: '55px',
                    background: point === 10 ? '#ff9800' : (currentBets.place10 + (activeBets.place10 || 0) > 0 ? '#d4af37' : 'transparent')
                  }}
                />
                {gameMode === 'crapless' && (
                  <>
                    <CrapsBetArea 
                      label="11" 
                      value={currentBets.craplessPlace11 + (activeBets.craplessPlace11 || 0)}
                      onClick={() => placeBet('craplessPlace11')}
                      disabled={!bettingOpen}
                      style={{ fontSize: '16px', fontWeight: 'bold', height: '55px' }}
                    />
                    <CrapsBetArea 
                      label="12" 
                      value={currentBets.craplessPlace12 + (activeBets.craplessPlace12 || 0)}
                      onClick={() => placeBet('craplessPlace12')}
                      disabled={!bettingOpen}
                      style={{ fontSize: '16px', fontWeight: 'bold', height: '55px' }}
                    />
                  </>
                )}
              </div>

              {/* COME area */}
              <CrapsBetArea 
                label="COME" 
                value={currentBets.come + (activeBets.come || 0)}
                onClick={() => placeBet('come')}
                disabled={!bettingOpen || gamePhase === 'come-out'}
                style={{ 
                  height: '60px', 
                  marginBottom: '12px',
                  background: currentBets.come + (activeBets.come || 0) > 0 ? '#d4af37' : 'rgba(255,255,255,0.1)',
                  border: '3px solid #fff',
                  fontSize: '12px'
                }}
              />

              {/* Field */}
              <CrapsBetArea 
                label="FIELD • 2 3 4 9 10 11 12 • (2:1 on 2,12)" 
                value={currentBets.field + (activeBets.field || 0)}
                onClick={() => placeBet('field')}
                disabled={!bettingOpen}
                style={{ 
                  height: '50px',
                  background: currentBets.field + (activeBets.field || 0) > 0 ? '#d4af37' : 'rgba(255,255,255,0.15)',
                  border: '3px solid #fff',
                  fontSize: '10px'
                }}
              />
            </div>

            {/* Right - Don't Come and Fire Bet */}
            <div style={{ display: 'grid', gap: '10px' }}>
              <CrapsBetArea 
                label="DON'T COME" 
                value={currentBets.dontCome + (activeBets.dontCome || 0)}
                onClick={() => placeBet('dontCome')}
                disabled={!bettingOpen || gamePhase === 'come-out'}
                style={{ height: '60px', fontSize: '9px' }}
              />
              
              {/* Big 6/8 */}
              <div style={{ display: 'grid', gap: '6px' }}>
                <CrapsBetArea 
                  label="BIG 6" 
                  value={currentBets.big6 + (activeBets.big6 || 0)}
                  onClick={() => placeBet('big6')}
                  disabled={!bettingOpen}
                  style={{ fontSize: '10px', background: currentBets.big6 + (activeBets.big6 || 0) > 0 ? '#d4af37' : 'rgba(255,255,255,0.1)' }}
                />
                <CrapsBetArea 
                  label="BIG 8" 
                  value={currentBets.big8 + (activeBets.big8 || 0)}
                  onClick={() => placeBet('big8')}
                  disabled={!bettingOpen}
                  style={{ fontSize: '10px', background: currentBets.big8 + (activeBets.big8 || 0) > 0 ? '#d4af37' : 'rgba(255,255,255,0.1)' }}
                />
              </div>
              
              {/* Fire Bet Section */}
              <div style={{
                background: 'rgba(255, 0, 0, 0.2)',
                border: '2px solid #ff4444',
                borderRadius: '8px',
                padding: '10px'
              }}>
                <div style={{ 
                  fontSize: '9px', 
                  fontWeight: 'bold', 
                  color: '#ff6666',
                  marginBottom: '8px',
                  textAlign: 'center',
                  letterSpacing: '1px'
                }}>
                  🔥 FIRE BET 🔥
                </div>
                <div style={{ display: 'grid', gap: '6px' }}>
                  <CrapsBetArea 
                    label="SMALL" 
                    value={currentBets.small + (activeBets.small || 0)}
                    onClick={() => placeBet('small')}
                    disabled={!bettingOpen}
                    style={{ 
                      fontSize: '9px',
                      background: currentBets.small + (activeBets.small || 0) > 0 ? '#ff4444' : 'rgba(255,68,68,0.2)',
                      color: currentBets.small + (activeBets.small || 0) > 0 ? '#000' : '#fff',
                      border: '2px solid #ff6666'
                    }}
                  />
                  <CrapsBetArea 
                    label="TALL" 
                    value={currentBets.tall + (activeBets.tall || 0)}
                    onClick={() => placeBet('tall')}
                    disabled={!bettingOpen}
                    style={{ 
                      fontSize: '9px',
                      background: currentBets.tall + (activeBets.tall || 0) > 0 ? '#ff4444' : 'rgba(255,68,68,0.2)',
                      color: currentBets.tall + (activeBets.tall || 0) > 0 ? '#000' : '#fff',
                      border: '2px solid #ff6666'
                    }}
                  />
                  <CrapsBetArea 
                    label="ALL" 
                    value={currentBets.all + (activeBets.all || 0)}
                    onClick={() => placeBet('all')}
                    disabled={!bettingOpen}
                    style={{ 
                      fontSize: '9px',
                      background: currentBets.all + (activeBets.all || 0) > 0 ? '#ff4444' : 'rgba(255,68,68,0.2)',
                      color: currentBets.all + (activeBets.all || 0) > 0 ? '#000' : '#fff',
                      border: '2px solid #ff6666'
                    }}
                  />
                </div>
              </div>
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
              {Object.entries(activeBets).filter(([_, v]) => v > 0).map(([key, amount]) => (
                <div key={'locked-' + key} style={{
                  background: 'rgba(212, 175, 55, 0.15)',
                  border: '1px solid rgba(212, 175, 55, 0.3)',
                  borderRadius: '20px',
                  padding: '5px 12px',
                  fontSize: '11px',
                  color: '#d4af37'
                }}>
                  🔒 {key.replace(/([A-Z])/g, ' $1').replace(/-/g, ' ').trim()} <span style={{ fontWeight: 'bold' }}>${amount}</span>
                </div>
              ))}
              {Object.entries(currentBets).filter(([_, v]) => v > 0).map(([key, amount]) => (
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
                  ✕ {key.replace(/([A-Z])/g, ' $1').replace(/-/g, ' ').trim()} <span style={{ fontWeight: 'bold' }}>${amount}</span>
                </div>
              ))}
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
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '15px' }}>
            <div>
              <div style={{ fontSize: '9px', color: '#888', marginBottom: '4px' }}>Total Wagered</div>
              <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#fff' }}>
                ${sessionStats.totalWagered.toLocaleString()}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '9px', color: '#888', marginBottom: '4px' }}>Biggest Win (Roll)</div>
              <div style={{ fontSize: '16px', fontWeight: 'bold', color: sessionStats.biggestWin > 0 ? '#4caf50' : '#888' }}>
                ${sessionStats.biggestWin.toLocaleString()}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '9px', color: '#888', marginBottom: '4px' }}>Total Rolls</div>
              <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#fff' }}>
                {sessionStats.totalRolls}
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

        {/* Roll History */}
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
            🎲 Roll History
          </div>
          {rollHistory.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '20px', color: '#666', fontSize: '11px' }}>
              No rolls yet
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {rollHistory.map((roll, idx) => (
                <div key={idx} style={{
                  padding: '8px 12px',
                  background: 'rgba(0,0,0,0.3)',
                  borderRadius: '6px',
                  border: `1px solid ${roll.winnings > 0 ? '#4caf50' : roll.winnings < 0 ? '#f44336' : '#555'}`,
                  fontSize: '11px'
                }}>
                  <div style={{ display: 'flex', gap: '4px', marginBottom: '4px' }}>
                    <div style={{
                      width: '18px',
                      height: '18px',
                      background: '#fff',
                      borderRadius: '3px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '10px',
                      fontWeight: 'bold',
                      color: '#000'
                    }}>
                      {roll.dice1}
                    </div>
                    <div style={{
                      width: '18px',
                      height: '18px',
                      background: '#fff',
                      borderRadius: '3px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '10px',
                      fontWeight: 'bold',
                      color: '#000'
                    }}>
                      {roll.dice2}
                    </div>
                  </div>
                  <div style={{ fontSize: '9px', color: '#888' }}>
                    {roll.total} • <span style={{ color: roll.winnings > 0 ? '#4caf50' : roll.winnings < 0 ? '#f44336' : '#888' }}>
                      {roll.winnings > 0 ? '+' : ''}{roll.winnings}
                    </span>
                  </div>
                </div>
              ))}
            </div>
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
                        padding: '6px 10px', background: 'rgba(212, 175, 55, 0.2)',
                        borderRadius: '6px', border: '1px solid #d4af37'
                      }}>
                        <span style={{ fontSize: '16px', fontWeight: 'bold', color: '#d4af37' }}>
                          {entry.dice ? `${entry.dice[0]}+${entry.dice[1]}=${entry.total}` : '?'}
                        </span>
                      </div>
                      <div>
                        <div style={{ fontSize: '11px', color: '#888' }}>Roll #{entry.round}</div>
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

        {/* User Settings Panel (Players Only) */}
        {false && (
          <div style={{
            background: 'linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)',
            border: '2px solid #d4af37',
            borderRadius: '12px',
            padding: '25px',
            marginBottom: '20px'
          }}>
            <div style={{
              fontSize: '13px',
              letterSpacing: '2px',
              textTransform: 'uppercase',
              color: '#d4af37',
              marginBottom: '20px',
              fontWeight: 'bold',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              <Settings size={16} />
              PLAYER SETTINGS
            </div>
            
            {/* Account Info */}
            <div style={{
              background: 'rgba(212, 175, 55, 0.1)',
              padding: '15px',
              borderRadius: '8px',
              marginBottom: '20px',
              border: '1px solid rgba(212, 175, 55, 0.2)'
            }}>
              <div style={{ fontSize: '10px', color: '#888', marginBottom: '8px' }}>
                YOUR ACCOUNT
              </div>
              <div style={{ fontSize: '16px', color: '#fff', fontWeight: 'bold', marginBottom: '5px' }}>
                {userName}
              </div>
              <div style={{ fontSize: '12px', color: '#d4af37' }}>
                Balance: ${Math.round(bankroll).toLocaleString()}
              </div>
            </div>
            
            {/* Quick Stats */}
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
            
            {/* Reset Stats Button */}
            <button
              onClick={() => {
                if (confirm('Reset your session stats? Your bankroll will not be affected.')) {
                  setSessionStats({
                    totalWagered: 0,
                    biggestWin: 0,
                    totalRolls: 0,
                    startingBankroll: bankroll
                  });
                  saveUserData({ sessionStats: {
                    totalWagered: 0,
                    biggestWin: 0,
                    totalRolls: 0,
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
            
            {/* Info */}
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
              🎲 DEALER CONTROLS
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
              
              {/* Starting Chips Setting */}
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
              
              {/* Bonus Chips Distribution */}
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
                    ? `Give $${bonusChipsAmount.toLocaleString()} to All Players`
                    : `Give $${bonusChipsAmount.toLocaleString()} to Selected Player`
                  }
                </button>
              </div>
            </div>
            
            {/* Game Mode Toggle */}
            <div style={{
              background: 'rgba(0, 0, 0, 0.3)',
              padding: '15px',
              borderRadius: '8px',
              marginBottom: '15px'
            }}>
              <div style={{ fontSize: '11px', color: '#888', marginBottom: '10px' }}>
                Game Mode
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  onClick={async () => { setGameMode('standard'); await updateGameState({ gameMode: 'standard' }); }}
                  style={{
                    flex: 1,
                    padding: '12px',
                    background: gameMode === 'standard' ? '#9c27b0' : 'rgba(156, 39, 176, 0.2)',
                    border: '1px solid #9c27b0',
                    borderRadius: '6px',
                    color: gameMode === 'standard' ? '#fff' : '#ce93d8',
                    fontSize: '12px',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    fontFamily: 'inherit'
                  }}
                >
                  Standard Craps
                </button>
                <button
                  onClick={async () => { setGameMode('crapless'); await updateGameState({ gameMode: 'crapless' }); }}
                  style={{
                    flex: 1,
                    padding: '12px',
                    background: gameMode === 'crapless' ? '#9c27b0' : 'rgba(156, 39, 176, 0.2)',
                    border: '1px solid #9c27b0',
                    borderRadius: '6px',
                    color: gameMode === 'crapless' ? '#fff' : '#ce93d8',
                    fontSize: '12px',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    fontFamily: 'inherit'
                  }}
                >
                  Crapless Craps
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
                      background: countdownDuration === sec ? '#9c27b0' : 'rgba(0,0,0,0.3)',
                      border: `1px solid ${countdownDuration === sec ? '#9c27b0' : '#555'}`,
                      borderRadius: '6px', color: '#fff', fontSize: '11px', fontWeight: 'bold',
                      cursor: 'pointer', fontFamily: 'inherit'
                    }}>
                    {sec}s
                  </button>
                ))}
              </div>
            </div>
            
            {/* Dice Entry */}
            <div style={{
              background: 'rgba(0, 0, 0, 0.3)',
              padding: '18px',
              borderRadius: '8px',
              marginBottom: '15px'
            }}>
              <div style={{ fontSize: '11px', color: '#888', marginBottom: '8px' }}>
                Quick Pick Dice — tap each die, then ROLL
              </div>
              <div style={{ display: 'flex', gap: '15px', marginBottom: '12px' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '12px', color: '#888', marginBottom: '8px', textAlign: 'center', fontWeight: 'bold', letterSpacing: '2px' }}>DIE 1</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                    {[1,2,3,4,5,6].map(n => (
                      <button key={`d1-${n}`} onClick={() => setAdminDice1(String(n))}
                        style={{
                          padding: '18px 0', borderRadius: '8px', fontSize: '32px', fontWeight: 'bold',
                          background: adminDice1 === String(n) ? '#d4af37' : 'rgba(156,39,176,0.3)',
                          color: adminDice1 === String(n) ? '#000' : '#fff',
                          border: adminDice1 === String(n) ? '2px solid #d4af37' : '1px solid #9c27b0',
                          cursor: 'pointer', fontFamily: 'inherit'
                        }}>
                        {['⚀','⚁','⚂','⚃','⚄','⚅'][n-1]}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '12px', color: '#888', marginBottom: '8px', textAlign: 'center', fontWeight: 'bold', letterSpacing: '2px' }}>DIE 2</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                    {[1,2,3,4,5,6].map(n => (
                      <button key={`d2-${n}`} onClick={() => setAdminDice2(String(n))}
                        style={{
                          padding: '18px 0', borderRadius: '8px', fontSize: '32px', fontWeight: 'bold',
                          background: adminDice2 === String(n) ? '#d4af37' : 'rgba(156,39,176,0.3)',
                          color: adminDice2 === String(n) ? '#000' : '#fff',
                          border: adminDice2 === String(n) ? '2px solid #d4af37' : '1px solid #9c27b0',
                          cursor: 'pointer', fontFamily: 'inherit'
                        }}>
                        {['⚀','⚁','⚂','⚃','⚄','⚅'][n-1]}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              {adminDice1 && adminDice2 && (
                <div style={{ textAlign: 'center', marginBottom: '10px', fontSize: '14px', color: '#d4af37', fontWeight: 'bold' }}>
                  Total: {parseInt(adminDice1) + parseInt(adminDice2)}
                </div>
              )}
              <div style={{ fontSize: '11px', color: '#888', marginBottom: '12px', display: 'none' }}>
                Enter Roll Result (hidden, using quick pick above)
              </div>
              <div style={{ display: 'flex', gap: '10px', marginBottom: '12px' }}>
                <input
                  type="number"
                  min="1"
                  max="6"
                  value={adminDice1}
                  onChange={(e) => setAdminDice1(e.target.value)}
                  placeholder="Die 1"
                  style={{
                    flex: 1,
                    padding: '14px',
                    background: 'rgba(255, 255, 255, 0.1)',
                    border: '2px solid #9c27b0',
                    borderRadius: '8px',
                    color: '#fff',
                    fontSize: '18px',
                    textAlign: 'center',
                    fontFamily: 'inherit',
                    fontWeight: 'bold'
                  }}
                />
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  color: '#ce93d8',
                  fontSize: '20px'
                }}>
                  +
                </div>
                <input
                  type="number"
                  min="1"
                  max="6"
                  value={adminDice2}
                  onChange={(e) => setAdminDice2(e.target.value)}
                  placeholder="Die 2"
                  style={{
                    flex: 1,
                    padding: '14px',
                    background: 'rgba(255, 255, 255, 0.1)',
                    border: '2px solid #9c27b0',
                    borderRadius: '8px',
                    color: '#fff',
                    fontSize: '18px',
                    textAlign: 'center',
                    fontFamily: 'inherit',
                    fontWeight: 'bold'
                  }}
                />
                {adminDice1 && adminDice2 && (
                  <>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      color: '#ce93d8',
                      fontSize: '20px'
                    }}>
                      =
                    </div>
                    <div style={{
                      width: '60px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '24px',
                      fontWeight: 'bold',
                      color: '#d4af37'
                    }}>
                      {parseInt(adminDice1) + parseInt(adminDice2)}
                    </div>
                  </>
                )}
              </div>
              <button
                onClick={adminSubmitRoll}
                disabled={!adminDice1 || !adminDice2}
                style={{
                  width: '100%',
                  padding: '14px',
                  background: adminDice1 && adminDice2
                    ? 'linear-gradient(135deg, #9c27b0, #ba68c8)'
                    : '#333',
                  border: 'none',
                  borderRadius: '8px',
                  color: adminDice1 && adminDice2 ? '#fff' : '#666',
                  fontSize: '13px',
                  fontWeight: 'bold',
                  cursor: adminDice1 && adminDice2 ? 'pointer' : 'not-allowed',
                  fontFamily: 'inherit',
                  letterSpacing: '2px',
                  textTransform: 'uppercase'
                }}
              >
                Submit Roll
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
              <div>Mode: <span style={{ color: '#ce93d8' }}>{gameMode === 'standard' ? 'Standard' : 'Crapless'}</span></div>
              <div>Phase: <span style={{ color: '#ff9800' }}>{gamePhase === 'come-out' ? 'Come Out' : 'Point'}</span></div>
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
        
        input[type="number"]::-webkit-inner-spin-button,
        input[type="number"]::-webkit-outer-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
      `}</style>
    </div>
  );
};

export default CrapsGame;
