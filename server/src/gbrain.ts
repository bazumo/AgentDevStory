import path from "node:path";
import { mkdir, readFile, stat } from "node:fs/promises";
import type { AgentSession } from "../../shared/types";

export type GBrainMemoryHit = {
  id: string;
  sourceSessionId: string;
  title: string;
  text: string;
  score: number;
  at: string;
};

type GBrainMemoryEntry = Omit<GBrainMemoryHit, "score">;

type PersistedGBrain = {
  entries: GBrainMemoryEntry[];
};

export class GBrainMemory {
  private readonly filePath: string;
  private entries: GBrainMemoryEntry[] = [];

  constructor(dataDir: string, private readonly seedRoot: string | null = null) {
    this.filePath = path.join(dataDir, "gbrain.json");
  }

  async load(): Promise<void> {
    try {
      const file = Bun.file(this.filePath);
      if (await file.exists()) {
        const parsed = (await file.json()) as Partial<PersistedGBrain>;
        this.entries = Array.isArray(parsed.entries) ? parsed.entries : [];
      }
    } catch {
      this.entries = [];
    }

    if (await this.seedFromRepository()) {
      await this.save();
    }
  }

  async search(query: string, limit = 5): Promise<GBrainMemoryHit[]> {
    const queryTerms = terms(query);
    if (queryTerms.size === 0) return [];

    return this.entries
      .map((entry) => ({ ...entry, score: scoreEntry(entry, queryTerms) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || b.at.localeCompare(a.at))
      .slice(0, limit);
  }

  async rememberSession(session: AgentSession): Promise<void> {
    const text = session.transcript
      .filter((event) => event.kind !== "user")
      .map((event) => event.message)
      .filter(Boolean)
      .slice(-40)
      .join("\n")
      .slice(0, 8000);

    if (!text.trim()) return;

    const entry: GBrainMemoryEntry = {
      id: `session:${session.id}`,
      sourceSessionId: session.id,
      title: `${session.issueIdentifier} (${session.status})`,
      text,
      at: new Date().toISOString()
    };

    const idx = this.entries.findIndex((item) => item.id === entry.id);
    if (idx >= 0) this.entries[idx] = entry;
    else this.entries.push(entry);

    this.entries = this.entries
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 500);

    await this.save();
  }

  formatHits(hits: GBrainMemoryHit[]): string {
    if (!hits.length) return "No relevant g-brain memories found.";
    return hits
      .map((hit, index) => {
        const body = hit.text.replace(/\s+/g, " ").slice(0, 1200);
        return `${index + 1}. ${hit.title}\nSource: ${hit.sourceSessionId}\nRelevance: ${hit.score}\n${body}`;
      })
      .join("\n\n");
  }

  private async save(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await Bun.write(this.filePath, JSON.stringify({ entries: this.entries }, null, 2));
  }

  private async seedFromRepository(): Promise<boolean> {
    if (!this.seedRoot) return false;

    const seedFiles = [
      "README.md",
      "package.json",
      "src/api.js",
      "src/main.js",
      "src/ui.js",
      "src/scenes/AgencyFloorScene.js",
      "src/world/Agent.js",
      "server/src/orchestrator.ts",
      "server/src/runner.ts",
      "server/src/http.ts",
      "shared/types.ts",
      "shared/api-contract.ts"
    ];

    let changed = false;
    for (const relativePath of seedFiles) {
      const filePath = path.join(this.seedRoot, relativePath);
      try {
        const info = await stat(filePath);
        if (!info.isFile()) continue;

        const text = (await readFile(filePath, "utf8")).slice(0, 12_000);
        if (!text.trim()) continue;

        const entry: GBrainMemoryEntry = {
          id: `repo:${relativePath}`,
          sourceSessionId: "repo",
          title: `Repo context: ${relativePath}`,
          text,
          at: info.mtime.toISOString()
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
        // Missing optional seed files are fine; g-brain still uses session memory.
      }
    }

    this.entries = this.entries
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 500);
    return changed;
  }
}

function scoreEntry(entry: GBrainMemoryEntry, queryTerms: Set<string>): number {
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
      .filter((term) => term.length >= 3)
  );
}
