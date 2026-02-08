import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DiscordAPIError, type DiscordClient } from "../client.js";
import { formatMessage } from "../formatters.js";
import {
  resolveAuthor,
  resolveGuildId,
  scanChannelMessages,
  toolError,
  toolResult,
} from "./helpers.js";

/**
 * Convert a YYYY-MM-DD date string to a Discord snowflake ID.
 */
function dateToSnowflake(dateStr: string): string | null {
  const match = /^\d{4}-\d{2}-\d{2}$/.exec(dateStr);
  if (!match) return null;
  const ts = new Date(dateStr).getTime();
  if (isNaN(ts)) return null;
  const DISCORD_EPOCH = 1420070400000;
  const snowflake = BigInt(ts - DISCORD_EPOCH) << 22n;
  return snowflake.toString();
}

export function registerFindTools(
  server: McpServer,
  client: DiscordClient,
): void {
  server.tool(
    "discord_find_message",
    "Find messages in a Discord server by author, content, or date range. Tries guild search first; if the server blocks search (403), falls back to scanning the channel directly (requires channel_id).",
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
          "Channel ID. Required for 403 fallback. Recommended to always provide.",
        ),
      author: z
        .string()
        .optional()
        .describe("Filter by author — username or user ID."),
      content: z
        .string()
        .optional()
        .describe("Search message content for this text."),
      before: z
        .string()
        .optional()
        .describe("Messages before this date (YYYY-MM-DD) or message ID."),
      after: z
        .string()
        .optional()
        .describe("Messages after this date (YYYY-MM-DD) or message ID."),
      limit: z
        .number()
        .min(1)
        .max(25)
        .optional()
        .describe("Number of results (1-25, default 25)."),
    },
    async ({ guild_id, channel_id, author, content, before, after, limit }) => {
      const id = resolveGuildId(guild_id);
      if (typeof id !== "string") return id;

      // Resolve author username to ID
      let authorId: string | undefined;
      if (author) {
        const resolved = await resolveAuthor(client, id, author);
        if (!resolved) {
          return toolError(
            `Could not find user "${author}" in this server. Try using their user ID instead.`,
          );
        }
        authorId = resolved;
      }

      // Convert date strings to snowflakes
      let minId: string | undefined;
      let maxId: string | undefined;
      if (after) {
        const snowflake = dateToSnowflake(after);
        minId = snowflake ?? after;
      }
      if (before) {
        const snowflake = dateToSnowflake(before);
        maxId = snowflake ?? before;
      }

      // Try guild search first
      try {
        const results = await client.searchGuild(id, {
          content,
          author_id: authorId,
          channel_id,
          min_id: minId,
          max_id: maxId,
        });

        const maxResults = limit ?? 25;
        const trimmed = results.messages.slice(0, maxResults);

        if (trimmed.length === 0) {
          return toolResult("No matching messages found.");
        }

        const lines: string[] = [`Found ${results.total_results} results:\n`];
        for (let i = 0; i < trimmed.length; i++) {
          const group = trimmed[i]!;
          const match = group[Math.floor(group.length / 2)];
          if (!match) continue;
          lines.push(`${i + 1}. ${formatMessage(match)} [channel: ${match.channel_id}]`);
        }
        return toolResult(lines.join("\n"));
      } catch (e) {
        if (e instanceof DiscordAPIError && e.status === 403) {
          if (!channel_id) {
            return toolError(
              "Search returned 403 (Forbidden). This server may not allow search. " +
                "Provide a channel_id to fall back to scanning channel messages directly.",
            );
          }
          const messages = await scanChannelMessages(client, channel_id, {
            authorId,
            content,
            minId,
            maxId,
            limit: limit ?? 25,
          });
          if (messages.length === 0) {
            return toolResult("No matching messages found (scanned via fallback).");
          }
          const lines = messages.map(formatMessage);
          return toolResult(
            `Search unavailable (403), scanned channel directly. Found ${messages.length} messages:\n\n` +
              lines.join("\n"),
          );
        }
        throw e;
      }
    },
  );

  server.tool(
    "discord_get_replies",
    "Get all replies to a specific message. Fetches messages after the target and filters for those that reference it. Shows the original message followed by its replies in chronological order.",
    {
      channel_id: z.string().describe("Channel containing the message."),
      message_id: z
        .string()
        .describe("ID of the message to find replies for."),
      limit: z
        .number()
        .min(1)
        .max(50)
        .optional()
        .describe("Max replies to return (1-50, default 50)."),
    },
    async ({ channel_id, message_id, limit }) => {
      // Fetch the original message
      let original;
      try {
        original = await client.getMessage(channel_id, message_id);
      } catch {
        return toolError(
          `Could not fetch message ${message_id} in channel ${channel_id}.`,
        );
      }

      // Scan messages after the target to find replies
      const maxReplies = limit ?? 50;
      const replies = [];
      let after = message_id;
      const maxPages = 4; // 4 * 100 = 400 messages scanned

      for (let page = 0; page < maxPages && replies.length < maxReplies; page++) {
        const batch = await client.getMessages(channel_id, {
          limit: 100,
          after,
        });
        if (batch.length === 0) break;

        // getMessages with after returns oldest first, but API returns newest first
        // Sort by ID ascending to process chronologically
        const sorted = [...batch].sort((a, b) =>
          a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
        );

        for (const msg of sorted) {
          if (msg.message_reference?.message_id === message_id) {
            replies.push(msg);
            if (replies.length >= maxReplies) break;
          }
        }

        // Use the newest message ID for next page
        after = sorted[sorted.length - 1]!.id;
      }

      const lines: string[] = [
        `Original: ${formatMessage(original)}`,
        "",
        replies.length > 0
          ? `${replies.length} replies:`
          : "No replies found.",
      ];

      for (const reply of replies) {
        lines.push(formatMessage(reply));
      }

      return toolResult(lines.join("\n"));
    },
  );
}
