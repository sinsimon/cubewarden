/**
 * Generic card data for the hosted site, one shard per set: `<out>/sets/<code>.json` and `<out>/index.json`.
 * No cube appears here: only cards, their oracle tags, CubeCobra statistics and 17Lands win rates of each set.
 *
 * Built unattended (a nightly GitHub Action), so it decides by itself what to rebuild, in this order:
 *   1. sets with no shard, newest first;
 *   2. sets whose 17Lands Public Dataset archive is newer than the stored win rates (or appeared since);
 *   3. sets released in the last 120 days (still drafted), once a week: card ratings and CubeCobra stats move;
 *   4. shards older than 35 days (monthly refresh of CubeCobra stats), oldest first;
 *   or every set with `all`. It stops starting sets when the time budget is spent: the rest waits for the
 * next run. Whatever happens it ends with printSets and index.json, so a partial result can be published.
 * A set that fails keeps its old shard; the run goes on and reports the failure.
 *
 * Win rates of a set, in order: the Public Dataset archive (scripts/winrates.py, exact adjusted WR);
 * 17Lands Card Ratings while the set is recent (approximate adjusted WR, see adjustedFromPairs); else none.
 * Existing win rates are never replaced by nothing: when a refresh finds no data, the old values stay.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { Card } from "../model.ts";
import { addDetails } from "./cubecobra-details.ts";
import { createHttp, type Http } from "./http.ts";
import { cardFromPrintings, fetchSets, groupByOracle, isPoolPrinting, pickPrinting, searchAll, type ScryfallSet } from "./scryfall-cards.ts";
import { adjustedFromPairs, cardRatingsForSet, deckBaselines, eventOf, hasLiveRatings, MIN_GAMES, nameMatcher, printedNames, type WinRate } from "./winrates.ts";

/**
 * The universe: released paper sets with 17Lands Premier Draft data (plus the documented exceptions of EVENTS in
 * winrates.ts: spm, drafted as OM1 Pick Two Draft), found by themselves every run. Candidates
 * are Scryfall sets of CANDIDATE_TYPES released since CANDIDATES_SINCE; a candidate is in when its Premier Draft
 * archive exists (17Lands Public Dataset) or 17Lands' Card Ratings report Premier Draft games for it (the set
 * being drafted now). A set once in stays in (its win rates do not disappear between the end of drafting and
 * the archive). No card-only shards: a set without win rates is not published.
 */
export const CANDIDATE_TYPES = ["core", "expansion", "masters", "draft_innovation"];
export const CANDIDATES_SINCE = "2019-01-01";
export const RECENT_DAYS = 120;
/** A recent set is rebuilt at most this often (card ratings and CubeCobra stats). */
export const RECENT_REFRESH_DAYS = 7;
export const STALE_DAYS = 35;
export const DEFAULT_BUDGET_MINUTES = 300;
/** Cached HTTP answers older than this are fetched again, so a cache restored from last week is never served. */
const CACHE_MAX_AGE_DAYS = 3;
const ARCHIVE_URL = "https://17lands-public.s3.amazonaws.com/analysis_data/game_data/game_data_public.{event}.{format}.csv.gz";
/** scripts/winrates.py, seen from src/data/ (sources) or from dist/ (the bundled CLI). */
const WINRATES_SCRIPT = ["../../scripts/winrates.py", "../scripts/winrates.py"]
  .map((p) => fileURLToPath(new URL(p, import.meta.url))).find((p) => existsSync(p)) ?? "scripts/winrates.py";
const SCRIPT_TIMEOUT_MS = 60 * 60 * 1000;

export type WrSource = "game-data" | "card-ratings" | null;
export interface SetEntry {
  code: string; name: string; released: string; cards: number; builtAt: string;
  wr: { source: WrSource; asOf: string | null; games: number | null };
}
export interface DataIndex { version: 1; builtAt: string; sets: SetEntry[] }
export interface Shard { set: string; builtAt: string; cards: Card[] }
interface Archive { exists: boolean; lastModified: string | null; size: number | null }
interface UniverseSet { code: string; name: string; released: string; setType: string; cardCount: number }

export interface PublishOptions {
  outDir: string;
  cacheDir: string;
  /** Rebuild every set (and recompute archives). */
  all?: boolean;
  /** Only consider these set codes for a rebuild; the others keep their shards. */
  only?: string[];
  /** Stop starting new sets after this many minutes (default 300). */
  budgetMinutes?: number;
  refresh?: boolean;
  today?: string;
  fetchImpl?: typeof fetch;
  log?: (s: string) => void;
}

