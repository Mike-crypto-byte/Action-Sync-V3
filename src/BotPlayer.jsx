// BotPlayer.jsx — AI-powered bot player using Claude API.
// Runs invisibly inside the dealer's browser. Watches game state,
// calls Claude (Haiku) to decide bets when betting opens, places them
// as a Firebase player, and resolves them when results arrive.

import { useState, useEffect, useRef } from 'react';
import Anthropic from '@anthropic-ai/sdk';
import { ref, set, onValue, push } from 'firebase/database';
import { database as db } from './firebase';
import { Bot, Power, PowerOff, ChevronDown } from 'lucide-react';

// ─── Personas ────────────────────────────────────────────────────────────────

const PERSONAS = [
  {
    id: 'shark',
    name: 'The Shark',
    emoji: '🦈',
    description: 'Conservative, calculated. Focuses on pass line and 6/8 place bets.',
    style: 'Pick 1-2 high-percentage bets (passLine, place6, place8). Bet 5-10% of bankroll. Short, confident chat.',
  },
  {
    id: 'degenerate',
    name: 'The Degenerate',
    emoji: '🎰',
    description: 'Reckless, chaotic. Bets everywhere, big swings.',
    style: 'Pick 3-4 bets including risky ones (field, any7, come). Bet 15-25% of bankroll. Loud, excitable chat.',
  },
  {
    id: 'tourist',
    name: 'The Tourist',
    emoji: '🤠',
    description: 'Cheerful newcomer. Bets small and random.',
    style: 'Pick 1-2 simple bets (passLine, red, player). Bet 3-7% of bankroll. Confused, enthusiastic chat.',
  },
];

// ─── Anthropic client (dealer-side browser only) ──────────────────────────────

const client = new Anthropic({
  apiKey: import.meta.env.VITE_ANTHROPIC_API_KEY,
  dangerouslyAllowBrowser: true,
});

// ─── Available bets per game ──────────────────────────────────────────────────

function getBetOptions(game, gameState) {
  if (game === 'craps') {
    const opts = ['passLine', 'field', 'place6', 'place8'];
    if (gameState.gamePhase === 'point') opts.push('come', 'place5', 'place9', 'any7');
    return opts;
  }
  if (game === 'baccarat') return ['player', 'banker'];
  if (game === 'roulette') return ['red', 'black', 'even', 'odd', 'low', 'high'];
  if (game === 'blackjack') return ['win', 'lose'];
  return [];
}

// ─── Bet resolution (simplified, covers bot's bet set only) ──────────────────

function resolveCraps(dice1, dice2, bets, gamePhase, point) {
  const total = dice1 + dice2;
  let winnings = 0;
  const newBets = { ...bets };

  if (newBets.field > 0) {
    if ([2, 3, 4, 9, 10, 11, 12].includes(total)) {
      winnings += (total === 2 || total === 12) ? newBets.field * 3 : newBets.field * 2;
    }
    newBets.field = 0;
  }

  if (newBets.any7 > 0) {
    if (total === 7) winnings += newBets.any7 * 5;
    newBets.any7 = 0;
  }

  [6, 8].forEach(n => {
    if (newBets[`place${n}`] > 0) {
      if (total === n) winnings += Math.floor(newBets[`place${n}`] * 2.2);
      if (total === 7) newBets[`place${n}`] = 0;
    }
  });

  [5, 9].forEach(n => {
    if (newBets[`place${n}`] > 0) {
      if (total === n) winnings += Math.floor(newBets[`place${n}`] * 2.4);
      if (total === 7) newBets[`place${n}`] = 0;
    }
  });

  if (newBets.passLine > 0) {
    if (gamePhase === 'come-out') {
      if (total === 7 || total === 11) { winnings += newBets.passLine * 2; newBets.passLine = 0; }
      else if ([2, 3, 12].includes(total)) newBets.passLine = 0;
    } else {
      if (total === point) { winnings += newBets.passLine * 2; newBets.passLine = 0; }
      else if (total === 7) newBets.passLine = 0;
    }
  }

  if (newBets.come > 0) {
    if (!newBets.comePoint) {
      if (total === 7 || total === 11) { winnings += newBets.come * 2; newBets.come = 0; }
      else if ([2, 3, 12].includes(total)) newBets.come = 0;
      else newBets.comePoint = total;
    } else {
      if (total === newBets.comePoint) { winnings += newBets.come * 2; newBets.come = 0; newBets.comePoint = null; }
      else if (total === 7) { newBets.come = 0; newBets.comePoint = null; }
    }
  }

  if (total === 7 && gamePhase === 'point') {
    ['place4', 'place5', 'place6', 'place8', 'place9', 'place10'].forEach(k => { newBets[k] = 0; });
  }

  return { winnings, newBets };
}

