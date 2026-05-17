import type { ApiEvent } from "../../shared/types";
import type { Orchestrator } from "./orchestrator";

export function createHandler(orchestrator: Orchestrator): (request: Request) => Promise<Response> | Response {
  return async (request) => {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }));

    try {
      if (url.pathname === "/api/health" && request.method === "GET") {
        return json(orchestrator.health());
      }

      if (url.pathname === "/api/linear/teams" && request.method === "GET") {
        return json({ teams: await orchestrator.listTeams() });
      }

      if (url.pathname === "/api/projects" && request.method === "POST") {
        return json(await orchestrator.createProject(await request.json()), 201);
      }

      if (url.pathname === "/api/sessions" && request.method === "POST") {
        const body = await request.json();
        return json({ session: orchestrator.createSession(String(body?.prompt ?? "")) }, 201);
      }

      if (url.pathname === "/api/symphony/status" && request.method === "GET") {
        return json(await orchestrator.symphonyStatus());
      }

      if (url.pathname === "/api/symphony/sync" && request.method === "POST") {
        return json(await orchestrator.syncSymphony());
      }

      if (url.pathname === "/api/gbrain/search" && request.method === "GET") {
        return json(await orchestrator.searchGBrain(url.searchParams.get("q") ?? ""));
      }

      if (url.pathname === "/api/world" && request.method === "GET") {
        return json(orchestrator.world());
      }

      if (url.pathname.startsWith("/api/sessions/") && url.pathname.endsWith("/input") && request.method === "POST") {
        const id = decodeURIComponent(url.pathname.replace("/api/sessions/", "").replace(/\/input$/, ""));
        const body = await request.json();
        return json({ ok: true, session: orchestrator.sendSessionInput(id, String(body?.message ?? "")) }, 202);
      }

      if (url.pathname.startsWith("/api/sessions/") && request.method === "GET") {
        const id = decodeURIComponent(url.pathname.replace("/api/sessions/", ""));
        const session = orchestrator.getSession(id);
        return session ? json(session) : json({ error: "Session not found" }, 404);
      }

      if (url.pathname === "/api/events" && request.method === "GET") {
        return events(orchestrator);
      }

      return json({ error: "Not found" }, 404);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return json({ error: message }, 500);
    }
  };
}

function events(orchestrator: Orchestrator): Response {
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let keepAlive: Timer | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: ApiEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      unsubscribe = orchestrator.subscribe(send);
      keepAlive = setInterval(() => {
        controller.enqueue(encoder.encode(": keepalive\n\n"));
      }, 15_000);
    },
    cancel() {
      unsubscribe?.();
      if (keepAlive) clearInterval(keepAlive);
    }
  });

  return cors(
    new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive"
      }
    })
  );
}

function json(value: unknown, status = 200): Response {
  return cors(
    new Response(JSON.stringify(value, null, 2), {
      status,
      headers: {
        "Content-Type": "application/json"
      }
    })
  );
}

function cors(response: Response): Response {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type,Authorization");
  return response;
}
