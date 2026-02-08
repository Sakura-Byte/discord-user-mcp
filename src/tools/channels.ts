import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DiscordClient } from "../client.js";
import { ChannelType } from "../types.js";
import { formatChannelList } from "../formatters.js";
import { resolveGuildId, toolResult } from "./helpers.js";

export function registerChannelTools(
  server: McpServer,
  client: DiscordClient,
): void {
  server.tool(
    "discord_list_channels",
    "List channels in a Discord server, grouped by category. Use DISCORD_DEFAULT_GUILD env var to set a default server, or pass guild_id explicitly.",
    {
      guild_id: z
        .string()
        .optional()
        .describe(
          "Server ID. Uses DISCORD_DEFAULT_GUILD env var if not provided.",
        ),
      type: z
        .enum(["text", "voice", "all"])
        .optional()
        .describe("Filter by channel type. Defaults to text channels only."),
    },
    async ({ guild_id, type }) => {
      const id = resolveGuildId(guild_id);
      if (typeof id !== "string") return id;

      let channels = await client.getGuildChannels(id);

      const filter = type ?? "text";
      if (filter === "text") {
        channels = channels.filter(
          (c) =>
            c.type === ChannelType.GuildText ||
            c.type === ChannelType.GuildAnnouncement ||
            c.type === ChannelType.GuildForum ||
            c.type === ChannelType.GuildCategory,
        );
      } else if (filter === "voice") {
        channels = channels.filter(
          (c) =>
            c.type === ChannelType.GuildVoice ||
            c.type === ChannelType.GuildStageVoice ||
            c.type === ChannelType.GuildCategory,
        );
      }

      return toolResult(formatChannelList(channels));
    },
  );
}
