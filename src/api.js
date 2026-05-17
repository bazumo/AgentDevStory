// REST helpers for the G-Brain endpoints exposed by the Express backend.
// Live push notifications (gbrain:remember / gbrain:search) come in over the
// existing /ws connection in src/backend.js, not a separate EventSource.

const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) || '';

export async function checkGBrainHealth() {
  try {
    const res = await fetch(`${API_BASE}/api/gbrain/health`);
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function searchRemoteGBrain(query, limit = 4) {
  try {
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    const res = await fetch(`${API_BASE}/api/gbrain/search?${params}`);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.hits) ? data.hits : [];
  } catch {
    return [];
  }
}

export async function rememberRemoteGBrain(entry) {
  try {
    const res = await fetch(`${API_BASE}/api/gbrain/remember`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Subscribe to gbrain events that arrive over the websocket. Returns an
// unsubscribe function. Listens for backend:gbrain:remember and
// backend:gbrain:search events dispatched by src/backend.js.
export function subscribeGBrain(callback) {
  const onRemember = (e) => callback({ type: 'remember', ...e.detail });
  const onSearch = (e) => callback({ type: 'search', ...e.detail });
  window.addEventListener('backend:gbrain:remember', onRemember);
  window.addEventListener('backend:gbrain:search', onSearch);
  return () => {
    window.removeEventListener('backend:gbrain:remember', onRemember);
    window.removeEventListener('backend:gbrain:search', onSearch);
  };
}
