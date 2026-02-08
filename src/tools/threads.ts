import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DiscordClient } from "../client.js";
import { ChannelType } from "../types.js";
import { formatThreadList } from "../formatters.js";
import { resolveGuildId, toolResult } from "./helpers.js";

export function registerThreadTools(
  server: McpServer,
  client: DiscordClient,
): void {
  server.tool(
    "discord_list_threads",
    "List threads in a server by scanning its text channels for archived threads. " +
      "Works with user accounts (does not require bot privileges).",
    {
      guild_id: z
        .string()
        .optional()
        .describe(
          "Server ID. Uses DISCORD_DEFAULT_GUILD env var if not provided.",
        ),
      channel_id: z
        .string()
        .optional()
        .describe(
          "Optional: limit to a single channel instead of scanning all text channels.",
        ),
    },
    async ({ guild_id, channel_id }) => {
      // If a specific channel is given, just query that one
      if (channel_id) {
        const result = await client.getArchivedPublicThreads(channel_id);
        return toolResult(formatThreadList(result.threads));
      }

      // Otherwise scan all text channels in the guild
      const id = resolveGuildId(guild_id);
      if (typeof id !== "string") return id;

      const channels = await client.getGuildChannels(id);
      const textChannels = channels.filter(
        (c) => c.type === ChannelType.GuildText,
      );

      // Query archived threads from each text channel concurrently
      const results = await Promise.allSettled(
        textChannels.map((c) => client.getArchivedPublicThreads(c.id)),
      );

      const allThreads = results.flatMap((r) =>
        r.status === "fulfilled" ? r.value.threads : [],
      );

      if (allThreads.length === 0) {
        return toolResult("No archived threads found across server channels.");
      }

      return toolResult(formatThreadList(allThreads));
    },
  );
}
