import Phaser from 'phaser';
import { ISO } from '../config/IsoConfig.js';
import { ROOM_TYPES } from '../config/RoomTypes.js';

const WALL_HEIGHT = ISO.WALL_HEIGHT_PX;
const WALL_TOP_BAND = 3;

const FLOOR_BASE = 0x1c232c;
const WALL_LEFT_BASE = 0x2a3340;
const WALL_RIGHT_BASE = 0x323b48;

function diamondPoints() {
  const hw = ISO.TILE_WIDTH / 2;
  const hh = ISO.TILE_HEIGHT / 2;
  return [0, -hh, hw, 0, 0, hh, -hw, 0];
}

function neWallPoints() {
  const hw = ISO.TILE_WIDTH / 2;
  const hh = ISO.TILE_HEIGHT / 2;
  return [0, -hh, hw, 0, hw, -WALL_HEIGHT, 0, -hh - WALL_HEIGHT];
}

function neWallTopBand() {
  const hw = ISO.TILE_WIDTH / 2;
  const hh = ISO.TILE_HEIGHT / 2;
  return [hw, -WALL_HEIGHT, 0, -hh - WALL_HEIGHT, 0, -hh - WALL_HEIGHT + WALL_TOP_BAND, hw, -WALL_HEIGHT + WALL_TOP_BAND];
}

function nwWallPoints() {
  const hw = ISO.TILE_WIDTH / 2;
  const hh = ISO.TILE_HEIGHT / 2;
  return [0, -hh, -hw, 0, -hw, -WALL_HEIGHT, 0, -hh - WALL_HEIGHT];
}

function nwWallTopBand() {
  const hw = ISO.TILE_WIDTH / 2;
  const hh = ISO.TILE_HEIGHT / 2;
  return [-hw, -WALL_HEIGHT, 0, -hh - WALL_HEIGHT, 0, -hh - WALL_HEIGHT + WALL_TOP_BAND, -hw, -WALL_HEIGHT + WALL_TOP_BAND];
}

function mixColor(a, b, t) {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  return (Math.round(ar + (br - ar) * t) << 16)
       | (Math.round(ag + (bg - ag) * t) << 8)
       |  Math.round(ab + (bb - ab) * t);
}

// The web_office atlas keys are scrambled vs the actual art:
//   atlas 'laptop'      -> CRT desktop computer
//   atlas 'plant'       -> wooden bookshelf w/ books
//   atlas 'server_rack' -> small potted plant
// These aliases let the decorators read naturally.
const ART = {
  desk:       'desk',
  chair:      'chair',
  computer:   'laptop',
  bookshelf:  'plant',
  plant:      'server_rack',
  whiteboard: 'whiteboard',
};

export function spawnOfficeRoom(scene, { roomId, macroCoords, roomType }) {
  const meta = ROOM_TYPES[roomType] ?? ROOM_TYPES.forge;
  const created = [];

  const floorShadeA = mixColor(FLOOR_BASE, meta.tint, 0.10);
  const floorShadeB = mixColor(FLOOR_BASE, meta.tint, 0.22);
  const wallLeftTint  = mixColor(WALL_LEFT_BASE,  meta.tint, 0.08);
  const wallRightTint = mixColor(WALL_RIGHT_BASE, meta.tint, 0.08);
  const accentTop = meta.tint;
  const gridLine = mixColor(meta.tint, 0x000000, 0.55);

  let deskRef = null;

  // ---- Floor + walls ----
  for (let r = 0; r < ISO.ROOM_SIZE; r++) {
    for (let c = 0; c < ISO.ROOM_SIZE; c++) {
      const globalRow = macroCoords.macroRow + r;
      const globalCol = macroCoords.macroCol + c;
      const { x: sx, y: sy } = scene.gridToScreen(globalRow, globalCol);

      const floorTint = (r + c) % 2 === 0 ? floorShadeA : floorShadeB;
      const floor = scene.add.polygon(sx, sy, diamondPoints(), floorTint, 1);
      floor.setStrokeStyle(1, gridLine, 0.35);
      floor.kind = 'floor';
      floor.tileR = r;
      floor.tileC = c;
      scene.worldContainer.add(floor);
      created.push(floor);

      if (r === 0) {
        const wall = scene.add.polygon(sx, sy, neWallPoints(), wallRightTint, 1);
        wall.kind = 'wall';
        scene.worldContainer.add(wall);
        created.push(wall);
        const band = scene.add.polygon(sx, sy, neWallTopBand(), accentTop, 0.95);
        band.kind = 'wall';
        scene.worldContainer.add(band);
        created.push(band);
      }
      if (c === 0) {
        const wall = scene.add.polygon(sx, sy, nwWallPoints(), wallLeftTint, 1);
        wall.kind = 'wall';
        scene.worldContainer.add(wall);
        created.push(wall);
        const band = scene.add.polygon(sx, sy, nwWallTopBand(), accentTop, 0.95);
        band.kind = 'wall';
        scene.worldContainer.add(band);
        created.push(band);
      }
    }
  }

  // ---- Type-specific decoration ----
  const ctx = { scene, macroCoords, meta, created };
  const layout = DECORATORS[roomType] ?? DECORATORS.forge;
  const decResult = layout(ctx);
  deskRef = decResult.primaryDesk;

  // Make primary desk interactive for click-to-center
  if (deskRef) {
    deskRef.kind = 'desk';
    deskRef.roomId = roomId;
    deskRef.roomType = roomType;
    deskRef.setInteractive({ useHandCursor: true });
    deskRef.on('pointerdown', () => scene.selectDesk(deskRef));
  }

  scene.renderableList.push(...created);
  flashRoomSpawn(scene, created, meta);

  return { roomId, roomType, macroCoords, desk: deskRef, members: created };
}

