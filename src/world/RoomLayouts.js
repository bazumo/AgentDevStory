// Data-driven room compositions, keyed on roles from src/config/Assets.js.
//
// SCHEMA (matrix-based):
//   grid:    5x5 array, [r][c] is either null (walkable empty) or an asset
//            role name (placed sprite). Walls auto-render on r=0 (back) and
//            c=0 (left) — assets on those tiles still render normally.
//   primary: [r, c] of the primary desk/table — gets the click-to-center.
//   accents: floor accent overlays { tile: [r,c], color?, alpha }.
//
// Walkability is derived: a tile is walkable iff (a) it's not a wall row/col,
// and (b) any asset placed on it is walkable per ASSET_PROPS in Assets.js.
//
// To add a sprite to a room: change null to the role name in the grid.
// To swap an asset: change the role name. That's it.

export const ROOM_LAYOUTS = {
  // 🏭 THE FORGE — coding bullpen. Cubicles along the back wall, primary
  // workstation center, utilities along the front.
  forge: {
    grid: [
      ['bookshelf',  'cubicle',    'cubicle',     'cubicle',    'bookshelf'],
      [null,          null,         null,          null,         null      ],
      [null,         'chair',      'desk',         null,        'cubicle'  ],
      [null,          null,         null,          null,         null      ],
      ['printer',    'trashCan',    null,         'plant',       null      ],
    ],
    primary: [2, 2],
    accents: [
      { tile: [0, 2], alpha: 0.18 },
      { tile: [4, 2], alpha: 0.18 },
    ],
  },

  // 🚨 THE WAR ROOM — incident response HQ. Wall of monitoring servers,
  // central meeting table for triage, alarm-red accents.
  warroom: {
    grid: [
      ['serverRack', 'serverRack',  'serverRack', 'serverRack', 'serverRack'],
      ['serverRack',  null,          null,         null,         null       ],
      [null,          null,         'meetingTable', null,        null       ],
      ['serverRack',  null,          null,         null,         null       ],
      ['whiteboard',  null,          null,         null,        'lamp'      ],
    ],
    primary: [2, 2],
    accents: [
      { tile: [2, 2], color: 0xff2233, alpha: 0.22 },
      { tile: [0, 0], color: 0xff2233, alpha: 0.30 },
      { tile: [4, 4], color: 0xff2233, alpha: 0.30 },
      { tile: [0, 4], color: 0xff2233, alpha: 0.25 },
      { tile: [4, 0], color: 0xff2233, alpha: 0.25 },
    ],
  },

  // 📐 THE BLUEPRINT LAB — architecture/schemas. Whiteboards lining the
  // walls, central conference table, reference shelves.
  blueprint: {
    grid: [
      ['whiteboard', 'whiteboard', null,          'whiteboard', 'bookshelf'],
      ['whiteboard',  null,         null,          null,         null      ],
      [null,          null,        'meetingTable', null,         null      ],
      ['whiteboard',  null,         null,          null,         null      ],
      ['bookshelf',   null,        'plant',        null,        'lamp'     ],
    ],
    primary: [2, 2],
    accents: [
      { tile: [2, 1], alpha: 0.18 },
      { tile: [2, 3], alpha: 0.18 },
      { tile: [1, 2], alpha: 0.18 },
      { tile: [3, 2], alpha: 0.18 },
    ],
  },

  // 📚 THE LOUNGE — docs / writing. Library of bookshelves, comfy couch,
  // water cooler, accent lamp.
  lounge: {
    grid: [
      ['bookshelf', 'bookshelf', 'bookshelf', 'bookshelf', 'bookshelf'],
      ['bookshelf',  null,        null,        null,        null      ],
      [null,        'chair',     'desk',       null,        null      ],
      ['bookshelf',  null,        null,        null,       'lamp'     ],
      ['waterCooler', null,     'couch',       null,       'plant'    ],
    ],
    primary: [2, 2],
    accents: [
      { tile: [4, 2], color: 0xff9966, alpha: 0.20 },
      { tile: [2, 4], color: 0xff9966, alpha: 0.20 },
    ],
  },
};

export function layoutFor(type) {
  return ROOM_LAYOUTS[type] ?? ROOM_LAYOUTS.forge;
}
