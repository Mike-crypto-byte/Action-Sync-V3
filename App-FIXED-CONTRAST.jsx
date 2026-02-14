import React, { useState } from 'react';
import { Dice1, Spade, ArrowLeft, Circle } from 'lucide-react';

// Import your game components
import CrapsGame from './CrapsGame';
import BaccaratGame from './BaccaratGame';
import RouletteGame from './RouletteGame';

const App = () => {
  const [selectedGame, setSelectedGame] = useState(null); // null, 'craps', 'baccarat', or 'roulette'

  // Render selected game
  if (selectedGame === 'craps') {
    return <CrapsGame onBack={() => setSelectedGame(null)} />;
  }

  if (selectedGame === 'baccarat') {
    return <BaccaratGame onBack={() => setSelectedGame(null)} />;
  }

  if (selectedGame === 'roulette') {
    return <RouletteGame onBack={() => setSelectedGame(null)} />;
  }

  // Game Selection Hub
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
            Live Casino Experience
          </div>
          <div style={{
            color: '#666',
            fontSize: '12px',
            letterSpacing: '2px'
          }}>
            Play along with live creators • Virtual currency only
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
            onClick={() => setSelectedGame('craps')}
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
              background: 'radial-gradient(circle, rgba(212, 175, 55, 0.1) 0%, transparent 70%)',
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
                place bets, hard ways, hop bets, and more. Standard and crapless modes available.
              </div>
              
              <div style={{
                display: 'flex',
                gap: '10px',
                flexWrap: 'wrap',
                marginBottom: '25px'
              }}>
                <div style={{
                  background: 'rgba(212, 175, 55, 0.3)',
                  padding: '6px 12px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  color: '#fff',
                  border: '1px solid rgba(212, 175, 55, 0.5)',
                  fontWeight: 'bold'
                }}>
                  15+ Bet Types
                </div>
                <div style={{
                  background: 'rgba(212, 175, 55, 0.3)',
                  padding: '6px 12px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  color: '#fff',
                  border: '1px solid rgba(212, 175, 55, 0.5)',
                  fontWeight: 'bold'
                }}>
                  Odds Bets
                </div>
                <div style={{
                  background: 'rgba(212, 175, 55, 0.3)',
                  padding: '6px 12px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  color: '#fff',
                  border: '1px solid rgba(212, 175, 55, 0.5)',
                  fontWeight: 'bold'
                }}>
                  Fire Bet
                </div>
              </div>
              
              <div style={{
                padding: '15px',
                background: 'rgba(0, 0, 0, 0.3)',
                borderRadius: '10px',
                fontSize: '12px',
                color: '#888',
                textAlign: 'center'
              }}>
                Click to play Craps →
              </div>
            </div>
          </div>

          {/* Baccarat Card */}
          <div
            onClick={() => setSelectedGame('baccarat')}
            className="game-card"
            style={{
              background: 'linear-gradient(135deg, rgba(26, 95, 122, 0.4) 0%, rgba(13, 61, 77, 0.6) 100%)',
              backdropFilter: 'blur(20px)',
              border: '3px solid #1a5f7a',
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
                Features Dragon and Panda bonus bets with visual roadmap tracking.
              </div>
              
              <div style={{
                display: 'flex',
                gap: '10px',
                flexWrap: 'wrap',
                marginBottom: '25px'
              }}>
                <div style={{
                  background: 'rgba(33, 150, 243, 0.3)',
                  padding: '6px 12px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  color: '#fff',
                  border: '1px solid rgba(33, 150, 243, 0.5)',
                  fontWeight: 'bold'
                }}>
                  Player/Banker/Tie
                </div>
                <div style={{
                  background: 'rgba(33, 150, 243, 0.3)',
                  padding: '6px 12px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  color: '#fff',
                  border: '1px solid rgba(33, 150, 243, 0.5)',
                  fontWeight: 'bold'
                }}>
                  🐉 Dragon Bonus
                </div>
                <div style={{
                  background: 'rgba(33, 150, 243, 0.3)',
                  padding: '6px 12px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  color: '#fff',
                  border: '1px solid rgba(33, 150, 243, 0.5)',
                  fontWeight: 'bold'
                }}>
                  🐼 Panda Bonus
                </div>
              </div>
              
              <div style={{
                padding: '15px',
                background: 'rgba(0, 0, 0, 0.3)',
                borderRadius: '10px',
                fontSize: '12px',
                color: '#888',
                textAlign: 'center'
              }}>
                Click to play Baccarat →
              </div>
            </div>
          </div>

          {/* Roulette Card */}
          <div
            onClick={() => setSelectedGame('roulette')}
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
                <div style={{
                  background: 'rgba(255, 255, 255, 0.2)',
                  padding: '6px 12px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  color: '#fff',
                  border: '1px solid rgba(255, 255, 255, 0.3)',
                  fontWeight: 'bold'
                }}>
                  0 & 00
                </div>
                <div style={{
                  background: 'rgba(255, 255, 255, 0.2)',
                  padding: '6px 12px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  color: '#fff',
                  border: '1px solid rgba(255, 255, 255, 0.3)',
                  fontWeight: 'bold'
                }}>
                  Straight Up 35:1
                </div>
                <div style={{
                  background: 'rgba(255, 255, 255, 0.2)',
                  padding: '6px 12px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  color: '#fff',
                  border: '1px solid rgba(255, 255, 255, 0.3)',
                  fontWeight: 'bold'
                }}>
                  Inside & Outside
                </div>
              </div>
              
              <div style={{
                padding: '15px',
                background: 'rgba(0, 0, 0, 0.3)',
                borderRadius: '10px',
                fontSize: '12px',
                color: '#888',
                textAlign: 'center'
              }}>
                Click to play Roulette →
              </div>
            </div>
          </div>
        </div>

        {/* Footer Info */}
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
            🎮 HOW IT WORKS
          </div>
          <div style={{
            color: '#fff',
            fontSize: '12px',
            lineHeight: '1.8',
            maxWidth: '800px',
            margin: '0 auto'
          }}>
            Join a live session with your favorite creator. Start with $1,000 virtual chips. 
            Place your bets before each round. Watch the creator play in real-time at a 
            physical casino. See results instantly. Climb the leaderboard. Chat with other fans.
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
