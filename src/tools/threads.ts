import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DiscordClient } from "../client.js";
import { formatThreadList } from "../formatters.js";
import { resolveGuildId, toolResult } from "./helpers.js";

export function registerThreadTools(
  server: McpServer,
  client: DiscordClient,
): void {
  server.tool(
    "discord_list_threads",
    "List active threads in a server. Threads are sub-conversations within channels.",
    {
      guild_id: z
        .string()
        .optional()
        .describe(
          "Server ID. Uses DISCORD_DEFAULT_GUILD env var if not provided.",
        ),
    },
    async ({ guild_id }) => {
      const id = resolveGuildId(guild_id);
      if (typeof id !== "string") return id;

      const result = await client.getGuildActiveThreads(id);
      return toolResult(formatThreadList(result.threads));
    },
  );
}
