import Phaser from 'phaser';
import { AgencyFloorScene } from './scenes/AgencyFloorScene.js';
import { initUI } from './ui.js';
import { checkGBrainHealth, subscribeGBrain } from './api.js';

async function bootstrap() {
  const gbrainHealth = await checkGBrainHealth();
  window.__agentoffice = { game: null, gbrainHealth };

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

  window.__agentoffice.game = game;
  initUI();

  subscribeGBrain((event) => {
    window.dispatchEvent(new CustomEvent('agentoffice:gbrain-event', { detail: event }));
  });
}

bootstrap();
