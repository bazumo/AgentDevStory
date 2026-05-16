import { ISO } from '../config/IsoConfig.js';

function diamondPoints() {
  const hw = ISO.TILE_WIDTH / 2;
  const hh = ISO.TILE_HEIGHT / 2;
  return [0, -hh, hw, 0, 0, hh, -hw, 0];
}

// Deterministic per-tile hash → [0, 1). Same (r,c,salt) always yields same value.
function rand(r, c, salt = 0) {
  let h = (r * 374761393 + c * 668265263 + salt * 1274126177) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

// ---- Palette ----
const GRASS_VARIANTS = [0x2e5232, 0x346239, 0x294b2c, 0x3a6b3e, 0x2c5934];
const DIRT_COLOR     = 0x5a4733;
const PATH_COLOR     = 0x5a5b60;
const PATH_LIGHT     = 0x7a7c83;
const PATH_STROKE    = 0x393a3e;

const TRUNK_COLOR    = 0x3a2716;
const CANOPY_DARK    = 0x1f3d22;
const CANOPY_MID     = 0x2c5530;
const CANOPY_LIGHT   = 0x4a7d4b;

const LAMP_HEAD      = 0xffcf6a;
const LAMP_GLOW      = 0xffd680;
const LAMP_POLE      = 0x1a1a1a;

const FOUNTAIN_BASE  = 0x434953;
const FOUNTAIN_RIM   = 0x6a7280;
const WATER_COLOR    = 0x4aa6ff;

const FLOWER_COLORS  = [0xffe066, 0xff7777, 0xffffff, 0xff9ad1];

// ---- Builders ----

function makeFloorTile(scene, x, y, color, alpha, strokeColor = 0x223018, strokeAlpha = 0.3) {
  const tile = scene.add.polygon(x, y, diamondPoints(), color, alpha);
  tile.setStrokeStyle(1, strokeColor, strokeAlpha * alpha);
  tile.kind = 'backdrop';
  tile.depth = -10000;
  scene.worldContainer.add(tile);
  return tile;
}

function makeTree(scene, x, y, variant, alpha, tileR, tileC) {
  const created = [];
  const scale = 0.85 + variant * 0.35;
  const trunk = scene.add.rectangle(x, y + 2, 3 * scale, 9 * scale, TRUNK_COLOR, alpha);
  trunk.setOrigin(0.5, 1);
  trunk.kind = 'scenery';
  scene.worldContainer.add(trunk);
  created.push(trunk);
  const baseY = y + 2 - 9 * scale;
  const c1 = scene.add.ellipse(x, baseY - 2 * scale, 18 * scale, 14 * scale, CANOPY_DARK, alpha);
  c1.kind = 'scenery';
  scene.worldContainer.add(c1);
  created.push(c1);
  const c2 = scene.add.ellipse(x - 2 * scale, baseY - 7 * scale, 15 * scale, 12 * scale, CANOPY_MID, alpha);
  c2.kind = 'scenery';
  scene.worldContainer.add(c2);
  created.push(c2);
  const c3 = scene.add.ellipse(x + 1 * scale, baseY - 11 * scale, 9 * scale, 8 * scale, CANOPY_LIGHT, alpha);
  c3.kind = 'scenery';
  scene.worldContainer.add(c3);
  created.push(c3);
  for (const obj of created) {
    obj.__sceneryY = y + 2;
    obj.__tileR = tileR;
    obj.__tileC = tileC;
  }
  return created;
}

function makeBush(scene, x, y, alpha, tileR, tileC) {
  const e1 = scene.add.ellipse(x, y, 14, 9, CANOPY_DARK, alpha);
  e1.kind = 'scenery';
  e1.__sceneryY = y;
  e1.__tileR = tileR;
  e1.__tileC = tileC;
  scene.worldContainer.add(e1);
  const e2 = scene.add.ellipse(x - 1, y - 3, 10, 7, CANOPY_MID, alpha);
  e2.kind = 'scenery';
  e2.__sceneryY = y;
  e2.__tileR = tileR;
  e2.__tileC = tileC;
  scene.worldContainer.add(e2);
  return [e1, e2];
}

function makeLampPost(scene, x, y) {
  const created = [];
  // Soft ground glow
  const halo = scene.add.ellipse(x, y + 4, 38, 18, LAMP_GLOW, 0.15);
  halo.kind = 'backdrop';
  halo.depth = -9995;
  scene.worldContainer.add(halo);
  created.push(halo);
  // Pole
  const pole = scene.add.rectangle(x, y + 2, 2, 18, LAMP_POLE, 1);
  pole.setOrigin(0.5, 1);
  pole.kind = 'scenery';
  pole.__sceneryY = y + 2;
  scene.worldContainer.add(pole);
  created.push(pole);
  // Lamp head
  const head = scene.add.circle(x, y + 2 - 17, 3.5, LAMP_HEAD, 1);
  head.kind = 'scenery';
  head.__sceneryY = y + 2;
  scene.worldContainer.add(head);
  created.push(head);
  // Aura around head
  const aura = scene.add.circle(x, y + 2 - 17, 9, LAMP_GLOW, 0.35);
  aura.kind = 'scenery';
  aura.__sceneryY = y + 2;
  scene.worldContainer.add(aura);
  created.push(aura);
  // Flicker
  const seed = (Math.abs(x * 7 + y * 13)) % 600;
  scene.tweens.add({
    targets: [aura, halo],
    alpha: { from: 0.25, to: 0.45 },
    duration: 1200 + seed,
    yoyo: true,
    repeat: -1,
    ease: 'Sine.easeInOut',
  });
  return created;
}

function makeFlowers(scene, x, y, count, seed) {
  for (let i = 0; i < count; i++) {
    const dx = (rand(x | 0, y | 0, seed + i * 3) - 0.5) * ISO.TILE_WIDTH * 0.7;
    const dy = (rand(x | 0, y | 0, seed + i * 5) - 0.5) * ISO.TILE_HEIGHT * 0.6;
    const col = FLOWER_COLORS[Math.floor(rand(x | 0, y | 0, seed + i * 7) * FLOWER_COLORS.length)];
    const flower = scene.add.circle(x + dx, y + dy, 1.2, col, 0.9);
    flower.kind = 'backdrop';
    flower.depth = -9990;
    scene.worldContainer.add(flower);
  }
}

function makeFountain(scene, x, y) {
  const created = [];
  // Stone basin
  const basin = scene.add.polygon(x, y, diamondPoints(), FOUNTAIN_BASE, 1);
  basin.setStrokeStyle(2, FOUNTAIN_RIM, 1);
  basin.kind = 'backdrop';
  basin.depth = -9995;
  scene.worldContainer.add(basin);
  created.push(basin);
  // Water disc
  const water = scene.add.ellipse(x, y, ISO.TILE_WIDTH * 0.55, ISO.TILE_HEIGHT * 0.7, WATER_COLOR, 0.85);
  water.kind = 'backdrop';
  water.depth = -9994;
  scene.worldContainer.add(water);
  created.push(water);
  // Splash ripple
  const ripple = scene.add.ellipse(x, y, 8, 4, 0xffffff, 0.7);
  ripple.kind = 'backdrop';
  ripple.depth = -9993;
  scene.worldContainer.add(ripple);
  created.push(ripple);
  scene.tweens.add({
    targets: ripple,
    width: ISO.TILE_WIDTH * 0.4,
    height: ISO.TILE_HEIGHT * 0.5,
    alpha: 0,
    duration: 2200,
    repeat: -1,
    ease: 'Quad.easeOut',
  });
  return created;
}

// ---- Main entry ----

export function drawAgencyFloor(scene) {
  const radius = ISO.BACKDROP_RADIUS;
  const created = [];

  for (let r = -radius; r <= radius; r++) {
    for (let c = -radius; c <= radius; c++) {
      const { x, y } = scene.gridToScreen(r, c);

      const dist = Math.sqrt(r * r + c * c);
      const edge = Math.min(1, dist / radius);
      const alpha = Math.max(0, 1 - Math.pow(edge, 1.8) * 0.9);
      if (alpha <= 0.04) continue;

      const onLaneR = r % ISO.ROOM_PITCH === 0;
      const onLaneC = c % ISO.ROOM_PITCH === 0;
      const isPath = onLaneR || onLaneC;
      const isIntersection = onLaneR && onLaneC;

      if (isPath) {
        // Cobblestone path tile
        const color = isIntersection ? PATH_LIGHT : PATH_COLOR;
        created.push(makeFloorTile(scene, x, y, color, alpha, PATH_STROKE, 0.5));

        // Lamp post at non-origin intersections
        if (isIntersection && (r !== 0 || c !== 0) && alpha > 0.4) {
          created.push(...makeLampPost(scene, x, y));
        }
      } else {
        // Grass tile with deterministic shade variance
        const variantIdx = Math.floor(rand(r, c, 1) * GRASS_VARIANTS.length);
        let color = GRASS_VARIANTS[variantIdx];
        // Occasional dirt patches
        if (rand(r, c, 3) < 0.04) color = DIRT_COLOR;
        created.push(makeFloorTile(scene, x, y, color, alpha, 0x1a2a14, 0.35));

        // Occasional wildflower cluster
        if (rand(r, c, 5) < 0.10 && color !== DIRT_COLOR) {
          makeFlowers(scene, x, y, 1 + Math.floor(rand(r, c, 11) * 3), r * 31 + c * 17);
        }
      }

      // Trees: outer ring only. The room clear-on-spawn safeguards inner
      // tiles in case the spiral grows into this zone.
      if (!isPath && dist > 10 && dist < radius - 2 && alpha > 0.25) {
        const treeRoll = rand(r, c, 9);
        if (treeRoll < 0.45) {
          const variant = Math.floor(rand(r, c, 13) * 3);
          const jx = x + (rand(r, c, 15) - 0.5) * 18;
          const jy = y + (rand(r, c, 17) - 0.5) * 10;
          const treeParts = makeTree(scene, jx, jy, variant, alpha, r, c);
          created.push(...treeParts);
        } else if (treeRoll < 0.52) {
          const jx = x + (rand(r, c, 19) - 0.5) * 14;
          const jy = y + (rand(r, c, 21) - 0.5) * 8;
          const bushParts = makeBush(scene, jx, jy, alpha, r, c);
          created.push(...bushParts);
        }
      }
    }
  }

  // Central fountain at (0, 0)
  const { x: hx, y: hy } = scene.gridToScreen(0, 0);
  created.push(...makeFountain(scene, hx, hy));

  return created;
}
