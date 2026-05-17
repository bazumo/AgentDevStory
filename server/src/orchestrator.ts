import { mkdir } from "node:fs/promises";
import type {
  AgentEvent,
  AgentSession,
  ApiEvent,
  CreateProjectRequest,
  CreateProjectResponse,
  HealthResponse,
  LinearIssue,
  LinearProject,
  WorldState
} from "../../shared/types";
import type { AppConfig } from "./config";
import { readinessErrors } from "./config";
import { LinearGateway } from "./linear";
import { StateStore } from "./persist";
import { AgentRunner } from "./runner";
import { GBrainMemory } from "./gbrain";
import { SymphonyGateway, type SymphonyRetryEntry, type SymphonyRunningEntry } from "./symphony";

type ProjectRecord = LinearProject & {
  issues: Map<string, LinearIssue>;
};

type RetryState = {
  attempt: number;
  dueAt: number;
};

const professions = ["Engineer", "Reviewer", "Designer", "QA", "Release", "Research"];

export class Orchestrator {
  private readonly linear: LinearGateway;
  private readonly symphony: SymphonyGateway;
  private readonly gbrain: GBrainMemory;
  private readonly runner: AgentRunner;
  private readonly store: StateStore;
  private readonly startedAt = Date.now();
  private readonly projects = new Map<string, ProjectRecord>();
  private readonly sessions = new Map<string, AgentSession>();
  private readonly runningIssueIds = new Set<string>();
  private readonly completedIssueIds = new Set<string>();
  private readonly retries = new Map<string, RetryState>();
  private readonly subscribers = new Set<(event: ApiEvent) => void>();
  private timer: Timer | null = null;
  private polling = false;

  constructor(private readonly config: AppConfig) {
    this.linear = new LinearGateway(config.linearApiKey);
    this.symphony = new SymphonyGateway(config.symphonyApiUrl, config.symphonyApiKey);
    this.gbrain = new GBrainMemory(config.dataDir, config.targetRepo);
    this.runner = new AgentRunner(config);
    this.store = new StateStore(config.dataDir);
  }

