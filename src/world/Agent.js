import {
  ISO,
  CHARACTER_COUNT,
  CHARACTER_DIRECTIONS,
  characterTextureKey,
} from '../config/IsoConfig.js';
import { backend } from '../backend.js';

// Character art ships transparent RGBA — no chroma-key needed.
//
// Public agent state → internal SM state mapping. Backend agent states drive
// the character sprite:
//   idle     → sitting idle
//   typing   → sitting typing (agent is working)
//   thinking → sitting thinking (agent is deliberating)
//   walking  → wander excursion (agent is working, keeps it visually interesting)
//   success  → cheer reaction, then transition to sleep
//   error    → surprised reaction (broken / needs attention)
//   dormant  → sleeping
const STATE_TO_SM = {
  idle:     'SITTING_IDLE',
  typing:   'SITTING_TYPING',
  thinking: 'SITTING_THINKING',
  walking:  'WALKING',
  success:  'REACTING_CHEER',
  error:    'REACTING_SURPRISED',
  dormant:  'SLEEPING',
};

// SM state → resting pose (for sitting / sleeping / reacting states).
const SM_TO_POSE = {
  SITTING_IDLE:       'idle',
  SITTING_TYPING:     'typing',
  SITTING_THINKING:   'thinking',
  REACTING_CHEER:     'cheer',
  REACTING_SURPRISED: 'surprised',
  SLEEPING:           'sleep',
};

// Walk tuning.
const WALK_FRAME_MS         = 220;   // walk-1 / walk-2 cycle interval
const WALK_TILE_DURATION_MS = 520;   // time to traverse one tile (adjacent step)
const REACT_DURATION_MS     = 1500;

// gridToScreen(r, c) returns the tile CENTER directly — Room.js draws each
// floor diamond with vertices symmetric around that point (see Room.js
// `diamondPoints()`). So agent feet plant exactly at gridToScreen; no
// extra offset.

function characterAssetPath(charIndex, pose, direction) {
  const idx = String(charIndex).padStart(2, '0');
  return `characters/character-${idx}/${pose}-${direction}.png`;
}

function ensureTexture(scene, key, path, cb) {
  if (scene.textures.exists(key)) { cb(); return; }
  scene.load.image(key, path);
  scene.load.once('filecomplete-image-' + key, () => cb());
  if (!scene.load.isLoading()) scene.load.start();
}

function setPose(scene, agent, pose, direction) {
  const dir = direction ?? agent.direction;
  const key = characterTextureKey(agent.characterIndex, pose, dir);
  const path = characterAssetPath(agent.characterIndex, pose, dir);
  ensureTexture(scene, key, path, () => {
    if (agent.active) agent.setTexture(key);
  });
}

