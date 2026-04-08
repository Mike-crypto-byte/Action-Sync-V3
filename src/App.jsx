// App.jsx — Phase 3: Multi-streamer, vanity room codes
import React, { useState, useEffect } from 'react';
import { database as db, ref, onValue, set, update, auth } from './firebase.js';
import { sendPasswordResetEmail } from 'firebase/auth';
import { useAuth } from './useAuth.js';
import { startNewSession, startStream, switchGame, useSessionHistory, resolveRoomCode, normaliseCode, changeRoomCode, isRoomCodeAvailable, useVODs } from './useFirebaseSync.js';

// Import game components
import CrapsGame from './CrapsGame';
import BaccaratGame from './BaccaratGame';
import RouletteGame from './RouletteGame';
import StreamOverlay from './StreamOverlay';
import SettingsPanel from './SettingsPanel';
import VODScriptEditor from './VODScriptEditor';
import VODPlayer from './VODPlayer';
import LandingPage from './LandingPage';

// ── URL helpers ────────────────────────────────────────────────────────────────
const getDealerUidFromUrl = () =>
  new URLSearchParams(window.location.search).get('dealer') || null;

const getRoomCodeFromUrl = () =>
  new URLSearchParams(window.location.search).get('room') || null;

const AppMain = () => {
  // ── Auth ─────────────────────────────────────────────────────────────────────
  const {
    user, role, authLoading, authError, setAuthError,
    needsRoomCode, handleClaimRoomCode,
    dealerSignIn, dealerSignUp, playerSignIn, playerSignUp,
    signOut, isDealer, isPlayer,
  } = useAuth();

  // ── Resolved dealerUid ───────────────────────────────────────────────────────
  const [resolvedDealerUid, setResolvedDealerUid] = useState(
    getDealerUidFromUrl() || localStorage.getItem('actionsync-dealerUid') || null
  );
  const [resolveError, setResolveError] = useState(null);
  const [resolving, setResolving]       = useState(false);

  const updateDealerUid = (uid) => {
    setResolvedDealerUid(uid);
    if (uid) localStorage.setItem('actionsync-dealerUid', uid);
    else localStorage.removeItem('actionsync-dealerUid');
  };

  useEffect(() => {
    const codeFromUrl = getRoomCodeFromUrl();
    if (codeFromUrl && !getDealerUidFromUrl()) {
      setResolving(true);
      resolveRoomCode(codeFromUrl).then(uid => {
        if (uid) updateDealerUid(uid);
        else setResolveError(`Room "${codeFromUrl}" not found. Check the code and try again.`);
        setResolving(false);
      });
    }
  }, []);

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

  // ── Session flow ──────────────────────────────────────────────────────────────
  const [selectedGame, setSelectedGame]                   = useState(null);
  const [sessionStatus, setSessionStatus]                 = useState('waiting');
  const [hubTab, setHubTab]                               = useState('games');
  const [startingChips, setStartingChips]                 = useState(1000);
  const [sessionLeaderboard, setSessionLeaderboard]       = useState(null);
  const [showSessionSummary, setShowSessionSummary]       = useState(false);
  const [showNewSessionConfirm, setShowNewSessionConfirm] = useState(false);
  const [newSessionLoading, setNewSessionLoading]         = useState(false);
  const [showGoLiveModal, setShowGoLiveModal]               = useState(false);
  const [goLiveLoading, setGoLiveLoading]                   = useState(false);
  const [showResetConfirm, setShowResetConfirm]             = useState(false);
  const [resetSuccess, setResetSuccess]                     = useState(false);
  const [sessionError, setSessionError]                   = useState(null);
  const [copySuccess, setCopySuccess]                     = useState(false);

  // ── Room code management ───────────────────────────────────────────────────────
  const [dealerRoomCode, setDealerRoomCode] = useState('');
  const [codeInput, setCodeInput]           = useState('');
  const [codeLoading, setCodeLoading]       = useState(false);
  const [codeError, setCodeError]           = useState(null);
  const [codeSuccess, setCodeSuccess]       = useState(null);
  const [showChangeCode, setShowChangeCode] = useState(false);
  const [joinCodeInput, setJoinCodeInput]   = useState('');
  const [joinCodeLoading, setJoinCodeLoading] = useState(false);

  // ── Auth form (login/signup UI) ────────────────────────────────────────────────
  const [authMode, setAuthMode]         = useState('playerSignIn');
  // Tracks whether the user explicitly clicked an auth CTA.
  // Prevents the landing-page → auth form → player-mode-switch → landing-page loop.
  const [authRequested, setAuthRequested] = useState(false);
  const requestAuth = (mode) => { setAuthMode(mode); setAuthRequested(true); };
  const [formEmail, setFormEmail]       = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formName, setFormName]         = useState('');
  const [formRoomCode, setFormRoomCode] = useState('');
  const [formLoading, setFormLoading]   = useState(false);

  // ── Forgot password flow ───────────────────────────────────────────────────────
  const [forgotMode, setForgotMode]     = useState(false);
  const [forgotEmail, setForgotEmail]   = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotSent, setForgotSent]     = useState(false);
  const [forgotError, setForgotError]   = useState(null);

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

  const sessionHistory = useSessionHistory(dealerUid);
  const vods           = useVODs(dealerUid);

  // ── VOD player (player-side) ──────────────────────────────────────────────
  const [selectedVodId, setSelectedVodId] = useState(null);

  useEffect(() => {
    if (!isDealer || !user?.uid) return;
    const unsub = onValue(ref(db, `rooms/${user.uid}/settings/roomCode`), (snap) => {
      if (snap.exists()) setDealerRoomCode(snap.val());
    });
    return () => unsub();
  }, [isDealer, user?.uid]);

  useEffect(() => {
    if (!dealerUid) return;
    const unsub = onValue(ref(db, `rooms/${dealerUid}/settings/startingChips`), (snap) => {
      if (snap.exists()) setStartingChips(snap.val());
    });
    return () => unsub();
  }, [dealerUid]);

  useEffect(() => {
    if (!isDealer || !dealerUid) return;
    const unsub = onValue(ref(db, `rooms/${dealerUid}/session/status`), (snap) => {
      if (snap.exists()) setSessionStatus(snap.val());
      else setSessionStatus('waiting');
    });
    return () => unsub();
  }, [isDealer, dealerUid]);

  useEffect(() => {
    if (!isDealer || !dealerUid) return;
    const unsub = onValue(ref(db, `rooms/${dealerUid}/session/activeGame`), (snap) => {
      setSelectedGame(snap.exists() && snap.val() ? snap.val() : null);
    });
    return () => unsub();
  }, [isDealer, dealerUid]);

  useEffect(() => {
    if (isDealer && user) {
      const params = new URLSearchParams(window.location.search);
      if (params.get('dealer') !== user.uid) {
        params.set('dealer', user.uid);
        window.history.replaceState({}, '', `?${params.toString()}`);
      }
    }
  }, [isDealer, user]);

  useEffect(() => {
    if (!isPlayer || !dealerUid || !user?.uid) return;
    const sessionRef = ref(db, `rooms/${dealerUid}/session`);
    const unsub = onValue(sessionRef, (snap) => {
      if (snap.exists()) {
        const session = snap.val();
        setSessionStatus(session.status || 'waiting');
        setSelectedGame(session.activeGame || null);
        if (session.status === 'ended' && session.finalLeaderboard) {
          const players = Object.values(session.finalLeaderboard).sort((a, b) => b.bankroll - a.bankroll);
          setSessionLeaderboard(players);
          setShowSessionSummary(true);
        } else if (session.status === 'waiting' || session.status === 'active') {
          setShowSessionSummary(false);
        }
      } else {
        setSessionStatus('waiting');
        setSelectedGame(null);
      }
    });
    return () => unsub();
  }, [isPlayer, dealerUid, user?.uid]);

  const setActiveGame = async (game) => {
    const uid = user?.uid;
    if (!uid) return;
    try {
      if (sessionStatus === 'waiting') await startStream(uid);
      await switchGame(uid, game);
      setSelectedGame(game);
    } catch (e) {
      console.error('Failed to switch game:', e);
      setSessionError('Failed to switch game: ' + e.message);
    }
  };

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

  const handleStartNewSession = async () => {
    const currentDealerUid = user?.uid;
    if (!currentDealerUid) {
      setSessionError('Not logged in as dealer. Please refresh and try again.');
      return;
    }
    setNewSessionLoading(true);
    try { if (auth.currentUser) await auth.currentUser.getIdToken(true); } catch(e) { console.warn('Token refresh failed:', e); }
    try {
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
      await startNewSession(currentDealerUid, startingChips);
      setShowNewSessionConfirm(false);
      setSelectedGame(null);
      setSessionStatus('waiting');
    } catch (e) {
      console.error('Failed to start new session:', e.code, e.message, e);
      setSessionError('Failed to end session: ' + e.message + ' (code: ' + e.code + ')');
    } finally {
      setNewSessionLoading(false);
    }
  };

  const handleSetStartingChips = async (amount) => {
    setStartingChips(amount);
    const uid = user?.uid;
    if (uid) await set(ref(db, `rooms/${uid}/settings/startingChips`), amount);
  };

  const handleResetAllBankrolls = () => setShowResetConfirm(true);

  const performResetAllBankrolls = async () => {
    const uid = user?.uid;
    if (!uid) return;
    setShowResetConfirm(false);
    const playersSnap = await new Promise((resolve) =>
      onValue(ref(db, `rooms/${uid}/players`), resolve, { onlyOnce: true })
    );
    if (playersSnap.exists()) {
      const players = playersSnap.val();
      const updates = {};
      for (const pUid of Object.keys(players)) {
        updates[`rooms/${uid}/players/${pUid}/bankroll`] = startingChips;
        updates[`rooms/${uid}/session/leaderboard/${pUid}/bankroll`] = startingChips;
      }
      await update(ref(db), updates);
    }
    setResetSuccess(true);
    setTimeout(() => setResetSuccess(false), 3000);
  };

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
      // authError is set inside useAuth
    } finally {
      setFormLoading(false);
    }
  };

  const handleJoinByCode = async () => {
    if (!joinCodeInput.trim()) return;
    setJoinCodeLoading(true);
    setResolveError(null);
    try {
      const uid = await resolveRoomCode(joinCodeInput.trim());
      if (uid) {
        updateDealerUid(uid);
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

  // ── Loading splash ────────────────────────────────────────────────────────────
  if (authLoading) {
    return (
      <div style={{ minHeight: '100vh', background: 'radial-gradient(circle at 50% 50%, rgba(212,175,55,0.08) 0%, transparent 60%), linear-gradient(135deg, #0a0e27 0%, #1a1f3a 50%, #0f1829 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', background: 'rgba(15,18,40,0.6)', backdropFilter: 'blur(16px)', border: '1px solid rgba(212,175,55,0.2)', borderRadius: '20px', padding: '48px 56px', boxShadow: '0 8px 32px rgba(0,0,0,0.5), 0 0 60px rgba(212,175,55,0.05)' }}>
          <div style={{ fontSize: '3rem', marginBottom: '20px', filter: 'drop-shadow(0 0 16px rgba(212,175,55,0.5))' }}>🎰</div>
          <div style={{ color: '#d4af37', fontSize: '0.875rem', letterSpacing: '3px', textShadow: '0 0 12px rgba(212,175,55,0.4)' }} className="animate-pulse">LOADING...</div>
        </div>
      </div>
    );
  }

  // ── Landing page ──────────────────────────────────────────────────────────────
  const isBareDomain = !getDealerUidFromUrl() && !getRoomCodeFromUrl() && !resolvedDealerUid;
  if (!user && isBareDomain && !authRequested) {
    return (
      <LandingPage
        isMobile={isMobile}
        joinCodeInput={joinCodeInput}
        setJoinCodeInput={setJoinCodeInput}
        handleJoinByCode={handleJoinByCode}
        joinCodeLoading={joinCodeLoading}
        resolveError={resolveError}
        setResolveError={setResolveError}
        setAuthMode={requestAuth}
      />
    );
  }

  // ── Auth form ─────────────────────────────────────────────────────────────────
  if (!user) {
    const isSignUp     = authMode === 'playerSignUp' || authMode === 'dealerSignUp';
    const isDealerForm = authMode === 'dealerSignIn'  || authMode === 'dealerSignUp';
    const canSubmit    = isDealerForm || !!dealerUid;

    return (
      <div style={{ minHeight: '100vh', background: 'radial-gradient(circle at 50% 30%, rgba(212,175,55,0.08) 0%, transparent 50%), linear-gradient(135deg, #0a0e27 0%, #1a1f3a 50%, #0f1829 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
        <div style={{ background: 'rgba(12,15,35,0.75)', backdropFilter: 'blur(20px)', border: '1px solid rgba(212,175,55,0.35)', borderRadius: '20px', padding: isMobile ? '30px 20px' : '50px 40px', maxWidth: '460px', width: '100%', boxShadow: '0 24px 64px rgba(0,0,0,0.6), 0 0 80px rgba(212,175,55,0.06), inset 0 1px 0 rgba(255,255,255,0.07)' }}>
          <div style={{ textAlign: 'center', marginBottom: '28px' }}>
            <div style={{ fontSize: isMobile ? '34px' : '44px', fontWeight: 'bold', color: '#d4af37', letterSpacing: '1.5px', marginBottom: '6px', textShadow: '0 0 30px rgba(212,175,55,0.6), 0 0 60px rgba(212,175,55,0.2)' }}>ACTION SYNC</div>
            <div style={{ color: '#d4af37', fontSize: '11px', letterSpacing: '2px', textTransform: 'uppercase' }}>{isDealerForm ? '🎰 Dealer Portal' : '🎲 Join the Action'}</div>
          </div>

          {/* Room code for players */}
          {!isDealerForm && (
            <div style={{ marginBottom: '18px' }}>
              <div style={{ color: '#d4af37', fontSize: '11px', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '8px', fontWeight: 'bold' }}>Room Code</div>
              {dealerUid ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 14px', background: 'rgba(76,175,80,0.1)', border: '1px solid #4caf50', borderRadius: '8px' }}>
                  <span style={{ color: '#4caf50', fontSize: '13px', flex: 1 }}>✅ Room found</span>
                  <button onClick={() => { updateDealerUid(null); setJoinCodeInput(''); }} style={{ background: 'none', border: 'none', color: '#555', fontSize: '11px', cursor: 'pointer', fontFamily: 'inherit' }}>Change</button>
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

          {/* Forgot password flow */}
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

  // ── Dealer: claim room code ───────────────────────────────────────────────────
  if (isDealer && needsRoomCode) {
    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0a0e27 0%, #1a1f3a 50%, #0f1829 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
        <div style={{ background: 'linear-gradient(135deg, #1c1e2a 0%, #252836 100%)', border: '1px solid rgba(212,175,55,0.4)', borderRadius: '15px', padding: isMobile ? '30px 20px' : '50px 40px', maxWidth: '460px', width: '100%', textAlign: 'center', boxShadow: '0 12px 40px rgba(0,0,0,0.4)' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>🎰</div>
          <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#d4af37', marginBottom: '10px', letterSpacing: '1px' }}>Claim Your Room Code</div>
          <div style={{ color: '#888', fontSize: '13px', lineHeight: '1.8', marginBottom: '28px' }}>
            Players type this to find your room. Pick something memorable.<br/>
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

  // ── Route to games ────────────────────────────────────────────────────────────
  const playerName   = user.displayName || user.email;
  const playerUid    = user.uid;
  const isDealerMode = isDealer;

  if (isPlayer && !dealerUid && (getDealerUidFromUrl() || getRoomCodeFromUrl())) {
    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0a0e27 0%, #1a1f3a 50%, #0f1829 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '3rem', marginBottom: '20px' }}>🎰</div>
          <div style={{ color: '#d4af37', fontSize: '0.875rem', letterSpacing: '3px' }} className="animate-pulse">CONNECTING...</div>
        </div>
      </div>
    );
  }

  if (selectedGame === 'craps')    return <CrapsGame    onBack={deactivateGame} isDealerMode={isDealerMode} playerUserId={playerUid} playerName={playerName} skipRegistration={true} roomCode={dealerUid} />;
  if (selectedGame === 'baccarat') return <BaccaratGame onBack={deactivateGame} isDealerMode={isDealerMode} playerUserId={playerUid} playerName={playerName} skipRegistration={true} roomCode={dealerUid} />;
  if (selectedGame === 'roulette') return <RouletteGame onBack={deactivateGame} isDealerMode={isDealerMode} playerUserId={playerUid} playerName={playerName} skipRegistration={true} roomCode={dealerUid} />;

  // ── Player: VOD session ───────────────────────────────────────────────────
  if (isPlayer && selectedVodId) {
    return (
      <VODPlayer
        dealerUid={dealerUid}
        vodId={selectedVodId}
        playerUid={playerUid}
        playerName={playerName}
        onBack={() => setSelectedVodId(null)}
      />
    );
  }

  // ── Player waiting screen ─────────────────────────────────────────────────────
  if (isPlayer && !selectedGame) {
    return (
      <div style={{ minHeight: '100vh', background: 'radial-gradient(ellipse at 50% 0%, rgba(212,175,55,0.08) 0%, transparent 60%), #080b1a', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
        <div style={{ maxWidth: '520px', width: '100%' }}>

          {/* Player top bar */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '18px' }}>🎰</span>
              <span style={{ color: '#d4af37', fontWeight: '800', fontSize: '14px', letterSpacing: '2px' }}>ACTION SYNC</span>
            </div>
            <button onClick={signOut} style={{ padding: '5px 12px', background: 'transparent', border: '1px solid rgba(136,146,164,0.2)', borderRadius: '6px', color: 'rgba(136,146,164,0.5)', fontSize: '12px', cursor: 'pointer' }}>
              Sign Out
            </button>
          </div>

          <div style={{ background: 'rgba(12,15,35,0.7)', backdropFilter: 'blur(20px)', border: '1px solid rgba(212,175,55,0.12)', borderRadius: '20px', padding: isMobile ? '28px 20px' : '40px', boxShadow: '0 24px 64px rgba(0,0,0,0.6)', textAlign: 'center' }}>

          {showSessionSummary && sessionLeaderboard?.length > 0 ? (
            <>
              <div style={{ fontSize: '3rem', marginBottom: '16px' }}>🏆</div>
              <h2 style={{ fontSize: '1.875rem', fontWeight: 'bold', color: '#d4af37', marginBottom: '8px', letterSpacing: '2px' }}>SESSION RESULTS</h2>
              <p style={{ color: '#8892a4', fontSize: '0.875rem', marginBottom: '32px' }}>Final standings · Next stream starts fresh</p>

              {/* Podium */}
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '32px', gap: '12px', flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'center' : 'flex-end' }}>
                {sessionLeaderboard.length >= 2 && (
                  <div style={{ background: 'linear-gradient(to bottom, rgba(255,255,255,0.15), rgba(255,255,255,0.05))', border: '2px solid rgba(255,255,255,0.4)', borderRadius: '12px', padding: '20px', textAlign: 'center', width: isMobile ? '100%' : '140px' }}>
                    <div style={{ fontSize: '1.875rem', marginBottom: '4px' }}>🥈</div>
                    <div style={{ fontSize: '0.875rem', color: '#d1d5db', fontWeight: 'bold' }}>{sessionLeaderboard[1].name}</div>
                    <div style={{ fontSize: '1.125rem', fontWeight: 'bold', color: sessionLeaderboard[1].bankroll >= startingChips ? '#4ade80' : '#f87171' }}>${Math.round(sessionLeaderboard[1].bankroll).toLocaleString()}</div>
                    <div style={{ fontSize: '0.75rem', color: sessionLeaderboard[1].bankroll - startingChips >= 0 ? '#4ade80' : '#f87171' }}>{sessionLeaderboard[1].bankroll - startingChips >= 0 ? '+' : ''}${Math.round(sessionLeaderboard[1].bankroll - startingChips).toLocaleString()}</div>
                  </div>
                )}
                <div style={{ background: 'linear-gradient(to bottom, rgba(212,175,55,0.2), rgba(212,175,55,0.05))', border: '1px solid rgba(212,175,55,0.4)', borderRadius: '12px', padding: '24px', textAlign: 'center', boxShadow: '0 0 30px rgba(212,175,55,0.2)', width: isMobile ? '100%' : '160px' }}>
                  <div style={{ fontSize: '2.25rem', marginBottom: '4px' }}>🥇</div>
                  <div style={{ fontSize: '1rem', color: '#d4af37', fontWeight: 'bold' }}>{sessionLeaderboard[0].name}</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: sessionLeaderboard[0].bankroll >= startingChips ? '#4ade80' : '#f87171' }}>${Math.round(sessionLeaderboard[0].bankroll).toLocaleString()}</div>
                  <div style={{ fontSize: '0.75rem', color: sessionLeaderboard[0].bankroll - startingChips >= 0 ? '#4ade80' : '#f87171' }}>{sessionLeaderboard[0].bankroll - startingChips >= 0 ? '+' : ''}${Math.round(sessionLeaderboard[0].bankroll - startingChips).toLocaleString()}</div>
                </div>
                {sessionLeaderboard.length >= 3 && (
                  <div style={{ background: 'linear-gradient(to bottom, rgba(205,127,50,0.15), rgba(205,127,50,0.05))', border: '2px solid rgba(205,127,50,0.4)', borderRadius: '12px', padding: '16px', textAlign: 'center', width: isMobile ? '100%' : '130px' }}>
                    <div style={{ fontSize: '1.5rem', marginBottom: '4px' }}>🥉</div>
                    <div style={{ fontSize: '0.875rem', color: '#d1d5db', fontWeight: 'bold' }}>{sessionLeaderboard[2].name}</div>
                    <div style={{ fontSize: '1rem', fontWeight: 'bold', color: sessionLeaderboard[2].bankroll >= startingChips ? '#4ade80' : '#f87171' }}>${Math.round(sessionLeaderboard[2].bankroll).toLocaleString()}</div>
                    <div style={{ fontSize: '0.75rem', color: sessionLeaderboard[2].bankroll - startingChips >= 0 ? '#4ade80' : '#f87171' }}>{sessionLeaderboard[2].bankroll - startingChips >= 0 ? '+' : ''}${Math.round(sessionLeaderboard[2].bankroll - startingChips).toLocaleString()}</div>
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
                  <div style={{ border: `2px solid ${pnl >= 0 ? '#4caf50' : '#ef5350'}`, borderRadius: '12px', padding: '20px', marginBottom: '24px', background: pnl >= 0 ? 'rgba(76,175,80,0.1)' : 'rgba(239,83,80,0.1)' }}>
                    <div style={{ fontSize: '11px', color: '#8892a4', letterSpacing: '2px', marginBottom: '8px' }}>YOUR RESULT — #{myRank} of {sessionLeaderboard.length}</div>
                    <div style={{ fontSize: '2.25rem', fontWeight: 'bold', color: pnl >= 0 ? '#4ade80' : '#f87171' }}>{pnl >= 0 ? '+' : ''}${pnl.toLocaleString()}</div>
                    <div style={{ color: '#8892a4', fontSize: '0.875rem', marginTop: '4px' }}>Final balance: ${Math.round(myResult.bankroll).toLocaleString()}</div>
                  </div>
                );
              })()}

              <p style={{ color: '#8892a4', fontSize: '0.875rem', marginBottom: '16px' }}>Waiting for next stream...</p>
              <div style={{ display: 'flex', justifyContent: 'center', gap: '8px' }}>
                {[0,1,2].map(i => <div key={i} style={{ animationDelay: `${i*0.2}s`, width: '8px', height: '8px', borderRadius: '50%', background: '#d4af37' }} className="animate-pulse" />)}
              </div>
            </>
          ) : (
            <>
              {sessionStatus === 'active' ? (
                <>
                  <div style={{ fontSize: '3.75rem', marginBottom: '20px' }}>🎰</div>
                  <h2 style={{ fontSize: '1.875rem', fontWeight: 'bold', color: '#d4af37', marginBottom: '12px', letterSpacing: '1.5px' }}>GAME OVER</h2>
                  <p style={{ color: '#8892a4', fontSize: '1rem', marginBottom: '8px' }}>Welcome, <span style={{ color: '#d4af37' }}>{playerName}</span>!</p>
                  <p style={{ color: '#8892a4', fontSize: '0.875rem', marginBottom: '32px' }}>The stream is live. Next game starting soon — hold tight.</p>
                  <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', marginBottom: '32px' }}>
                    {[0,1,2].map(i => <div key={i} style={{ animationDelay: `${i*0.2}s`, width: '12px', height: '12px', borderRadius: '50%', background: '#4caf50' }} className="animate-pulse" />)}
                  </div>
                  <div style={{ padding: '14px 20px', background: 'rgba(76,175,80,0.1)', backdropFilter: 'blur(8px)', border: '1px solid rgba(76,175,80,0.4)', borderRadius: '20px', color: '#4ade80', fontSize: '12px', display: 'inline-block', boxShadow: '0 0 20px rgba(76,175,80,0.2)' }}>
                    🟢 Stream is live
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: '3.75rem', marginBottom: '20px' }}>⏳</div>
                  <h2 style={{ fontSize: '2.25rem', fontWeight: 'bold', color: '#d4af37', marginBottom: '16px', letterSpacing: '1.5px' }}>WAITING FOR DEALER</h2>
                  <p style={{ color: '#8892a4', fontSize: '1rem', marginBottom: '8px' }}>Welcome, <span style={{ color: '#d4af37' }}>{playerName}</span>!</p>
                  <p style={{ color: '#8892a4', fontSize: '0.875rem', marginBottom: '32px' }}>Stream hasn't started yet. This page will update automatically when it does.</p>
                  <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', marginBottom: '32px' }}>
                    {[0,1,2].map(i => <div key={i} style={{ animationDelay: `${i*0.2}s`, width: '12px', height: '12px', borderRadius: '50%', background: '#d4af37' }} className="animate-pulse" />)}
                  </div>
                </>
              )}

              {/* VOD library — only show published VODs to players */}
              {vods.filter(v => v.published ?? true).length > 0 && (
                <div style={{ background: 'rgba(12,15,35,0.55)', backdropFilter: 'blur(16px)', border: '1px solid rgba(212,175,55,0.15)', borderRadius: '16px', padding: '20px', textAlign: 'left', boxShadow: '0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)', marginBottom: '16px' }}>
                  <div style={{ color: '#d4af37', fontSize: '11px', letterSpacing: '2px', marginBottom: '16px', fontWeight: 'bold' }}>📹 VOD LIBRARY — PLAY ANYTIME</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {vods.filter(v => v.published ?? true).map(vod => {
                      const roundCount = vod.script ? Object.keys(vod.script).length : 0;
                      const lbCount    = vod.leaderboard ? Object.keys(vod.leaderboard).length : 0;
                      const myEntry    = vod.leaderboard?.[playerUid];
                      return (
                        <button
                          key={vod.id}
                          onClick={() => setSelectedVodId(vod.id)}
                          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(212,175,55,0.12)', borderRadius: '10px', cursor: 'pointer', textAlign: 'left', gap: '12px' }}
                        >
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ color: '#fff', fontSize: '13px', fontWeight: '700', marginBottom: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{vod.title}</div>
                            <div style={{ color: 'rgba(136,146,164,0.5)', fontSize: '11px' }}>
                              {roundCount} round{roundCount !== 1 ? 's' : ''} · ${(vod.startingChips || 1000).toLocaleString()} start · {lbCount} completion{lbCount !== 1 ? 's' : ''}
                            </div>
                          </div>
                          <div style={{ flexShrink: 0, textAlign: 'right' }}>
                            {myEntry ? (
                              <div style={{ color: myEntry.bankroll >= (vod.startingChips || 1000) ? '#4ade80' : '#f87171', fontSize: '12px', fontWeight: '700' }}>
                                {myEntry.bankroll - (vod.startingChips || 1000) >= 0 ? '+' : ''}${Math.round(myEntry.bankroll - (vod.startingChips || 1000)).toLocaleString()}
                              </div>
                            ) : (
                              <div style={{ color: '#d4af37', fontSize: '11px', fontWeight: '700' }}>▶ Play</div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {sessionHistory.length > 0 && (
                <div style={{ background: 'rgba(12,15,35,0.55)', backdropFilter: 'blur(16px)', border: '1px solid rgba(212,175,55,0.15)', borderRadius: '16px', padding: '20px', textAlign: 'left', boxShadow: '0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)' }}>
                  <div style={{ color: '#d4af37', fontSize: '11px', letterSpacing: '2px', marginBottom: '16px', fontWeight: 'bold' }}>📜 PAST SESSIONS</div>
                  {sessionHistory.slice(0, 5).map((session) => {
                    const entries = session.finalLeaderboard ? Object.values(session.finalLeaderboard).sort((a,b) => b.bankroll - a.bankroll) : [];
                    const myEntry = entries.find(p => p.playerUid === playerUid);
                    const myRank  = entries.findIndex(p => p.playerUid === playerUid) + 1;
                    return (
                      <div key={session.sessionNumber} style={{ padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div style={{ color: '#8892a4', fontSize: '0.75rem' }}>
                            Session #{session.sessionNumber}
                            <span style={{ color: 'rgba(136,146,164,0.5)', marginLeft: '8px', fontSize: '11px' }}>{new Date(session.startedAt).toLocaleDateString()}</span>
                          </div>
                          {myEntry ? (
                            <div style={{ textAlign: 'right' }}>
                              <span style={{ fontSize: '0.875rem', fontWeight: 'bold', color: myEntry.bankroll - session.startingChips >= 0 ? '#4ade80' : '#f87171' }}>
                                {myEntry.bankroll - session.startingChips >= 0 ? '+' : ''}${Math.round(myEntry.bankroll - session.startingChips).toLocaleString()}
                              </span>
                              <span style={{ color: 'rgba(136,146,164,0.5)', fontSize: '11px', marginLeft: '8px' }}>#{myRank}</span>
                            </div>
                          ) : <span style={{ color: 'rgba(136,146,164,0.5)', fontSize: '11px' }}>Did not play</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

            </>
          )}
          </div>
        </div>
      </div>
    );
  }

  // ── Dealer hub ────────────────────────────────────────────────────────────────
  const joinLink       = `${window.location.origin}${window.location.pathname}?dealer=${dealerUid}`;
  const vanityJoinLink = dealerRoomCode ? `${window.location.origin}${window.location.pathname}?room=${dealerRoomCode}` : null;
  const overlayLink    = `${joinLink}#overlay`;

  const GAMES = [
    { id: 'craps',    emoji: '🎲', label: 'CRAPS',    desc: 'Pass line, odds, place bets, hard ways, hop bets and more.', tags: ['15+ Bet Types','Odds','Fire Bet'],       accentColor: '#22c55e', borderColor: 'rgba(34,197,94,0.4)',  bgGradient: 'linear-gradient(135deg, rgba(20,83,45,0.7) 0%, rgba(15,60,35,0.8) 100%)' },
    { id: 'baccarat', emoji: '🃏', label: 'BACCARAT', desc: 'Bet on Player, Banker, or Tie. Dragon and Panda bonus bets.', tags: ['Player / Banker','🐉 Dragon','🐼 Panda'], accentColor: '#3b82f6', borderColor: 'rgba(59,130,246,0.4)',  bgGradient: 'linear-gradient(135deg, rgba(30,58,138,0.7) 0%, rgba(15,30,90,0.8) 100%)' },
    { id: 'roulette', emoji: '🎡', label: 'ROULETTE', desc: 'American double-zero roulette. Full inside and outside bets.', tags: ['0 & 00','Straight Up 35:1','Inside/Out'], accentColor: '#ef4444', borderColor: 'rgba(239,68,68,0.4)', bgGradient: 'linear-gradient(135deg, rgba(127,29,29,0.7) 0%, rgba(80,10,10,0.8) 100%)' },
  ];

  return (
    <div style={{ minHeight: '100vh', background: 'radial-gradient(ellipse at 20% 0%, rgba(212,175,55,0.12) 0%, transparent 55%), radial-gradient(ellipse at 80% 100%, rgba(59,130,246,0.07) 0%, transparent 55%), #080b1a' }}>

      {/* ── Top navbar ── */}
      <nav style={{ position: 'sticky', top: 0, zIndex: 100, background: 'rgba(8,11,26,0.85)', backdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(212,175,55,0.12)', padding: '0 24px' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', height: '60px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>

          {/* Logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
            <span style={{ fontSize: '22px' }}>🎰</span>
            <span style={{ fontWeight: '800', fontSize: '16px', color: '#d4af37', letterSpacing: '3px', textShadow: '0 0 20px rgba(212,175,55,0.4)' }}>ACTION SYNC</span>
          </div>

          {/* Status pill */}
          <div style={{
            padding: '6px 14px', borderRadius: '20px', fontSize: '12px', fontWeight: '700', letterSpacing: '0.5px',
            background: sessionStatus === 'active' ? 'rgba(34,197,94,0.15)' : 'rgba(212,175,55,0.1)',
            border: `1px solid ${sessionStatus === 'active' ? 'rgba(34,197,94,0.5)' : 'rgba(212,175,55,0.3)'}`,
            color: sessionStatus === 'active' ? '#4ade80' : '#d4af37',
            boxShadow: sessionStatus === 'active' ? '0 0 16px rgba(34,197,94,0.2)' : 'none',
          }}>
            {sessionStatus === 'active' ? '● LIVE' : '○ OFF AIR'}
          </div>

          {/* Right: user + sign out */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
            {!isMobile && <span style={{ color: 'rgba(136,146,164,0.7)', fontSize: '13px' }}>{user?.displayName || user?.email}</span>}
            <button onClick={signOut} style={{ padding: '6px 14px', background: 'transparent', border: '1px solid rgba(136,146,164,0.25)', borderRadius: '8px', color: 'rgba(136,146,164,0.6)', fontSize: '12px', cursor: 'pointer' }}>
              Sign Out
            </button>
          </div>
        </div>
      </nav>

      {/* ── Page content ── */}
      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: isMobile ? '24px 16px' : '32px 24px' }}>

        {/* Session banner */}
        {sessionStatus !== 'active' ? (
          <div style={{ marginBottom: '32px', padding: '20px 28px', background: 'rgba(212,175,55,0.06)', border: '1px solid rgba(212,175,55,0.2)', borderRadius: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
            <div>
              <div style={{ color: '#d4af37', fontWeight: '700', fontSize: '15px', marginBottom: '4px' }}>Stream is off air</div>
              <div style={{ color: 'rgba(136,146,164,0.7)', fontSize: '13px' }}>Go Live to open the session for players · select a game below to begin</div>
            </div>
            <button
              onClick={() => setShowGoLiveModal(true)}
              style={{ padding: '12px 32px', background: 'linear-gradient(135deg, #22c55e, #4ade80)', border: 'none', borderRadius: '10px', color: '#000', fontSize: '14px', fontWeight: '800', letterSpacing: '1px', cursor: 'pointer', boxShadow: '0 4px 24px rgba(34,197,94,0.4)', whiteSpace: 'nowrap' }}
            >
              🟢 GO LIVE
            </button>
          </div>
        ) : (
          <div style={{ marginBottom: '32px', padding: '16px 28px', background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#4ade80', boxShadow: '0 0 8px rgba(74,222,128,0.8)' }} className="animate-pulse" />
              <span style={{ color: '#4ade80', fontWeight: '700', fontSize: '14px' }}>Stream is live</span>
              {selectedGame && <span style={{ color: 'rgba(136,146,164,0.6)', fontSize: '13px' }}>· {selectedGame.toUpperCase()} active</span>}
            </div>
            <button
              onClick={() => setShowNewSessionConfirm(true)}
              style={{ padding: '10px 24px', background: 'rgba(212,175,55,0.1)', border: '1px solid rgba(212,175,55,0.4)', borderRadius: '10px', color: '#d4af37', fontSize: '13px', fontWeight: '700', cursor: 'pointer' }}
            >
              🏁 End Stream
            </button>
          </div>
        )}

        {/* Session error */}
        {sessionError && (
          <div style={{ marginBottom: '20px', padding: '12px 16px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#f87171', fontSize: '14px' }}>{sessionError}</span>
            <button onClick={() => setSessionError(null)} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: '18px', lineHeight: 1 }}>×</button>
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '4px', marginBottom: '24px', background: 'rgba(255,255,255,0.04)', borderRadius: '10px', padding: '4px', width: 'fit-content' }}>
          {[{ id: 'games', label: '🎮 Games' }, { id: 'videos', label: '📹 Videos' }, { id: 'settings', label: '⚙️ Settings' }].map(t => (
            <button key={t.id} onClick={() => setHubTab(t.id)} style={{
              padding: '8px 20px', borderRadius: '7px', fontSize: '13px', fontWeight: '600', cursor: 'pointer', border: 'none', transition: 'all 0.15s',
              background: hubTab === t.id ? 'rgba(212,175,55,0.15)' : 'transparent',
              color: hubTab === t.id ? '#d4af37' : 'rgba(136,146,164,0.5)',
            }}>
              {t.label}
            </button>
          ))}
        </div>

        {hubTab === 'settings' ? (
          <SettingsPanel dealerUid={dealerUid} />
        ) : hubTab === 'videos' ? (
          <VODScriptEditor dealerUid={dealerUid} />
        ) : (
          <>
            {/* Game cards */}
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: '16px', marginBottom: '24px' }}>
              {GAMES.map(game => {
                const isActive = selectedGame === game.id;
                return (
                  <div
                    key={game.id}
                    onClick={() => setActiveGame(game.id)}
                    style={{
                      background: game.bgGradient,
                      border: `1px solid ${isActive ? game.accentColor : game.borderColor}`,
                      borderRadius: '16px', padding: '24px', cursor: 'pointer',
                      transition: 'all 0.2s', position: 'relative', overflow: 'hidden',
                      boxShadow: isActive ? `0 0 0 2px ${game.accentColor}, 0 12px 40px rgba(0,0,0,0.5)` : '0 4px 20px rgba(0,0,0,0.4)',
                    }}
                    onMouseEnter={e => { if (!isActive) { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = `0 12px 40px rgba(0,0,0,0.5), 0 0 0 1px ${game.borderColor}`; } }}
                    onMouseLeave={e => { if (!isActive) { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 20px rgba(0,0,0,0.4)'; } }}
                  >
                    {isActive && (
                      <div style={{ position: 'absolute', top: '12px', right: '12px', background: game.accentColor, color: '#000', fontSize: '10px', fontWeight: '800', padding: '3px 8px', borderRadius: '20px', letterSpacing: '0.5px' }}>
                        ACTIVE
                      </div>
                    )}
                    <div style={{ fontSize: '40px', marginBottom: '12px', filter: `drop-shadow(0 0 12px ${game.accentColor}60)` }}>{game.emoji}</div>
                    <div style={{ fontSize: '18px', fontWeight: '800', color: '#fff', marginBottom: '8px', letterSpacing: '1px' }}>{game.label}</div>
                    <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: '13px', lineHeight: '1.5', marginBottom: '16px' }}>{game.desc}</div>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '16px' }}>
                      {game.tags.map(t => (
                        <span key={t} style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.8)', fontSize: '11px', fontWeight: '600', padding: '3px 8px', borderRadius: '4px' }}>{t}</span>
                      ))}
                    </div>
                    <div style={{
                      padding: '10px', borderRadius: '8px', textAlign: 'center', fontSize: '13px', fontWeight: '700',
                      background: isActive ? game.accentColor : 'rgba(255,255,255,0.07)',
                      color: isActive ? '#000' : 'rgba(255,255,255,0.7)',
                      border: isActive ? 'none' : '1px solid rgba(255,255,255,0.1)',
                    }}>
                      {isActive ? `✓ ${game.label} is active` : `Activate ${game.label}`}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Bottom row: starting stack + share link */}
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '16px', marginBottom: '16px' }}>

              {/* Starting stack */}
              <div style={{ padding: '20px', background: 'rgba(12,15,35,0.6)', backdropFilter: 'blur(16px)', borderRadius: '14px', border: '1px solid rgba(255,255,255,0.07)' }}>
                <div style={{ color: '#d4af37', fontSize: '11px', fontWeight: '700', letterSpacing: '2px', marginBottom: '14px', textTransform: 'uppercase' }}>💰 Starting Stack</div>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px' }}>
                  {[500,1000,2500,5000,10000].map(amt => (
                    <button key={amt} onClick={() => handleSetStartingChips(amt)} style={{
                      flex: 1, padding: '9px 4px', borderRadius: '8px', fontSize: '13px', fontWeight: '700', cursor: 'pointer', minWidth: '56px', border: '1px solid',
                      background: startingChips === amt ? '#d4af37' : 'rgba(255,255,255,0.04)',
                      borderColor: startingChips === amt ? '#d4af37' : 'rgba(255,255,255,0.1)',
                      color: startingChips === amt ? '#000' : 'rgba(136,146,164,0.7)',
                      boxShadow: startingChips === amt ? '0 0 12px rgba(212,175,55,0.3)' : 'none',
                    }}>
                      ${amt >= 1000 ? (amt/1000)+'k' : amt}
                    </button>
                  ))}
                </div>
                <button onClick={handleResetAllBankrolls} style={{ width: '100%', padding: '10px', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: '8px', color: '#4ade80', fontSize: '12px', fontWeight: '700', cursor: 'pointer', letterSpacing: '0.5px' }}>
                  🔄 Reset All to ${startingChips.toLocaleString()}
                </button>
                {resetSuccess && <div style={{ marginTop: '8px', color: '#4ade80', fontSize: '12px', textAlign: 'center' }}>✅ All players reset</div>}
              </div>

              {/* Share link */}
              <div style={{ padding: '20px', background: 'rgba(12,15,35,0.6)', backdropFilter: 'blur(16px)', borderRadius: '14px', border: '1px solid rgba(255,255,255,0.07)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                  <div style={{ color: '#d4af37', fontSize: '11px', fontWeight: '700', letterSpacing: '2px', textTransform: 'uppercase' }}>🔗 Share with Players</div>
                  {dealerRoomCode && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ color: '#fff', fontSize: '15px', fontWeight: '800', letterSpacing: '3px', fontFamily: 'monospace' }}>{dealerRoomCode}</span>
                      <button onClick={() => { setShowChangeCode(!showChangeCode); setCodeError(null); setCodeSuccess(null); setCodeInput(''); }} style={{ padding: '3px 8px', background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '4px', color: 'rgba(136,146,164,0.6)', fontSize: '10px', cursor: 'pointer' }}>
                        Change
                      </button>
                    </div>
                  )}
                </div>

                {showChangeCode && (
                  <div style={{ marginBottom: '12px', padding: '12px', background: 'rgba(212,175,55,0.05)', borderRadius: '8px', border: '1px solid rgba(212,175,55,0.15)' }}>
                    <p style={{ color: 'rgba(136,146,164,0.6)', fontSize: '11px', marginBottom: '8px' }}>New room code (old one will be released)</p>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input value={codeInput} onChange={e => { setCodeInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'')); setCodeError(null); }} placeholder="NEW CODE" maxLength={16}
                        style={{ flex: 1, padding: '8px 12px', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#fff', fontSize: '14px', letterSpacing: '2px', outline: 'none', fontFamily: 'inherit' }} />
                      <button onClick={handleClaimCode} disabled={codeLoading || codeInput.length < 3} style={{ padding: '8px 14px', background: '#d4af37', border: 'none', borderRadius: '6px', color: '#000', fontWeight: '700', fontSize: '13px', cursor: 'pointer', opacity: (codeLoading || codeInput.length < 3) ? 0.4 : 1 }}>{codeLoading ? '...' : 'Save'}</button>
                      <button onClick={() => setShowChangeCode(false)} style={{ padding: '8px 12px', background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: 'rgba(136,146,164,0.6)', fontSize: '13px', cursor: 'pointer' }}>✕</button>
                    </div>
                    {codeError   && <p style={{ color: '#f87171', fontSize: '11px', marginTop: '6px' }}>{codeError}</p>}
                    {codeSuccess && <p style={{ color: '#4ade80', fontSize: '11px', marginTop: '6px' }}>✅ {codeSuccess}</p>}
                  </div>
                )}

                {vanityJoinLink && (
                  <div style={{ marginBottom: '10px' }}>
                    <div style={{ color: 'rgba(136,146,164,0.5)', fontSize: '10px', marginBottom: '6px', letterSpacing: '2px', textTransform: 'uppercase' }}>Room Link</div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'stretch' }}>
                      <code style={{ flex: 1, background: 'rgba(0,0,0,0.3)', color: 'rgba(255,255,255,0.7)', fontSize: '11px', padding: '9px 12px', borderRadius: '8px', wordBreak: 'break-all', fontFamily: 'monospace', border: '1px solid rgba(255,255,255,0.07)' }}>{vanityJoinLink}</code>
                      <button onClick={() => { navigator.clipboard.writeText(vanityJoinLink); setCopySuccess(true); setTimeout(() => setCopySuccess(false), 2000); }}
                        style={{ padding: '9px 16px', background: copySuccess ? '#22c55e' : '#d4af37', border: 'none', borderRadius: '8px', color: '#000', fontWeight: '700', fontSize: '12px', cursor: 'pointer', whiteSpace: 'nowrap', boxShadow: copySuccess ? '0 0 12px rgba(34,197,94,0.4)' : 'none' }}>
                        {copySuccess ? '✓ Copied' : 'Copy'}
                      </button>
                    </div>
                  </div>
                )}

                <div style={{ color: 'rgba(136,146,164,0.35)', fontSize: '10px', lineHeight: '1.6', marginTop: '8px' }}>
                  Players can type <span style={{ fontFamily: 'monospace', color: 'rgba(136,146,164,0.55)' }}>{dealerRoomCode}</span> on the join screen · Overlay: <code style={{ fontFamily: 'monospace' }}>{overlayLink}</code>
                </div>
              </div>
            </div>

            {/* Session history */}
            {sessionHistory.length > 0 && (
              <div style={{ padding: '20px', background: 'rgba(12,15,35,0.6)', backdropFilter: 'blur(16px)', borderRadius: '14px', border: '1px solid rgba(255,255,255,0.07)' }}>
                <div style={{ color: '#d4af37', fontSize: '11px', fontWeight: '700', letterSpacing: '2px', marginBottom: '14px', textTransform: 'uppercase' }}>📜 Session History</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {sessionHistory.slice(0, 10).map(session => {
                    const entries = session.finalLeaderboard ? Object.values(session.finalLeaderboard).sort((a,b) => b.bankroll - a.bankroll) : [];
                    return (
                      <details key={session.sessionNumber} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '10px', overflow: 'hidden' }}>
                        <summary style={{ padding: '12px 16px', cursor: 'pointer', color: 'rgba(136,146,164,0.8)', fontSize: '13px', display: 'flex', justifyContent: 'space-between', listStyle: 'none', userSelect: 'none' }}>
                          <span>Session #{session.sessionNumber} <span style={{ color: 'rgba(136,146,164,0.4)', marginLeft: '8px', fontSize: '11px' }}>{new Date(session.startedAt).toLocaleDateString()}</span></span>
                          <span style={{ color: 'rgba(136,146,164,0.4)', fontSize: '11px' }}>{entries.length} players · ${session.startingChips?.toLocaleString()} start</span>
                        </summary>
                        <div style={{ padding: '4px 16px 12px' }}>
                          {entries.slice(0, 8).map((p, idx) => {
                            const pnl = Math.round(p.bankroll - session.startingChips);
                            return (
                              <div key={p.playerUid || idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                                  <span style={{ fontSize: '13px', width: '22px', color: idx === 0 ? '#d4af37' : idx === 1 ? '#9ca3af' : idx === 2 ? '#cd7f32' : 'rgba(136,146,164,0.4)' }}>
                                    {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx+1}`}
                                  </span>
                                  <span style={{ color: 'rgba(255,255,255,0.75)', fontSize: '13px' }}>{p.name}</span>
                                </div>
                                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                                  <span style={{ color: '#fff', fontSize: '13px', fontWeight: '700' }}>${Math.round(p.bankroll).toLocaleString()}</span>
                                  <span style={{ fontSize: '12px', minWidth: '52px', textAlign: 'right', color: pnl >= 0 ? '#4ade80' : '#f87171', fontWeight: '600' }}>{pnl >= 0 ? '+' : ''}${pnl.toLocaleString()}</span>
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

            {/* Hint */}
            <p style={{ color: 'rgba(136,146,164,0.3)', fontSize: '11px', textAlign: 'center', marginTop: '24px', lineHeight: '1.7' }}>
              Activate a game above to push it to all players · Switch games freely mid-session
              <br />Virtual entertainment only · No real money · 18+ only
            </p>
          </>
        )}
      </div>

      {/* ── Modals ── */}
      {showNewSessionConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }} onClick={() => setShowNewSessionConfirm(false)}>
          <div style={{ background: 'rgba(10,12,28,0.97)', backdropFilter: 'blur(20px)', border: '1px solid rgba(212,175,55,0.25)', borderRadius: '20px', padding: '36px', maxWidth: '400px', width: '100%', boxShadow: '0 32px 80px rgba(0,0,0,0.8)' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: '3rem', textAlign: 'center', marginBottom: '12px' }}>🏁</div>
            <div style={{ color: '#d4af37', textAlign: 'center', fontSize: '20px', fontWeight: '800', marginBottom: '12px' }}>End Stream?</div>
            <p style={{ textAlign: 'center', color: 'rgba(136,146,164,0.8)', fontSize: '14px', lineHeight: 1.6, marginBottom: '6px' }}>
              This will lock in the final leaderboard and end the session.
            </p>
            <p style={{ color: 'rgba(136,146,164,0.4)', fontSize: '12px', textAlign: 'center', marginBottom: '24px' }}>Set the starting stack before the next session begins. Player accounts and history are preserved.</p>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button onClick={() => setShowNewSessionConfirm(false)} style={{ flex: 1, padding: '12px', background: 'transparent', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '10px', color: 'rgba(136,146,164,0.7)', fontSize: '14px', cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
              <button onClick={handleStartNewSession} disabled={newSessionLoading} style={{ flex: 1, padding: '12px', background: 'linear-gradient(135deg, #d4af37, #f0c93a)', border: 'none', borderRadius: '10px', color: '#000', fontSize: '14px', fontWeight: '800', cursor: 'pointer', fontFamily: 'inherit' }}>
                {newSessionLoading ? 'Ending...' : '🏁 End Stream'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showGoLiveModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }} onClick={() => { if (!goLiveLoading) setShowGoLiveModal(false); }}>
          <div style={{ background: 'rgba(10,12,28,0.97)', backdropFilter: 'blur(20px)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: '20px', padding: '36px', maxWidth: '420px', width: '100%', boxShadow: '0 32px 80px rgba(0,0,0,0.8)' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: '3rem', textAlign: 'center', marginBottom: '12px' }}>🟢</div>
            <div style={{ color: '#4ade80', textAlign: 'center', fontSize: '20px', fontWeight: '800', marginBottom: '8px' }}>Going Live</div>
            <p style={{ textAlign: 'center', color: 'rgba(136,146,164,0.7)', fontSize: '13px', marginBottom: '28px' }}>Set the starting stack for all players this session.</p>

            <div style={{ color: '#d4af37', fontSize: '11px', fontWeight: '700', letterSpacing: '2px', marginBottom: '12px', textTransform: 'uppercase' }}>💰 Starting Stack</div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '24px' }}>
              {[500, 1000, 2500, 5000, 10000].map(amt => (
                <button
                  key={amt}
                  onClick={() => handleSetStartingChips(amt)}
                  style={{
                    flex: 1, minWidth: '64px', padding: '10px 4px', borderRadius: '8px', fontSize: '13px', fontWeight: '700', cursor: 'pointer', border: '1px solid',
                    background: startingChips === amt ? '#d4af37' : 'rgba(255,255,255,0.04)',
                    borderColor: startingChips === amt ? '#d4af37' : 'rgba(255,255,255,0.1)',
                    color: startingChips === amt ? '#000' : '#888',
                    fontFamily: 'inherit',
                  }}
                >
                  ${amt.toLocaleString()}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                onClick={() => setShowGoLiveModal(false)}
                disabled={goLiveLoading}
                style={{ flex: 1, padding: '12px', background: 'transparent', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '10px', color: 'rgba(136,146,164,0.7)', fontSize: '14px', cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  setGoLiveLoading(true);
                  try {
                    await handleSetStartingChips(startingChips);
                    await startStream(dealerUid);
                    setSessionStatus('active');
                    setShowGoLiveModal(false);
                  } catch (e) {
                    setSessionError('Failed to go live: ' + e.message);
                  } finally {
                    setGoLiveLoading(false);
                  }
                }}
                disabled={goLiveLoading}
                style={{ flex: 1, padding: '12px', background: 'linear-gradient(135deg, #22c55e, #4ade80)', border: 'none', borderRadius: '10px', color: '#000', fontSize: '14px', fontWeight: '800', cursor: 'pointer', fontFamily: 'inherit' }}
              >
                {goLiveLoading ? 'Starting...' : '🟢 Go Live'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showResetConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }} onClick={() => setShowResetConfirm(false)}>
          <div style={{ background: 'rgba(10,12,28,0.97)', backdropFilter: 'blur(20px)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: '20px', padding: '36px', maxWidth: '400px', width: '100%', boxShadow: '0 32px 80px rgba(0,0,0,0.8)' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: '3rem', textAlign: 'center', marginBottom: '12px' }}>🔄</div>
            <div style={{ color: '#4ade80', textAlign: 'center', fontSize: '20px', fontWeight: '800', marginBottom: '12px' }}>Reset All Bankrolls?</div>
            <p style={{ textAlign: 'center', color: 'rgba(136,146,164,0.8)', fontSize: '14px', lineHeight: 1.6, marginBottom: '24px' }}>
              Every player will be reset to <strong style={{ color: '#f0e6d3' }}>${startingChips.toLocaleString()}</strong>. This cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button onClick={() => setShowResetConfirm(false)} style={{ flex: 1, padding: '12px', background: 'transparent', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '10px', color: 'rgba(136,146,164,0.7)', fontSize: '14px', cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
              <button onClick={performResetAllBankrolls} style={{ flex: 1, padding: '12px', background: '#22c55e', border: 'none', borderRadius: '10px', color: '#000', fontWeight: '800', fontSize: '14px', cursor: 'pointer', fontFamily: 'inherit' }}>Reset All</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const App = () => {
  if (window.location.hash === '#overlay' || window.location.pathname === '/overlay') {
    return <StreamOverlay dealerUidFromUrl={getDealerUidFromUrl()} roomCodeFromUrl={getRoomCodeFromUrl()} />;
  }
  return <AppMain />;
};

export default App;
