/**
 * WebSocket client connecting the Phaser frontend to the Express backend.
 * Dispatches CustomEvents on `window` so the scene and UI can react without
 * direct coupling.  Falls back gracefully when the server is unreachable —
 * the frontend keeps working in standalone mock mode.
 */

const RECONNECT_DELAY_MS = 3000;

class BackendConnection {
  constructor() {
    /** @type {WebSocket | null} */
    this.ws = null;
    this.connected = false;
    this._reconnectTimer = null;
    this._wasConnected = false;
    /** Cached rooms from the most recent rooms:sync so late listeners can pick them up */
    this.lastRoomsSync = null;
  }

  connect() {
    if (this.ws) return;

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${location.host}/ws`;

    try {
      this.ws = new WebSocket(url);
    } catch {
      this._scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.connected = true;
      this._wasConnected = true;
      console.log('[backend] connected');
      window.dispatchEvent(new CustomEvent('backend:connected'));
    };

    this.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'rooms:sync') this.lastRoomsSync = msg.payload;
        window.dispatchEvent(
          new CustomEvent(`backend:${msg.type}`, { detail: msg.payload }),
        );
      } catch { /* ignore malformed */ }
    };

    this.ws.onclose = () => {
      this.connected = false;
      this.ws = null;
      if (this._wasConnected) {
        console.log('[backend] disconnected, reconnecting...');
        window.dispatchEvent(new CustomEvent('backend:disconnected'));
      }
      this._scheduleReconnect();
    };

    this.ws.onerror = () => {
      // onclose will fire after this
    };
  }

  send(type, payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify({ type, payload }));
    return true;
  }

  _scheduleReconnect() {
    if (this._reconnectTimer) return;
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this.connect();
    }, RECONNECT_DELAY_MS);
  }
}

export const backend = new BackendConnection();
