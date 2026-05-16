import {
  ISO,
  CHARACTER_COUNT,
  CHARACTER_DIRECTIONS,
  characterTextureKey,
} from '../config/IsoConfig.js';

// Character art ships transparent RGBA — no chroma-key needed.
//
// Public state → internal SM state mapping. The eventual real state machine
// calls agent.setAgentState('typing' | 'success' | ...) and this drives the
// internal behavior state machine.
const STATE_TO_SM = {
  idle:     'SITTING_IDLE',
  typing:   'SITTING_TYPING',
  thinking: 'SITTING_THINKING',
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

// Quarter-tile shift applied to furniture in Room.js. The chair tile's
// furniture is shifted (-TILE_WIDTH/4, +TILE_HEIGHT/4), so the agent must
// match to stay visually seated.
const FURNITURE_SHIFT_X = -ISO.TILE_WIDTH / 4;
const FURNITURE_SHIFT_Y =  ISO.TILE_HEIGHT / 4;

// Walk tuning.
const WALK_FRAME_MS         = 200;   // walk-1 / walk-2 cycle interval
const WALK_TILE_DURATION_MS = 1200;  // time to traverse one tile
const WALK_HOPS_MIN         = 1;     // hops per excursion (tiles to wander)
const WALK_HOPS_MAX         = 3;
const REACT_DURATION_MS     = 1500;

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
  // bookshelves, whiteboards, etc.) are filtered out automatically.
  const room = agent.__room;
  if (!room?.tiles) return null;
  const candidates = [];
  for (let r = 1; r < ISO.ROOM_SIZE; r++) {
    for (let c = 1; c < ISO.ROOM_SIZE; c++) {
      if (!room.tiles[r][c].walkable) continue;
      if (r === 1 && c === 2) continue; // skip own chair (rest position)
      candidates.push({ r, c });
    }
  }
  if (!candidates.length) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function dirForStep(dr, dc) {
  // Grid-space direction picker. We can't compare raw screen-dx/dy because in
  // this iso projection a single grid step always has |dx| = 2·|dy|, so dx
  // would always win and the agent would never face front/back.
  //   +col → 'right' (screen SE)   -col → 'left'  (screen NW)
  //   +row → 'front' (screen SW)   -row → 'back'  (screen NE)
  if (Math.abs(dc) > Math.abs(dr)) {
    return dc > 0 ? 'right' : 'left';
  }
  return dr >= 0 ? 'front' : 'back';
}

function chairScreenPos(scene, room) {
  const macro = room.macroCoords;
  const p = scene.gridToScreen(macro.macroRow + 1, macro.macroCol + 2);
  return { x: p.x + FURNITURE_SHIFT_X, y: p.y + FURNITURE_SHIFT_Y };
}

function roomTileScreenPos(scene, room, localR, localC) {
  // Walking targets occupy whole tiles. We DON'T apply the furniture quarter-
  // tile shift while walking on the floor — the agent walks tile-to-tile in
  // the actual tile centers, then returns to the chair (which is shifted).
  const macro = room.macroCoords;
  return scene.gridToScreen(macro.macroRow + localR, macro.macroCol + localC);
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
// agent's current screen y so depth sort updates as we move.
function tweenAgentTo(scene, agent, targetX, targetY, duration, onComplete) {
  // Cancel any leftover idle-bob or movement tween on this agent.
  scene.tweens.killTweensOf(agent);
  scene.tweens.add({
    targets: agent,
    x: targetX,
    y: targetY,
    duration,
    ease: 'Sine.easeInOut',
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
  const prev = agent.__roomLocalRC ?? { r: 1, c: 2 }; // chair tile
  const prevDir = agent.direction;
  agent.direction = dirForStep(next.r - prev.r, next.c - prev.c);
  agent.__roomLocalRC = next;
  startWalkFrameCycle(scene, agent, prevDir !== agent.direction);
  tweenAgentTo(scene, agent, target.x, target.y, WALK_TILE_DURATION_MS, () => {
    walkPath(scene, agent, room, path, onComplete);
  });
}

function enterWalking(scene, agent, room) {
  agent.behaviorState = 'WALKING';
  stopIdleBob(scene, agent);
  if (agent.__reactReturnTimer) { agent.__reactReturnTimer.remove(false); agent.__reactReturnTimer = null; }
  // Pick 1..3 wander hops, plus a final hop back to the chair.
  const hops = WALK_HOPS_MIN + Math.floor(Math.random() * (WALK_HOPS_MAX - WALK_HOPS_MIN + 1));
  const path = [];
  for (let i = 0; i < hops; i++) path.push(pickRandomInRoomTile(agent));
  // Chair tile (1, 2) is the return target — but the chair sits at the
  // furniture-shifted position, so we walk to the tile center first, then
  // ease back to the rest position.
  path.push({ r: 1, c: 2 });
  walkPath(scene, agent, room, path, () => {
    // Snap back to the chair offset position and resume sitting.
    stopWalkFrameCycle(scene, agent);
    agent.direction = 'front';
    tweenAgentTo(scene, agent, agent.restX, agent.restY, 250, () => {
      enterSittingState(scene, agent, agent.__lastSittingState ?? 'SITTING_IDLE');
    });
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

  // Chair-tile screen pos, with the same quarter-tile shift applied to
  // furniture, so the agent stays centered in the (shifted) chair.
  const chairScreen = chairScreenPos(scene, room);

  const key = characterTextureKey(charIdx, 'idle', direction);
  const agent = scene.add.image(chairScreen.x, chairScreen.y - 4, key);
  agent.setOrigin(0.5, 1);
  agent.setScale(0.32);
  agent.kind = 'agent';
  agent.roomId = room.roomId;
  agent.characterIndex = charIdx;
  agent.direction = direction;
  agent.agentState = 'idle';
  agent.behaviorState = 'SITTING_IDLE';
  agent.__lastSittingState = 'SITTING_IDLE';

  // Resting pose anchor (the seated position, accounting for the -4 lift
  // that gives the agent a hint of vertical separation from the chair).
  agent.restX = chairScreen.x;
  agent.restY = chairScreen.y - 4;
  agent.baseY = agent.restY; // legacy alias

  // Sort by chair-tile center so idle bob and minor offsets don't flicker depth.
  // Note: this is the UN-SHIFTED tile center y — depth sort uses tile y, not
  // the shifted screen y, mirroring how Room.js sets walls/furniture __sortY.
  const macro = room.macroCoords;
  const chairTileCenter = scene.gridToScreen(macro.macroRow + 1, macro.macroCol + 2);
  agent.chairSortY = chairTileCenter.y;
  agent.__sortY = chairTileCenter.y;
  // Hold a reference to the room so the walking picker can query
  // room.tiles[r][c].walkable.
  agent.__room = room;

  agent.setAgentState = function (state) {
    this.agentState = state;
    const sm = STATE_TO_SM[state];
    if (!sm) return;
    if (sm === 'REACTING_CHEER')           enterReacting(scene, this, 'cheer');
    else if (sm === 'REACTING_SURPRISED')  enterReacting(scene, this, 'surprised');
    else if (sm === 'SLEEPING')            enterSittingState(scene, this, 'SLEEPING');
    else {
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

  // Start in idle and kick off the drivers.
  enterSittingState(scene, agent, 'SITTING_IDLE');
  scheduleNextTransition();
  scheduleNextReaction();

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
