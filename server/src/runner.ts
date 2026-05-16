import path from "node:path";
import { mkdir, stat } from "node:fs/promises";
import type { AgentEvent, AgentSession, LinearIssue, LinearProject } from "../../shared/types";
import type { AppConfig } from "./config";

type RunnerCallbacks = {
  onEvent: (event: AgentEvent) => void;
};

export class AgentRunner {
  constructor(private readonly config: AppConfig) {}

  canRunRealAgents(): boolean {
    return Boolean(this.config.targetRepo && this.config.codexCommand.length > 0);
  }

  async run(issue: LinearIssue, project: LinearProject, session: AgentSession, callbacks: RunnerCallbacks): Promise<void> {
    if (!this.canRunRealAgents()) {
      throw new Error("AGENTDEVSTORY_TARGET_REPO and CODEX_CMD are required for real agent runs");
    }

    const workspacePath = await this.ensureWorkspace(issue, callbacks);
    session.workspacePath = workspacePath;
    callbacks.onEvent(event("workspace", `Workspace ready: ${workspacePath}`));

    const [cmd, ...args] = this.config.codexCommand;
    const prompt = buildPrompt(issue, project);

    callbacks.onEvent(event("lifecycle", `Starting ${this.config.codexCommand.join(" ")}`));
    const proc = Bun.spawn([cmd, ...args], {
      cwd: workspacePath,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: process.env
    });

    proc.stdin.write(prompt);
    proc.stdin.end();

    await Promise.all([
      readStream(proc.stdout, "stdout", callbacks.onEvent),
      readStream(proc.stderr, "stderr", callbacks.onEvent)
    ]);

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      throw new Error(`Agent command exited with code ${exitCode}`);
    }

    callbacks.onEvent(event("lifecycle", "Agent command completed"));
  }

  private async ensureWorkspace(issue: LinearIssue, callbacks: RunnerCallbacks): Promise<string> {
    const targetRepo = this.config.targetRepo;
    if (!targetRepo) throw new Error("AGENTDEVSTORY_TARGET_REPO is not configured");

    await mkdir(this.config.workspaceRoot, { recursive: true });
    const workspacePath = path.join(this.config.workspaceRoot, `${sanitize(issue.identifier)}-${sanitize(issue.id).slice(0, 8)}`);

    if (await Bun.file(path.join(workspacePath, ".agentdevstory-workspace")).exists()) {
      return workspacePath;
    }

    const isGitRepo = await pathExists(path.join(targetRepo, ".git"));
    if (isGitRepo) {
      const result = Bun.spawnSync(["git", "worktree", "add", "--detach", workspacePath, "HEAD"], {
        cwd: targetRepo,
        stdout: "pipe",
        stderr: "pipe"
      });

      if (result.exitCode !== 0) {
        callbacks.onEvent(event("stderr", new TextDecoder().decode(result.stderr).trim()));
        throw new Error("Failed to create git worktree for agent workspace");
      }
    } else {
      await mkdir(workspacePath, { recursive: true });
      const result = Bun.spawnSync(["cp", "-a", `${targetRepo}/.`, workspacePath], {
        stdout: "pipe",
        stderr: "pipe"
      });

      if (result.exitCode !== 0) {
        callbacks.onEvent(event("stderr", new TextDecoder().decode(result.stderr).trim()));
        throw new Error("Failed to copy target repo for agent workspace");
      }
    }

    await Bun.write(path.join(workspacePath, ".agentdevstory-workspace"), new Date().toISOString());
    return workspacePath;
  }

}

function buildPrompt(issue: LinearIssue, project: LinearProject): string {
  return [
    `You are working on Linear issue ${issue.identifier}: ${issue.title}`,
    "",
    `Project: ${project.name}`,
    issue.url ? `Issue URL: ${issue.url}` : null,
    issue.branchName ? `Branch hint: ${issue.branchName}` : null,
    "",
    "Issue description:",
    issue.description ?? "(No description provided.)",
    "",
    "Use the repository instructions and available skills. Implement the issue end to end, run appropriate checks, and summarize the result."
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

async function readStream(
  stream: ReadableStream<Uint8Array>,
  kind: "stdout" | "stderr",
  onEvent: (event: AgentEvent) => void
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.trim()) onEvent(event(kind, line));
    }
  }

  const final = buffer.trim();
  if (final) onEvent(event(kind, final));
}

function event(kind: AgentEvent["kind"], message: string): AgentEvent {
  return {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    kind,
    message
  };
}

function sanitize(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 80);
}

async function pathExists(value: string): Promise<boolean> {
  try {
    await stat(value);
    return true;
  } catch {
    return false;
  }
}
