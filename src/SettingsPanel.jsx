// SettingsPanel.jsx — Phase 4
// Dealer-only settings panel. Two tabs: Odds and Bet Types.
// Changes take effect on next game start — not mid-round.

import React, { useState, useEffect } from 'react';
import {
  useSettings,
  DEFAULT_ODDS,
  DEFAULT_VISIBILITY,
  ODDS_LABELS,
  VISIBILITY_LABELS,
} from './useSettings';

const GAMES = ['roulette', 'craps', 'baccarat'];
const GAME_LABELS = { roulette: '🎰 Roulette', craps: '🎲 Craps', baccarat: '🃏 Baccarat' };
const GAME_COLORS = { roulette: '#c62828', craps: '#2e7d32', baccarat: '#1565c0' };

// ── Shared styles ──────────────────────────────────────────────────────────────
const card = {
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: '12px',
  padding: '20px 24px',
  marginBottom: '12px',
};

const label = {
  color: '#aaa',
  fontSize: '12px',
  lineHeight: '1.4',
  flex: 1,
};

const pill = (active, color) => ({
  padding: '6px 16px',
  borderRadius: '20px',
  border: `1px solid ${active ? color : 'rgba(255,255,255,0.1)'}`,
  background: active ? `${color}22` : 'transparent',
  color: active ? color : '#555',
  fontSize: '12px',
  fontWeight: 'bold',
  cursor: 'pointer',
  fontFamily: 'inherit',
  letterSpacing: '0.5px',
  transition: 'all 0.15s ease',
});

const saveBtn = (saved) => ({
  padding: '10px 28px',
  background: saved
    ? 'rgba(76,175,80,0.15)'
    : 'linear-gradient(135deg,#d4af37,#f4e5a1)',
  border: saved ? '1px solid #4caf50' : 'none',
  borderRadius: '8px',
  color: saved ? '#4caf50' : '#000',
  fontSize: '13px',
  fontWeight: 'bold',
  cursor: 'pointer',
  fontFamily: 'inherit',
  letterSpacing: '0.5px',
  transition: 'all 0.2s ease',
});

// ── Number input with +/- stepper ─────────────────────────────────────────────
const OddsInput = ({ value, onChange, min = 1, max = 100 }) => {
  const inputStyle = {
    width: '56px',
    padding: '6px 8px',
    background: '#0d0d0d',
    border: '1px solid #333',
    borderRadius: '6px',
    color: '#fff',
    fontSize: '14px',
    fontWeight: 'bold',
    textAlign: 'center',
    outline: 'none',
    fontFamily: 'inherit',
  };
  const stepBtn = {
    width: '26px', height: '26px',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid #333',
    borderRadius: '5px',
    color: '#aaa',
    fontSize: '14px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    transition: 'background 0.1s',
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
      <button style={stepBtn} onClick={() => onChange(Math.max(min, value - 1))}>−</button>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        style={inputStyle}
        onChange={e => {
          const v = parseInt(e.target.value);
          if (!isNaN(v) && v >= min && v <= max) onChange(v);
        }}
      />
      <button style={stepBtn} onClick={() => onChange(Math.min(max, value + 1))}>+</button>
    </div>
  );
};

// ── Toggle switch ──────────────────────────────────────────────────────────────
const Toggle = ({ value, onChange, color = '#d4af37' }) => (
  <div
    onClick={() => onChange(!value)}
    style={{
      width: '40px', height: '22px',
      borderRadius: '11px',
      background: value ? color : '#333',
      cursor: 'pointer',
      position: 'relative',
      transition: 'background 0.2s',
      flexShrink: 0,
    }}
  >
    <div style={{
      width: '16px', height: '16px',
      borderRadius: '50%',
      background: '#fff',
      position: 'absolute',
      top: '3px',
      left: value ? '21px' : '3px',
      transition: 'left 0.2s',
      boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
    }} />
  </div>
);

