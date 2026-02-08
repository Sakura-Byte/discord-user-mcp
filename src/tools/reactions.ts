import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DiscordClient } from "../client.js";
import { toolResult } from "./helpers.js";

export function registerReactionTools(
  server: McpServer,
  client: DiscordClient,
): void {
  server.tool(
    "discord_react",
    "Add a reaction emoji to a message. Use standard unicode emoji or custom emoji in name:id format.",
    {
      channel_id: z.string().describe("Channel containing the message."),
      message_id: z.string().describe("Message to react to."),
      emoji: z
        .string()
        .describe(
          "Emoji to react with. Examples: '👍', '❤️', 'custom_emoji:123456'",
        ),
    },
    async ({ channel_id, message_id, emoji }) => {
      await client.addReaction(channel_id, message_id, emoji);
      return toolResult(`Reacted with ${emoji} to message ${message_id}.`);
    },
  );
}
