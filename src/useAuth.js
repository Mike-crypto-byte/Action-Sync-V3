// useAuth.js — Phase 2
// Wraps Firebase Auth for both dealers and players.
//
// Dealer:  signs in with email/password → their uid IS the permanent room ID
// Player:  signs in or creates account  → uid scopes their data under dealer's room
//
// onAuthStateChanged fires on every page load, so returning users are restored
// automatically — no re-registration, no sessionStorage tricks.

import { useState, useEffect, useCallback } from 'react';
import { auth, authHelpers, database, ref, set, get, update } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';

// ── Role detection ─────────────────────────────────────────────────────────────
// We store a "role" flag under /userRoles/{uid} so we can tell dealers from
// players without a separate password check.
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
  const [user, setUser]           = useState(null);   // Firebase Auth user object
  const [role, setRole]           = useState(null);   // 'dealer' | 'player' | null
  const [authLoading, setAuthLoading] = useState(true); // true until first auth check
  const [authError, setAuthError] = useState(null);

  // Restore session on page load
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const r = await getUserRole(firebaseUser.uid);
        setUser(firebaseUser);
        setRole(r);
      } else {
        setUser(null);
        setRole(null);
      }
      setAuthLoading(false);
    });
    return () => unsub();
  }, []);

  // ── Dealer sign-up (first time only, done out-of-band) ────────────────────
  const dealerSignUp = useCallback(async (email, password, displayName) => {
    setAuthError(null);
    try {
      const cred = await authHelpers.signUp(email, password);
      await authHelpers.updateProfile(displayName);
      await setUserRole(cred.user.uid, DEALER_ROLE);
      // Bootstrap the dealer's room settings
      await set(ref(database, `rooms/${cred.user.uid}/settings`), {
        dealerName: displayName,
        startingChips: 1000,
        sessionNumber: 0,
        createdAt: Date.now(),
      });
      setUser(cred.user);
      setRole(DEALER_ROLE);
      return { uid: cred.user.uid };
    } catch (e) {
      setAuthError(e.message);
      throw e;
    }
  }, []);

  // ── Dealer sign-in ─────────────────────────────────────────────────────────
  const dealerSignIn = useCallback(async (email, password) => {
    setAuthError(null);
    try {
      const cred = await authHelpers.signIn(email, password);
      const r = await getUserRole(cred.user.uid);
      if (r !== DEALER_ROLE) {
        await authHelpers.signOut();
        throw new Error('This account is not a dealer account.');
      }
      setUser(cred.user);
      setRole(DEALER_ROLE);
      return { uid: cred.user.uid };
    } catch (e) {
      setAuthError(e.message);
      throw e;
    }
  }, []);

  // ── Player sign-up ─────────────────────────────────────────────────────────
  const playerSignUp = useCallback(async (email, password, displayName, dealerUid, startingChips) => {
    setAuthError(null);
    try {
      const cred = await authHelpers.signUp(email, password);
      await authHelpers.updateProfile(displayName);
      await setUserRole(cred.user.uid, PLAYER_ROLE);

      // Bootstrap player record under the dealer's room
      const playerRef = ref(database, `rooms/${dealerUid}/players/${cred.user.uid}`);
      await set(playerRef, {
        uid: cred.user.uid,
        name: displayName,
        email,
        bankroll: startingChips,
        joinedAt: Date.now(),
        stats: {
          sessionsPlayed: 0,
          allTimeHigh: startingChips,
          biggestSingleWin: 0,
          totalWagered: 0,
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

  // ── Player sign-in ─────────────────────────────────────────────────────────
  const playerSignIn = useCallback(async (email, password, dealerUid, startingChips) => {
    setAuthError(null);
    try {
      const cred = await authHelpers.signIn(email, password);
      const r = await getUserRole(cred.user.uid);
      if (r === DEALER_ROLE) {
        await authHelpers.signOut();
        throw new Error('Use dealer login for dealer accounts.');
      }

      // If player doesn't have a record under this dealer yet, create one
      const playerRef = ref(database, `rooms/${dealerUid}/players/${cred.user.uid}`);
      const snap = await get(playerRef);
      if (!snap.exists()) {
        await set(playerRef, {
          uid: cred.user.uid,
          name: cred.user.displayName || email.split('@')[0],
          email,
          bankroll: startingChips,
          joinedAt: Date.now(),
          stats: {
            sessionsPlayed: 0,
            allTimeHigh: startingChips,
            biggestSingleWin: 0,
            totalWagered: 0,
          }
        });
      }

      setUser(cred.user);
      setRole(PLAYER_ROLE);
      return { uid: cred.user.uid, playerData: snap.exists() ? snap.val() : null };
    } catch (e) {
      setAuthError(e.message);
      throw e;
    }
  }, []);

  // ── Sign out ───────────────────────────────────────────────────────────────
  const signOut = useCallback(async () => {
    await authHelpers.signOut();
    setUser(null);
    setRole(null);
  }, []);

  return {
    user,           // Firebase Auth user (has .uid, .email, .displayName)
    role,           // 'dealer' | 'player' | null
    authLoading,    // true until onAuthStateChanged fires for the first time
    authError,      // last error message, or null
    setAuthError,
    dealerSignUp,
    dealerSignIn,
    playerSignUp,
    playerSignIn,
    signOut,
    isDealer: role === DEALER_ROLE,
    isPlayer: role === PLAYER_ROLE,
  };
}
