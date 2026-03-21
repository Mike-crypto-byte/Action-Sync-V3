// App.jsx — Phase 2: Firebase Auth + persistent sessions
import React, { useState, useEffect } from 'react';
import { Dice1, Spade, ArrowLeft, Circle } from 'lucide-react';
import { database as db, ref, onValue, set } from './firebase.js';
import { useAuth } from './useAuth.js';
import { startNewSession, useSessionHistory } from './useFirebaseSync.js';

// Import your game components
import CrapsGame from './CrapsGame';
import BaccaratGame from './BaccaratGame';
import RouletteGame from './RouletteGame';
import StreamOverlay from './StreamOverlay';

// ── URL helpers ────────────────────────────────────────────────────────────────
// Dealer shares:  ?dealer={dealerUid}
// Overlay URL:    ?dealer={dealerUid}#overlay
const getDealerUidFromUrl = () =>
  new URLSearchParams(window.location.search).get('dealer') || null;

const App = () => {
  // ── Overlay route ────────────────────────────────────────────────────────────
  if (window.location.hash === '#overlay' || window.location.pathname === '/overlay') {
    return <StreamOverlay roomCode={getDealerUidFromUrl()} />;
  }

  // ── Auth ─────────────────────────────────────────────────────────────────────
  const {
    user, role, authLoading, authError, setAuthError,
    dealerSignIn, dealerSignUp, playerSignIn, playerSignUp,
    signOut, isDealer, isPlayer,
  } = useAuth();

  // dealerUid is the permanent room ID — from URL for players, from auth for dealer
  const dealerUid = isDealer ? user?.uid : getDealerUidFromUrl();

  // ── UI state ─────────────────────────────────────────────────────────────────
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const [selectedGame, setSelectedGame]             = useState(null);
  const [startingChips, setStartingChips]           = useState(1000);
  const [sessionLeaderboard, setSessionLeaderboard] = useState(null);
  const [showSessionSummary, setShowSessionSummary] = useState(false);
  const [showNewSessionConfirm, setShowNewSessionConfirm] = useState(false);
  const [newSessionLoading, setNewSessionLoading]   = useState(false);

  // Auth form state
  const [authMode, setAuthMode]         = useState('playerSignIn'); // 'playerSignIn' | 'playerSignUp' | 'dealerSignIn' | 'dealerSignUp'
  const [formEmail, setFormEmail]       = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formName, setFormName]         = useState('');
  const [formLoading, setFormLoading]   = useState(false);

  // Session history for the running leaderboard panel
  const sessionHistory = useSessionHistory(dealerUid);

  // ── Read dealer settings (startingChips) ─────────────────────────────────────
  useEffect(() => {
    if (!dealerUid) return;
    const unsub = onValue(ref(db, `rooms/${dealerUid}/settings/startingChips`), (snap) => {
      if (snap.exists()) setStartingChips(snap.val());
    });
    return () => unsub();
  }, [dealerUid]);

  // ── Write dealerUid to URL when dealer logs in ────────────────────────────────
  useEffect(() => {
    if (isDealer && user) {
      const params = new URLSearchParams(window.location.search);
      if (params.get('dealer') !== user.uid) {
        params.set('dealer', user.uid);
        window.history.replaceState({}, '', `?${params.toString()}`);
      }
    }
  }, [isDealer, user]);

  // ── Active game listener (players) ───────────────────────────────────────────
  useEffect(() => {
    if (!isPlayer || !dealerUid) return;
    const unsub = onValue(ref(db, `rooms/${dealerUid}/session/activeGame`), (snap) => {
      if (snap.exists() && snap.val()) {
        setSelectedGame(snap.val());
        setShowSessionSummary(false);
      } else {
        setSelectedGame(null);
      }
    });
    return () => unsub();
  }, [isPlayer, dealerUid]);

  // ── End-of-session listener (players) ────────────────────────────────────────
  useEffect(() => {
    if (!isPlayer || !dealerUid) return;
    const unsub = onValue(ref(db, `rooms/${dealerUid}/session`), (snap) => {
      if (snap.exists()) {
        const session = snap.val();
        if (session.status === 'ended' && session.finalLeaderboard) {
          const players = Object.values(session.finalLeaderboard)
            .sort((a, b) => b.bankroll - a.bankroll);
          setSessionLeaderboard(players);
          setShowSessionSummary(true);
        }
      }
    });
    return () => unsub();
  }, [isPlayer, dealerUid]);

  // ── Dealer: set active game ───────────────────────────────────────────────────
  const setActiveGame = async (game) => {
    if (!dealerUid) return;
    try {
      await set(ref(db, `rooms/${dealerUid}/session/activeGame`), game);
      setSelectedGame(game);
    } catch (e) {
      console.error('Failed to set active game:', e);
      alert('Failed to set active game: ' + e.message);
    }
  };

  // ── Dealer: deactivate game without ending session ────────────────────────────
  const deactivateGame = async () => {
    if (!dealerUid) return;
    try {
      await set(ref(db, `rooms/${dealerUid}/session/activeGame`), null);
      setSelectedGame(null);
    } catch (e) {
      console.error('Failed to deactivate game:', e);
    }
  };

  // ── Dealer: start new stream session ─────────────────────────────────────────
  const handleStartNewSession = async () => {
    setNewSessionLoading(true);
    try {
      await startNewSession(dealerUid, startingChips);
      setShowNewSessionConfirm(false);
      setShowSessionSummary(false);
      setSessionLeaderboard(null);
      setSelectedGame(null);
    } catch (e) {
      console.error('Failed to start new session:', e);
      alert('Failed to start new session: ' + e.message);
    } finally {
      setNewSessionLoading(false);
    }
  };

  // ── Dealer: update starting chips ────────────────────────────────────────────
  const handleSetStartingChips = async (amount) => {
    setStartingChips(amount);
    if (dealerUid) {
      await set(ref(db, `rooms/${dealerUid}/settings/startingChips`), amount);
    }
  };

  // ── Dealer: reset all bankrolls mid-session ───────────────────────────────────
  const handleResetAllBankrolls = async () => {
    if (!dealerUid || !confirm(`Reset ALL players to $${startingChips.toLocaleString()}?`)) return;
    const playersSnap = await new Promise((resolve) =>
      onValue(ref(db, `rooms/${dealerUid}/players`), resolve, { onlyOnce: true })
    );
    if (playersSnap.exists()) {
      const players = playersSnap.val();
      for (const uid of Object.keys(players)) {
        await set(ref(db, `rooms/${dealerUid}/players/${uid}/bankroll`), startingChips);
        await set(ref(db, `rooms/${dealerUid}/session/leaderboard/${uid}/bankroll`), startingChips);
      }
    }
    alert(`✅ All players reset to $${startingChips.toLocaleString()}`);
  };

  // ── Auth form submit ──────────────────────────────────────────────────────────
  const handleAuthSubmit = async () => {
    if (formLoading) return;
    setAuthError(null);
    setFormLoading(true);
    try {
      if (authMode === 'dealerSignIn') {
        await dealerSignIn(formEmail, formPassword);
      } else if (authMode === 'dealerSignUp') {
        await dealerSignUp(formEmail, formPassword, formName || 'Dealer');
      } else if (authMode === 'playerSignIn') {
        if (!dealerUid) throw new Error('No dealer room found. Make sure you have the correct join link.');
        await playerSignIn(formEmail, formPassword, dealerUid, startingChips);
      } else if (authMode === 'playerSignUp') {
        if (!dealerUid) throw new Error('No dealer room found. Make sure you have the correct join link.');
        if (!formName.trim()) throw new Error('Display name is required.');
        await playerSignUp(formEmail, formPassword, formName.trim(), dealerUid, startingChips);
      }
      setFormEmail(''); setFormPassword(''); setFormName('');
    } catch (e) {
      // authError is set inside useAuth, no extra action needed
    } finally {
      setFormLoading(false);
    }
  };
  // ── Loading splash while Firebase auth restores ───────────────────────────────
  if (authLoading) {
    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0a0e27 0%, #1a1f3a 50%, #0f1829 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: '20px' }}>🎰</div>
          <div style={{ color: '#d4af37', fontSize: '14px', letterSpacing: '3px' }}>LOADING...</div>
        </div>
      </div>
    );
  }

  // ── Not signed in → show auth form ───────────────────────────────────────────
  if (!user) {
    const isSignUp    = authMode === 'playerSignUp' || authMode === 'dealerSignUp';
    const isDealerForm = authMode === 'dealerSignIn' || authMode === 'dealerSignUp';
    const needsDealer = !isDealerForm && !getDealerUidFromUrl();

    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0a0e27 0%, #1a1f3a 50%, #0f1829 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
        <div style={{ background: 'linear-gradient(135deg, #1c1e2a 0%, #252836 100%)', border: '1px solid rgba(212,175,55,0.4)', borderRadius: '15px', padding: isMobile ? '30px 20px' : '50px 40px', maxWidth: '450px', width: '100%', boxShadow: '0 12px 40px rgba(0,0,0,0.4)' }}>

          {/* Logo */}
          <div style={{ textAlign: 'center', marginBottom: '35px' }}>
            <div style={{ fontSize: isMobile ? '36px' : '48px', fontWeight: 'bold', background: 'linear-gradient(135deg, #d4af37 0%, #ffd700 50%, #d4af37 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', letterSpacing: '1.5px', marginBottom: '8px' }}>
              ACTION SYNC
            </div>
            <div style={{ color: '#d4af37', fontSize: '11px', letterSpacing: '2px', textTransform: 'uppercase' }}>
              {isDealerForm ? '🎰 Dealer Portal' : '🎲 Join the Action'}
            </div>
          </div>

          {/* No dealer link warning */}
          {needsDealer && (
            <div style={{ background: 'rgba(244,67,54,0.1)', border: '1px solid rgba(244,67,54,0.4)', borderRadius: '8px', padding: '12px 16px', marginBottom: '20px', color: '#f44336', fontSize: '12px', textAlign: 'center' }}>
              ⚠️ You need a dealer's join link to play.<br />
              <span style={{ color: '#888', fontSize: '11px' }}>Ask your streamer for the link, or log in as a dealer below.</span>
            </div>
          )}

          {/* Form fields */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '20px' }}>
            {isSignUp && (
              <input type="text" value={formName} onChange={e => setFormName(e.target.value)} placeholder={isDealerForm ? 'Dealer display name' : 'Your display name'} style={{ width: '100%', padding: '14px', background: '#0a0a0a', border: '2px solid #444', borderRadius: '8px', color: '#fff', fontSize: '15px', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
            )}
            <input type="email" value={formEmail} onChange={e => setFormEmail(e.target.value)} placeholder="Email address" style={{ width: '100%', padding: '14px', background: '#0a0a0a', border: '2px solid #444', borderRadius: '8px', color: '#fff', fontSize: '15px', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
            <input type="password" value={formPassword} onChange={e => setFormPassword(e.target.value)} onKeyPress={e => e.key === 'Enter' && handleAuthSubmit()} placeholder="Password" style={{ width: '100%', padding: '14px', background: '#0a0a0a', border: '2px solid #444', borderRadius: '8px', color: '#fff', fontSize: '15px', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
          </div>

          {/* Error */}
          {authError && (
            <div style={{ background: 'rgba(244,67,54,0.1)', border: '1px solid rgba(244,67,54,0.3)', borderRadius: '8px', padding: '10px 14px', marginBottom: '16px', color: '#f44336', fontSize: '12px' }}>
              {authError}
            </div>
          )}

          {/* Submit */}
          <button onClick={handleAuthSubmit} disabled={formLoading || needsDealer} style={{ width: '100%', padding: '16px', background: (!formLoading && !needsDealer) ? 'linear-gradient(135deg, #d4af37 0%, #f4e5a1 100%)' : '#333', border: 'none', borderRadius: '8px', color: (!formLoading && !needsDealer) ? '#000' : '#666', fontSize: '15px', fontWeight: 'bold', letterSpacing: '1px', cursor: (!formLoading && !needsDealer) ? 'pointer' : 'not-allowed', fontFamily: 'inherit', textTransform: 'uppercase', marginBottom: '16px' }}>
            {formLoading ? 'Please wait...' : isSignUp ? 'Create Account' : 'Sign In'}
          </button>

          {/* Toggle sign in / sign up */}
          <div style={{ textAlign: 'center', marginBottom: '20px' }}>
            <button onClick={() => { setAuthError(null); setAuthMode(isDealerForm ? (isSignUp ? 'dealerSignIn' : 'dealerSignUp') : (isSignUp ? 'playerSignIn' : 'playerSignUp')); }} style={{ background: 'none', border: 'none', color: '#d4af37', fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit' }}>
              {isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Create one"}
            </button>
          </div>

          {/* Dealer / Player toggle */}
          <div style={{ textAlign: 'center', borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: '16px' }}>
            <button onClick={() => { setAuthError(null); setAuthMode(isDealerForm ? 'playerSignIn' : 'dealerSignIn'); }} style={{ padding: '8px 20px', background: 'transparent', border: '1px solid #444', borderRadius: '6px', color: '#666', fontSize: '10px', cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '1px', textTransform: 'uppercase' }}>
              {isDealerForm ? '🎲 Player Login' : '🔐 Dealer Login'}
            </button>
          </div>

          <div style={{ marginTop: '20px', padding: '10px', background: 'rgba(212,175,55,0.07)', borderRadius: '8px', textAlign: 'center' }}>
            <div style={{ color: '#666', fontSize: '10px', lineHeight: '1.6' }}>Virtual entertainment only · No real money · 18+ only</div>
          </div>
        </div>
      </div>
    );
  }

  // ── Signed in — route to correct game ────────────────────────────────────────
  const playerName = user.displayName || user.email;
  const playerUid  = user.uid;
  const isDealerMode = isDealer;

  if (selectedGame === 'craps') {
    return <CrapsGame onBack={deactivateGame} isDealerMode={isDealerMode} playerUserId={playerUid} playerName={playerName} skipRegistration={true} roomCode={dealerUid} />;

  }

  if (selectedGame === 'baccarat') {
    return <BaccaratGame onBack={deactivateGame} isDealerMode={isDealerMode} playerUserId={playerUid} playerName={playerName} skipRegistration={true} roomCode={dealerUid} />;
  }

  if (selectedGame === 'roulette') {
    return <RouletteGame onBack={deactivateGame} isDealerMode={isDealerMode} playerUserId={playerUid} playerName={playerName} skipRegistration={true} roomCode={dealerUid} />;
  }


  // ── Player waiting screen ─────────────────────────────────────────────────────
  if (isPlayer && !selectedGame) {
    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0a0e27 0%, #1a1f3a 50%, #0f1829 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
        <div style={{ textAlign: 'center', maxWidth: '650px', width: '100%' }}>
          {showSessionSummary && sessionLeaderboard?.length > 0 ? (
            <>
              <div style={{ fontSize: '52px', marginBottom: '15px' }}>🏆</div>
              <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#d4af37', marginBottom: '8px', letterSpacing: '2px' }}>SESSION RESULTS</div>
              <div style={{ color: '#888', fontSize: '14px', marginBottom: '30px' }}>Final standings · Next stream starts fresh</div>

              {/* Podium */}
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: isMobile ? 'center' : 'flex-end', gap: '12px', marginBottom: '30px', flexDirection: isMobile ? 'column' : 'row' }}>
                {sessionLeaderboard.length >= 2 && (
                  <div style={{ background: 'linear-gradient(180deg,rgba(192,192,192,.15),rgba(192,192,192,.05))', border: '2px solid rgba(192,192,192,.4)', borderRadius: '12px', padding: '20px 15px', width: isMobile ? '100%' : '140px', textAlign: 'center' }}>
                    <div style={{ fontSize: '28px', marginBottom: '5px' }}>🥈</div>
                    <div style={{ fontSize: '14px', color: '#ccc', fontWeight: 'bold' }}>{sessionLeaderboard[1].name}</div>
                    <div style={{ fontSize: '18px', fontWeight: 'bold', color: sessionLeaderboard[1].bankroll >= startingChips ? '#4caf50' : '#f44336' }}>${Math.round(sessionLeaderboard[1].bankroll).toLocaleString()}</div>
                    <div style={{ fontSize: '11px', color: sessionLeaderboard[1].bankroll - startingChips >= 0 ? '#4caf50' : '#f44336' }}>{sessionLeaderboard[1].bankroll - startingChips >= 0 ? '+' : ''}${Math.round(sessionLeaderboard[1].bankroll - startingChips).toLocaleString()}</div>
                  </div>
                )}
                <div style={{ background: 'linear-gradient(180deg,rgba(212,175,55,.2),rgba(212,175,55,.05))', border: '1px solid rgba(212,175,55,.4)', borderRadius: '12px', padding: '25px 20px', width: isMobile ? '100%' : '160px', textAlign: 'center', boxShadow: '0 0 30px rgba(212,175,55,.2)' }}>
                  <div style={{ fontSize: '36px', marginBottom: '5px' }}>🥇</div>
                  <div style={{ fontSize: '16px', color: '#d4af37', fontWeight: 'bold' }}>{sessionLeaderboard[0].name}</div>
                  <div style={{ fontSize: '22px', fontWeight: 'bold', color: sessionLeaderboard[0].bankroll >= startingChips ? '#4caf50' : '#f44336' }}>${Math.round(sessionLeaderboard[0].bankroll).toLocaleString()}</div>
                  <div style={{ fontSize: '12px', color: sessionLeaderboard[0].bankroll - startingChips >= 0 ? '#4caf50' : '#f44336' }}>{sessionLeaderboard[0].bankroll - startingChips >= 0 ? '+' : ''}${Math.round(sessionLeaderboard[0].bankroll - startingChips).toLocaleString()}</div>
                </div>
                {sessionLeaderboard.length >= 3 && (
                  <div style={{ background: 'linear-gradient(180deg,rgba(205,127,50,.15),rgba(205,127,50,.05))', border: '2px solid rgba(205,127,50,.4)', borderRadius: '12px', padding: '18px 15px', width: isMobile ? '100%' : '130px', textAlign: 'center' }}>
                    <div style={{ fontSize: '24px', marginBottom: '5px' }}>🥉</div>
                    <div style={{ fontSize: '13px', color: '#ccc', fontWeight: 'bold' }}>{sessionLeaderboard[2].name}</div>
                    <div style={{ fontSize: '16px', fontWeight: 'bold', color: sessionLeaderboard[2].bankroll >= startingChips ? '#4caf50' : '#f44336' }}>${Math.round(sessionLeaderboard[2].bankroll).toLocaleString()}</div>
                    <div style={{ fontSize: '11px', color: sessionLeaderboard[2].bankroll - startingChips >= 0 ? '#4caf50' : '#f44336' }}>{sessionLeaderboard[2].bankroll - startingChips >= 0 ? '+' : ''}${Math.round(sessionLeaderboard[2].bankroll - startingChips).toLocaleString()}</div>
                  </div>
                )}
              </div>

              {/* My result */}
              {(() => {
                const myResult = sessionLeaderboard.find(p => p.playerUid === playerUid);
                const myRank   = sessionLeaderboard.findIndex(p => p.playerUid === playerUid) + 1;
                if (!myResult) return null;
                const pnl = Math.round(myResult.bankroll - startingChips);
                return (
                  <div style={{ background: pnl >= 0 ? 'rgba(76,175,80,.1)' : 'rgba(244,67,54,.1)', border: `2px solid ${pnl >= 0 ? '#4caf50' : '#f44336'}`, borderRadius: '12px', padding: '20px', marginBottom: '25px' }}>
                    <div style={{ fontSize: '11px', color: '#888', letterSpacing: '1px', marginBottom: '8px' }}>YOUR RESULT — #{myRank} of {sessionLeaderboard.length}</div>
                    <div style={{ fontSize: '32px', fontWeight: 'bold', color: pnl >= 0 ? '#4caf50' : '#f44336' }}>{pnl >= 0 ? '+' : ''}${pnl.toLocaleString()}</div>
                    <div style={{ fontSize: '13px', color: '#aaa', marginTop: '5px' }}>Final balance: ${Math.round(myResult.bankroll).toLocaleString()}</div>
                  </div>
                );
              })()}

              <div style={{ color: '#666', fontSize: '13px', marginBottom: '15px' }}>Waiting for next stream...</div>
              <div style={{ display: 'flex', justifyContent: 'center', gap: '10px' }}>
                {[0,1,2].map(i => <div key={i} style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#d4af37', animation: `pulse 1.5s ease-in-out ${i*0.2}s infinite` }} />)}
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: '64px', marginBottom: '20px' }}>⏳</div>
              <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#d4af37', marginBottom: '15px', letterSpacing: '1.5px' }}>WAITING FOR DEALER</div>
              <div style={{ color: '#888', fontSize: '16px', marginBottom: '8px' }}>Welcome, <span style={{ color: '#d4af37' }}>{playerName}</span>!</div>
              <div style={{ color: '#888', fontSize: '14px', marginBottom: '30px' }}>No game is active. The page will update automatically when the dealer starts one.</div>
              <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', marginBottom: '30px' }}>
                {[0,1,2].map(i => <div key={i} style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#d4af37', animation: `pulse 1.5s ease-in-out ${i*0.2}s infinite` }} />)}
              </div>

              {/* Session history for player */}
              {sessionHistory.length > 0 && (
                <div style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(212,175,55,.2)', borderRadius: '12px', padding: '20px', textAlign: 'left' }}>
                  <div style={{ color: '#d4af37', fontSize: '11px', letterSpacing: '2px', marginBottom: '15px', fontWeight: 'bold' }}>📜 PAST SESSIONS</div>
                  {sessionHistory.slice(0, 5).map((session) => {
                    const entries = session.finalLeaderboard ? Object.values(session.finalLeaderboard).sort((a,b) => b.bankroll - a.bankroll) : [];
                    const myEntry = entries.find(p => p.playerUid === playerUid);
                    const myRank  = entries.findIndex(p => p.playerUid === playerUid) + 1;
                    return (
                      <div key={session.sessionNumber} style={{ padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,.05)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div style={{ color: '#aaa', fontSize: '12px' }}>
                            Session #{session.sessionNumber}
                            <span style={{ color: '#555', marginLeft: '8px', fontSize: '11px' }}>{new Date(session.startedAt).toLocaleDateString()}</span>
                          </div>
                          {myEntry ? (
                            <div style={{ textAlign: 'right' }}>
                              <span style={{ color: myEntry.bankroll - session.startingChips >= 0 ? '#4caf50' : '#f44336', fontSize: '13px', fontWeight: 'bold' }}>
                                {myEntry.bankroll - session.startingChips >= 0 ? '+' : ''}${Math.round(myEntry.bankroll - session.startingChips).toLocaleString()}
                              </span>
                              <span style={{ color: '#555', fontSize: '11px', marginLeft: '8px' }}>#{myRank}</span>
                            </div>
                          ) : <span style={{ color: '#555', fontSize: '11px' }}>Did not play</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <button onClick={signOut} style={{ marginTop: '20px', padding: '8px 20px', background: 'transparent', border: '1px solid #333', borderRadius: '6px', color: '#555', fontSize: '11px', cursor: 'pointer', fontFamily: 'inherit' }}>
                Sign Out
              </button>
            </>
          )}
        </div>
        <style>{`@keyframes pulse{0%,100%{opacity:.3;transform:scale(.8)}50%{opacity:1;transform:scale(1.2)}}`}</style>
      </div>
    );
  }

  // ── Dealer hub ────────────────────────────────────────────────────────────────
  const joinLink    = `${window.location.origin}${window.location.pathname}?dealer=${dealerUid}`;
  const overlayLink = `${joinLink}#overlay`;

  return (
    <div style={{ minHeight: '100vh', background: `radial-gradient(circle at 20% 30%,rgba(212,175,55,.15) 0%,transparent 50%),radial-gradient(circle at 80% 70%,rgba(33,150,243,.1) 0%,transparent 50%),linear-gradient(135deg,#0a0e27 0%,#1a1f3a 50%,#0f1829 100%)`, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div style={{ maxWidth: '1200px', width: '100%' }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '50px' }}>
          <div style={{ fontSize: '64px', fontWeight: 'bold', background: 'linear-gradient(135deg,#d4af37 0%,#ffd700 50%,#d4af37 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', letterSpacing: '8px', marginBottom: '10px' }}>
            ACTION SYNC
          </div>
          <div style={{ color: '#888', fontSize: '14px', letterSpacing: '4px', textTransform: 'uppercase', marginBottom: '12px' }}>
            Dealer Mode · {user?.displayName || user?.email}
          </div>
          <div style={{ display: 'inline-block', padding: '8px 18px', background: 'rgba(76,175,80,.2)', border: '1px solid #4caf50', borderRadius: '8px' }}>
            <span style={{ color: '#4caf50', fontSize: '12px', fontWeight: 'bold' }}>✅ DEALER MODE ACTIVE</span>
          </div>
        </div>

        {/* Start New Stream button — prominent at top */}
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <button onClick={() => setShowNewSessionConfirm(true)} style={{ padding: '18px 50px', background: 'linear-gradient(135deg,#d4af37 0%,#f4e5a1 100%)', border: 'none', borderRadius: '10px', color: '#000', fontSize: '16px', fontWeight: 'bold', letterSpacing: '1.5px', cursor: 'pointer', fontFamily: 'inherit', textTransform: 'uppercase', boxShadow: '0 4px 24px rgba(212,175,55,.4)' }}>
            🎬 Start New Stream Session
          </button>
          <div style={{ color: '#555', fontSize: '11px', marginTop: '8px' }}>Archives current session · resets all bankrolls · clears leaderboard</div>
        </div>

        {/* Confirm modal */}
        {showNewSessionConfirm && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
            <div style={{ background: '#1c1e2a', border: '1px solid rgba(212,175,55,.4)', borderRadius: '16px', padding: '40px', maxWidth: '420px', width: '100%', textAlign: 'center' }}>
              <div style={{ fontSize: '40px', marginBottom: '16px' }}>🎬</div>
              <div style={{ color: '#d4af37', fontSize: '20px', fontWeight: 'bold', marginBottom: '12px' }}>Start New Stream?</div>
              <div style={{ color: '#888', fontSize: '13px', lineHeight: '1.8', marginBottom: '10px' }}>
                This will archive the current session and reset all player bankrolls to <strong style={{ color: '#fff' }}>${startingChips.toLocaleString()}</strong>.
              </div>
              <div style={{ color: '#555', fontSize: '12px', marginBottom: '28px' }}>Player accounts and session history are preserved.</div>
              <div style={{ display: 'flex', gap: '12px' }}>
                <button onClick={() => setShowNewSessionConfirm(false)} style={{ flex: 1, padding: '14px', background: 'transparent', border: '1px solid #444', borderRadius: '8px', color: '#888', fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
                <button onClick={handleStartNewSession} disabled={newSessionLoading} style={{ flex: 1, padding: '14px', background: newSessionLoading ? '#333' : 'linear-gradient(135deg,#d4af37,#f4e5a1)', border: 'none', borderRadius: '8px', color: newSessionLoading ? '#666' : '#000', fontSize: '13px', fontWeight: 'bold', cursor: newSessionLoading ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
                  {newSessionLoading ? 'Starting...' : '✅ Start Stream'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Game cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: '30px', marginBottom: '40px' }}>
          {[
            { id: 'craps',    label: 'CRAPS',    desc: 'The classic dice game. Pass line, odds, place bets, hard ways, hop bets and more.', tags: ['15+ Bet Types','Odds Bets','Fire Bet'],    border: '#1a5f1a', bg: 'rgba(26,95,26,.4)',   accent: '#1a5f1a' },
            { id: 'baccarat', label: 'BACCARAT', desc: 'Bet on Player, Banker, or Tie. Features Dragon and Panda bonus bets.',             tags: ['Player/Banker/Tie','🐉 Dragon','🐼 Panda'], border: '#1976d2', bg: 'rgba(13,71,161,.4)',  accent: '#2196f3' },
            { id: 'roulette', label: 'ROULETTE', desc: 'American double-zero roulette. Inside and outside bets available.',                tags: ['0 & 00','Straight Up 35:1','Inside/Outside'],border: '#8b0000', bg: 'rgba(139,0,0,.4)',    accent: '#c62828' },
          ].map(game => (
            <div key={game.id} onClick={() => setActiveGame(game.id)} className="game-card" style={{ background: `linear-gradient(135deg,${game.bg},${game.bg.replace('.4','.6')})`, border: `3px solid ${game.border}`, borderRadius: '20px', padding: '35px', cursor: 'pointer', transition: 'all .3s ease', position: 'relative', overflow: 'hidden', boxShadow: '0 10px 40px rgba(0,0,0,.5)' }}>
              <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#fff', marginBottom: '12px', letterSpacing: '1px' }}>{game.label}</div>
              <div style={{ color: '#ddd', fontSize: '13px', lineHeight: '1.7', marginBottom: '20px' }}>{game.desc}</div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '20px' }}>
                {game.tags.map(t => <div key={t} style={{ background: 'rgba(212,175,55,.25)', padding: '5px 10px', borderRadius: '5px', fontSize: '11px', color: '#fff', border: '1px solid rgba(212,175,55,.4)', fontWeight: 'bold' }}>{t}</div>)}
              </div>
              <div style={{ padding: '12px', background: 'rgba(0,0,0,.3)', borderRadius: '8px', fontSize: '12px', color: '#fff', textAlign: 'center', fontWeight: 'bold' }}>Click to activate {game.label} →</div>
            </div>
          ))}
        </div>

        {/* Session settings + share link */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '20px', marginBottom: '20px' }}>

          {/* Starting stack */}
          <div style={{ padding: '24px', background: 'rgba(0,0,0,.3)', borderRadius: '14px', border: '1px solid rgba(212,175,55,.2)' }}>
            <div style={{ color: '#d4af37', fontSize: '12px', fontWeight: 'bold', letterSpacing: '1px', marginBottom: '14px' }}>💰 STARTING STACK</div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
              {[500,1000,2500,5000,10000].map(amt => (
                <button key={amt} onClick={() => handleSetStartingChips(amt)} style={{ flex: 1, padding: '11px 6px', background: startingChips === amt ? '#d4af37' : 'rgba(255,255,255,.05)', border: startingChips === amt ? '2px solid #d4af37' : '1px solid #555', borderRadius: '7px', color: startingChips === amt ? '#000' : '#aaa', fontSize: '13px', fontWeight: 'bold', cursor: 'pointer', fontFamily: 'inherit', minWidth: '60px' }}>
                  ${amt.toLocaleString()}
                </button>
              ))}
            </div>
            <button onClick={handleResetAllBankrolls} style={{ width: '100%', padding: '11px', background: 'rgba(76,175,80,.15)', border: '1px solid #4caf50', borderRadius: '7px', color: '#4caf50', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer', fontFamily: 'inherit', textTransform: 'uppercase' }}>
              🔄 Reset All Players to ${startingChips.toLocaleString()}
            </button>
          </div>

          {/* Share link */}
          <div style={{ padding: '24px', background: 'rgba(0,0,0,.3)', borderRadius: '14px', border: '1px solid rgba(212,175,55,.2)' }}>
            <div style={{ color: '#d4af37', fontSize: '12px', fontWeight: 'bold', letterSpacing: '1px', marginBottom: '14px' }}>🔗 SHARE WITH PLAYERS</div>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
              <code style={{ flex: 1, background: 'rgba(0,0,0,.4)', color: '#fff', fontSize: '11px', padding: '10px 12px', borderRadius: '6px', wordBreak: 'break-all', fontFamily: 'monospace' }}>{joinLink}</code>
              <button onClick={() => { navigator.clipboard.writeText(joinLink); alert('✅ Link copied!'); }} style={{ padding: '10px 14px', background: '#d4af37', border: 'none', borderRadius: '6px', color: '#000', fontSize: '11px', fontWeight: 'bold', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>Copy</button>
            </div>
            <div style={{ color: '#555', fontSize: '10px' }}>
              Overlay URL: <code style={{ color: '#777', fontFamily: 'monospace' }}>{overlayLink}</code>
            </div>
          </div>
        </div>

        {/* Session History panel */}
        {sessionHistory.length > 0 && (
          <div style={{ padding: '24px', background: 'rgba(0,0,0,.3)', borderRadius: '14px', border: '1px solid rgba(212,175,55,.2)', marginBottom: '20px' }}>
            <div style={{ color: '#d4af37', fontSize: '12px', fontWeight: 'bold', letterSpacing: '1px', marginBottom: '16px' }}>📜 SESSION HISTORY</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {sessionHistory.slice(0, 10).map(session => {
                const entries = session.finalLeaderboard
                  ? Object.values(session.finalLeaderboard).sort((a,b) => b.bankroll - a.bankroll)
                  : [];
                return (
                  <details key={session.sessionNumber} style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.07)', borderRadius: '8px', overflow: 'hidden' }}>
                    <summary style={{ padding: '12px 16px', cursor: 'pointer', color: '#aaa', fontSize: '13px', display: 'flex', justifyContent: 'space-between', listStyle: 'none' }}>
                      <span>Session #{session.sessionNumber} <span style={{ color: '#555', fontSize: '11px', marginLeft: '8px' }}>{new Date(session.startedAt).toLocaleDateString()}</span></span>
                      <span style={{ color: '#666', fontSize: '11px' }}>{entries.length} players · ${session.startingChips?.toLocaleString()} start</span>
                    </summary>
                    <div style={{ padding: '0 16px 14px' }}>
                      {entries.slice(0, 8).map((p, idx) => {
                        const pnl = Math.round(p.bankroll - session.startingChips);
                        return (
                          <div key={p.playerUid || idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,.04)' }}>
                            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                              <span style={{ color: idx === 0 ? '#d4af37' : idx === 1 ? '#c0c0c0' : idx === 2 ? '#cd7f32' : '#555', fontSize: '12px', width: '20px' }}>
                                {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx+1}`}
                              </span>
                              <span style={{ color: '#ccc', fontSize: '13px' }}>{p.name}</span>
                            </div>
                            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                              <span style={{ color: '#fff', fontSize: '13px', fontWeight: 'bold' }}>${Math.round(p.bankroll).toLocaleString()}</span>
                              <span style={{ color: pnl >= 0 ? '#4caf50' : '#f44336', fontSize: '11px', minWidth: '55px', textAlign: 'right' }}>{pnl >= 0 ? '+' : ''}${pnl.toLocaleString()}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </details>
                );
              })}
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{ padding: '24px', background: 'rgba(0,0,0,.3)', borderRadius: '14px', border: '1px solid rgba(255,255,255,.08)', textAlign: 'center' }}>
          <button onClick={signOut} style={{ padding: '10px 28px', background: 'transparent', border: '1px solid #444', borderRadius: '7px', color: '#666', fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit', marginBottom: '16px' }}>
            Sign Out
          </button>
          <div style={{ color: '#555', fontSize: '11px', lineHeight: '1.7' }}>
            Select a game above to push it to all players · Switch games at any time · Use "Start New Stream" before each broadcast
            <br /><span style={{ color: '#444', fontSize: '10px' }}>Virtual entertainment only · No real money · 18+ only</span>
          </div>
        </div>

      </div>
      <style>{`
        @keyframes pulse{0%,100%{opacity:.3;transform:scale(.8)}50%{opacity:1;transform:scale(1.2)}}
        .game-card:hover{transform:translateY(-8px);box-shadow:0 20px 60px rgba(0,0,0,.7)!important}
        *{box-sizing:border-box}
      `}</style>
    </div>
  );
};

export default App;
