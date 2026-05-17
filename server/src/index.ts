import { config } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../.env') });
import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { randomInt } from 'node:crypto';

import { LinearClient } from './linear.js';
import { AgentManager } from './agent-manager.js';
import { GBrainMemory } from './gbrain.js';
import type { Room, RoomType, AgentState, LinearIssue, WsMessageOut } from './types.js';

const REPO_ROOT = resolve(__dirname, '../..');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT ?? '4317', 10);
const LINEAR_API_KEY = process.env.LINEAR_API_KEY ?? '';
const WORKSPACE_ROOT = process.env.AGENTDEVSTORY_WORKSPACE_ROOT ?? '/tmp/agentdevstory-workspaces';
const TARGET_REPO = process.env.AGENTDEVSTORY_TARGET_REPO;
const CLAUDE_CMD = process.env.CLAUDE_CMD ?? 'claude';
const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT_AGENTS ?? '2', 10);
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_MS ?? '10000', 10);
const ACTIVE_STATES = (process.env.ACTIVE_LINEAR_STATES ?? 'Todo,In Progress,In Review').split(',').map(s => s.trim());
const TERMINAL_STATES = (process.env.TERMINAL_LINEAR_STATES ?? 'Done,Canceled,Cancelled').split(',').map(s => s.trim());
const AGENT_TRIGGER_STATES = (process.env.AGENT_TRIGGER_STATES ?? 'In Progress,In Review').split(',').map(s => s.trim());
const GBRAIN_DATA_DIR = process.env.AGENTDEVSTORY_GBRAIN_DIR ?? resolve(WORKSPACE_ROOT, '.gbrain');

// ---------------------------------------------------------------------------
// Room type classifier (mirrors frontend RoomTypes.js)
// ---------------------------------------------------------------------------

const CLASSIFIER_RULES: { type: RoomType; keywords: string[] }[] = [
  { type: 'warroom', keywords: ['debug', 'fix', 'bug', 'error', 'stack trace', 'crash', 'refactor', 'broken'] },
  { type: 'blueprint', keywords: ['schema', 'architecture', 'design', 'prompt', 'plan', 'database', 'db', 'diagram', 'spec'] },
  { type: 'lounge', keywords: ['doc', 'readme', 'write', 'explain', 'tutorial', 'blog', 'changelog'] },
  { type: 'forge', keywords: ['build', 'feature', 'implement', 'create', 'ui', 'component', 'add', 'route', 'endpoint'] },
];

