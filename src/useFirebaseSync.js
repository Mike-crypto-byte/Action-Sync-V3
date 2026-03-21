// useFirebaseSync.js
// Shared Firebase hooks for real-time casino sync
//
// ROOM ARCHITECTURE (Phase 1):
//   Every path lives under rooms/{roomCode}/...
//   roomCode comes from the URL (?room=ABC123) and is passed into every hook.
//
//   rooms/{roomCode}/session/users/{userId}         — bankroll, name, stats
//   rooms/{roomCode}/session/leaderboard/{userId}   — live leaderboard
//   rooms/{roomCode}/session/presence/{userId}      — active user tracking
//   rooms/{roomCode}/session/chat/{messageId}       — chat
//   rooms/{roomCode}/session/settings/startingChips — starting stack
//   rooms/{roomCode}/session/endOfSession           — end-of-session snapshot
//   rooms/{roomCode}/activeGame                     — which game is active
//   rooms/{roomCode}/games/{gameName}/state         — per-game state

import { useEffect, useState, useCallback, useRef } from 'react';
import { ref, onValue, set, push, get, update } from 'firebase/database';
import { database as db } from './firebase';

// ============================================================
// HELPER — build a room-scoped ref
// ============================================================
const roomRef = (roomCode, path) => ref(db, `rooms/${roomCode}/${path}`);

// ============================================================
// 1. useGameState — Real-time game state sync (PER-GAME)
//    Dealer writes, everyone reads
// ============================================================
export function useGameState(roomCode, gameName, defaultState) {
  const [state, setState] = useState(defaultState);
  const stateRef = useRef(defaultState);

  useEffect(() => {
    if (!roomCode) return;
    const dbRef = roomRef(roomCode, `games/${gameName}/state`);
    const unsub = onValue(dbRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        setState(data);
        stateRef.current = data;
      }
    });
    return () => unsub();
  }, [roomCode, gameName]);

  const updateGameState = useCallback(async (updates) => {
    if (!roomCode) return;
    const dbRef = roomRef(roomCode, `games/${gameName}/state`);
    const merged = { ...stateRef.current, ...updates };
    await set(dbRef, merged);
  }, [roomCode, gameName]);

  const resetGameState = useCallback(async (freshState) => {
    if (!roomCode) return;
    const dbRef = roomRef(roomCode, `games/${gameName}/state`);
    await set(dbRef, freshState);
  }, [roomCode, gameName]);

  return { gameState: state, updateGameState, resetGameState };
}

// ============================================================
// 2. useLeaderboard — Real-time leaderboard sync (SHARED SESSION)
// ============================================================
export function useLeaderboard(roomCode) {
  const [leaderboard, setLeaderboard] = useState([]);

  useEffect(() => {
    if (!roomCode) return;
    const dbRef = roomRef(roomCode, 'session/leaderboard');
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
  }, [roomCode]);

  const updateLeaderboardEntry = useCallback(async (userId, name, newBankroll, isAdmin = false) => {
    if (!roomCode) return;
    const dbRef = roomRef(roomCode, `session/leaderboard/${userId}`);
    await set(dbRef, {
      userId,
      name,
      bankroll: newBankroll,
      isAdmin,
      timestamp: Date.now()
    });
  }, [roomCode]);

  const clearLeaderboard = useCallback(async () => {
    if (!roomCode) return;
    const dbRef = roomRef(roomCode, 'session/leaderboard');
    await set(dbRef, null);
  }, [roomCode]);

  return { leaderboard, updateLeaderboardEntry, clearLeaderboard };
}

// ============================================================
// 3. useChat — Real-time chat (SHARED SESSION)
// ============================================================
export function useChat(roomCode) {
  const [chatMessages, setChatMessages] = useState([]);

  useEffect(() => {
    if (!roomCode) return;
    const dbRef = roomRef(roomCode, 'session/chat');
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
  }, [roomCode]);

  const sendMessage = useCallback(async (userId, userName, text) => {
    if (!roomCode || !text.trim()) return;
    const dbRef = roomRef(roomCode, 'session/chat');
    await push(dbRef, {
      userId,
      userName,
      text: text.trim(),
      timestamp: Date.now()
    });
  }, [roomCode]);

  const clearChat = useCallback(async () => {
    if (!roomCode) return;
    const dbRef = roomRef(roomCode, 'session/chat');
    await set(dbRef, null);
  }, [roomCode]);

  return { chatMessages, sendMessage, clearChat };
}

