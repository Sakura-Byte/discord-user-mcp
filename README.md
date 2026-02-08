# discord-user-mcp

Discord MCP server using **user tokens**. No bot setup, no Developer Portal, no intents — just your token and go.

Built for [Claude Code](https://claude.com/claude-code) and any MCP-compatible client.

## Why user tokens?

Every other Discord MCP server requires creating a bot application, configuring intents, and inviting the bot to your server. This one uses your existing Discord session — the same access you already have in the app.

**Trade-off:** Using user tokens for automation is against Discord's ToS. This is a personal tool for your own account on your own machine. Use responsibly.

## Setup

### 1. Get your Discord token

Your token is stored encrypted in the Discord app's local storage. You can find it by:

- Opening Discord in a browser → DevTools → Network tab → any request → `Authorization` header
- Or extracting it from the desktop app's LevelDB storage (macOS: `~/Library/Application Support/discord/Local Storage/leveldb/`)

### 2. Add to Claude Code

```bash
claude mcp add discord -e DISCORD_TOKEN=your-token-here -- node /path/to/discord-user-mcp/dist/index.js
```

With a default server:

```bash
claude mcp add discord \
  -e DISCORD_TOKEN=your-token-here \
  -e DISCORD_DEFAULT_GUILD=your-server-id \
  -- node /path/to/discord-user-mcp/dist/index.js
```

### 3. Build from source

```bash
git clone https://github.com/olivier-motium/discord-user-mcp.git
cd discord-user-mcp
npm install
npm run build
```

## Tools (14)

### Core

| Tool | Description |
|------|-------------|
| `discord_list_guilds` | List servers you're in |
| `discord_list_channels` | List channels grouped by category |
| `discord_read_messages` | Read channel history with pagination |
| `discord_send_message` | Send a message, optionally as a reply |
| `discord_search` | **Search messages** by content, author, channel, date, attachment type |

### Essential

| Tool | Description |
|------|-------------|
| `discord_list_dms` | List DM conversations |
| `discord_send_dm` | Send a DM (by user ID or channel ID) |
| `discord_react` | Add emoji reaction to a message |
| `discord_pinned_messages` | Get pinned messages from a channel |
| `discord_list_threads` | List active threads in a server |
| `discord_guild_info` | Server details, roles, features |

### Additional

| Tool | Description |
|------|-------------|
| `discord_edit_message` | Edit your own message |
| `discord_delete_message` | Delete your own message |
| `discord_user_info` | User profile with server roles |

## Configuration

| Environment Variable | Required | Description |
|---------------------|----------|-------------|
| `DISCORD_TOKEN` | Yes | Your Discord user token |
| `DISCORD_DEFAULT_GUILD` | No | Default server ID — tools that need a guild will use this when not specified |

## Design choices

- **Plain text output** — no raw JSON. Messages formatted as `[2024-01-15 14:32] alice: content`. IDs always inline for tool chaining.
- **No discord.js** — raw `fetch` against Discord API v10. Zero runtime deps beyond MCP SDK.
- **Rate limit handling** — automatic retry with `retry_after` + jitter, up to 3 attempts.
- **Search is the star** — accepts usernames (resolved to IDs internally), date strings (`YYYY-MM-DD` converted to snowflakes), and all Discord search filters.
- **Conservative defaults** — 25 messages per read, not 100. Keeps output manageable for AI.

## License

MIT
