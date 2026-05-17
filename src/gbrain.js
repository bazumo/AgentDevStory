import { rememberRemoteGBrain, searchRemoteGBrain } from './api.js';

const STORAGE_KEY = 'agentoffice.gbrain.v1';

const SEED_ENTRIES = [
  {
    id: 'seed:gbrain-purpose',
    sourceSessionId: 'seed',
    title: 'G-Brain memory role',
    text: 'G-Brain is the shared memory for AgentDevStory. Agents retrieve prior task context before responding, then write useful outcomes back after the turn completes.',
    at: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'seed:kanban-flow',
    sourceSessionId: 'seed',
    title: 'Kanban task flow',
    text: 'Kanban columns map agent work into Todo, In Progress, Review, Done, and Blocked. Linear-backed rooms use their workflow state; local rooms fall back to agent state.',
    at: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'seed:agent-states',
    sourceSessionId: 'seed',
    title: 'Agent animation states',
    text: 'Thinking sprites while reasoning, typing sprites while producing output, success sprites once a task completes, walking sprites when moving between rooms.',
    at: '2026-01-01T00:00:00.000Z',
  },
];

class BrowserGBrain {
  constructor() {
    this.entries = this.load();
    this.seed();
  }

  search(query, limit = 4) {
    const queryTerms = terms(query);
    const scored = this.entries
      .map((entry) => ({ ...entry, score: scoreEntry(entry, queryTerms) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || b.at.localeCompare(a.at))
      .slice(0, limit);

    if (scored.length) return scored;

    return this.entries
      .filter((entry) => entry.id.startsWith('seed:'))
      .slice(0, limit)
      .map((entry, index) => ({ ...entry, score: Math.max(1, limit - index) }));
  }

  remember({ sourceSessionId, title, text }) {
    const cleanText = String(text ?? '').trim().slice(0, 8000);
    if (!cleanText) return;

    const entry = {
      id: `session:${sourceSessionId}:${hash(`${title}\n${cleanText}`)}`,
      sourceSessionId,
      title: title || sourceSessionId,
      text: cleanText,
      at: new Date().toISOString(),
    };

    const index = this.entries.findIndex((item) => item.id === entry.id);
    if (index >= 0) this.entries[index] = entry;
    else this.entries.unshift(entry);

    this.entries = this.entries.slice(0, 250);
    this.save();
  }

  seed() {
    let changed = false;
    for (const entry of SEED_ENTRIES) {
      if (this.entries.some((item) => item.id === entry.id)) continue;
      this.entries.push(entry);
      changed = true;
    }
    if (changed) this.save();
  }

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed.entries) ? parsed.entries : [];
    } catch {
      return [];
    }
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ entries: this.entries }));
    } catch {
      // Storage may be disabled; the remote G-Brain path can still work.
    }
  }
}

const browserGBrain = new BrowserGBrain();

export async function queryGBrain(query, limit = 4) {
  const remoteHits = await searchRemoteGBrain(query, limit);
  if (remoteHits.length) return { source: 'server', hits: remoteHits };
  return { source: 'browser', hits: browserGBrain.search(query, limit) };
}

export async function rememberGBrain(entry) {
  browserGBrain.remember(entry);
  await rememberRemoteGBrain(entry);
}

export function describeHits(hits) {
  if (!hits.length) return 'Loaded baseline G-Brain memory';
  const primary = hits[0].title.replace(/\s+/g, ' ').slice(0, 80);
  return `Loaded ${hits.length} G-Brain ${hits.length === 1 ? 'memory' : 'memories'}: ${primary}`;
}

function scoreEntry(entry, queryTerms) {
  if (queryTerms.size === 0) return 0;
  const entryTerms = terms(`${entry.title} ${entry.text}`);
  let score = 0;
  for (const term of queryTerms) {
    if (entryTerms.has(term)) score += term.length > 6 ? 2 : 1;
  }
  return score;
}

function terms(text) {
  return new Set(
    String(text ?? '')
      .toLowerCase()
      .split(/[^a-z0-9_/-]+/g)
      .map((term) => term.trim())
      .filter((term) => term.length >= 3),
  );
}

function hash(text) {
  let value = 0;
  for (let i = 0; i < text.length; i++) {
    value = ((value << 5) - value + text.charCodeAt(i)) | 0;
  }
  return Math.abs(value).toString(36);
}
