// useFirebaseSync.js — Phase 2
//
// PATH SCHEME (dealerUid is the permanent room ID):
//
//   rooms/{dealerUid}/settings/                        — dealer config
//   rooms/{dealerUid}/session/                         — CURRENT live session (wiped on new stream)
//     status                                           — "waiting" | "active" | "ended"
//     sessionNumber
//     startedAt
//     activeGame
//     leaderboard/{playerUid}
//     presence/{playerUid}
//     chat/{msgId}
//     games/{gameName}/state
//   rooms/{dealerUid}/players/{playerUid}/             — persistent player records
//     name, email, bankroll, stats/...
//   rooms/{dealerUid}/history/{sessionNumber}/         — archived session snapshots
//     startedAt, endedAt, startingChips
//     finalLeaderboard/{playerUid}

import { useEffect, useState, useCallback, useRef } from 'react';
import { ref, onValue, set, push, get, update } from 'firebase/database';
import { database as db } from './firebase';

// ── Path helper ────────────────────────────────────────────────────────────────
const rr = (dealerUid, path) => ref(db, `rooms/${dealerUid}/${path}`);

// ============================================================
// 1. useGameState
// ============================================================
export function useGameState(dealerUid, gameName, defaultState) {
  const [state, setState] = useState(defaultState);
  const stateRef = useRef(defaultState);

  useEffect(() => {
    if (!dealerUid) return;
    const dbRef = rr(dealerUid, `session/games/${gameName}/state`);
    const unsub = onValue(dbRef, (snap) => {
      if (snap.exists()) {
        setState(snap.val());
        stateRef.current = snap.val();
      }
    });
    return () => unsub();
  }, [dealerUid, gameName]);

  const updateGameState = useCallback(async (updates) => {
    if (!dealerUid) return;
    const dbRef = rr(dealerUid, `session/games/${gameName}/state`);
    await set(dbRef, { ...stateRef.current, ...updates });
  }, [dealerUid, gameName]);

  const resetGameState = useCallback(async (freshState) => {
    if (!dealerUid) return;
    await set(rr(dealerUid, `session/games/${gameName}/state`), freshState);
  }, [dealerUid, gameName]);

  return { gameState: state, updateGameState, resetGameState };
}

// ============================================================
// 2. useLeaderboard
// ============================================================
export function useLeaderboard(dealerUid) {
  const [leaderboard, setLeaderboard] = useState([]);

  useEffect(() => {
    if (!dealerUid) return;
    const dbRef = rr(dealerUid, 'session/leaderboard');
    const unsub = onValue(dbRef, (snap) => {
      if (snap.exists()) {
        const leaders = Object.values(snap.val())
          .sort((a, b) => b.bankroll - a.bankroll)
          .slice(0, 10);
        setLeaderboard(leaders);
      } else {
        setLeaderboard([]);
      }
    });
    return () => unsub();
  }, [dealerUid]);

  const updateLeaderboardEntry = useCallback(async (playerUid, name, newBankroll) => {
    if (!dealerUid) return;
    await set(rr(dealerUid, `session/leaderboard/${playerUid}`), {
      playerUid, name, bankroll: newBankroll, timestamp: Date.now()
    });
  }, [dealerUid]);

  const clearLeaderboard = useCallback(async () => {
    if (!dealerUid) return;
    await set(rr(dealerUid, 'session/leaderboard'), null);
  }, [dealerUid]);

  return { leaderboard, updateLeaderboardEntry, clearLeaderboard };
}

// ============================================================
// 3. useChat
// ============================================================
export function useChat(dealerUid) {
  const [chatMessages, setChatMessages] = useState([]);

  useEffect(() => {
    if (!dealerUid) return;
    const dbRef = rr(dealerUid, 'session/chat');
    const unsub = onValue(dbRef, (snap) => {
      if (snap.exists()) {
        const msgs = Object.values(snap.val())
          .sort((a, b) => a.timestamp - b.timestamp)
          .slice(-50);
        setChatMessages(msgs);
      } else {
        setChatMessages([]);
      }
    });
    return () => unsub();
  }, [dealerUid]);

  const sendMessage = useCallback(async (playerUid, userName, text) => {
    if (!dealerUid || !text.trim()) return;
    await push(rr(dealerUid, 'session/chat'), {
      playerUid, userName, text: text.trim(), timestamp: Date.now()
    });
  }, [dealerUid]);

  const clearChat = useCallback(async () => {
    if (!dealerUid) return;
    await set(rr(dealerUid, 'session/chat'), null);
  }, [dealerUid]);

  return { chatMessages, sendMessage, clearChat };
}

