import Phaser from 'phaser';
import { AgencyFloorScene } from './scenes/AgencyFloorScene.js';
import { initUI } from './ui.js';
import { checkBackendHealth, subscribe, fetchWorld } from './api.js';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'phaser-root',
  backgroundColor: '#1a1d22',
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: '100%',
    height: '100%',
  },
  pixelArt: true,
  scene: [AgencyFloorScene],
});

initUI();

window.__agentoffice = { game, backendConnected: false };

(async () => {
  const alive = await checkBackendHealth();
  window.__agentoffice.backendConnected = alive;

  if (alive) {
    const world = await fetchWorld();
    if (world) {
      window.dispatchEvent(new CustomEvent('agentoffice:world-update', { detail: world }));
    }
    subscribe((event) => {
      if (event.type === 'world') {
        window.dispatchEvent(new CustomEvent('agentoffice:world-update', { detail: event.world }));
      } else if (event.type === 'session') {
        window.dispatchEvent(new CustomEvent('agentoffice:session-update', { detail: event.session }));
      }
    });
    console.log('[AgentOffice] Backend connected — live mode');
  } else {
    console.log('[AgentOffice] No backend — running in mock mode');
  }
})();