export interface PublishResult {
  built: { code: string; reason: string; cards: number; wr: SetEntry["wr"]; seconds: number }[];
  failed: { code: string; reason: string; error: string }[];
  kept: number;
  /** Sets that needed a rebuild but did not fit in the time budget: next run. */
  deferred: string[];
  universe: UniverseSet[];
  /** Shard files removed because their set left the universe. */
  removed: string[];
  printSetsChanged: number;
}

const utcToday = () => new Date().toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;
const shardPath = (out: string, code: string) => join(out, "sets", `${code}.json`);
const archiveUrl = (code: string) => { const e = eventOf(code); return ARCHIVE_URL.replace("{event}", e.event).replace("{format}", e.format); };

async function writeAtomic(path: string, text: string): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path + ".tmp", text);
  await rename(path + ".tmp", path);
}

async function readJson<T>(path: string): Promise<T | null> {
  try { return JSON.parse(await readFile(path, "utf8")) as T; } catch { return null; }
}

async function readShard(out: string, code: string): Promise<Shard | null> {
  const s = await readJson<Shard>(shardPath(out, code));
  return s && s.set === code && Array.isArray(s.cards) ? s : null;
}

/** Released (Scryfall released_at on or before today): a set in spoiler season has a partial card list and stays out. */
export const isReleased = (s: ScryfallSet, today: string) => !!s.released_at && s.released_at <= today;

/** Candidate sets: released paper sets of CANDIDATE_TYPES since CANDIDATES_SINCE, newest first. */
export async function candidates(http: Http, today: string): Promise<UniverseSet[]> {
  return (await fetchSets(http))
    .filter((s: ScryfallSet) => CANDIDATE_TYPES.includes(s.set_type || "") && !s.digital && isReleased(s, today) && s.released_at! >= CANDIDATES_SINCE)
    .map((s) => ({ code: s.code, name: s.name || s.code, released: s.released_at!, setType: s.set_type!, cardCount: s.card_count ?? 0 }))
    .sort((a, b) => b.released.localeCompare(a.released) || a.code.localeCompare(b.code));
}


/** Why a set must be rebuilt and its priority (0 = first), or null when its shard is current. */
export function rebuildReason(set: UniverseSet, entry: SetEntry | undefined, hasShard: boolean, archive: Archive, today: string, all = false): { reason: string; priority: number } | null {
  if (all) return { reason: "--all", priority: 0 };
  if (!hasShard || !entry) return { reason: "no shard", priority: 0 };
  if (archive.exists && entry.wr.source !== "game-data") return { reason: "17Lands archive appeared", priority: 1 };
  if (archive.exists && archive.lastModified && entry.wr.asOf && archive.lastModified > entry.wr.asOf) return { reason: `17Lands archive updated ${archive.lastModified}`, priority: 1 };
  if (daysBetween(set.released, today) <= RECENT_DAYS && daysBetween(entry.builtAt, today) >= RECENT_REFRESH_DAYS) return { reason: "recent set", priority: 2 };
  if (daysBetween(entry.builtAt, today) > STALE_DAYS) return { reason: `shard from ${entry.builtAt}`, priority: 3 };
  return null;
}

// ---- win rates of one set ---------------------------------------------------------------------

interface SetWinRates { byId: Record<string, WinRate>; wr: SetEntry["wr"]; unmatched: string[] }
interface ScriptOutput { asOf: string; games: number; deckColors?: boolean; cards: Record<string, { games: number; gihWr: number; adjWr: number | null }> }

/** Runs scripts/winrates.py on the set's archive; the result is cached by event, format and archive date. */
async function runWinratesScript(code: string, archive: Archive, o: PublishOptions): Promise<ScriptOutput> {
  const { event, format } = eventOf(code);
  const cached = join(o.cacheDir, "winrates", `${event}.${format}.${archive.lastModified}.json`);
  const hit = o.refresh ? null : await readJson<ScriptOutput>(cached);
  if (hit) return hit;
  if (!existsSync(WINRATES_SCRIPT)) throw new Error(`${WINRATES_SCRIPT} not found: game-data win rates need a clone of the repository`);
  o.log?.(`    17Lands archive ${event}.${format} (${archive.size ? Math.round(archive.size / 1e6) + " MB" : "size unknown"})`);
  try {
    await promisify(execFile)("uv", ["run", "--quiet", "--with", "duckdb", "python", WINRATES_SCRIPT, "--event", event, "--format", format, "--out", cached],
      { timeout: SCRIPT_TIMEOUT_MS, maxBuffer: 16 << 20 });
  } catch (e) {
    const stderr = String((e as { stderr?: string }).stderr || "").trim().split("\n").slice(-3).join(" | ");
    throw new Error(`scripts/winrates.py failed for ${event}.${format}: ${stderr || (e instanceof Error ? e.message : e)}`);
  }
  const out = await readJson<ScriptOutput>(cached);
  if (!out) throw new Error(`scripts/winrates.py wrote no result for ${event}`);
  return out;
}

