import Phaser from 'phaser';
import { AgencyFloorScene } from './scenes/AgencyFloorScene.js';
import { initUI } from './ui.js';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'phaser-root',
  transparent: true,
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: '100%',
    height: '100%',
  },
  pixelArt: true,
  scene: [AgencyFloorScene],
});

initUI();

window.__agentoffice = { game };
