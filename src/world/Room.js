import Phaser from 'phaser';
import { ISO } from '../config/IsoConfig.js';
import { ROOM_TYPES } from '../config/RoomTypes.js';
import { ASSETS, assetKey, assetProps } from '../config/Assets.js';
import { layoutFor } from './RoomLayouts.js';

const WALL_HEIGHT = ISO.WALL_HEIGHT_PX;
const WALL_TOP_BAND = 3;
const WALL_TOP_THICKNESS = 4;   // iso "depth" of the wall — used to render a top face

// Neutral interior palette — every room shares it. Room type is communicated
// through (a) the wall top accent stripe (faint meta.tint) and (b) the asset
// composition placed by RoomLayouts.
const FLOOR_A     = 0x8a6b48;   // warm wood
const FLOOR_B     = 0x755838;   // wood plank shadow
const WALL_LEFT   = 0x4a4f57;   // gray
const WALL_RIGHT  = 0x575c64;   // slightly lighter gray
const WALL_TOP    = 0x6b7079;   // top face of the wall (iso "thickness")
const FLOOR_GRID  = 0x3d2e1d;   // thin floor grid line

function diamondPoints() {
  const hw = ISO.TILE_WIDTH / 2;
  const hh = ISO.TILE_HEIGHT / 2;
  return [0, -hh, hw, 0, 0, hh, -hw, 0];
}

// Build the polygon-shaped hit area for floor tiles so clicks only register
// inside the diamond, not in the rectangular bounding box.
function makeDiamondHitArea() {
  const hw = ISO.TILE_WIDTH / 2;
  const hh = ISO.TILE_HEIGHT / 2;
  return new Phaser.Geom.Polygon([0, -hh, hw, 0, 0, hh, -hw, 0]);
}
const diamondHitTest = Phaser.Geom.Polygon.Contains;

// --- Wall geometry --------------------------------------------------------
// The wall sits AT the back edge of its tile. To give it real iso "thickness"
// we render three polygons per wall: the outer face (visible to camera), the
// top cap (a thin parallelogram showing the wall's thickness), and a faint
// accent stripe at the very top.
//
// NE wall base runs along the tile's NE diagonal (N→E corners), with the wall
// extending UP from there. The +1px "lean" on the base shifts the wall visually
// down/left so it reads as sitting AT the floor edge, not floating above it.

function neWallOuter() {
  const hw = ISO.TILE_WIDTH / 2;
  const hh = ISO.TILE_HEIGHT / 2;
  return [
    0,  -hh + 2,           // bottom-left (2px into floor to cover any AA halo)
    hw,  2,                // bottom-right (2px into floor)
    hw, -WALL_HEIGHT,      // top-right
    0,  -hh - WALL_HEIGHT, // top-left
  ];
}

// Top "cap" of the NE wall — a thin parallelogram laying flat on top of the
// wall, projected iso-style. Gives the wall visible thickness.
function neWallTopCap() {
  const hw = ISO.TILE_WIDTH / 2;
  const hh = ISO.TILE_HEIGHT / 2;
  const dx = WALL_TOP_THICKNESS * 1;
  const dy = WALL_TOP_THICKNESS * 0.5;
  return [
    0,  -hh - WALL_HEIGHT,
    hw, -WALL_HEIGHT,
    hw + dx, -WALL_HEIGHT - dy,
    dx, -hh - WALL_HEIGHT - dy,
  ];
}

function neWallTopBand() {
  const hw = ISO.TILE_WIDTH / 2;
  const hh = ISO.TILE_HEIGHT / 2;
  return [
    hw, -WALL_HEIGHT,
    0,  -hh - WALL_HEIGHT,
    0,  -hh - WALL_HEIGHT + WALL_TOP_BAND,
    hw, -WALL_HEIGHT + WALL_TOP_BAND,
  ];
}

function nwWallOuter() {
  const hw = ISO.TILE_WIDTH / 2;
  const hh = ISO.TILE_HEIGHT / 2;
  return [
    0,   -hh + 2,
   -hw,   2,
   -hw,  -WALL_HEIGHT,
    0,   -hh - WALL_HEIGHT,
  ];
}

function nwWallTopCap() {
  const hw = ISO.TILE_WIDTH / 2;
  const hh = ISO.TILE_HEIGHT / 2;
  const dx = WALL_TOP_THICKNESS * 1;
  const dy = WALL_TOP_THICKNESS * 0.5;
  return [
    0,   -hh - WALL_HEIGHT,
   -hw,  -WALL_HEIGHT,
   -hw - dx, -WALL_HEIGHT - dy,
   -dx,  -hh - WALL_HEIGHT - dy,
  ];
}

function nwWallTopBand() {
  const hw = ISO.TILE_WIDTH / 2;
  const hh = ISO.TILE_HEIGHT / 2;
  return [
   -hw, -WALL_HEIGHT,
    0,  -hh - WALL_HEIGHT,
    0,  -hh - WALL_HEIGHT + WALL_TOP_BAND,
   -hw, -WALL_HEIGHT + WALL_TOP_BAND,
  ];
}

