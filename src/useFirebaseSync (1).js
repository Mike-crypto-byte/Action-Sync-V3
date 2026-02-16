// useFirebaseSync.js
// Shared Firebase hooks for real-time casino sync
// 
// SETUP: Make sure your firebase.js config exports { db } from firebase/database
// Example firebase.js:
//   import { initializeApp } from 'firebase/app';
//   import { getDatabase } from 'firebase/database';
//   const app = initializeApp({ /* your config */ });
//   export const db = getDatabase(app);

import { useEffect, useState, useCallback, useRef } from 'react';
import { ref, onValue, set, push, get, update } from 'firebase/database';
import { database as db } from './firebase'; // your firebase.js exports 'database'

// ============================================================
// 1. useGameState — Real-time game state sync
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

  // Only dealer should call this
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
// 2. useLeaderboard — Real-time leaderboard sync
//    Everyone reads, each user updates their own entry
// ============================================================
export function useLeaderboard(gameName) {
  const [leaderboard, setLeaderboard] = useState([]);

  useEffect(() => {
    const dbRef = ref(db, `games/${gameName}/leaderboard`);
    const unsub = onValue(dbRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        // Convert object to sorted array
        const leaders = Object.values(data)
          .sort((a, b) => b.bankroll - a.bankroll)
          .slice(0, 10);
        setLeaderboard(leaders);
      } else {
        setLeaderboard([]);
      }
    });
    return () => unsub();
  }, [gameName]);

  const updateLeaderboardEntry = useCallback(async (userId, name, newBankroll) => {
    const dbRef = ref(db, `games/${gameName}/leaderboard/${userId}`);
    await set(dbRef, {
      userId,
      name,
      bankroll: newBankroll,
      timestamp: Date.now()
    });
  }, [gameName]);

  const clearLeaderboard = useCallback(async () => {
    const dbRef = ref(db, `games/${gameName}/leaderboard`);
    await set(dbRef, null);
  }, [gameName]);

  return { leaderboard, updateLeaderboardEntry, clearLeaderboard };
}

// ============================================================
// 3. useChat — Real-time chat messages
//    Everyone reads and writes
// ============================================================
export function useChat(gameName) {
  const [chatMessages, setChatMessages] = useState([]);

  useEffect(() => {
    const dbRef = ref(db, `games/${gameName}/chat`);
    const unsub = onValue(dbRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        const msgs = Object.values(data)
          .sort((a, b) => a.timestamp - b.timestamp)
          .slice(-50); // Keep last 50
        setChatMessages(msgs);
      } else {
        setChatMessages([]);
      }
    });
    return () => unsub();
  }, [gameName]);

  const sendMessage = useCallback(async (userId, userName, text) => {
    if (!text.trim()) return;
    const dbRef = ref(db, `games/${gameName}/chat`);
    await push(dbRef, {
      userId,
      userName,
      text: text.trim(),
      timestamp: Date.now()
    });
  }, [gameName]);

  const clearChat = useCallback(async () => {
    const dbRef = ref(db, `games/${gameName}/chat`);
    await set(dbRef, null);
  }, [gameName]);

  return { chatMessages, sendMessage, clearChat };
}

// ============================================================
// 4. useUserData — Per-user data (bankroll, bets, stats)
//    Each user reads/writes their own path
// ============================================================
export function useUserData(gameName, userId) {
  const [userData, setUserData] = useState(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    if (!userId) return;
    const dbRef = ref(db, `games/${gameName}/users/${userId}`);
    const unsub = onValue(dbRef, (snapshot) => {
      if (snapshot.exists()) {
        setUserData(snapshot.val());
      }
      setIsLoaded(true);
    });
    return () => unsub();
  }, [gameName, userId]);

  const saveUserData = useCallback(async (data) => {
    if (!userId) return;
    const dbRef = ref(db, `games/${gameName}/users/${userId}`);
    const merged = { ...data, lastActive: Date.now() };
    await set(dbRef, merged);
  }, [gameName, userId]);

  const updateUserField = useCallback(async (updates) => {
    if (!userId) return;
    const dbRef = ref(db, `games/${gameName}/users/${userId}`);
    await update(dbRef, { ...updates, lastActive: Date.now() });
  }, [gameName, userId]);

  return { userData, isLoaded, saveUserData, updateUserField };
}

// ============================================================
// 5. usePresence — Track active users count
//    Each user registers on connect, cleans up on disconnect
// ============================================================
export function usePresence(gameName, userId, userName) {
  const [activeUsers, setActiveUsers] = useState(0);

  useEffect(() => {
    if (!userId || !userName) return;

    // Register presence
    const presenceRef = ref(db, `games/${gameName}/presence/${userId}`);
    set(presenceRef, { name: userName, lastSeen: Date.now() });

    // Heartbeat every 10 seconds
    const heartbeat = setInterval(() => {
      set(presenceRef, { name: userName, lastSeen: Date.now() });
    }, 10000);

    // Listen to all presence
    const allPresenceRef = ref(db, `games/${gameName}/presence`);
    const unsub = onValue(allPresenceRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        const now = Date.now();
        // Count users active in last 30 seconds
        const active = Object.values(data).filter(
          u => now - u.lastSeen < 30000
        );
        setActiveUsers(active.length);
      } else {
        setActiveUsers(0);
      }
    });

    // Cleanup on unmount
    return () => {
      clearInterval(heartbeat);
      set(presenceRef, null);
      unsub();
    };
  }, [gameName, userId, userName]);

  return activeUsers;
}

// ============================================================
// 6. distributeBonusChips — Admin helper to give chips to players
// ============================================================
export async function distributeBonusChips(gameName, leaderboard, recipientId, amount, currentUserId, setBankroll) {
  if (amount <= 0) return;

  if (recipientId === 'all') {
    for (const player of leaderboard) {
      try {
        const dbRef = ref(db, `games/${gameName}/users/${player.userId}`);
        const snapshot = await get(dbRef);
        if (snapshot.exists()) {
          const data = snapshot.val();
          const newBankroll = data.bankroll + amount;
          await update(dbRef, { bankroll: newBankroll });

          // Also update leaderboard entry
          const lbRef = ref(db, `games/${gameName}/leaderboard/${player.userId}`);
          await update(lbRef, { bankroll: newBankroll });

          if (player.userId === currentUserId) {
            setBankroll(newBankroll);
          }
        }
      } catch (e) {
        console.error(`Failed to update ${player.name}:`, e);
      }
    }
  } else {
    try {
      const dbRef = ref(db, `games/${gameName}/users/${recipientId}`);
      const snapshot = await get(dbRef);
      if (snapshot.exists()) {
        const data = snapshot.val();
        const newBankroll = data.bankroll + amount;
        await update(dbRef, { bankroll: newBankroll });

        const lbRef = ref(db, `games/${gameName}/leaderboard/${recipientId}`);
        await update(lbRef, { bankroll: newBankroll });

        if (recipientId === currentUserId) {
          setBankroll(newBankroll);
        }
      }
    } catch (e) {
      console.error('Failed to distribute bonus chips:', e);
    }
  }
}

// ============================================================
// 7. resetSession — Admin helper to wipe everything for a game
// ============================================================
export async function resetSession(gameName) {
  const gameRef = ref(db, `games/${gameName}`);
  await set(gameRef, null);
}
