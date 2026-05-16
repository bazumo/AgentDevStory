# AgentDevStory / AgentOffice

Isometric visual canvas for monitoring multiple long-running AI coding sessions as a sprawling office floor. Each new session spawns a 5×5 office tile cluster along a clockwise spiral, with a character sprite seated at the desk reacting to the session's state (typing / thinking / success / error / dormant).

This iteration is the **visual canvas + UI shell** only. Real WebSocket backend, `./workspace/` directory creation, `chokidar` watcher, and `gbrain` graph sync are the next phase (see "Roadmap" below). For now, the classifier, agent activity, and shell are mocked client-side.

## Stack

- Phaser 3 (canvas / iso rendering)
- Vite (dev + build)
- Vanilla JS / CSS for the DOM overlay (top bar, new-task modal, slide-over terminal)
- `localStorage` for state persistence (stand-in for `state.json`)

## Run

```bash
npm install
npm run dev
```

Open http://127.0.0.1:5173.

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
  - Plain Enter → mock agent reply, typewriter-streamed.
  - `! ls`, `! cat <file>`, `! pwd`, `! help` → mock virtual shell against an in-memory workspace.
- **Camera pan**: click-drag empty floor, or `WASD` / arrow keys.
- **Depth sort**: per-frame `setDepth(y + bias)` then `worldContainer.sort('depth')` — walls bias `-4`, agents `+4`.
- **Persistence**: spawned rooms round-trip through `localStorage` and re-spawn on reload.
- **Mock activity loop**: every ~1.8s each agent flips to a random state (idle / thinking / typing / cheer / surprised / sleep) so the sprites visibly cycle.

## Source layout

```
src/
  main.js                  Phaser bootstrap + UI init
  ui.js                    DOM overlay: new-task modal + terminal panel + mock shell/LLM
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
    Agent.js               Character sprite + state→pose mapping + mock activity loop
assets/
  web_office/              Furniture PNGs (desk, chair, laptop, server_rack, plant, whiteboard)
  characters/character-XX/ 10 chars × 5 states × 4 directions = 200 poses
```

## Roadmap (next phases — out of scope for this iteration)

- **Real backend.** Node WebSocket server. `ROOM_SPAWN` / `AGENT_MOVE` / `AGENT_STATE` / `TERMINAL_STREAM` / `TERMINAL_INPUT` events per spec. Replace mock activity loop.
- **Real workspace dirs.** Per-task `./workspace/<task>/` creation; `state.json` instead of `localStorage`.
- **Live agent threads.** Wire each room to an actual Claude / Codex session with filesystem MCP scoped to its workspace.
- **gbrain integration.** `gbrain serve` running locally; chokidar-driven sync on agent success state; cross-room semantic search.
- **Walking agents.** `AGENT_MOVE` paths animated on the iso grid, with the spritesheet's directional poses.
- **Bounding-box camera clamp.**
