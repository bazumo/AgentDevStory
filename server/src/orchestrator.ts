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
    this.runner = new AgentRunner(config);
    this.store = new StateStore(config.dataDir);
  }

  async start(): Promise<void> {
    await mkdir(this.config.dataDir, { recursive: true });
    await mkdir(this.config.workspaceRoot, { recursive: true });
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

  getSession(id: string): AgentSession | null {
    return this.sessions.get(id) ?? null;
  }

  world(): WorldState {
    const errors = readinessErrors(this.config);

    return {
      generatedAt: new Date().toISOString(),
      mode: this.linear.configured ? "live" : "unconfigured",
      backend: {
        ready: errors.length === 0,
        linearConfigured: this.linear.configured,
        targetRepoConfigured: this.runner.canRunRealAgents(),
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
      this.sessions.set(session.id, session);
      if (session.status === "completed") this.completedIssueIds.add(session.issueId);
    }

    if (!this.linear.configured && this.projects.size > 0) this.projects.clear();
  }

  private async poll(): Promise<void> {
    if (this.polling) return;
    if (!this.linear.configured) {
      this.emit({ type: "world", world: this.world() });
      return;
    }
    this.polling = true;

    try {
      for (const project of this.projects.values()) {
        const issues = await this.linear.fetchProjectIssues(project.id, this.config.activeLinearStates);
        for (const issue of issues) {
          project.issues.set(issue.id, this.withRunState(issue));
        }
      }

      this.dispatchAvailable();
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

  private startSession(project: ProjectRecord, issue: LinearIssue): void {
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

    void this.runner
      .run(issue, project, session, {
        onEvent: (agentEvent) => this.recordEvent(session, agentEvent)
      })
      .then(() => {
        session.status = "completed";
        session.completedAt = new Date().toISOString();
        this.completedIssueIds.add(issue.id);
        this.recordEvent(session, lifecycle("Completed"));
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
  }

  private recordEvent(session: AgentSession, agentEvent: AgentEvent): void {
    session.transcript.push(agentEvent);
    session.transcript = session.transcript.slice(-120);
    session.latestEvent = agentEvent.message;
    this.emit({ type: "session", session });
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
