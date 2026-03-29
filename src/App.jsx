// App.jsx — Phase 3: Multi-streamer, vanity room codes
import React, { useState, useEffect } from 'react';
import { Dice1, Spade, ArrowLeft, Circle } from 'lucide-react';
import { database as db, ref, onValue, set, auth } from './firebase.js';
import { sendPasswordResetEmail } from 'firebase/auth';
import { useAuth } from './useAuth.js';
import { startNewSession, startStream, switchGame, useSessionHistory, resolveRoomCode, normaliseCode, changeRoomCode, isRoomCodeAvailable } from './useFirebaseSync.js';

// Import your game components
import CrapsGame from './CrapsGame';
import BaccaratGame from './BaccaratGame';
import RouletteGame from './RouletteGame';
import StreamOverlay from './StreamOverlay';
import SettingsPanel from './SettingsPanel';

// ── URL helpers ────────────────────────────────────────────────────────────────
// Dealer shares join link:  ?dealer={dealerUid}  OR  ?room=VANITYCODE
// Overlay URL:              ?dealer={dealerUid}#overlay
// Players can also type the vanity code manually in the join form.
const getDealerUidFromUrl = () =>
  new URLSearchParams(window.location.search).get('dealer') || null;

const getRoomCodeFromUrl = () =>
  new URLSearchParams(window.location.search).get('room') || null;

