import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const GBRAIN = process.env.GBRAIN_CMD ?? 'gbrain';
const TIMEOUT = 10_000;

export type GBrainMemoryHit = {
  id: string;
  sourceSessionId: string;
  title: string;
  text: string;
  score: number;
  at: string;
};

type GBrainMemoryEntry = Omit<GBrainMemoryHit, 'score'>;

type RememberInput = {
  sourceSessionId?: string;
  title?: string;
  text?: string;
};

export class GBrainMemory {
  private _count = 0;

  constructor(_dataDir: string, _seedRoot: string) {}

  get count(): number {
    return this._count;
  }

  async load(): Promise<void> {
    try {
      const { stdout } = await exec(GBRAIN, ['list'], { timeout: TIMEOUT });
      this._count = stdout.trim().split('\n').filter(Boolean).length;
    } catch {
      this._count = 0;
    }
  }

  async search(query: string, limit = 4): Promise<GBrainMemoryHit[]> {
    if (!query.trim()) return [];

    try {
      const { stdout } = await exec(
        GBRAIN,
        ['query', query, '--limit', String(limit), '--detail', 'low'],
        { timeout: TIMEOUT },
      );

      return parseQueryOutput(stdout, limit);
    } catch (err) {
      console.error('[GBrain] search failed:', err);
      return [];
    }
  }

  async remember(input: RememberInput): Promise<GBrainMemoryEntry | null> {
    const text = String(input.text ?? '').trim().slice(0, 8000);
    if (!text) return null;

    const sourceSessionId = String(input.sourceSessionId ?? 'manual');
    const title = String(input.title ?? sourceSessionId).slice(0, 200);
    const slug = `agent-runs/${slugify(sourceSessionId)}`;
    const now = new Date().toISOString();

    const content = [
      '---',
      `title: "${title.replace(/"/g, '\\"')}"`,
      'type: concept',
      `tags: [agent-run]`,
      '---',
      '',
      text,
    ].join('\n');

    try {
      await exec(GBRAIN, ['put', slug, '--content', content], { timeout: TIMEOUT });
      this._count++;
      return { id: slug, sourceSessionId, title, text, at: now };
    } catch (err) {
      console.error('[GBrain] remember failed:', err);
      return null;
    }
  }
}

function parseQueryOutput(stdout: string, limit: number): GBrainMemoryHit[] {
  const lines = stdout.trim().split('\n').filter(Boolean);
  const hits: GBrainMemoryHit[] = [];

  for (const line of lines) {
    if (hits.length >= limit) break;

    const match = line.match(/^\[([0-9.]+)\]\s+(\S+)\s+--\s+(.*)$/);
    if (match) {
      const [, scoreStr, slug, preview] = match;
      hits.push({
        id: slug,
        sourceSessionId: 'gbrain',
        title: slug,
        text: preview,
        score: parseFloat(scoreStr),
        at: new Date().toISOString(),
      });
    }
  }

  return hits;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'unknown';
}
