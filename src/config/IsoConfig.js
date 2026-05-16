export const ISO = Object.freeze({
  TILE_WIDTH: 64,
  TILE_HEIGHT: 32,
  ROOM_SIZE: 5,
  ROOM_PITCH: 6,
  WALL_HEIGHT_PX: 44,
  WALL_LIFT_PX: 4,
  DEPTH_BIAS_WALL: -4,
  DEPTH_BIAS_AGENT: 4,
  WORLD_ORIGIN_Y: 260,
  BACKDROP_RADIUS: 16,
  PANEL_OFFSET_PX: 240,
  CAMERA_TWEEN_MS: 500,
  KEYBOARD_PAN_SPEED: 6,
});

export const CHARACTER_STATES = ['idle', 'thinking', 'cheer', 'surprised', 'sleep'];
export const CHARACTER_DIRECTIONS = ['front', 'back', 'left', 'right'];
export const CHARACTER_COUNT = 10;

export function characterTextureKey(charIndex, state, direction) {
  const idx = String(charIndex).padStart(2, '0');
  return `char-${idx}_${state}-${direction}`;
}