const App = () => {
    // Debug: log key state on every render
    console.log('[APP RENDER]', {
      isPlayer,
      isDealer,
      dealerUid,
      user: user ? { uid: user.uid, displayName: user.displayName, email: user.email } : null,
      authLoading,
      role
    });
  // ── Overlay route — supports both ?dealer=uid and ?room=VANITYCODE ───────────
  if (window.location.hash === '#overlay' || window.location.pathname === '/overlay') {
    return <StreamOverlay dealerUidFromUrl={getDealerUidFromUrl()} roomCodeFromUrl={getRoomCodeFromUrl()} />;
  }

  // ── Auth ─────────────────────────────────────────────────────────────────────
  const {
    user, role, authLoading, authError, setAuthError,
    needsRoomCode, handleClaimRoomCode,
    dealerSignIn, dealerSignUp, playerSignIn, playerSignUp,
    signOut, isDealer, isPlayer,
  } = useAuth();

  // ── Resolved dealerUid ───────────────────────────────────────────────────────
  // For dealers: their own uid. For players: resolved from URL or code entry.
  const [resolvedDealerUid, setResolvedDealerUid] = useState(getDealerUidFromUrl());
  const [resolveError, setResolveError]           = useState(null);
  const [resolving, setResolving]                 = useState(false);

  // If URL has ?room=CODE instead of ?dealer=uid, resolve it once on mount
  useEffect(() => {
    const codeFromUrl = getRoomCodeFromUrl();
    if (codeFromUrl && !getDealerUidFromUrl()) {
      setResolving(true);
      resolveRoomCode(codeFromUrl).then(uid => {
        if (uid) {
          setResolvedDealerUid(uid);
        } else {
          setResolveError(`Room "${codeFromUrl}" not found. Check the code and try again.`);
        }
        setResolving(false);
      });
    }
  }, []);

  // dealerUid must be stable across async function closures — use useMemo
  // so handlers like handleStartNewSession always see the current value.
  const dealerUid = React.useMemo(
    () => isDealer ? user?.uid : resolvedDealerUid,
    [isDealer, user?.uid, resolvedDealerUid]
  );

  // ── UI state ─────────────────────────────────────────────────────────────────
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const [selectedGame, setSelectedGame]             = useState(null);
  const [sessionStatus, setSessionStatus]           = useState('waiting');
  const [hubTab, setHubTab]                         = useState('games'); // 'games' | 'settings'
  const [startingChips, setStartingChips]           = useState(1000);
  const [sessionLeaderboard, setSessionLeaderboard] = useState(null);
  const [showSessionSummary, setShowSessionSummary] = useState(false);
  const [showNewSessionConfirm, setShowNewSessionConfirm] = useState(false);
  const [newSessionLoading, setNewSessionLoading]   = useState(false);

  // Phase 3 — vanity code state
  const [dealerRoomCode, setDealerRoomCode]         = useState(''); // current claimed code
  const [codeInput, setCodeInput]                   = useState(''); // claim/change form input
  const [codeLoading, setCodeLoading]               = useState(false);
  const [codeError, setCodeError]                   = useState(null);
  const [codeSuccess, setCodeSuccess]               = useState(null);
  const [showChangeCode, setShowChangeCode]         = useState(false);
  // Player join: manual code entry (when no URL param present)
  const [joinCodeInput, setJoinCodeInput]           = useState('');
  const [joinCodeLoading, setJoinCodeLoading]       = useState(false);

  // Auth form state
  const [authMode, setAuthMode]         = useState('playerSignIn'); // 'playerSignIn' | 'playerSignUp' | 'dealerSignIn' | 'dealerSignUp'
  const [formEmail, setFormEmail]       = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formName, setFormName]         = useState('');
  const [formRoomCode, setFormRoomCode] = useState(''); // dealer sign-up vanity code
  const [formLoading, setFormLoading]   = useState(false);

  // Forgot password state
  const [forgotMode, setForgotMode]         = useState(false);
  const [forgotEmail, setForgotEmail]       = useState('');
  const [forgotLoading, setForgotLoading]   = useState(false);
  const [forgotSent, setForgotSent]         = useState(false);
  const [forgotError, setForgotError]       = useState(null);

  const handleForgotPassword = async () => {
    if (!forgotEmail.trim() || forgotLoading) return;
    setForgotLoading(true);
    setForgotError(null);
    try {
      await sendPasswordResetEmail(auth, forgotEmail.trim());
      setForgotSent(true);
    } catch (e) {
      setForgotError(e.code === 'auth/user-not-found' ? 'No account found with that email.' : 'Failed to send reset email. Try again.');
    } finally {
      setForgotLoading(false);
    }
  };

  // Session history for the running leaderboard panel
  const sessionHistory = useSessionHistory(dealerUid);

  // ── Read dealer's current room code from settings ─────────────────────────────
  useEffect(() => {
    if (!isDealer || !user?.uid) return;
    const unsub = onValue(ref(db, `rooms/${user.uid}/settings/roomCode`), (snap) => {
      if (snap.exists()) setDealerRoomCode(snap.val());
    });
    return () => unsub();
  }, [isDealer, user?.uid]);

  // ── Read dealer settings (startingChips) ─────────────────────────────────────
  useEffect(() => {
    if (!dealerUid) return;
    const unsub = onValue(ref(db, `rooms/${dealerUid}/settings/startingChips`), (snap) => {
      if (snap.exists()) setStartingChips(snap.val());
    });
    return () => unsub();
  }, [dealerUid]);

  // ── Sync sessionStatus from Firebase (dealer) — survives page refresh ─────────
  useEffect(() => {
    if (!isDealer || !dealerUid) return;
    const unsub = onValue(ref(db, `rooms/${dealerUid}/session/status`), (snap) => {
      if (snap.exists()) setSessionStatus(snap.val());
      else setSessionStatus('waiting');
    });
    return () => unsub();
  }, [isDealer, dealerUid]);

  // ── Sync dealer's active game from Firebase — survives page refresh ───────────
  useEffect(() => {
    if (!isDealer || !dealerUid) return;
    const unsub = onValue(ref(db, `rooms/${dealerUid}/session/activeGame`), (snap) => {
      setSelectedGame(snap.exists() && snap.val() ? snap.val() : null);
    });
    return () => unsub();
  }, [isDealer, dealerUid]);

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

  // ── Session listener (players) — watches activeGame + status together ────────
  // Keyed on user?.uid so it re-fires if auth resolves after initial mount
  useEffect(() => {
    console.log('[PLAYER SESSION LISTENER SETUP]', { isPlayer, dealerUid, userUid: user?.uid });
    if (!isPlayer || !dealerUid || !user?.uid) return;
    const sessionRef = ref(db, `rooms/${dealerUid}/session`);
    const unsub = onValue(sessionRef, (snap) => {
      console.log('[PLAYER SESSION LISTENER]', {
        dealerUid,
        userUid: user?.uid,
        snapExists: snap.exists(),
        session: snap.exists() ? snap.val() : null
      });
      if (snap.exists()) {
        const session = snap.val();
        setSessionStatus(session.status || 'waiting');
        setSelectedGame(session.activeGame || null);
        // End-of-session summary
        if (session.status === 'ended' && session.finalLeaderboard) {
          const players = Object.values(session.finalLeaderboard)
            .sort((a, b) => b.bankroll - a.bankroll);
          setSessionLeaderboard(players);
          setShowSessionSummary(true);
        }
      } else {
        setSessionStatus('waiting');
        setSelectedGame(null);
      }
    });
    return () => unsub();
  }, [isPlayer, dealerUid, user?.uid]);

  // ── Dealer: switch active game (session stays alive) ─────────────────────────
  const setActiveGame = async (game) => {
    const uid = user?.uid;
    if (!uid) return;
    try {
      if (sessionStatus === 'waiting') await startStream(uid);
      await switchGame(uid, game);
      setSelectedGame(game);
    } catch (e) {
      console.error('Failed to switch game:', e);
      alert('Failed to switch game: ' + e.message);
    }
  };

  // ── Dealer: end current game, return to lobby (session stays alive) ───────────
  const deactivateGame = async () => {
    const uid = user?.uid;
    if (!uid) return;
    try {
      await switchGame(uid, null);
      setSelectedGame(null);
    } catch (e) {
      console.error('Failed to deactivate game:', e);
    }
  };

  // ── Dealer: end stream — show summary then archive ───────────────────────────
  const handleStartNewSession = async () => {
    // Read dealerUid directly — don't rely on closure which may be stale
    const currentDealerUid = user?.uid;
    if (!currentDealerUid) {
      alert('Not logged in as dealer. Please refresh and try again.');
      return;
    }
    setNewSessionLoading(true);
    // Force token refresh to ensure Firebase auth is live before writing
    try { if (auth.currentUser) await auth.currentUser.getIdToken(true); } catch(e) { console.warn('Token refresh failed:', e); }
    try {
      // 1. Snapshot leaderboard
      const lbSnap = await new Promise(resolve =>
        onValue(ref(db, `rooms/${currentDealerUid}/session/leaderboard`), resolve, { onlyOnce: true })
      );
      if (lbSnap.exists()) {
        const finalLeaderboard = lbSnap.val();
        const players = Object.values(finalLeaderboard).sort((a, b) => b.bankroll - a.bankroll);
        try { await set(ref(db, `rooms/${currentDealerUid}/session/status`), 'ended'); }
        catch(e) { console.error('FAILED: session/status', e.code, e.message); throw e; }
        try { await set(ref(db, `rooms/${currentDealerUid}/session/finalLeaderboard`), finalLeaderboard); }
        catch(e) { console.error('FAILED: session/finalLeaderboard', e.code, e.message); throw e; }
        setSessionLeaderboard(players);
        setShowSessionSummary(true);
      }
      // 2. Archive + reset
      await startNewSession(currentDealerUid, startingChips);
      setShowNewSessionConfirm(false);
      setSelectedGame(null);
      setSessionStatus('waiting');
    } catch (e) {
      console.error('Failed to start new session:', e.code, e.message, e);
      alert('Failed to end session: ' + e.message + ' (code: ' + e.code + ')');
    } finally {
      setNewSessionLoading(false);
    }
  };

  // ── Dealer: update starting chips ────────────────────────────────────────────
  const handleSetStartingChips = async (amount) => {
    setStartingChips(amount);
    const uid = user?.uid;
    if (uid) {
      await set(ref(db, `rooms/${uid}/settings/startingChips`), amount);
    }
  };

  // ── Dealer: reset all bankrolls mid-session ───────────────────────────────────
  const handleResetAllBankrolls = async () => {
    const uid = user?.uid;
    if (!uid || !confirm(`Reset ALL players to $${startingChips.toLocaleString()}?`)) return;
    const playersSnap = await new Promise((resolve) =>
      onValue(ref(db, `rooms/${uid}/players`), resolve, { onlyOnce: true })
    );
    if (playersSnap.exists()) {
      const players = playersSnap.val();
      for (const pUid of Object.keys(players)) {
        await set(ref(db, `rooms/${uid}/players/${pUid}/bankroll`), startingChips);
        await set(ref(db, `rooms/${uid}/session/leaderboard/${pUid}/bankroll`), startingChips);
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
        await dealerSignUp(formEmail, formPassword, formName || 'Dealer', formRoomCode || null);
      } else if (authMode === 'playerSignIn') {
        if (!dealerUid) throw new Error('Enter a room code above to find your dealer.');
        await playerSignIn(formEmail, formPassword, dealerUid, startingChips);
      } else if (authMode === 'playerSignUp') {
        if (!dealerUid) throw new Error('Enter a room code above to find your dealer.');
        if (!formName.trim()) throw new Error('Display name is required.');
        await playerSignUp(formEmail, formPassword, formName.trim(), dealerUid, startingChips);
      }
      setFormEmail(''); setFormPassword(''); setFormName(''); setFormRoomCode('');
    } catch (e) {
      // authError is set inside useAuth, no extra action needed
    } finally {
      setFormLoading(false);
    }
  };

  // ── Player: manual room code entry ────────────────────────────────────────────
  const handleJoinByCode = async () => {
    if (!joinCodeInput.trim()) return;
    setJoinCodeLoading(true);
    setResolveError(null);
    try {
      const uid = await resolveRoomCode(joinCodeInput.trim());
      if (uid) {
        setResolvedDealerUid(uid);
        // Update URL so refreshes preserve the room
        const params = new URLSearchParams(window.location.search);
        params.set('dealer', uid);
        params.delete('room');
        window.history.replaceState({}, '', `?${params.toString()}`);
        setJoinCodeInput('');
      } else {
        setResolveError(`Room "${normaliseCode(joinCodeInput)}" not found. Check the code and try again.`);
      }
    } finally {
      setJoinCodeLoading(false);
    }
  };

  // ── Dealer: claim / change vanity code ───────────────────────────────────────
  const handleClaimCode = async () => {
    if (!codeInput.trim() || !user?.uid) return;
    setCodeLoading(true);
    setCodeError(null);
    setCodeSuccess(null);
    const result = await handleClaimRoomCode(user.uid, codeInput.trim());
    if (result.success) {
      setCodeSuccess(`Room code set to ${result.code}`);
      setCodeInput('');
      setShowChangeCode(false);
    } else {
      setCodeError(result.error);
    }
    setCodeLoading(false);
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


  // ── No room context and not signed in → Landing page ────────────────────────
  // Show when: bare domain visit (no ?dealer= / ?room=), not authenticated,
  // not a dealer trying to log in via dealerSignIn/dealerSignUp mode.
  const isBareDomain = !getDealerUidFromUrl() && !getRoomCodeFromUrl() && !resolvedDealerUid;
  if (!user && isBareDomain && authMode !== 'dealerSignIn' && authMode !== 'dealerSignUp') {
    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(160deg, #0a0e27 0%, #0f1923 60%, #141e2e 100%)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px', fontFamily: 'inherit' }}>

        {/* Hero */}
        <div style={{ textAlign: 'center', maxWidth: '520px', marginBottom: '48px' }}>
          <div style={{ fontSize: isMobile ? '52px' : '72px', marginBottom: '16px', filter: 'drop-shadow(0 0 24px rgba(212,175,55,0.4))' }}>🎰</div>
          <h1 style={{ fontSize: isMobile ? '32px' : '48px', fontWeight: 'bold', color: '#d4af37', letterSpacing: '2px', margin: '0 0 10px', textShadow: '0 0 30px rgba(212,175,55,0.3)' }}>ACTION SYNC</h1>
          <p style={{ color: '#7a8aaa', fontSize: isMobile ? '14px' : '16px', lineHeight: '1.7', margin: '0 0 8px' }}>
            Live virtual casino companion for streamers and their viewers.
          </p>
          <p style={{ color: '#4a5568', fontSize: '13px', margin: 0 }}>
            Bet virtual chips on Roulette, Craps &amp; Baccarat — together, in real time.
          </p>
        </div>

        {/* How it works */}
        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: '16px', maxWidth: '640px', width: '100%', marginBottom: '48px' }}>
          {[
            { icon: '📡', title: 'Streamer goes live', body: 'Dealer logs in, picks a game, and shares their room link or code with viewers.' },
            { icon: '🎲', title: 'Viewers join the room', body: 'Players sign up with a display name and start with a virtual chip stack.' },
            { icon: '🏆', title: 'Compete on the board', body: 'Place bets each round and climb the live leaderboard — no real money ever.' },
          ].map(({ icon, title, body }) => (
            <div key={title} style={{ flex: 1, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(212,175,55,0.12)', borderRadius: '14px', padding: '22px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: '28px', marginBottom: '10px' }}>{icon}</div>
              <div style={{ color: '#d4af37', fontSize: '13px', fontWeight: 'bold', letterSpacing: '0.5px', marginBottom: '8px' }}>{title}</div>
              <div style={{ color: '#6b7a94', fontSize: '12px', lineHeight: '1.7' }}>{body}</div>
            </div>
          ))}
        </div>

        {/* CTA cards */}
        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: '16px', maxWidth: '480px', width: '100%', marginBottom: '32px' }}>

          {/* Player join box */}
          <div style={{ flex: 1, background: 'rgba(212,175,55,0.06)', border: '1px solid rgba(212,175,55,0.25)', borderRadius: '14px', padding: '24px 20px' }}>
            <div style={{ color: '#d4af37', fontSize: '12px', fontWeight: 'bold', letterSpacing: '1px', marginBottom: '12px', textTransform: 'uppercase' }}>🎲 Join a Room</div>
            <p style={{ color: '#7a8aaa', fontSize: '12px', lineHeight: '1.6', marginBottom: '14px' }}>
              Have a room code from your streamer? Enter it below.
            </p>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                value={joinCodeInput}
                onChange={e => { setJoinCodeInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'')); setResolveError(null); }}
                onKeyPress={e => e.key === 'Enter' && handleJoinByCode()}
                placeholder="Room code"
                maxLength={16}
                style={{ flex: 1, padding: '11px 12px', background: '#0a0a0a', border: '1px solid #444', borderRadius: '8px', color: '#fff', fontSize: '14px', outline: 'none', fontFamily: 'inherit', letterSpacing: '2px' }}
              />
              <button
                onClick={handleJoinByCode}
                disabled={joinCodeLoading || !joinCodeInput.trim()}
                style={{ padding: '11px 14px', background: joinCodeInput.trim() ? '#d4af37' : '#2a2a2a', border: 'none', borderRadius: '8px', color: joinCodeInput.trim() ? '#000' : '#555', fontWeight: 'bold', fontSize: '13px', cursor: joinCodeInput.trim() ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}
              >
                {joinCodeLoading ? '...' : 'Go'}
              </button>
            </div>
            {resolveError && <div style={{ color: '#f44336', fontSize: '11px', marginTop: '6px' }}>{resolveError}</div>}
          </div>

          {/* Dealer box */}
          <div style={{ flex: 1, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '14px', padding: '24px 20px' }}>
            <div style={{ color: '#888', fontSize: '12px', fontWeight: 'bold', letterSpacing: '1px', marginBottom: '12px', textTransform: 'uppercase' }}>🎰 Streamer / Dealer</div>
            <p style={{ color: '#4a5568', fontSize: '12px', lineHeight: '1.6', marginBottom: '14px' }}>
              Running a stream? Create a dealer account to host your own room.
            </p>
            <button
              onClick={() => setAuthMode('dealerSignUp')}
              style={{ width: '100%', padding: '11px', background: 'transparent', border: '1px solid #444', borderRadius: '8px', color: '#888', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '0.5px', marginBottom: '8px' }}
            >
              Create Dealer Account
            </button>
            <button
              onClick={() => setAuthMode('dealerSignIn')}
              style={{ width: '100%', padding: '8px', background: 'transparent', border: 'none', color: '#4a5568', fontSize: '11px', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              Already have an account? Sign in
            </button>
          </div>
        </div>

        <div style={{ color: '#2a3444', fontSize: '11px', textAlign: 'center' }}>
          Virtual entertainment only · No real money · 18+ only
        </div>
      </div>
    );
  }

  // ── Not signed in → show auth form ───────────────────────────────────────────
  if (!user) {
    const isSignUp     = authMode === 'playerSignUp' || authMode === 'dealerSignUp';
    const isDealerForm = authMode === 'dealerSignIn'  || authMode === 'dealerSignUp';
    const canSubmit    = isDealerForm || !!dealerUid;

    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0a0e27 0%, #1a1f3a 50%, #0f1829 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
        <div style={{ background: 'linear-gradient(135deg, #1c1e2a 0%, #252836 100%)', border: '1px solid rgba(212,175,55,0.4)', borderRadius: '15px', padding: isMobile ? '30px 20px' : '50px 40px', maxWidth: '460px', width: '100%', boxShadow: '0 12px 40px rgba(0,0,0,0.4)' }}>
          <div style={{ textAlign: 'center', marginBottom: '28px' }}>
            <div style={{ fontSize: isMobile ? '34px' : '44px', fontWeight: 'bold', color: '#d4af37', letterSpacing: '1.5px', marginBottom: '6px', textShadow: '0 0 20px rgba(212,175,55,0.3)' }}>ACTION SYNC</div>
            <div style={{ color: '#d4af37', fontSize: '11px', letterSpacing: '2px', textTransform: 'uppercase' }}>{isDealerForm ? '🎰 Dealer Portal' : '🎲 Join the Action'}</div>
          </div>

          {/* Player: room code entry */}
          {!isDealerForm && (
            <div style={{ marginBottom: '18px' }}>
              <div style={{ color: '#d4af37', fontSize: '11px', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '8px', fontWeight: 'bold' }}>Room Code</div>
              {dealerUid ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 14px', background: 'rgba(76,175,80,0.1)', border: '1px solid #4caf50', borderRadius: '8px' }}>
                  <span style={{ color: '#4caf50', fontSize: '13px', flex: 1 }}>✅ Room found</span>
                  <button onClick={() => { setResolvedDealerUid(null); setJoinCodeInput(''); }} style={{ background: 'none', border: 'none', color: '#555', fontSize: '11px', cursor: 'pointer', fontFamily: 'inherit' }}>Change</button>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input type="text" value={joinCodeInput} onChange={e => { setJoinCodeInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'')); setResolveError(null); }} onKeyPress={e => e.key === 'Enter' && handleJoinByCode()} placeholder="e.g. MIKECASINO" maxLength={16} style={{ flex: 1, padding: '12px 14px', background: '#0a0a0a', border: '2px solid #444', borderRadius: '8px', color: '#fff', fontSize: '14px', outline: 'none', fontFamily: 'inherit', letterSpacing: '2px' }} />
                  <button onClick={handleJoinByCode} disabled={joinCodeLoading || !joinCodeInput.trim()} style={{ padding: '12px 16px', background: joinCodeInput.trim() ? '#d4af37' : '#333', border: 'none', borderRadius: '8px', color: joinCodeInput.trim() ? '#000' : '#666', fontWeight: 'bold', fontSize: '13px', cursor: joinCodeInput.trim() ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>
                    {joinCodeLoading ? '...' : 'Find'}
                  </button>
                </div>
              )}
              {resolveError && <div style={{ color: '#f44336', fontSize: '11px', marginTop: '6px' }}>{resolveError}</div>}
              {!dealerUid && !resolveError && <div style={{ color: '#555', fontSize: '10px', marginTop: '5px' }}>Enter the code from your streamer, or use their join link directly.</div>}
            </div>
          )}

          {/* ── Forgot password view ── */}
          {forgotMode ? (
            <>
              {forgotSent ? (
                <div style={{ textAlign: 'center', padding: '20px 0' }}>
                  <div style={{ fontSize: '36px', marginBottom: '12px' }}>📬</div>
                  <div style={{ color: '#4caf50', fontSize: '14px', fontWeight: 'bold', marginBottom: '8px' }}>Reset email sent!</div>
                  <div style={{ color: '#888', fontSize: '12px', lineHeight: '1.6', marginBottom: '20px' }}>Check your inbox for a link to reset your password.</div>
                  <button onClick={() => { setForgotMode(false); setForgotSent(false); setForgotEmail(''); setForgotError(null); }} style={{ background: 'none', border: 'none', color: '#d4af37', fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit' }}>← Back to sign in</button>
                </div>
              ) : (
                <>
                  <div style={{ color: '#aaa', fontSize: '12px', lineHeight: '1.7', marginBottom: '18px' }}>Enter the email address on your account and we'll send you a reset link.</div>
                  <input type="email" value={forgotEmail} onChange={e => setForgotEmail(e.target.value)} onKeyPress={e => e.key === 'Enter' && handleForgotPassword()} placeholder="Email address" autoFocus style={{ width: '100%', padding: '13px', background: '#0a0a0a', border: '2px solid #444', borderRadius: '8px', color: '#fff', fontSize: '15px', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: '12px' }} />
                  {forgotError && <div style={{ background: 'rgba(244,67,54,0.1)', border: '1px solid rgba(244,67,54,0.3)', borderRadius: '8px', padding: '10px 14px', marginBottom: '12px', color: '#f44336', fontSize: '12px' }}>{forgotError}</div>}
                  <button onClick={handleForgotPassword} disabled={forgotLoading || !forgotEmail.trim()} style={{ width: '100%', padding: '14px', background: forgotEmail.trim() ? 'linear-gradient(135deg, #d4af37 0%, #f4e5a1 100%)' : '#333', border: 'none', borderRadius: '8px', color: forgotEmail.trim() ? '#000' : '#666', fontSize: '14px', fontWeight: 'bold', cursor: forgotEmail.trim() ? 'pointer' : 'not-allowed', fontFamily: 'inherit', marginBottom: '14px' }}>
                    {forgotLoading ? 'Sending...' : 'Send Reset Email'}
                  </button>
                  <div style={{ textAlign: 'center' }}>
                    <button onClick={() => { setForgotMode(false); setForgotError(null); setForgotEmail(''); }} style={{ background: 'none', border: 'none', color: '#666', fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit' }}>← Back to sign in</button>
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              {/* Form fields */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
                {isSignUp && <input type="text" value={formName} onChange={e => setFormName(e.target.value)} placeholder={isDealerForm ? 'Your display name' : 'Display name (shown on leaderboard)'} style={{ width: '100%', padding: '13px', background: '#0a0a0a', border: '2px solid #444', borderRadius: '8px', color: '#fff', fontSize: '15px', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />}
                <input type="email" value={formEmail} onChange={e => setFormEmail(e.target.value)} placeholder="Email address" style={{ width: '100%', padding: '13px', background: '#0a0a0a', border: '2px solid #444', borderRadius: '8px', color: '#fff', fontSize: '15px', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
                <input type="password" value={formPassword} onChange={e => setFormPassword(e.target.value)} onKeyPress={e => e.key === 'Enter' && handleAuthSubmit()} placeholder="Password" style={{ width: '100%', padding: '13px', background: '#0a0a0a', border: '2px solid #444', borderRadius: '8px', color: '#fff', fontSize: '15px', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
                {authMode === 'dealerSignUp' && (
                  <div>
                    <input type="text" value={formRoomCode} onChange={e => setFormRoomCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,''))} placeholder="Choose your room code (e.g. MIKECASINO)" maxLength={16} style={{ width: '100%', padding: '13px', background: '#0a0a0a', border: '2px solid #444', borderRadius: '8px', color: '#fff', fontSize: '14px', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box', letterSpacing: '1px' }} />
                    <div style={{ color: '#555', fontSize: '10px', marginTop: '5px' }}>3–16 characters · letters and numbers only · players use this to find your room</div>
                  </div>
                )}
              </div>

              {authError && <div style={{ background: 'rgba(244,67,54,0.1)', border: '1px solid rgba(244,67,54,0.3)', borderRadius: '8px', padding: '10px 14px', marginBottom: '14px', color: '#f44336', fontSize: '12px' }}>{authError}</div>}

              <button onClick={handleAuthSubmit} disabled={formLoading || !canSubmit} style={{ width: '100%', padding: '15px', background: (canSubmit && !formLoading) ? 'linear-gradient(135deg, #d4af37 0%, #f4e5a1 100%)' : '#333', border: 'none', borderRadius: '8px', color: (canSubmit && !formLoading) ? '#000' : '#666', fontSize: '15px', fontWeight: 'bold', letterSpacing: '1px', cursor: (canSubmit && !formLoading) ? 'pointer' : 'not-allowed', fontFamily: 'inherit', textTransform: 'uppercase', marginBottom: '10px' }}>
                {formLoading ? 'Please wait...' : isSignUp ? 'Create Account' : 'Sign In'}
              </button>

              {/* Forgot password link — only on sign-in screens */}
              {!isSignUp && (
                <div style={{ textAlign: 'center', marginBottom: '10px' }}>
                  <button onClick={() => { setForgotMode(true); setForgotEmail(formEmail); setAuthError(null); }} style={{ background: 'none', border: 'none', color: '#666', fontSize: '11px', cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline' }}>
                    Forgot password?
                  </button>
                </div>
              )}

              <div style={{ textAlign: 'center', marginBottom: '14px' }}>
                <button onClick={() => { setAuthError(null); setForgotMode(false); setAuthMode(isDealerForm ? (isSignUp ? 'dealerSignIn' : 'dealerSignUp') : (isSignUp ? 'playerSignIn' : 'playerSignUp')); }} style={{ background: 'none', border: 'none', color: '#d4af37', fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit' }}>
                  {isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Create one"}
                </button>
              </div>

              <div style={{ textAlign: 'center', borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: '14px' }}>
                <button onClick={() => { setAuthError(null); setResolveError(null); setForgotMode(false); setAuthMode(isDealerForm ? 'playerSignIn' : 'dealerSignIn'); }} style={{ padding: '8px 20px', background: 'transparent', border: '1px solid #444', borderRadius: '6px', color: '#666', fontSize: '10px', cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '1px', textTransform: 'uppercase' }}>
                  {isDealerForm ? '🎲 Player Login' : '🔐 Dealer Login'}
                </button>
              </div>
            </>
          )}
          <div style={{ marginTop: '16px', padding: '10px', background: 'rgba(212,175,55,0.07)', borderRadius: '8px', textAlign: 'center' }}>
            <div style={{ color: '#666', fontSize: '10px', lineHeight: '1.6' }}>Virtual entertainment only · No real money · 18+ only</div>
          </div>
        </div>
      </div>
    );
  }

  // ── Dealer: claim room code screen ────────────────────────────────────────────
  if (isDealer && needsRoomCode) {
    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0a0e27 0%, #1a1f3a 50%, #0f1829 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
        <div style={{ background: 'linear-gradient(135deg, #1c1e2a 0%, #252836 100%)', border: '1px solid rgba(212,175,55,0.4)', borderRadius: '15px', padding: isMobile ? '30px 20px' : '50px 40px', maxWidth: '460px', width: '100%', textAlign: 'center', boxShadow: '0 12px 40px rgba(0,0,0,0.4)' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>🎰</div>
          <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#d4af37', marginBottom: '10px', letterSpacing: '1px' }}>Claim Your Room Code</div>
          <div style={{ color: '#888', fontSize: '13px', lineHeight: '1.8', marginBottom: '28px' }}>
            Players type this to find your room. Pick something memorable.<br />
            <span style={{ color: '#555', fontSize: '11px' }}>3–16 chars · letters and numbers only · can be changed later</span>
          </div>
          <input type="text" value={codeInput} onChange={e => { setCodeInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'')); setCodeError(null); }} onKeyPress={e => e.key === 'Enter' && handleClaimCode()} placeholder="e.g. MIKECASINO" maxLength={16} autoFocus style={{ width: '100%', padding: '16px', background: '#0a0a0a', border: '2px solid #444', borderRadius: '8px', color: '#fff', fontSize: '18px', outline: 'none', fontFamily: 'inherit', textAlign: 'center', letterSpacing: '3px', marginBottom: '12px', boxSizing: 'border-box' }} />
          {codeError && <div style={{ color: '#f44336', fontSize: '12px', marginBottom: '12px' }}>{codeError}</div>}
          <button onClick={handleClaimCode} disabled={codeLoading || codeInput.length < 3} style={{ width: '100%', padding: '15px', background: codeInput.length >= 3 ? 'linear-gradient(135deg,#d4af37,#f4e5a1)' : '#333', border: 'none', borderRadius: '8px', color: codeInput.length >= 3 ? '#000' : '#666', fontSize: '15px', fontWeight: 'bold', cursor: codeInput.length >= 3 ? 'pointer' : 'not-allowed', fontFamily: 'inherit', textTransform: 'uppercase' }}>
            {codeLoading ? 'Checking...' : 'Claim Room Code'}
          </button>
          <button onClick={signOut} style={{ marginTop: '14px', padding: '8px 20px', background: 'transparent', border: 'none', color: '#444', fontSize: '11px', cursor: 'pointer', fontFamily: 'inherit' }}>Sign out</button>
        </div>
      </div>
    );
  }

  // ── Signed in — route to correct game ────────────────────────────────────────
  const playerName   = user.displayName || user.email;
  const playerUid    = user.uid;
  const isDealerMode = isDealer;

  // Player: if dealerUid isn't resolved yet but we expect one (URL has dealer/room param),
  // show a brief connecting state rather than flashing a blank screen or wrong branch
  if (isPlayer && !dealerUid && (getDealerUidFromUrl() || getRoomCodeFromUrl())) {
    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0a0e27 0%, #1a1f3a 50%, #0f1829 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: '20px' }}>🎰</div>
          <div style={{ color: '#d4af37', fontSize: '14px', letterSpacing: '3px' }}>CONNECTING...</div>
        </div>
      </div>
    );
  }

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
              {sessionStatus === 'active' ? (
                // Session is live but dealer is between games
                <>
                  <div style={{ fontSize: '64px', marginBottom: '20px' }}>🎰</div>
                  <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#d4af37', marginBottom: '12px', letterSpacing: '1.5px' }}>GAME OVER</div>
                  <div style={{ color: '#888', fontSize: '16px', marginBottom: '8px' }}>Welcome, <span style={{ color: '#d4af37' }}>{playerName}</span>!</div>
                  <div style={{ color: '#888', fontSize: '14px', marginBottom: '30px' }}>The stream is live. Next game starting soon — hold tight.</div>
                  <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', marginBottom: '30px' }}>
                    {[0,1,2].map(i => <div key={i} style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#4caf50', animation: `pulse 1.5s ease-in-out ${i*0.2}s infinite` }} />)}
                  </div>
                  <div style={{ padding: '14px 20px', background: 'rgba(76,175,80,.1)', border: '1px solid rgba(76,175,80,.3)', borderRadius: '10px', color: '#4caf50', fontSize: '12px' }}>
                    🟢 Stream is live
                  </div>
                </>
              ) : (
                // Session hasn't started yet — waiting for dealer
                <>
                  <div style={{ fontSize: '64px', marginBottom: '20px' }}>⏳</div>
                  <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#d4af37', marginBottom: '15px', letterSpacing: '1.5px' }}>WAITING FOR DEALER</div>
                  <div style={{ color: '#888', fontSize: '16px', marginBottom: '8px' }}>Welcome, <span style={{ color: '#d4af37' }}>{playerName}</span>!</div>
                  <div style={{ color: '#888', fontSize: '14px', marginBottom: '30px' }}>Stream hasn't started yet. This page will update automatically when it does.</div>
                  <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', marginBottom: '30px' }}>
                    {[0,1,2].map(i => <div key={i} style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#d4af37', animation: `pulse 1.5s ease-in-out ${i*0.2}s infinite` }} />)}
                  </div>
                </>
              )}

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
  const joinLink       = `${window.location.origin}${window.location.pathname}?dealer=${dealerUid}`;
  const vanityJoinLink = dealerRoomCode ? `${window.location.origin}${window.location.pathname}?room=${dealerRoomCode}` : null;
  const overlayLink    = `${joinLink}#overlay`;

  return (
    <div style={{ minHeight: '100vh', background: `radial-gradient(circle at 20% 30%,rgba(212,175,55,.15) 0%,transparent 50%),radial-gradient(circle at 80% 70%,rgba(33,150,243,.1) 0%,transparent 50%),linear-gradient(135deg,#0a0e27 0%,#1a1f3a 50%,#0f1829 100%)`, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div style={{ maxWidth: '1200px', width: '100%' }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '50px' }}>
          <div style={{ fontSize: '64px', fontWeight: 'bold', color: '#d4af37', letterSpacing: '8px', marginBottom: '10px', textShadow: '0 0 40px rgba(212,175,55,0.4)' }}>
            ACTION SYNC
          </div>
          <div style={{ color: '#888', fontSize: '14px', letterSpacing: '4px', textTransform: 'uppercase', marginBottom: '12px' }}>
            Dealer Mode · {user?.displayName || user?.email}
          </div>
          <div style={{ display: 'inline-block', padding: '8px 18px', background: sessionStatus === 'active' ? 'rgba(76,175,80,.2)' : 'rgba(212,175,55,.15)', border: `1px solid ${sessionStatus === 'active' ? '#4caf50' : '#d4af37'}`, borderRadius: '8px' }}>
            <span style={{ color: sessionStatus === 'active' ? '#4caf50' : '#d4af37', fontSize: '12px', fontWeight: 'bold' }}>
              {sessionStatus === 'active' ? '🟢 STREAM LIVE' : '⏸ STREAM NOT STARTED'}
            </span>
          </div>

          {/* Hub tab navigation */}
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '24px' }}>
            {[
              { id: 'games',    label: '🎮 Games' },
              { id: 'settings', label: '⚙️ Settings' },
            ].map(t => (
              <button
                key={t.id}
                onClick={() => setHubTab(t.id)}
                style={{
                  padding: '10px 28px',
                  background: hubTab === t.id ? 'rgba(212,175,55,0.15)' : 'transparent',
                  border: `1px solid ${hubTab === t.id ? 'rgba(212,175,55,0.5)' : 'rgba(255,255,255,0.1)'}`,
                  borderRadius: '8px',
                  color: hubTab === t.id ? '#d4af37' : '#555',
                  fontSize: '13px',
                  fontWeight: hubTab === t.id ? 'bold' : 'normal',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  letterSpacing: '0.5px',
                  transition: 'all 0.15s',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        {hubTab === 'settings' ? (
          <SettingsPanel dealerUid={dealerUid} />
        ) : (
          <>
        {/* Session controls */}
        <div style={{ display: 'flex', gap: '14px', justifyContent: 'center', marginBottom: '40px', flexWrap: 'wrap' }}>
          {sessionStatus !== 'active' ? (
            // Go Live — starts the session without resetting anything
            <div style={{ textAlign: 'center' }}>
              <button onClick={async () => { await startStream(dealerUid); setSessionStatus('active'); }} style={{ padding: '18px 50px', background: 'linear-gradient(135deg,#4caf50,#81c784)', border: 'none', borderRadius: '10px', color: '#000', fontSize: '16px', fontWeight: 'bold', letterSpacing: '1.5px', cursor: 'pointer', fontFamily: 'inherit', textTransform: 'uppercase', boxShadow: '0 4px 24px rgba(76,175,80,.4)' }}>
                🟢 Go Live
              </button>
              <div style={{ color: '#555', fontSize: '11px', marginTop: '8px' }}>Opens the session for players · select a game below to start</div>
            </div>
          ) : (
            // End Stream — archives session, resets bankrolls
            <div style={{ textAlign: 'center' }}>
              <button onClick={() => setShowNewSessionConfirm(true)} style={{ padding: '18px 50px', background: 'linear-gradient(135deg,#d4af37,#f4e5a1)', border: 'none', borderRadius: '10px', color: '#000', fontSize: '16px', fontWeight: 'bold', letterSpacing: '1.5px', cursor: 'pointer', fontFamily: 'inherit', textTransform: 'uppercase', boxShadow: '0 4px 24px rgba(212,175,55,.3)' }}>
                🏁 End Stream
              </button>
              <div style={{ color: '#555', fontSize: '11px', marginTop: '8px' }}>Shows final leaderboard · archives session · resets bankrolls</div>
            </div>
          )}
        </div>

        {/* End stream confirm modal */}
        {showNewSessionConfirm && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
            <div style={{ background: '#1c1e2a', border: '1px solid rgba(212,175,55,.4)', borderRadius: '16px', padding: '40px', maxWidth: '420px', width: '100%', textAlign: 'center' }}>
              <div style={{ fontSize: '40px', marginBottom: '16px' }}>🏁</div>
              <div style={{ color: '#d4af37', fontSize: '20px', fontWeight: 'bold', marginBottom: '12px' }}>End Stream?</div>
              <div style={{ color: '#888', fontSize: '13px', lineHeight: '1.8', marginBottom: '10px' }}>
                This will show the final leaderboard and reset all bankrolls to <strong style={{ color: '#fff' }}>${startingChips.toLocaleString()}</strong> for the next stream.
              </div>
              <div style={{ color: '#555', fontSize: '12px', marginBottom: '28px' }}>Player accounts and session history are preserved.</div>
              <div style={{ display: 'flex', gap: '12px' }}>
                <button onClick={() => setShowNewSessionConfirm(false)} style={{ flex: 1, padding: '14px', background: 'transparent', border: '1px solid #444', borderRadius: '8px', color: '#888', fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
                <button onClick={handleStartNewSession} disabled={newSessionLoading} style={{ flex: 1, padding: '14px', background: newSessionLoading ? '#333' : 'linear-gradient(135deg,#d4af37,#f4e5a1)', border: 'none', borderRadius: '8px', color: newSessionLoading ? '#666' : '#000', fontSize: '13px', fontWeight: 'bold', cursor: newSessionLoading ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
                  {newSessionLoading ? 'Ending...' : '🏁 End Stream'}
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

          {/* Share link + room code management */}
          <div style={{ padding: '24px', background: 'rgba(0,0,0,.3)', borderRadius: '14px', border: '1px solid rgba(212,175,55,.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div style={{ color: '#d4af37', fontSize: '12px', fontWeight: 'bold', letterSpacing: '1px' }}>🔗 SHARE WITH PLAYERS</div>
              {dealerRoomCode && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ color: '#fff', fontSize: '16px', fontWeight: 'bold', letterSpacing: '3px', fontFamily: 'monospace' }}>{dealerRoomCode}</span>
                  <button onClick={() => { setShowChangeCode(!showChangeCode); setCodeError(null); setCodeSuccess(null); setCodeInput(''); }} style={{ padding: '4px 10px', background: 'transparent', border: '1px solid #555', borderRadius: '5px', color: '#888', fontSize: '10px', cursor: 'pointer', fontFamily: 'inherit' }}>Change</button>
                </div>
              )}
            </div>

            {/* Change code inline form */}
            {showChangeCode && (
              <div style={{ marginBottom: '14px', padding: '14px', background: 'rgba(212,175,55,.07)', borderRadius: '8px', border: '1px solid rgba(212,175,55,.2)' }}>
                <div style={{ color: '#888', fontSize: '11px', marginBottom: '10px' }}>New room code (old one will be released)</div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input type="text" value={codeInput} onChange={e => { setCodeInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'')); setCodeError(null); }} placeholder="New code" maxLength={16} style={{ flex: 1, padding: '10px 12px', background: '#0a0a0a', border: '1px solid #444', borderRadius: '6px', color: '#fff', fontSize: '14px', outline: 'none', fontFamily: 'inherit', letterSpacing: '2px' }} />
                  <button onClick={handleClaimCode} disabled={codeLoading || codeInput.length < 3} style={{ padding: '10px 14px', background: codeInput.length >= 3 ? '#d4af37' : '#333', border: 'none', borderRadius: '6px', color: codeInput.length >= 3 ? '#000' : '#666', fontWeight: 'bold', fontSize: '12px', cursor: codeInput.length >= 3 ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>{codeLoading ? '...' : 'Save'}</button>
                  <button onClick={() => setShowChangeCode(false)} style={{ padding: '10px 12px', background: 'transparent', border: '1px solid #333', borderRadius: '6px', color: '#555', fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
                </div>
                {codeError   && <div style={{ color: '#f44336', fontSize: '11px', marginTop: '6px' }}>{codeError}</div>}
                {codeSuccess  && <div style={{ color: '#4caf50', fontSize: '11px', marginTop: '6px' }}>✅ {codeSuccess}</div>}
              </div>
            )}

            {/* Vanity link — primary share option */}
            {vanityJoinLink && (
              <div style={{ marginBottom: '10px' }}>
                <div style={{ color: '#888', fontSize: '10px', marginBottom: '5px', letterSpacing: '1px' }}>ROOM LINK (share this)</div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <code style={{ flex: 1, background: 'rgba(0,0,0,.4)', color: '#fff', fontSize: '11px', padding: '10px 12px', borderRadius: '6px', wordBreak: 'break-all', fontFamily: 'monospace' }}>{vanityJoinLink}</code>
                  <button onClick={() => { navigator.clipboard.writeText(vanityJoinLink); alert('✅ Link copied!'); }} style={{ padding: '10px 14px', background: '#d4af37', border: 'none', borderRadius: '6px', color: '#000', fontSize: '11px', fontWeight: 'bold', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>Copy</button>
                </div>
              </div>
            )}

            <div style={{ color: '#444', fontSize: '10px', lineHeight: '1.7' }}>
              Players can also type <span style={{ color: '#666', fontFamily: 'monospace' }}>{dealerRoomCode}</span> directly on the join screen.
              <br />Overlay: <code style={{ color: '#555', fontFamily: 'monospace', fontSize: '10px' }}>{overlayLink}</code>
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
          </>
        )}

        {/* Footer */}
        <div style={{ padding: '24px', background: 'rgba(0,0,0,.3)', borderRadius: '14px', border: '1px solid rgba(255,255,255,.08)', textAlign: 'center', marginTop: '20px' }}>
          <button onClick={signOut} style={{ padding: '10px 28px', background: 'transparent', border: '1px solid #444', borderRadius: '7px', color: '#666', fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit', marginBottom: '16px' }}>
            Sign Out
          </button>
          <div style={{ color: '#555', fontSize: '11px', lineHeight: '1.7' }}>
            Select a game above to push it to all players · Switch games freely mid-session · Use "Go Live" to start each stream · "End Stream" to archive and reset
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