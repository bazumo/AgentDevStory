# AgentDevStory

AgentDevStory is now a Phaser + TypeScript hackathon app for visualizing a mini-Symphony agent runner as a pixel-art office park.

The old Defold prototype files are still present, but the active app is:

- `server/`: Bun TypeScript backend that creates Linear projects, polls issues, and runs agent sessions.
- `client/`: Vite + Phaser frontend that renders projects, issues, agents, and transcripts.
- `shared/`: API and world-state types shared by both sides.

## Run

```bash
bun install
cp .env.example .env
bun run dev:server
bun run dev:client
```

Open the Vite URL printed by the client, usually `http://localhost:5173`.

`LINEAR_API_KEY` is required. Set `AGENTDEVSTORY_TARGET_REPO` and `CODEX_CMD` to enable real agent workspaces/runs.

Use this non-interactive Codex command for daemon runs:

```bash
CODEX_CMD=codex exec --json --sandbox workspace-write --skip-git-repo-check
```

Keep `AGENTDEVSTORY_WORKSPACE_ROOT` outside `AGENTDEVSTORY_TARGET_REPO`; `/tmp/agentdevstory-workspaces` is a good local default.

## Live E2E

```bash
bun run e2e:live
```

This creates a real Linear project and issue, waits for `/api/world` to render the issue, starts a real Codex session, and waits for completion.

## API

- `GET /api/health`
- `GET /api/linear/teams`
- `POST /api/projects`
- `GET /api/world`
- `GET /api/sessions/:id`
- `GET /api/events`