// ============================================================
// 4. usePlayerData — persistent player record (survives sessions)
// ============================================================
export function usePlayerData(dealerUid, playerUid) {
  const [playerData, setPlayerData] = useState(null);
  const [isLoaded, setIsLoaded]     = useState(false);

  useEffect(() => {
    if (!dealerUid || !playerUid) return;
    const dbRef = rr(dealerUid, `players/${playerUid}`);
    const unsub = onValue(dbRef, (snap) => {
      setPlayerData(snap.exists() ? snap.val() : null);
      setIsLoaded(true);
    });
    return () => unsub();
  }, [dealerUid, playerUid]);

  const savePlayerData = useCallback(async (data) => {
    if (!dealerUid || !playerUid) return;
    await set(rr(dealerUid, `players/${playerUid}`), { ...data, lastActive: Date.now() });
  }, [dealerUid, playerUid]);

  const updatePlayerField = useCallback(async (updates) => {
    if (!dealerUid || !playerUid) return;
    await update(rr(dealerUid, `players/${playerUid}`), { ...updates, lastActive: Date.now() });
  }, [dealerUid, playerUid]);

  // Called after every resolved bet — updates bankroll + rolling stats atomically
  const updateBankrollAndStats = useCallback(async (newBankroll, betAmount, winAmount) => {
    if (!dealerUid || !playerUid || !playerData) return;
    const stats = playerData.stats || {};
    const updates = {
      bankroll: newBankroll,
      lastActive: Date.now(),
      'stats/totalWagered': (stats.totalWagered || 0) + betAmount,
      'stats/allTimeHigh':  Math.max(stats.allTimeHigh || 0, newBankroll),
    };
    if (winAmount > (stats.biggestSingleWin || 0)) {
      updates['stats/biggestSingleWin'] = winAmount;
    }
    await update(rr(dealerUid, `players/${playerUid}`), updates);
    // Mirror bankroll to live leaderboard
    await update(rr(dealerUid, `session/leaderboard/${playerUid}`), {
      bankroll: newBankroll, timestamp: Date.now()
    });
  }, [dealerUid, playerUid, playerData]);

  return { playerData, isLoaded, savePlayerData, updatePlayerField, updateBankrollAndStats };
}

// Thin alias so game components don't need changes — useUserData still works
export function useUserData(dealerUid, playerUid) {
  const {
    playerData: userData, isLoaded,
    savePlayerData: saveUserData,
    updatePlayerField: updateUserField
  } = usePlayerData(dealerUid, playerUid);
  return { userData, isLoaded, saveUserData, updateUserField };
}

// ============================================================
// 5. usePresence
// ============================================================
export function usePresence(dealerUid, playerUid, userName) {
  const [activeUsers, setActiveUsers] = useState(0);

  useEffect(() => {
    if (!dealerUid || !playerUid || !userName) return;

    const presenceRef = rr(dealerUid, `session/presence/${playerUid}`);
    set(presenceRef, { name: userName, lastSeen: Date.now() });

    const heartbeat = setInterval(() => {
      set(presenceRef, { name: userName, lastSeen: Date.now() });
    }, 10000);

    const unsub = onValue(rr(dealerUid, 'session/presence'), (snap) => {
      if (snap.exists()) {
        const now    = Date.now();
        const active = Object.values(snap.val()).filter(u => now - u.lastSeen < 30000);
        setActiveUsers(active.length);
      } else {
        setActiveUsers(0);
      }
    });

    return () => {
      clearInterval(heartbeat);
      set(presenceRef, null);
      unsub();
    };
  }, [dealerUid, playerUid, userName]);

  return activeUsers;
}

// ============================================================
// 6. useSessionHistory — read-only archive for the history panel
// ============================================================
export function useSessionHistory(dealerUid) {
  const [history, setHistory] = useState([]);

  useEffect(() => {
    if (!dealerUid) return;
    const unsub = onValue(rr(dealerUid, 'history'), (snap) => {
      if (snap.exists()) {
        const sessions = Object.entries(snap.val())
          .map(([n, data]) => ({ sessionNumber: parseInt(n), ...data }))
          .sort((a, b) => b.sessionNumber - a.sessionNumber); // newest first
        setHistory(sessions);
      } else {
        setHistory([]);
      }
    });
    return () => unsub();
  }, [dealerUid]);

  return history;
}

// ============================================================
// 7. distributeBonusChips
// ============================================================
export async function distributeBonusChips(dealerUid, leaderboard, recipientId, amount, currentPlayerUid, setBankroll) {
  if (!dealerUid || amount <= 0) return;

  const targets = recipientId === 'all'
    ? leaderboard
    : leaderboard.filter(p => p.playerUid === recipientId);

  for (const player of targets) {
    try {
      const dbRef = rr(dealerUid, `players/${player.playerUid}`);
      const snap  = await get(dbRef);
      if (snap.exists()) {
        const newBankroll = snap.val().bankroll + amount;
        await update(dbRef, { bankroll: newBankroll });
        await update(rr(dealerUid, `session/leaderboard/${player.playerUid}`), { bankroll: newBankroll });
        if (player.playerUid === currentPlayerUid) setBankroll(newBankroll);
      }
    } catch (e) {
      console.error(`Failed to update ${player.name}:`, e);
    }
  }
}

