import { existsSync, readFileSync } from "node:fs";
import type { CreateProjectResponse, LinearTeam, WorldState } from "../shared/types";

const apiBase = process.env.AGENTDEVSTORY_API_BASE ?? "http://127.0.0.1:4317";
const env = { ...loadDotEnv(".env"), ...process.env };
const linearApiKey = env.LINEAR_API_KEY;

if (!linearApiKey) {
  fail("LINEAR_API_KEY is required in .env or the process environment.");
}

const runId = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);

console.log(`AgentDevStory live e2e run ${runId}`);
console.log(`API: ${apiBase}`);

const health = await getJson(`${apiBase}/api/health`);
console.log(`health.ready=${health.ready} linear=${health.linearConfigured} agent=${health.agentCommand}`);
if (!health.ready) fail(`Backend is not ready: ${(health.errors ?? []).join("; ")}`);

const teamsResponse = (await getJson(`${apiBase}/api/linear/teams`)) as { teams: LinearTeam[] };
const team = teamsResponse.teams[0];
if (!team) fail("No Linear teams are visible to this API key.");
console.log(`team=${team.name} (${team.key ?? team.id})`);

const project = (await postJson(`${apiBase}/api/projects`, {
  teamId: team.id,
  name: `AgentDevStory E2E ${runId}`,
  description: "Created by the AgentDevStory live e2e script."
})) as CreateProjectResponse;
console.log(`project=${project.name} ${project.projectId}`);

const todoState = await findState(team.id, "Todo");
const issue = await createIssue({
  teamId: team.id,
  projectId: project.projectId,
  stateId: todoState.id,
  title: `AgentDevStory e2e smoke ${runId}`,
  description: [
    "This is an automated AgentDevStory smoke issue.",
    "",
    "Agent instructions:",
    "- Do not modify files.",
    "- Inspect the repository briefly.",
    "- Reply with a concise summary that the workspace is reachable."
  ].join("\n")
});
console.log(`issue=${issue.identifier} ${issue.id}`);

const worldWithIssue = await waitForWorld(
  (world) => world.projects.some((candidate) => candidate.id === project.projectId && candidate.issues.some((candidateIssue) => candidateIssue.id === issue.id)),
  60_000,
  "created issue to appear in /api/world"
);
const renderedIssue = worldWithIssue.projects.flatMap((candidate) => candidate.issues).find((candidateIssue) => candidateIssue.id === issue.id);
console.log(`world.issue=${renderedIssue?.identifier} state=${renderedIssue?.runState}`);

const worldWithSessionStart = await waitForWorld(
  (world) => world.sessions.some((session) => session.issueId === issue.id),
  120_000,
  "agent session to start for created issue"
);
const startedSession = worldWithSessionStart.sessions.find((candidate) => candidate.issueId === issue.id);
if (!startedSession) fail("Session disappeared after it was observed.");
console.log(`session.started=${startedSession.id} status=${startedSession.status} latest=${startedSession.latestEvent ?? ""}`);

const worldWithTerminalSession = await waitForWorld(
  (world) => world.sessions.some((session) => session.issueId === issue.id && ["completed", "failed", "stopped"].includes(session.status)),
  600_000,
  "agent session to complete for created issue"
);
const session = worldWithTerminalSession.sessions.find((candidate) => candidate.issueId === issue.id);
if (!session) fail("Session disappeared after it was observed.");
console.log(`session.finished=${session.id} status=${session.status} latest=${session.latestEvent ?? ""}`);

if (session.status === "failed") {
  const details = await getJson(`${apiBase}/api/sessions/${encodeURIComponent(session.id)}`);
  console.log(JSON.stringify(details, null, 2));
  fail("Agent session failed.");
}

console.log("live e2e passed");

async function findState(teamId: string, name: string): Promise<{ id: string; name: string }> {
  const data = await linearGraphql<{
    team: { states: { nodes: Array<{ id: string; name: string }> } };
  }>(
    `
      query AgentDevStoryE2EStates($teamId: String!) {
        team(id: $teamId) {
          states(first: 100) { nodes { id name } }
        }
      }
    `,
    { teamId }
  );

  const state = data.team.states.nodes.find((candidate) => candidate.name === name);
  if (!state) fail(`Linear state not found on team ${teamId}: ${name}`);
  return state;
}

async function createIssue(input: {
  teamId: string;
  projectId: string;
  stateId: string;
  title: string;
  description: string;
}): Promise<{ id: string; identifier: string }> {
  const data = await linearGraphql<{
    issueCreate: {
      success: boolean;
      issue: { id: string; identifier: string } | null;
    };
  }>(
    `
      mutation AgentDevStoryE2ECreateIssue($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue { id identifier }
        }
      }
    `,
    { input }
  );

  if (!data.issueCreate.success || !data.issueCreate.issue) fail("Linear issueCreate did not return an issue.");
  return data.issueCreate.issue;
}

async function waitForWorld(predicate: (world: WorldState) => boolean, timeoutMs: number, label: string): Promise<WorldState> {
  const startedAt = Date.now();
  let lastWorld: WorldState | null = null;

  while (Date.now() - startedAt < timeoutMs) {
    lastWorld = (await getJson(`${apiBase}/api/world`)) as WorldState;
    if (predicate(lastWorld)) return lastWorld;
    await sleep(2_000);
  }

  console.log(JSON.stringify(lastWorld, null, 2));
  fail(`Timed out waiting for ${label}.`);
}

async function linearGraphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const response = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: linearApiKey!
    },
    body: JSON.stringify({ query, variables })
  });

  const payload = (await response.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (!response.ok || payload.errors?.length || !payload.data) {
    fail(`Linear GraphQL failed: ${JSON.stringify(payload.errors ?? payload)}`);
  }

  return payload.data;
}

async function getJson(url: string): Promise<any> {
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok) fail(`${url} returned ${response.status}: ${JSON.stringify(payload)}`);
  return payload;
}

async function postJson(url: string, body: unknown): Promise<any> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json();
  if (!response.ok) fail(`${url} returned ${response.status}: ${JSON.stringify(payload)}`);
  return payload;
}

function loadDotEnv(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) return {};

  const parsed: Record<string, string> = {};
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const equalsIndex = line.indexOf("=");
    if (equalsIndex <= 0) continue;
    parsed[line.slice(0, equalsIndex).trim()] = line.slice(equalsIndex + 1).trim().replace(/^['"]|['"]$/g, "");
  }

  return parsed;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
