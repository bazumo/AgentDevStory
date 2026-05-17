# AgentDevStory / AgentOffice

Isometric visual canvas for monitoring multiple long-running AI coding sessions as a sprawling office floor. Each backend session spawns a 5x5 office tile cluster along a clockwise spiral, with a character sprite seated at the desk reacting to the live session state.

The app can run in two modes:

- **Live mode:** Bun backend polls Linear, dispatches Codex agents in workspaces, streams session events over SSE, and the Phaser client maps those events to character sprites.
- **Mock mode:** if the backend is not reachable, the visual canvas still works with local rooms, mock terminal replies, and localStorage persistence.

## Stack

- Phaser 3 (canvas / iso rendering)
- Vite (dev + build)
- Bun backend (Linear integration, Codex runner, SSE)
- Symphony Elixir observability integration for Codex app-server runs
- Vanilla JS / CSS for the DOM overlay (top bar, new-task modal, slide-over terminal)
- `localStorage` for mock visual state; `.agentdevstory/state.json` for backend state

## Run

```bash
bun install
cp .env.example .env
bun run dev
```

Open http://127.0.0.1:5173. The backend listens on http://127.0.0.1:4317.

For real Linear/Codex operation, configure:

- `LINEAR_API_KEY`
- `WATCHED_PROJECT_IDS`
- `AGENTDEVSTORY_TARGET_REPO`
- `AGENTDEVSTORY_WORKSPACE_ROOT`
- `CODEX_CMD`
- `SYMPHONY_API_URL` (optional, e.g. `http://127.0.0.1:4320`)

## Symphony

The repo includes `symphony/WORKFLOW.example.md` for the official
`openai/symphony` Elixir implementation. Copy it to an ignored local workflow,
set `project_slug` to the Linear project slug ID you want Symphony to poll, then
start Symphony:

```bash
cd /path/to/openai/symphony/elixir
mise exec -- ./bin/symphony /path/to/agent-dev-story/symphony/WORKFLOW.local.md --port 4320 --i-understand-that-this-will-be-running-without-the-usual-guardrails
```

AgentDevStory reads Symphony at `/api/v1/state`, exposes it through
`/api/symphony/status`, and mirrors running/retrying Symphony Codex agents into
the office view.

## What works

- **+ New Task** button → opens a prompt modal. Heuristic keyword classifier picks one of four room types:
  - 🏭 The Forge — feature building (`build`, `feature`, `implement`, `add`, ...)
  - 🚨 The War Room — debugging (`bug`, `fix`, `error`, `stack trace`, ...)
  - 📐 The Blueprint Lab — architecture (`schema`, `design`, `prompt`, `db`, ...)
  - 📚 The Lounge — docs (`readme`, `doc`, `explain`, `tutorial`, ...)
- Rooms are placed on a clockwise spiral around origin `(0,0)`, with 1-tile corridor gaps.
- Each room is a 5×5 iso tile cluster with floor diamonds, NW + NE walls (iso open-front convention), a desk at `(2,2)`, type-specific decorators (laptops / chairs / server racks / whiteboards / plants), and a randomly-assigned character sprite.
- **Click a desk** → camera tweens the office to the left half of the screen, slide-over terminal opens on the right.
- **Terminal**:
  - Live session: shows Codex transcript events streamed from the backend.
  - Live session plain Enter: sends a follow-up prompt to Codex in that session workspace.
  - Mock session: plain Enter uses a typewriter mock reply.
  - `! ls`, `! cat <file>`, `! pwd`, `! help` use the mock shell or show the live workspace path.
- **Camera pan**: click-drag empty floor, or `WASD` / arrow keys.
- **Depth sort**: per-frame `setDepth(y + bias)` then `worldContainer.sort('depth')` — walls bias `-4`, agents `+4`.
- **Persistence**: spawned rooms round-trip through `localStorage` and re-spawn on reload.
- **Backend event sync**: running Codex output drives typing/thinking sprites, completed sessions cheer, failed sessions look surprised, idle sessions sit idle.
- **Kanban view**: the left panel can switch between session cards and a Linear/Codex Kanban view.
- **G-Brain memory**: the floating 2×2 brain seeds from repo context, stores completed session transcripts, and injects relevant memory into later Codex prompts.
- **Symphony sync**: when configured, the backend polls Symphony's dashboard API and mirrors active Symphony Codex agents into the canvas.
- **Mock activity loop**: local visual rooms animate only when not controlled by backend session events.

## Source layout

```
src/
  api.js                    Backend API/SSE adapter
  main.js                  Phaser bootstrap + UI init
  ui.js                    DOM overlay: new-task modal, terminal, Kanban + transcript
  styles.css
  config/
    IsoConfig.js           Named ISO constants + character key helpers
    RoomTypes.js           Room registry + keyword classifier
  scenes/
    AgencyFloorScene.js    Main scene: preload, container, sort, pan, click-to-center
  util/
    spiral.js              Clockwise spiral macro-coord generator
    persistence.js         localStorage round-trip
  world/
    Room.js                5×5 spawn (floor diamonds, iso walls, desk, per-type decorators)
    Agent.js               Character sprite + state→pose mapping + optional mock activity
server/
  src/
    orchestrator.ts        Linear polling, session dispatch, SSE events
    runner.ts              Codex process runner in git workspaces
    symphony.ts            Symphony dashboard API client
    http.ts                API routes and event stream
shared/
  types.ts                 Client/server contract
assets/
  office-items/            Furniture PNGs
  characters/character-XX/ Character sprites
  gbrain/                  Floating g-brain sprite views
symphony/
  WORKFLOW.example.md      Template for openai/symphony local runs
```
