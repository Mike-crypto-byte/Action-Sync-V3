// useSettings.js — Phase 4
//
// Reads and writes dealer-configured odds and bet visibility controls.
// Path: rooms/{dealerUid}/settings/odds/{game}/...
//       rooms/{dealerUid}/settings/betVisibility/{game}/...
//
// IMPORTANT — "next game start" enforcement:
//   Game components call useSettings(dealerUid) and read the snapshot ONCE
//   on mount. Changes written here take effect when the dealer resets or
//   switches games, not mid-round.

import { useEffect, useState, useCallback } from 'react';
import { ref, onValue, set, update } from 'firebase/database';
import { database as db } from './firebase';

// ── Default odds ───────────────────────────────────────────────────────────────
export const DEFAULT_ODDS = {
  roulette: {
    straightUp:  35,
    split:       17,
    street:      11,
    corner:       8,
    fiveNumber:   6,
    sixLine:      5,
    dozen:        2,
    column:       2,
    evenMoney:    1,
  },
  craps: {
    passLine:     1,
    dontPass:     1,
    come:         1,
    dontCome:     1,
    place4_10:    9,   // paid as 9:5
    place5_9:     7,   // paid as 7:5
    place6_8:     7,   // paid as 7:6
    field2:       2,
    field12:      3,
    anySeven:     4,
    anyCraps:     7,
    hardWay4_10:  7,
    hardWay6_8:   9,
    hop:         15,
  },
  baccarat: {
    player:      1,
    banker:      1,   // commission handled separately in game logic
    tie:         8,
    playerPair: 11,
    bankerPair: 11,
    dragon:     40,
    panda:      25,
  },
};

// ── Default bet visibility (all on) ───────────────────────────────────────────
export const DEFAULT_VISIBILITY = {
  roulette: {
    straightUp:  true,
    split:       true,
    street:      true,
    corner:      true,
    fiveNumber:  true,
    sixLine:     true,
    dozen:       true,
    column:      true,
    evenMoney:   true,
  },
  craps: {
    passLine:    true,
    dontPass:    true,
    come:        true,
    dontCome:    true,
    place:       true,
    field:       true,
    hardWays:    true,
    hop:         true,
    proposition: true,
    fireBet:     true,
    odds:        true,
  },
  baccarat: {
    player:      true,
    banker:      true,
    tie:         true,
    playerPair:  true,
    bankerPair:  true,
    dragon:      true,
    panda:       true,
  },
};

// ── Human-readable labels ──────────────────────────────────────────────────────
export const ODDS_LABELS = {
  roulette: {
    straightUp:  'Straight Up',
    split:       'Split',
    street:      'Street',
    corner:      'Corner',
    fiveNumber:  'Five Number (0-00-1-2-3)',
    sixLine:     'Six Line',
    dozen:       'Dozen',
    column:      'Column',
    evenMoney:   'Even Money (Red/Black/Odd/Even/Hi/Lo)',
  },
  craps: {
    passLine:    'Pass Line',
    dontPass:    "Don't Pass",
    come:        'Come',
    dontCome:    "Don't Come",
    place4_10:   'Place 4 & 10 (numerator, paid X:5)',
    place5_9:    'Place 5 & 9 (numerator, paid X:5)',
    place6_8:    'Place 6 & 8 (numerator, paid X:6)',
    field2:      'Field — 2',
    field12:     'Field — 12',
    anySeven:    'Any Seven',
    anyCraps:    'Any Craps',
    hardWay4_10: 'Hard 4 & 10',
    hardWay6_8:  'Hard 6 & 8',
    hop:         'Hop Bets',
  },
  baccarat: {
    player:     'Player',
    banker:     'Banker (commission separate)',
    tie:        'Tie',
    playerPair: 'Player Pair',
    bankerPair: 'Banker Pair',
    dragon:     'Dragon Bonus',
    panda:      'Panda 8',
  },
};

