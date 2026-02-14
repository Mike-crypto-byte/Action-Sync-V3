import React, { useState, useEffect } from 'react';
import { Users, Timer, Crown, Trophy, Settings, ArrowLeft } from 'lucide-react';

const BaccaratGame = ({ onBack }) => {
  // User state
  const [userId] = useState(() => `user_${Math.random().toString(36).substr(2, 9)}`);
  const [userName, setUserName] = useState('');
  const [isRegistered, setIsRegistered] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  
  // Game state
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
  
  // History and stats
  const [roadmap, setRoadmap] = useState([]); // B, P, T tracking
  const [sessionStats, setSessionStats] = useState({
    totalWagered: 0,
    biggestWin: 0,
    totalRounds: 0,
    startingBankroll: 1000
  });
  
  // Leaderboard
  const [leaderboard, setLeaderboard] = useState([]);
  
  // Admin state
  const [adminPlayerCards, setAdminPlayerCards] = useState(['', '']);
  const [adminBankerCards, setAdminBankerCards] = useState(['', '']);
  const [adminPlayerThird, setAdminPlayerThird] = useState('');
  const [adminBankerThird, setAdminBankerThird] = useState('');
  const [activeUsers, setActiveUsers] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  
  // Chat
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');

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
      const state = await window.storage.get('baccarat-game-state', true);
      if (state) {
        const data = JSON.parse(state.value);
        setGamePhase(data.gamePhase || 'betting');
        setPlayerCards(data.playerCards || []);
        setBankerCards(data.bankerCards || []);
        setPlayerScore(data.playerScore || 0);
        setBankerScore(data.bankerScore || 0);
        setWinner(data.winner || null);
        setRoundNumber(data.roundNumber || 0);
        setBettingOpen(data.bettingOpen !== undefined ? data.bettingOpen : true);
        setCountdown(data.countdown || 15);
        setRoadmap(data.roadmap || []);
      }
    } catch (e) {
      // Initialize if not exists
    }
  };

  const saveGameState = async (updates) => {
    const state = {
      gamePhase,
      playerCards,
      bankerCards,
      playerScore,
      bankerScore,
      winner,
      roundNumber,
      bettingOpen,
      countdown,
      roadmap,
      ...updates
    };
    await window.storage.set('baccarat-game-state', JSON.stringify(state), true);
  };

  const loadLeaderboard = async () => {
    try {
      const result = await window.storage.get('baccarat-leaderboard', true);
      if (result) {
        setLeaderboard(JSON.parse(result.value));
      }
    } catch (e) {
      setLeaderboard([]);
    }
  };

  const loadUserData = async () => {
    try {
      const userData = await window.storage.get(`baccarat-user-${userId}`);
      if (userData) {
        const data = JSON.parse(userData.value);
        setUserName(data.name);
        setBankroll(data.bankroll);
        setIsRegistered(true);
        setActiveBets(data.activeBets || {});
        setSessionStats(data.sessionStats || {
          totalWagered: 0,
          biggestWin: 0,
          totalRounds: 0,
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
    await window.storage.set(`baccarat-user-${userId}`, JSON.stringify(userData));
  };

  const updateLeaderboard = async (newBankroll) => {
    try {
      const current = await window.storage.get('baccarat-leaderboard', true);
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
      
      await window.storage.set('baccarat-leaderboard', JSON.stringify(leaders), true);
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

  const resolveRound = async (pCards, bCards) => {
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
        const payout = newActiveBets.banker + (newActiveBets.banker * 0.95);
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
    
    const newBankroll = bankroll + winnings;
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
    
    await saveUserData({ bankroll: newBankroll, activeBets: newActiveBets, sessionStats: newStats });
    await updateLeaderboard(newBankroll);
    
    return roundWinner;
  };

  const adminDealCards = async () => {
    const pCards = [adminPlayerCards[0], adminPlayerCards[1]];
    const bCards = [adminBankerCards[0], adminBankerCards[1]];
    
    if (adminPlayerThird) pCards.push(adminPlayerThird);
    if (adminBankerThird) bCards.push(adminBankerThird);
    
    const pScore = calculateScore(pCards);
    const bScore = calculateScore(bCards);
    const roundWinner = await resolveRound(pCards, bCards);
    
    await saveGameState({
      gamePhase: 'dealt',
      playerCards: pCards,
      bankerCards: bCards,
      playerScore: pScore,
      bankerScore: bScore,
      winner: roundWinner,
      roundNumber: roundNumber + 1,
      bettingOpen: false,
      roadmap: [...roadmap, roundWinner === 'player' ? 'P' : roundWinner === 'banker' ? 'B' : 'T'].slice(-50)
    });
    
    setGamePhase('dealt');
    setPlayerCards(pCards);
    setBankerCards(bCards);
    setPlayerScore(pScore);
    setBankerScore(bScore);
    setWinner(roundWinner);
    setRoundNumber(roundNumber + 1);
    setBettingOpen(false);
    
    setAdminPlayerCards(['', '']);
    setAdminBankerCards(['', '']);
    setAdminPlayerThird('');
    setAdminBankerThird('');
  };

  const adminStartNewRound = async () => {
    await saveGameState({
      gamePhase: 'betting',
      playerCards: [],
      bankerCards: [],
      playerScore: 0,
      bankerScore: 0,
      winner: null,
      bettingOpen: true,
      countdown: 15
    });
    
    setGamePhase('betting');
    setPlayerCards([]);
    setBankerCards([]);
    setPlayerScore(0);
    setBankerScore(0);
    setWinner(null);
    setBettingOpen(true);
    setCountdown(15);
  };

  const adminResetSession = async () => {
    if (confirm('Reset entire session? This will clear all user data.')) {
      try {
        await window.storage.set('baccarat-game-state', JSON.stringify({
          gamePhase: 'betting',
          playerCards: [],
          bankerCards: [],
          playerScore: 0,
          bankerScore: 0,
          winner: null,
          roundNumber: 0,
          bettingOpen: true,
          countdown: 15,
          roadmap: []
        }), true);
        
        await window.storage.set('baccarat-leaderboard', JSON.stringify([]), true);
        
        setGamePhase('betting');
        setPlayerCards([]);
        setBankerCards([]);
        setPlayerScore(0);
        setBankerScore(0);
        setWinner(null);
        setRoundNumber(0);
        setBettingOpen(true);
        setCountdown(15);
        setRoadmap([]);
        setBankroll(1000);
        clearAllBets();
        setActiveBets({});
        setSessionStats({
          totalWagered: 0,
          biggestWin: 0,
          totalRounds: 0,
          startingBankroll: 1000
        });
        
        await saveUserData({ 
          bankroll: 1000, 
          activeBets: {},
          sessionStats: {
            totalWagered: 0,
            biggestWin: 0,
            totalRounds: 0,
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
      const current = await window.storage.get('baccarat-chat-messages', true);
      let messages = current ? JSON.parse(current.value) : [];
      messages.push(message);
      messages = messages.slice(-50);
      await window.storage.set('baccarat-chat-messages', JSON.stringify(messages), true);
      setChatMessages(messages);
      setChatInput('');
    } catch (e) {
      console.error('Chat error:', e);
    }
  };

  const loadChatMessages = async () => {
    try {
      const result = await window.storage.get('baccarat-chat-messages', true);
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

  // Card rendering component
  const Card = ({ card, hidden = false }) => {
    if (hidden) {
      return (
        <div style={{
          width: '70px',
          height: '100px',
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
        width: '70px',
        height: '100px',
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
                style={{ accentColor: '#d4af37' }}
              />
              Dealer Access
            </label>
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
        padding: '12px 20px',
        background: 'linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)',
        borderBottom: '3px solid #d4af37',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        position: 'sticky',
        top: 0,
        zIndex: 1000
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#d4af37', letterSpacing: '2px' }}>
            ACTION SYNC
          </div>
          <div style={{ fontSize: '11px', color: '#888' }}>
            {userName} | <span style={{ color: '#d4af37' }}>${bankroll.toLocaleString()}</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          {onBack && (
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
          {isAdmin && (
            <button
              onClick={() => setShowSettings(!showSettings)}
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
            gridTemplateColumns: '1fr 1fr',
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
                  width: '50px',
                  height: '50px',
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
                  width: '50px',
                  height: '50px',
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
                  width: '50px',
                  height: '50px',
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

        {/* Chip Selector and Controls */}
        <div style={{
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
                  width: '70px',
                  height: '70px',
                  borderRadius: '50%',
                  border: selectedChip === value ? '4px solid #d4af37' : '3px solid #555',
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
                  boxShadow: selectedChip === value ? '0 0 20px rgba(212, 175, 55, 0.6)' : 'none'
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
            ) : (
              chatMessages.map((msg, idx) => (
                <div key={idx} style={{
                  marginBottom: '10px',
                  padding: '8px',
                  background: msg.userId === userId ? 'rgba(212, 175, 55, 0.1)' : 'rgba(255,255,255,0.05)',
                  borderRadius: '6px',
                  borderLeft: `3px solid ${msg.userId === userId ? '#d4af37' : '#555'}`
                }}>
                  <div style={{ fontSize: '10px', color: msg.userId === userId ? '#d4af37' : '#888', marginBottom: '4px' }}>
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

        {/* Admin / Dealer Controls */}
        {isAdmin && showSettings && (
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
            
            {/* Card Entry */}
            <div style={{
              background: 'rgba(0, 0, 0, 0.3)',
              padding: '18px',
              borderRadius: '8px',
              marginBottom: '15px'
            }}>
              <div style={{ fontSize: '11px', color: '#888', marginBottom: '12px' }}>
                Player Cards (e.g., "A♠", "K♥", "10♦")
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
            <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
              <button
                onClick={adminStartNewRound}
                disabled={gamePhase === 'betting'}
                style={{
                  flex: 1,
                  padding: '14px',
                  background: gamePhase === 'dealt' ? 'rgba(76, 175, 80, 0.3)' : '#333',
                  border: '1px solid #4caf50',
                  borderRadius: '8px',
                  color: gamePhase === 'dealt' ? '#4caf50' : '#666',
                  fontSize: '11px',
                  fontWeight: 'bold',
                  cursor: gamePhase === 'dealt' ? 'pointer' : 'not-allowed',
                  fontFamily: 'inherit',
                  textTransform: 'uppercase'
                }}
              >
                Start New Round
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
            
            {/* Status */}
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
        
        button:active:not(:disabled) {
          transform: translateY(0);
        }
      `}</style>
    </div>
  );
};

export default BaccaratGame;