function pickRandomInRoomTile(agent) {
  // Returns a {r, c} in room-local coords [0..ROOM_SIZE-1] that is walkable
  // per room.tiles[][]. Walls (r=0 / c=0) and non-walkable assets (desks,
  // bookshelves, whiteboards, etc.) are filtered out automatically. Excludes
  // the agent's home tile so wandering always goes somewhere new.
  const room = agent.__room;
  if (!room?.tiles) return null;
  const home = agent.__homeRC ?? { r: 2, c: 1 };
  const candidates = [];
  for (let r = 1; r < ISO.ROOM_SIZE; r++) {
    for (let c = 1; c < ISO.ROOM_SIZE; c++) {
      if (!room.tiles[r][c].walkable) continue;
      if (r === home.r && c === home.c) continue;
      candidates.push({ r, c });
    }
  }
  if (!candidates.length) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// Pick the agent's spawn / rest tile. Prefer a chair if the layout has one
// (chairs are walkable and visually simulate "sitting at the desk"). Fall
// back to an empty walkable tile near the primary desk so the agent never
// spawns inside a bookshelf, cubicle, or whiteboard.
function pickHomeTile(room) {
  if (!room?.tiles) return { r: 2, c: 1 };
  for (let r = 1; r < ISO.ROOM_SIZE; r++) {
    for (let c = 1; c < ISO.ROOM_SIZE; c++) {
      if (room.tiles[r][c].asset === 'chair') return { r, c };
    }
  }
  const prefs = [[2,1], [3,2], [2,3], [3,3], [1,2], [1,1]];
  for (const [r, c] of prefs) {
    const t = room.tiles[r]?.[c];
    if (t && t.walkable && t.asset == null) return { r, c };
  }
  for (let r = 1; r < ISO.ROOM_SIZE; r++) {
    for (let c = 1; c < ISO.ROOM_SIZE; c++) {
      const t = room.tiles[r][c];
      if (t.walkable && t.asset == null) return { r, c };
    }
  }
  return { r: 2, c: 2 };
}

// BFS shortest path on the room tile grid. Each step is to a 4-connected
// neighbor (row±1 or col±1), so when projected to screen the agent always
// glides along one of the four iso diagonals — never cuts across tile
// corners. `start` and `goal` are always treated as passable (the chair tile
// is the agent's home and may be flagged non-walkable for the wander picker).
function findTilePath(room, start, goal) {
  const passable = (r, c) => {
    if (r < 0 || c < 0 || r >= ISO.ROOM_SIZE || c >= ISO.ROOM_SIZE) return false;
    if (r === start.r && c === start.c) return true;
    if (r === goal.r && c === goal.c) return true;
    return !!room.tiles[r]?.[c]?.walkable;
  };
  const key = (r, c) => r * 100 + c;
  const parent = new Map();
  parent.set(key(start.r, start.c), null);
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift();
    if (cur.r === goal.r && cur.c === goal.c) {
      const path = [];
      let n = cur;
      while (n && !(n.r === start.r && n.c === start.c)) {
        path.unshift(n);
        n = parent.get(key(n.r, n.c));
      }
      return path;
    }
    for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const nr = cur.r + dr, nc = cur.c + dc;
      if (!passable(nr, nc)) continue;
      const k = key(nr, nc);
      if (parent.has(k)) continue;
      parent.set(k, cur);
      queue.push({ r: nr, c: nc });
    }
  }
  return null;
}

function dirForStep(dr, dc) {
  // Grid-space direction picker. We can't compare raw screen-dx/dy because in
  // this iso projection a single grid step always has |dx| = 2·|dy|, so dx
  // would always win and the agent would never face front/back.
  // Sprite labels in this set are camera-relative (where the viewer sits), not
  // character-heading, so the screen-direction mapping is rotated 90°:
  //   +col → 'front' (screen SE)   -col → 'back'  (screen NW)
  //   +row → 'right' (screen SW)   -row → 'left'  (screen NE)
  if (Math.abs(dc) > Math.abs(dr)) {
    return dc > 0 ? 'front' : 'back';
  }
  return dr >= 0 ? 'right' : 'left';
}

// Tile (r, c) in room-local coords → screen-space position where the agent's
// feet should plant. Uses room.base (NOT room.macroCoords) — Room.js shifts
// the visible room one grid-unit down+right from macroCoords so the macro
// tile remains a visible plaza tile, and floor/furniture are drawn at
// base+local. Agents must use the same anchor or they'll be off by one
// row/col and visually drift onto neighbouring tiles' furniture.
function roomTileScreenPos(scene, room, localR, localC) {
  const base = room.base ?? room.macroCoords;
  return scene.gridToScreen(base.macroRow + localR, base.macroCol + localC);
}

// --- Walk animation -------------------------------------------------------

function startWalkFrameCycle(scene, agent, directionChanged) {
  // Phase persists across tile hops so alternation stays in rhythm. We only
  // (re)start the timer if it isn't running; on a direction change we force
  // an immediate tick so the new-direction sprite shows without a 200ms lag.
  if (agent.__walkPhase == null) agent.__walkPhase = 1;
  const tick = () => {
    setPose(scene, agent, agent.__walkPhase === 1 ? 'walk-1' : 'walk-2', agent.direction);
    agent.__walkPhase = agent.__walkPhase === 1 ? 2 : 1;
  };
  if (!agent.__walkTimer) {
    tick();
    agent.__walkTimer = scene.time.addEvent({
      delay: WALK_FRAME_MS,
      loop: true,
      callback: tick,
    });
  } else if (directionChanged) {
    tick();
  }
}

