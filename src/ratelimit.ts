// Machine-wide rate limit shared by every discord-user-mcp process.
// Each MCP client (Claude Code, Codex, each session) runs its own server
// process, so the limit lives in a file guarded by a mkdir lock. The file
// holds when the last request was actually sent; the next one goes out
// only once MIN_INTERVAL_MS has passed since then.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DIR = path.join(os.homedir(), ".discord-user-mcp");
const STATE_FILE = path.join(DIR, "ratelimit-last-sent");
const LOCK_DIR = path.join(DIR, "ratelimit.lock");
const STALE_LOCK_MS = 5000;

// Hard ceiling of 0.2 requests/second (one every 5s); DISCORD_MAX_RPS may
// only lower it. The few ms of margin absorb clock/timer granularity.
const HARD_MAX_RPS = 0.2;
const envRps = Number(process.env.DISCORD_MAX_RPS);
const MAX_RPS = envRps > 0 && envRps < HARD_MAX_RPS ? envRps : HARD_MAX_RPS;
const MIN_INTERVAL_MS = Math.ceil(1000 / MAX_RPS) + 5;

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
      let last = 0;
      try {
        last = Number(fs.readFileSync(STATE_FILE, "utf8")) || 0;
      } catch {
        // first request on this machine
      }
      const now = Date.now();
      const wait = last + MIN_INTERVAL_MS - now;
      if (wait <= 0) fs.writeFileSync(STATE_FILE, String(now));
      return wait;
    });
    if (wait <= 0) return;
    await sleep(wait + Math.random() * 20); // jitter spreads out waiters
  }
}
