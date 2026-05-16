# AgentDevStory / AgentOffice

Isometric visual canvas for monitoring multiple long-running AI coding sessions as a sprawling office floor. Each new session spawns a 5x5 office tile cluster along a clockwise spiral, with a character sprite seated at the desk reacting to the session's state.

## Architecture

```
client/          Phaser 3 frontend (Vite, vanilla JS)
server/          Bun backend (Linear integration, Codex agent runner, SSE)
shared/          TypeScript types + API contract (the interface between both sides)
```

The frontend and backend are **independently runnable**. The client works in mock mode without a backend, and the server is a standalone HTTP service.

### The interface (`shared/`)

- `shared/types.ts` — all data types exchanged between client and server
- `shared/api-contract.ts` — route list and re-exports for type-safe consumption

The server exposes:
| Route | Method | Description |
|-------|--------|-------------|
| `/api/health` | GET | Backend readiness |
| `/api/linear/teams` | GET | List Linear teams |
| `/api/projects` | POST | Create a watched project |
| `/api/world` | GET | Full world state snapshot |
| `/api/sessions/:id` | GET | Single agent session + transcript |
| `/api/events` | GET (SSE) | Real-time event stream |

The client subscribes to `/api/events` for live updates and falls back to mock data when the backend is unreachable.

## Quick start

```bash
bun install

# Frontend only (mock mode — no backend needed)
bun run dev:client

# Backend only
cp .env.example .env   # configure LINEAR_API_KEY etc.
bun run dev:server

# Both together
bun run dev
```

Client: http://localhost:5173 | Server: http://localhost:4317

## Working on the frontend

```bash
cd client
bun install
bun run dev
```

Everything in `client/` is self-contained. Phaser scenes, sprites, UI — all here. The backend connection is optional; when absent, the mock activity loop runs. To add new rooms, sprites, or visual features, you only touch `client/`.

Key files:
- `src/scenes/AgencyFloorScene.js` — main Phaser scene (preload, create, update loop)
- `src/world/Room.js` — 5x5 iso room spawning with per-type decorators
- `src/world/Agent.js` — character sprites + state/pose transitions
- `src/ui.js` — DOM overlay (new-task modal, terminal panel)
- `src/api.js` — backend connection adapter (swap/mock here)

## Working on the backend

```bash
cd server
bun install
bun run dev
```

The server watches Linear projects for issues, dispatches Codex agent sessions, and streams events via SSE. No frontend dependency.

Key files:
- `src/orchestrator.ts` — core state machine (poll, dispatch, retry)
- `src/runner.ts` — spawns agent processes in git worktrees
- `src/linear.ts` — Linear GraphQL gateway
- `src/http.ts` — HTTP route handler
- `src/config.ts` — env var loading

## Environment variables

See `.env.example`. At minimum you need `LINEAR_API_KEY` for real operation. Without it, the backend starts in "unconfigured" mode and the frontend uses mock data.

## Frontend features

- **+ New Task** spawns a room classified by keyword (Forge/War Room/Blueprint Lab/Lounge)
- Rooms placed on clockwise spiral, iso depth-sorted each frame
- Click a desk to tween camera + open terminal panel
- Mock terminal with shell commands and typewriter LLM replies
- WASD/arrow + drag camera pan
- localStorage persistence (fallback when backend unavailable)
- Mock activity loop cycles agent states for visual development
- When backend is connected: rooms reflect real Linear issues, terminal shows live agent transcripts