function stopWalkFrameCycle(scene, agent) {
  if (agent.__walkTimer) {
    agent.__walkTimer.remove(false);
    agent.__walkTimer = null;
  }
  agent.__walkPhase = 1;
}

// Tween from current (x,y) to target (x,y). Keeps __sortY synced to the
// agent's current screen y so depth sort updates as we move. Use ease:'Linear'
// for chained tile-to-tile walks so the agent doesn't slow down at every
// tile boundary.
function tweenAgentTo(scene, agent, targetX, targetY, duration, onComplete, ease = 'Sine.easeInOut') {
  scene.tweens.killTweensOf(agent);
  scene.tweens.add({
    targets: agent,
    x: targetX,
    y: targetY,
    duration,
    ease,
    onUpdate: () => { agent.__sortY = agent.y; },
    onComplete: () => {
      agent.__sortY = agent.y;
      if (onComplete) onComplete();
    },
  });
}

// --- Idle bob -------------------------------------------------------------
// Applied only while the agent is sitting at the chair. We disable it during
// walking / reacting and restart on return.

function startIdleBob(scene, agent) {
  stopIdleBob(scene, agent);
  agent.__bobTween = scene.tweens.add({
    targets: agent,
    y: agent.restY - 2,
    duration: 1400,
    yoyo: true,
    repeat: -1,
    ease: 'Sine.easeInOut',
    onUpdate: () => { /* don't touch __sortY: keep it at chair sort y */ },
  });
}

function stopIdleBob(scene, agent) {
  if (agent.__bobTween) {
    agent.__bobTween.stop();
    agent.__bobTween = null;
  }
}

// --- State machine -------------------------------------------------------

function enterSittingState(scene, agent, smState) {
  // Snap to chair position (if not already there) and play the corresponding
  // pose. Idle-bob runs only in sitting states (excludes WALKING / REACTING
  // since those have their own animation cadence, although REACTING also
  // happens at the chair — we still pause bob during reactions to avoid
  // jitter mixing with the pose change).
  agent.behaviorState = smState;
  agent.direction = 'front';
  stopWalkFrameCycle(scene, agent);
  scene.tweens.killTweensOf(agent);
  agent.x = agent.restX;
  agent.y = agent.restY;
  agent.__sortY = agent.chairSortY;
  setPose(scene, agent, SM_TO_POSE[smState], 'front');
  if (smState !== 'SLEEPING') startIdleBob(scene, agent);
  else stopIdleBob(scene, agent);
}

function enterReacting(scene, agent, flavor /* 'cheer' | 'surprised' */) {
  agent.behaviorState = flavor === 'surprised' ? 'REACTING_SURPRISED' : 'REACTING_CHEER';
  stopWalkFrameCycle(scene, agent);
  stopIdleBob(scene, agent);
  scene.tweens.killTweensOf(agent);
  agent.x = agent.restX;
  agent.y = agent.restY;
  agent.__sortY = agent.chairSortY;
  agent.direction = 'front';
  setPose(scene, agent, flavor, 'front');
  // Auto-return to a sitting state after the react window.
  if (agent.__reactReturnTimer) agent.__reactReturnTimer.remove(false);
  agent.__reactReturnTimer = scene.time.delayedCall(REACT_DURATION_MS, () => {
    if (!agent.active) return;
    enterSittingState(scene, agent, agent.__lastSittingState ?? 'SITTING_IDLE');
  });
}

