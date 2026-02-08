import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DiscordClient } from "../client.js";
import { formatSearchResults } from "../formatters.js";
import { resolveGuildId, toolError, toolResult } from "./helpers.js";

/**
 * Convert a YYYY-MM-DD date string to a Discord snowflake ID.
 * Discord epoch: 1420070400000 (Jan 1, 2015).
 * Snowflake = (timestamp_ms - discord_epoch) << 22
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

/**
 * Resolve an author parameter to a user ID.
 * If it looks like a snowflake (all digits), use directly.
 * Otherwise search guild members by username.
 */
async function resolveAuthor(
  client: DiscordClient,
  guildId: string,
  author: string,
): Promise<string | null> {
  if (/^\d+$/.test(author)) return author;

  const members = await client.searchGuildMembers(guildId, author, 5);
  if (members.length === 0) return null;

  // Exact match preferred
  const exact = members.find(
    (m) =>
      m.user.username.toLowerCase() === author.toLowerCase() ||
      m.user.global_name?.toLowerCase() === author.toLowerCase() ||
      m.nick?.toLowerCase() === author.toLowerCase(),
  );
  return exact ? exact.user.id : members[0]!.user.id;
}

export function registerSearchTools(
  server: McpServer,
  client: DiscordClient,
): void {
  server.tool(
    "discord_search",
    "Search messages in a Discord server. The most powerful tool — find specific conversations, messages from particular users, or content matching keywords. Supports combining multiple filters. Results are ordered by relevance.",
    {
      guild_id: z
        .string()
        .optional()
        .describe(
          "Server ID. Uses DISCORD_DEFAULT_GUILD env var if not provided.",
        ),
      content: z
        .string()
        .optional()
        .describe("Search message content for this text."),
      author: z
        .string()
        .optional()
        .describe(
          "Filter by author — accepts a username or user ID.",
        ),
      channel_id: z
        .string()
        .optional()
        .describe("Limit search to a specific channel."),
      has: z
        .enum(["link", "embed", "file", "sticker", "sound"])
        .optional()
        .describe("Filter by attachment type."),
      before: z
        .string()
        .optional()
        .describe(
          "Messages before this date (YYYY-MM-DD) or message ID.",
        ),
      after: z
        .string()
        .optional()
        .describe(
          "Messages after this date (YYYY-MM-DD) or message ID.",
        ),
      limit: z
        .number()
        .min(1)
        .max(25)
        .optional()
        .describe("Number of results (1-25, default 25)."),
    },
    async ({ guild_id, content, author, channel_id, has, before, after, limit }) => {
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
        minId = snowflake ?? after; // If not a date, assume it's already an ID
      }
      if (before) {
        const snowflake = dateToSnowflake(before);
        maxId = snowflake ?? before;
      }

      const results = await client.searchGuild(id, {
        content,
        author_id: authorId,
        channel_id,
        has,
        min_id: minId,
        max_id: maxId,
      });

      const maxResults = limit ?? 25;
      const trimmed = results.messages.slice(0, maxResults);

      return toolResult(formatSearchResults(trimmed, results.total_results));
    },
  );
}
