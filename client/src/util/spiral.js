import { ISO } from '../config/IsoConfig.js';

export function getSpiralCoordinates(n) {
  if (n === 0) return { macroRow: 0, macroCol: 0 };

  let x = 0;
  let y = 0;
  let dx = 0;
  let dy = -1;

  for (let i = 0; i < n; i++) {
    if (x === y || (x < 0 && x === -y) || (x > 0 && x === 1 - y)) {
      const temp = dx;
      dx = -dy;
      dy = temp;
    }
    x += dx;
    y += dy;
  }

  return {
    macroRow: x * ISO.ROOM_PITCH,
    macroCol: y * ISO.ROOM_PITCH,
  };
}
