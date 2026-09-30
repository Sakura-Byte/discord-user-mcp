// Machine-wide rate limit shared by every discord-user-mcp process.
// Each MCP client (Claude Code, Codex, each session) runs its own server
// process, so the limit lives in a file guarded by a mkdir lock. The file
// logs when requests were actually sent; a request goes out only if fewer
// than MAX_RPS were sent in the last second (a sliding window).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DIR = path.join(os.homedir(), ".discord-user-mcp");
const STATE_FILE = path.join(DIR, "ratelimit-log");
const LOCK_DIR = path.join(DIR, "ratelimit.lock");
const STALE_LOCK_MS = 5000;

// Hard ceiling of 2 requests/second; DISCORD_MAX_RPS=1 may lower it.
const MAX_RPS = process.env.DISCORD_MAX_RPS === "1" ? 1 : 2;
// Small margin so clock/timer granularity can't let an extra request in.
const WINDOW_MS = 1000 + 5;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withLock<T>(fn: () => T): Promise<T> {
  fs.mkdirSync(DIR, { recursive: true });
  for (;;) {
    try {
      fs.mkdirSync(LOCK_DIR);
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      // A holder that crashed leaves the lock behind; reclaim it.
      try {
        if (Date.now() - fs.statSync(LOCK_DIR).mtimeMs > STALE_LOCK_MS) {
          fs.rmdirSync(LOCK_DIR);
          continue;
        }
      } catch {
        continue; // released between our mkdir and stat
      }
      await sleep(5 + Math.random() * 10);
    }
  }
  try {
    return fn();
  } finally {
    fs.rmdirSync(LOCK_DIR);
  }
}

/** Wait until this process may send one request to Discord. */
export async function acquireSlot(): Promise<void> {
  for (;;) {
    const wait = await withLock(() => {
      let sent: number[] = [];
      try {
        sent = fs.readFileSync(STATE_FILE, "utf8").split(",").map(Number);
      } catch {
        // first request on this machine
      }
      const now = Date.now();
      sent = sent.filter((t) => t > now - WINDOW_MS);
      if (sent.length < MAX_RPS) {
        sent.push(now);
        fs.writeFileSync(STATE_FILE, sent.join(","));
        return 0;
      }
      return Math.min(...sent) + WINDOW_MS - now;
    });
    if (wait <= 0) return;
    await sleep(wait + Math.random() * 20); // jitter spreads out waiters
  }
}
