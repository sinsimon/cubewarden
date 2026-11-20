/**
 * Read-only HTTP with a disk cache, polite pacing and retries. Every response is kept under
 * `<cacheDir>/<host>/<hash>.json.gz` with the date it was fetched, so a rebuild runs offline.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

export const USER_AGENT = "cubewarden/0.1";

/** Minimum pause between two network calls to the same host, in milliseconds. */
const HOST_DELAY: Record<string, number> = { "api.scryfall.com": 100, "cubecobra.com": 500, "www.17lands.com": 1000, "17lands-public.s3.amazonaws.com": 100 };
const DEFAULT_DELAY = 500;
const ATTEMPTS = 5;

export interface HttpOptions {
  cacheDir: string;
  /** Ignore cached responses (they are still rewritten). */
  refresh?: boolean;
  /** Cached responses older than this many days count as missing (default: never expire). */
  maxAgeDays?: number;
  fetchImpl?: typeof fetch;
  log?: (s: string) => void;
}

export interface RequestOptions {
  method?: "GET" | "POST";
  body?: string;
  /** Cache key to use instead of the URL, for URLs that change every day (an end date). */
  cacheKey?: string;
  /** Treat a 404 as an answer (Scryfall answers 404 to a search with no results). */
  notFoundOk?: boolean;
}

interface CacheEntry { url: string; method: string; body?: string; fetchedAt: string; text: string }

/** Per host: how many responses came from the network or the cache, and the oldest and newest fetch date used. */
export interface HostStats { network: number; cached: number; oldest: string | null; newest: string | null }

export interface Http {
  text(url: string, o?: RequestOptions): Promise<{ text: string; fetchedAt: string }>;
  json<T>(url: string, o?: RequestOptions): Promise<T>;
  /** HEAD, never cached: whether a file exists (2xx), its Last-Modified date (UTC, YYYY-MM-DD) and size. 403 and 404 mean "no file". */
  head(url: string): Promise<{ exists: boolean; lastModified: string | null; size: number | null }>;
  /** A fetch-compatible view of the same cache, for code that takes a fetch function. */
  fetch: typeof fetch;
  stats: Record<string, HostStats>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function cachePath(dir: string, url: string, o: RequestOptions): string {
  const key = `${o.method || "GET"} ${o.cacheKey || url}\n${o.body || ""}`;
  return join(dir, new URL(url).host, createHash("sha256").update(key).digest("hex").slice(0, 32) + ".json.gz");
}

async function readCache(path: string): Promise<CacheEntry | null> {
  try { return JSON.parse(gunzipSync(await readFile(path)).toString("utf8")); } catch { return null; }
}

async function writeCache(path: string, entry: CacheEntry): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, gzipSync(JSON.stringify(entry)));
}

function retryDelay(res: Response | null, attempt: number): number {
  const after = Number(res?.headers.get("retry-after"));
  return Number.isFinite(after) && after > 0 ? after * 1000 : 2000 * (attempt + 1);
}

export function createHttp(opts: HttpOptions): Http {
  const doFetch = opts.fetchImpl ?? fetch;
  const lastCall: Record<string, number> = {};
  const stats: Record<string, HostStats> = {};

  function record(host: string, from: "network" | "cached", fetchedAt: string) {
    const s = (stats[host] ||= { network: 0, cached: 0, oldest: null, newest: null });
    s[from]++;
    const day = fetchedAt.slice(0, 10);
    if (!s.oldest || day < s.oldest) s.oldest = day;
    if (!s.newest || day > s.newest) s.newest = day;
  }

  async function pace(host: string) {
    const wait = (lastCall[host] ?? 0) + (HOST_DELAY[host] ?? DEFAULT_DELAY) - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall[host] = Date.now();
  }

  async function network(url: string, o: RequestOptions): Promise<string> {
    const host = new URL(url).host;
    const headers: Record<string, string> = { "User-Agent": USER_AGENT, Accept: "application/json" };
    if (o.body != null) headers["Content-Type"] = "application/json";
    for (let attempt = 0; ; attempt++) {
      await pace(host);
      let res: Response | null = null;
      try {
        res = await doFetch(url, { method: o.method || "GET", headers, body: o.body });
        if (res.ok || (o.notFoundOk && res.status === 404)) return await res.text();
      } catch (e) {
        if (attempt >= ATTEMPTS - 1) throw e;
      }
      const retriable = !res || res.status === 429 || res.status >= 500;
      if (!retriable || attempt >= ATTEMPTS - 1) throw new Error(`${o.method || "GET"} ${url} answered ${res?.status}`);
      opts.log?.(`  ${host} answered ${res?.status ?? "nothing"}, retrying`);
      await sleep(retryDelay(res, attempt));
    }
  }

  async function text(url: string, o: RequestOptions = {}) {
    const host = new URL(url).host;
    const path = cachePath(opts.cacheDir, url, o);
    const hit = opts.refresh ? null : await readCache(path);
    if (hit && !expired(hit)) {
      record(host, "cached", hit.fetchedAt);
      return { text: hit.text, fetchedAt: hit.fetchedAt };
    }
    const body = await network(url, o);
    const entry: CacheEntry = { url, method: o.method || "GET", body: o.body, fetchedAt: new Date().toISOString(), text: body };
    await writeCache(path, entry);
    record(host, "network", entry.fetchedAt);
    return { text: body, fetchedAt: entry.fetchedAt };
  }

  function expired(e: CacheEntry): boolean {
    return opts.maxAgeDays != null && Date.now() - Date.parse(e.fetchedAt) > opts.maxAgeDays * 86_400_000;
  }

  async function head(url: string) {
    const host = new URL(url).host;
    for (let attempt = 0; ; attempt++) {
      await pace(host);
      let res: Response | null = null;
      try {
        res = await doFetch(url, { method: "HEAD", headers: { "User-Agent": USER_AGENT } });
      } catch (e) {
        if (attempt >= ATTEMPTS - 1) throw e;
      }
      if (res?.ok) {
        const modified = res.headers.get("last-modified");
        const size = Number(res.headers.get("content-length"));
        return { exists: true, lastModified: modified ? new Date(modified).toISOString().slice(0, 10) : null, size: Number.isFinite(size) ? size : null };
      }
      if (res && (res.status === 403 || res.status === 404)) return { exists: false, lastModified: null, size: null };
      if (attempt >= ATTEMPTS - 1) throw new Error(`HEAD ${url} answered ${res?.status}`);
      await sleep(retryDelay(res, attempt));
    }
  }

  const cachedFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method || "GET").toUpperCase() as "GET" | "POST";
    const body = typeof init?.body === "string" ? init.body : undefined;
    const r = await text(url, { method, body });
    return new Response(r.text, { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  return {
    text,
    async json<T>(url: string, o?: RequestOptions) { return JSON.parse((await text(url, o)).text) as T; },
    head,
    fetch: cachedFetch,
    stats,
  };
}
