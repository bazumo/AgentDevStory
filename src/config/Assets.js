// Single source of truth for sprite assets.
// All entries point at the office-items/* iso art (64x64 RGBA, transparent).
// Adding a new role: add an entry; preload + RoomLayouts pick it up.
//
// chromaKey: defaults to FALSE. The old web_office/*.png set was the only
// source with white backgrounds. Set to true only if a new asset arrives that
// lacks a transparent background.

export const ASSETS = {
  desk:          { key: 'role_desk',          path: 'office-items/desk/desk.png' },
  chair:         { key: 'role_chair',         path: 'office-items/chair/chair.png' },
  bookshelf:     { key: 'role_bookshelf',     path: 'office-items/bookshelf/bookshelf.png' },
  whiteboard:    { key: 'role_whiteboard',    path: 'office-items/whiteboard/whiteboard.png' },
  plant:         { key: 'role_plant',         path: 'office-items/plant/plant.png' },
  serverRack:    { key: 'role_serverRack',    path: 'office-items/server-rack/server-rack.png' },
  cubicle:       { key: 'role_cubicle',       path: 'office-items/cubicle/cubicle.png' },
  fileCabinet:   { key: 'role_fileCabinet',   path: 'office-items/file-cabinet/file-cabinet.png' },
  lamp:          { key: 'role_lamp',          path: 'office-items/lamp/lamp.png' },
  printer:       { key: 'role_printer',       path: 'office-items/printer/printer.png' },
  receptionDesk: { key: 'role_receptionDesk', path: 'office-items/reception-desk/reception-desk.png' },
  storageRack:   { key: 'role_storageRack',   path: 'office-items/storage-rack/storage-rack.png' },
  trashCan:      { key: 'role_trashCan',      path: 'office-items/trash-can/trash-can.png' },
  waterCooler:   { key: 'role_waterCooler',   path: 'office-items/water-cooler/water-cooler.png' },
};

// Per-asset rendering + walkability properties.
// `walkable`: can an agent walk through this tile? Chairs are walkable
// (characters sit on them); everything else is blocking.
// `scale`:    default sprite scale at render time.
export const ASSET_PROPS = {
  desk:          { scale: 0.85, walkable: false, offsetX: 0, offsetY: 5 },
  chair:         { scale: 0.70, walkable: true  },
  bookshelf:     { scale: 0.90, walkable: false },
  whiteboard:    { scale: 0.78, walkable: false },
  plant:         { scale: 0.75, walkable: false },
  serverRack:    { scale: 0.85, walkable: false },
  cubicle:       { scale: 0.85, walkable: false },
  fileCabinet:   { scale: 0.80, walkable: false },
  lamp:          { scale: 0.80, walkable: false, offsetX: 10, offsetY: 0 },
  printer:       { scale: 0.75, walkable: false },
  receptionDesk: { scale: 0.90, walkable: false },
  storageRack:   { scale: 0.85, walkable: false },
  trashCan:      { scale: 0.60, walkable: true  },
  waterCooler:   { scale: 0.70, walkable: false },
};

export function assetProps(role) {
  return ASSET_PROPS[role] ?? { scale: 0.7, walkable: false };
}

export function assetKey(role) {
  return ASSETS[role]?.key ?? role;
}

export function assetPath(role) {
  return ASSETS[role]?.path;
}

export const ASSET_ROLES = Object.keys(ASSETS);