// ── Odds tab for one game ──────────────────────────────────────────────────────
const OddsGameTab = ({ game, odds, onSave, onReset }) => {
  const [local, setLocal]   = useState({ ...odds });
  const [saved, setSaved]   = useState(false);
  const defaults            = DEFAULT_ODDS[game];
  const labels              = ODDS_LABELS[game];
  const color               = GAME_COLORS[game];

  // Sync if parent odds change (e.g. after reset)
  useEffect(() => { setLocal({ ...odds }); }, [odds]);

  const handleSave = async () => {
    await onSave(game, local);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleReset = async () => {
    await onReset(game);
    setLocal({ ...defaults });
  };

  const isDirty = Object.keys(local).some(k => local[k] !== odds[k]);

  return (
    <div>
      <div style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ color: '#666', fontSize: '11px', letterSpacing: '1px' }}>
          Changes take effect on next game start
        </div>
        <button onClick={handleReset} style={{ padding: '6px 14px', background: 'transparent', border: '1px solid #333', borderRadius: '6px', color: '#555', fontSize: '11px', cursor: 'pointer', fontFamily: 'inherit' }}>
          Reset to Defaults
        </button>
      </div>

      {Object.entries(labels).map(([key, lbl]) => {
        const isModified = local[key] !== defaults[key];
        return (
          <div key={key} style={{ ...card, display: 'flex', alignItems: 'center', gap: '16px', padding: '14px 20px' }}>
            <div style={{ ...label }}>
              {lbl}
              <div style={{ color: '#444', fontSize: '10px', marginTop: '2px' }}>
                Default: {defaults[key]}:1
                {isModified && <span style={{ color: color, marginLeft: '8px' }}>● Modified</span>}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <OddsInput
                value={local[key]}
                onChange={v => setLocal(prev => ({ ...prev, [key]: v }))}
              />
              <span style={{ color: '#444', fontSize: '12px' }}>: 1</span>
            </div>
          </div>
        );
      })}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '20px', gap: '10px' }}>
        {isDirty && !saved && (
          <div style={{ color: '#888', fontSize: '11px', alignSelf: 'center' }}>Unsaved changes</div>
        )}
        <button onClick={handleSave} style={saveBtn(saved)}>
          {saved ? '✅ Saved' : 'Save Odds'}
        </button>
      </div>
    </div>
  );
};

// ── Visibility tab for one game ────────────────────────────────────────────────
const VisibilityGameTab = ({ game, visibility, onSave, onReset }) => {
  const [local, setLocal] = useState({ ...visibility });
  const [saved, setSaved] = useState(false);
  const defaults          = DEFAULT_VISIBILITY[game];
  const labels            = VISIBILITY_LABELS[game];
  const color             = GAME_COLORS[game];

  useEffect(() => { setLocal({ ...visibility }); }, [visibility]);

  const handleSave = async () => {
    await onSave(game, local);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleReset = async () => {
    await onReset(game);
    setLocal({ ...defaults });
  };

  const allOn  = Object.values(local).every(Boolean);
  const allOff = Object.values(local).every(v => !v);

  return (
    <div>
      <div style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={() => setLocal(Object.fromEntries(Object.keys(local).map(k => [k, true])))}
            style={{ padding: '6px 14px', background: allOn ? `${color}22` : 'transparent', border: `1px solid ${allOn ? color : '#333'}`, borderRadius: '6px', color: allOn ? color : '#555', fontSize: '11px', cursor: 'pointer', fontFamily: 'inherit' }}>
            All On
          </button>
          <button onClick={() => setLocal(Object.fromEntries(Object.keys(local).map(k => [k, false])))}
            style={{ padding: '6px 14px', background: allOff ? 'rgba(244,67,54,0.1)' : 'transparent', border: `1px solid ${allOff ? '#f44336' : '#333'}`, borderRadius: '6px', color: allOff ? '#f44336' : '#555', fontSize: '11px', cursor: 'pointer', fontFamily: 'inherit' }}>
            All Off
          </button>
        </div>
        <button onClick={handleReset} style={{ padding: '6px 14px', background: 'transparent', border: '1px solid #333', borderRadius: '6px', color: '#555', fontSize: '11px', cursor: 'pointer', fontFamily: 'inherit' }}>
          Reset to Defaults
        </button>
      </div>

      <div style={{ color: '#555', fontSize: '10px', letterSpacing: '1px', marginBottom: '14px' }}>
        HIDDEN BET TYPES are removed from the player UI. Changes take effect on next game start.
      </div>

      {Object.entries(labels).map(([key, lbl]) => (
        <div key={key} style={{ ...card, display: 'flex', alignItems: 'center', gap: '16px', padding: '14px 20px' }}>
          <Toggle
            value={local[key]}
            onChange={v => setLocal(prev => ({ ...prev, [key]: v }))}
            color={color}
          />
          <div style={{ ...label, color: local[key] ? '#ccc' : '#555' }}>
            {lbl}
            {!local[key] && <span style={{ color: '#f44336', fontSize: '10px', marginLeft: '8px' }}>Hidden from players</span>}
          </div>
        </div>
      ))}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '20px', gap: '10px' }}>
        <button onClick={handleSave} style={saveBtn(saved)}>
          {saved ? '✅ Saved' : 'Save Bet Types'}
        </button>
      </div>
    </div>
  );
};

