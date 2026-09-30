import { DiscordAPIError } from "./client.js";
import {
  BROWSER_USER_AGENT,
  DiscordGateway,
  SUPER_PROPERTIES,
} from "./gateway.js";

// Loose shapes: interaction payloads carry many fields the rest of the
// codebase never needs, so they are not added to types.ts.
export type AnyObj = Record<string, any>;

export interface CommandIndex {
  applications: AnyObj[];
  commands: AnyObj[];
}

export interface InteractionOutcome {
  interactionId: string | null;
  failed: boolean;
  failureReason?: string;
  messages: AnyObj[];
  modal: AnyObj | null;
  timedOut: boolean;
}

// Option types from the Discord API.
const OPT_SUB_COMMAND = 1;
const OPT_SUB_COMMAND_GROUP = 2;
const OPT_INTEGER = 4;
const OPT_BOOLEAN = 5;
const OPT_NUMBER = 10;

const MESSAGE_FLAG_LOADING = 1 << 7;

function snowflakeNonce(): string {
  const ms = BigInt(Date.now() - 1420070400000);
  return ((ms << 22n) | BigInt(Math.floor(Math.random() * 4194303))).toString();
}

export class InteractionClient {
  private baseUrl = "https://discord.com/api/v9";
  // Ephemeral messages and modals can't be fetched later over REST,
  // so keep the ones we have seen for follow-up clicks/submits.
  private messageCache = new Map<string, AnyObj>();
  private modalCache = new Map<string, AnyObj>();

  constructor(
    private token: string,
    private gateway: DiscordGateway,
  ) {}

