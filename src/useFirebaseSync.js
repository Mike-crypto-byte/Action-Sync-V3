// useFirebaseSync.js
// Shared Firebase hooks for real-time casino sync
//
// ARCHITECTURE:
//   session/users/{userId}       — shared bankroll, name, stats (carries across games)
//   session/leaderboard/{userId} — shared leaderboard (carries across games)
//   session/presence/{userId}    — shared active user tracking
//   session/chat/{messageId}     — shared chat across all games
//   games/{gameName}/state       — per-game state (spin result, dice roll, cards, etc.)

import { useEffect, useState, useCallback, useRef } from 'react';
import { ref, onValue, set, push, get, update } from 'firebase/database';
import { database as db } from './firebase';

// ============================================================
// 1. useGameState — Real-time game state sync (PER-GAME)
//    Dealer writes, everyone reads
// ============================================================
export function useGameState(gameName, defaultState) {
  const [state, setState] = useState(defaultState);
  const stateRef = useRef(defaultState);

  useEffect(() => {
    const dbRef = ref(db, `games/${gameName}/state`);
    const unsub = onValue(dbRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        setState(data);
        stateRef.current = data;
      }
    });
    return () => unsub();
  }, [gameName]);

  const updateGameState = useCallback(async (updates) => {
    const dbRef = ref(db, `games/${gameName}/state`);
    const merged = { ...stateRef.current, ...updates };
    await set(dbRef, merged);
  }, [gameName]);

  const resetGameState = useCallback(async (freshState) => {
    const dbRef = ref(db, `games/${gameName}/state`);
    await set(dbRef, freshState);
  }, [gameName]);

  return { gameState: state, updateGameState, resetGameState };
}

// ============================================================
// 2. useLeaderboard — Real-time leaderboard sync (SHARED SESSION)
//    Everyone reads, each user updates their own entry
// ============================================================
export function useLeaderboard() {
  const [leaderboard, setLeaderboard] = useState([]);

  useEffect(() => {
    const dbRef = ref(db, 'session/leaderboard');
    const unsub = onValue(dbRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        const leaders = Object.values(data)
          .sort((a, b) => b.bankroll - a.bankroll)
          .slice(0, 10);
        setLeaderboard(leaders);
      } else {
        setLeaderboard([]);
      }
    });
    return () => unsub();
  }, []);

  const updateLeaderboardEntry = useCallback(async (userId, name, newBankroll, isAdmin = false) => {
    const dbRef = ref(db, `session/leaderboard/${userId}`);
    await set(dbRef, {
      userId,
      name,
      bankroll: newBankroll,
      isAdmin,
      timestamp: Date.now()
    });
  }, []);

  const clearLeaderboard = useCallback(async () => {
    const dbRef = ref(db, 'session/leaderboard');
    await set(dbRef, null);
  }, []);

  return { leaderboard, updateLeaderboardEntry, clearLeaderboard };
}

// ============================================================
// 3. useChat — Real-time chat messages (SHARED SESSION)
//    Chat persists across game switches
// ============================================================
export function useChat() {
  const [chatMessages, setChatMessages] = useState([]);

  useEffect(() => {
    const dbRef = ref(db, 'session/chat');
    const unsub = onValue(dbRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        const msgs = Object.values(data)
          .sort((a, b) => a.timestamp - b.timestamp)
          .slice(-50);
        setChatMessages(msgs);
      } else {
        setChatMessages([]);
      }
    });
    return () => unsub();
  }, []);

  const sendMessage = useCallback(async (userId, userName, text) => {
    if (!text.trim()) return;
    const dbRef = ref(db, 'session/chat');
    await push(dbRef, {
      userId,
      userName,
      text: text.trim(),
      timestamp: Date.now()
    });
  }, []);

  const clearChat = useCallback(async () => {
    const dbRef = ref(db, 'session/chat');
    await set(dbRef, null);
  }, []);

  return { chatMessages, sendMessage, clearChat };
}

