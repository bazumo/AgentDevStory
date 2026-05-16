import path from "node:path";
import { mkdir } from "node:fs/promises";
import type { AgentSession, LinearProject } from "../../shared/types";

export type PersistedState = {
  projects: LinearProject[];
  sessions: AgentSession[];
};

const emptyState: PersistedState = {
  projects: [],
  sessions: []
};

export class StateStore {
  private readonly filePath: string;

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, "state.json");
  }

  async load(): Promise<PersistedState> {
    try {
      const file = Bun.file(this.filePath);
      if (!(await file.exists())) return emptyState;
      return { ...emptyState, ...((await file.json()) as Partial<PersistedState>) };
    } catch {
      return emptyState;
    }
  }

  async save(state: PersistedState): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await Bun.write(this.filePath, JSON.stringify(state, null, 2));
  }
}
