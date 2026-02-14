import React, { useState, useEffect } from 'react';
import { Users, Timer, Crown, Trophy, Settings, ArrowLeft } from 'lucide-react';

const RouletteGame = ({ onBack }) => {
  // User state
  const [userId] = useState(() => `user_${Math.random().toString(36).substr(2, 9)}`);
  const [userName, setUserName] = useState('');
  const [isRegistered, setIsRegistered] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  
  // Game state
  const [spinResult, setSpinResult] = useState(null);
  const [isSpinning, setIsSpinning] = useState(false);
  const [roundNumber, setRoundNumber] = useState(0);
  const [bettingOpen, setBettingOpen] = useState(true);
  const [countdown, setCountdown] = useState(15);
  const [spinHistory, setSpinHistory] = useState([]);
  
  // User bankroll and bets
  const [bankroll, setBankroll] = useState(1000);
  const [selectedChip, setSelectedChip] = useState(5);
  const [currentBets, setCurrentBets] = useState({});
  const [activeBets, setActiveBets] = useState({});
  
  // UI State
  const [sessionStats, setSessionStats] = useState({
    totalWagered: 0,
    biggestWin: 0,
    totalSpins: 0,
    startingBankroll: 1000
  });
  
  // Leaderboard
  const [leaderboard, setLeaderboard] = useState([]);
  
  // Admin state
  const [adminNumber, setAdminNumber] = useState('');
  const [activeUsers, setActiveUsers] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  
  // Chat
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');

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

  // Load game state
  useEffect(() => {
    loadGameState();
    loadLeaderboard();
    loadUserData();
    loadChatMessages();
    
    const interval = setInterval(() => {
      loadGameState();
      loadLeaderboard();
      loadChatMessages();
    }, 2000);
    
    return () => clearInterval(interval);
  }, []);

  // Countdown timer
  useEffect(() => {
    if (bettingOpen && countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    } else if (countdown === 0) {
      setBettingOpen(false);
    }
  }, [countdown, bettingOpen]);

  const loadGameState = async () => {
    try {
      const state = await window.storage.get('roulette-game-state', true);
      if (state) {
        const data = JSON.parse(state.value);
        setSpinResult(data.spinResult || null);
        setRoundNumber(data.roundNumber || 0);
        setBettingOpen(data.bettingOpen !== undefined ? data.bettingOpen : true);
        setCountdown(data.countdown || 15);
        setSpinHistory(data.spinHistory || []);
        setIsSpinning(data.isSpinning || false);
      }
    } catch (e) {
      // Initialize if not exists
    }
  };

  const saveGameState = async (updates) => {
    const state = {
      spinResult,
      roundNumber,
      bettingOpen,
      countdown,
      spinHistory,
      isSpinning,
      ...updates
    };
    await window.storage.set('roulette-game-state', JSON.stringify(state), true);
  };

  const loadLeaderboard = async () => {
    try {
      const result = await window.storage.get('roulette-leaderboard', true);
      if (result) {
        setLeaderboard(JSON.parse(result.value));
      }
    } catch (e) {
      setLeaderboard([]);
    }
  };

  const loadUserData = async () => {
    try {
      const userData = await window.storage.get(`roulette-user-${userId}`);
      if (userData) {
        const data = JSON.parse(userData.value);
        setUserName(data.name);
        setBankroll(data.bankroll);
        setIsRegistered(true);
        setActiveBets(data.activeBets || {});
        setSessionStats(data.sessionStats || {
          totalWagered: 0,
          biggestWin: 0,
          totalSpins: 0,
          startingBankroll: 1000
        });
      }
    } catch (e) {
      // User not registered
    }
  };

  const saveUserData = async (updates) => {
    const userData = {
      name: userName,
      bankroll,
      activeBets,
      userId,
      lastActive: Date.now(),
      sessionStats,
      ...updates
    };
    await window.storage.set(`roulette-user-${userId}`, JSON.stringify(userData));
  };

  const updateLeaderboard = async (newBankroll) => {
    try {
      const current = await window.storage.get('roulette-leaderboard', true);
      let leaders = current ? JSON.parse(current.value) : [];
      
      leaders = leaders.filter(l => l.userId !== userId);
      leaders.push({
        userId,
        name: userName,
        bankroll: newBankroll,
        timestamp: Date.now()
      });
      
      leaders.sort((a, b) => b.bankroll - a.bankroll);
      leaders = leaders.slice(0, 10);
      
      await window.storage.set('roulette-leaderboard', JSON.stringify(leaders), true);
      setLeaderboard(leaders);
    } catch (e) {
      console.error('Failed to update leaderboard:', e);
    }
  };

  const registerUser = async () => {
    if (userName.trim()) {
      setIsRegistered(true);
      await saveUserData({ name: userName, bankroll: 1000 });
      await updateLeaderboard(1000);
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
    
    const newBankroll = bankroll - totalBet;
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
    await updateLeaderboard(newBankroll);
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
    
    const newBankroll = bankroll + winnings;
    setBankroll(newBankroll);
    setActiveBets(newActiveBets);
    
    const newHistory = [{ number: numStr, color }, ...spinHistory.slice(0, 19)];
    setSpinHistory(newHistory);
    
    const newStats = {
      ...sessionStats,
      totalSpins: sessionStats.totalSpins + 1,
      biggestWin: Math.max(sessionStats.biggestWin, spinWinnings)
    };
    setSessionStats(newStats);
    
    await saveUserData({ bankroll: newBankroll, activeBets: newActiveBets, sessionStats: newStats });
    await updateLeaderboard(newBankroll);
  };

  const adminSpin = async () => {
    if (!adminNumber) return;
    
    setIsSpinning(true);
    await saveGameState({ isSpinning: true, bettingOpen: false });
    
    setTimeout(async () => {
      await resolveSpin(adminNumber);
      setSpinResult(adminNumber);
      setIsSpinning(false);
      setRoundNumber(roundNumber + 1);
      
      await saveGameState({
        spinResult: adminNumber,
        roundNumber: roundNumber + 1,
        isSpinning: false,
        spinHistory: [{ number: adminNumber, color: getNumberColor(adminNumber) }, ...spinHistory.slice(0, 19)]
      });
      
      setAdminNumber('');
    }, 3000);
  };

  const adminNewRound = async () => {
    setSpinResult(null);
    setBettingOpen(true);
    setCountdown(15);
    setIsSpinning(false);
    
    await saveGameState({
      spinResult: null,
      bettingOpen: true,
      countdown: 15,
      isSpinning: false
    });
  };

  const adminResetSession = async () => {
    if (confirm('Reset entire session? This will clear all user data.')) {
      try {
        await window.storage.set('roulette-game-state', JSON.stringify({
          spinResult: null,
          roundNumber: 0,
          bettingOpen: true,
          countdown: 15,
          spinHistory: [],
          isSpinning: false
        }), true);
        
        await window.storage.set('roulette-leaderboard', JSON.stringify([]), true);
        
        setSpinResult(null);
        setRoundNumber(0);
        setBettingOpen(true);
        setCountdown(15);
        setSpinHistory([]);
        setBankroll(1000);
        clearAllBets();
        setActiveBets({});
        setSessionStats({
          totalWagered: 0,
          biggestWin: 0,
          totalSpins: 0,
          startingBankroll: 1000
        });
        
        await saveUserData({ 
          bankroll: 1000, 
          activeBets: {},
          sessionStats: {
            totalWagered: 0,
            biggestWin: 0,
            totalSpins: 0,
            startingBankroll: 1000
          }
        });
      } catch (e) {
        console.error('Reset failed:', e);
      }
    }
  };

  // Chat functionality
  const sendChatMessage = async () => {
    if (!chatInput.trim()) return;
    
    const message = {
      userId,
      userName,
      text: chatInput,
      timestamp: Date.now()
    };
    
    try {
      const current = await window.storage.get('roulette-chat-messages', true);
      let messages = current ? JSON.parse(current.value) : [];
      messages.push(message);
      messages = messages.slice(-50);
      await window.storage.set('roulette-chat-messages', JSON.stringify(messages), true);
      setChatMessages(messages);
      setChatInput('');
    } catch (e) {
      console.error('Chat error:', e);
    }
  };

  const loadChatMessages = async () => {
    try {
      const result = await window.storage.get('roulette-chat-messages', true);
      if (result) {
        setChatMessages(JSON.parse(result.value));
      }
    } catch (e) {
      setChatMessages([]);
    }
  };

  useEffect(() => {
    setActiveUsers(leaderboard.length);
  }, [leaderboard]);

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
          
          <div style={{ textAlign: 'center', marginTop: '25px' }}>
            <label style={{
              color: '#888',
              fontSize: '10px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px'
            }}>
              <input
                type="checkbox"
                checked={isAdmin}
                onChange={(e) => setIsAdmin(e.target.checked)}
                style={{ accentColor: '#8b0000' }}
              />
              Dealer Access
            </label>
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
          padding: '20px 15px',
          textAlign: 'center',
          cursor: bettingOpen ? 'pointer' : 'not-allowed',
          position: 'relative',
          opacity: bettingOpen ? 1 : 0.5,
          transition: 'all 0.2s'
        }}
      >
        <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#fff', letterSpacing: '1px' }}>
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
        padding: '12px 20px',
        background: 'linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)',
        borderBottom: '3px solid #8b0000',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        position: 'sticky',
        top: 0,
        zIndex: 1000
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#8b0000', letterSpacing: '2px' }}>
            🎰 ROULETTE
          </div>
          <div style={{ fontSize: '11px', color: '#888' }}>
            {userName} | <span style={{ color: '#8b0000' }}>${bankroll.toLocaleString()}</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          {onBack && (
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
          {isAdmin && (
            <button
              onClick={() => setShowSettings(!showSettings)}
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
              <Settings size={14} /> DEALER
            </button>
          )}
        </div>
      </div>

      {/* Main Container */}
      <div style={{ maxWidth: '1400px', margin: '20px auto', padding: '0 20px' }}>
        
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
          border: '8px solid #8b4513',
          borderRadius: '20px',
          padding: '30px',
          boxShadow: 'inset 0 0 50px rgba(0,0,0,0.5), 0 10px 40px rgba(0,0,0,0.8)',
          marginBottom: '20px'
        }}>
          
          {/* Number Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '20px', marginBottom: '20px' }}>
            {/* 0 and 00 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <NumberButton number="0" />
              <NumberButton number="00" />
            </div>
            
            {/* Main Grid */}
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: '8px', marginBottom: '15px' }}>
                {[3,6,9,12,15,18,21,24,27,30,33,36].map(num => <NumberButton key={num} number={num.toString()} />)}
                {[2,5,8,11,14,17,20,23,26,29,32,35].map(num => <NumberButton key={num} number={num.toString()} />)}
                {[1,4,7,10,13,16,19,22,25,28,31,34].map(num => <NumberButton key={num} number={num.toString()} />)}
              </div>
              
              {/* Column Bets */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                <OutsideBetButton label="2 to 1" betType="column" betValue="3" />
                <OutsideBetButton label="2 to 1" betType="column" betValue="2" />
                <OutsideBetButton label="2 to 1" betType="column" betValue="1" />
              </div>
            </div>
          </div>

          {/* Outside Bets */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '10px', marginBottom: '15px' }}>
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

        {/* Chip Selector and Controls */}
        <div style={{
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
                  width: '70px',
                  height: '70px',
                  borderRadius: '50%',
                  border: selectedChip === value ? '4px solid #8b0000' : '3px solid #555',
                  background: bankroll >= value
                    ? value <= 25 ? '#ff4444'
                    : value <= 100 ? '#4caf50'
                    : '#000'
                    : '#333',
                  color: bankroll >= value ? '#fff' : '#666',
                  fontSize: '16px',
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
              Confirm (${Object.values(currentBets).reduce((s, v) => s + v, 0)})
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
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '15px' }}>
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
              <div style={{ fontSize: '9px', color: '#888', marginBottom: '4px' }}>Total Spins</div>
              <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#fff' }}>
                {sessionStats.totalSpins}
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
              Top Players
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
                  ${player.bankroll.toLocaleString()}
                </div>
              </div>
            ))
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
                  padding: '8px',
                  background: msg.userId === userId ? 'rgba(139, 0, 0, 0.1)' : 'rgba(255,255,255,0.05)',
                  borderRadius: '6px',
                  borderLeft: `3px solid ${msg.userId === userId ? '#8b0000' : '#555'}`
                }}>
                  <div style={{ fontSize: '10px', color: msg.userId === userId ? '#8b0000' : '#888', marginBottom: '4px' }}>
                    {msg.userName}
                  </div>
                  <div style={{ fontSize: '12px', color: '#fff' }}>
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
                padding: '12px 20px',
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

        {/* Admin Controls */}
        {isAdmin && showSettings && (
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
            
            <div style={{
              background: 'rgba(0, 0, 0, 0.3)',
              padding: '18px',
              borderRadius: '8px',
              marginBottom: '15px'
            }}>
              <div style={{ fontSize: '11px', color: '#888', marginBottom: '12px' }}>
                Enter Number (0, 00, or 1-36)
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <input
                  type="text"
                  value={adminNumber}
                  onChange={(e) => setAdminNumber(e.target.value)}
                  placeholder="e.g., 17 or 00"
                  style={{
                    flex: 1,
                    padding: '12px',
                    background: 'rgba(255, 255, 255, 0.1)',
                    border: '2px solid #8b0000',
                    borderRadius: '8px',
                    color: '#fff',
                    fontSize: '16px',
                    textAlign: 'center',
                    fontFamily: 'inherit'
                  }}
                />
                <button
                  onClick={adminSpin}
                  disabled={!adminNumber || isSpinning}
                  style={{
                    padding: '12px 30px',
                    background: adminNumber && !isSpinning ? 'linear-gradient(135deg, #8b0000, #b30000)' : '#333',
                    border: 'none',
                    borderRadius: '8px',
                    color: '#fff',
                    fontSize: '13px',
                    fontWeight: 'bold',
                    cursor: adminNumber && !isSpinning ? 'pointer' : 'not-allowed',
                    fontFamily: 'inherit',
                    letterSpacing: '2px',
                    textTransform: 'uppercase'
                  }}
                >
                  {isSpinning ? 'SPINNING...' : 'SPIN'}
                </button>
              </div>
            </div>
            
            <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
              <button
                onClick={adminNewRound}
                disabled={!spinResult}
                style={{
                  flex: 1,
                  padding: '14px',
                  background: spinResult ? 'rgba(76, 175, 80, 0.3)' : '#333',
                  border: '1px solid #4caf50',
                  borderRadius: '8px',
                  color: spinResult ? '#4caf50' : '#666',
                  fontSize: '11px',
                  fontWeight: 'bold',
                  cursor: spinResult ? 'pointer' : 'not-allowed',
                  fontFamily: 'inherit',
                  textTransform: 'uppercase'
                }}
              >
                New Round
              </button>
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
              gridTemplateColumns: '1fr 1fr',
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
        
        button:active:not(:disabled) {
          transform: translateY(0);
        }
      `}</style>
    </div>
  );
};

export default RouletteGame;
