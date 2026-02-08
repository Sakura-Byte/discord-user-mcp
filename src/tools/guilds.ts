import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DiscordClient } from "../client.js";
import { formatGuildInfo, formatGuildList } from "../formatters.js";
import { resolveGuildId, toolError, toolResult } from "./helpers.js";

export function registerGuildTools(
  server: McpServer,
  client: DiscordClient,
): void {
  server.tool(
    "discord_list_guilds",
    "List Discord servers you're a member of. Returns server names and IDs. Use a server ID with other tools to specify which server to interact with.",
    {},
    async () => {
      const guilds = await client.getMyGuilds();
      return toolResult(formatGuildList(guilds));
    },
  );

  server.tool(
    "discord_guild_info",
    "Get detailed information about a Discord server: name, description, member count, roles, and features.",
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
      if (typeof id !== "string") return id; // error result
      const guild = await client.getGuild(id);
      return toolResult(formatGuildInfo(guild));
    },
  );
}
