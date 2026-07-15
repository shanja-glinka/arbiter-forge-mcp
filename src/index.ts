import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createServer } from "./server.js";

const server = createServer();
const transport = new StdioServerTransport();

async function shutdown(): Promise<void> {
  try {
    await server.close();
  } finally {
    process.exit(0);
  }
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

try {
  await server.connect(transport);
} catch (error) {
  process.stderr.write(
    `arbiter-forge fatal: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
