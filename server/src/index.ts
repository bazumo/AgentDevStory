import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { GBrainMemory } from "./gbrain";

const rootDir = path.resolve(import.meta.dir, "../..");
const env = { ...loadDotEnv(path.join(rootDir, ".env")), ...process.env };
const port = toInt(env.PORT, 4317);
const dataDir = path.resolve(env.AGENTDEVSTORY_DATA_DIR || path.join(rootDir, ".agentdevstory"));
const startedAt = Date.now();
const subscribers = new Set<(event: unknown) => void>();

const gbrain = new GBrainMemory(dataDir, rootDir);
await gbrain.load();

Bun.serve({
  port,
  fetch: async (request) => {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }));

    try {
      if (url.pathname === "/api/health" && request.method === "GET") {
        return json({
          ready: true,
          gbrainConfigured: true,
          entries: gbrain.count,
          uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
        });
      }

      if (url.pathname === "/api/gbrain/search" && request.method === "GET") {
        const query = url.searchParams.get("q") ?? "";
        const limit = toInt(url.searchParams.get("limit") ?? undefined, 4);
        const hits = await gbrain.search(query, limit);
        publish({ type: "gbrain", action: "search", query, hits: hits.length, at: new Date().toISOString() });
        return json({ hits });
      }

      if (url.pathname === "/api/gbrain/remember" && request.method === "POST") {
        const entry = await gbrain.remember(await request.json());
        publish({ type: "gbrain", action: "remember", entryId: entry?.id ?? null, at: new Date().toISOString() });
        return json({ ok: true, entry });
      }

      if (url.pathname === "/api/events" && request.method === "GET") {
        return events();
      }

      return json({ error: "Not found" }, 404);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return json({ error: message }, 500);
    }
  },
});

console.log(`[AgentDevStory] G-Brain server listening on http://127.0.0.1:${port}`);

function events(): Response {
  const encoder = new TextEncoder();
  let keepAlive: Timer | null = null;
  let send: ((event: unknown) => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      send = (event) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      subscribers.add(send);
      send({ type: "gbrain", action: "connected", entries: gbrain.count, at: new Date().toISOString() });
      keepAlive = setInterval(() => {
        controller.enqueue(encoder.encode(": keepalive\n\n"));
      }, 15000);
    },
    cancel() {
      if (send) subscribers.delete(send);
      if (keepAlive) clearInterval(keepAlive);
    },
  });

  return cors(
    new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    }),
  );
}

function publish(event: unknown) {
  for (const subscriber of subscribers) subscriber(event);
}

function json(value: unknown, status = 200): Response {
  return cors(
    new Response(JSON.stringify(value, null, 2), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

function cors(response: Response): Response {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type,Authorization");
  return response;
}

function toInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function loadDotEnv(filePath: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!existsSync(filePath)) return result;

  const text = readFileSync(filePath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const equalsIndex = line.indexOf("=");
    if (equalsIndex <= 0) continue;

    const key = line.slice(0, equalsIndex).trim();
    const value = line.slice(equalsIndex + 1).trim().replace(/^['"]|['"]$/g, "");
    result[key] = value;
  }
  return result;
}
