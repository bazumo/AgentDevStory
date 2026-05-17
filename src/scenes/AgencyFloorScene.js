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
import { backend } from '../backend.js';
import { chromaKeyAll } from '../util/chromaKey.js';
import { ASSETS, ASSET_ROLES } from '../config/Assets.js';

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
      if (backend.connected) {
        backend.send('room:create', { title: prompt ?? 'untitled task' });
      } else {
        this.spawnRoomFromPrompt(prompt ?? 'untitled task');
      }
    });

    this.setupCameraPan();
    this.setupPinchZoom();
    startMockActivityLoop(this);

    // Backend-driven room sync — shared handler for both cached and live events
    const applyRoomsSync = (backendRooms) => {
      for (const r of backendRooms) {
        if (!this.rooms.find((x) => x.roomId === r.id)) {
          this._spawnRoom({
            roomId: r.id,
            prompt: r.title,
            roomType: r.roomType,
            characterIndex: r.characterIndex,
            linearIdentifier: r.linearIdentifier,
            linearState: r.linearState,
          });
        }
      }
    };

    window.addEventListener('backend:rooms:sync', (e) => {
      applyRoomsSync(e.detail?.rooms ?? []);
    });

    window.addEventListener('backend:room:created', (e) => {
      const r = e.detail;
      if (r && !this.rooms.find((x) => x.roomId === r.id)) {
        this._spawnRoom({
          roomId: r.id,
          prompt: r.title,
          roomType: r.roomType,
          characterIndex: r.characterIndex,
          linearIdentifier: r.linearIdentifier,
          linearState: r.linearState,
        });
      }
    });

    window.addEventListener('backend:room:updated', (e) => {
      const r = e.detail;
      if (!r) return;
      const room = this.rooms.find((x) => x.roomId === r.id);
      if (!room) return;
      if (r.linearState !== undefined) room.linearState = r.linearState;
      if (r.linearIdentifier !== undefined) room.linearIdentifier = r.linearIdentifier;
      if (room.agent) {
        room.agent.setAgentState?.(r.agentState);
      }
    });

    window.addEventListener('backend:room:removed', (e) => {
      const id = e.detail?.id;
      const idx = this.rooms.findIndex((x) => x.roomId === id);
      if (idx !== -1) this.rooms.splice(idx, 1);
    });

    // On (re)connect, request a fresh room list
    window.addEventListener('backend:connected', () => {
      backend.send('rooms:request', {});
    });

    // Apply any rooms:sync that arrived while Phaser was still loading assets.
    // The backend.js caches the last sync payload so we don't miss it.
    if (backend.lastRoomsSync) {
      applyRoomsSync(backend.lastRoomsSync.rooms ?? []);
    } else if (backend.connected) {
      backend.send('rooms:request', {});
    }

    // Fallback: load from localStorage when backend is not available at all
    if (!backend.connected && !backend.lastRoomsSync) {
      const saved = loadState();
      for (const r of saved.rooms) {
        this._spawnRoom({
          prompt: r.prompt,
          roomType: r.roomType,
          characterIndex: r.characterIndex,
          roomId: r.roomId,
        });
      }
    }
  }

  setupCameraPan() {
    this.panKeys = this.input.keyboard.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT');
    this.dragState = null;
    // Movement threshold to count as a drag (squared, in CSS px). A press
    // that moves less than ~5px is treated as a click; more than that
    // suppresses the floor-tile pointerup → terminal open.
    const DRAG_THRESHOLD_SQ = 25;

    this.input.on('pointerdown', (pointer, currentlyOver) => {
      // Block drag-pan only when a non-floor interactive was hit.
      const blocksDrag = currentlyOver.some(o => o.kind && o.kind !== 'floor');
      if (blocksDrag) return;
      this.tweens.killTweensOf(this.worldContainer);
      this.dragState = {
        startPointer: { x: pointer.x, y: pointer.y },
        startContainer: { x: this.worldContainer.x, y: this.worldContainer.y },
        dragged: false,
      };
    });

    this.input.on('pointermove', (pointer) => {
      if (!this.dragState) return;
      const dx = pointer.x - this.dragState.startPointer.x;
      const dy = pointer.y - this.dragState.startPointer.y;
      if (!this.dragState.dragged && (dx * dx + dy * dy) > DRAG_THRESHOLD_SQ) {
        this.dragState.dragged = true;
      }
      this.worldContainer.x = this.dragState.startContainer.x + dx;
      this.worldContainer.y = this.dragState.startContainer.y + dy;
      this.worldContainer.__panX = this.worldContainer.x - this.cameras.main.centerX;
      this.worldContainer.__panY = this.worldContainer.y - ISO.WORLD_ORIGIN_Y;
    });

    // Clear dragState AFTER GameObject pointerup handlers fire so they can
    // inspect this.dragState?.dragged to distinguish click vs drag. We
    // schedule the clear via setTimeout 0 so it runs in the next microtask.
    const endDrag = () => {
      const finished = this.dragState;
      // Keep a brief reference on the scene so floor pointerup (which runs
      // synchronously BEFORE this scene-level handler? actually order varies)
      // can still see it. Phaser fires GameObject events first, then the
      // input-plugin scene event — so by the time endDrag runs, the floor's
      // pointerup has already inspected dragState.
      this.dragState = null;
      // Stash for any post-frame consumer (debug).
      this.lastDrag = finished;
    };
    this.input.on('pointerup', endDrag);
    this.input.on('pointerupoutside', endDrag);
  }

  // Floor tiles call this on pointerup. Suppress the click if the press
  // turned into a drag (dragState.dragged was set during pointermove).
  handleRoomFloorClick(roomId) {
    if (this.dragState?.dragged) return;
    this.openTerminalForRoom(roomId);
  }

  // Two-finger pinch on macOS trackpad / Ctrl+wheel on desktop browsers.
  // The browser surfaces pinch gestures as a wheel event with ctrlKey=true,
  // so we listen for that and scale the worldContainer around the pointer.
  setupPinchZoom() {
    this.zoom = 1;
    const MIN_ZOOM = 0.4;
    const MAX_ZOOM = 2.5;

    const onWheel = (e) => {
      // Only zoom on pinch (browser maps trackpad pinch → ctrl+wheel).
      if (!e.ctrlKey) return;
      e.preventDefault();

      const rect = this.game.canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;

      const oldZoom = this.zoom;
      // Exponential scaling so equal pinch deltas feel consistent. Trackpad
      // deltaY is small (~1-10), mouse wheel with ctrl is ~100, so a single
      // coefficient handles both.
      const factor = Math.exp(-e.deltaY * 0.01);
      const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, oldZoom * factor));
      if (newZoom === oldZoom) return;

      // Zoom around the pointer: keep the world point under the pointer
      // anchored while scale changes.
      const ratio = newZoom / oldZoom;
      this.worldContainer.x = px - (px - this.worldContainer.x) * ratio;
      this.worldContainer.y = py - (py - this.worldContainer.y) * ratio;
      this.worldContainer.setScale(newZoom);
      this.zoom = newZoom;
      // Keep pan tracking accurate under zoom.
      this.worldContainer.__panX = this.worldContainer.x - this.cameras.main.centerX;
      this.worldContainer.__panY = this.worldContainer.y - ISO.WORLD_ORIGIN_Y;
    };

    // Attach directly to the canvas so we can preventDefault (which Phaser's
    // input system doesn't expose). passive:false is required for that.
    this.game.canvas.addEventListener('wheel', onWheel, { passive: false });
  }

  openTerminalForRoom(roomId) {
    const room = this.rooms.find(r => r.roomId === roomId);
    if (!room?.desk) return;
    this.selectDesk(room.desk);
  }

  selectDesk(desk) {
    const room = this.rooms.find((r) => r.desk === desk);
    if (!room) return;
    const meta = this.roomTypeMeta(room.roomType);

    this.tweens.killTweensOf(this.worldContainer);

    // Push the focused room further left (FOCUS_X_OFFSET) and down
    // (FOCUS_Y_OFFSET) so it lands slightly off-center, giving headroom on
    // the top and right (where the slide-over terminal opens). Multiply
    // desk.x/y by current zoom — under zoom, the desk's screen position is
    // container.x + desk.x * zoom.
    const z = this.zoom ?? 1;
    const targetX = this.cameras.main.centerX - desk.x * z - ISO.PANEL_OFFSET_PX - ISO.FOCUS_X_OFFSET;
    const targetY = ISO.WORLD_ORIGIN_Y - desk.y * z + ISO.FOCUS_Y_OFFSET;

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
      roomType: room.roomType,
      label: meta.label,
      prompt: room.prompt,
    };
    this.events.emit('room:selected', payload);
    window.dispatchEvent(new CustomEvent('agentoffice:room-selected', { detail: payload }));
  }

  spawnRoomFromPrompt(prompt) {
    const roomType = classifyPrompt(prompt);
    const room = this._spawnRoom({ prompt, roomType });
    this._persist();
    return room;
  }

  // Decorative G-Brain landmark at the world origin. No state plumbing —
  // purely visual: floating sprite, soft glow, drop shadow, and a label.
  spawnGBrainCore() {
    const p = this.gridToScreen(0, 0);
    p.x -= 32;
    p.y -= 56;

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

  _spawnRoom({ prompt, roomType, characterIndex, roomId, linearIdentifier, linearState }) {
    const index = this.roomCounter++;
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
    if (linearIdentifier) room.linearIdentifier = linearIdentifier;
    if (linearState) room.linearState = linearState;
    spawnAgent(this, { room, characterIndex });
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

    // Two-level depth sort:
    //   1) BETWEEN rooms — each room gets a base = roomY * ROOM_STRIDE so a
    //      visually-closer room (higher front-tile y) draws ENTIRELY on top
    //      of any further-back room. Without this, a back room's furniture
    //      (band 2000+) would draw over a front room's walls (band 1000+).
    //   2) WITHIN a room — layer bands (floor → wall → furniture → agent),
    //      with sortY breaking ties inside each band.
    //
    // Non-room renderables (backdrop / scenery / fx) use their own depths
    // outside the room band range.
    const ROOM_STRIDE = 100;
    for (const obj of this.renderableList) {
      switch (obj.kind) {
        case 'backdrop':     obj.depth = -1e6; continue;
        case 'scenery':      obj.depth = -5e5 + (obj.__sceneryY ?? obj.y); continue;
        case 'gbrain':       obj.depth =  2500 + (obj.__sortY ?? obj.y); continue;
        case 'fx':           obj.depth =  1e7 + obj.y; continue;
      }
      // Room layer bias (relative to that room's band).
      let bias = 0;
      switch (obj.kind) {
        case 'floor':        bias =    0; break;
        case 'floor-accent': bias =  100; break;
        case 'wall':         bias = 1000; break;
        case 'furniture':    bias = 2000; break;
        case 'desk':         bias = 2100; break;
        case 'agent':        bias = 3000; break;
      }
      const roomY  = obj.__roomY ?? 0;
      const sortY  = obj.__sortY ?? obj.y;
      // Within-room relative y for fine ordering (small range, ~ -100..+100).
      const localY = sortY - roomY;
      obj.depth = roomY * ROOM_STRIDE + bias + localY;
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
