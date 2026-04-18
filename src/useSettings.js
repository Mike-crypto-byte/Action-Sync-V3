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
// Each entry is { num, den } representing a "num to den" payout ratio.
export const DEFAULT_ODDS = {
  roulette: {
    straightUp:  { num: 35, den: 1 },
    split:       { num: 17, den: 1 },
    street:      { num: 11, den: 1 },
    corner:      { num:  8, den: 1 },
    fiveNumber:  { num:  6, den: 1 },
    sixLine:     { num:  5, den: 1 },
    dozen:       { num:  2, den: 1 },
    column:      { num:  2, den: 1 },
    evenMoney:   { num:  1, den: 1 },
  },
  craps: {
    passLine:    { num:  1, den: 1 },
    dontPass:    { num:  1, den: 1 },
    come:        { num:  1, den: 1 },
    dontCome:    { num:  1, den: 1 },
    place4_10:   { num:  9, den: 5 },
    place5_9:    { num:  7, den: 5 },
    place6_8:    { num:  7, den: 6 },
    field2:      { num:  2, den: 1 },
    field12:     { num:  3, den: 1 },
    anySeven:    { num:  4, den: 1 },
    anyCraps:    { num:  7, den: 1 },
    hardWay4_10: { num:  7, den: 1 },
    hardWay6_8:  { num:  9, den: 1 },
    hop:         { num: 15, den: 1 },
  },
  baccarat: {
    player:     { num:  1, den: 1 },
    banker:     { num:  1, den: 1 },  // commission handled separately in game logic
    tie:        { num:  8, den: 1 },
    playerPair: { num: 11, den: 1 },
    bankerPair: { num: 11, den: 1 },
    dragon:     { num: 40, den: 1 },
    panda:      { num: 25, den: 1 },
  },
  blackjack: {
    win:       { num:  1, den: 1 },
    lose:      { num:  1, den: 1 },
    blackjack: { num:  3, den: 2 },
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
  blackjack: {
    win:  true,
    lose: true,
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
  blackjack: {
    win:       'Win',
    lose:      'Lose',
    blackjack: 'Blackjack — natural 21 (paid instead of Win rate)',
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
  blackjack: {
    win:  'Win',
    lose: 'Lose',
  },
};

// ── Default game config ────────────────────────────────────────────────────────
export const DEFAULT_GAME_CONFIG = {
  roulette: {
    zeros: 'double', // 'single' = European (0 only) | 'double' = American (0 + 00)
  },
};

// ── Hook ───────────────────────────────────────────────────────────────────────
export function useSettings(dealerUid) {
  const [odds, setOdds]               = useState(DEFAULT_ODDS);
  const [betVisibility, setBetVisibility] = useState(DEFAULT_VISIBILITY);
  const [gameConfig, setGameConfig]   = useState(DEFAULT_GAME_CONFIG);
  const [isLoaded, setIsLoaded]       = useState(false);

  useEffect(() => {
    if (!dealerUid) return;
    const settingsRef = ref(db, `rooms/${dealerUid}/settings`);
    const unsub = onValue(settingsRef, (snap) => {
      if (snap.exists()) {
        const data = snap.val();
        // Deep merge with defaults so new bet types added later still appear.
        // Values are { num, den } objects; handle legacy integer values gracefully.
        if (data.odds) {
          const mergeOdds = (defaults, saved) => {
            const result = {};
            for (const key of Object.keys(defaults)) {
              const def = defaults[key];
              const sav = saved?.[key];
              if (sav === undefined || sav === null) {
                result[key] = { ...def };
              } else if (typeof sav === 'object' && 'num' in sav) {
                result[key] = { num: sav.num ?? def.num, den: sav.den ?? def.den };
              } else {
                // Legacy: saved as plain integer — treat as numerator, keep default denominator
                result[key] = { num: Number(sav), den: def.den };
              }
            }
            return result;
          };
          setOdds({
            roulette:  mergeOdds(DEFAULT_ODDS.roulette,  data.odds.roulette),
            craps:     mergeOdds(DEFAULT_ODDS.craps,     data.odds.craps),
            baccarat:  mergeOdds(DEFAULT_ODDS.baccarat,  data.odds.baccarat),
            blackjack: mergeOdds(DEFAULT_ODDS.blackjack, data.odds.blackjack),
          });
        }
        if (data.betVisibility) {
          setBetVisibility({
            roulette:  { ...DEFAULT_VISIBILITY.roulette,  ...data.betVisibility.roulette  },
            craps:     { ...DEFAULT_VISIBILITY.craps,     ...data.betVisibility.craps     },
            baccarat:  { ...DEFAULT_VISIBILITY.baccarat,  ...data.betVisibility.baccarat  },
            blackjack: { ...DEFAULT_VISIBILITY.blackjack, ...data.betVisibility.blackjack },
          });
        }
        if (data.gameConfig) {
          setGameConfig({
            roulette: { ...DEFAULT_GAME_CONFIG.roulette, ...data.gameConfig.roulette },
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

  // Save game config for one game
  const updateGameConfig = useCallback(async (game, newConfig) => {
    if (!dealerUid) return;
    await set(ref(db, `rooms/${dealerUid}/settings/gameConfig/${game}`), newConfig);
  }, [dealerUid]);

  // Reset game config to defaults
  const resetGameConfigToDefaults = useCallback(async (game) => {
    if (!dealerUid) return;
    await set(ref(db, `rooms/${dealerUid}/settings/gameConfig/${game}`), DEFAULT_GAME_CONFIG[game]);
  }, [dealerUid]);

  return {
    odds,
    betVisibility,
    gameConfig,
    isLoaded,
    updateOdds,
    updateVisibility,
    updateGameConfig,
    resetOddsToDefaults,
    resetVisibilityToDefaults,
    resetGameConfigToDefaults,
  };
}