// ============================================================
// 8. startNewSession — dealer hits "Start New Stream"
//    1. Archive current leaderboard → history/{prevSessionNumber}
//    2. Update each player's stats
//    3. Reset all bankrolls to startingChips
//    4. Wipe live session
//    5. Increment sessionNumber
// ============================================================
export async function startNewSession(dealerUid, startingChips) {
  if (!dealerUid) return;

  const settingsSnap = await get(rr(dealerUid, 'settings'));
  const settings     = settingsSnap.exists() ? settingsSnap.val() : {};
  const prevNumber   = settings.sessionNumber || 0;
  const newNumber    = prevNumber + 1;

  // Archive if there was a previous session
  if (prevNumber > 0) {
    const lbSnap = await get(rr(dealerUid, 'session/leaderboard'));
    if (lbSnap.exists()) {
      const finalLeaderboard = lbSnap.val();

      // Update each player's persistent stats
      for (const [uid, entry] of Object.entries(finalLeaderboard)) {
        try {
          const statsSnap = await get(rr(dealerUid, `players/${uid}/stats`));
          const stats     = statsSnap.exists() ? statsSnap.val() : {};
          await update(rr(dealerUid, `players/${uid}/stats`), {
            sessionsPlayed: (stats.sessionsPlayed || 0) + 1,
            allTimeHigh:    Math.max(stats.allTimeHigh || 0, entry.bankroll),
          });
        } catch (e) { /* player may no longer exist */ }
      }

      // Write history snapshot
      await set(rr(dealerUid, `history/${prevNumber}`), {
        sessionNumber:  prevNumber,
        startedAt:      settings.sessionStartedAt || Date.now(),
        endedAt:        Date.now(),
        startingChips:  settings.startingChips || startingChips,
        finalLeaderboard,
      });
    }
  }

  // Reset every player's bankroll to startingChips
  const playersSnap = await get(rr(dealerUid, 'players'));
  if (playersSnap.exists()) {
    for (const uid of Object.keys(playersSnap.val())) {
      await update(rr(dealerUid, `players/${uid}`), { bankroll: startingChips });
    }
  }

  // Wipe live session and write fresh shell
  await set(rr(dealerUid, 'session'), {
    status:        'waiting',
    sessionNumber:  newNumber,
    startedAt:      Date.now(),
    activeGame:     null,
  });

  // Persist updated settings
  await update(rr(dealerUid, 'settings'), {
    sessionNumber:    newNumber,
    sessionStartedAt: Date.now(),
    startingChips,
  });

  return newNumber;
}

// ============================================================
// 9. resetSession / resetGameOnly (kept for game component compatibility)
// ============================================================
export async function resetSession(dealerUid, gameName) {
  if (!dealerUid) return;
  await set(rr(dealerUid, `session/games/${gameName}`), null);
  await set(rr(dealerUid, 'session/leaderboard'), null);
  await set(rr(dealerUid, 'session/chat'), null);
  await set(rr(dealerUid, 'session/presence'), null);
}

export async function resetGameOnly(dealerUid, gameName) {
  if (!dealerUid) return;
  await set(rr(dealerUid, `session/games/${gameName}/state`), null);
}

// ============================================================
// 10. Phase 3 — Vanity room code helpers
// ============================================================

// Normalise any code the user types — uppercase, strip non-alphanumeric
export function normaliseCode(raw) {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Resolve a vanity code → dealerUid (null if not found)
export async function resolveRoomCode(code) {
  if (!code) return null;
  const snap = await get(ref(db, `roomCodes/${normaliseCode(code)}`));
  return snap.exists() ? snap.val() : null;
}

// Check if a vanity code is available (true = free to claim)
export async function isRoomCodeAvailable(code) {
  const snap = await get(ref(db, `roomCodes/${normaliseCode(code)}`));
  return !snap.exists();
}

// Claim a new vanity code for a dealer (writes both directions)
// Returns { success, error }
export async function claimRoomCode(dealerUid, code) {
  const norm = normaliseCode(code);
  if (norm.length < 3 || norm.length > 16) {
    return { success: false, error: 'Code must be 3–16 characters (letters and numbers only).' };
  }
  const snap = await get(ref(db, `roomCodes/${norm}`));
  if (snap.exists() && snap.val() !== dealerUid) {
    return { success: false, error: 'That code is already taken. Try another.' };
  }
  // Write lookup entry + reverse lookup in settings
  await set(ref(db, `roomCodes/${norm}`), dealerUid);
  await update(rr(dealerUid, 'settings'), { roomCode: norm });
  return { success: true, code: norm };
}

// Change a dealer's vanity code — deletes old, claims new
export async function changeRoomCode(dealerUid, oldCode, newCode) {
  const result = await claimRoomCode(dealerUid, newCode);
  if (!result.success) return result;
  // Delete old code only after new one is safely written
  if (oldCode && normaliseCode(oldCode) !== normaliseCode(newCode)) {
    await set(ref(db, `roomCodes/${normaliseCode(oldCode)}`), null);
  }
  return result;
}
