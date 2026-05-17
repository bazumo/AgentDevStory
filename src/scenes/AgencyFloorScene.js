import Phaser from 'phaser';
import {
  ISO,
  CHARACTER_STATES,
  CHARACTER_DIRECTIONS,
  CHARACTER_COUNT,
  characterTextureKey,
} from '../config/IsoConfig.js';
import { ROOM_TYPES, classifyPrompt } from '../config/RoomTypes.js';
import { getSpiralCoordinates } from '../util/spiral.js';
import { spawnOfficeRoom } from '../world/Room.js';
import { spawnAgent, startMockActivityLoop } from '../world/Agent.js';
import { drawAgencyFloor } from '../world/Backdrop.js';
import { loadState, saveState } from '../util/persistence.js';
import { chromaKeyAll } from '../util/chromaKey.js';
import { ASSETS, ASSET_ROLES } from '../config/Assets.js';

const STATUS_TO_AGENT_STATE = {
  queued: 'idle',
  completed: 'done',
  failed: 'error',
  stopped: 'dormant',
};

function parseCodexJson(message) {
  try {
    return JSON.parse(message);
  } catch {
    return null;
  }
}

function stateFromCodexEvent(event) {
  if (!event) return 'thinking';
  if (event.kind === 'gbrain') return 'memory';
  if (event.kind === 'user') return 'thinking';
  if (event.kind === 'stderr' || event.kind === 'error') return 'error';
  if (event.kind === 'workspace') return 'thinking';

  const message = String(event.message ?? '');
  const text = message.toLowerCase();

  if (event.kind === 'stdout') {
    const parsed = parseCodexJson(message);
    const type = String(parsed?.type ?? '').toLowerCase();
    const itemType = String(parsed?.item?.type ?? '').toLowerCase();
    if (type === 'thread.started' || type === 'turn.started') return 'thinking';
    if (type === 'turn.completed') return 'typing';
    if (itemType === 'error') return 'error';
    if (type.includes('reason') || itemType.includes('reason')) return 'thinking';
    if (itemType === 'command_execution' || itemType === 'tool_call') return 'typing';
    if (itemType === 'agent_message') return 'typing';
    return 'typing';
  }

  if (text.includes('thinking') || text.includes('reasoning') || text.includes('analysis')) {
    return 'thinking';
  }
  if (text.includes('workspace') || text.includes('queued') || text.includes('starting')) {
    return 'thinking';
  }
  if (text.includes('command') || text.includes('wrote') || text.includes('edit') || text.includes('patch')) {
    return 'typing';
  }

  return 'typing';
}

function deriveAgentState(session) {
  if (!session) return 'idle';
  if (session.status !== 'running') {
    return STATUS_TO_AGENT_STATE[session.status] ?? 'idle';
  }
  const transcript = Array.isArray(session.transcript) ? session.transcript : [];
  return stateFromCodexEvent(transcript[transcript.length - 1]);
}

export class AgencyFloorScene extends Phaser.Scene {
  constructor() {
    super({ key: 'AgencyFloorScene' });
  }

  preload() {
    this.load.image('gbrain_core', 'gbrain/front-right.png');
    for (const role of ASSET_ROLES) {
      const a = ASSETS[role];
      this.load.image(a.key, a.path);
    }
    for (let i = 1; i <= CHARACTER_COUNT; i++) {
      const idx = String(i).padStart(2, '0');
      this.load.image(
        characterTextureKey(i, 'idle', 'front'),
        `characters/character-${idx}/idle-front.png`,
      );
    }
  }