// ============================================================
// 4. useUserData — Per-user data (SHARED SESSION)
// ============================================================
export function useUserData(roomCode, userId) {
  const [userData, setUserData] = useState(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    if (!roomCode || !userId) return;
    const dbRef = roomRef(roomCode, `session/users/${userId}`);
    const unsub = onValue(dbRef, (snapshot) => {
      if (snapshot.exists()) {
        setUserData(snapshot.val());
      }
      setIsLoaded(true);
    });
    return () => unsub();
  }, [roomCode, userId]);

  const saveUserData = useCallback(async (data) => {
    if (!roomCode || !userId) return;
    const dbRef = roomRef(roomCode, `session/users/${userId}`);
    const merged = { ...data, lastActive: Date.now() };
    await set(dbRef, merged);
  }, [roomCode, userId]);

  const updateUserField = useCallback(async (updates) => {
    if (!roomCode || !userId) return;
    const dbRef = roomRef(roomCode, `session/users/${userId}`);
    await update(dbRef, { ...updates, lastActive: Date.now() });
  }, [roomCode, userId]);

  return { userData, isLoaded, saveUserData, updateUserField };
}

// ============================================================
// 5. usePresence — Track active users count (SHARED SESSION)
// ============================================================
export function usePresence(roomCode, userId, userName) {
  const [activeUsers, setActiveUsers] = useState(0);

  useEffect(() => {
    if (!roomCode || !userId || !userName) return;

    const presenceRef = roomRef(roomCode, `session/presence/${userId}`);
    set(presenceRef, { name: userName, lastSeen: Date.now() });

    const heartbeat = setInterval(() => {
      set(presenceRef, { name: userName, lastSeen: Date.now() });
    }, 10000);

    const allPresenceRef = roomRef(roomCode, 'session/presence');
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
  }, [roomCode, userId, userName]);

  return activeUsers;
}

// ============================================================
// 6. distributeBonusChips — Admin helper (SHARED SESSION)
// ============================================================
export async function distributeBonusChips(roomCode, leaderboard, recipientId, amount, currentUserId, setBankroll) {
  if (!roomCode || amount <= 0) return;

  if (recipientId === 'all') {
    for (const player of leaderboard) {
      try {
        const dbRef = roomRef(roomCode, `session/users/${player.userId}`);
        const snapshot = await get(dbRef);
        if (snapshot.exists()) {
          const data = snapshot.val();
          const newBankroll = data.bankroll + amount;
          await update(dbRef, { bankroll: newBankroll });
          const lbRef = roomRef(roomCode, `session/leaderboard/${player.userId}`);
          await update(lbRef, { bankroll: newBankroll });
          if (player.userId === currentUserId) setBankroll(newBankroll);
        }
      } catch (e) {
        console.error(`Failed to update ${player.name}:`, e);
      }
    }
  } else {
    try {
      const dbRef = roomRef(roomCode, `session/users/${recipientId}`);
      const snapshot = await get(dbRef);
      if (snapshot.exists()) {
        const data = snapshot.val();
        const newBankroll = data.bankroll + amount;
        await update(dbRef, { bankroll: newBankroll });
        const lbRef = roomRef(roomCode, `session/leaderboard/${recipientId}`);
        await update(lbRef, { bankroll: newBankroll });
        if (recipientId === currentUserId) setBankroll(newBankroll);
      }
    } catch (e) {
      console.error('Failed to distribute bonus chips:', e);
    }
  }
}

// ============================================================
// 7. resetSession — Wipe everything under the room
// ============================================================
export async function resetSession(roomCode, gameName) {
  if (!roomCode) return;
  const gameRef = roomRef(roomCode, `games/${gameName}`);
  await set(gameRef, null);
  const sessionRef = roomRef(roomCode, 'session');
  await set(sessionRef, null);
}

// Reset just a game's state without touching session/bankroll
export async function resetGameOnly(roomCode, gameName) {
  if (!roomCode) return;
  const gameRef = roomRef(roomCode, `games/${gameName}/state`);
  await set(gameRef, null);
}
