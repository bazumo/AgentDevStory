import path from "node:path";
import { existsSync, readFileSync } from "node:fs";

export type AppConfig = {
  port: number;
  linearApiKey: string | null;
  symphonyApiUrl: string | null;
  symphonyApiKey: string | null;
  targetRepo: string | null;
  workspaceRoot: string;
  codexCommand: string[];
  maxConcurrentAgents: number;
  pollIntervalMs: number;
  retryBaseMs: number;
  activeLinearStates: string[];
  terminalLinearStates: string[];
  dataDir: string;
  watchedProjectIds: string[];
};

const rootDir = path.resolve(import.meta.dir, "../..");

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const mergedEnv = { ...loadDotEnv(path.join(rootDir, ".env")), ...env };

  return {
    port: toInt(mergedEnv.PORT, 4317),
    linearApiKey: clean(mergedEnv.LINEAR_API_KEY),
    symphonyApiUrl: clean(mergedEnv.SYMPHONY_API_URL),
    symphonyApiKey: clean(mergedEnv.SYMPHONY_API_KEY),
    targetRepo: clean(mergedEnv.AGENTDEVSTORY_TARGET_REPO) ?? rootDir,
    workspaceRoot: path.resolve(clean(mergedEnv.AGENTDEVSTORY_WORKSPACE_ROOT) ?? "/tmp/agentdevstory-workspaces"),
    codexCommand: splitCommand(clean(mergedEnv.CODEX_CMD) ?? "codex exec --json --sandbox workspace-write --skip-git-repo-check"),
    maxConcurrentAgents: toInt(mergedEnv.MAX_CONCURRENT_AGENTS, 2),
    pollIntervalMs: toInt(mergedEnv.POLL_INTERVAL_MS, 10_000),
    retryBaseMs: toInt(mergedEnv.RETRY_BASE_MS, 30_000),
    activeLinearStates: toList(mergedEnv.ACTIVE_LINEAR_STATES, ["Todo", "In Progress", "In Review"]),
    terminalLinearStates: toList(mergedEnv.TERMINAL_LINEAR_STATES, ["Done", "Canceled", "Cancelled"]),
    dataDir: path.resolve(clean(mergedEnv.AGENTDEVSTORY_DATA_DIR) ?? path.join(rootDir, ".agentdevstory")),
    watchedProjectIds: toList(mergedEnv.WATCHED_PROJECT_IDS, [])
  };
}

export function readinessErrors(config: AppConfig): string[] {
  const errors: string[] = [];

  if (!config.linearApiKey) {
    errors.push("LINEAR_API_KEY is not configured.");
  }

  if (!config.targetRepo) {
    errors.push("AGENTDEVSTORY_TARGET_REPO is not configured; real Codex runs are disabled.");
  } else if (isInside(config.workspaceRoot, config.targetRepo)) {
    errors.push("AGENTDEVSTORY_WORKSPACE_ROOT must not be inside AGENTDEVSTORY_TARGET_REPO.");
  }

  if (config.codexCommand.length === 0) {
    errors.push("CODEX_CMD resolved to an empty command.");
  } else if (!Bun.which(config.codexCommand[0])) {
    errors.push(`Agent executable was not found on PATH: ${config.codexCommand[0]}`);
  }

  return errors;
}

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function toInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toList(value: string | undefined, fallback: string[]): string[] {
  const parsed = (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return parsed.length > 0 ? parsed : fallback;
}

function splitCommand(value: string): string[] {
  const matches = value.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  return matches.map((part) => part.replace(/^['"]|['"]$/g, ""));
}

function isInside(child: string, parent: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function loadDotEnv(filePath: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};

  if (!existsSync(filePath)) return env;

  const text = readFileSync(filePath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const equalsIndex = line.indexOf("=");
    if (equalsIndex <= 0) continue;

    const key = line.slice(0, equalsIndex).trim();
    const value = line.slice(equalsIndex + 1).trim().replace(/^['"]|['"]$/g, "");
    env[key] = value;
  }

  return env;
}
