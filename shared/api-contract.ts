/**
 * API contract between client and server.
 *
 * The server exposes these endpoints. The client consumes them.
 * Both sides can develop independently as long as this contract holds.
 *
 * Base URL: configurable via VITE_API_URL (default http://localhost:4317)
 */

export const API_ROUTES = {
  health: "GET /api/health",
  teams: "GET /api/linear/teams",
  createProject: "POST /api/projects",
  world: "GET /api/world",
  session: "GET /api/sessions/:id",
  events: "GET /api/events",
} as const;

export type {
  WorldState,
  AgentSession,
  ApiEvent,
  CreateProjectRequest,
  CreateProjectResponse,
  HealthResponse,
  LinearTeam,
  RoomType,
  SessionStatus,
  AgentEvent,
} from "./types";
