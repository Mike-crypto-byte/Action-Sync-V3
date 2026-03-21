// firebase.js — Phase 2: Auth + Realtime Database
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, set, get, onValue, update, remove, push } from 'firebase/database';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile
} from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyDaIwkEjnssm9R7-WGKru6t6JjmuNAJltE",
  authDomain: "actionsync-b4ff9.firebaseapp.com",
  projectId: "actionsync-b4ff9",
  storageBucket: "actionsync-b4ff9.firebasestorage.app",
  messagingSenderId: "544582584102",
  appId: "1:544582584102:web:aff3a79344fd9cca4c23e7",
  measurementId: "G-QXRD0GPY08",
  databaseURL: "https://actionsync-b4ff9-default-rtdb.firebaseio.com"
};

const app = initializeApp(firebaseConfig);
const database = getDatabase(app);
const auth = getAuth(app);

export { database, auth, ref, set, get, onValue, update, remove, push };

// ── Database helpers ───────────────────────────────────────────────────────────
export const saveData = async (path, data) => {
  try { await set(ref(database, path), data); return true; }
  catch (e) { console.error('saveData error:', e); return false; }
};

export const loadData = async (path) => {
  try {
    const snap = await get(ref(database, path));
    return snap.exists() ? snap.val() : null;
  } catch (e) { console.error('loadData error:', e); return null; }
};

export const listenToData = (path, callback) => {
  const dataRef = ref(database, path);
  return onValue(dataRef, (snap) => callback(snap.exists() ? snap.val() : null));
};

export const updateData = async (path, updates) => {
  try { await update(ref(database, path), updates); return true; }
  catch (e) { console.error('updateData error:', e); return false; }
};

export const deleteData = async (path) => {
  try { await remove(ref(database, path)); return true; }
  catch (e) { console.error('deleteData error:', e); return false; }
};

// ── Auth helpers ───────────────────────────────────────────────────────────────
export const authHelpers = {
  signUp: (email, password) => createUserWithEmailAndPassword(auth, email, password),
  signIn: (email, password) => signInWithEmailAndPassword(auth, email, password),
  signOut: () => signOut(auth),
  updateProfile: (displayName) => updateProfile(auth.currentUser, { displayName }),
  onAuthStateChanged: (cb) => onAuthStateChanged(auth, cb),
};