  private headers(): Record<string, string> {
    return {
      Authorization: this.token,
      "User-Agent": BROWSER_USER_AGENT,
      "X-Super-Properties": Buffer.from(
        JSON.stringify(SUPER_PROPERTIES),
      ).toString("base64"),
      "X-Discord-Locale": "zh-CN",
    };
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: this.headers(),
    });
    if (!res.ok) {
      throw new DiscordAPIError(
        res.status,
        (await res.json().catch(() => ({}))) as Record<string, unknown>,
      );
    }
    return (await res.json()) as T;
  }

  getCachedMessage(id: string): AnyObj | undefined {
    return this.messageCache.get(id);
  }

  getCachedModal(id: string): AnyObj | undefined {
    return this.modalCache.get(id);
  }

  async getCommandIndex(
    channelId: string,
    guildId?: string,
  ): Promise<CommandIndex> {
    const path = guildId
      ? `/guilds/${guildId}/application-command-index`
      : `/channels/${channelId}/application-command-index`;
    const data = await this.get<AnyObj>(path);
    return {
      applications: data.applications ?? [],
      commands: data.application_commands ?? [],
    };
  }

  /** Build the nested option list for a (sub)command invocation. */
  buildCommandData(
    command: AnyObj,
    subcommandPath: string[],
    values: Record<string, string>,
  ): AnyObj {
    let schema: AnyObj[] = command.options ?? [];
    const root: AnyObj[] = [];
    let target = root;

    for (const name of subcommandPath) {
      const sub = schema.find(
        (o) =>
          o.name === name &&
          (o.type === OPT_SUB_COMMAND || o.type === OPT_SUB_COMMAND_GROUP),
      );
      if (!sub) throw new Error(`Unknown subcommand "${name}".`);
      const node: AnyObj = { type: sub.type, name: sub.name, options: [] };
      target.push(node);
      target = node.options;
      schema = sub.options ?? [];
    }

    for (const [name, raw] of Object.entries(values)) {
      const opt = schema.find((o) => o.name === name);
      if (!opt) {
        const known = schema.map((o) => o.name).join(", ") || "(none)";
        throw new Error(`Unknown option "${name}". Options: ${known}`);
      }
      let value: unknown = raw;
      if (opt.type === OPT_INTEGER) value = parseInt(raw, 10);
      else if (opt.type === OPT_NUMBER) value = parseFloat(raw);
      else if (opt.type === OPT_BOOLEAN) value = raw === "true";
      target.push({ type: opt.type, name: opt.name, value });
    }

    const missing = schema
      .filter((o) => o.required && !(o.name in values))
      .map((o) => o.name);
    if (missing.length) {
      throw new Error(`Missing required option(s): ${missing.join(", ")}`);
    }

    return {
      version: command.version,
      id: command.id,
      name: command.name,
      type: command.type ?? 1,
      options: root,
      application_command: command,
      attachments: [],
    };
  }

  async runCommand(
    command: AnyObj,
    channelId: string,
    guildId: string | undefined,
    data: AnyObj,
    timeoutMs: number,
  ): Promise<InteractionOutcome> {
    return this.send(
      {
        type: 2,
        application_id: command.application_id,
        guild_id: guildId,
        channel_id: channelId,
        data,
        analytics_location: "slash_ui",
      },
      timeoutMs,
    );
  }

  async clickComponent(
    message: AnyObj,
    guildId: string | undefined,
    customId: string,
    componentType: number,
    selectValues: string[] | undefined,
    timeoutMs: number,
  ): Promise<InteractionOutcome> {
    const applicationId =
      message.application_id ?? message.author?.id ?? undefined;
    const data: AnyObj = { component_type: componentType, custom_id: customId };
    if (selectValues) {
      data.type = componentType;
      data.values = selectValues;
    }
    return this.send(
      {
        type: 3,
        guild_id: guildId,
        channel_id: message.channel_id,
        message_flags: message.flags ?? 0,
        message_id: message.id,
        application_id: applicationId,
        data,
      },
      timeoutMs,
      message.id,
    );
  }

  async submitModal(
    modal: AnyObj,
    values: Record<string, string>,
    timeoutMs: number,
  ): Promise<InteractionOutcome> {
    const fill = (c: AnyObj): AnyObj => {
      if (c.type === 4) {
        return { type: 4, custom_id: c.custom_id, value: values[c.custom_id] ?? "" };
      }
      if (c.component) return { type: c.type, component: fill(c.component) };
      if (c.components) return { type: c.type, components: c.components.map(fill) };
      return { type: c.type, custom_id: c.custom_id };
    };
    return this.send(
      {
        type: 5,
        application_id: modal.application?.id,
        channel_id: modal.channel_id,
        guild_id: modal.guild_id,
        data: {
          id: modal.id,
          custom_id: modal.custom_id,
          components: (modal.components ?? []).map(fill),
        },
      },
      timeoutMs,
    );
  }

  /**
   * POST an interaction and collect what comes back over the gateway:
   * messages tied to the interaction id, or a modal tied to our nonce.
   */
  private async send(
    payload: AnyObj,
    timeoutMs: number,
    watchMessageId?: string,
  ): Promise<InteractionOutcome> {
    const sessionId = await this.gateway.ensureReady();
    const nonce = snowflakeNonce();
    const outcome: InteractionOutcome = {
      interactionId: null,
      failed: false,
      messages: [],
      modal: null,
      timedOut: false,
    };

    let finish: () => void = () => {};
    const done = new Promise<void>((r) => (finish = r));
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    // After a final (non-loading) reply, linger briefly for follow-ups.
    const settleSoon = () => {
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(finish, 1500);
    };

    const byId = new Map<string, AnyObj>();
    // Messages can race ahead of INTERACTION_CREATE; hold them until we
    // know our interaction id.
    const early: AnyObj[] = [];
    const accept = (d: AnyObj) => {
      const merged = { ...(byId.get(d.id) ?? {}), ...d };
      byId.set(d.id, merged);
      this.messageCache.set(d.id, merged);
      if (!((merged.flags ?? 0) & MESSAGE_FLAG_LOADING)) settleSoon();
    };

    const unsubscribe = this.gateway.on((event, d) => {
      if (!d) return;
      switch (event) {
        case "INTERACTION_CREATE":
        case "INTERACTION_SUCCESS":
          if (d.nonce === nonce && !outcome.interactionId) {
            outcome.interactionId = d.id;
            for (const m of early.splice(0)) {
              if ((m.interaction_metadata?.id ?? m.interaction?.id) === d.id) accept(m);
            }
          }
          break;
        case "INTERACTION_FAILURE":
          if (d.nonce === nonce) {
            outcome.interactionId = d.id;
            outcome.failed = true;
            outcome.failureReason = d.reason_code != null ? `reason ${d.reason_code}` : undefined;
            finish();
          }
          break;
        case "INTERACTION_MODAL_CREATE":
          if (d.nonce === nonce || (outcome.interactionId && d.id === outcome.interactionId)) {
            // Modal events may omit where they came from; submit needs it.
            d.channel_id ??= payload.channel_id;
            d.guild_id ??= payload.guild_id;
            outcome.modal = d;
            this.modalCache.set(d.id, d);
            finish();
          }
          break;
        case "MESSAGE_CREATE":
        case "MESSAGE_UPDATE": {
          const iid = d.interaction_metadata?.id ?? d.interaction?.id;
          if (iid && !outcome.interactionId) {
            early.push(d);
          } else if (iid && iid === outcome.interactionId) {
            accept(d);
          } else if (byId.has(d.id) || (event === "MESSAGE_UPDATE" && d.id === watchMessageId)) {
            accept(d); // update to a tracked reply, or the clicked message
          }
          break;
        }
      }
    });

    try {
      const form = new FormData();
      form.append(
        "payload_json",
        JSON.stringify({ ...payload, session_id: sessionId, nonce }),
      );
      const res = await fetch(`${this.baseUrl}/interactions`, {
        method: "POST",
        headers: this.headers(),
        body: form,
      });
      if (!res.ok) {
        throw new DiscordAPIError(
          res.status,
          (await res.json().catch(() => ({}))) as Record<string, unknown>,
        );
      }

      const timeout = setTimeout(() => {
        outcome.timedOut = true;
        finish();
      }, timeoutMs);
      await done;
      clearTimeout(timeout);
    } finally {
      if (settleTimer) clearTimeout(settleTimer);
      unsubscribe();
    }

    outcome.messages = [...byId.values()];
    return outcome;
  }
}