// --- Spawn ----------------------------------------------------------------

export function spawnOfficeRoom(scene, { roomId, macroCoords, roomType }) {
  const meta = ROOM_TYPES[roomType] ?? ROOM_TYPES.forge;
  const layout = layoutFor(roomType);
  const created = [];

  // +1 shift so the room sits inside its 6×6 block; the lane intersection
  // at macroRow/macroCol stays as a visible plaza tile.
  const base = {
    macroRow: macroCoords.macroRow + 1,
    macroCol: macroCoords.macroCol + 1,
  };

  const roomBounds = {
    minR: base.macroRow,
    maxR: base.macroRow + ISO.ROOM_SIZE - 1,
    minC: base.macroCol,
    maxC: base.macroCol + ISO.ROOM_SIZE - 1,
  };
  clearSceneryIn(scene, roomBounds);

  const accentTop = meta.tint;

  // ---- Floor tiles ----
  for (let r = 0; r < ISO.ROOM_SIZE; r++) {
    for (let c = 0; c < ISO.ROOM_SIZE; c++) {
      const globalRow = base.macroRow + r;
      const globalCol = base.macroCol + c;
      const { x: sx, y: sy } = scene.gridToScreen(globalRow, globalCol);

      const tint = (r + c) % 2 === 0 ? FLOOR_A : FLOOR_B;
      const floor = scene.add.polygon(sx, sy, diamondPoints(), tint, 1);
      // No stroke — its AA halo creates the visible 1px gap at the wall seam.
      floor.kind = 'floor';
      floor.tileR = r;
      floor.tileC = c;
      floor.roomId = roomId;
      // Each floor tile is interactive — clicking ANY tile opens the room's
      // terminal. pointerup only fires when the pointer is released over the
      // same tile (minimal drag), so big drags become camera pans instead.
      floor.setInteractive({ useHandCursor: true, hitArea: makeDiamondHitArea(), hitAreaCallback: diamondHitTest });
      // Suppress the click if the press turned into a drag.
      floor.on('pointerup', () => scene.handleRoomFloorClick(roomId));
      scene.worldContainer.add(floor);
      created.push(floor);
    }
  }

  // ---- Walls (only on back row r=0 and back col c=0) ----
  for (let r = 0; r < ISO.ROOM_SIZE; r++) {
    for (let c = 0; c < ISO.ROOM_SIZE; c++) {
      if (r !== 0 && c !== 0) continue;
      const { x: sx, y: sy } = scene.gridToScreen(base.macroRow + r, base.macroCol + c);

      if (r === 0) {
        addWallTriplet(scene, created, sx, sy, neWallOuter(), neWallTopCap(), neWallTopBand(), WALL_RIGHT, accentTop);
      }
      if (c === 0) {
        addWallTriplet(scene, created, sx, sy, nwWallOuter(), nwWallTopCap(), nwWallTopBand(), WALL_LEFT, accentTop);
      }
    }
  }

  // ---- Floor accents (faint tinted overlays) ----
  for (const a of layout.accents ?? []) {
    const [r, c] = a.tile;
    const { x: sx, y: sy } = scene.gridToScreen(base.macroRow + r, base.macroCol + c);
    const color = a.color === 'tint' || a.color === undefined ? meta.tint : a.color;
    const inset = scene.add.polygon(sx, sy, diamondPoints(), color, a.alpha ?? 0.18);
    inset.kind = 'floor-accent';
    scene.worldContainer.add(inset);
    created.push(inset);
  }

  // ---- Build tile matrix + place items from grid ----
  // tiles[r][c] = { asset, walkable, sprite }
  // Walls auto-mark r=0 / c=0 as non-walkable.
  const tiles = [];
  for (let r = 0; r < ISO.ROOM_SIZE; r++) {
    tiles[r] = [];
    for (let c = 0; c < ISO.ROOM_SIZE; c++) {
      const onWall = (r === 0 || c === 0);
      tiles[r][c] = { asset: null, walkable: !onWall, sprite: null };
    }
  }

  let primaryDesk = null;
  const grid = layout.grid ?? [];
  const primaryR = layout.primary?.[0];
  const primaryC = layout.primary?.[1];
  for (let r = 0; r < ISO.ROOM_SIZE; r++) {
    const row = grid[r] ?? [];
    for (let c = 0; c < ISO.ROOM_SIZE; c++) {
      const role = row[c];
      if (!role) continue;
      const props = assetProps(role);
      const isPrimary = (r === primaryR && c === primaryC);
      const sprite = placeItem(scene, base, {
        role,
        tile: [r, c],
        scale: props.scale,
        offsetX: props.offsetX ?? 0,
        offsetY: props.offsetY ?? 0,
        primaryDesk: isPrimary,
      });
      if (!sprite) continue;
      created.push(sprite);
      tiles[r][c].asset = role;
      tiles[r][c].walkable = props.walkable;  // already false if wall row/col
      tiles[r][c].sprite = sprite;
      if (isPrimary) primaryDesk = sprite;
    }
  }

  if (primaryDesk) {
    primaryDesk.kind = 'desk';
    primaryDesk.roomId = roomId;
    primaryDesk.roomType = roomType;
    // Click handling is now done by the floor tiles — the entire room is
    // a click target, so we no longer need a special desk handler.
  }

  // Per-room back-to-front sort key: the front-most tile's screen y.
  // Every object created here is tagged with this so depth sort can place
  // entire rooms in iso order regardless of layer bands.
  const frontCorner = scene.gridToScreen(
    base.macroRow + ISO.ROOM_SIZE - 1,
    base.macroCol + ISO.ROOM_SIZE - 1,
  );
  const roomY = frontCorner.y;
  for (const obj of created) obj.__roomY = roomY;

  scene.renderableList.push(...created);
  flashRoomSpawn(scene, created, meta);

  return { roomId, roomType, macroCoords, desk: primaryDesk, members: created, tiles, base, roomY };
}

