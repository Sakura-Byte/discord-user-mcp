import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { DiscordClient } from "../client.js";
import type { Message } from "../types.js";

export function toolResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

export function toolError(text: string): CallToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

export function resolveGuildId(
  provided?: string,
): string | CallToolResult {
  const id = provided || process.env.DISCORD_DEFAULT_GUILD;
  if (!id) {
    return toolError(
      "No guild_id provided and DISCORD_DEFAULT_GUILD not set. " +
        "Either pass guild_id or set the env var. " +
        "Use discord_list_guilds to find your server IDs.",
    );
  }
  return id;
}

/**
 * Resolve an author parameter to a user ID.
 * If it looks like a snowflake (all digits), use directly.
 * Otherwise search guild members by username.
 */
export async function resolveAuthor(
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

/**
 * Scan channel messages using the regular messages endpoint.
 * Used as a fallback when guild search returns 403.
 * Walks backward from `before` (or channel head) collecting up to `limit` matches.
 */
export async function scanChannelMessages(
  client: DiscordClient,
  channelId: string,
  opts: {
    authorId?: string;
    content?: string;
    minId?: string;
    maxId?: string;
    limit?: number;
  },
): Promise<Message[]> {
  const target = opts.limit ?? 25;
  const matches: Message[] = [];
  let before = opts.maxId;
  const maxPages = 10; // safety cap: 10 * 100 = 1000 messages scanned

  for (let page = 0; page < maxPages && matches.length < target; page++) {
    const batch = await client.getMessages(channelId, {
      limit: 100,
      before,
    });
    if (batch.length === 0) break;

    for (const msg of batch) {
      // Stop if we've passed the minId boundary
      if (opts.minId && BigInt(msg.id) < BigInt(opts.minId)) {
        return matches.slice(0, target);
      }
      const authorMatch = !opts.authorId || msg.author.id === opts.authorId;
      const contentMatch =
        !opts.content ||
        msg.content.toLowerCase().includes(opts.content.toLowerCase());
      if (authorMatch && contentMatch) {
        matches.push(msg);
        if (matches.length >= target) break;
      }
    }

    before = batch[batch.length - 1]!.id;
  }

  return matches.slice(0, target);
}