export const VISIBILITY_LABELS = {
  roulette: {
    straightUp:  'Straight Up (single numbers)',
    split:       'Split (2 numbers)',
    street:      'Street (3 numbers)',
    corner:      'Corner (4 numbers)',
    fiveNumber:  'Five Number (0-00-1-2-3)',
    sixLine:     'Six Line (6 numbers)',
    dozen:       'Dozens',
    column:      'Columns',
    evenMoney:   'Even Money (Red/Black/Odd/Even/Hi/Lo)',
  },
  craps: {
    passLine:    'Pass Line & Come',
    dontPass:    "Don't Pass & Don't Come",
    come:        'Come (separate button)',
    dontCome:    "Don't Come (separate button)",
    place:       'Place Bets (4/5/6/8/9/10)',
    field:       'Field',
    hardWays:    'Hard Ways',
    hop:         'Hop Bets',
    proposition: 'Proposition (Any Seven / Any Craps)',
    fireBet:     'Fire Bet',
    odds:        'Odds (behind Pass/Come)',
  },
  baccarat: {
    player:     'Player',
    banker:     'Banker',
    tie:        'Tie',
    playerPair: 'Player Pair',
    bankerPair: 'Banker Pair',
    dragon:     'Dragon Bonus',
    panda:      'Panda 8',
  },
};

// ── Hook ───────────────────────────────────────────────────────────────────────
export function useSettings(dealerUid) {
  const [odds, setOdds]               = useState(DEFAULT_ODDS);
  const [betVisibility, setBetVisibility] = useState(DEFAULT_VISIBILITY);
  const [isLoaded, setIsLoaded]       = useState(false);

  useEffect(() => {
    if (!dealerUid) return;
    const settingsRef = ref(db, `rooms/${dealerUid}/settings`);
    const unsub = onValue(settingsRef, (snap) => {
      if (snap.exists()) {
        const data = snap.val();
        // Deep merge with defaults so new bet types added later still appear
        if (data.odds) {
          setOdds({
            roulette: { ...DEFAULT_ODDS.roulette, ...data.odds.roulette },
            craps:    { ...DEFAULT_ODDS.craps,    ...data.odds.craps    },
            baccarat: { ...DEFAULT_ODDS.baccarat, ...data.odds.baccarat },
          });
        }
        if (data.betVisibility) {
          setBetVisibility({
            roulette: { ...DEFAULT_VISIBILITY.roulette, ...data.betVisibility.roulette },
            craps:    { ...DEFAULT_VISIBILITY.craps,    ...data.betVisibility.craps    },
            baccarat: { ...DEFAULT_VISIBILITY.baccarat, ...data.betVisibility.baccarat },
          });
        }
      }
      setIsLoaded(true);
    });
    return () => unsub();
  }, [dealerUid]);

  // Save entire odds object for one game
  const updateOdds = useCallback(async (game, newOdds) => {
    if (!dealerUid) return;
    await set(ref(db, `rooms/${dealerUid}/settings/odds/${game}`), newOdds);
  }, [dealerUid]);

  // Save entire visibility object for one game
  const updateVisibility = useCallback(async (game, newVisibility) => {
    if (!dealerUid) return;
    await set(ref(db, `rooms/${dealerUid}/settings/betVisibility/${game}`), newVisibility);
  }, [dealerUid]);

  // Reset one game's odds to defaults
  const resetOddsToDefaults = useCallback(async (game) => {
    if (!dealerUid) return;
    await set(ref(db, `rooms/${dealerUid}/settings/odds/${game}`), DEFAULT_ODDS[game]);
  }, [dealerUid]);

  // Reset one game's visibility to all-on
  const resetVisibilityToDefaults = useCallback(async (game) => {
    if (!dealerUid) return;
    await set(ref(db, `rooms/${dealerUid}/settings/betVisibility/${game}`), DEFAULT_VISIBILITY[game]);
  }, [dealerUid]);

  return {
    odds,
    betVisibility,
    isLoaded,
    updateOdds,
    updateVisibility,
    resetOddsToDefaults,
    resetVisibilityToDefaults,
  };
}
