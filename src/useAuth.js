// useAuth.js — Phase 3
// Wraps Firebase Auth for both dealers and players.
//
// Dealer:  signs in → their uid is the permanent room ID
//          on first sign-up they claim a vanity code (e.g. MIKECASINO)
//          that maps roomCodes/MIKECASINO → dealerUid
// Player:  signs in or creates account → uid scopes their data under dealer's room
//          joins a room via vanity code or join link (?dealer=uid or ?room=CODE)
//
// onAuthStateChanged fires on every page load — returning users auto-restored.

import { useState, useEffect, useCallback } from 'react';
import { auth, authHelpers, database, ref, set, get, update } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { claimRoomCode, changeRoomCode, resolveRoomCode } from './useFirebaseSync';

// ── Role detection ─────────────────────────────────────────────────────────────
const DEALER_ROLE = 'dealer';
const PLAYER_ROLE = 'player';

async function getUserRole(uid) {
  const snap = await get(ref(database, `userRoles/${uid}`));
  return snap.exists() ? snap.val() : null;
}

async function setUserRole(uid, role) {
  await set(ref(database, `userRoles/${uid}`), role);
}

// ── Main hook ──────────────────────────────────────────────────────────────────
export function useAuth() {
  const [user, setUser]               = useState(null);
  const [role, setRole]               = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError]     = useState(null);
  // needsRoomCode: true when a dealer just signed up but hasn't claimed a code yet
  const [needsRoomCode, setNeedsRoomCode] = useState(false);

  // Restore session on page load
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const r = await getUserRole(firebaseUser.uid);
        setUser(firebaseUser);
        setRole(r);
        // Check if dealer still needs to claim a room code
        if (r === DEALER_ROLE) {
          const settingsSnap = await get(ref(database, `rooms/${firebaseUser.uid}/settings/roomCode`));
          setNeedsRoomCode(!settingsSnap.exists());
        }
      } else {
        setUser(null);
        setRole(null);
        setNeedsRoomCode(false);
      }
      setAuthLoading(false);
    });
    return () => unsub();
  }, []);

  // ── Dealer sign-up ────────────────────────────────────────────────────────
  // vanityCode is optional here — if omitted, needsRoomCode is set to true
  // and App shows the claim step before the dealer hub.
  const dealerSignUp = useCallback(async (email, password, displayName, vanityCode) => {
    setAuthError(null);
    try {
      const cred = await authHelpers.signUp(email, password);
      await authHelpers.updateProfile(displayName);
      await setUserRole(cred.user.uid, DEALER_ROLE);

      // Bootstrap room settings (no roomCode yet)
      await set(ref(database, `rooms/${cred.user.uid}/settings`), {
        dealerName:    displayName,
        startingChips: 1000,
        sessionNumber: 0,
        createdAt:     Date.now(),
      });

      // Initialize minimal session so players can join immediately (even before code claim)
      await set(ref(database, `rooms/${cred.user.uid}/session`), {
        status: 'waiting',
        sessionNumber: 0,
        startedAt: null,
        activeGame: null
      });

      setUser(cred.user);
      setRole(DEALER_ROLE);

      // Attempt to claim vanity code if provided in sign-up form
      if (vanityCode) {
        const result = await claimRoomCode(cred.user.uid, vanityCode);
        if (!result.success) {
          // Code taken — let the claim screen handle it
          setNeedsRoomCode(true);
          setAuthError(`Account created! But: ${result.error} Please choose a different code.`);
        } else {
          setNeedsRoomCode(false);
        }
      } else {
        setNeedsRoomCode(true);
      }

      return { uid: cred.user.uid };
    } catch (e) {
      setAuthError(e.message);
      throw e;
    }
  }, []);

  // ── Dealer sign-in ────────────────────────────────────────────────────────
  const dealerSignIn = useCallback(async (email, password) => {
    setAuthError(null);
    try {
      const cred = await authHelpers.signIn(email, password);
      const r    = await getUserRole(cred.user.uid);
      if (r !== DEALER_ROLE) {
        await authHelpers.signOut();
        throw new Error('This account is not a dealer account.');
      }
      // Check if they still need to claim a code
      const settingsSnap = await get(ref(database, `rooms/${cred.user.uid}/settings/roomCode`));
      setUser(cred.user);
      setRole(DEALER_ROLE);
      setNeedsRoomCode(!settingsSnap.exists());

      // Ensure session exists for players to join
      const sessionSnap = await get(ref(database, `rooms/${cred.user.uid}/session/status`));
      if (!sessionSnap.exists()) {
        await set(ref(database, `rooms/${cred.user.uid}/session`), {
          status: 'waiting',
          sessionNumber: 0,
          startedAt: null,
          activeGame: null
        });
      }

      return { uid: cred.user.uid };
    } catch (e) {
      setAuthError(e.message);
      throw e;
    }
  }, []);

  // ── Player sign-up ────────────────────────────────────────────────────────
  const playerSignUp = useCallback(async (email, password, displayName, dealerUid, startingChips) => {
    setAuthError(null);
    try {
      const cred = await authHelpers.signUp(email, password);
      await authHelpers.updateProfile(displayName);
      await setUserRole(cred.user.uid, PLAYER_ROLE);

      // Verify dealer room exists
      const dealerSettingsSnap = await get(ref(database, `rooms/${dealerUid}/settings`));
      if (!dealerSettingsSnap.exists()) {
        await authHelpers.signOut();
        throw new Error('Dealer room not found. Check the room code and try again.');
      }

      const playerRef = ref(database, `rooms/${dealerUid}/players/${cred.user.uid}`);
      await set(playerRef, {
        uid:      cred.user.uid,
        name:     displayName,
        email,
        bankroll: startingChips,
        joinedAt: Date.now(),
        currentRoom: dealerUid,
        stats: {
          sessionsPlayed:   0,
          allTimeHigh:      startingChips,
          biggestSingleWin: 0,
          totalWagered:     0,
        }
      });

      setUser(cred.user);
      setRole(PLAYER_ROLE);
      return { uid: cred.user.uid };
    } catch (e) {
      setAuthError(e.message);
      throw e;
    }
  }, []);

  // ── Player sign-in ────────────────────────────────────────────────────────
  const playerSignIn = useCallback(async (email, password, dealerUid, startingChips) => {
    setAuthError(null);
    try {
      const cred = await authHelpers.signIn(email, password);
      const r    = await getUserRole(cred.user.uid);
      if (r === DEALER_ROLE) {
        await authHelpers.signOut();
        throw new Error('Use dealer login for dealer accounts.');
      }

      // Verify dealer room exists
      const dealerSettingsSnap = await get(ref(database, `rooms/${dealerUid}/settings`));
      if (!dealerSettingsSnap.exists()) {
        await authHelpers.signOut();
        throw new Error('Dealer room not found. Check the room code and try again.');
      }

      // Create player record under this dealer if first time joining
      const playerRef = ref(database, `rooms/${dealerUid}/players/${cred.user.uid}`);
      const snap      = await get(playerRef);
      if (!snap.exists()) {
        await set(playerRef, {
          uid:      cred.user.uid,
          name:     cred.user.displayName || email.split('@')[0],
          email,
          bankroll: startingChips,
          joinedAt: Date.now(),
          currentRoom: dealerUid,
          stats: {
            sessionsPlayed:   0,
            allTimeHigh:      startingChips,
            biggestSingleWin: 0,
            totalWagered:     0,
          }
        });
      } else {
        // Update currentRoom to track which room they're in
        await update(playerRef, { currentRoom: dealerUid });
      }

      setUser(cred.user);
      setRole(PLAYER_ROLE);
      return { uid: cred.user.uid, playerData: snap.exists() ? snap.val() : null };
    } catch (e) {
      setAuthError(e.message);
      throw e;
    }
  }, []);

  // ── Sign out ──────────────────────────────────────────────────────────────
  const signOut = useCallback(async () => {
    await authHelpers.signOut();
    setUser(null);
    setRole(null);
    setNeedsRoomCode(false);
  }, []);

  // ── Dealer: claim or change room code (called from App) ───────────────────
  const handleClaimRoomCode = useCallback(async (uid, code) => {
    setAuthError(null);
    const settingsSnap = await get(ref(database, `rooms/${uid}/settings/roomCode`));
    const oldCode      = settingsSnap.exists() ? settingsSnap.val() : null;
    const result = oldCode
      ? await changeRoomCode(uid, oldCode, code)
      : await claimRoomCode(uid, code);
    if (result.success) {
      setNeedsRoomCode(false);
    } else {
      setAuthError(result.error);
    }
    return result;
  }, []);

  return {
    user,
    role,
    authLoading,
    authError,
    setAuthError,
    needsRoomCode,        // true = dealer needs to claim/change their vanity code
    dealerSignUp,
    dealerSignIn,
    playerSignUp,
    playerSignIn,
    signOut,
    handleClaimRoomCode,
    isDealer: role === DEALER_ROLE,
    isPlayer: role === PLAYER_ROLE,
  };
}
