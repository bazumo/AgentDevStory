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
import { loadState, saveState } from '../util/persistence.js';
import { chromaKeyAll } from '../util/chromaKey.js';

const FURNITURE_KEYS = ['desk', 'chair', 'laptop', 'server_rack', 'plant', 'whiteboard'];

export class AgencyFloorScene extends Phaser.Scene {
  constructor() {
    super({ key: 'AgencyFloorScene' });
  }

  preload() {
    for (const key of FURNITURE_KEYS) {
      this.load.image(key, `assets/web_office/${key}.png`);
    }
    for (let i = 1; i <= CHARACTER_COUNT; i++) {
      const idx = String(i).padStart(2, '0');
      this.load.image(
        characterTextureKey(i, 'idle', 'front'),
        `assets/characters/character-${idx}/idle-front.png`,
      );
    }
  }

  create() {
    const preloadedKeys = [...FURNITURE_KEYS];
    for (let i = 1; i <= CHARACTER_COUNT; i++) {
      preloadedKeys.push(characterTextureKey(i, 'idle', 'front'));
    }
    chromaKeyAll(this, preloadedKeys);

    this.renderableList = [];
    this.rooms = [];
    this.roomCounter = 0;

    this.worldContainer = this.add.container(
      this.cameras.main.centerX,
      ISO.WORLD_ORIGIN_Y,
    );
    this.worldContainer.__panX = 0;
    this.worldContainer.__panY = 0;

    this.drawDebugAnchor();

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
      if (currentlyOver.length > 0) return;
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

    for (const obj of this.renderableList) {
      let bias = 0;
      switch (obj.kind) {
        case 'wall':         bias = -6; break;
        case 'floor':        bias =  0; break;
        case 'floor-accent': bias =  1; break;
        case 'furniture':    bias =  2; break;
        case 'desk':         bias =  3; break;
        case 'agent':        bias =  5; break;
        case 'fx':           bias = 1000; break;
        default:             bias = 0;
      }
      obj.depth = obj.y + bias;
    }
    this.worldContainer.sort('depth');
  }

  gridToScreen(row, col) {
    return {
      x: (col - row) * (ISO.TILE_WIDTH / 2),
      y: (col + row) * (ISO.TILE_HEIGHT / 2),
    };
  }

  drawDebugAnchor() {
    const dot = this.add.circle(0, 0, 4, 0xff0044);
    this.worldContainer.add(dot);
  }

  roomTypeMeta(type) {
    return ROOM_TYPES[type] ?? ROOM_TYPES.forge;
  }
}
