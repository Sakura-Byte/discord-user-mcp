import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DiscordClient } from "../client.js";
import type {
  AnyObj,
  InteractionClient,
  InteractionOutcome,
} from "../interactions.js";
import { toolError, toolResult } from "./helpers.js";

const COMPONENT_NAMES: Record<number, string> = {
  2: "button",
  3: "string select",
  5: "user select",
  6: "role select",
  7: "mentionable select",
  8: "channel select",
};

function walkComponents(components: AnyObj[] | undefined, visit: (c: AnyObj) => void): void {
  for (const c of components ?? []) {
    visit(c);
    walkComponents(c.components, visit);
    if (c.component) walkComponents([c.component], visit);
    if (c.accessory) walkComponents([c.accessory], visit);
  }
}

function formatComponents(components: AnyObj[] | undefined): string[] {
  const lines: string[] = [];
  walkComponents(components, (c) => {
    if (c.type === 2) {
      const label = c.label ?? c.emoji?.name ?? "(no label)";
      if (c.url) lines.push(`  [link button] ${label} → ${c.url}`);
      else lines.push(`  [button] ${label} (custom_id: ${c.custom_id}${c.disabled ? ", disabled" : ""})`);
    } else if (COMPONENT_NAMES[c.type] && c.custom_id) {
      const opts = (c.options ?? [])
        .map((o: AnyObj) => `${o.label}=${o.value}`)
        .join(", ");
      lines.push(`  [${COMPONENT_NAMES[c.type]}] ${c.placeholder ?? ""} (custom_id: ${c.custom_id})${opts ? ` options: ${opts}` : ""}`);
    } else if (c.type === 10 && c.content) {
      lines.push(`  ${c.content}`); // text display (components v2)
    }
  });
  return lines;
}

function formatReply(m: AnyObj): string {
  const ephemeral = (m.flags ?? 0) & 64 ? " [ephemeral]" : "";
  const author = m.author?.global_name ?? m.author?.username ?? "unknown";
  const lines = [`${author} (message ID: ${m.id})${ephemeral}:`];
  if (m.content) lines.push(m.content);
  for (const e of m.embeds ?? []) {
    if (e.title) lines.push(`[embed] ${e.title}`);
    if (e.description) lines.push(e.description);
    for (const f of e.fields ?? []) lines.push(`${f.name}: ${f.value}`);
    if (e.url) lines.push(`[embed url] ${e.url}`);
  }
  for (const a of m.attachments ?? []) {
    const mb = ((a.size ?? 0) / (1024 * 1024)).toFixed(2);
    lines.push(`[file] ${a.filename} (${mb}MB) ${a.url}`);
  }
  lines.push(...formatComponents(m.components));
  return lines.join("\n");
}

function formatModal(modal: AnyObj): string {
  const lines = [`Modal "${modal.title}" (modal_id: ${modal.id}) — submit with discord_submit_modal:`];
  walkComponents(modal.components, (c) => {
    if (c.type === 4) {
      lines.push(`  [text input] custom_id: ${c.custom_id}${c.label ? `, label: ${c.label}` : ""}${c.required ? ", required" : ""}${c.placeholder ? `, placeholder: ${c.placeholder}` : ""}`);
    } else if (c.type === 18 && c.label) {
      lines.push(`  label: ${c.label}${c.description ? ` — ${c.description}` : ""}`);
    }
  });
  return lines.join("\n");
}

function formatOutcome(o: InteractionOutcome): string {
  const parts: string[] = [];
  if (o.failed) {
    parts.push(`Interaction failed${o.failureReason ? ` (${o.failureReason})` : ""}.`);
  }
  if (o.modal) parts.push(formatModal(o.modal));
  for (const m of o.messages) parts.push(formatReply(m));
  if (!parts.length) {
    parts.push(
      o.timedOut
        ? "No response received before the timeout (the bot may still reply; check the channel)."
        : "Interaction acknowledged with no visible reply.",
    );
  }
  return parts.join("\n\n");
}

function formatOptions(options: AnyObj[] | undefined, indent: string): string[] {
  const lines: string[] = [];
  for (const o of options ?? []) {
    if (o.type === 1 || o.type === 2) {
      lines.push(`${indent}${o.type === 2 ? "group" : "sub"} ${o.name}: ${o.description ?? ""}`);
      lines.push(...formatOptions(o.options, indent + "  "));
    } else {
      const choices = o.choices?.length
        ? ` choices: ${o.choices.map((c: AnyObj) => c.value).join(", ")}`
        : "";
      lines.push(`${indent}- ${o.name}${o.required ? " (required)" : ""}: ${o.description ?? ""}${choices}`);
    }
  }
  return lines;
}

