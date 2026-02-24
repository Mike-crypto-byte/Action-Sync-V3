import React, { useState, useEffect } from 'react';
import { database as db, ref, onValue } from './firebase.js';

const StreamOverlay = () => {
  const [activeGame, setActiveGame] = useState(null);
  const [gameState, setGameState] = useState({});
  const [leaderboard, setLeaderboard] = useState([]);
  const [activeUsers, setActiveUsers] = useState(0);
  const [startingChips, setStartingChips] = useState(1000);

  // Listen to active game
  useEffect(() => {
    const unsub = onValue(ref(db, 'activeGame'), (snap) => {
      if (snap.exists()) {
        const data = snap.val();
        setActiveGame(data.game || null);
      } else {
        setActiveGame(null);
      }
    });
    return () => unsub();
  }, []);

  // Listen to game state
  useEffect(() => {
    if (!activeGame) return;
    const unsub = onValue(ref(db, `games/${activeGame}/state`), (snap) => {
      if (snap.exists()) setGameState(snap.val());
    });
    return () => unsub();
  }, [activeGame]);

  // Listen to leaderboard
  useEffect(() => {
    const unsub = onValue(ref(db, 'session/leaderboard'), (snap) => {
      if (snap.exists()) {
        const data = snap.val();
        const sorted = Object.values(data)
          .sort((a, b) => b.bankroll - a.bankroll)
          .slice(0, 8);
        setLeaderboard(sorted);
      }
    });
    return () => unsub();
  }, []);

  // Listen to presence
  useEffect(() => {
    const unsub = onValue(ref(db, 'session/presence'), (snap) => {
      if (snap.exists()) {
        const data = snap.val();
        const now = Date.now();
        const active = Object.values(data).filter(u => now - u.lastSeen < 30000);
        setActiveUsers(active.length);
      }
    });
    return () => unsub();
  }, []);

  // Listen to starting chips
  useEffect(() => {
    const unsub = onValue(ref(db, 'session/settings/startingChips'), (snap) => {
      if (snap.exists()) setStartingChips(snap.val());
    });
    return () => unsub();
  }, []);

  const gameName = activeGame === 'roulette' ? '🎰 ROULETTE'
    : activeGame === 'craps' ? '🎲 CRAPS'
    : activeGame === 'baccarat' ? '🃏 BACCARAT'
    : null;

  const gameEmoji = activeGame === 'roulette' ? '🎰'
    : activeGame === 'craps' ? '🎲'
    : activeGame === 'baccarat' ? '🃏'
    : '⏳';

  // Countdown ring
  const countdown = gameState.countdown || 0;
  const maxCountdown = 15;
  const countdownPct = countdown / maxCountdown;
  const circumference = 2 * Math.PI * 40;
  const strokeDashoffset = circumference * (1 - countdownPct);

  // Results history
  const getResultHistory = () => {
    if (activeGame === 'roulette') {
      return (gameState.spinHistory || []).slice(0, 12);
    } else if (activeGame === 'craps') {
      return (gameState.rollHistory || []).slice(0, 12);
    } else if (activeGame === 'baccarat') {
      return (gameState.roadmap || []).slice(0, 12);
    }
    return [];
  };

  const getNumberColor = (num) => {
    const n = parseInt(num);
    if (n === 0) return '#2ecc71';
    const reds = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
    return reds.includes(n) ? '#e74c3c' : '#333';
  };

  if (!activeGame) {
    return (
      <div style={{
        width: '100vw', height: '100vh',
        background: 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: '"Courier New", monospace'
      }}>
        <div style={{
          background: 'rgba(0,0,0,0.85)',
          borderRadius: '16px',
          padding: '30px 50px',
          textAlign: 'center',
          border: '1px solid rgba(212,175,55,0.3)'
        }}>
          <div style={{ fontSize: '32px', marginBottom: '10px' }}>⏳</div>
          <div style={{ color: '#d4af37', fontSize: '16px', letterSpacing: '3px', fontWeight: 'bold' }}>
            WAITING FOR SESSION
          </div>
          <div style={{ color: '#666', fontSize: '12px', marginTop: '8px' }}>
            {activeUsers} players connected
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      width: '100vw', height: '100vh',
      background: 'transparent',
      fontFamily: '"Courier New", monospace',
      padding: '20px',
      display: 'flex',
      flexDirection: 'column',
      gap: '15px',
      pointerEvents: 'none'
    }}>
      {/* Top Bar — Game info + Countdown */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        {/* Game Badge */}
        <div style={{
          background: 'rgba(0,0,0,0.85)',
          borderRadius: '12px',
          padding: '12px 24px',
          border: '1px solid rgba(212,175,55,0.4)',
          display: 'flex',
          alignItems: 'center',
          gap: '12px'
        }}>
          <div style={{ fontSize: '24px' }}>{gameEmoji}</div>
          <div>
            <div style={{ color: '#d4af37', fontSize: '14px', fontWeight: 'bold', letterSpacing: '2px' }}>
              {gameName}
            </div>
            <div style={{ color: '#888', fontSize: '10px', letterSpacing: '1px' }}>
              Round #{gameState.roundNumber || gameState.rollNumber || 0} • {activeUsers} players
            </div>
          </div>
        </div>

        {/* Countdown Ring */}
        {gameState.bettingOpen && countdown > 0 && (
          <div style={{
            background: 'rgba(0,0,0,0.85)',
            borderRadius: '12px',
            padding: '10px 20px',
            border: `1px solid ${countdown <= 5 ? '#f44336' : '#4caf50'}`,
            display: 'flex',
            alignItems: 'center',
            gap: '12px'
          }}>
            <svg width="50" height="50" viewBox="0 0 90 90">
              <circle cx="45" cy="45" r="40" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="4" />
              <circle cx="45" cy="45" r="40" fill="none"
                stroke={countdown <= 5 ? '#f44336' : '#4caf50'}
                strokeWidth="4"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                transform="rotate(-90 45 45)"
                style={{ transition: 'stroke-dashoffset 1s linear' }}
              />
              <text x="45" y="50" textAnchor="middle" fill="#fff" fontSize="22" fontWeight="bold" fontFamily="Courier New">
                {countdown}
              </text>
            </svg>
            <div>
              <div style={{ color: '#4caf50', fontSize: '11px', fontWeight: 'bold', letterSpacing: '2px' }}>
                BETTING OPEN
              </div>
              <div style={{ color: '#888', fontSize: '9px' }}>
                Place your bets!
              </div>
            </div>
          </div>
        )}

        {/* Betting Closed indicator */}
        {!gameState.bettingOpen && (
          <div style={{
            background: 'rgba(0,0,0,0.85)',
            borderRadius: '12px',
            padding: '12px 24px',
            border: '1px solid rgba(244,67,54,0.4)'
          }}>
            <div style={{ color: '#f44336', fontSize: '11px', fontWeight: 'bold', letterSpacing: '2px' }}>
              🔴 NO MORE BETS
            </div>
          </div>
        )}
      </div>

      {/* Middle section — spacer to push content to edges */}
      <div style={{ flex: 1 }} />

      {/* Bottom — Results + Leaderboard */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
        gap: '20px'
      }}>
        {/* Recent Results */}
        <div style={{
          background: 'rgba(0,0,0,0.85)',
          borderRadius: '12px',
          padding: '15px 20px',
          border: '1px solid rgba(255,255,255,0.1)',
          minWidth: '300px'
        }}>
          <div style={{ color: '#888', fontSize: '10px', letterSpacing: '2px', marginBottom: '10px', fontWeight: 'bold' }}>
            RECENT RESULTS
          </div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {getResultHistory().length === 0 ? (
              <div style={{ color: '#555', fontSize: '11px' }}>No results yet</div>
            ) : activeGame === 'roulette' ? (
              getResultHistory().map((r, i) => (
                <div key={i} style={{
                  width: '32px', height: '32px',
                  borderRadius: '50%',
                  background: getNumberColor(r.number),
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontSize: '12px', fontWeight: 'bold',
                  border: '2px solid rgba(255,255,255,0.2)',
                  opacity: 1 - (i * 0.06)
                }}>
                  {r.number}
                </div>
              ))
            ) : activeGame === 'craps' ? (
              getResultHistory().map((r, i) => (
                <div key={i} style={{
                  padding: '4px 10px',
                  borderRadius: '6px',
                  background: r.total === 7 || r.total === 11 ? 'rgba(76,175,80,0.3)' :
                    r.total === 2 || r.total === 3 || r.total === 12 ? 'rgba(244,67,54,0.3)' : 'rgba(255,255,255,0.1)',
                  color: '#fff', fontSize: '12px', fontWeight: 'bold',
                  border: '1px solid rgba(255,255,255,0.2)',
                  opacity: 1 - (i * 0.06)
                }}>
                  {r.dice1 && r.dice2 ? `${r.total || (r.dice1+r.dice2)}` : r.total}
                </div>
              ))
            ) : activeGame === 'baccarat' ? (
              getResultHistory().map((r, i) => (
                <div key={i} style={{
                  padding: '4px 8px',
                  borderRadius: '6px',
                  background: r.winner === 'player' ? 'rgba(33,150,243,0.3)' :
                    r.winner === 'banker' ? 'rgba(244,67,54,0.3)' : 'rgba(76,175,80,0.3)',
                  color: '#fff', fontSize: '10px', fontWeight: 'bold',
                  border: '1px solid rgba(255,255,255,0.2)',
                  opacity: 1 - (i * 0.06)
                }}>
                  {r.winner === 'player' ? 'P' : r.winner === 'banker' ? 'B' : 'T'}
                </div>
              ))
            ) : null}
          </div>
        </div>

        {/* Leaderboard */}
        <div style={{
          background: 'rgba(0,0,0,0.85)',
          borderRadius: '12px',
          padding: '15px 20px',
          border: '1px solid rgba(212,175,55,0.3)',
          minWidth: '280px'
        }}>
          <div style={{ color: '#d4af37', fontSize: '10px', letterSpacing: '2px', marginBottom: '10px', fontWeight: 'bold' }}>
            🏆 LEADERBOARD
          </div>
          {leaderboard.length === 0 ? (
            <div style={{ color: '#555', fontSize: '11px' }}>No players yet</div>
          ) : (
            leaderboard.slice(0, 6).map((player, idx) => {
              const pnl = Math.round(player.bankroll - startingChips);
              return (
                <div key={idx} style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '4px 0',
                  borderBottom: idx < Math.min(leaderboard.length, 6) - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{
                      fontSize: '12px',
                      color: idx === 0 ? '#d4af37' : idx === 1 ? '#c0c0c0' : idx === 2 ? '#cd7f32' : '#666'
                    }}>
                      {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`}
                    </span>
                    <span style={{ color: '#fff', fontSize: '12px' }}>{player.name}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ color: '#fff', fontSize: '12px', fontWeight: 'bold' }}>
                      ${Math.round(player.bankroll).toLocaleString()}
                    </span>
                    <span style={{
                      fontSize: '10px',
                      color: pnl >= 0 ? '#4caf50' : '#f44336',
                      minWidth: '50px',
                      textAlign: 'right'
                    }}>
                      {pnl >= 0 ? '+' : ''}{pnl.toLocaleString()}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Branding */}
      <div style={{
        textAlign: 'center',
        padding: '5px'
      }}>
        <span style={{
          background: 'rgba(0,0,0,0.7)',
          padding: '4px 16px',
          borderRadius: '20px',
          color: '#d4af37',
          fontSize: '10px',
          letterSpacing: '3px',
          fontWeight: 'bold'
        }}>
          ACTION SYNC
        </span>
      </div>
    </div>
  );
};

export default StreamOverlay;