async function gameDataWinRates(http: Http, code: string, cards: Card[], archive: Archive, o: PublishOptions): Promise<SetWinRates> {
  const r = await runWinratesScript(code, archive, o);
  const { printedNamesFrom } = eventOf(code);
  const match = nameMatcher(cards, code, printedNamesFrom ? await printedNames(http, printedNamesFrom) : new Map());
  // Archives without deck colours (KHM, STX): the adjusted WR is approximated from 17Lands Color Ratings.
  const approx = r.deckColors === false ? await colorPairAdjuster(http, code) : null;
  const colors = new Map(cards.map((c) => [c.id, c.colors]));
  const byId: Record<string, WinRate> = {};
  const unmatched: string[] = [];
  for (const [name, w] of Object.entries(r.cards)) {
    const id = match(name);
    if (!id) { unmatched.push(name); continue; }
    const adjWr = w.adjWr ?? approx?.(w.gihWr, colors.get(id) ?? "") ?? null;
    if (!byId[id] || byId[id].games < w.games) byId[id] = { gihWr: round4(w.gihWr), adjWr: adjWr == null ? null : round4(adjWr), games: w.games };
  }
  return { byId, wr: { source: "game-data", asOf: r.asOf, games: r.games }, unmatched };
}

/** adjustedFromPairs with the event's Color Ratings (whole history) as baselines. */
async function colorPairAdjuster(http: Http, code: string): Promise<(gihWr: number, colors: string) => number | null> {
  const { event, format } = eventOf(code);
  const base = `https://www.17lands.com/color_ratings/data?expansion=${event}&event_type=${format}&start_date=2020-01-01`;
  const rows = await http.json<Parameters<typeof deckBaselines>[0]>(`${base}&end_date=${utcToday()}&combine_splash=true`, { cacheKey: `${base}&combine_splash=true` });
  const { overall, decks } = deckBaselines(rows);
  return (gihWr, colors) => (overall == null ? null : adjustedFromPairs(gihWr, colors, decks, overall));
}

async function cardRatingsWinRates(http: Http, code: string, cards: Card[]): Promise<SetWinRates> {
  const r = await cardRatingsForSet(http, code, cards);
  const byId = Object.fromEntries(Object.entries(r.found).map(([id, w]) => [id, { gihWr: round4(w.gihWr), adjWr: w.adjWr == null ? null : round4(w.adjWr), games: w.games }]));
  return { byId, wr: { source: "card-ratings", asOf: r.asOf, games: r.deckGames }, unmatched: r.unmatched };
}

/** The old shard's win rates, for a set whose sources have not changed. */
function carriedWinRates(shard: Shard | null, entry: SetEntry | undefined): SetWinRates {
  const byId: Record<string, WinRate> = {};
  for (const c of shard?.cards || []) if (c.wrRaw != null) byId[c.id] = { gihWr: c.wrRaw, adjWr: c.wrAdj ?? null, games: c.games ?? 0 };
  return { byId, wr: entry?.wr ?? { source: null, asOf: null, games: null }, unmatched: [] };
}

const round4 = (x: number) => Math.round(x * 1e4) / 1e4;
const hasData = (w: SetWinRates) => Object.keys(w.byId).length > 0;

async function winRatesFor(http: Http, set: UniverseSet, cards: Card[], archive: Archive, old: { shard: Shard | null; entry: SetEntry | undefined }, o: PublishOptions, today: string): Promise<SetWinRates> {
  const carried = carriedWinRates(old.shard, old.entry);
  const current = old.entry?.wr.source === "game-data" && archive.lastModified != null && old.entry.wr.asOf != null && archive.lastModified <= old.entry.wr.asOf;
  if (archive.exists && (o.all || !current || !hasData(carried))) return gameDataWinRates(http, set.code, cards, archive, o);
  if (archive.exists) return carried;
  if (daysBetween(set.released, today) <= RECENT_DAYS) {
    const fresh = await cardRatingsWinRates(http, set.code, cards);
    return hasData(fresh) || !hasData(carried) ? fresh : carried;
  }
  return carried;
}