// Recursively walk one tile, then chain to the next. Returns to chair when
// the path is empty. `path` is an array of room-local {r,c}.
function walkPath(scene, agent, room, path, onComplete) {
  if (!agent.active) return;
  if (path.length === 0) {
    if (onComplete) onComplete();
    return;
  }
  const next = path.shift();
  const target = roomTileScreenPos(scene, room, next.r, next.c);
  const prev = agent.__roomLocalRC ?? agent.__homeRC ?? { r: 2, c: 1 };
  const prevDir = agent.direction;
  agent.direction = dirForStep(next.r - prev.r, next.c - prev.c);
  agent.__roomLocalRC = next;
  startWalkFrameCycle(scene, agent, prevDir !== agent.direction);
  tweenAgentTo(scene, agent, target.x, target.y, WALK_TILE_DURATION_MS, () => {
    walkPath(scene, agent, room, path, onComplete);
  }, 'Linear');
}

function enterWalking(scene, agent, room) {
  agent.behaviorState = 'WALKING';
  stopIdleBob(scene, agent);
  if (agent.__reactReturnTimer) { agent.__reactReturnTimer.remove(false); agent.__reactReturnTimer = null; }

  // Pick one wander destination, then BFS-path out to it and back to the
  // agent's home tile. Each entry in `path` is an adjacent step, so the
  // screen-space tween between successive tiles is exactly one iso diagonal
  // — the agent walks along the grid, never cutting across corners.
  const home = agent.__homeRC ?? { r: 2, c: 1 };
  const start = agent.__roomLocalRC ?? home;
  const dest = pickRandomInRoomTile(agent);
  let path = [];
  if (dest) {
    const out  = findTilePath(room, start, dest);
    const back = findTilePath(room, dest, home);
    if (out && back) path = [...out, ...back];
  }
  if (path.length === 0) {
    enterSittingState(scene, agent, agent.__lastSittingState ?? 'SITTING_IDLE');
    return;
  }
  walkPath(scene, agent, room, path, () => {
    stopWalkFrameCycle(scene, agent);
    enterSittingState(scene, agent, agent.__lastSittingState ?? 'SITTING_IDLE');
  });
}

// --- Public API ---------------------------------------------------------

