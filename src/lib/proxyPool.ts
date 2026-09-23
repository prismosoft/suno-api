import { HttpsProxyAgent } from "https-proxy-agent";

/**
 * A pool of Proxidize sticky-session proxies, with health tracking and failover.
 *
 * Why this exists: every outbound call used one hardcoded SUNO_PROXY_URL, so one exit IP carried
 * all of it. On 2026-09-23 DistroKid's Cloudflare blocked that address and every DistroKid call
 * in the pipeline failed at once — post-release scrapes and publishing alike. One address is a
 * single point of failure by construction.
 *
 * A "sticky session" is the `-s-<id>-` segment of the Proxidize username: the same id keeps the
 * same exit IP while it is in use, a different id gives a different IP. So a pool is just a list
 * of ids, and rotation is choosing a different one.
 *
 * Two opposing requirements, both real:
 *   - a *conversation* must stay on one IP. Suno validates captcha token + IP + session together,
 *     and DistroKid will not accept a login that starts answering from another country. So a
 *     caller passes a key (a song id, a client instance) and always gets the same proxy back.
 *   - *different* conversations must not share one IP, or the block above happens again.
 */

export type ProxyEntry = {
  id: string;
  url: string;
  blockedUntil: number;
  fails: number;
  lastUsed: number;
};

// A blocked IP is not blocked forever — Cloudflare bans of this kind lapse. Without an expiry the
// pool would drain permanently and need manual clearing.
const BLOCK_MS = Number(process.env.SUNO_PROXY_BLOCK_MINUTES || 30) * 60_000;

/** Accepts Proxidize's own `host:port:user:pass` lines as well as full proxy URLs, because the
 *  former is what the dashboard hands you and retyping them into URLs invites mistakes. */
function toProxyUrl(line: string): string | null {
  const s = line.trim();
  if (!s || s.startsWith("#")) return null;
  if (/^https?:\/\//i.test(s)) return s;
  const parts = s.split(":");
  if (parts.length !== 4) return null;
  const [host, port, user, pass] = parts;
  if (!host || !port || !user || !pass) return null;
  return `http://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}`;
}

/** The session id, for logging and health output — never the credentials. */
function idOf(url: string): string {
  const m = url.match(/-s-([A-Za-z0-9]+)-/);
  if (m) return m[1];
  try { return new URL(url).host; } catch { return "proxy"; }
}

let pool: ProxyEntry[] | null = null;

function load(): ProxyEntry[] {
  if (pool) return pool;
  const raw = process.env.SUNO_PROXY_POOL || process.env.SUNO_PROXY_URL || "";
  const urls = raw
    .split(/[\n,]+/)
    .map(toProxyUrl)
    .filter((u): u is string => !!u);
  pool = Array.from(new Set(urls)).map((url) => ({
    id: idOf(url), url, blockedUntil: 0, fails: 0, lastUsed: 0,
  }));
  return pool;
}

function healthy(now = Date.now()): ProxyEntry[] {
  return load().filter((e) => e.blockedUntil <= now);
}

function hash(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h;
}

export class ProxyPoolExhausted extends Error {
  constructor(total: number) {
    super(
      `every proxy session is currently blocked (${total} in the pool). ` +
      `Add more sessions to SUNO_PROXY_POOL, or wait for the blocks to lapse.`,
    );
    this.name = "ProxyPoolExhausted";
  }
}

/**
 * Pick a session. `key` pins a conversation to one IP — pass a song id, a release id, or any
 * stable string. `skip` lets a caller ask for a different one after a block.
 */
export function pickProxy(key?: string, skip: string[] = []): ProxyEntry {
  const all = load();
  if (!all.length) throw new Error("no proxies configured: set SUNO_PROXY_POOL or SUNO_PROXY_URL");
  const avail = healthy().filter((e) => !skip.includes(e.id));
  if (!avail.length) throw new ProxyPoolExhausted(all.length);
  const chosen = key
    ? avail[hash(key) % avail.length]
    : avail.reduce((a, b) => (a.lastUsed <= b.lastUsed ? a : b)); // least recently used
  chosen.lastUsed = Date.now();
  return chosen;
}

export function agentFor(entry: ProxyEntry) {
  return new HttpsProxyAgent(entry.url);
}

/** A 403/429 from a target is the proxy's IP being refused, not the request being wrong. */
export function reportBlocked(entry: ProxyEntry, reason: string) {
  entry.blockedUntil = Date.now() + BLOCK_MS;
  entry.fails += 1;
  console.warn(`[proxyPool] session ${entry.id} blocked for ${BLOCK_MS / 60000}m — ${reason}`);
}

export function reportOk(entry: ProxyEntry) {
  if (entry.blockedUntil) entry.blockedUntil = 0;
  entry.fails = 0;
}

export function poolHealth() {
  const now = Date.now();
  const all = load();
  return {
    total: all.length,
    healthy: all.filter((e) => e.blockedUntil <= now).length,
    blocked: all
      .filter((e) => e.blockedUntil > now)
      .map((e) => ({ id: e.id, fails: e.fails, minutesLeft: Math.ceil((e.blockedUntil - now) / 60000) })),
  };
}

/** Treat only the statuses that mean "this IP is refused" as a block. A 404 or 500 is the page's
 *  problem and rotating away from a perfectly good IP would just burn the pool. */
export function isBlockStatus(status?: number): boolean {
  return status === 403 || status === 429;
}
