// Firebase Configuration and Setup
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, set, get, onValue, update, remove } from 'firebase/database';

// Your Firebase configuration
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

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const database = getDatabase(app);

// Export database and helper functions
export { database, ref, set, get, onValue, update, remove };

// Helper function to save data
export const saveData = async (path, data) => {
  try {
    await set(ref(database, path), data);
    return true;
  } catch (error) {
    console.error('Error saving data:', error);
    return false;
  }
};

// Helper function to load data
export const loadData = async (path) => {
  try {
    const snapshot = await get(ref(database, path));
    if (snapshot.exists()) {
      return snapshot.val();
    }
    return null;
  } catch (error) {
    console.error('Error loading data:', error);
    return null;
  }
};

// Helper function to listen to data changes in real-time
export const listenToData = (path, callback) => {
  const dataRef = ref(database, path);
  return onValue(dataRef, (snapshot) => {
    if (snapshot.exists()) {
      callback(snapshot.val());
    } else {
      callback(null);
    }
  });
};

// Helper function to update data
export const updateData = async (path, updates) => {
  try {
    await update(ref(database, path), updates);
    return true;
  } catch (error) {
    console.error('Error updating data:', error);
    return false;
  }
};

// Helper function to delete data
export const deleteData = async (path) => {
  try {
    await remove(ref(database, path));
    return true;
  } catch (error) {
    console.error('Error deleting data:', error);
    return false;
  }
};
