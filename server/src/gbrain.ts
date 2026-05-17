import path from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';

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
  private readonly filePath: string;
  private entries: GBrainMemoryEntry[] = [];

  constructor(dataDir: string, private readonly seedRoot: string) {
    this.filePath = path.join(dataDir, 'gbrain.json');
  }

  get count(): number {
    return this.entries.length;
  }

  async load(): Promise<void> {
    try {
      if (existsSync(this.filePath)) {
        const text = await readFile(this.filePath, 'utf8');
        const parsed = JSON.parse(text);
        this.entries = Array.isArray(parsed.entries) ? parsed.entries : [];
      }
    } catch {
      this.entries = [];
    }

    if (await this.seedFromRepository()) {
      await this.save();
    }
  }

  async search(query: string, limit = 4): Promise<GBrainMemoryHit[]> {
    const queryTerms = terms(query);
    const scored = this.entries
      .map((entry) => ({ ...entry, score: scoreEntry(entry, queryTerms) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || b.at.localeCompare(a.at))
      .slice(0, limit);

    return scored.length ? scored : this.fallbackRepoContext(limit);
  }

  async remember(input: RememberInput): Promise<GBrainMemoryEntry | null> {
    const text = String(input.text ?? '').trim().slice(0, 8000);
    if (!text) return null;

    const sourceSessionId = String(input.sourceSessionId ?? 'manual');
    const title = String(input.title ?? sourceSessionId).slice(0, 200);
    const entry: GBrainMemoryEntry = {
      id: `session:${sourceSessionId}:${hash(`${title}\n${text}`)}`,
      sourceSessionId,
      title,
      text,
      at: new Date().toISOString(),
    };

    const index = this.entries.findIndex((item) => item.id === entry.id);
    if (index >= 0) this.entries[index] = entry;
    else this.entries.unshift(entry);

    this.entries = this.entries.slice(0, 500);
    await this.save();
    return entry;
  }

  private async save(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify({ entries: this.entries }, null, 2), 'utf8');
  }

  private fallbackRepoContext(limit: number): GBrainMemoryHit[] {
    const priority = [
      'repo:README.md',
      'repo:src/ui.js',
      'repo:src/scenes/AgencyFloorScene.js',
      'repo:src/world/Agent.js',
      'repo:src/gbrain.js',
    ];

    const byId = new Map(this.entries.map((entry) => [entry.id, entry]));
    return priority
      .map((id, index) => {
        const entry = byId.get(id);
        return entry ? { ...entry, score: Math.max(1, priority.length - index) } : null;
      })
      .filter((entry): entry is GBrainMemoryHit => entry !== null)
      .slice(0, limit);
  }

  private async seedFromRepository(): Promise<boolean> {
    const seedFiles = [
      'README.md',
      'package.json',
      'src/api.js',
      'src/gbrain.js',
      'src/main.js',
      'src/ui.js',
      'src/scenes/AgencyFloorScene.js',
      'src/world/Agent.js',
    ];

    let changed = false;
    for (const relativePath of seedFiles) {
      const filePath = path.join(this.seedRoot, relativePath);
      try {
        const info = await stat(filePath);
        if (!info.isFile()) continue;

        const text = (await readFile(filePath, 'utf8')).slice(0, 12000);
        if (!text.trim()) continue;

        const entry: GBrainMemoryEntry = {
          id: `repo:${relativePath}`,
          sourceSessionId: 'repo',
          title: `Repo context: ${relativePath}`,
          text,
          at: info.mtime.toISOString(),
        };

        const index = this.entries.findIndex((item) => item.id === entry.id);
        if (index >= 0) {
          if (this.entries[index].at !== entry.at || this.entries[index].text !== entry.text) {
            this.entries[index] = entry;
            changed = true;
          }
        } else {
          this.entries.push(entry);
          changed = true;
        }
      } catch {
        // Optional seed files are allowed to be absent.
      }
    }

    this.entries = this.entries
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 500);
    return changed;
  }
}

function scoreEntry(entry: GBrainMemoryEntry, queryTerms: Set<string>): number {
  if (queryTerms.size === 0) return 0;
  const entryTerms = terms(`${entry.title} ${entry.text}`);
  let score = 0;
  for (const term of queryTerms) {
    if (entryTerms.has(term)) score += term.length > 6 ? 2 : 1;
  }
  return score;
}

function terms(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9_/-]+/g)
      .map((term) => term.trim())
      .filter((term) => term.length >= 3),
  );
}

function hash(text: string): string {
  let value = 0;
  for (let i = 0; i < text.length; i++) {
    value = ((value << 5) - value + text.charCodeAt(i)) | 0;
  }
  return Math.abs(value).toString(36);
}