// ============================================================
// 4. useUserData — Per-user data (SHARED SESSION)
//    bankroll, name, stats carry across all games
// ============================================================
export function useUserData(userId) {
  const [userData, setUserData] = useState(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    if (!userId) return;
    const dbRef = ref(db, `session/users/${userId}`);
    const unsub = onValue(dbRef, (snapshot) => {
      if (snapshot.exists()) {
        setUserData(snapshot.val());
      }
      setIsLoaded(true);
    });
    return () => unsub();
  }, [userId]);

  const saveUserData = useCallback(async (data) => {
    if (!userId) return;
    const dbRef = ref(db, `session/users/${userId}`);
    const merged = { ...data, lastActive: Date.now() };
    await set(dbRef, merged);
  }, [userId]);

  const updateUserField = useCallback(async (updates) => {
    if (!userId) return;
    const dbRef = ref(db, `session/users/${userId}`);
    await update(dbRef, { ...updates, lastActive: Date.now() });
  }, [userId]);

  return { userData, isLoaded, saveUserData, updateUserField };
}

// ============================================================
// 5. usePresence — Track active users count (SHARED SESSION)
// ============================================================
export function usePresence(userId, userName) {
  const [activeUsers, setActiveUsers] = useState(0);

  useEffect(() => {
    if (!userId || !userName) return;

    const presenceRef = ref(db, `session/presence/${userId}`);
    set(presenceRef, { name: userName, lastSeen: Date.now() });

    const heartbeat = setInterval(() => {
      set(presenceRef, { name: userName, lastSeen: Date.now() });
    }, 10000);

    const allPresenceRef = ref(db, 'session/presence');
    const unsub = onValue(allPresenceRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        const now = Date.now();
        const active = Object.values(data).filter(
          u => now - u.lastSeen < 30000
        );
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
  }, [userId, userName]);

  return activeUsers;
}

// ============================================================
// 6. distributeBonusChips — Admin helper (SHARED SESSION)
// ============================================================
export async function distributeBonusChips(leaderboard, recipientId, amount, currentUserId, setBankroll) {
  if (amount <= 0) return;

  if (recipientId === 'all') {
    for (const player of leaderboard) {
      try {
        const dbRef = ref(db, `session/users/${player.userId}`);
        const snapshot = await get(dbRef);
        if (snapshot.exists()) {
          const data = snapshot.val();
          const newBankroll = data.bankroll + amount;
          await update(dbRef, { bankroll: newBankroll });
          const lbRef = ref(db, `session/leaderboard/${player.userId}`);
          await update(lbRef, { bankroll: newBankroll });
          if (player.userId === currentUserId) setBankroll(newBankroll);
        }
      } catch (e) {
        console.error(`Failed to update ${player.name}:`, e);
      }
    }
  } else {
    try {
      const dbRef = ref(db, `session/users/${recipientId}`);
      const snapshot = await get(dbRef);
      if (snapshot.exists()) {
        const data = snapshot.val();
        const newBankroll = data.bankroll + amount;
        await update(dbRef, { bankroll: newBankroll });
        const lbRef = ref(db, `session/leaderboard/${recipientId}`);
        await update(lbRef, { bankroll: newBankroll });
        if (recipientId === currentUserId) setBankroll(newBankroll);
      }
    } catch (e) {
      console.error('Failed to distribute bonus chips:', e);
    }
  }
}

// ============================================================
// 7. resetSession — Wipe everything (session + game state)
// ============================================================
export async function resetSession(gameName) {
  const gameRef = ref(db, `games/${gameName}`);
  await set(gameRef, null);
  const sessionRef = ref(db, 'session');
  await set(sessionRef, null);
}

// Reset just a game's state without touching session/bankroll
export async function resetGameOnly(gameName) {
  const gameRef = ref(db, `games/${gameName}/state`);
  await set(gameRef, null);
}
