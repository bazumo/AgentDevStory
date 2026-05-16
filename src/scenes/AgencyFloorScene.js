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

export class AgencyFloorScene extends Phaser.Scene {
  constructor() {
    super({ key: 'AgencyFloorScene' });
  }

  preload() {
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

    this.scale.on('resize', (gameSize) => {
      this.worldContainer.x = gameSize.width / 2 + this.worldContainer.__panX;
    });

    window.addEventListener('agentoffice:new-task', (e) => {
      const { prompt } = e.detail ?? {};
      this.spawnRoomFromPrompt(prompt ?? 'untitled task');
    });

    this.setupCameraPan();
    startMockActivityLoop(this);

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

  _spawnRoom({ prompt, roomType, characterIndex, roomId }) {
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