// ---- one shard --------------------------------------------------------------------------------

async function buildShard(http: Http, set: UniverseSet, archive: Archive, old: { shard: Shard | null; entry: SetEntry | undefined }, o: PublishOptions, today: string) {
  const prints = (await searchAll(http, `set:${set.code}`)).filter((p) => p.set === set.code && isPoolPrinting(p));
  const groups = groupByOracle(prints);
  const base = [...groups.values()].map((p) => cardFromPrintings(p, pickPrinting(p)));
  const { cards: detailed, missing } = await addDetails(http, base, new Map([...groups].map(([id, p]) => [id, p.map((x) => x.id)])));
  const w = await winRatesFor(http, set, detailed, archive, old, o, today);
  const oldPrintSets = new Map((old.shard?.cards || []).map((c) => [c.id, c.printSets]));
  const cards = detailed
    .map((c): Card => {
      const r = w.byId[c.id];
      return { ...c, printSets: oldPrintSets.get(c.id) ?? c.printSets, wrSet: r ? set.code : null, wrRaw: r?.gihWr ?? null, wrAdj: r?.adjWr ?? null, games: r?.games ?? null };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const shard: Shard = { set: set.code, builtAt: today, cards };
  const entry: SetEntry = { code: set.code, name: set.name, released: set.released, cards: cards.length, builtAt: today, wr: w.wr };
  const withWr = cards.filter((c) => c.wrRaw != null).length;
  o.log?.(`    ${cards.length} cards, ${missing.length} unknown to CubeCobra, win rates: ${w.wr.source ?? "none"}` +
    (w.wr.source ? ` as of ${w.wr.asOf}, ${withWr} cards ≥ ${MIN_GAMES} games` : "") +
    (w.unmatched.length ? `, ${w.unmatched.length} 17Lands names not in the set (${w.unmatched.slice(0, 5).join(", ")}${w.unmatched.length > 5 ? ", …" : ""})` : ""));
  return { shard, entry };
}

// ---- printSets across shards and the index ----------------------------------------------------

/**
 * printSets = every set of the universe the card is printed in, from all shards. Two passes over the files so
 * memory stays at one shard. Rewrites the shards that change (builtAt kept). Returns the readable shards.
 */
async function recomputePrintSets(out: string, codes: string[]): Promise<{ readable: string[]; changed: number }> {
  const sets = new Map<string, string[]>();
  const readable: string[] = [];
  for (const code of codes) {
    const s = await readShard(out, code);
    if (!s) continue;
    readable.push(code);
    for (const c of s.cards) (sets.get(c.id) ?? sets.set(c.id, []).get(c.id)!).push(code);
  }
  let changed = 0;
  for (const code of readable) {
    const s = (await readShard(out, code))!;
    let dirty = false;
    for (const c of s.cards) {
      const next = [...new Set(sets.get(c.id))].sort();
      if (next.join() !== c.printSets.join()) { c.printSets = next; dirty = true; }
    }
    if (dirty) { changed++; await writeAtomic(shardPath(out, code), JSON.stringify(s) + "\n"); }
  }
  return { readable, changed };
}

interface Planned { set: UniverseSet; reason: string; priority: number; archive: Archive }

/**
 * Which candidates are in the universe, and which of those need a rebuild, in priority order. A candidate that
 * cannot be checked is a failure; it stays in the universe when it was in before.
 */
async function plan(http: Http, sets: UniverseSet[], entries: Map<string, SetEntry>, o: PublishOptions, today: string, result: PublishResult) {
  const members: UniverseSet[] = [];
  const todo: Planned[] = [];
  for (const set of sets) {
    const entry = entries.get(set.code);
    try {
      const archive = await http.head(archiveUrl(set.code));
      const live = !archive.exists && daysBetween(set.released, today) <= RECENT_DAYS && await hasLiveRatings(http, set.code);
      if (!archive.exists && !live && !entry?.wr.source) continue;
      members.push(set);
      if (o.only && !o.only.includes(set.code)) { result.kept++; continue; }
      const r = rebuildReason(set, entry, existsSync(shardPath(o.outDir, set.code)), archive, today, o.all);
      if (r) todo.push({ set, archive, ...r });
      else result.kept++;
    } catch (e) {
      if (entry) members.push(set);
      result.failed.push({ code: set.code, reason: "checking 17Lands", error: e instanceof Error ? e.message : String(e) });
    }
  }
  const age = (p: Planned) => entries.get(p.set.code)?.builtAt ?? "";
  todo.sort((a, b) => a.priority - b.priority
    || (a.priority === 3 ? age(a).localeCompare(age(b)) : b.set.released.localeCompare(a.set.released))
    || a.set.code.localeCompare(b.set.code));
  return { members, todo };
}

/** Removes shard files of sets that are not in the index (left the universe), so they are not published. */
async function removeStrayShards(out: string, keep: Set<string>): Promise<string[]> {
  let files: string[] = [];
  try { files = await readdir(join(out, "sets")); } catch { return []; }
  const stray = files.filter((f) => f.endsWith(".json") && !keep.has(f.slice(0, -5)));
  for (const f of stray) await rm(join(out, "sets", f));
  return stray.map((f) => f.slice(0, -5));
}

export async function publish(o: PublishOptions): Promise<PublishResult> {
  const started = Date.now();
  const log = o.log ?? (() => {});
  const today = o.today ?? utcToday();
  const budgetMs = (o.budgetMinutes ?? DEFAULT_BUDGET_MINUTES) * 60_000;
  const http = createHttp({ cacheDir: o.cacheDir, refresh: o.refresh, maxAgeDays: CACHE_MAX_AGE_DAYS, fetchImpl: o.fetchImpl, log });
  const oldIndex = await readJson<DataIndex>(join(o.outDir, "index.json"));
  const entries = new Map((oldIndex?.sets || []).map((e) => [e.code, e]));
  const sets = await candidates(http, today);
  const result: PublishResult = { built: [], failed: [], kept: 0, deferred: [], universe: [], printSetsChanged: 0, removed: [] };
  const { members, todo } = await plan(http, sets, entries, o, today, result);
  result.universe = members;
  log(`Universe: ${members.length} released sets with 17Lands Premier Draft data (of ${sets.length} candidates since ${CANDIDATES_SINCE}): ` +
    members.map((s) => s.code).join(" "));
  log(`${todo.length} set(s) to rebuild, ${result.kept} current`);
  for (const [i, { set, reason, archive }] of todo.entries()) {
    if (Date.now() - started > budgetMs) {
      result.deferred = todo.slice(i).map((p) => p.set.code);
      log(`Time budget spent: ${result.deferred.length} set(s) left for the next run`);
      break;
    }
    const old = { shard: await readShard(o.outDir, set.code), entry: entries.get(set.code) };
    log(`${set.code} (${set.name}, ${set.released}, ${set.setType}): ${reason}`);
    try {
      const t0 = Date.now();
      const { shard, entry } = await buildShard(http, set, archive, old, o, today);
      await writeAtomic(shardPath(o.outDir, set.code), JSON.stringify(shard) + "\n");
      entries.set(set.code, entry);
      result.built.push({ code: set.code, reason, cards: entry.cards, wr: entry.wr, seconds: Math.round((Date.now() - t0) / 1000) });
    } catch (e) {
      const error = e instanceof Error ? e.message.split("\n")[0] : String(e);
      log(`  FAILED ${set.code}: ${error}${old.shard ? " (old shard kept)" : ""}`);
      result.failed.push({ code: set.code, reason, error });
    }
  }

  const listed = members.map((s) => s.code).filter((c) => entries.has(c));
  const { readable, changed } = await recomputePrintSets(o.outDir, listed);
  result.printSetsChanged = changed;
  result.removed = await removeStrayShards(o.outDir, new Set(readable));
  if (result.removed.length) log(`Removed shards of sets outside the universe: ${result.removed.join(", ")}`);
  const index: DataIndex = { version: 1, builtAt: today, sets: readable.map((c) => entries.get(c)!).sort((a, b) => b.released.localeCompare(a.released) || a.code.localeCompare(b.code)) };
  await writeAtomic(join(o.outDir, "index.json"), JSON.stringify(index) + "\n");
  return result;
}

export function publishSummary(r: PublishResult): string {
  const lines = [`${r.universe.length} sets in the universe. ${r.built.length} set(s) rebuilt, ${r.kept} current, ${r.deferred.length} left for the next run, ${r.failed.length} failed; ` +
    `printSets changed in ${r.printSetsChanged} shard(s)`];
  for (const b of r.built) lines.push(`  ${b.code}: ${b.cards} cards, ${b.wr.source ?? "no win rates"}${b.wr.asOf ? " " + b.wr.asOf : ""} (${b.reason}, ${b.seconds}s)`);
  for (const f of r.failed) lines.push(`  FAILED ${f.code} (${f.reason}): ${f.error}`);
  return lines.join("\n");
}
