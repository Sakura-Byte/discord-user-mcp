import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DiscordClient } from "../client.js";
import { formatMemberInfo } from "../formatters.js";
import { resolveGuildId, toolError, toolResult } from "./helpers.js";

export function registerMemberTools(
  server: McpServer,
  client: DiscordClient,
): void {
  server.tool(
    "discord_user_info",
    "Get information about a user in a server: username, display name, when they joined, and their roles.",
    {
      user_id: z.string().describe("User ID to look up."),
      guild_id: z
        .string()
        .optional()
        .describe(
          "Server ID for member-specific info (joined date, roles). Uses DISCORD_DEFAULT_GUILD if not provided.",
        ),
    },
    async ({ user_id, guild_id }) => {
      const gid = resolveGuildId(guild_id);
      if (typeof gid !== "string") {
        // No guild — just get basic user info
        const user = await client.getUser(user_id);
        return toolResult(
          `User: ${user.global_name || user.username}\nUsername: ${user.username}\nID: ${user.id}`,
        );
      }

      try {
        const [member, guild] = await Promise.all([
          client.getGuildMember(gid, user_id),
          client.getGuild(gid),
        ]);
        return toolResult(formatMemberInfo(member, guild.roles));
      } catch (e) {
        // Fallback to basic user info if not a member
        const user = await client.getUser(user_id);
        return toolResult(
          `User: ${user.global_name || user.username}\nUsername: ${user.username}\nID: ${user.id}\n(Not a member of this server or insufficient permissions)`,
        );
      }
    },
  );
}