function addWallTriplet(scene, created, sx, sy, outerPts, capPts, bandPts, bodyColor, accentColor) {
  // Walls render shifted by a QUARTER tile down-left of their anchoring tile.
  // We move the polygon's POSITION (not the geometry) and pin __sortY to the
  // original tile-center sy so depth sort still treats the wall as belonging
  // to its source tile (back-row furniture remains in front of it).
  const wx = sx - ISO.TILE_WIDTH / 4;
  const wy = sy + ISO.TILE_HEIGHT / 4;

  const outer = scene.add.polygon(wx, wy, outerPts, bodyColor, 1);
  outer.kind = 'wall';
  outer.__sortY = sy;
  scene.worldContainer.add(outer);
  created.push(outer);

  const cap = scene.add.polygon(wx, wy, capPts, WALL_TOP, 1);
  cap.kind = 'wall';
  cap.__sortY = sy;
  scene.worldContainer.add(cap);
  created.push(cap);

  const band = scene.add.polygon(wx, wy, bandPts, accentColor, 0.95);
  band.kind = 'wall';
  band.__sortY = sy;
  scene.worldContainer.add(band);
  created.push(band);
}

function placeItem(scene, base, item) {
  const [r, c] = item.tile;
  const key = assetKey(item.role);
  if (!scene.textures.exists(key)) {
    console.warn(`[Room] missing texture for role "${item.role}" (key="${key}")`);
    return null;
  }
  const { x: sx, y: sy } = scene.gridToScreen(base.macroRow + r, base.macroCol + c);
  // Asset offset (independent of walls). __sortY stays pinned to tile-center sy.
  const wx = sx - (ISO.TILE_WIDTH * 8) / 16 + (item.offsetX ?? 0);  // -32px left + per-asset offset
  const wy = sy - (ISO.TILE_HEIGHT * 1) / 8 + (item.offsetY ?? 0);  // -4px up + per-asset offset
  const sprite = scene.add.image(wx, wy, key);
  sprite.setOrigin(0.5, 1);
  sprite.setScale(item.scale ?? 0.7);
  sprite.kind = 'furniture';
  sprite.__sortY = sy;
  sprite.__tileR = base.macroRow + r;
  sprite.__tileC = base.macroCol + c;
  scene.worldContainer.add(sprite);
  return sprite;
}

// Walkability query for an agent / movement system.
// Coords are room-local (0..ROOM_SIZE-1).
export function isTileWalkable(room, r, c) {
  if (!room?.tiles) return false;
  if (r < 0 || r >= ISO.ROOM_SIZE || c < 0 || c >= ISO.ROOM_SIZE) return false;
  return !!room.tiles[r]?.[c]?.walkable;
}

// --- Scenery cleanup ------------------------------------------------------

function clearSceneryIn(scene, bounds) {
  if (!scene.renderableList) return;
  const toRemove = [];
  for (const obj of scene.renderableList) {
    if (obj.kind !== 'scenery') continue;
    const tr = obj.__tileR;
    const tc = obj.__tileC;
    if (tr === undefined || tc === undefined) continue;
    if (tr >= bounds.minR && tr <= bounds.maxR &&
        tc >= bounds.minC && tc <= bounds.maxC) {
      toRemove.push(obj);
    }
  }
  if (!toRemove.length) return;
  scene.renderableList = scene.renderableList.filter((o) => !toRemove.includes(o));
  for (const obj of toRemove) {
    scene.tweens.add({
      targets: obj,
      alpha: 0,
      duration: 220,
      onComplete: () => obj.destroy(),
    });
  }
}

// --- Spawn flash ----------------------------------------------------------

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

void ASSETS;
