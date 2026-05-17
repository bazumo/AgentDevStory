/**
 * Client API adapter for the Linear/Codex backend.
 *
 * The Vite dev server proxies /api to the Bun backend. In frontend-only mode
 * these calls fail fast and the visual canvas stays in mock mode.
 */

const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) || '';

let eventSource = null;
const listeners = new Set();

export function subscribe(callback) {
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
      for (const cb of listeners) cb(event);
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

export async function fetchWorld() {
  try {
    const res = await fetch(`${API_BASE}/api/world`);
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function fetchSession(id) {
  try {
    const res = await fetch(`${API_BASE}/api/sessions/${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function fetchTeams() {
  try {
    const res = await fetch(`${API_BASE}/api/linear/teams`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.teams ?? [];
  } catch {
    return [];
  }
}

export async function fetchSymphonyStatus() {
  try {
    const res = await fetch(`${API_BASE}/api/symphony/status`);
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function syncSymphony() {
  const res = await fetch(`${API_BASE}/api/symphony/sync`, { method: 'POST' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Failed to sync Symphony: ${res.status}`);
  }
  return res.json();
}

export async function searchGBrain(query) {
  try {
    const params = new URLSearchParams({ q: query });
    const res = await fetch(`${API_BASE}/api/gbrain/search?${params}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.hits ?? [];
  } catch {
    return [];
  }
}

export async function createProject({ teamId, name, description }) {
  const res = await fetch(`${API_BASE}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teamId, name, description }),
  });
  if (!res.ok) throw new Error(`Failed to create project: ${res.status}`);
  return res.json();
}

export async function createSession(prompt) {
  const res = await fetch(`${API_BASE}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Failed to create session: ${res.status}`);
  }
  return res.json();
}

export async function sendSessionInput(sessionId, message) {
  const res = await fetch(`${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/input`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Failed to send input: ${res.status}`);
  }
  return res.json();
}

export async function checkBackendHealth() {
  try {
    const res = await fetch(`${API_BASE}/api/health`);
    return res.ok;
  } catch {
    return false;
  }
}
