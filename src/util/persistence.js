const KEY = 'agentoffice.state.v1';

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { rooms: [] };
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.rooms)) return { rooms: [] };
    return parsed;
  } catch {
    return { rooms: [] };
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // quota exceeded or storage disabled — silently drop
  }
}

export function clearState() {
  try { localStorage.removeItem(KEY); } catch {}
}