function classifyPrompt(text: string): RoomType {
  const lower = text.toLowerCase();
  for (const rule of CLASSIFIER_RULES) {
    if (rule.keywords.some((k) => lower.includes(k))) return rule.type;
  }
  return 'forge';
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const rooms = new Map<string, Room>();
const terminalHistory = new Map<string, { kind: string; text: string }[]>();
const seenCommentIds = new Map<string, Set<string>>();
let characterCounter = 0;

function nextCharacterIndex(): number {
  characterCounter = (characterCounter % 10) + 1;
  return characterCounter;
}

function roomToPayload(room: Room) {
  return { ...room };
}

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

const linear = LINEAR_API_KEY
  ? new LinearClient({ apiKey: LINEAR_API_KEY, activeStates: ACTIVE_STATES, terminalStates: TERMINAL_STATES })
  : null;

const agents = new AgentManager({
  workspaceRoot: WORKSPACE_ROOT,
  targetRepo: TARGET_REPO,
  claudeCmd: CLAUDE_CMD,
  maxConcurrent: MAX_CONCURRENT,
});

const gbrain = new GBrainMemory(GBRAIN_DATA_DIR, REPO_ROOT);
await gbrain.load().catch((err) => console.error('[GBrain] load failed:', err));

agents.on('agent:state', ({ roomId, state }: { roomId: string; state: AgentState }) => {
  const room = rooms.get(roomId);
  if (room) {
    room.agentState = state;
    broadcast({ type: 'room:updated', payload: roomToPayload(room) });
  }
});

agents.on('terminal:output', ({ roomId, kind, text }: { roomId: string; kind: string; text: string }) => {
  if (!terminalHistory.has(roomId)) terminalHistory.set(roomId, []);
  terminalHistory.get(roomId)!.push({ kind, text });
  broadcast({ type: 'terminal:output', payload: { roomId, kind, text } });
});

const REVIEW_STATE = process.env.REVIEW_STATE_NAME ?? 'In Review';

agents.on('agent:done', async ({ roomId, exitCode, output }: { roomId: string; exitCode: number | null; output: string }) => {
  const room = rooms.get(roomId);
  if (!room) return;

  // Persist a memory of this run regardless of Linear connectivity, so future
  // agents can retrieve context from prior sessions.
  try {
    const entry = await gbrain.remember({
      sourceSessionId: room.linearIdentifier ?? room.id,
      title: room.title,
      text: `[exit=${exitCode}]\n${truncateOutput(output, 6000)}`,
    });
    if (entry) {
      broadcast({
        type: 'gbrain:remember',
        payload: { id: entry.id, title: entry.title, at: entry.at, roomId },
      });
    }
  } catch (err) {
    console.error('[GBrain] remember failed:', err);
  }

  if (!linear || !room.linearIssueId) return;

  if (exitCode === 0) {
    const summary = truncateOutput(output, 3000);
    const commentBody = [
      `## Agent completed successfully`,
      '',
      '```',
      summary,
      '```',
    ].join('\n');

    const commented = await linear.addComment(room.linearIssueId, commentBody);
    console.log(`[Linear] comment on ${room.linearIdentifier}: ${commented ? 'ok' : 'failed'}`);

    const transitioned = await linear.transitionIssue(room.linearIssueId, REVIEW_STATE);
    console.log(`[Linear] transition ${room.linearIdentifier} → ${REVIEW_STATE}: ${transitioned ? 'ok' : 'failed'}`);

    if (transitioned) {
      room.linearState = REVIEW_STATE;
      broadcast({ type: 'room:updated', payload: roomToPayload(room) });
    }
  } else {
    const errSummary = truncateOutput(output, 2000);
    const commentBody = [
      `## Agent failed (exit code ${exitCode})`,
      '',
      '```',
      errSummary,
      '```',
    ].join('\n');

    await linear.addComment(room.linearIssueId, commentBody);
    console.log(`[Linear] posted error comment on ${room.linearIdentifier}`);
  }
});

function truncateOutput(output: string, maxLen: number): string {
  if (output.length <= maxLen) return output;
  const half = Math.floor(maxLen / 2) - 20;
  return output.slice(0, half) + '\n\n... (truncated) ...\n\n' + output.slice(-half);
}

// ---------------------------------------------------------------------------
// Room management
// ---------------------------------------------------------------------------

function createRoom(opts: {
  id?: string;
  title: string;
  description?: string;
  roomType?: RoomType;
  linearIssueId?: string;
  linearIdentifier?: string;
  linearState?: string;
}): Room {
  const id = opts.id ?? slugify(opts.title);
  if (rooms.has(id)) return rooms.get(id)!;

  const room: Room = {
    id,
    linearIssueId: opts.linearIssueId,
    linearIdentifier: opts.linearIdentifier,
    linearState: opts.linearState,
    title: opts.title,
    description: opts.description ?? '',
    roomType: opts.roomType ?? classifyPrompt(opts.title + ' ' + (opts.description ?? '')),
    agentState: 'idle',
    characterIndex: nextCharacterIndex(),
    createdAt: new Date().toISOString(),
  };

  rooms.set(id, room);
  broadcast({ type: 'room:created', payload: roomToPayload(room) });
  return room;
}

function removeRoom(id: string): boolean {
  if (!rooms.has(id)) return false;
  agents.stop(id);
  rooms.delete(id);
  broadcast({ type: 'room:removed', payload: { id } });
  return true;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || `room-${randomInt(1000, 9999)}`;
}

// ---------------------------------------------------------------------------
// Linear sync
// ---------------------------------------------------------------------------

async function syncLinear(): Promise<{ created: number; removed: number }> {
  if (!linear) return { created: 0, removed: 0 };

  let issues: LinearIssue[];
  try {
    issues = await linear.fetchActiveIssues();
  } catch (err) {
    console.error('[Linear] sync failed:', err);
    return { created: 0, removed: 0 };
  }

  const issueIds = new Set(issues.map((i) => i.id));
  let created = 0;
  let removed = 0;
  let started = 0;

  function shouldStartAgent(stateName: string): boolean {
    return AGENT_TRIGGER_STATES.some(
      (s) => s.toLowerCase() === stateName.toLowerCase(),
    );
  }

  for (const issue of issues) {
    const existing = [...rooms.values()].find((r) => r.linearIssueId === issue.id);

    // Track comments we've already seen for this issue
    const commentNodes = issue.comments?.nodes ?? [];
    if (!seenCommentIds.has(issue.id)) {
      seenCommentIds.set(issue.id, new Set(commentNodes.map(c => c.id)));
    }
    const seen = seenCommentIds.get(issue.id)!;

    if (!existing) {
      // New issue — create the room
      const room = createRoom({
        id: slugify(issue.identifier + '-' + issue.title),
        title: `${issue.identifier}: ${issue.title}`,
        description: issue.description ?? '',
        linearIssueId: issue.id,
        linearIdentifier: issue.identifier,
        linearState: issue.state.name,
      });
      created++;

      // Mark all current comments as seen
      for (const c of commentNodes) seen.add(c.id);

      if (shouldStartAgent(issue.state.name)) {
        const prompt = buildAgentPrompt(issue);
        agents.start(room.id, prompt);
        started++;
      }
    } else {
      const prevState = existing.linearState;
      const newState = issue.state.name;

      // Find new human comments (not posted by our API key / bot)
      const newHumanComments = commentNodes.filter(
        c => !seen.has(c.id) && !c.user.isMe,
      );
      for (const c of commentNodes) seen.add(c.id);

      if (prevState !== newState) {
        existing.linearState = newState;
        console.log(`[Linear] ${issue.identifier} state: ${prevState} → ${newState}`);

        if (shouldStartAgent(newState) && !agents.isRunning(existing.id)) {
          const prompt = buildResumePrompt(issue, newHumanComments);
          agents.start(existing.id, prompt);
          started++;
        }

        broadcast({ type: 'room:updated', payload: roomToPayload(existing) });
      } else if (newHumanComments.length > 0 && shouldStartAgent(newState) && !agents.isRunning(existing.id)) {
        // Same state but new comments arrived — re-trigger agent
        console.log(`[Linear] ${issue.identifier}: ${newHumanComments.length} new comment(s), re-triggering agent`);
        const prompt = buildResumePrompt(issue, newHumanComments);
        agents.start(existing.id, prompt);
        started++;
      }
    }
  }

  // Remove rooms whose issues left all active states
  for (const [id, room] of rooms) {
    if (room.linearIssueId && !issueIds.has(room.linearIssueId)) {
      removeRoom(id);
      removed++;
    }
  }

  console.log(`[Linear] synced: ${issues.length} issues, +${created} rooms, -${removed} rooms, ${started} agents started`);
  return { created, removed };
}

function buildAgentPrompt(issue: LinearIssue): string {
  const parts = [
    `Work on the following task from Linear issue ${issue.identifier}:`,
    '',
    `Title: ${issue.title}`,
  ];
  if (issue.description) {
    parts.push('', 'Description:', issue.description);
  }
  if (issue.labels?.nodes?.length) {
    parts.push('', `Labels: ${issue.labels.nodes.map((l) => l.name).join(', ')}`);
  }
  return parts.join('\n');
}

interface ReviewComment {
  id: string;
  body: string;
  createdAt: string;
  user: { name: string; isMe: boolean };
}

function buildResumePrompt(issue: LinearIssue, newComments: ReviewComment[]): string {
  const parts = [
    `Resume work on Linear issue ${issue.identifier}:`,
    '',
    `Title: ${issue.title}`,
  ];
  if (issue.description) {
    parts.push('', 'Description:', issue.description);
  }
  if (newComments.length > 0) {
    parts.push('', '---', '', 'Review feedback that needs to be addressed:');
    for (const c of newComments) {
      parts.push('', `From ${c.user.name} (${c.createdAt}):`);
      parts.push(c.body);
    }
    parts.push('', '---', '', 'Please address ALL the review feedback above and fix any issues mentioned.');
  }
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------

const wsClients = new Set<WebSocket>();

function broadcast(msg: WsMessageOut): void {
  const data = JSON.stringify(msg);
  for (const ws of wsClients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  }
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express();
app.use(cors());
app.use(express.json());

// --- REST routes ---

app.get('/api/rooms', (_req, res) => {
  res.json({ rooms: [...rooms.values()].map(roomToPayload) });
});

app.post('/api/rooms', (req, res) => {
  const { title, description, roomType } = req.body as {
    title?: string;
    description?: string;
    roomType?: RoomType;
  };
  if (!title) {
    res.status(400).json({ error: 'title is required' });
    return;
  }
  const room = createRoom({ title, description, roomType });
  res.status(201).json(roomToPayload(room));
});

app.delete('/api/rooms/:id', (req, res) => {
  const ok = removeRoom(req.params.id);
  res.json({ ok });
});

app.post('/api/rooms/:id/agent/start', async (req, res) => {
  const room = rooms.get(req.params.id);
  if (!room) { res.status(404).json({ error: 'room not found' }); return; }

  const prompt = (req.body as { prompt?: string }).prompt
    ?? `Work on: ${room.title}\n\n${room.description}`;
  const started = await agents.start(room.id, prompt);
  res.json({ started });
});

app.post('/api/rooms/:id/agent/stop', (req, res) => {
  const ok = agents.stop(req.params.id);
  res.json({ ok });
});

app.get('/api/rooms/:id/terminal', (req, res) => {
  const history = terminalHistory.get(req.params.id) ?? [];
  res.json({ lines: history });
});

app.post('/api/rooms/:id/terminal', (req, res) => {
  const { input } = req.body as { input?: string };
  if (!input) { res.status(400).json({ error: 'input is required' }); return; }
  const ok = agents.sendInput(req.params.id, input);
  res.json({ ok });
});

app.post('/api/linear/sync', async (_req, res) => {
  const result = await syncLinear();
  res.json(result);
});

app.get('/api/gbrain/health', (_req, res) => {
  res.json({ ready: true, entries: gbrain.count });
});

app.get('/api/gbrain/search', async (req, res) => {
  const query = String(req.query.q ?? '');
  const rawLimit = parseInt(String(req.query.limit ?? '4'), 10);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 20) : 4;
  try {
    const hits = await gbrain.search(query, limit);
    broadcast({ type: 'gbrain:search', payload: { query, hits: hits.length } });
    res.json({ hits });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/api/gbrain/remember', async (req, res) => {
  try {
    const entry = await gbrain.remember(req.body ?? {});
    if (entry) {
      broadcast({
        type: 'gbrain:remember',
        payload: { id: entry.id, title: entry.title, at: entry.at },
      });
    }
    res.json({ ok: true, entry });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get('/api/status', (_req, res) => {
  res.json({
    rooms: rooms.size,
    runningAgents: agents.runningCount,
    linearConnected: !!linear,
    maxConcurrent: MAX_CONCURRENT,
    gbrainEntries: gbrain.count,
  });
});

// ---------------------------------------------------------------------------
// HTTP + WS server
// ---------------------------------------------------------------------------

const httpServer = createServer(app);

const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

wss.on('connection', (ws) => {
  wsClients.add(ws);
  console.log(`[WS] client connected (${wsClients.size} total)`);

  // Send current state on connect
  ws.send(JSON.stringify({
    type: 'rooms:sync',
    payload: { rooms: [...rooms.values()].map(roomToPayload) },
  }));

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      handleWsMessage(ws, msg);
    } catch {
      // ignore malformed messages
    }
  });

  ws.on('close', () => {
    wsClients.delete(ws);
    console.log(`[WS] client disconnected (${wsClients.size} total)`);
  });
});

function handleWsMessage(ws: WebSocket, msg: { type: string; payload?: Record<string, unknown> }): void {
  switch (msg.type) {
    case 'terminal:input': {
      const { roomId, input } = (msg.payload ?? {}) as { roomId?: string; input?: string };
      if (roomId && input) agents.sendInput(roomId, input);
      break;
    }
    case 'rooms:request': {
      ws.send(JSON.stringify({
        type: 'rooms:sync',
        payload: { rooms: [...rooms.values()].map(roomToPayload) },
      }));
      break;
    }
    case 'room:create': {
      const { title, description, roomType } = (msg.payload ?? {}) as {
        title?: string;
        description?: string;
        roomType?: RoomType;
      };
      if (title) {
        const room = createRoom({ title, description, roomType });
        // Manual tasks always start an agent immediately
        agents.start(room.id, `Work on: ${room.title}\n\n${room.description}`);
      }
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`AgentDevStory backend listening on http://0.0.0.0:${PORT}`);
  console.log(`  Linear: ${linear ? 'connected' : 'no API key'}`);
  console.log(`  Claude CMD: ${CLAUDE_CMD}`);
  console.log(`  Workspace root: ${WORKSPACE_ROOT}`);
  console.log(`  Target repo: ${TARGET_REPO ?? '(none, using workspace dirs)'}`);
  console.log(`  Max concurrent agents: ${MAX_CONCURRENT}`);
  console.log(`  Room states: ${ACTIVE_STATES.join(', ')}`);
  console.log(`  Agent trigger states: ${AGENT_TRIGGER_STATES.join(', ')}`);
  console.log(`  G-Brain: ${gbrain.count} entries (${GBRAIN_DATA_DIR})`);

  if (linear) {
    syncLinear();
    setInterval(() => syncLinear(), POLL_INTERVAL);
  }
});

process.on('SIGTERM', () => {
  console.log('Shutting down...');
  agents.stopAll();
  httpServer.close();
});

process.on('SIGINT', () => {
  console.log('Shutting down...');
  agents.stopAll();
  httpServer.close();
  process.exit(0);
});
