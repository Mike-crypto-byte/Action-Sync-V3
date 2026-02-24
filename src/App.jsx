// App.jsx — Updated for Firebase real-time sync
// Changes:
//   1. Uses Firebase ref/set/onValue directly (fixes "Failed to set active game" error)
//   2. Passes isDealerMode as prop to game components
//   3. Dealer login is ONLY here — removed from individual games
import React, { useState, useEffect } from 'react';
import { Dice1, Spade, ArrowLeft, Circle } from 'lucide-react';
import { database as db, ref, onValue, set } from './firebase.js';

// Import your game components
import CrapsGame from './CrapsGame';
import BaccaratGame from './BaccaratGame';
import RouletteGame from './RouletteGame';
import StreamOverlay from './StreamOverlay';

const App = () => {
  // Check for overlay route
  if (window.location.hash === '#overlay' || window.location.pathname === '/overlay') {
    return <StreamOverlay />;
  }

  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  const [selectedGame, setSelectedGame] = useState(null);
  const [isDealerMode, setIsDealerMode] = useState(false);
  const [dealerPassword, setDealerPassword] = useState('');
  const [dealerName, setDealerName] = useState('Dealer');
  const [startingChips, setStartingChips] = useState(1000);
  const [showDealerLogin, setShowDealerLogin] = useState(false);
  
  // Player registration state (shared across all games)
  const [isPlayerRegistered, setIsPlayerRegistered] = useState(false);
  const [playerName, setPlayerName] = useState('');
  const [sessionLeaderboard, setSessionLeaderboard] = useState(null); // end-of-session snapshot
  const [showSessionSummary, setShowSessionSummary] = useState(false);
  const [userId] = useState(() => {
    let id = sessionStorage.getItem('actionsync-userId');
    if (!id) { id = `user_${Math.random().toString(36).substr(2, 9)}`; sessionStorage.setItem('actionsync-userId', id); }
    return id;
  });
  
  // Check if player already exists in shared session
  useEffect(() => {
    if (isDealerMode) return;
    const userRef = ref(db, `session/users/${userId}`);
    const unsub = onValue(userRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        if (data.name) {
          setPlayerName(data.name);
          setIsPlayerRegistered(true);
        }
      }
    });
    return () => unsub();
  }, [userId, isDealerMode]);
  
  const registerPlayer = async () => {
    if (!playerName.trim()) return;
    // Read startingChips from Firebase (set by dealer) or default to 1000
    let chips = 1000;
    try {
      const chipsRef = ref(db, 'session/settings/startingChips');
      const snap = await new Promise((resolve) => {
        onValue(chipsRef, (snapshot) => resolve(snapshot), { onlyOnce: true });
      });
      if (snap.exists()) chips = snap.val();
    } catch (e) { /* use default */ }
    
    const userRef = ref(db, `session/users/${userId}`);
    await set(userRef, {
      name: playerName.trim(),
      bankroll: chips,
      userId: userId,
      isAdmin: false,
      lastActive: Date.now()
    });
    const lbRef = ref(db, `session/leaderboard/${userId}`);
    await set(lbRef, {
      userId: userId,
      name: playerName.trim(),
      bankroll: chips,
      timestamp: Date.now()
    });
    setIsPlayerRegistered(true);
  };
  
  const DEALER_PASSWORD = 'dealer2024'; // CHANGE THIS!

  // Listen to active game from Firebase in real-time
  useEffect(() => {
    if (!isDealerMode) {
      const dbRef = ref(db, 'activeGame');
      const unsub = onValue(dbRef, (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.val();
          if (data && data.game) {
            console.log('📡 Active game updated:', data.game);
            setSelectedGame(data.game);
            setShowSessionSummary(false); // Hide summary when new game starts
          }
        } else {
          // Game deactivated — check for session summary
          setSelectedGame(null);
        }
      });
      return () => unsub();
    }
  }, [isDealerMode]);
  
  // Listen for end-of-session leaderboard (players)
  useEffect(() => {
    if (!isDealerMode) {
      const summaryRef = ref(db, 'session/endOfSession');
      const unsub = onValue(summaryRef, (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.val();
          if (data.active && data.players) {
            setSessionLeaderboard(data.players);
            if (data.startingChips) setStartingChips(data.startingChips);
            setShowSessionSummary(true);
          }
        }
      });
      return () => unsub();
    }
  }, [isDealerMode]);

  // Dealer sets active game via Firebase
  const setActiveGame = async (game) => {
    console.log('🎮 Dealer selecting game:', game);
    try {
      // Clear end-of-session summary
      const summaryRef = ref(db, 'session/endOfSession');
      await set(summaryRef, null);
      setShowSessionSummary(false);
      setSessionLeaderboard(null);
      
      const dbRef = ref(db, 'activeGame');
      await set(dbRef, { game, timestamp: Date.now() });
      console.log('✅ Saved to Firebase');
      setSelectedGame(game);
    } catch (e) {
      console.error('❌ Failed to set active game:', e);
      alert('Failed to set active game. Error: ' + e.message);
    }
  };

  const handleDealerLogin = async () => {
    if (dealerPassword === DEALER_PASSWORD) {
      setIsDealerMode(true);
      setShowDealerLogin(false);
      setDealerPassword('');
      setPlayerName(dealerName.trim() || 'Dealer');
      
      // Register dealer in session
      const userRef = ref(db, `session/users/${userId}`);
      await set(userRef, {
        name: dealerName.trim() || 'Dealer',
        bankroll: startingChips,
        userId: userId,
        isAdmin: true,
        lastActive: Date.now()
      });
      
      // Add dealer to leaderboard so they appear in rankings
      const lbRef = ref(db, `session/leaderboard/${userId}`);
      await set(lbRef, {
        userId: userId,
        name: dealerName.trim() || 'Dealer',
        bankroll: startingChips,
        isAdmin: false,
        timestamp: Date.now()
      });
      
      // Save starting chips setting
      const chipsRef = ref(db, 'session/settings/startingChips');
      await set(chipsRef, startingChips);
      
      setIsPlayerRegistered(true);
    } else {
      alert('❌ Invalid dealer password');
      setDealerPassword('');
    }
  };

  // Dealer deactivates game — sends all players back to waiting screen with session summary
  const deactivateGame = async () => {
    try {
      // Grab leaderboard snapshot before deactivating
      const lbRef = ref(db, 'session/leaderboard');
      const lbSnap = await new Promise((resolve) => {
        onValue(lbRef, (snapshot) => resolve(snapshot), { onlyOnce: true });
      });
      
      if (lbSnap.exists()) {
        const lbData = lbSnap.val();
        const players = Object.values(lbData)
          .sort((a, b) => b.bankroll - a.bankroll);
        
        if (players.length > 0) {
          // Save snapshot to Firebase so players can see it
          const summaryRef = ref(db, 'session/endOfSession');
          await set(summaryRef, {
            players: players,
            startingChips: startingChips,
            timestamp: Date.now(),
            active: true
          });
          setSessionLeaderboard(players);
          setShowSessionSummary(true);
        }
      }
      
      const dbRef = ref(db, 'activeGame');
      await set(dbRef, null);
      setSelectedGame(null);
      console.log('🛑 Game deactivated — players return to session summary');
    } catch (e) {
      console.error('Failed to deactivate game:', e);
    }
  };

  // ========== Render selected game — pass isDealerMode as prop ==========
  if (selectedGame === 'craps') {
    return <CrapsGame onBack={() => isDealerMode ? deactivateGame() : null} isDealerMode={isDealerMode} playerUserId={userId} playerName={playerName} skipRegistration={isPlayerRegistered} />;
  }

  if (selectedGame === 'baccarat') {
    return <BaccaratGame onBack={() => isDealerMode ? deactivateGame() : null} isDealerMode={isDealerMode} playerUserId={userId} playerName={playerName} skipRegistration={isPlayerRegistered} />;
  }

  if (selectedGame === 'roulette') {
    return <RouletteGame onBack={() => isDealerMode ? deactivateGame() : null} isDealerMode={isDealerMode} playerUserId={userId} playerName={playerName} skipRegistration={isPlayerRegistered} />;
  }

  // Dealer Login Screen
  if (showDealerLogin) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #0a0e27 0%, #1a1f3a 50%, #0f1829 100%)',
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
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.8)'
        }}>
          <div style={{ textAlign: 'center', marginBottom: '35px' }}>
            <div style={{
              fontSize: '42px',
              fontWeight: 'bold',
              color: '#d4af37',
              marginBottom: '10px',
              letterSpacing: '3px'
            }}>
              🎰 DEALER LOGIN
            </div>
            <div style={{
              color: '#888',
              fontSize: '13px',
              letterSpacing: '2px',
              textTransform: 'uppercase'
            }}>
              Control Active Game
            </div>
          </div>
          
          <div style={{ marginBottom: '20px' }}>
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
              value={dealerName}
              onChange={(e) => setDealerName(e.target.value)}
              placeholder="Dealer name"
              autoFocus
              style={{
                width: '100%',
                padding: '14px',
                background: '#0a0a0a',
                border: '2px solid #444',
                borderRadius: '8px',
                color: '#fff',
                fontSize: '15px',
                outline: 'none',
                fontFamily: 'inherit',
                textAlign: 'center',
                letterSpacing: '1px'
              }}
            />
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
              Dealer Password
            </label>
            <input
              type="password"
              value={dealerPassword}
              onChange={(e) => setDealerPassword(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleDealerLogin()}
              placeholder="Enter password"
              autoFocus
              style={{
                width: '100%',
                padding: '14px',
                background: '#0a0a0a',
                border: '2px solid #444',
                borderRadius: '8px',
                color: '#fff',
                fontSize: '15px',
                outline: 'none',
                fontFamily: 'inherit',
                textAlign: 'center',
                letterSpacing: '2px'
              }}
            />
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
              Player Starting Chips
            </label>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {[500, 1000, 2500, 5000, 10000].map(amount => (
                <button
                  key={amount}
                  onClick={() => setStartingChips(amount)}
                  style={{
                    flex: 1,
                    padding: '12px 8px',
                    background: startingChips === amount ? '#d4af37' : '#0a0a0a',
                    border: startingChips === amount ? '2px solid #d4af37' : '2px solid #444',
                    borderRadius: '8px',
                    color: startingChips === amount ? '#000' : '#888',
                    fontSize: '13px',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    fontFamily: 'inherit'
                  }}
                >
                  ${amount.toLocaleString()}
                </button>
              ))}
            </div>
          </div>
          
          <button
            onClick={handleDealerLogin}
            disabled={!dealerPassword.trim()}
            style={{
              width: '100%',
              padding: '16px',
              background: dealerPassword.trim() 
                ? 'linear-gradient(135deg, #d4af37 0%, #f4e5a1 100%)'
                : '#333',
              border: 'none',
              borderRadius: '8px',
              color: dealerPassword.trim() ? '#000' : '#666',
              fontSize: '15px',
              fontWeight: 'bold',
              letterSpacing: '3px',
              cursor: dealerPassword.trim() ? 'pointer' : 'not-allowed',
              textTransform: 'uppercase',
              fontFamily: 'inherit',
              marginBottom: '15px'
            }}
          >
            Login as Dealer
          </button>
          
          <button
            onClick={() => setShowDealerLogin(false)}
            style={{
              width: '100%',
              padding: '12px',
              background: 'transparent',
              border: '1px solid #444',
              borderRadius: '8px',
              color: '#888',
              fontSize: '12px',
              cursor: 'pointer',
              fontFamily: 'inherit'
            }}
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  // Player Registration + Waiting Screen
  if (!isDealerMode && !selectedGame) {
    // Show registration first if player hasn't registered
    if (!isPlayerRegistered) {
      return (
        <div style={{
          minHeight: '100vh',
          background: 'linear-gradient(135deg, #0a0e27 0%, #1a1f3a 50%, #0f1829 100%)',
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
            boxShadow: '0 20px 60px rgba(0, 0, 0, 0.8)'
          }}>
            <div style={{ textAlign: 'center', marginBottom: '35px' }}>
              <div style={{
                fontSize: isMobile ? '36px' : '48px',
                fontWeight: 'bold',
                background: 'linear-gradient(135deg, #d4af37 0%, #ffd700 50%, #d4af37 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                marginBottom: '15px',
                letterSpacing: '3px'
              }}>
                ACTION SYNC
              </div>
              <div style={{
                color: '#d4af37',
                fontSize: '11px',
                letterSpacing: '4px',
                textTransform: 'uppercase',
                marginBottom: '20px'
              }}>
                Live Casino Experience
              </div>
              <div style={{
                color: '#aaa',
                fontSize: '14px',
                lineHeight: '1.8',
                maxWidth: '380px',
                margin: '0 auto'
              }}>
                Play alongside your favorite streamer. Place bets on live casino games with virtual chips and compete for the top of the leaderboard.
              </div>
            </div>

            {/* How it works */}
            <div style={{
              display: 'flex',
              gap: '12px',
              marginBottom: '25px'
            }}>
              {[
                { emoji: '📺', text: 'Watch the live stream' },
                { emoji: '🎰', text: 'Place your bets' },
                { emoji: '🏆', text: 'Climb the leaderboard' }
              ].map((step, i) => (
                <div key={i} style={{
                  flex: 1,
                  textAlign: 'center',
                  padding: '12px 8px',
                  background: 'rgba(255,255,255,0.03)',
                  borderRadius: '8px',
                  border: '1px solid rgba(255,255,255,0.06)'
                }}>
                  <div style={{ fontSize: '20px', marginBottom: '6px' }}>{step.emoji}</div>
                  <div style={{ color: '#888', fontSize: '10px', lineHeight: '1.4' }}>{step.text}</div>
                </div>
              ))}
            </div>
            
            <div style={{ marginBottom: '25px' }}>
              <input
                type="text"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && registerPlayer()}
                placeholder="Your display name"
                autoFocus
                style={{
                  width: '100%',
                  padding: '16px',
                  background: '#0a0a0a',
                  border: '2px solid #444',
                  borderRadius: '8px',
                  color: '#fff',
                  fontSize: '18px',
                  outline: 'none',
                  fontFamily: 'inherit',
                  textAlign: 'center',
                  letterSpacing: '1px'
                }}
              />
            </div>
            
            <button
              onClick={registerPlayer}
              disabled={!playerName.trim()}
              style={{
                width: '100%',
                padding: '16px',
                background: playerName.trim()
                  ? 'linear-gradient(135deg, #d4af37 0%, #f4e5a1 100%)'
                  : '#333',
                border: 'none',
                borderRadius: '8px',
                color: playerName.trim() ? '#000' : '#666',
                fontSize: '16px',
                fontWeight: 'bold',
                letterSpacing: '3px',
                cursor: playerName.trim() ? 'pointer' : 'not-allowed',
                textTransform: 'uppercase',
                fontFamily: 'inherit',
                marginBottom: '20px'
              }}
            >
              Join Session
            </button>
            
            <div style={{ textAlign: 'center' }}>
              <button
                onClick={() => setShowDealerLogin(true)}
                style={{
                  padding: '10px 20px',
                  background: 'transparent',
                  border: '1px solid #444',
                  borderRadius: '6px',
                  color: '#666',
                  fontSize: '10px',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  letterSpacing: '2px',
                  textTransform: 'uppercase'
                }}
              >
                🔐 Dealer Login
              </button>
            </div>
            
            <div style={{
              marginTop: '20px',
              padding: '12px',
              background: 'rgba(212, 175, 55, 0.1)',
              borderRadius: '8px',
              border: '1px solid rgba(212, 175, 55, 0.2)'
            }}>
              <div style={{ color: '#888', fontSize: '10px', lineHeight: '1.6', textAlign: 'center' }}>
                Virtual entertainment only. No real money. 18+ only.
              </div>
            </div>
          </div>
        </div>
      );
    }
    
    // Player is registered — show session summary or waiting screen
    return (
      <div style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #0a0e27 0%, #1a1f3a 50%, #0f1829 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: '"Courier New", monospace',
        padding: '20px'
      }}>
        <div style={{
          textAlign: 'center',
          maxWidth: '650px',
          width: '100%'
        }}>
          {/* Session Summary */}
          {showSessionSummary && sessionLeaderboard && sessionLeaderboard.length > 0 ? (
            <>
              <div style={{ fontSize: '52px', marginBottom: '15px' }}>🏆</div>
              <div style={{
                fontSize: '28px', fontWeight: 'bold', color: '#d4af37',
                marginBottom: '8px', letterSpacing: '4px'
              }}>
                SESSION RESULTS
              </div>
              <div style={{ color: '#888', fontSize: '14px', marginBottom: '30px' }}>
                Final standings for this session
              </div>
              
              {/* Podium — Top 3 */}
              {sessionLeaderboard.length >= 1 && (
                <div style={{
                  display: 'flex', justifyContent: 'center', alignItems: isMobile ? 'center' : 'flex-end',
                  gap: isMobile ? '10px' : '12px', marginBottom: '30px',
                  flexDirection: isMobile ? 'column' : 'row'
                }}>
                  {/* 2nd Place */}
                  {sessionLeaderboard.length >= 2 && (
                    <div style={{
                      background: 'linear-gradient(180deg, rgba(192,192,192,0.15) 0%, rgba(192,192,192,0.05) 100%)',
                      border: '2px solid rgba(192,192,192,0.4)',
                      borderRadius: '12px', padding: '20px 15px', width: isMobile ? '100%' : '140px',
                      textAlign: 'center'
                    }}>
                      <div style={{ fontSize: '28px', marginBottom: '5px' }}>🥈</div>
                      <div style={{ fontSize: '14px', color: '#ccc', fontWeight: 'bold', marginBottom: '4px' }}>
                        {sessionLeaderboard[1].name}
                      </div>
                      <div style={{
                        fontSize: '18px', fontWeight: 'bold',
                        color: sessionLeaderboard[1].bankroll >= startingChips ? '#4caf50' : '#f44336'
                      }}>
                        ${Math.round(sessionLeaderboard[1].bankroll).toLocaleString()}
                      </div>
                      <div style={{
                        fontSize: '11px', marginTop: '4px',
                        color: sessionLeaderboard[1].bankroll - startingChips >= 0 ? '#4caf50' : '#f44336'
                      }}>
                        {sessionLeaderboard[1].bankroll - startingChips >= 0 ? '+' : ''}${Math.round(sessionLeaderboard[1].bankroll - startingChips).toLocaleString()}
                      </div>
                    </div>
                  )}
                  
                  {/* 1st Place */}
                  <div style={{
                    background: 'linear-gradient(180deg, rgba(212,175,55,0.2) 0%, rgba(212,175,55,0.05) 100%)',
                    border: '3px solid #d4af37',
                    borderRadius: '12px', padding: '25px 20px', width: isMobile ? '100%' : '160px',
                    textAlign: 'center',
                    boxShadow: '0 0 30px rgba(212,175,55,0.2)'
                  }}>
                    <div style={{ fontSize: '36px', marginBottom: '5px' }}>🥇</div>
                    <div style={{ fontSize: '16px', color: '#d4af37', fontWeight: 'bold', marginBottom: '4px' }}>
                      {sessionLeaderboard[0].name}
                    </div>
                    <div style={{
                      fontSize: '22px', fontWeight: 'bold',
                      color: sessionLeaderboard[0].bankroll >= startingChips ? '#4caf50' : '#f44336'
                    }}>
                      ${Math.round(sessionLeaderboard[0].bankroll).toLocaleString()}
                    </div>
                    <div style={{
                      fontSize: '12px', marginTop: '4px',
                      color: sessionLeaderboard[0].bankroll - startingChips >= 0 ? '#4caf50' : '#f44336'
                    }}>
                      {sessionLeaderboard[0].bankroll - startingChips >= 0 ? '+' : ''}${Math.round(sessionLeaderboard[0].bankroll - startingChips).toLocaleString()}
                    </div>
                  </div>
                  
                  {/* 3rd Place */}
                  {sessionLeaderboard.length >= 3 && (
                    <div style={{
                      background: 'linear-gradient(180deg, rgba(205,127,50,0.15) 0%, rgba(205,127,50,0.05) 100%)',
                      border: '2px solid rgba(205,127,50,0.4)',
                      borderRadius: '12px', padding: '18px 15px', width: isMobile ? '100%' : '130px',
                      textAlign: 'center'
                    }}>
                      <div style={{ fontSize: '24px', marginBottom: '5px' }}>🥉</div>
                      <div style={{ fontSize: '13px', color: '#ccc', fontWeight: 'bold', marginBottom: '4px' }}>
                        {sessionLeaderboard[2].name}
                      </div>
                      <div style={{
                        fontSize: '16px', fontWeight: 'bold',
                        color: sessionLeaderboard[2].bankroll >= startingChips ? '#4caf50' : '#f44336'
                      }}>
                        ${Math.round(sessionLeaderboard[2].bankroll).toLocaleString()}
                      </div>
                      <div style={{
                        fontSize: '11px', marginTop: '4px',
                        color: sessionLeaderboard[2].bankroll - startingChips >= 0 ? '#4caf50' : '#f44336'
                      }}>
                        {sessionLeaderboard[2].bankroll - startingChips >= 0 ? '+' : ''}${Math.round(sessionLeaderboard[2].bankroll - startingChips).toLocaleString()}
                      </div>
                    </div>
                  )}
                </div>
              )}
              
              {/* Full Rankings */}
              {sessionLeaderboard.length > 3 && (
                <div style={{
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '12px', padding: '15px', marginBottom: '25px',
                  textAlign: 'left'
                }}>
                  {sessionLeaderboard.slice(3).map((player, idx) => (
                    <div key={idx} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '8px 12px',
                      borderBottom: idx < sessionLeaderboard.length - 4 ? '1px solid rgba(255,255,255,0.05)' : 'none'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ color: '#666', fontSize: '12px', width: '25px' }}>#{idx + 4}</span>
                        <span style={{ color: '#ccc', fontSize: '13px' }}>{player.name}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                        <span style={{
                          fontSize: '13px', fontWeight: 'bold',
                          color: player.bankroll >= startingChips ? '#4caf50' : '#f44336'
                        }}>
                          ${Math.round(player.bankroll).toLocaleString()}
                        </span>
                        <span style={{
                          fontSize: '11px',
                          color: player.bankroll - startingChips >= 0 ? '#4caf50' : '#f44336'
                        }}>
                          {player.bankroll - startingChips >= 0 ? '+' : ''}${Math.round(player.bankroll - startingChips).toLocaleString()}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              
              {/* Your result highlight */}
              {(() => {
                const myResult = sessionLeaderboard.find(p => p.userId === userId);
                const myRank = sessionLeaderboard.findIndex(p => p.userId === userId) + 1;
                if (!myResult) return null;
                const pnl = Math.round(myResult.bankroll - startingChips);
                return (
                  <div style={{
                    background: pnl >= 0 ? 'rgba(76, 175, 80, 0.1)' : 'rgba(244, 67, 54, 0.1)',
                    border: `2px solid ${pnl >= 0 ? '#4caf50' : '#f44336'}`,
                    borderRadius: '12px', padding: '20px', marginBottom: '25px'
                  }}>
                    <div style={{ fontSize: '12px', color: '#888', letterSpacing: '2px', marginBottom: '8px' }}>
                      YOUR RESULT — #{myRank} of {sessionLeaderboard.length}
                    </div>
                    <div style={{
                      fontSize: '32px', fontWeight: 'bold',
                      color: pnl >= 0 ? '#4caf50' : '#f44336'
                    }}>
                      {pnl >= 0 ? '+' : ''}${pnl.toLocaleString()}
                    </div>
                    <div style={{ fontSize: '13px', color: '#aaa', marginTop: '5px' }}>
                      Final balance: ${Math.round(myResult.bankroll).toLocaleString()}
                    </div>
                  </div>
                );
              })()}
              
              <div style={{
                color: '#666', fontSize: '13px', marginBottom: '15px'
              }}>
                Waiting for next session...
              </div>
              
              {/* Animated dots */}
              <div style={{
                display: 'flex', justifyContent: 'center', gap: '10px'
              }}>
                {[0, 1, 2].map(i => (
                  <div key={i} style={{
                    width: '8px', height: '8px', borderRadius: '50%',
                    background: '#d4af37',
                    animation: `pulse 1.5s ease-in-out ${i * 0.2}s infinite`
                  }} />
                ))}
              </div>
            </>
          ) : (
            <>
              {/* Default waiting screen — no session to show */}
              <div style={{ fontSize: '64px', marginBottom: '20px' }}>⏳</div>
              <div style={{
                fontSize: '32px', fontWeight: 'bold', color: '#d4af37',
                marginBottom: '15px', letterSpacing: '3px'
              }}>
                WAITING FOR DEALER
              </div>
              <div style={{ color: '#888', fontSize: '16px', lineHeight: '1.8', marginBottom: '10px' }}>
                Welcome, <span style={{ color: '#d4af37' }}>{playerName}</span>!
              </div>
              <div style={{ color: '#888', fontSize: '16px', lineHeight: '1.8', marginBottom: '30px' }}>
                No game is currently active. Please wait for the dealer to start a session.
              </div>
              
              {/* Animated dots */}
              <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', marginBottom: '40px' }}>
                {[0, 1, 2].map(i => (
                  <div key={i} style={{
                    width: '12px', height: '12px', borderRadius: '50%',
                    background: '#d4af37',
                    animation: `pulse 1.5s ease-in-out ${i * 0.2}s infinite`
                  }} />
                ))}
              </div>
              
              <div style={{
                padding: '20px', background: 'rgba(212, 175, 55, 0.1)',
                borderRadius: '12px', border: '1px solid rgba(212, 175, 55, 0.2)'
              }}>
                <div style={{ color: '#d4af37', fontSize: '12px', marginBottom: '8px', fontWeight: 'bold' }}>
                  💡 TIP
                </div>
                <div style={{ color: '#888', fontSize: '12px', lineHeight: '1.6' }}>
                  The game will start automatically when the dealer selects one. Keep this page open.
                </div>
              </div>
            </>
          )}

        </div>
      </div>
    );
  }

  // Dealer Game Selection Hub
  
  // Show session summary if dealer just ended session
  if (isDealerMode && showSessionSummary && sessionLeaderboard && sessionLeaderboard.length > 0) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #0a0e27 0%, #1a1f3a 50%, #0f1829 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: '"Courier New", monospace',
        padding: '20px'
      }}>
        <div style={{ textAlign: 'center', maxWidth: '650px', width: '100%' }}>
          <div style={{ fontSize: '52px', marginBottom: '15px' }}>🏆</div>
          <div style={{
            fontSize: '28px', fontWeight: 'bold', color: '#d4af37',
            marginBottom: '8px', letterSpacing: '4px'
          }}>
            SESSION RESULTS
          </div>
          <div style={{ color: '#888', fontSize: '14px', marginBottom: '30px' }}>
            Final standings
          </div>
          
          {/* Podium */}
          <div style={{
            display: 'flex', justifyContent: 'center', alignItems: isMobile ? 'center' : 'flex-end',
            gap: isMobile ? '10px' : '12px', marginBottom: '30px',
            flexDirection: isMobile ? 'column' : 'row'
          }}>
            {/* 2nd */}
            {sessionLeaderboard.length >= 2 && (
              <div style={{
                background: 'linear-gradient(180deg, rgba(192,192,192,0.15) 0%, rgba(192,192,192,0.05) 100%)',
                border: '2px solid rgba(192,192,192,0.4)',
                borderRadius: '12px', padding: '20px 15px', width: isMobile ? '100%' : '140px', textAlign: 'center'
              }}>
                <div style={{ fontSize: '28px', marginBottom: '5px' }}>🥈</div>
                <div style={{ fontSize: '14px', color: '#ccc', fontWeight: 'bold', marginBottom: '4px' }}>{sessionLeaderboard[1].name}</div>
                <div style={{ fontSize: '18px', fontWeight: 'bold', color: sessionLeaderboard[1].bankroll >= startingChips ? '#4caf50' : '#f44336' }}>
                  ${Math.round(sessionLeaderboard[1].bankroll).toLocaleString()}
                </div>
                <div style={{ fontSize: '11px', marginTop: '4px', color: sessionLeaderboard[1].bankroll - startingChips >= 0 ? '#4caf50' : '#f44336' }}>
                  {sessionLeaderboard[1].bankroll - startingChips >= 0 ? '+' : ''}${Math.round(sessionLeaderboard[1].bankroll - startingChips).toLocaleString()}
                </div>
              </div>
            )}
            {/* 1st */}
            <div style={{
              background: 'linear-gradient(180deg, rgba(212,175,55,0.2) 0%, rgba(212,175,55,0.05) 100%)',
              border: '3px solid #d4af37', borderRadius: '12px', padding: '25px 20px',
              width: isMobile ? '100%' : '160px', textAlign: 'center',
              boxShadow: '0 0 30px rgba(212,175,55,0.2)'
            }}>
              <div style={{ fontSize: '36px', marginBottom: '5px' }}>🥇</div>
              <div style={{ fontSize: '16px', color: '#d4af37', fontWeight: 'bold', marginBottom: '4px' }}>{sessionLeaderboard[0].name}</div>
              <div style={{ fontSize: '22px', fontWeight: 'bold', color: sessionLeaderboard[0].bankroll >= startingChips ? '#4caf50' : '#f44336' }}>
                ${Math.round(sessionLeaderboard[0].bankroll).toLocaleString()}
              </div>
              <div style={{ fontSize: '12px', marginTop: '4px', color: sessionLeaderboard[0].bankroll - startingChips >= 0 ? '#4caf50' : '#f44336' }}>
                {sessionLeaderboard[0].bankroll - startingChips >= 0 ? '+' : ''}${Math.round(sessionLeaderboard[0].bankroll - startingChips).toLocaleString()}
              </div>
            </div>
            {/* 3rd */}
            {sessionLeaderboard.length >= 3 && (
              <div style={{
                background: 'linear-gradient(180deg, rgba(205,127,50,0.15) 0%, rgba(205,127,50,0.05) 100%)',
                border: '2px solid rgba(205,127,50,0.4)',
                borderRadius: '12px', padding: '18px 15px', width: isMobile ? '100%' : '130px', textAlign: 'center'
              }}>
                <div style={{ fontSize: '24px', marginBottom: '5px' }}>🥉</div>
                <div style={{ fontSize: '13px', color: '#ccc', fontWeight: 'bold', marginBottom: '4px' }}>{sessionLeaderboard[2].name}</div>
                <div style={{ fontSize: '16px', fontWeight: 'bold', color: sessionLeaderboard[2].bankroll >= startingChips ? '#4caf50' : '#f44336' }}>
                  ${Math.round(sessionLeaderboard[2].bankroll).toLocaleString()}
                </div>
                <div style={{ fontSize: '11px', marginTop: '4px', color: sessionLeaderboard[2].bankroll - startingChips >= 0 ? '#4caf50' : '#f44336' }}>
                  {sessionLeaderboard[2].bankroll - startingChips >= 0 ? '+' : ''}${Math.round(sessionLeaderboard[2].bankroll - startingChips).toLocaleString()}
                </div>
              </div>
            )}
          </div>
          
          {/* Full rankings 4+ */}
          {sessionLeaderboard.length > 3 && (
            <div style={{
              background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '12px', padding: '15px', marginBottom: '25px', textAlign: 'left'
            }}>
              {sessionLeaderboard.slice(3).map((player, idx) => (
                <div key={idx} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '8px 12px',
                  borderBottom: idx < sessionLeaderboard.length - 4 ? '1px solid rgba(255,255,255,0.05)' : 'none'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ color: '#666', fontSize: '12px', width: '25px' }}>#{idx + 4}</span>
                    <span style={{ color: '#ccc', fontSize: '13px' }}>{player.name}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 'bold', color: player.bankroll >= startingChips ? '#4caf50' : '#f44336' }}>
                      ${Math.round(player.bankroll).toLocaleString()}
                    </span>
                    <span style={{ fontSize: '11px', color: player.bankroll - startingChips >= 0 ? '#4caf50' : '#f44336' }}>
                      {player.bankroll - startingChips >= 0 ? '+' : ''}${Math.round(player.bankroll - startingChips).toLocaleString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
          
          <button
            onClick={() => { setShowSessionSummary(false); setSessionLeaderboard(null); }}
            style={{
              padding: '16px 50px',
              background: 'linear-gradient(135deg, #d4af37 0%, #f4e5a1 100%)',
              border: 'none', borderRadius: '8px', color: '#000',
              fontSize: '14px', fontWeight: 'bold', letterSpacing: '2px',
              cursor: 'pointer', fontFamily: 'inherit', textTransform: 'uppercase',
              boxShadow: '0 4px 20px rgba(212, 175, 55, 0.3)'
            }}
          >
            🎮 Back to Game Hub
          </button>
        </div>
      </div>
    );
  }
  return (
    <div style={{
      minHeight: '100vh',
      background: `
        radial-gradient(circle at 20% 30%, rgba(212, 175, 55, 0.15) 0%, transparent 50%),
        radial-gradient(circle at 80% 70%, rgba(33, 150, 243, 0.1) 0%, transparent 50%),
        linear-gradient(135deg, #0a0e27 0%, #1a1f3a 50%, #0f1829 100%)
      `,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: '"Courier New", monospace',
      padding: '20px'
    }}>
      <div style={{ maxWidth: '1200px', width: '100%' }}>
        
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '60px' }}>
          <div style={{
            fontSize: '64px',
            fontWeight: 'bold',
            background: 'linear-gradient(135deg, #d4af37 0%, #ffd700 50%, #d4af37 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            marginBottom: '15px',
            letterSpacing: '8px',
            textShadow: '0 0 40px rgba(212, 175, 55, 0.3)',
            animation: 'glow 2s ease-in-out infinite alternate'
          }}>
            ACTION SYNC
          </div>
          <div style={{
            color: '#888',
            fontSize: '16px',
            letterSpacing: '6px',
            textTransform: 'uppercase',
            marginBottom: '10px'
          }}>
            Dealer Mode - Select Active Game
          </div>
          
          <div style={{
            marginTop: '15px',
            padding: '12px 20px',
            background: 'rgba(76, 175, 80, 0.2)',
            border: '1px solid #4caf50',
            borderRadius: '8px',
            display: 'inline-block'
          }}>
            <span style={{ color: '#4caf50', fontSize: '12px', fontWeight: 'bold' }}>
              ✅ DEALER MODE ACTIVE
            </span>
          </div>
        </div>

        {/* Game Selection Cards */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))',
          gap: '40px',
          marginBottom: '50px'
        }}>
          
          {/* Craps Card */}
          <div
            onClick={() => {
              console.log('🎲 Craps card clicked!');
              setActiveGame('craps');
            }}
            className="game-card"
            style={{
              background: 'linear-gradient(135deg, rgba(26, 95, 26, 0.4) 0%, rgba(13, 61, 13, 0.6) 100%)',
              backdropFilter: 'blur(20px)',
              border: '3px solid #1a5f1a',
              borderRadius: '20px',
              padding: '40px',
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              position: 'relative',
              overflow: 'hidden',
              boxShadow: '0 10px 40px rgba(0, 0, 0, 0.5)'
            }}
          >
            <div style={{
              position: 'absolute',
              top: '-50%',
              right: '-20%',
              width: '300px',
              height: '300px',
              background: 'radial-gradient(circle, rgba(255,255,255,0.05) 0%, transparent 70%)',
              pointerEvents: 'none'
            }} />
            
            <div style={{ position: 'relative', zIndex: 1 }}>
              <div style={{
                width: '80px',
                height: '80px',
                background: 'rgba(212, 175, 55, 0.2)',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '25px',
                border: '2px solid #d4af37'
              }}>
                <Dice1 size={40} color="#d4af37" />
              </div>
              
              <div style={{
                fontSize: '36px',
                fontWeight: 'bold',
                color: '#fff',
                marginBottom: '15px',
                letterSpacing: '2px'
              }}>
                CRAPS
              </div>
              
              <div style={{
                color: '#fff',
                fontSize: '14px',
                lineHeight: '1.8',
                marginBottom: '25px'
              }}>
                The classic dice game with all the action. Pass line, odds bets, 
                place bets, hard ways, hop bets, and more.
              </div>
              
              <div style={{
                display: 'flex',
                gap: '10px',
                flexWrap: 'wrap',
                marginBottom: '25px'
              }}>
                {['15+ Bet Types', 'Odds Bets', 'Fire Bet'].map(tag => (
                  <div key={tag} style={{
                    background: 'rgba(212, 175, 55, 0.3)',
                    padding: '6px 12px',
                    borderRadius: '6px',
                    fontSize: '11px',
                    color: '#fff',
                    border: '1px solid rgba(212, 175, 55, 0.5)',
                    fontWeight: 'bold'
                  }}>
                    {tag}
                  </div>
                ))}
              </div>
              
              <div style={{
                padding: '15px',
                background: 'rgba(0, 0, 0, 0.3)',
                borderRadius: '10px',
                fontSize: '12px',
                color: '#fff',
                textAlign: 'center',
                fontWeight: 'bold'
              }}>
                Click to activate Craps →
              </div>
            </div>
          </div>

          {/* Baccarat Card */}
          <div
            onClick={() => {
              console.log('🎴 Baccarat card clicked!');
              setActiveGame('baccarat');
            }}
            className="game-card"
            style={{
              background: 'linear-gradient(135deg, rgba(13, 71, 161, 0.4) 0%, rgba(25, 118, 210, 0.6) 100%)',
              backdropFilter: 'blur(20px)',
              border: '3px solid #1976d2',
              borderRadius: '20px',
              padding: '40px',
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              position: 'relative',
              overflow: 'hidden',
              boxShadow: '0 10px 40px rgba(0, 0, 0, 0.5)'
            }}
          >
            <div style={{
              position: 'absolute',
              top: '-50%',
              right: '-20%',
              width: '300px',
              height: '300px',
              background: 'radial-gradient(circle, rgba(33, 150, 243, 0.1) 0%, transparent 70%)',
              pointerEvents: 'none'
            }} />
            
            <div style={{ position: 'relative', zIndex: 1 }}>
              <div style={{
                width: '80px',
                height: '80px',
                background: 'rgba(33, 150, 243, 0.2)',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '25px',
                border: '2px solid #2196f3'
              }}>
                <Spade size={40} color="#2196f3" />
              </div>
              
              <div style={{
                fontSize: '36px',
                fontWeight: 'bold',
                color: '#fff',
                marginBottom: '15px',
                letterSpacing: '2px'
              }}>
                BACCARAT
              </div>
              
              <div style={{
                color: '#fff',
                fontSize: '14px',
                lineHeight: '1.8',
                marginBottom: '25px'
              }}>
                The elegant card game of choice. Bet on Player, Banker, or Tie. 
                Features Dragon and Panda bonus bets.
              </div>
              
              <div style={{
                display: 'flex',
                gap: '10px',
                flexWrap: 'wrap',
                marginBottom: '25px'
              }}>
                {['Player/Banker/Tie', '🐉 Dragon', '🐼 Panda'].map(tag => (
                  <div key={tag} style={{
                    background: 'rgba(33, 150, 243, 0.3)',
                    padding: '6px 12px',
                    borderRadius: '6px',
                    fontSize: '11px',
                    color: '#fff',
                    border: '1px solid rgba(33, 150, 243, 0.5)',
                    fontWeight: 'bold'
                  }}>
                    {tag}
                  </div>
                ))}
              </div>
              
              <div style={{
                padding: '15px',
                background: 'rgba(0, 0, 0, 0.3)',
                borderRadius: '10px',
                fontSize: '12px',
                color: '#fff',
                textAlign: 'center',
                fontWeight: 'bold'
              }}>
                Click to activate Baccarat →
              </div>
            </div>
          </div>

          {/* Roulette Card */}
          <div
            onClick={() => {
              console.log('🎰 Roulette card clicked!');
              setActiveGame('roulette');
            }}
            className="game-card"
            style={{
              background: 'linear-gradient(135deg, rgba(139, 0, 0, 0.4) 0%, rgba(90, 0, 0, 0.6) 100%)',
              backdropFilter: 'blur(20px)',
              border: '3px solid #8b0000',
              borderRadius: '20px',
              padding: '40px',
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              position: 'relative',
              overflow: 'hidden',
              boxShadow: '0 10px 40px rgba(0, 0, 0, 0.5)'
            }}
          >
            <div style={{
              position: 'absolute',
              top: '-50%',
              right: '-20%',
              width: '300px',
              height: '300px',
              background: 'radial-gradient(circle, rgba(139, 0, 0, 0.1) 0%, transparent 70%)',
              pointerEvents: 'none'
            }} />
            
            <div style={{ position: 'relative', zIndex: 1 }}>
              <div style={{
                width: '80px',
                height: '80px',
                background: 'rgba(139, 0, 0, 0.2)',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '25px',
                border: '2px solid #8b0000'
              }}>
                <Circle size={40} color="#8b0000" />
              </div>
              
              <div style={{
                fontSize: '36px',
                fontWeight: 'bold',
                color: '#fff',
                marginBottom: '15px',
                letterSpacing: '2px'
              }}>
                ROULETTE
              </div>
              
              <div style={{
                color: '#fff',
                fontSize: '14px',
                lineHeight: '1.8',
                marginBottom: '25px'
              }}>
                American double-zero roulette. Bet on numbers, colors, or ranges. Inside and outside bets available.
              </div>
              
              <div style={{
                display: 'flex',
                gap: '10px',
                flexWrap: 'wrap',
                marginBottom: '25px'
              }}>
                {['0 & 00', 'Straight Up 35:1', 'Inside & Outside'].map(tag => (
                  <div key={tag} style={{
                    background: 'rgba(255, 255, 255, 0.2)',
                    padding: '6px 12px',
                    borderRadius: '6px',
                    fontSize: '11px',
                    color: '#fff',
                    border: '1px solid rgba(255, 255, 255, 0.3)',
                    fontWeight: 'bold'
                  }}>
                    {tag}
                  </div>
                ))}
              </div>
              
              <div style={{
                padding: '15px',
                background: 'rgba(0, 0, 0, 0.3)',
                borderRadius: '10px',
                fontSize: '12px',
                color: '#fff',
                textAlign: 'center',
                fontWeight: 'bold'
              }}>
                Click to activate Roulette →
              </div>
            </div>
          </div>
        </div>

        {/* Session Settings */}
        <div style={{
          padding: '25px',
          background: 'rgba(0, 0, 0, 0.3)',
          backdropFilter: 'blur(10px)',
          borderRadius: '15px',
          border: '1px solid rgba(212, 175, 55, 0.2)',
          marginBottom: '20px'
        }}>
          <div style={{ color: '#d4af37', fontSize: '12px', fontWeight: 'bold', letterSpacing: '2px', marginBottom: '15px' }}>
            💰 STARTING STACK
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
            {[500, 1000, 2500, 5000, 10000].map(amount => (
              <button
                key={amount}
                onClick={async () => {
                  setStartingChips(amount);
                  const chipsRef = ref(db, 'session/settings/startingChips');
                  await set(chipsRef, amount);
                }}
                style={{
                  flex: 1,
                  padding: '12px 8px',
                  background: startingChips === amount ? '#d4af37' : 'rgba(255,255,255,0.05)',
                  border: startingChips === amount ? '2px solid #d4af37' : '1px solid #555',
                  borderRadius: '8px',
                  color: startingChips === amount ? '#000' : '#aaa',
                  fontSize: '14px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  minWidth: '70px'
                }}
              >
                ${amount.toLocaleString()}
              </button>
            ))}
          </div>
          <button
            onClick={async () => {
              if (confirm(`Reset ALL players and yourself to $${startingChips.toLocaleString()}?`)) {
                // Read all users and reset their bankroll
                const usersRef = ref(db, 'session/users');
                const snap = await new Promise((resolve) => {
                  onValue(usersRef, (snapshot) => resolve(snapshot), { onlyOnce: true });
                });
                if (snap.exists()) {
                  const users = snap.val();
                  for (const uid of Object.keys(users)) {
                    const userRef = ref(db, `session/users/${uid}`);
                    await set(userRef, { ...users[uid], bankroll: startingChips });
                    const lbRef = ref(db, `session/leaderboard/${uid}`);
                    await set(lbRef, { userId: uid, name: users[uid].name, bankroll: startingChips, isAdmin: users[uid].isAdmin || false, timestamp: Date.now() });
                  }
                }
                alert(`✅ All players reset to $${startingChips.toLocaleString()}`);
              }
            }}
            style={{
              width: '100%',
              padding: '12px',
              background: 'rgba(76, 175, 80, 0.2)',
              border: '1px solid #4caf50',
              borderRadius: '8px',
              color: '#4caf50',
              fontSize: '12px',
              fontWeight: 'bold',
              letterSpacing: '1px',
              cursor: 'pointer',
              fontFamily: 'inherit',
              textTransform: 'uppercase',
              marginBottom: '8px'
            }}
          >
            🔄 Reset All Players to ${startingChips.toLocaleString()}
          </button>
          <div style={{ fontSize: '11px', color: '#666' }}>
            New players joining will start with ${startingChips.toLocaleString()}
          </div>
        </div>

        {/* Footer */}
        <div style={{
          textAlign: 'center',
          padding: '30px',
          background: 'rgba(0, 0, 0, 0.3)',
          backdropFilter: 'blur(10px)',
          borderRadius: '15px',
          border: '1px solid rgba(255, 255, 255, 0.1)'
        }}>
          <button
            onClick={deactivateGame}
            style={{
              padding: '16px 50px',
              background: 'linear-gradient(135deg, #d4af37 0%, #f4e5a1 100%)',
              border: 'none',
              borderRadius: '8px',
              color: '#000',
              fontSize: '14px',
              fontWeight: 'bold',
              letterSpacing: '2px',
              cursor: 'pointer',
              fontFamily: 'inherit',
              textTransform: 'uppercase',
              marginBottom: '20px',
              boxShadow: '0 4px 20px rgba(212, 175, 55, 0.3)'
            }}
          >
            🏁 END SESSION — Show Final Leaderboard
          </button>
          <div style={{
            color: '#d4af37',
            fontSize: '13px',
            fontWeight: 'bold',
            marginBottom: '15px',
            letterSpacing: '2px'
          }}>
            🎮 DEALER INSTRUCTIONS
          </div>
          <div style={{
            color: '#fff',
            fontSize: '12px',
            lineHeight: '1.8',
            maxWidth: '800px',
            margin: '0 auto'
          }}>
            Click on a game card above to set it as the active game. All players will automatically 
            join that game. You can switch games at any time by clicking the back arrow in the game 
            and selecting a different one here.
            <br /><br />
            <span style={{ color: '#888', fontSize: '11px' }}>
              Virtual entertainment only • No real money • 18+ only • Not affiliated with any casino
            </span>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes glow {
          from {
            text-shadow: 0 0 20px rgba(212, 175, 55, 0.3);
          }
          to {
            text-shadow: 0 0 40px rgba(212, 175, 55, 0.6), 0 0 60px rgba(212, 175, 55, 0.4);
          }
        }
        
        @keyframes pulse {
          0%, 100% {
            opacity: 0.3;
            transform: scale(0.8);
          }
          50% {
            opacity: 1;
            transform: scale(1.2);
          }
        }
        
        .game-card:hover {
          transform: translateY(-10px);
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.7) !important;
        }
        
        * {
          box-sizing: border-box;
        }
      `}</style>
    </div>
  );
};

export default App;
