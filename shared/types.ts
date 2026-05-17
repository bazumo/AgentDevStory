export type SessionStatus = "queued" | "running" | "completed" | "failed" | "stopped";

export type IssueRunState = "idle" | "queued" | "running" | "completed" | "failed" | "terminal";

export type RoomType = "forge" | "warroom" | "blueprint" | "lounge";

export type LinearTeam = {
  id: string;
  name: string;
  key: string | null;
};

export type LinearProject = {
  id: string;
  name: string;
  url: string | null;
  createdAt: string;
};

export type LinearIssue = {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  priority: number | null;
  state: string;
  stateType: string | null;
  branchName: string | null;
  url: string | null;
  labels: string[];
  blockedBy: Array<{
    id: string | null;
    identifier: string | null;
    state: string | null;
  }>;
  createdAt: string | null;
  updatedAt: string | null;
  runState: IssueRunState;
};

export type AgentEvent = {
  id: string;
  at: string;
  kind: "lifecycle" | "stdout" | "stderr" | "linear" | "workspace" | "gbrain" | "error" | "user";
  message: string;
};

export type AgentSession = {
  id: string;
  issueId: string;
  issueIdentifier: string;
  projectId: string;
  status: SessionStatus;
  attempt: number;
  character: string;
  profession: string;
  workspacePath: string | null;
  startedAt: string | null;
  completedAt: string | null;
  latestEvent: string | null;
  transcript: AgentEvent[];
};

export type WorldProject = LinearProject & {
  issues: LinearIssue[];
};

export type WorldState = {
  generatedAt: string;
  mode: "live" | "unconfigured";
  backend: {
    ready: boolean;
    linearConfigured: boolean;
    symphonyConfigured: boolean;
    targetRepoConfigured: boolean;
    gbrainConfigured: boolean;
    agentCommand: string;
    agentExecutableFound: boolean;
    runningAgents: number;
    maxConcurrentAgents: number;
    errors: string[];
  };
  projects: WorldProject[];
  sessions: AgentSession[];
};

export type HealthResponse = WorldState["backend"] & {
  uptimeSeconds: number;
  watchedProjects: number;
};

export type SymphonyStatus = {
  configured: boolean;
  apiUrl: string | null;
  reachable?: boolean;
  state?: unknown;
  error?: string;
};

export type GBrainMemoryHit = {
  id: string;
  sourceSessionId: string;
  title: string;
  text: string;
  score: number;
  at: string;
};

export type GBrainSearchResponse = {
  hits: GBrainMemoryHit[];
};

export type CreateProjectRequest = {
  teamId: string;
  name: string;
  description?: string;
};

export type CreateProjectResponse = {
  projectId: string;
  name: string;
  url: string | null;
};

export type CreateSessionRequest = {
  prompt: string;
};

export type CreateSessionResponse = {
  session: AgentSession;
};

export type SessionInputRequest = {
  message: string;
};

export type SessionInputResponse = {
  ok: true;
  session: AgentSession;
};

export type ApiEvent =
  | { type: "world"; world: WorldState }
  | { type: "session"; session: AgentSession }
  | { type: "error"; message: string };
