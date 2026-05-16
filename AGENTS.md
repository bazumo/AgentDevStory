# AgentDevStory Agent Notes

## Current App

The active app is the TypeScript/Phaser implementation, not the Defold prototype.

- Backend: `server/`
- Frontend: `client/`
- Shared API types: `shared/`
- Live e2e script: `scripts/live-e2e.ts`

## Required Local Config

Use `.env` for secrets and local paths. Never commit `.env`.

Required:

- `LINEAR_API_KEY`
- `AGENTDEVSTORY_TARGET_REPO`
- `AGENTDEVSTORY_WORKSPACE_ROOT`
- `CODEX_CMD`

Recommended `CODEX_CMD`:

```bash
codex exec --json --sandbox workspace-write --skip-git-repo-check
```

`AGENTDEVSTORY_WORKSPACE_ROOT` must not be inside `AGENTDEVSTORY_TARGET_REPO`; use `/tmp/agentdevstory-workspaces` for local testing.

## Commands

```bash
bun install
bun run dev:server
bun run dev:client
bun run typecheck
bun run build
bun run e2e:live
```

## Live E2E Contract

`bun run e2e:live` is the acceptance test for this project. It:

1. Verifies backend readiness.
2. Lists real Linear teams with `LINEAR_API_KEY`.
3. Creates a real Linear project through `POST /api/projects`.
4. Creates a real Linear issue in that project through Linear GraphQL.
5. Waits for `/api/world` to show the issue.
6. Waits for the backend to start a real Codex session.
7. Waits for the session to finish successfully.

If this fails, inspect:

- `.agentdevstory/server.log`
- `.agentdevstory/client.log`
- `GET /api/world`
- `GET /api/sessions/:id`

## Safety

The Linear key previously appeared in chat and should be rotated before any public demo. Keep it only in local `.env` until then.
