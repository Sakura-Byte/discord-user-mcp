import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DiscordClient } from "../client.js";
import type { InteractionClient } from "../interactions.js";
import { registerChannelTools } from "./channels.js";
import { registerDMTools } from "./dms.js";
import { registerFindTools } from "./find.js";
import { registerGuildTools } from "./guilds.js";
import { registerInteractionTools } from "./interactions.js";
import { registerMemberTools } from "./members.js";
import { registerMessageTools } from "./messages.js";
import { registerPinTools } from "./pins.js";
import { registerReactionTools } from "./reactions.js";
import { registerSearchTools } from "./search.js";
import { registerThreadTools } from "./threads.js";

export function registerAllTools(
  server: McpServer,
  client: DiscordClient,
  interactions: InteractionClient,
): void {
  registerGuildTools(server, client);
  registerChannelTools(server, client);
  registerMessageTools(server, client);
  registerSearchTools(server, client);
  registerFindTools(server, client);
  registerDMTools(server, client);
  registerReactionTools(server, client);
  registerPinTools(server, client);
  registerThreadTools(server, client);
  registerMemberTools(server, client);
  registerInteractionTools(server, client, interactions);
}
