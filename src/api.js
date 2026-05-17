const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) || '';

let eventSource = null;
const listeners = new Set();

export function subscribeGBrain(callback) {
  if (typeof EventSource === 'undefined') return () => {};
  listeners.add(callback);
  ensureEventSource();
  return () => {
    listeners.delete(callback);
    if (listeners.size === 0 && eventSource) {
      eventSource.close();
      eventSource = null;
    }
  };
}

function ensureEventSource() {
  if (eventSource) return;
  eventSource = new EventSource(`${API_BASE}/api/events`);
  eventSource.onmessage = (e) => {
    try {
      const event = JSON.parse(e.data);
      for (const callback of listeners) callback(event);
    } catch {
      // Ignore malformed SSE payloads and keep the stream alive.
    }
  };
  eventSource.onerror = () => {
    eventSource.close();
    eventSource = null;
    setTimeout(() => {
      if (listeners.size > 0) ensureEventSource();
    }, 3000);
  };
}

export async function checkGBrainHealth() {
  try {
    const res = await fetch(`${API_BASE}/api/health`);
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