  create() {
    this.backendConnected = Boolean(window.__agentoffice?.backendConnected);

    // All current assets ship with transparent backgrounds — no chroma-key.
    // (Older opaque-bg assets that need keying should set chromaKey: true in
    // Assets.js; the loop honors that flag.)
    const keysNeedingChromaKey = [];
    for (const role of ASSET_ROLES) {
      if (ASSETS[role].chromaKey === true) keysNeedingChromaKey.push(ASSETS[role].key);
    }
    if (keysNeedingChromaKey.length) chromaKeyAll(this, keysNeedingChromaKey);

    this.renderableList = [];
    this.rooms = [];
    this.roomCounter = 0;

    this.worldContainer = this.add.container(
      this.cameras.main.centerX,
      ISO.WORLD_ORIGIN_Y,
    );
    this.worldContainer.__panX = 0;
    this.worldContainer.__panY = 0;

    const backdrop = drawAgencyFloor(this);
    // Trees and lamps need per-frame depth sort so they layer with rooms.
    for (const obj of backdrop) {
      if (obj.kind === 'scenery') this.renderableList.push(obj);
    }
    this.spawnGBrainCore();

    this.scale.on('resize', (gameSize) => {
      this.worldContainer.x = gameSize.width / 2 + this.worldContainer.__panX;
    });

    window.addEventListener('agentoffice:new-task', (e) => {
      const { prompt } = e.detail ?? {};
      this.spawnRoomFromPrompt(prompt ?? 'untitled task');
    });

    window.addEventListener('agentoffice:world-update', (e) => {
      this.backendConnected = true;
      this._syncFromBackend(e.detail);
    });

    window.addEventListener('agentoffice:session-update', (e) => {
      this.backendConnected = true;
      this._updateSessionState(e.detail);
    });

    this.setupCameraPan();

    if (!this.backendConnected) {
      const saved = loadState();
      for (const r of saved.rooms) {
        this._spawnRoom({
          prompt: r.prompt,
          roomType: r.roomType,
          characterIndex: r.characterIndex,
          roomId: r.roomId,
          mockDriven: true,
        });
      }
      startMockActivityLoop(this);
    }
  }

  setupCameraPan() {
    this.panKeys = this.input.keyboard.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT');
    this.dragState = null;

    this.input.on('pointerdown', (pointer, currentlyOver) => {
      // Only block drag-pan when a non-floor interactive (e.g. future click
      // targets like a building entry button) was hit. Floor tiles are always
      // interactive but should still allow drag-pan to start.
      const blocksDrag = currentlyOver.some(o => o.kind && o.kind !== 'floor');
      if (blocksDrag) return;
      this.tweens.killTweensOf(this.worldContainer);
      this.dragState = {
        startPointer: { x: pointer.x, y: pointer.y },
        startContainer: { x: this.worldContainer.x, y: this.worldContainer.y },
      };
    });

    this.input.on('pointermove', (pointer) => {
      if (!this.dragState) return;
      const dx = pointer.x - this.dragState.startPointer.x;
      const dy = pointer.y - this.dragState.startPointer.y;
      this.worldContainer.x = this.dragState.startContainer.x + dx;
      this.worldContainer.y = this.dragState.startContainer.y + dy;
      this.worldContainer.__panX = this.worldContainer.x - this.cameras.main.centerX;
      this.worldContainer.__panY = this.worldContainer.y - ISO.WORLD_ORIGIN_Y;
    });

    const endDrag = () => { this.dragState = null; };
    this.input.on('pointerup', endDrag);
    this.input.on('pointerupoutside', endDrag);
  }

  openTerminalForRoom(roomId) {
    const room = this.rooms.find(r => r.roomId === roomId);
    if (!room?.desk) return;
    this.selectDesk(room.desk);
  }

