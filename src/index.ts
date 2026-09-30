#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DiscordClient } from "./client.js";
import { DiscordGateway } from "./gateway.js";
import { InteractionClient } from "./interactions.js";
import { registerAllTools } from "./tools/register.js";

async function main() {
  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    console.error("DISCORD_TOKEN environment variable is required.");
    console.error(
      "This is your Discord USER token (not a bot token).",
    );
    console.error(
      "Set it in your MCP server config or export it in your shell.",
    );
    process.exit(1);
  }

  const client = new DiscordClient(token);

  // Validate token on startup
  try {
    const me = await client.getCurrentUser();
    console.error(`discord-mcp: authenticated as ${me.username}`);
  } catch {
    console.error(
      "discord-mcp: failed to authenticate. Check your DISCORD_TOKEN.",
    );
    process.exit(1);
  }

  const server = new McpServer({
    name: "discord",
    version: "0.1.0",
  });

  // The gateway connects lazily, on the first slash-command tool call.
  const interactions = new InteractionClient(token, new DiscordGateway(token));
  registerAllTools(server, client, interactions);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("discord-mcp: fatal error:", err);
  process.exit(1);
});