export function registerInteractionTools(
  server: McpServer,
  client: DiscordClient,
  interactions: InteractionClient,
): void {
  server.tool(
    "discord_list_commands",
    "List slash commands usable in a channel (from all bots in the server or DM). Shows each command's options and subcommands.",
    {
      channel_id: z.string().describe("Channel where the command would be run."),
      guild_id: z.string().optional().describe("Server ID. Always pass it for server channels/threads; if omitted it costs an extra rate-limited lookup."),
      query: z.string().optional().describe("Only show commands whose name contains this text."),
    },
    async ({ channel_id, guild_id, query }) => {
      const guildId = guild_id ?? (await interactions.resolveGuildId(channel_id)) ?? undefined;
      const index = await interactions.getCommandIndex(channel_id, guildId);
      const apps = new Map(index.applications.map((a) => [a.id, a.name]));
      const cmds = index.commands.filter(
        (c) => (c.type ?? 1) === 1 && (!query || c.name.includes(query)),
      );
      if (!cmds.length) return toolResult("No matching slash commands.");
      const lines = cmds.map((c) =>
        [
          `/${c.name} — ${c.description ?? ""} [bot: ${apps.get(c.application_id) ?? c.application_id}, application_id: ${c.application_id}]`,
          ...formatOptions(c.options, "    "),
        ].join("\n"),
      );
      return toolResult(lines.join("\n"));
    },
  );

  server.tool(
    "discord_run_command",
    "Run a slash command as the user and return the bot's reply, including ephemeral replies only you can see, attachment URLs, buttons, and modals. This sends an interaction from the user's account.",
    {
      channel_id: z.string().describe("Channel (or thread) to run the command in."),
      guild_id: z.string().optional().describe("Server ID. Always pass it for server channels/threads; if omitted it costs an extra rate-limited lookup."),
      command: z.string().describe("Command name without the slash, e.g. '下载'."),
      application_id: z.string().optional().describe("Bot application ID, if several bots share the command name."),
      subcommand: z.string().optional().describe("Subcommand path separated by spaces, e.g. 'group sub'."),
      options: z.record(z.string()).optional().describe("Option values by option name."),
      timeout_seconds: z.number().min(3).max(120).optional().describe("How long to wait for the reply (default 20)."),
    },
    async ({ channel_id, guild_id, command, application_id, subcommand, options, timeout_seconds }) => {
      const name = command.replace(/^\//, "");
      const guildId = guild_id ?? (await interactions.resolveGuildId(channel_id)) ?? undefined;
      const index = await interactions.getCommandIndex(channel_id, guildId);
      const matches = index.commands.filter(
        (c) => c.name === name && (c.type ?? 1) === 1 && (!application_id || c.application_id === application_id),
      );
      if (!matches.length) {
        return toolError(`No slash command "/${name}" available here. Use discord_list_commands.`);
      }
      if (matches.length > 1) {
        const ids = matches.map((c) => c.application_id).join(", ");
        return toolError(`Several bots provide /${name}; pass application_id (one of: ${ids}).`);
      }
      const cmd = matches[0]!;
      let data: AnyObj;
      try {
        data = interactions.buildCommandData(
          cmd,
          subcommand ? subcommand.split(/\s+/) : [],
          options ?? {},
        );
      } catch (err) {
        return toolError((err as Error).message);
      }
      const outcome = await interactions.runCommand(
        cmd,
        channel_id,
        guildId,
        data,
        (timeout_seconds ?? 20) * 1000,
      );
      return toolResult(formatOutcome(outcome));
    },
  );

  server.tool(
    "discord_click_button",
    "Click a button or choose from a select menu on a bot message (including ephemeral ones returned by discord_run_command). Returns the bot's response.",
    {
      channel_id: z.string().describe("Channel containing the message."),
      message_id: z.string().describe("ID of the message with the component."),
      custom_id: z.string().describe("custom_id of the button or select menu."),
      guild_id: z.string().optional().describe("Server ID. Always pass it for server channels/threads; if omitted it costs an extra rate-limited lookup."),
      values: z.array(z.string()).optional().describe("Selected values, for select menus."),
      timeout_seconds: z.number().min(3).max(120).optional().describe("How long to wait for the reply (default 20)."),
    },
    async ({ channel_id, message_id, custom_id, guild_id, values, timeout_seconds }) => {
      let message = interactions.getCachedMessage(message_id);
      if (!message) {
        message = (await client.getMessage(channel_id, message_id)) as unknown as AnyObj;
      }
      let componentType: number | null = null;
      walkComponents(message.components, (c) => {
        if (c.custom_id === custom_id) componentType = c.type;
      });
      if (componentType === null) {
        return toolError(`No component with custom_id "${custom_id}" on message ${message_id}.`);
      }
      const guildId = guild_id ?? (await interactions.resolveGuildId(channel_id)) ?? undefined;
      const outcome = await interactions.clickComponent(
        { ...message, channel_id: message.channel_id ?? channel_id },
        guildId,
        custom_id,
        componentType,
        componentType === 2 ? undefined : values ?? [],
        (timeout_seconds ?? 20) * 1000,
      );
      return toolResult(formatOutcome(outcome));
    },
  );

  server.tool(
    "discord_submit_modal",
    "Fill in and submit a modal (pop-up form) that a bot opened in response to a command or button.",
    {
      modal_id: z.string().describe("modal_id shown in the previous tool result."),
      values: z.record(z.string()).describe("Text input values by custom_id."),
      timeout_seconds: z.number().min(3).max(120).optional().describe("How long to wait for the reply (default 20)."),
    },
    async ({ modal_id, values, timeout_seconds }) => {
      const modal = interactions.getCachedModal(modal_id);
      if (!modal) {
        return toolError(`Modal ${modal_id} not found; it may have expired. Re-run the command or click.`);
      }
      const outcome = await interactions.submitModal(
        modal,
        values,
        (timeout_seconds ?? 20) * 1000,
      );
      return toolResult(formatOutcome(outcome));
    },
  );
}
