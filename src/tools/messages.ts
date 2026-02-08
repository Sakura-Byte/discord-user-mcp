import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DiscordClient } from "../client.js";
import { formatMessage, formatMessageList } from "../formatters.js";
import { toolError, toolResult } from "./helpers.js";

export function registerMessageTools(
  server: McpServer,
  client: DiscordClient,
): void {
  server.tool(
    "discord_read_messages",
    "Read recent messages from a Discord channel. Returns messages in chronological order (oldest first). Use 'before' for pagination to read further back in history.",
    {
      channel_id: z.string().describe("The channel ID to read from."),
      limit: z
        .number()
        .min(1)
        .max(100)
        .optional()
        .describe("Number of messages to fetch (1-100, default 25)."),
      before: z
        .string()
        .optional()
        .describe(
          "Message ID — fetch messages before this one (for pagination backward).",
        ),
      after: z
        .string()
        .optional()
        .describe(
          "Message ID — fetch messages after this one (for pagination forward).",
        ),
    },
    async ({ channel_id, limit, before, after }) => {
      const messages = await client.getMessages(channel_id, {
        limit: limit ?? 25,
        before,
        after,
      });
      return toolResult(formatMessageList(messages, { showPagination: true }));
    },
  );

  server.tool(
    "discord_send_message",
    "Send a message to a Discord channel. Supports plain text and Discord markdown (bold, italic, code blocks). Returns the sent message ID.",
    {
      channel_id: z.string().describe("The channel ID to send to."),
      content: z
        .string()
        .describe("Message content. Supports Discord markdown."),
      reply_to: z
        .string()
        .optional()
        .describe("Message ID to reply to (creates a threaded reply)."),
    },
    async ({ channel_id, content, reply_to }) => {
      const msg = await client.sendMessage(channel_id, content, reply_to);
      return toolResult(
        `Message sent (ID: ${msg.id}).\n${formatMessage(msg)}`,
      );
    },
  );

  server.tool(
    "discord_edit_message",
    "Edit one of your own messages. You can only edit messages you sent.",
    {
      channel_id: z.string().describe("Channel containing the message."),
      message_id: z.string().describe("ID of the message to edit."),
      content: z.string().describe("New message content."),
    },
    async ({ channel_id, message_id, content }) => {
      const msg = await client.editMessage(channel_id, message_id, content);
      return toolResult(`Message edited (ID: ${msg.id}).\n${formatMessage(msg)}`);
    },
  );

  server.tool(
    "discord_delete_message",
    "Delete one of your own messages. This action is permanent and cannot be undone.",
    {
      channel_id: z.string().describe("Channel containing the message."),
      message_id: z.string().describe("ID of the message to delete."),
    },
    async ({ channel_id, message_id }) => {
      try {
        await client.deleteMessage(channel_id, message_id);
        return toolResult(`Message ${message_id} deleted.`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return toolError(`Failed to delete message: ${msg}`);
      }
    },
  );
}
