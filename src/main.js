import Phaser from 'phaser';
import { AgencyFloorScene } from './scenes/AgencyFloorScene.js';
import { initUI } from './ui.js';
import { checkBackendHealth, fetchWorld, subscribe } from './api.js';

async function bootstrap() {
  const backendConnected = await checkBackendHealth();
  window.__agentoffice = { game: null, backendConnected };

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

  if (!backendConnected) {
    console.log('[AgentOffice] No backend detected - visual mock mode');
    return;
  }

  const dispatchWorld = (world) => {
    window.dispatchEvent(new CustomEvent('agentoffice:world-update', { detail: world }));
  };

  subscribe((event) => {
    if (event.type === 'world') {
      dispatchWorld(event.world);
    } else if (event.type === 'session') {
      window.dispatchEvent(new CustomEvent('agentoffice:session-update', { detail: event.session }));
    } else if (event.type === 'error') {
      window.dispatchEvent(new CustomEvent('agentoffice:backend-error', { detail: event }));
    }
  });

  const world = await fetchWorld();
  if (world) {
    setTimeout(() => dispatchWorld(world), 250);
  }
  console.log('[AgentOffice] Backend connected - Linear/Codex live mode');
}

bootstrap();
