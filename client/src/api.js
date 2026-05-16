/**
 * Client API adapter — connects the Phaser frontend to the backend.
 *
 * In "mock" mode (no backend running), falls back to local mock data
 * so the frontend remains fully functional for visual development.
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
    } catch { /* ignore parse errors */ }
  };
  eventSource.onerror = () => {
    eventSource.close();
    eventSource = null;
    setTimeout(() => { if (listeners.size > 0) ensureEventSource(); }, 3000);
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

export async function createProject({ teamId, name, description }) {
  const res = await fetch(`${API_BASE}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teamId, name, description }),
  });
  if (!res.ok) throw new Error(`Failed to create project: ${res.status}`);
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