function resolveBaccarat(winner, bets) {
  let winnings = 0;
  const newBets = { ...bets };
  if (newBets.player > 0) { if (winner === 'player') winnings += newBets.player * 2; newBets.player = 0; }
  if (newBets.banker > 0) { if (winner === 'banker') winnings += Math.floor(newBets.banker * 1.95); newBets.banker = 0; }
  if (newBets.tie > 0) { if (winner === 'tie') winnings += newBets.tie * 9; newBets.tie = 0; }
  return { winnings, newBets };
}

function resolveRoulette(number, bets) {
  const redNums = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
  let winnings = 0;
  const newBets = { ...bets };
  if (newBets.red > 0) { if (redNums.includes(number)) winnings += newBets.red * 2; newBets.red = 0; }
  if (newBets.black > 0) { if (!redNums.includes(number) && number > 0) winnings += newBets.black * 2; newBets.black = 0; }
  if (newBets.even > 0) { if (number > 0 && number % 2 === 0) winnings += newBets.even * 2; newBets.even = 0; }
  if (newBets.odd > 0) { if (number % 2 === 1) winnings += newBets.odd * 2; newBets.odd = 0; }
  if (newBets.low > 0) { if (number >= 1 && number <= 18) winnings += newBets.low * 2; newBets.low = 0; }
  if (newBets.high > 0) { if (number >= 19) winnings += newBets.high * 2; newBets.high = 0; }
  return { winnings, newBets };
}

