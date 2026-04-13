// VODScriptEditor.jsx — Dealer tool for creating and editing VOD sessions
// Dealer marks result timestamps + winner per round.
// Betting windows derive automatically from adjacent timestamps.

import React, { useState, useEffect, useRef } from 'react';
import { useVODs, saveVOD, saveVODScript, deleteVOD } from './useFirebaseSync';

// ── YouTube video ID extraction ──────────────────────────────────────────────
function extractVideoId(url) {
  if (!url) return null;
  const patterns = [
    /youtu\.be\/([^?&\s]+)/,
    /[?&]v=([^&\s]+)/,
    /embed\/([^?&\s]+)/,
    /\/v\/([^?&\s]+)/,
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m) return m[1];
  }
  if (/^[A-Za-z0-9_-]{11}$/.test(url.trim())) return url.trim();
  return null;
}

// ── YouTube IFrame API loader (singleton) ────────────────────────────────────
let _ytLoading = false;
let _ytReady   = false;
const _ytCbs   = [];

function loadYouTubeAPI() {
  return new Promise((resolve) => {
    if (_ytReady && window.YT && window.YT.Player) { resolve(); return; }
    _ytCbs.push(resolve);
    if (!_ytLoading) {
      _ytLoading = true;
      window.onYouTubeIframeAPIReady = () => {
        _ytReady = true;
        _ytCbs.forEach(cb => cb());
        _ytCbs.length = 0;
      };
      if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
        const tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        document.head.appendChild(tag);
      }
    }
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmtTime(secs) {
  const s = Math.floor(secs);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const ss = String(s % 60).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

const WINNER_LABELS = { player: 'Player', banker: 'Banker', tie: 'Tie' };
const WINNER_COLORS = { player: '#3b82f6', banker: '#ef4444', tie: '#22c55e' };

const S = {
  card: { background: 'rgba(12,15,35,0.6)', backdropFilter: 'blur(16px)', borderRadius: '14px', border: '1px solid rgba(255,255,255,0.07)', padding: '20px' },
  label: { color: '#d4af37', fontSize: '11px', fontWeight: '700', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '10px' },
  input: { width: '100%', padding: '10px 12px', background: '#0a0a0a', border: '1px solid #333', borderRadius: '8px', color: '#fff', fontSize: '13px', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' },
  btn: (active, color = '#d4af37') => ({
    padding: '8px 16px', borderRadius: '8px', fontSize: '12px', fontWeight: '700', cursor: 'pointer', border: '1px solid',
    background: active ? color : 'rgba(255,255,255,0.04)',
    borderColor: active ? color : 'rgba(255,255,255,0.12)',
    color: active ? '#000' : 'rgba(136,146,164,0.7)',
    fontFamily: 'inherit',
  }),
};

const defaultForm = () => ({ resultAt: '', winner: '', revealDelay: '', editIndex: null });

const defaultOdds = () => ({
  player: { num: 1,  den: 1  },   // 1:1
  banker: { num: 19, den: 20 },   // 19:20 (5% commission)
  tie:    { num: 8,  den: 1  },   // 8:1
});

// ════════════════════════════════════════════════════════════════════════════════
export default function VODScriptEditor({ dealerUid }) {
  const vods = useVODs(dealerUid);

  const [editingId, setEditingId]               = useState(null);
  const [vodTitle, setVodTitle]                 = useState('');
  const [vodUrl, setVodUrl]                     = useState('');
  const [vodStartingChips, setVodStartingChips] = useState(1000);
  const [firstBetOpensAt, setFirstBetOpensAt]   = useState(0);   // VOD-level: when round 1 betting opens
  const [vodRevealDelay, setVodRevealDelay]     = useState(5);   // VOD-level default: seconds after betCloseAt to reveal result

  const [rounds, setRounds]   = useState([]);
  const [form, setForm]       = useState(defaultForm());

  // Preview player
  const [previewVideoId, setPreviewVideoId] = useState(null);
  const [ytPlayer, setYtPlayer]             = useState(null);
  const [playerTime, setPlayerTime]         = useState(null);
  const playerContainerRef                  = useRef(null);
  const pollRef                             = useRef(null);

  const [vodOdds, setVodOdds]     = useState(defaultOdds());
  const [published, setPublished] = useState(false);

  const [saving, setSaving]     = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [deleting, setDeleting] = useState(null);

  // ── Open a VOD for editing ─────────────────────────────────────────────────
  const openVOD = (vod) => {
    setEditingId(vod.id);
    setVodTitle(vod.title || '');
    setVodUrl(vod.youtubeVideoId ? `https://youtu.be/${vod.youtubeVideoId}` : '');
    setVodStartingChips(vod.startingChips || 1000);
    setFirstBetOpensAt(vod.firstBetOpensAt ?? 0);
    setVodRevealDelay(vod.revealDelay ?? 5);
    setVodOdds(vod.odds ? { ...defaultOdds(), ...vod.odds } : defaultOdds());
    setPublished(vod.published ?? true); // existing VODs without the field default to published
    const scriptArr = vod.script
      ? Object.values(vod.script).sort((a, b) => a.resultAt - b.resultAt)
      : [];
    setRounds(scriptArr);
    setForm(defaultForm());
    setSaveError(null);
    setPreviewVideoId(vod.youtubeVideoId || null);
  };

  const openNewVOD = () => {
    setEditingId('__new__');
    setVodTitle('');
    setVodUrl('');
    setVodStartingChips(1000);
    setFirstBetOpensAt(0);
    setVodRevealDelay(5);
    setVodOdds(defaultOdds());
    setPublished(false);
    setRounds([]);
    setForm(defaultForm());
    setSaveError(null);
    setPreviewVideoId(null);
  };

  const closeEditor = () => {
    setEditingId(null);
    destroyPlayer();
  };

  // ── Preview player ─────────────────────────────────────────────────────────
  const destroyPlayer = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (ytPlayer) { try { ytPlayer.destroy(); } catch (_) {} setYtPlayer(null); }
    setPlayerTime(null);
  };

  useEffect(() => {
    if (!previewVideoId || !playerContainerRef.current) return;
    let player;
    loadYouTubeAPI().then(() => {
      if (!playerContainerRef.current) return;
      const containerId = 'vod-preview-player';
      let el = document.getElementById(containerId);
      if (!el) {
        el = document.createElement('div');
        el.id = containerId;
        playerContainerRef.current.appendChild(el);
      }
      player = new window.YT.Player(containerId, {
        videoId: previewVideoId,
        width: '100%',
        height: '200',
        playerVars: { rel: 0, modestbranding: 1 },
        events: {
          onReady: () => {
            setYtPlayer(player);
            pollRef.current = setInterval(() => {
              try { setPlayerTime(Math.floor(player.getCurrentTime())); } catch (_) {}
            }, 500);
          },
        },
      });
    });
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      if (player) { try { player.destroy(); } catch (_) {} }
      setYtPlayer(null);
      setPlayerTime(null);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewVideoId]);

  const handleUrlBlur = () => {
    const id = extractVideoId(vodUrl);
    if (id && id !== previewVideoId) { destroyPlayer(); setPreviewVideoId(id); }
  };

  // Capture current player time into whichever field was last focused
  // — two separate capture buttons call these directly
  const captureAsFirstBet = () => { if (playerTime != null) setFirstBetOpensAt(playerTime); };
  const captureAsResult   = () => { if (playerTime != null) setForm(f => ({ ...f, resultAt: String(playerTime) })); };

  // ── Round CRUD ─────────────────────────────────────────────────────────────
  const addOrUpdateRound = () => {
    const resultAt = parseFloat(form.resultAt);
    if (isNaN(resultAt) || resultAt <= 0) { setSaveError('Enter the result timestamp (seconds).'); return; }
    if (!form.winner) { setSaveError('Select a winner.'); return; }

    // Validate: resultAt must be after previous round's resultAt
    const prevResultAt = form.editIndex != null
      ? (rounds[form.editIndex - 1]?.resultAt ?? 0)
      : (rounds[rounds.length - 1]?.resultAt ?? 0);
    if (resultAt <= prevResultAt && form.editIndex !== 0) {
      setSaveError('Result timestamp must be after the previous round.');
      return;
    }

    setSaveError(null);
    const round = { game: 'baccarat', resultAt, winner: form.winner };
    const perRoundDelay = form.revealDelay !== '' ? parseFloat(form.revealDelay) : NaN;
    if (!isNaN(perRoundDelay) && perRoundDelay >= 0) round.revealDelay = perRoundDelay;

    setRounds(prev => {
      const next = form.editIndex != null
        ? prev.map((r, i) => i === form.editIndex ? round : r)
        : [...prev, round];
      return next
        .sort((a, b) => a.resultAt - b.resultAt)
        .map((r, i) => ({ ...r, roundNumber: i + 1 }));
    });
    setForm(defaultForm());
  };

  const editRound = (i) => {
    setForm({ resultAt: String(rounds[i].resultAt), winner: rounds[i].winner, revealDelay: rounds[i].revealDelay != null ? String(rounds[i].revealDelay) : '', editIndex: i });
    setSaveError(null);
  };

  const deleteRound = (i) => {
    setRounds(prev => prev.filter((_, idx) => idx !== i).map((r, idx) => ({ ...r, roundNumber: idx + 1 })));
    if (form.editIndex === i) setForm(defaultForm());
  };

  // ── Save ───────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    const videoId = extractVideoId(vodUrl);
    if (!vodTitle.trim()) { setSaveError('Enter a title.'); return; }
    if (!videoId) { setSaveError('Enter a valid YouTube URL.'); return; }
    setSaving(true);
    setSaveError(null);
    try {
      const vodId = editingId === '__new__' ? null : editingId;
      const newId = await saveVOD(dealerUid, { vodId, title: vodTitle.trim(), youtubeVideoId: videoId, startingChips: vodStartingChips, firstBetOpensAt, revealDelay: vodRevealDelay, odds: vodOdds, published });
      await saveVODScript(dealerUid, newId || vodId, rounds);
      setEditingId(newId || vodId);
    } catch (e) {
      setSaveError('Save failed: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (vodId) => {
    setDeleting(vodId);
    try { await deleteVOD(dealerUid, vodId); }
    catch (e) { console.error('Delete failed:', e); }
    finally { setDeleting(null); if (editingId === vodId) closeEditor(); }
  };

  // ── List view ──────────────────────────────────────────────────────────────
  if (!editingId) {
    return (
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div style={S.label}>📹 VOD Library</div>
          <button onClick={openNewVOD} style={{ padding: '8px 18px', background: 'linear-gradient(135deg,#d4af37,#f4e5a1)', border: 'none', borderRadius: '8px', color: '#000', fontSize: '12px', fontWeight: '800', cursor: 'pointer' }}>
            + New VOD
          </button>
        </div>

        {vods.length === 0 ? (
          <div style={{ ...S.card, textAlign: 'center', padding: '40px 20px' }}>
            <div style={{ fontSize: '32px', marginBottom: '12px' }}>🎬</div>
            <div style={{ color: 'rgba(136,146,164,0.6)', fontSize: '13px', lineHeight: 1.7 }}>
              No VODs yet. Create one to let players replay your stream content<br />at their own pace with real betting action.
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {vods.map(vod => {
              const roundCount = vod.script ? Object.keys(vod.script).length : 0;
              const lbCount    = vod.leaderboard ? Object.keys(vod.leaderboard).length : 0;
              return (
                <div key={vod.id} style={{ ...S.card, display: 'flex', alignItems: 'center', gap: '16px', padding: '16px 20px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                      <div style={{ color: '#fff', fontSize: '14px', fontWeight: '700', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{vod.title}</div>
                      <span style={{ fontSize: '10px', fontWeight: '700', padding: '2px 7px', borderRadius: '4px', flexShrink: 0,
                        background: (vod.published ?? true) ? 'rgba(74,222,128,0.12)' : 'rgba(255,255,255,0.06)',
                        color: (vod.published ?? true) ? '#4ade80' : 'rgba(136,146,164,0.5)',
                        border: `1px solid ${(vod.published ?? true) ? 'rgba(74,222,128,0.3)' : 'rgba(255,255,255,0.1)'}`,
                      }}>
                        {(vod.published ?? true) ? 'LIVE' : 'DRAFT'}
                      </span>
                    </div>
                    <div style={{ color: 'rgba(136,146,164,0.5)', fontSize: '11px' }}>
                      {roundCount} round{roundCount !== 1 ? 's' : ''} · ${(vod.startingChips || 1000).toLocaleString()} start · {lbCount} completion{lbCount !== 1 ? 's' : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                    <button onClick={() => openVOD(vod)} style={{ padding: '7px 14px', background: 'rgba(212,175,55,0.12)', border: '1px solid rgba(212,175,55,0.3)', borderRadius: '7px', color: '#d4af37', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}>Edit</button>
                    <button onClick={() => handleDelete(vod.id)} disabled={deleting === vod.id} style={{ padding: '7px 12px', background: 'transparent', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '7px', color: 'rgba(239,68,68,0.7)', fontSize: '12px', cursor: 'pointer' }}>
                      {deleting === vod.id ? '...' : '✕'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ── Editor view ────────────────────────────────────────────────────────────
  // Derive betting windows for the script preview table
  const roundsWithWindows = rounds.map((r, i) => {
    const prevResolveAt = i === 0 ? firstBetOpensAt : rounds[i - 1].resultAt + (rounds[i - 1].revealDelay ?? vodRevealDelay);
    return { ...r, betOpenAt: prevResolveAt, betCloseAt: r.resultAt };
  });

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
        <button onClick={closeEditor} style={{ padding: '6px 12px', background: 'transparent', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '7px', color: 'rgba(136,146,164,0.7)', fontSize: '12px', cursor: 'pointer' }}>
          ← Back
        </button>
        <div style={{ color: '#d4af37', fontSize: '14px', fontWeight: '700' }}>
          {editingId === '__new__' ? 'New VOD' : 'Edit VOD'}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>

        {/* Left: metadata + preview */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={S.card}>
            <div style={S.label}>Video Details</div>

            <div style={{ marginBottom: '12px' }}>
              <div style={{ color: 'rgba(136,146,164,0.6)', fontSize: '11px', marginBottom: '6px' }}>Title</div>
              <input value={vodTitle} onChange={e => setVodTitle(e.target.value)} placeholder="e.g. High Stakes Baccarat — Episode 12" style={S.input} />
            </div>

            <div style={{ marginBottom: '12px' }}>
              <div style={{ color: 'rgba(136,146,164,0.6)', fontSize: '11px', marginBottom: '6px' }}>YouTube URL</div>
              <input value={vodUrl} onChange={e => setVodUrl(e.target.value)} onBlur={handleUrlBlur} placeholder="https://youtu.be/..." style={S.input} />
              {extractVideoId(vodUrl) && (
                <div style={{ color: '#4ade80', fontSize: '10px', marginTop: '4px' }}>✓ Video ID: {extractVideoId(vodUrl)}</div>
              )}
            </div>

            <div style={{ marginBottom: '12px' }}>
              <div style={{ color: 'rgba(136,146,164,0.6)', fontSize: '11px', marginBottom: '8px' }}>Starting chips for players</div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {[500, 1000, 2500, 5000].map(amt => (
                  <button key={amt} onClick={() => setVodStartingChips(amt)} style={S.btn(vodStartingChips === amt)}>
                    ${amt >= 1000 ? (amt / 1000) + 'k' : amt}
                  </button>
                ))}
              </div>
            </div>

            {/* First bet opens at — VOD-level field */}
            <div style={{ marginBottom: '12px' }}>
              <div style={{ color: 'rgba(136,146,164,0.6)', fontSize: '11px', marginBottom: '6px' }}>
                Round 1 betting opens at
                <span style={{ color: 'rgba(136,146,164,0.35)', marginLeft: '6px' }}>(seconds — usually 0 or a few seconds in)</span>
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input
                  type="number"
                  min="0"
                  value={firstBetOpensAt}
                  onChange={e => setFirstBetOpensAt(Math.max(0, Number(e.target.value)))}
                  style={{ ...S.input, width: '100px' }}
                />
                <span style={{ color: 'rgba(136,146,164,0.4)', fontSize: '11px', fontFamily: 'monospace' }}>{fmtTime(firstBetOpensAt)}</span>
                {playerTime != null && (
                  <button onClick={captureAsFirstBet} style={{ padding: '6px 10px', background: 'rgba(212,175,55,0.1)', border: '1px solid rgba(212,175,55,0.3)', borderRadius: '6px', color: '#d4af37', fontSize: '11px', fontWeight: '700', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    ⏱ Use {playerTime}s
                  </button>
                )}
              </div>
            </div>

            {/* Default result reveal delay */}
            <div style={{ marginBottom: '12px' }}>
              <div style={{ color: 'rgba(136,146,164,0.6)', fontSize: '11px', marginBottom: '6px' }}>
                Default reveal delay
                <span style={{ color: 'rgba(136,146,164,0.35)', marginLeft: '6px' }}>— seconds after bets lock before result shows</span>
              </div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {[3, 5, 8, 10, 15].map(s => (
                  <button key={s} onClick={() => setVodRevealDelay(s)} style={S.btn(vodRevealDelay === s)}>
                    {s}s
                  </button>
                ))}
                <input
                  type="number"
                  min="0"
                  value={vodRevealDelay}
                  onChange={e => setVodRevealDelay(Math.max(0, Number(e.target.value)))}
                  style={{ ...S.input, width: '64px' }}
                />
              </div>
            </div>

            {/* Baccarat odds for this VOD */}
            <div>
              <div style={{ color: 'rgba(136,146,164,0.6)', fontSize: '11px', marginBottom: '10px' }}>Baccarat payout odds</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {/* Player — always 1:1 */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ color: '#3b82f6', fontSize: '12px', fontWeight: '700', minWidth: '56px' }}>Player</span>
                  <span style={{ color: 'rgba(136,146,164,0.4)', fontSize: '11px' }}>1:1 (standard)</span>
                </div>
                {/* Banker — commission toggle */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ color: '#ef4444', fontSize: '12px', fontWeight: '700', minWidth: '56px' }}>Banker</span>
                  <button onClick={() => setVodOdds(o => ({ ...o, banker: { num: 19, den: 20 } }))} style={S.btn(vodOdds.banker.num === 19 && vodOdds.banker.den === 20)}>
                    19:20 (5% comm)
                  </button>
                  <button onClick={() => setVodOdds(o => ({ ...o, banker: { num: 1, den: 1 } }))} style={S.btn(vodOdds.banker.num === 1 && vodOdds.banker.den === 1)}>
                    1:1 (no comm)
                  </button>
                </div>
                {/* Tie — payout toggle */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ color: '#22c55e', fontSize: '12px', fontWeight: '700', minWidth: '56px' }}>Tie</span>
                  <button onClick={() => setVodOdds(o => ({ ...o, tie: { num: 8, den: 1 } }))} style={S.btn(vodOdds.tie.num === 8)}>
                    8:1
                  </button>
                  <button onClick={() => setVodOdds(o => ({ ...o, tie: { num: 9, den: 1 } }))} style={S.btn(vodOdds.tie.num === 9)}>
                    9:1
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Preview player */}
          {previewVideoId && (
            <div style={S.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <div style={S.label}>Preview</div>
                {playerTime != null && (
                  <div style={{ color: '#d4af37', fontSize: '12px', fontFamily: 'monospace' }}>{fmtTime(playerTime)} ({playerTime}s)</div>
                )}
              </div>
              <div ref={playerContainerRef} style={{ borderRadius: '8px', overflow: 'hidden', background: '#000' }} />
              <button
                onClick={captureAsResult}
                disabled={playerTime == null}
                style={{ marginTop: '8px', width: '100%', padding: '8px', background: playerTime != null ? 'rgba(212,175,55,0.12)' : 'rgba(255,255,255,0.03)', border: `1px solid ${playerTime != null ? 'rgba(212,175,55,0.4)' : 'rgba(255,255,255,0.08)'}`, borderRadius: '7px', color: playerTime != null ? '#d4af37' : 'rgba(136,146,164,0.3)', fontSize: '12px', fontWeight: '700', cursor: playerTime != null ? 'pointer' : 'default' }}
              >
                ⏱ Capture as Result Timestamp
              </button>
            </div>
          )}
        </div>

        {/* Right: round builder + script table */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={S.card}>
            <div style={S.label}>{form.editIndex != null ? `Editing Round ${form.editIndex + 1}` : 'Add Round'}</div>

            {/* Result timestamp */}
            <div style={{ marginBottom: '14px' }}>
              <div style={{ color: 'rgba(136,146,164,0.6)', fontSize: '11px', marginBottom: '6px' }}>
                Bets close at (seconds)
                <span style={{ color: 'rgba(136,146,164,0.35)', marginLeft: '6px' }}>— results show after the delay</span>
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input
                  type="number"
                  min="0"
                  value={form.resultAt}
                  onChange={e => setForm(f => ({ ...f, resultAt: e.target.value }))}
                  placeholder="e.g. 185"
                  style={{ ...S.input, width: '110px' }}
                />
                {form.resultAt && !isNaN(parseFloat(form.resultAt)) && (
                  <span style={{ color: 'rgba(136,146,164,0.4)', fontSize: '11px', fontFamily: 'monospace' }}>{fmtTime(parseFloat(form.resultAt))}</span>
                )}
              </div>
            </div>

            {/* Per-round reveal delay override */}
            <div style={{ marginBottom: '14px' }}>
              <div style={{ color: 'rgba(136,146,164,0.6)', fontSize: '11px', marginBottom: '6px' }}>
                Reveal delay override
                <span style={{ color: 'rgba(136,146,164,0.35)', marginLeft: '6px' }}>— leave blank to use default ({vodRevealDelay}s)</span>
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input
                  type="number"
                  min="0"
                  value={form.revealDelay}
                  onChange={e => setForm(f => ({ ...f, revealDelay: e.target.value }))}
                  placeholder={String(vodRevealDelay)}
                  style={{ ...S.input, width: '80px', color: form.revealDelay !== '' ? '#d4af37' : undefined }}
                />
                {form.revealDelay !== '' && (
                  <button onClick={() => setForm(f => ({ ...f, revealDelay: '' }))} style={{ padding: '4px 8px', background: 'transparent', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '5px', color: 'rgba(136,146,164,0.5)', fontSize: '10px', cursor: 'pointer' }}>
                    Clear
                  </button>
                )}
              </div>
            </div>

            {/* Winner */}
            <div style={{ marginBottom: '16px' }}>
              <div style={{ color: 'rgba(136,146,164,0.6)', fontSize: '11px', marginBottom: '6px' }}>Baccarat result</div>
              <div style={{ display: 'flex', gap: '8px' }}>
                {['player', 'banker', 'tie'].map(w => (
                  <button
                    key={w}
                    onClick={() => setForm(f => ({ ...f, winner: w }))}
                    style={{
                      flex: 1, padding: '10px 4px', borderRadius: '8px', fontSize: '12px', fontWeight: '800', cursor: 'pointer', border: '1px solid',
                      background: form.winner === w ? WINNER_COLORS[w] : 'rgba(255,255,255,0.04)',
                      borderColor: form.winner === w ? WINNER_COLORS[w] : 'rgba(255,255,255,0.12)',
                      color: form.winner === w ? '#fff' : 'rgba(136,146,164,0.6)',
                    }}
                  >
                    {WINNER_LABELS[w]}
                  </button>
                ))}
              </div>
            </div>

            {saveError && <div style={{ color: '#f87171', fontSize: '11px', marginBottom: '10px' }}>{saveError}</div>}

            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={addOrUpdateRound} style={{ flex: 1, padding: '10px', background: 'linear-gradient(135deg,#d4af37,#f4e5a1)', border: 'none', borderRadius: '8px', color: '#000', fontSize: '13px', fontWeight: '800', cursor: 'pointer' }}>
                {form.editIndex != null ? 'Update Round' : '+ Add Round'}
              </button>
              {form.editIndex != null && (
                <button onClick={() => { setForm(defaultForm()); setSaveError(null); }} style={{ padding: '10px 14px', background: 'transparent', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', color: 'rgba(136,146,164,0.6)', fontSize: '13px', cursor: 'pointer' }}>
                  Cancel
                </button>
              )}
            </div>
          </div>

          {/* Script table */}
          <div style={S.card}>
            <div style={S.label}>Script ({rounds.length} rounds)</div>
            {rounds.length === 0 ? (
              <div style={{ color: 'rgba(136,146,164,0.35)', fontSize: '12px', textAlign: 'center', padding: '20px 0' }}>
                No rounds yet — add one above.
              </div>
            ) : (
              <>
                {/* Column headers */}
                <div style={{ display: 'flex', gap: '10px', padding: '0 10px 6px', borderBottom: '1px solid rgba(255,255,255,0.06)', marginBottom: '6px' }}>
                  <span style={{ color: 'rgba(136,146,164,0.3)', fontSize: '10px', minWidth: '22px' }}>#</span>
                  <span style={{ color: 'rgba(136,146,164,0.3)', fontSize: '10px', minWidth: '72px' }}>BET OPENS</span>
                  <span style={{ color: 'rgba(136,146,164,0.3)', fontSize: '10px', minWidth: '72px' }}>BETS CLOSE</span>
                  <span style={{ color: 'rgba(136,146,164,0.3)', fontSize: '10px', minWidth: '44px' }}>DELAY</span>
                  <span style={{ color: 'rgba(136,146,164,0.3)', fontSize: '10px', flex: 1 }}>WINNER</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '260px', overflowY: 'auto' }}>
                  {roundsWithWindows.map((r, i) => {
                    const delay = r.revealDelay != null ? r.revealDelay : vodRevealDelay;
                    const isOverride = r.revealDelay != null;
                    return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px', background: form.editIndex === i ? 'rgba(212,175,55,0.08)' : 'rgba(255,255,255,0.03)', borderRadius: '8px', border: `1px solid ${form.editIndex === i ? 'rgba(212,175,55,0.25)' : 'rgba(255,255,255,0.05)'}` }}>
                      <span style={{ color: 'rgba(136,146,164,0.4)', fontSize: '11px', minWidth: '22px' }}>#{r.roundNumber || i + 1}</span>
                      <span style={{ color: '#666', fontSize: '11px', fontFamily: 'monospace', minWidth: '72px' }}>{fmtTime(r.betOpenAt)}</span>
                      <span style={{ color: '#888', fontSize: '11px', fontFamily: 'monospace', minWidth: '72px' }}>{fmtTime(r.resultAt)}</span>
                      <span style={{ fontSize: '11px', fontFamily: 'monospace', minWidth: '44px', color: isOverride ? '#d4af37' : 'rgba(136,146,164,0.3)' }}>{delay}s{isOverride ? '*' : ''}</span>
                      <span style={{ flex: 1, fontSize: '12px', fontWeight: '700', color: WINNER_COLORS[r.winner] || '#fff' }}>
                        {WINNER_LABELS[r.winner] || r.winner}
                      </span>
                      <button onClick={() => editRound(i)} style={{ padding: '3px 8px', background: 'transparent', border: '1px solid rgba(212,175,55,0.25)', borderRadius: '5px', color: '#d4af37', fontSize: '10px', cursor: 'pointer' }}>Edit</button>
                      <button onClick={() => deleteRound(i)} style={{ padding: '3px 6px', background: 'transparent', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '5px', color: 'rgba(239,68,68,0.6)', fontSize: '10px', cursor: 'pointer' }}>✕</button>
                    </div>
                  ); })}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Save bar */}
      <div style={{ marginTop: '20px', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{ padding: '12px 32px', background: saving ? '#333' : 'linear-gradient(135deg,#d4af37,#f4e5a1)', border: 'none', borderRadius: '10px', color: saving ? '#666' : '#000', fontSize: '14px', fontWeight: '800', cursor: saving ? 'not-allowed' : 'pointer' }}
        >
          {saving ? 'Saving...' : '💾 Save VOD'}
        </button>

        {/* Publish toggle */}
        <button
          onClick={() => setPublished(p => !p)}
          style={{
            padding: '12px 20px', borderRadius: '10px', fontSize: '13px', fontWeight: '700', cursor: 'pointer', border: '1px solid',
            background: published ? 'rgba(74,222,128,0.12)' : 'rgba(255,255,255,0.04)',
            borderColor: published ? 'rgba(74,222,128,0.4)' : 'rgba(255,255,255,0.15)',
            color: published ? '#4ade80' : 'rgba(136,146,164,0.6)',
          }}
        >
          {published ? '● Published' : '○ Draft'}
        </button>

        {editingId && editingId !== '__new__' && (
          <button onClick={() => handleDelete(editingId)} disabled={deleting === editingId} style={{ padding: '12px 20px', background: 'transparent', border: '1px solid rgba(239,68,68,0.35)', borderRadius: '10px', color: 'rgba(239,68,68,0.7)', fontSize: '13px', cursor: 'pointer' }}>
            {deleting === editingId ? 'Deleting...' : 'Delete VOD'}
          </button>
        )}
        {saveError && <div style={{ color: '#f87171', fontSize: '12px' }}>{saveError}</div>}
      </div>
    </div>
  );
}
