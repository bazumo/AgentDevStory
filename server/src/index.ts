import { loadConfig } from "./config";
import { createHandler } from "./http";
import { Orchestrator } from "./orchestrator";

const config = loadConfig();
const orchestrator = new Orchestrator(config);
await orchestrator.start();

const server = Bun.serve({
  port: config.port,
  fetch: createHandler(orchestrator)
});

console.log(`AgentDevStory backend listening on http://127.0.0.1:${server.port}`);

process.on("SIGINT", () => {
  orchestrator.stop();
  server.stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  orchestrator.stop();
  server.stop();
  process.exit(0);
});