function resolveBlackjack(winner, bets) {
  let winnings = 0;
  const newBets = { ...bets };
  if (newBets.win > 0) {
    if (winner === 'win' || winner === 'blackjack') winnings += newBets.win * (winner === 'blackjack' ? 2.5 : 2);
    newBets.win = 0;
  }
  if (newBets.lose > 0) {
    if (winner === 'lose') winnings += newBets.lose * 2;
    newBets.lose = 0;
  }
  return { winnings, newBets };
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function BotPlayer({ roomCode, startingChips = 1000 }) {
  const [personaIndex, setPersonaIndex] = useState(0);
  const [active, setActive] = useState(false);
  const [bankroll, setBankroll] = useState(startingChips);
  const [activeBets, setActiveBets] = useState({});
  const [activeGame, setActiveGame] = useState(null);
  const [gameState, setGameState] = useState({});
  const [status, setStatus] = useState('Idle');
  const [lastMessage, setLastMessage] = useState('');
  const [showPanel, setShowPanel] = useState(false);
  const [log, setLog] = useState([]);

  const persona = PERSONAS[personaIndex];
  const BOT_UID = `bot_${persona.id}`;
  const BOT_NAME = `${persona.emoji} ${persona.name}`;

  const bankrollRef = useRef(startingChips);
  const activeBetsRef = useRef({});
  const gameStateRef = useRef({});
  const lastResolvedRoll = useRef(0);
  const lastResolvedRound = useRef(0);
  const isBettingRef = useRef(false);

  useEffect(() => { bankrollRef.current = bankroll; }, [bankroll]);
  useEffect(() => { activeBetsRef.current = activeBets; }, [activeBets]);
  useEffect(() => { gameStateRef.current = gameState; }, [gameState]);

  const addLog = (msg) => setLog(prev => [`${new Date().toLocaleTimeString()}: ${msg}`, ...prev].slice(0, 20));

  // ── Firebase helpers ────────────────────────────────────────────────────────

  const saveBotPlayer = async (overrides = {}) => {
    if (!roomCode) return;
    const data = {
      name: BOT_NAME,
      bankroll: bankrollRef.current,
      activeBets: activeBetsRef.current,
      isBot: true,
      lastActive: Date.now(),
      ...overrides,
    };
    await set(ref(db, `rooms/${roomCode}/players/${BOT_UID}`), data);
    await set(ref(db, `rooms/${roomCode}/session/leaderboard/${BOT_UID}`), {
      playerUid: BOT_UID,
      name: BOT_NAME,
      bankroll: overrides.bankroll ?? bankrollRef.current,
      timestamp: Date.now(),
    });
  };

  const sendChat = async (text) => {
    if (!roomCode || !text) return;
    await push(ref(db, `rooms/${roomCode}/session/chat`), {
      playerUid: BOT_UID,
      userName: BOT_NAME,
      text,
      timestamp: Date.now(),
    });
  };

  // ── Game state listeners ────────────────────────────────────────────────────

  useEffect(() => {
    if (!roomCode || !active) return;
    return onValue(ref(db, `rooms/${roomCode}/session/activeGame`), (snap) => {
      const g = snap.val();
      setActiveGame(g);
      lastResolvedRoll.current = 0;
      lastResolvedRound.current = 0;
    });
  }, [roomCode, active]);

  useEffect(() => {
    if (!roomCode || !active || !activeGame) return;
    return onValue(ref(db, `rooms/${roomCode}/session/games/${activeGame}/state`), (snap) => {
      if (snap.exists()) setGameState(snap.val());
    });
  }, [roomCode, active, activeGame]);

  // ── Decide and place bets when betting opens ────────────────────────────────

  useEffect(() => {
    if (!active || !activeGame || !gameState.bettingOpen) return;
    if (isBettingRef.current) return;
    if (Object.values(activeBetsRef.current).some(v => v > 0)) return; // already have bets

    isBettingRef.current = true;
    placeBotBets();
  }, [active, activeGame, gameState.bettingOpen]);

  useEffect(() => {
    if (!gameState.bettingOpen) isBettingRef.current = false;
  }, [gameState.bettingOpen]);

  const placeBotBets = async () => {
    if (bankrollRef.current < 5) { setStatus('Broke'); return; }
    setStatus('Thinking...');
    try {
      const options = getBetOptions(activeGame, gameStateRef.current);
      const maxBet = Math.max(5, Math.floor(bankrollRef.current * 0.20));
      const prompt = `${persona.style}

Game: ${activeGame}. Bankroll: ${bankrollRef.current} chips. Max total bet: ${maxBet} chips.
Game state: ${JSON.stringify(gameStateRef.current)}
Bet options (use EXACT keys): ${options.join(', ')}

Reply with ONLY valid JSON: {"bets": {"betKey": chipAmount}, "message": "short in-character quip"}
- chipAmount must be a multiple of 5, minimum 5.
- Total of all bets must not exceed ${maxBet}.`;

      const response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      });

      const parsed = JSON.parse(response.content[0].text.trim());
      const bets = parsed.bets || {};
      const message = parsed.message || '';

      // Validate bets
      const validBets = {};
      let total = 0;
      for (const [key, amt] of Object.entries(bets)) {
        if (options.includes(key) && amt > 0 && total + amt <= bankrollRef.current) {
          validBets[key] = amt;
          total += amt;
        }
      }

      if (total === 0) { setStatus('No bet this round'); isBettingRef.current = false; return; }

      const newBankroll = bankrollRef.current - total;
      setBankroll(newBankroll);
      setActiveBets(validBets);
      bankrollRef.current = newBankroll;
      activeBetsRef.current = validBets;

      await saveBotPlayer({ bankroll: newBankroll, activeBets: validBets });
      if (message) {
        setLastMessage(message);
        await sendChat(message);
      }
      addLog(`Bet ${total} chips: ${Object.entries(validBets).map(([k, v]) => `${k}=${v}`).join(', ')}`);
      setStatus(`Bet placed — ${total} chips`);
    } catch (e) {
      addLog(`Bet error: ${e.message}`);
      setStatus('Error placing bet');
      isBettingRef.current = false;
    }
  };

  // ── Auto-resolve on new roll/spin/deal ───────────────────────────────────────

  // Craps
  useEffect(() => {
    if (!active || activeGame !== 'craps') return;
    const gs = gameState;
    if (!gs.lastRoll || gs.rollNumber <= lastResolvedRoll.current) return;
    if (!Object.values(activeBetsRef.current).some(v => v > 0)) return;
    lastResolvedRoll.current = gs.rollNumber;

    const { winnings, newBets } = resolveCraps(
      gs.lastRoll.dice1, gs.lastRoll.dice2,
      activeBetsRef.current, gs.gamePhase, gs.point
    );
    const newBankroll = Math.round(bankrollRef.current + winnings);
    setBankroll(newBankroll);
    setActiveBets(newBets);
    bankrollRef.current = newBankroll;
    activeBetsRef.current = newBets;
    saveBotPlayer({ bankroll: newBankroll, activeBets: newBets });
    const net = winnings - Object.values(activeBetsRef.current).reduce((s, v) => s + (v > 0 ? v : 0), 0);
    addLog(`Roll ${gs.lastRoll.dice1 + gs.lastRoll.dice2}: ${winnings > 0 ? `+${winnings}` : 'lost'}`);
  }, [active, activeGame, gameState.rollNumber]);

  // Baccarat
  useEffect(() => {
    if (!active || activeGame !== 'baccarat') return;
    const gs = gameState;
    if (!gs.winner || gs.roundNumber <= lastResolvedRound.current) return;
    if (!Object.values(activeBetsRef.current).some(v => v > 0)) return;
    lastResolvedRound.current = gs.roundNumber;

    const { winnings, newBets } = resolveBaccarat(gs.winner, activeBetsRef.current);
    const newBankroll = Math.round(bankrollRef.current + winnings);
    setBankroll(newBankroll);
    setActiveBets(newBets);
    bankrollRef.current = newBankroll;
    activeBetsRef.current = newBets;
    saveBotPlayer({ bankroll: newBankroll, activeBets: newBets });
    addLog(`Baccarat ${gs.winner}: ${winnings > 0 ? `+${winnings}` : 'lost'}`);
  }, [active, activeGame, gameState.roundNumber, gameState.winner]);

  // Roulette
  useEffect(() => {
    if (!active || activeGame !== 'roulette') return;
    const gs = gameState;
    if (gs.spinResult === null || gs.spinResult === undefined) return;
    if (gs.roundNumber <= lastResolvedRound.current) return;
    if (!Object.values(activeBetsRef.current).some(v => v > 0)) return;
    lastResolvedRound.current = gs.roundNumber;

    const { winnings, newBets } = resolveRoulette(gs.spinResult, activeBetsRef.current);
    const newBankroll = Math.round(bankrollRef.current + winnings);
    setBankroll(newBankroll);
    setActiveBets(newBets);
    bankrollRef.current = newBankroll;
    activeBetsRef.current = newBets;
    saveBotPlayer({ bankroll: newBankroll, activeBets: newBets });
    addLog(`Spin ${gs.spinResult}: ${winnings > 0 ? `+${winnings}` : 'lost'}`);
  }, [active, activeGame, gameState.roundNumber, gameState.spinResult]);

  // Blackjack
  useEffect(() => {
    if (!active || activeGame !== 'blackjack') return;
    const gs = gameState;
    if (!gs.winner || gs.roundNumber <= lastResolvedRound.current) return;
    if (!Object.values(activeBetsRef.current).some(v => v > 0)) return;
    lastResolvedRound.current = gs.roundNumber;

    const { winnings, newBets } = resolveBlackjack(gs.winner, activeBetsRef.current);
    const newBankroll = Math.round(bankrollRef.current + winnings);
    setBankroll(newBankroll);
    setActiveBets(newBets);
    bankrollRef.current = newBankroll;
    activeBetsRef.current = newBets;
    saveBotPlayer({ bankroll: newBankroll, activeBets: newBets });
    addLog(`Blackjack ${gs.winner}: ${winnings > 0 ? `+${winnings}` : 'lost'}`);
  }, [active, activeGame, gameState.roundNumber, gameState.winner]);

  // ── Toggle bot on/off ────────────────────────────────────────────────────────

  const toggleBot = async () => {
    if (!active) {
      setBankroll(startingChips);
      bankrollRef.current = startingChips;
      setActiveBets({});
      activeBetsRef.current = {};
      lastResolvedRoll.current = 0;
      lastResolvedRound.current = 0;
      setActive(true);
      setStatus('Ready');
      addLog(`${BOT_NAME} joined the table`);
      await saveBotPlayer({ bankroll: startingChips, activeBets: {} });
      await sendChat(`${persona.emoji} Ready to play!`);
    } else {
      setActive(false);
      setStatus('Idle');
      addLog(`${BOT_NAME} left the table`);
      // Remove from leaderboard presence
      await set(ref(db, `rooms/${roomCode}/session/leaderboard/${BOT_UID}`), null);
    }
  };

  // ── UI ───────────────────────────────────────────────────────────────────────

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setShowPanel(p => !p)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-750 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Bot size={16} className={active ? 'text-emerald-400' : 'text-gray-400'} />
          <span className="text-sm font-semibold text-white">AI Bot Player</span>
          {active && (
            <span className="text-xs bg-emerald-900 text-emerald-300 px-2 py-0.5 rounded-full">
              {persona.emoji} {persona.name} · {bankroll} chips
            </span>
          )}
        </div>
        <ChevronDown size={14} className={`text-gray-400 transition-transform ${showPanel ? 'rotate-180' : ''}`} />
      </button>

      {showPanel && (
        <div className="px-4 pb-4 space-y-3 border-t border-gray-700">
          {/* Persona picker */}
          <div className="mt-3">
            <label className="text-xs text-gray-400 block mb-1">Persona</label>
            <div className="grid grid-cols-3 gap-1">
              {PERSONAS.map((p, i) => (
                <button
                  key={p.id}
                  disabled={active}
                  onClick={() => setPersonaIndex(i)}
                  className={`text-xs py-1.5 px-2 rounded-lg border transition-colors ${
                    personaIndex === i
                      ? 'border-emerald-500 bg-emerald-900/30 text-emerald-300'
                      : 'border-gray-600 text-gray-400 hover:border-gray-500'
                  } ${active ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {p.emoji} {p.name.split(' ')[1]}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-1">{persona.description}</p>
          </div>

          {/* Status */}
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-400">Status: <span className="text-white">{status}</span></span>
            {lastMessage && <span className="text-gray-500 italic truncate max-w-32">"{lastMessage}"</span>}
          </div>

          {/* Active bets */}
          {Object.entries(activeBets).filter(([, v]) => v > 0).length > 0 && (
            <div className="text-xs text-gray-400">
              Bets: {Object.entries(activeBets).filter(([, v]) => v > 0).map(([k, v]) => `${k}=${v}`).join(', ')}
            </div>
          )}

          {/* Toggle button */}
          <button
            onClick={toggleBot}
            className={`w-full flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold transition-colors ${
              active
                ? 'bg-red-900/40 border border-red-700 text-red-300 hover:bg-red-900/60'
                : 'bg-emerald-900/40 border border-emerald-700 text-emerald-300 hover:bg-emerald-900/60'
            }`}
          >
            {active ? <><PowerOff size={14} /> Remove Bot</> : <><Power size={14} /> Spawn Bot</>}
          </button>

          {/* Log */}
          {log.length > 0 && (
            <div className="bg-gray-900 rounded-lg p-2 max-h-24 overflow-y-auto">
              {log.map((entry, i) => (
                <div key={i} className="text-xs text-gray-500 font-mono">{entry}</div>
              ))}
            </div>
          )}

          {/* API key warning */}
          {!import.meta.env.VITE_ANTHROPIC_API_KEY && (
            <p className="text-xs text-amber-400">
              ⚠ Set VITE_ANTHROPIC_API_KEY in .env and restart the dev server.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
