# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # start dev server at http://localhost:5173
npm run build     # production build (output: dist/)
npm run preview   # serve the production build locally
```

No test suite or linter is configured.

## Architecture

**ActionSync** is a live-casino companion app for streamers. A **dealer** (streamer) hosts a room; **players** join via a vanity code or URL and bet with virtual chips in real time.

### Role model

Two Firebase Auth roles stored in `userRoles/{uid}`:
- `dealer` — their `uid` is the permanent room ID; they control game state
- `player` — joins a dealer's room; their data lives under that dealer's path

Dealers claim a short vanity code (e.g. `MIKECASINO`) on sign-up. The mapping `roomCodes/{CODE} → dealerUid` lets players join by code or via `?room=CODE` / `?dealer=uid` query params.

### Firebase Realtime Database path scheme

```
userRoles/{uid}                                 — "dealer" | "player"
roomCodes/{CODE}                                — dealerUid
rooms/{dealerUid}/
  settings/                                     — roomCode, dealerName, startingChips, odds, betVisibility
  session/                                      — current live session (wiped on new stream)
    status                                      — "waiting" | "active" | "ended"
    activeGame                                  — "craps" | "baccarat" | "roulette" | "blackjack"
    leaderboard/{playerUid}
    presence/{playerUid}
    chat/{msgId}
    games/{gameName}/state                      — live game state for current game
  players/{playerUid}/                          — persistent record (survives sessions)
    name, email, bankroll, stats/...
  history/{sessionNumber}/                      — archived session snapshots
    startedAt, endedAt, finalLeaderboard/...
  vods/{vodId}/                                 — VOD scripts for replay
```

### Custom hooks (`src/*.js`)

| Hook | Purpose |
|---|---|
| `useAuth` | Firebase Auth for both roles; handles sign-up, sign-in, room code claim, session restore |
| `useFirebaseSync` | All RTDB subscriptions — `useGameState`, `useLeaderboard`, `useChat`, `usePlayerData`, `usePresence`, `useSessionHistory`, `useVODs`, plus imperative helpers (`startNewSession`, `startStream`, `switchGame`, etc.) |
| `useSettings` | Reads/writes dealer-configured odds (`{ num, den }`) and bet visibility; settings snapshot on mount — changes take effect at next game start |

`firebase.js` exports the initialized `database` and `auth` instances plus low-level helpers (`saveData`, `loadData`, `listenToData`, `updateData`, `deleteData`).

### UI components (`src/*.jsx`)

- **`App.jsx`** — root router/state machine; resolves dealer UID from URL/localStorage, owns session flow, renders the correct view based on role + session status
- **`LandingPage.jsx`** — unauthenticated landing + auth forms
- **`CrapsGame / BaccaratGame / RouletteGame / BlackjackGame`** — game components used by both dealer (controls) and player (betting UI); they receive `dealerUid` and `isDealer` props
- **`LivePlayerView.jsx`** — unified player betting UI that switches between games dynamically
- **`StreamOverlay.jsx`** — OBS-friendly overlay showing leaderboard/state
- **`SettingsPanel.jsx`** — dealer odds and bet visibility configuration
- **`VODScriptEditor.jsx` / `VODPlayer.jsx`** — VOD replay tooling for post-stream

### Key patterns

- All real-time subscriptions use `onValue` and return an unsubscribe function cleaned up in `useEffect` — no manual teardown needed elsewhere.
- `useGameState` uses a `useRef` mirror of state so async callbacks always write the latest value, avoiding stale-closure bugs.
- `updateBankrollAndStats` in `usePlayerData` atomically updates the player record and mirrors the bankroll to the live leaderboard in a single `update` call.
- Dealer UID resolution priority: `?dealer=` URL param → `?room=` code lookup → `localStorage('actionsync-dealerUid')`.

### Deployment

Deployed on Vercel. `vercel.json` rewrites all routes to `index.html` (required for client-side routing). Build output is `dist/`.
