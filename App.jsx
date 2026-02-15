import React, { useState, useEffect } from 'react';
import { Dice1, Spade, ArrowLeft, Circle } from 'lucide-react';

// Import your game components
import CrapsGame from './CrapsGame';
import BaccaratGame from './BaccaratGame';
import RouletteGame from './RouletteGame';

const App = () => {
  const [selectedGame, setSelectedGame] = useState(null);
  const [isDealerMode, setIsDealerMode] = useState(false);
  const [dealerPassword, setDealerPassword] = useState('');
  const [showDealerLogin, setShowDealerLogin] = useState(false);
  
  const DEALER_PASSWORD = 'dealer2024'; // CHANGE THIS!

  // Load active game from shared storage
  useEffect(() => {
    if (!isDealerMode) {
      loadActiveGame();
      
      // Poll every 2 seconds to check for game changes (players only)
      const interval = setInterval(loadActiveGame, 2000);
      return () => clearInterval(interval);
    }
  }, [isDealerMode]);

  const loadActiveGame = async () => {
    try {
      const result = await window.storage.get('active-game', true);
      if (result && !isDealerMode) {
        const activeGame = JSON.parse(result.value);
        setSelectedGame(activeGame.game);
      }
    } catch (e) {
      // No active game set yet
    }
  };

  const setActiveGame = async (game) => {
    console.log('🎮 Dealer selecting game:', game);
    console.log('📊 Current state - isDealerMode:', isDealerMode, 'selectedGame:', selectedGame);
    
    try {
      await window.storage.set('active-game', JSON.stringify({ 
        game, 
        timestamp: Date.now() 
      }), true);
      console.log('✅ Saved to storage, now setting local state...');
      setSelectedGame(game);
      console.log('✅ Local state set to:', game);
    } catch (e) {
      console.error('❌ Failed to set active game:', e);
      alert('Failed to set active game. Error: ' + e.message);
    }
  };

  const handleDealerLogin = () => {
    if (dealerPassword === DEALER_PASSWORD) {
      setIsDealerMode(true);
      setShowDealerLogin(false);
      setDealerPassword('');
    } else {
      alert('❌ Invalid dealer password');
      setDealerPassword('');
    }
  };

  // Render selected game
  if (selectedGame === 'craps') {
    return <CrapsGame onBack={() => isDealerMode ? setSelectedGame(null) : null} />;
  }

  if (selectedGame === 'baccarat') {
    return <BaccaratGame onBack={() => isDealerMode ? setSelectedGame(null) : null} />;
  }

  if (selectedGame === 'roulette') {
    return <RouletteGame onBack={() => isDealerMode ? setSelectedGame(null) : null} />;
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

  // Player Waiting Screen (no active game)
  if (!isDealerMode && !selectedGame) {
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
          maxWidth: '600px',
          width: '100%'
        }}>
          <div style={{
            fontSize: '64px',
            marginBottom: '20px'
          }}>
            ⏳
          </div>
          <div style={{
            fontSize: '32px',
            fontWeight: 'bold',
            color: '#d4af37',
            marginBottom: '15px',
            letterSpacing: '3px'
          }}>
            WAITING FOR DEALER
          </div>
          <div style={{
            color: '#888',
            fontSize: '16px',
            lineHeight: '1.8',
            marginBottom: '30px'
          }}>
            No game is currently active. Please wait for the dealer to start a session.
          </div>
          
          {/* Animated dots */}
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            gap: '10px',
            marginBottom: '40px'
          }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{
                width: '12px',
                height: '12px',
                borderRadius: '50%',
                background: '#d4af37',
                animation: `pulse 1.5s ease-in-out ${i * 0.2}s infinite`
              }} />
            ))}
          </div>
          
          <div style={{
            padding: '20px',
            background: 'rgba(212, 175, 55, 0.1)',
            borderRadius: '12px',
            border: '1px solid rgba(212, 175, 55, 0.2)'
          }}>
            <div style={{ color: '#d4af37', fontSize: '12px', marginBottom: '8px', fontWeight: 'bold' }}>
              💡 TIP
            </div>
            <div style={{ color: '#888', fontSize: '12px', lineHeight: '1.6' }}>
              The game will start automatically when the dealer selects one. Keep this page open.
            </div>
          </div>
          
          <button
            onClick={() => setShowDealerLogin(true)}
            style={{
              marginTop: '30px',
              padding: '12px 24px',
              background: 'rgba(212, 175, 55, 0.2)',
              border: '2px solid #d4af37',
              borderRadius: '8px',
              color: '#d4af37',
              fontSize: '11px',
              fontWeight: 'bold',
              letterSpacing: '2px',
              cursor: 'pointer',
              fontFamily: 'inherit',
              textTransform: 'uppercase'
            }}
          >
            🔐 Dealer Login
          </button>
        </div>
      </div>
    );
  }

  // Dealer Game Selection Hub
  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0a0e27 0%, #1a1f3a 50%, #0f1829 100%)',
      backgroundImage: `
        radial-gradient(circle at 20% 30%, rgba(212, 175, 55, 0.15) 0%, transparent 50%),
        radial-gradient(circle at 80% 70%, rgba(33, 150, 243, 0.1) 0%, transparent 50%)
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

        {/* Footer */}
        <div style={{
          textAlign: 'center',
          padding: '30px',
          background: 'rgba(0, 0, 0, 0.3)',
          backdropFilter: 'blur(10px)',
          borderRadius: '15px',
          border: '1px solid rgba(255, 255, 255, 0.1)'
        }}>
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