// ---- Sprite/decor helpers ----

function placeFurniture(ctx, key, r, c, opts = {}) {
  const { scene, macroCoords, created } = ctx;
  const { x: sx, y: sy } = scene.gridToScreen(macroCoords.macroRow + r, macroCoords.macroCol + c);
  const sprite = scene.add.image(sx, sy + (opts.yNudge ?? 0), key);
  sprite.setOrigin(0.5, 1);
  sprite.setScale(opts.scale ?? 0.7);
  sprite.kind = opts.kind ?? 'furniture';
  scene.worldContainer.add(sprite);
  created.push(sprite);
  return sprite;
}

function placeWorkstation(ctx, r, c, options = {}) {
  const items = [];
  if (options.chair !== false) {
    const chair = placeFurniture(ctx, ART.chair, r - 1, c, { scale: 0.55 });
    chair.__role = 'chair';
    items.push(chair);
  }
  const desk = placeFurniture(ctx, ART.desk, r, c, { scale: 0.85 });
  desk.__role = 'desk';
  items.push(desk);
  const computer = placeFurniture(ctx, ART.computer, r, c, { scale: 0.55, yNudge: -16 });
  computer.__role = 'computer';
  items.push(computer);
  return { chair: items[0], desk, computer, items };
}

function placeFloorAccent(ctx, r, c, color, alpha = 0.5) {
  const { scene, macroCoords, created } = ctx;
  const { x: sx, y: sy } = scene.gridToScreen(macroCoords.macroRow + r, macroCoords.macroCol + c);
  const hw = ISO.TILE_WIDTH / 2 - 2;
  const hh = ISO.TILE_HEIGHT / 2 - 1;
  const accent = scene.add.polygon(sx, sy, [0, -hh, hw, 0, 0, hh, -hw, 0], color, alpha);
  accent.kind = 'floor-accent';
  scene.worldContainer.add(accent);
  created.push(accent);
  return accent;
}

// ---- Decorators ----

