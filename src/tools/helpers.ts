import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

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