  async start(): Promise<void> {
    await mkdir(this.config.dataDir, { recursive: true });
    await mkdir(this.config.workspaceRoot, { recursive: true });
    await this.gbrain.load();
    await this.restore();
    await this.poll();
    this.timer = setInterval(() => void this.poll(), this.config.pollIntervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  subscribe(callback: (event: ApiEvent) => void): () => void {
    this.subscribers.add(callback);
    callback({ type: "world", world: this.world() });

    return () => {
      this.subscribers.delete(callback);
    };
  }

  health(): HealthResponse {
    return {
      ...this.world().backend,
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      watchedProjects: this.projects.size
    };
  }

  async listTeams() {
    return this.linear.listTeams();
  }

  async symphonyStatus() {
    return this.symphony.state();
  }

  async syncSymphony() {
    const status = await this.symphony.refresh();
    await this.updateFromSymphony();
    this.emit({ type: "world", world: this.world() });
    return status;
  }

  async searchGBrain(query: string) {
    return { hits: await this.gbrain.search(query) };
  }

  async createProject(input: CreateProjectRequest): Promise<CreateProjectResponse> {
    if (!input.teamId?.trim()) throw new Error("teamId is required");
    if (!input.name?.trim()) throw new Error("name is required");

    const created = await this.linear.createProject({
      teamId: input.teamId.trim(),
      name: input.name.trim(),
      description: input.description?.trim()
    });

    const project: LinearProject = {
      id: created.id,
      name: created.name,
      url: created.url,
      createdAt: new Date().toISOString()
    };

    this.projects.set(project.id, { ...project, issues: new Map() });
    await this.persist();
    this.emit({ type: "world", world: this.world() });
    void this.poll();

    return {
      projectId: project.id,
      name: project.name,
      url: project.url
    };
  }

  createSession(prompt: string): AgentSession {
    const trimmed = prompt.trim();
    if (!trimmed) throw new Error("prompt is required");

    const projectId = "manual";
    let project = this.projects.get(projectId);
    if (!project) {
      project = {
        id: projectId,
        name: "Manual Codex Sessions",
        url: null,
        createdAt: new Date().toISOString(),
        issues: new Map()
      };
      this.projects.set(projectId, project);
    }

    const id = crypto.randomUUID();
    const issue: LinearIssue = {
      id,
      identifier: `MANUAL-${String(this.sessions.size + 1).padStart(3, "0")}`,
      title: trimmed.slice(0, 120),
      description: trimmed,
      priority: null,
      state: "Manual",
      stateType: "started",
      branchName: null,
      url: null,
      labels: ["manual"],
      blockedBy: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      runState: "running"
    };

    project.issues.set(issue.id, issue);
    const session = this.startSession(project, issue);
    void this.persist();
    return session;
  }

  getSession(id: string): AgentSession | null {
    return this.sessions.get(id) ?? null;
  }

  sendSessionInput(id: string, message: string): AgentSession {
    const session = this.sessions.get(id);
    if (!session) throw new Error("Session not found");
    if (session.status === "running") throw new Error("Session is already running; wait for the current Codex turn to finish");

    const trimmed = message.trim();
    if (!trimmed) throw new Error("message is required");

    session.status = "running";
    session.completedAt = null;
    session.startedAt ??= new Date().toISOString();
    this.runningIssueIds.add(session.issueId);
    this.recordEvent(session, userEvent(trimmed));
    this.emit({ type: "world", world: this.world() });

    void this.retrieveMemory(session, trimmed)
      .then((memoryContext) => this.runner.runPromptInSession(session, trimmed, {
        onEvent: (agentEvent) => this.recordEvent(session, agentEvent)
      }, memoryContext))
      .then(() => {
        session.status = "completed";
        session.completedAt = new Date().toISOString();
        this.recordEvent(session, lifecycle("Completed"));
        void this.gbrain.rememberSession(session);
      })
      .catch((error) => {
        session.status = "failed";
        session.completedAt = new Date().toISOString();
        this.recordEvent(session, {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          kind: "error",
          message: errorMessage(error)
        });
      })
      .finally(() => {
        this.runningIssueIds.delete(session.issueId);
        void this.persist();
        this.emit({ type: "session", session });
        this.emit({ type: "world", world: this.world() });
      });

    return session;
  }

  world(): WorldState {
    const errors = readinessErrors(this.config);

    return {
      generatedAt: new Date().toISOString(),
      mode: this.linear.configured ? "live" : "unconfigured",
      backend: {
        ready: errors.length === 0,
        linearConfigured: this.linear.configured,
        symphonyConfigured: this.symphony.configured,
        targetRepoConfigured: this.runner.canRunRealAgents(),
        gbrainConfigured: true,
        agentCommand: this.config.codexCommand.join(" "),
        agentExecutableFound: this.config.codexCommand.length > 0 && Boolean(Bun.which(this.config.codexCommand[0])),
        runningAgents: this.runningIssueIds.size,
        maxConcurrentAgents: this.config.maxConcurrentAgents,
        errors
      },
      projects: Array.from(this.projects.values()).map((project) => ({
        id: project.id,
        name: project.name,
        url: project.url,
        createdAt: project.createdAt,
        issues: Array.from(project.issues.values()).sort(sortIssues)
      })),
      sessions: Array.from(this.sessions.values()).sort(sortSessions)
    };
  }

  private async restore(): Promise<void> {
    const persisted = await this.store.load();
    const restoredProjects = [
      ...persisted.projects,
      ...this.config.watchedProjectIds.map((id) => ({
        id,
        name: `Linear Project ${id.slice(0, 8)}`,
        url: null,
        createdAt: new Date().toISOString()
      }))
    ];

    for (const project of restoredProjects) {
      if (!this.projects.has(project.id)) {
        this.projects.set(project.id, { ...project, issues: new Map() });
      }
    }

    for (const session of persisted.sessions) {
      if (session.status === "running" || session.status === "queued") {
        session.status = "stopped";
        session.completedAt = new Date().toISOString();
        session.latestEvent = "Codex process detached by backend restart";
        session.transcript = [
          ...(session.transcript ?? []),
          lifecycle("Codex process detached by backend restart")
        ].slice(-120);
      }

      this.sessions.set(session.id, session);
      if (session.status === "completed") this.completedIssueIds.add(session.issueId);
    }

    if (!this.linear.configured && this.projects.size > 0) this.projects.clear();
  }

  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;

    try {
      if (this.linear.configured) {
        for (const project of this.projects.values()) {
          const issues = await this.linear.fetchProjectIssues(project.id, this.config.activeLinearStates);
          for (const issue of issues) {
            project.issues.set(issue.id, this.withRunState(issue));
          }
        }

        this.dispatchAvailable();
      }

      await this.updateFromSymphony();
      this.emit({ type: "world", world: this.world() });
    } catch (error) {
      this.emit({ type: "error", message: errorMessage(error) });
    } finally {
      this.polling = false;
    }
  }

  private dispatchAvailable(): void {
    if (this.runningIssueIds.size >= this.config.maxConcurrentAgents) return;

    const candidates = Array.from(this.projects.values())
      .flatMap((project) => Array.from(project.issues.values()).map((issue) => ({ project, issue })))
      .filter(({ issue }) => this.shouldDispatch(issue))
      .sort((a, b) => sortIssues(a.issue, b.issue));

    for (const { project, issue } of candidates) {
      if (this.runningIssueIds.size >= this.config.maxConcurrentAgents) return;
      void this.startSession(project, issue);
    }
  }

  private shouldDispatch(issue: LinearIssue): boolean {
    if (this.runningIssueIds.has(issue.id)) return false;
    if (this.completedIssueIds.has(issue.id)) return false;
    if (this.config.terminalLinearStates.includes(issue.state)) return false;
    if (issue.blockedBy.some((blocker) => !this.config.terminalLinearStates.includes(blocker.state ?? ""))) return false;

    const retry = this.retries.get(issue.id);
    if (retry && retry.dueAt > Date.now()) return false;

    return this.config.activeLinearStates.includes(issue.state);
  }

  private startSession(project: ProjectRecord, issue: LinearIssue): AgentSession {
    const retry = this.retries.get(issue.id);
    const attempt = retry?.attempt ?? 1;
    const session: AgentSession = {
      id: `${issue.identifier}-${Date.now()}`,
      issueId: issue.id,
      issueIdentifier: issue.identifier,
      projectId: project.id,
      status: "running",
      attempt,
      character: `character-${String(((this.sessions.size + attempt) % 10) + 1).padStart(2, "0")}`,
      profession: professions[this.sessions.size % professions.length],
      workspacePath: null,
      startedAt: new Date().toISOString(),
      completedAt: null,
      latestEvent: "Queued",
      transcript: []
    };

    this.retries.delete(issue.id);
    this.sessions.set(session.id, session);
    this.runningIssueIds.add(issue.id);
    project.issues.set(issue.id, this.withRunState(issue));
    this.emit({ type: "session", session });
    this.emit({ type: "world", world: this.world() });

    void this.retrieveMemory(session, `${issue.identifier} ${issue.title}\n${issue.description ?? ""}`)
      .then((memoryContext) => this.runner.run(issue, project, session, {
        onEvent: (agentEvent) => this.recordEvent(session, agentEvent)
      }, memoryContext))
      .then(() => {
        session.status = "completed";
        session.completedAt = new Date().toISOString();
        this.completedIssueIds.add(issue.id);
        this.recordEvent(session, lifecycle("Completed"));
        void this.gbrain.rememberSession(session);
      })
      .catch((error) => {
        session.status = "failed";
        session.completedAt = new Date().toISOString();
        this.retries.set(issue.id, {
          attempt: attempt + 1,
          dueAt: Date.now() + this.config.retryBaseMs * attempt
        });
        this.recordEvent(session, {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          kind: "error",
          message: errorMessage(error)
        });
      })
      .finally(() => {
        this.runningIssueIds.delete(issue.id);
        project.issues.set(issue.id, this.withRunState(issue));
        void this.persist();
        this.emit({ type: "session", session });
        this.emit({ type: "world", world: this.world() });
        this.dispatchAvailable();
      });

    return session;
  }

  private recordEvent(session: AgentSession, agentEvent: AgentEvent): void {
    session.transcript.push(agentEvent);
    session.transcript = session.transcript.slice(-120);
    session.latestEvent = agentEvent.message;
    this.emit({ type: "session", session });
  }

  private async retrieveMemory(session: AgentSession, query: string): Promise<string> {
    this.recordEvent(session, gbrainEvent("Walking to g-brain to retrieve relevant memory"));
    const hits = await this.gbrain.search(query);
    this.recordEvent(session, gbrainEvent(`Retrieved ${hits.length} g-brain memories`));
    return this.gbrain.formatHits(hits);
  }

  private withRunState(issue: LinearIssue): LinearIssue {
    if (this.config.terminalLinearStates.includes(issue.state)) return { ...issue, runState: "terminal" };
    if (this.runningIssueIds.has(issue.id)) return { ...issue, runState: "running" };
    if (this.completedIssueIds.has(issue.id)) return { ...issue, runState: "completed" };
    if (this.retries.has(issue.id)) return { ...issue, runState: "failed" };
    return { ...issue, runState: "idle" };
  }

  private emit(event: ApiEvent): void {
    for (const subscriber of this.subscribers) subscriber(event);
  }

  private async updateFromSymphony(): Promise<void> {
    if (!this.symphony.configured) return;

    const status = await this.symphony.state();
    const state = status.state;
    if (!state || state.error) return;

    const activeSessionIds = new Set<string>();

    for (const entry of state.running ?? []) {
      const session = this.upsertSymphonySession(entry, "running");
      activeSessionIds.add(session.id);
    }

    for (const entry of state.retrying ?? []) {
      const session = this.upsertSymphonySession(entry, "failed");
      activeSessionIds.add(session.id);
    }

    for (const session of this.sessions.values()) {
      if (session.projectId !== "symphony") continue;
      if (activeSessionIds.has(session.id)) continue;
      if (session.status !== "completed") {
        session.status = "completed";
        session.completedAt = new Date().toISOString();
        this.recordEvent(session, lifecycle("[symphony] No longer active in Symphony"));
      }
    }
  }

  private upsertSymphonySession(entry: SymphonyRunningEntry | SymphonyRetryEntry, status: AgentSession["status"]): AgentSession {
    const identifier = entry.issue_identifier ?? entry.issue_id ?? "unknown";
    const id = `symphony:${identifier}`;
    const existing = this.sessions.get(id);
    const latestEvent = symphonyMessage(entry, status);
    const session = existing ?? {
      id,
      issueId: entry.issue_id ?? id,
      issueIdentifier: identifier,
      projectId: "symphony",
      status,
      attempt: "attempt" in entry && typeof entry.attempt === "number" ? entry.attempt : 1,
      character: `character-${String((stableIndex(identifier) % 10) + 1).padStart(2, "0")}`,
      profession: "Symphony",
      workspacePath: entry.workspace_path ?? null,
      startedAt: "started_at" in entry && typeof entry.started_at === "string" ? entry.started_at : new Date().toISOString(),
      completedAt: null,
      latestEvent,
      transcript: []
    } satisfies AgentSession;

    session.status = status;
    session.workspacePath = entry.workspace_path ?? session.workspacePath;
    session.completedAt = status === "running" ? null : session.completedAt;
    session.latestEvent = latestEvent;
    if ("attempt" in entry && typeof entry.attempt === "number") session.attempt = entry.attempt;
    if (!existing) this.sessions.set(id, session);

    const previous = session.transcript[session.transcript.length - 1]?.message;
    if (previous !== latestEvent) {
      this.recordEvent(session, lifecycle(`[symphony] ${latestEvent}`));
    } else if (!existing) {
      this.emit({ type: "session", session });
    }

    return session;
  }

  private async persist(): Promise<void> {
    await this.store.save({
      projects: Array.from(this.projects.values()).map((project) => ({
        id: project.id,
        name: project.name,
        url: project.url,
        createdAt: project.createdAt
      })),
      sessions: Array.from(this.sessions.values())
    });
  }
}

function lifecycle(message: string): AgentEvent {
  return {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    kind: "lifecycle",
    message
  };
}

function userEvent(message: string): AgentEvent {
  return {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    kind: "user",
    message
  };
}

function gbrainEvent(message: string): AgentEvent {
  return {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    kind: "gbrain",
    message
  };
}

function symphonyMessage(entry: SymphonyRunningEntry | SymphonyRetryEntry, status: AgentSession["status"]): string {
  if ("last_message" in entry && entry.last_message) return entry.last_message;
  if ("last_event" in entry && entry.last_event) return entry.last_event;
  if ("error" in entry && entry.error) return entry.error;
  if (status === "failed") return "Retrying in Symphony";
  return "Running in Symphony";
}

function stableIndex(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sortIssues(a: LinearIssue, b: LinearIssue): number {
  const priorityA = a.priority ?? 999;
  const priorityB = b.priority ?? 999;
  if (priorityA !== priorityB) return priorityA - priorityB;
  return a.identifier.localeCompare(b.identifier);
}

function sortSessions(a: AgentSession, b: AgentSession): number {
  return (b.startedAt ?? "").localeCompare(a.startedAt ?? "");
}