export function spawnAgent(scene, { room, characterIndex, direction = 'front' }) {
  const charIdx = characterIndex ?? (1 + Math.floor(Math.random() * CHARACTER_COUNT));

  // Preload walk frames so the first step doesn't show a stale (idle/typing)
  // pose while the walking texture is still being fetched.
  let queued = false;
  for (const d of CHARACTER_DIRECTIONS) {
    for (const w of ['walk-1', 'walk-2']) {
      const key = characterTextureKey(charIdx, w, d);
      if (scene.textures.exists(key)) continue;
      scene.load.image(key, characterAssetPath(charIdx, w, d));
      queued = true;
    }
  }
  if (queued && !scene.load.isLoading()) scene.load.start();

  // Home tile = where the agent spawns, sits, and returns to after walking.
  // Picked per-room so the agent never overlaps with furniture / walls.
  // Use roomTileScreenPos so the spawn lands on the same foot-plant point
  // that walking targets use — agent never visually snaps between sit/walk.
  const home = pickHomeTile(room);
  const homeScreen = roomTileScreenPos(scene, room, home.r, home.c);

  const key = characterTextureKey(charIdx, 'idle', direction);
  const agent = scene.add.image(homeScreen.x, homeScreen.y, key);
  agent.setOrigin(0.5, 1);
  agent.setScale(0.32);
  agent.kind = 'agent';
  agent.roomId = room.roomId;
  agent.characterIndex = charIdx;
  agent.direction = direction;
  agent.agentState = 'idle';
  agent.behaviorState = 'SITTING_IDLE';
  agent.__lastSittingState = 'SITTING_IDLE';

  // Tile-centered rest position — feet plant exactly on the home tile center,
  // no chair shift, no -4 lift. The walking tween snaps back here on return.
  agent.restX = homeScreen.x;
  agent.restY = homeScreen.y;
  agent.__homeRC = home;
  agent.__roomLocalRC = home;

  // Depth-sort anchor: use the home tile's y so the agent layers correctly
  // with furniture in the same room (same convention as Room.js __sortY).
  agent.chairSortY = homeScreen.y;
  agent.__sortY = homeScreen.y;
  // Hold a reference to the room so the walking picker can query
  // room.tiles[r][c].walkable.
  agent.__room = room;
  // Inherit the room's back-to-front sort base so this agent renders inside
  // its room's depth band (an entire front room fully covers any back room).
  agent.__roomY = room.roomY;

  agent.setAgentState = function (state) {
    this.agentState = state;
    const sm = STATE_TO_SM[state];
    if (!sm) return;
    if (sm === 'WALKING') {
      enterWalking(scene, this, room);
    } else if (sm === 'REACTING_CHEER') {
      enterReacting(scene, this, 'cheer');
      // After cheering, transition to sleep (agent finished its work)
      if (this.__cheerToSleepTimer) this.__cheerToSleepTimer.remove(false);
      this.__cheerToSleepTimer = scene.time.delayedCall(REACT_DURATION_MS + 500, () => {
        if (!this.active) return;
        enterSittingState(scene, this, 'SLEEPING');
      });
    } else if (sm === 'REACTING_SURPRISED') {
      enterReacting(scene, this, 'surprised');
    } else if (sm === 'SLEEPING') {
      enterSittingState(scene, this, 'SLEEPING');
    } else {
      this.__lastSittingState = sm;
      enterSittingState(scene, this, sm);
    }
  };

  // Per-agent behavior driver — picks the next transition every 4–8s, and a
  // separate event timer randomly triggers a cheer/surprised reaction every
  // 10–15s. Walking is rarer than typing/thinking (active coding dominates).
  const scheduleNextTransition = () => {
    const delay = 4000 + Math.floor(Math.random() * 4000); // 4–8s
    agent.__transitionTimer = scene.time.delayedCall(delay, () => {
      if (!agent.active) return;
      // Skip transitions while walking or reacting — wait until back at chair.
      if (agent.behaviorState === 'WALKING' ||
          agent.behaviorState === 'REACTING_CHEER' ||
          agent.behaviorState === 'REACTING_SURPRISED') {
        scheduleNextTransition();
        return;
      }
      // Weighted pick: typing > thinking > walking > idle.
      const roll = Math.random();
      if (roll < 0.45) {
        agent.__lastSittingState = 'SITTING_TYPING';
        enterSittingState(scene, agent, 'SITTING_TYPING');
      } else if (roll < 0.70) {
        agent.__lastSittingState = 'SITTING_THINKING';
        enterSittingState(scene, agent, 'SITTING_THINKING');
      } else if (roll < 0.90) {
        // Walk excursion — returns to last sitting state on completion.
        enterWalking(scene, agent, room);
      } else {
        agent.__lastSittingState = 'SITTING_IDLE';
        enterSittingState(scene, agent, 'SITTING_IDLE');
      }
      scheduleNextTransition();
    });
  };

  const scheduleNextReaction = () => {
    const delay = 10000 + Math.floor(Math.random() * 5000); // 10–15s
    agent.__reactTimer = scene.time.delayedCall(delay, () => {
      if (!agent.active) return;
      if (agent.behaviorState === 'WALKING' ||
          agent.behaviorState === 'REACTING_CHEER' ||
          agent.behaviorState === 'REACTING_SURPRISED') {
        scheduleNextReaction();
        return;
      }
      const flavor = Math.random() < 0.6 ? 'cheer' : 'surprised';
      enterReacting(scene, agent, flavor);
      scheduleNextReaction();
    });
  };

  // Start in idle. Only run mock random timers when the backend is not
  // connected — when the backend is live, agent states are driven by real
  // Claude Code process events via setAgentState().
  enterSittingState(scene, agent, 'SITTING_IDLE');
  if (!backend.connected) {
    scheduleNextTransition();
    scheduleNextReaction();
  }

  scene.worldContainer.add(agent);
  scene.renderableList.push(agent);
  room.agent = agent;
  return agent;
}

// Legacy entry point — the new behavior is driven per-agent inside spawnAgent,
// so this becomes a no-op that we keep for backward compatibility with the
// scene's `startMockActivityLoop(this)` call site.
export function startMockActivityLoop(_scene) {
  // intentionally empty: per-agent timers handle everything now
}