  spawnGBrainCore() {
    const p = this.gridToScreen(0, 0);
    this.gbrainTarget = { x: p.x, y: p.y + 14 };

    const shadow = this.add.ellipse(p.x, p.y + 42, ISO.TILE_WIDTH * 2, ISO.TILE_HEIGHT * 1.25, 0x0b1020, 0.42);
    shadow.kind = 'gbrain';
    shadow.__sortY = p.y + 44;
    this.worldContainer.add(shadow);

    const glow = this.add.ellipse(p.x, p.y + 10, ISO.TILE_WIDTH * 2, ISO.TILE_HEIGHT * 2, 0x66aaff, 0.18);
    glow.kind = 'gbrain';
    glow.__sortY = p.y + 45;
    this.worldContainer.add(glow);

    const core = this.add.image(p.x, p.y + 40, 'gbrain_core');
    core.setOrigin(0.5, 1);
    core.setScale(0.18);
    core.kind = 'gbrain';
    core.__sortY = p.y + 46;
    this.worldContainer.add(core);

    const label = this.add.text(p.x, p.y + 50, 'G-BRAIN', {
      fontFamily: 'monospace',
      fontSize: '10px',
      color: '#dbeafe',
      stroke: '#0b1020',
      strokeThickness: 3,
    });
    label.setOrigin(0.5, 0);
    label.kind = 'fx';
    label.__sortY = p.y + 55;
    this.worldContainer.add(label);

    this.tweens.add({
      targets: glow,
      alpha: { from: 0.12, to: 0.34 },
      scaleX: { from: 0.9, to: 1.12 },
      scaleY: { from: 0.9, to: 1.12 },
      duration: 1600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    this.tweens.add({
      targets: [core, label],
      y: '-=8',
      duration: 1700,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
      onUpdate: () => {
        core.__sortY = core.y + 6;
        label.__sortY = label.y + 5;
      },
    });

    this.renderableList.push(shadow, glow, core, label);
  }

  selectDesk(desk) {
    const room = this.rooms.find((r) => r.desk === desk);
    if (!room) return;
    const meta = this.roomTypeMeta(room.roomType);

    this.tweens.killTweensOf(this.worldContainer);

    const targetX = this.cameras.main.centerX - desk.x - ISO.PANEL_OFFSET_PX;
    const targetY = ISO.WORLD_ORIGIN_Y - desk.y;

    this.tweens.add({
      targets: this.worldContainer,
      x: targetX,
      y: targetY,
      duration: ISO.CAMERA_TWEEN_MS,
      ease: 'Quad.easeInOut',
      onUpdate: () => {
        this.worldContainer.__panX = this.worldContainer.x - this.cameras.main.centerX;
        this.worldContainer.__panY = this.worldContainer.y - ISO.WORLD_ORIGIN_Y;
      },
    });

    const payload = {
      roomId: room.roomId,
      sessionId: room.sessionId,
      roomType: room.roomType,
      label: meta.label,
      prompt: room.prompt,
      status: room.session?.status,
      workspacePath: room.session?.workspacePath,
      backendConnected: this.backendConnected,
    };
    this.events.emit('room:selected', payload);
    window.dispatchEvent(new CustomEvent('agentoffice:room-selected', { detail: payload }));
  }

  spawnRoomFromPrompt(prompt) {
    const roomType = classifyPrompt(prompt);
    const room = this._spawnRoom({ prompt, roomType, mockDriven: true });
    this._persist();
    return room;
  }

  _spawnRoom({ prompt, roomType, characterIndex, roomId, mockDriven = !this.backendConnected }) {
    const index = ++this.roomCounter;
    const macroCoords = getSpiralCoordinates(index);

    if (!roomId) {
      const slug = (prompt || `room-${index}`)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 32) || `room-${index}`;
      roomId = `${slug}-${String(index).padStart(2, '0')}`;
    }

    const room = spawnOfficeRoom(this, { roomId, macroCoords, roomType });
    room.prompt = prompt;
    spawnAgent(this, { room, characterIndex, mockDriven });
    this.rooms.push(room);
    return room;
  }

  _persist() {
    const rooms = this.rooms.map((r) => ({
      roomId: r.roomId,
      prompt: r.prompt,
      roomType: r.roomType,
      characterIndex: r.agent?.characterIndex,
    }));
    saveState({ rooms });
  }

  _syncFromBackend(world) {
    if (!world?.sessions) return;
    for (const session of world.sessions) {
      const room = this.rooms.find((r) => r.roomId === session.id);
      if (room) {
        this._applySessionStatus(room, session);
      } else {
        this._spawnBackendSession(session);
      }
    }
  }

  _spawnBackendSession(session) {
    const roomType = classifyPrompt([
      session.issueIdentifier,
      session.latestEvent,
      session.profession,
    ].filter(Boolean).join(' '));
    const charNum = parseInt(session.character?.replace('character-', ''), 10) || undefined;
    const room = this._spawnRoom({
      prompt: `${session.issueIdentifier}: ${session.latestEvent ?? session.status}`,
      roomType,
      characterIndex: charNum,
      roomId: session.id,
      mockDriven: false,
    });
    this._applySessionStatus(room, session);
    return room;
  }

  _updateSessionState(session) {
    if (!session?.id) return;
    const room = this.rooms.find((r) => r.roomId === session.id);
    if (room) {
      this._applySessionStatus(room, session);
    } else {
      this._spawnBackendSession(session);
    }
  }

  _applySessionStatus(room, session) {
    if (!room?.agent) return;
    room.session = session;
    room.sessionId = session.id;
    room.prompt = `${session.issueIdentifier}: ${session.latestEvent ?? session.status}`;
    const state = deriveAgentState(session);
    room.agent.setAgentState(state);
  }

  update(_time, _delta) {
    if (this.panKeys && !this.dragState && this.input.keyboard.enabled) {
      const k = this.panKeys;
      const speed = ISO.KEYBOARD_PAN_SPEED;
      let dx = 0, dy = 0;
      if (k.A.isDown || k.LEFT.isDown)  dx += speed;
      if (k.D.isDown || k.RIGHT.isDown) dx -= speed;
      if (k.W.isDown || k.UP.isDown)    dy += speed;
      if (k.S.isDown || k.DOWN.isDown)  dy -= speed;
      if (dx !== 0 || dy !== 0) {
        this.tweens.killTweensOf(this.worldContainer);
        this.worldContainer.x += dx;
        this.worldContainer.y += dy;
        this.worldContainer.__panX = this.worldContainer.x - this.cameras.main.centerX;
        this.worldContainer.__panY = this.worldContainer.y - ISO.WORLD_ORIGIN_Y;
      }
    }

    // Strict layer rendering: every floor draws before any wall, every wall
    // before any furniture, every furniture before any sprite. Each layer
    // has a 1000-unit band; within a band, sortY orders adjacent items.
    //
    //   backdrop  : -10000       (the agency mega-floor, always behind)
    //   scenery   : -9000..-9200 (trees, lamp posts — sit between backdrop
    //                             and rooms so rooms stay on top)
    //   floor     :     0..  200
    //   accent    :   100..  300 (tinted overlay on floor tiles)
    //   wall      :  1000.. 1200
    //   furniture :  2000.. 2200
    //   desk      :  2100.. 2300 (slightly above generic furniture)
    //   agent     :  3000.. 3200
    //   fx        : 10000+       (halo flashes, always foreground)
    for (const obj of this.renderableList) {
      switch (obj.kind) {
        case 'backdrop':     obj.depth = -10000; continue;
        case 'scenery':      obj.depth = -9000 + (obj.__sceneryY ?? obj.y); continue;
        case 'floor':        obj.depth =     0 + (obj.__sortY ?? obj.y); break;
        case 'floor-accent': obj.depth =   100 + (obj.__sortY ?? obj.y); break;
        case 'wall':         obj.depth =  1000 + (obj.__sortY ?? obj.y); break;
        case 'furniture':    obj.depth =  2000 + (obj.__sortY ?? obj.y); break;
        case 'desk':         obj.depth =  2100 + (obj.__sortY ?? obj.y); break;
        case 'agent':        obj.depth =  3000 + (obj.__sortY ?? obj.y); break;
        case 'gbrain':       obj.depth =  2500 + (obj.__sortY ?? obj.y); break;
        case 'fx':           obj.depth = 10000 + obj.y; break;
        default:             obj.depth =       (obj.__sortY ?? obj.y);
      }
    }
    this.worldContainer.sort('depth');
  }

  gridToScreen(row, col) {
    return {
      x: (col - row) * (ISO.TILE_WIDTH / 2),
      y: (col + row) * (ISO.TILE_HEIGHT / 2),
    };
  }

  roomTypeMeta(type) {
    return ROOM_TYPES[type] ?? ROOM_TYPES.forge;
  }
}
