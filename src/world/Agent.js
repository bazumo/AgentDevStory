import { ISO, CHARACTER_COUNT, characterTextureKey } from '../config/IsoConfig.js';
import { chromaKeyTexture } from '../util/chromaKey.js';

const STATE_TO_POSE = {
  idle:      'idle',
  typing:    'thinking',
  thinking:  'thinking',
  success:   'cheer',
  error:     'surprised',
  dormant:   'sleep',
};

function characterAssetPath(charIndex, pose, direction) {
  const idx = String(charIndex).padStart(2, '0');
  return `characters/character-${idx}/${pose}-${direction}.png`;
}

function ensureTexture(scene, key, path, cb) {
  if (scene.textures.exists(key)) { cb(); return; }
  scene.load.image(key, path);
  scene.load.once('filecomplete-image-' + key, () => {
    chromaKeyTexture(scene, key);
    cb();
  });
  if (!scene.load.isLoading()) scene.load.start();
}

export function spawnAgent(scene, { room, characterIndex, direction = 'front' }) {
  const charIdx = characterIndex ?? (1 + Math.floor(Math.random() * CHARACTER_COUNT));

  // Place agent ONE tile back from the desk (the "chair" tile), so the desk
  // visually sits in front of the character. With bottom-center origin, the
  // agent appears seated.
  const r = room.desk;
  // The Room stores desk via setOrigin(0.5,1), so r.x/r.y is desk's feet.
  // Compute the chair-tile screen pos = desk - (tileRow=1) i.e. up one row.
  // Use Room's macroCoords + offset (2,2)→(1,2).
  const macro = room.macroCoords;
  const chairScreen = scene.gridToScreen(macro.macroRow + 1, macro.macroCol + 2);

  const key = characterTextureKey(charIdx, 'idle', direction);
  const agent = scene.add.image(chairScreen.x, chairScreen.y - 4, key);
  agent.setOrigin(0.5, 1);
  agent.setScale(0.32);
  agent.kind = 'agent';
  agent.roomId = room.roomId;
  agent.characterIndex = charIdx;
  agent.direction = direction;
  agent.agentState = 'idle';
  agent.baseY = chairScreen.y - 4;

  agent.setAgentState = function (state) {
    const pose = STATE_TO_POSE[state] ?? 'idle';
    const newKey = characterTextureKey(this.characterIndex, pose, this.direction);
    const path = characterAssetPath(this.characterIndex, pose, this.direction);
    ensureTexture(scene, newKey, path, () => {
      this.setTexture(newKey);
      this.agentState = state;
    });
  };

  // Idle bob: 2px up/down on a slow sine.
  scene.tweens.add({
    targets: agent,
    y: agent.baseY - 2,
    duration: 1400,
    yoyo: true,
    repeat: -1,
    ease: 'Sine.easeInOut',
  });

  scene.worldContainer.add(agent);
  scene.renderableList.push(agent);
  room.agent = agent;
  return agent;
}

export function startMockActivityLoop(scene) {
  const states = ['idle', 'typing', 'thinking', 'success', 'idle', 'error', 'dormant'];
  scene.time.addEvent({
    delay: 1800,
    loop: true,
    callback: () => {
      for (const room of scene.rooms) {
        if (!room.agent) continue;
        const next = states[Math.floor(Math.random() * states.length)];
        room.agent.setAgentState(next);
      }
    },
  });
}

void ISO;