// ── Main SettingsPanel ─────────────────────────────────────────────────────────
const SettingsPanel = ({ dealerUid }) => {
  const {
    odds, betVisibility,
    updateOdds, updateVisibility,
    resetOddsToDefaults, resetVisibilityToDefaults,
    isLoaded,
  } = useSettings(dealerUid);

  const [mainTab, setMainTab]   = useState('odds');       // 'odds' | 'bets'
  const [gameTab, setGameTab]   = useState('roulette');   // 'roulette' | 'craps' | 'baccarat'

  if (!isLoaded) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px', color: '#555', fontSize: '13px' }}>
        Loading settings...
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto' }}>

      {/* Header */}
      <div style={{ marginBottom: '32px' }}>
        <div style={{ color: '#d4af37', fontSize: '20px', fontWeight: 'bold', letterSpacing: '1px', marginBottom: '6px' }}>
          ⚙️ Game Settings
        </div>
        <div style={{ color: '#555', fontSize: '12px', lineHeight: '1.6' }}>
          Configure payout odds and which bet types are available to players.
          All changes take effect when the dealer starts the next game.
        </div>
      </div>

      {/* Main tab row — Odds vs Bet Types */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '28px' }}>
        {[
          { id: 'odds', label: '📊 Odds Configurator' },
          { id: 'bets', label: '🎛️ Bet Visibility' },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setMainTab(t.id)}
            style={{
              padding: '10px 22px',
              background: mainTab === t.id ? 'rgba(212,175,55,0.15)' : 'transparent',
              border: `1px solid ${mainTab === t.id ? 'rgba(212,175,55,0.6)' : 'rgba(255,255,255,0.1)'}`,
              borderRadius: '8px',
              color: mainTab === t.id ? '#d4af37' : '#555',
              fontSize: '13px',
              fontWeight: mainTab === t.id ? 'bold' : 'normal',
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'all 0.15s',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Game sub-tab row */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
        {GAMES.map(g => (
          <button
            key={g}
            onClick={() => setGameTab(g)}
            style={pill(gameTab === g, GAME_COLORS[g])}
          >
            {GAME_LABELS[g]}
          </button>
        ))}
      </div>

      {/* Content */}
      {mainTab === 'odds' ? (
        <OddsGameTab
          key={`odds-${gameTab}`}
          game={gameTab}
          odds={odds[gameTab]}
          onSave={updateOdds}
          onReset={resetOddsToDefaults}
        />
      ) : (
        <VisibilityGameTab
          key={`vis-${gameTab}`}
          game={gameTab}
          visibility={betVisibility[gameTab]}
          onSave={updateVisibility}
          onReset={resetVisibilityToDefaults}
        />
      )}
    </div>
  );
};

export default SettingsPanel;
