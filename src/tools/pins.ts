import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DiscordClient } from "../client.js";
import { formatMessageList } from "../formatters.js";
import { toolResult } from "./helpers.js";

export function registerPinTools(
  server: McpServer,
  client: DiscordClient,
): void {
  server.tool(
    "discord_pinned_messages",
    "Get pinned messages from a channel. Pinned messages often contain important information, rules, or links.",
    {
      channel_id: z
        .string()
        .describe("Channel to get pinned messages from."),
    },
    async ({ channel_id }) => {
      const messages = await client.getPinnedMessages(channel_id);
      if (messages.length === 0) {
        return toolResult("No pinned messages in this channel.");
      }
      return toolResult(
        `${messages.length} pinned message(s):\n\n${formatMessageList(messages)}`,
      );
    },
  );
}