const DECORATORS = {
  // 🏭 THE FORGE — feature building / coding. Tech-dense workshop vibe.
  forge(ctx) {
    placeFloorAccent(ctx, 0, 2, ctx.meta.tint, 0.18);
    placeFloorAccent(ctx, 2, 0, ctx.meta.tint, 0.18);
    placeFloorAccent(ctx, 2, 4, ctx.meta.tint, 0.18);
    placeFloorAccent(ctx, 4, 2, ctx.meta.tint, 0.18);

    // Row of computers along the back wall — "matrix monitors"
    placeFurniture(ctx, ART.computer, 0, 1, { scale: 0.7 });
    placeFurniture(ctx, ART.computer, 0, 3, { scale: 0.7 });
    placeFurniture(ctx, ART.computer, 0, 4, { scale: 0.7 });
    // Code reference shelf
    placeFurniture(ctx, ART.bookshelf, 1, 0, { scale: 0.85 });
    // A small plant for life
    placeFurniture(ctx, ART.plant, 4, 0, { scale: 0.6 });

    // Primary + secondary workstations
    const main = placeWorkstation(ctx, 2, 2);
    placeWorkstation(ctx, 3, 4);
    return { primaryDesk: main.desk };
  },

  // 🚨 THE WAR ROOM — debugging. Dim monitors, red alarm accents.
  warroom(ctx) {
    placeFloorAccent(ctx, 2, 2, 0xff2233, 0.22);
    placeFloorAccent(ctx, 0, 0, 0xff2233, 0.30);
    placeFloorAccent(ctx, 4, 4, 0xff2233, 0.30);
    placeFloorAccent(ctx, 0, 4, 0xff2233, 0.25);
    placeFloorAccent(ctx, 4, 0, 0xff2233, 0.25);

    // Wall of monitors
    placeFurniture(ctx, ART.computer, 0, 1, { scale: 0.7 });
    placeFurniture(ctx, ART.computer, 0, 2, { scale: 0.7 });
    placeFurniture(ctx, ART.computer, 0, 3, { scale: 0.7 });
    placeFurniture(ctx, ART.computer, 0, 4, { scale: 0.7 });
    // Reference manuals on the west wall
    placeFurniture(ctx, ART.bookshelf, 1, 0, { scale: 0.85 });
    placeFurniture(ctx, ART.bookshelf, 3, 0, { scale: 0.85 });

    const main = placeWorkstation(ctx, 2, 2);
    return { primaryDesk: main.desk };
  },

  // 📐 THE BLUEPRINT LAB — architecture/schemas. Whiteboards everywhere.
  blueprint(ctx) {
    placeFloorAccent(ctx, 2, 1, ctx.meta.tint, 0.18);
    placeFloorAccent(ctx, 2, 3, ctx.meta.tint, 0.18);
    placeFloorAccent(ctx, 1, 2, ctx.meta.tint, 0.18);
    placeFloorAccent(ctx, 3, 2, ctx.meta.tint, 0.18);

    placeFurniture(ctx, ART.whiteboard, 0, 1, { scale: 0.95 });
    placeFurniture(ctx, ART.whiteboard, 0, 3, { scale: 0.95 });
    placeFurniture(ctx, ART.whiteboard, 1, 0, { scale: 0.95 });
    placeFurniture(ctx, ART.whiteboard, 3, 0, { scale: 0.95 });

    placeFurniture(ctx, ART.bookshelf, 4, 0, { scale: 0.8 });
    placeFurniture(ctx, ART.plant,     4, 4, { scale: 0.55 });

    const main = placeWorkstation(ctx, 2, 2);
    placeWorkstation(ctx, 3, 3, { chair: false });
    return { primaryDesk: main.desk };
  },

  // 📚 THE LOUNGE — docs/READMEs. Library + plants.
  lounge(ctx) {
    placeFloorAccent(ctx, 4, 2, 0xff9966, 0.20);
    placeFloorAccent(ctx, 2, 4, 0xff9966, 0.20);

    // Wall-to-wall bookshelves
    placeFurniture(ctx, ART.bookshelf, 0, 1, { scale: 0.9 });
    placeFurniture(ctx, ART.bookshelf, 0, 2, { scale: 0.9 });
    placeFurniture(ctx, ART.bookshelf, 0, 3, { scale: 0.9 });
    placeFurniture(ctx, ART.bookshelf, 0, 4, { scale: 0.9 });
    placeFurniture(ctx, ART.bookshelf, 1, 0, { scale: 0.9 });
    placeFurniture(ctx, ART.bookshelf, 3, 0, { scale: 0.9 });

    // Plants in corners + along inner edges
    placeFurniture(ctx, ART.plant, 4, 4, { scale: 0.7 });
    placeFurniture(ctx, ART.plant, 4, 0, { scale: 0.7 });
    placeFurniture(ctx, ART.plant, 4, 1, { scale: 0.55 });

    // Writing workstation
    const main = placeWorkstation(ctx, 2, 2);
    return { primaryDesk: main.desk };
  },
};

// ---- Spawn flash effect ----

function flashRoomSpawn(scene, objects, meta) {
  const floors = objects.filter(o => o.kind === 'floor');
  if (!floors.length) return;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const f of floors) {
    if (f.x < minX) minX = f.x;
    if (f.x > maxX) maxX = f.x;
    if (f.y < minY) minY = f.y;
    if (f.y > maxY) maxY = f.y;
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const halo = scene.add.circle(cx, cy, 18, meta.tint, 0.55);
  halo.kind = 'fx';
  scene.worldContainer.add(halo);
  scene.tweens.add({
    targets: halo,
    radius: 150,
    alpha: 0,
    duration: 700,
    ease: 'Quad.easeOut',
    onComplete: () => halo.destroy(),
  });
}

void Phaser;
