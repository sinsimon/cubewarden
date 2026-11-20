/**
 * 17Lands win rates: GIH WR (games where the card was in the opening hand or drawn) and an adjusted WR
 * that removes the strength of the decks the card was played in. Two sources: a precomputed file, or
 * 17Lands' public Card Ratings and Color Ratings endpoints.
 */
import { readFile } from "node:fs/promises";
import type { Card } from "../model.ts";
import { colorSet } from "../colors.ts";
import type { Http } from "./http.ts";
import { searchAll } from "./scryfall-cards.ts";

export interface WinRate { gihWr: number; adjWr: number | null; games: number }

/** Win rates by oracle id and set, with each set's release date and data date. */
export interface WinRateTable {
  source: string;
  sets: Record<string, { released: string | null; asOf: string | null }>;
  cards: Record<string, Record<string, WinRate>>;
  /** 17Lands names no pool card matched, by set. */
  unmatched?: Record<string, string[]>;
}

/** 17Lands' floor: below this many games the GIH WR is noise. */
export const MIN_GAMES = 500;

/**
 * Sets drafted on Arena under another event. Marvel's Spider-Man was drafted as Through the Omenpaths (OM1)
 * in Pick Two Draft, with Arena names: Scryfall's printed_name in set om1 maps them back to the paper cards.
 */
export const EVENTS: Record<string, { event: string; format: string; printedNamesFrom?: string }> = {
  spm: { event: "OM1", format: "PickTwoDraft", printedNamesFrom: "om1" },
};
const eventOf = (set: string) => EVENTS[set] ?? { event: set.toUpperCase(), format: "PremierDraft" };

// ---- precomputed file -------------------------------------------------------------------------

interface WinRateFile {
  source?: string;
  sets?: Record<string, { released?: string; asOf?: string }>;
  cards?: Record<string, Record<string, { gihWr?: number; adjWr?: number; games?: number }>>;
}

/** Reads { sets: { <set>: { released } }, cards: { <oracle id>: { <set>: { gihWr, adjWr, games } } } }. */
export async function readWinRateFile(path: string): Promise<WinRateTable> {
  const f: WinRateFile = JSON.parse(await readFile(path, "utf8"));
  const cards: WinRateTable["cards"] = {};
  for (const [id, bySet] of Object.entries(f.cards || {})) {
    for (const [set, w] of Object.entries(bySet)) {
      if (typeof w.gihWr !== "number") continue;
      (cards[id] ||= {})[set] = { gihWr: w.gihWr, adjWr: w.adjWr ?? null, games: w.games ?? 0 };
    }
  }
  const sets = Object.fromEntries(Object.entries(f.sets || {}).map(([k, s]) => [k, { released: s.released ?? null, asOf: s.asOf ?? null }]));
  return { source: f.source || path, sets, cards };
}

// ---- 17Lands endpoints ------------------------------------------------------------------------

interface RatingRow { name: string; color?: string; ever_drawn_win_rate?: number | null; ever_drawn_game_count?: number | null }
interface ColorRow { is_summary: boolean; short_name: string | number; wins: number; games: number }
type Tally = { games: number; wins: number };

/** The set's overall win rate (the "All" summary row) and (games, wins) per deck colours. */
export function deckBaselines(rows: ColorRow[]): { overall: number | null; decks: Record<string, Tally> } {
  const all = rows.find((r) => r.is_summary && r.short_name === "All");
  const decks: Record<string, Tally> = {};
  for (const r of rows) if (!r.is_summary && r.games) decks[colorSet(String(r.short_name))] = { games: r.games, wins: r.wins };
  return { overall: all && all.games ? all.wins / all.games : null, decks };
}

/**
 * Adjusted WR without per-game data: GIH WR - (baseline - overall), where the baseline is the win rate of
 * the card's own colours (a pair or three colours) or, for a mono card, the games-weighted win rate of the
 * two-colour decks with that colour. Null for colourless cards and colours with no deck data.
 * Port of adjusted_from_pairs in cube-maker's build-card-winrates.py.
 */
export function adjustedFromPairs(gihWr: number, cardColors: string, decks: Record<string, Tally>, overall: number): number | null {
  const colors = colorSet(cardColors);
  let baseline: number;
  if (colors.length === 1) {
    const pairs = Object.entries(decks).filter(([d]) => d.length === 2 && d.includes(colors)).map(([, t]) => t);
    const games = pairs.reduce((n, t) => n + t.games, 0);
    if (!games) return null;
    baseline = pairs.reduce((n, t) => n + t.wins, 0) / games;
  } else if (decks[colors]?.games) {
    baseline = decks[colors].wins / decks[colors].games;
  } else return null;
  return gihWr - (baseline - overall);
}

/** Arena name → paper name, from Scryfall's printed_name in a reskinned set. */
async function printedNames(http: Http, set: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const c of await searchAll(http, `set:${set}`)) {
    for (const f of [c, ...(c.card_faces || [])]) {
      if (f.printed_name && f.name && !out.has(f.printed_name.toLowerCase())) out.set(f.printed_name.toLowerCase(), f.name);
    }
  }
  return out;
}

/** Card name (full and front face, lower case) → oracle id, for the cards printed in a set. */
function nameIndex(cards: Card[], set: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const c of cards) {
    if (!c.printSets.includes(set)) continue;
    for (const n of [c.name, c.name.split(" // ")[0]]) if (!out.has(n.toLowerCase())) out.set(n.toLowerCase(), c.id);
  }
  return out;
}

const today = () => new Date().toISOString().slice(0, 10);

async function setFrom17Lands(http: Http, set: string, cards: Card[]) {
  const { event, format, printedNamesFrom } = eventOf(set);
  const ratingsUrl = `https://www.17lands.com/card_ratings/data?expansion=${event}&format=${format}`;
  const colorBase = `https://www.17lands.com/color_ratings/data?expansion=${event}&event_type=${format}&start_date=2020-01-01`;
  const ratings = await http.text(ratingsUrl);
  // The end date changes every day: the cache key leaves it out, so a rebuild stays offline.
  const colorRows = await http.json<ColorRow[]>(`${colorBase}&end_date=${today()}&combine_splash=true`, { cacheKey: `${colorBase}&combine_splash=true` });
  const rows: RatingRow[] = JSON.parse(ratings.text);
  const { overall, decks } = deckBaselines(colorRows);
  const rename = printedNamesFrom ? await printedNames(http, printedNamesFrom) : new Map<string, string>();
  const index = nameIndex(cards, set);
  const found: Record<string, WinRate> = {};
  const unmatched: string[] = [];
  for (const r of rows) {
    const games = r.ever_drawn_game_count ?? 0;
    if (r.ever_drawn_win_rate == null || games < MIN_GAMES) continue;
    const name = (rename.get(r.name.toLowerCase()) ?? r.name).toLowerCase();
    const id = index.get(name) ?? index.get(name.split(" // ")[0]);
    if (!id) { unmatched.push(r.name); continue; }
    const adjWr = overall == null ? null : adjustedFromPairs(r.ever_drawn_win_rate, r.color ?? "", decks, overall);
    found[id] = { gihWr: r.ever_drawn_win_rate, adjWr, games };
  }
  const games = rows.reduce((n, r) => n + (r.ever_drawn_game_count ?? 0), 0);
  return { found, unmatched, asOf: ratings.fetchedAt.slice(0, 10), rows: rows.length, games };
}

/** Win rates for every set from 17Lands' public endpoints, matched by name to the cards printed in that set. */
export async function fetch17Lands(http: Http, sets: string[], cards: Card[], released: Record<string, string>, log?: (s: string) => void): Promise<WinRateTable> {
  const table: WinRateTable = { source: "17Lands Card Ratings and Color Ratings", sets: {}, cards: {}, unmatched: {} };
  for (const set of sets) {
    const r = await setFrom17Lands(http, set, cards);
    for (const [id, w] of Object.entries(r.found)) (table.cards[id] ||= {})[set] = w;
    table.sets[set] = { released: released[set] ?? null, asOf: r.asOf };
    if (r.unmatched.length) table.unmatched![set] = r.unmatched;
    log?.(`  17Lands ${eventOf(set).event}: ${r.rows} rows, ${Object.keys(r.found).length} cards with ≥ ${MIN_GAMES} games` +
      (r.unmatched.length ? `, ${r.unmatched.length} not matched` : "") +
      (r.rows && !r.games ? " (17Lands returned the card list with no games)" : ""));
  }
  return table;
}

// ---- choosing a card's win rate ---------------------------------------------------------------

/** The card's own set when it has data there, else the most recently released allowed set with data. */
export function pickWinRateSet(card: Card, table: WinRateTable, allowed: string[]): string | null {
  const bySet = table.cards[card.id];
  if (!bySet) return null;
  if (card.set && bySet[card.set]) return card.set;
  const candidates = allowed.filter((s) => bySet[s]);
  candidates.sort((a, b) => (table.sets[b]?.released ?? "").localeCompare(table.sets[a]?.released ?? ""));
  return candidates[0] ?? null;
}

export function withWinRate(card: Card, table: WinRateTable, allowed: string[]): Card {
  const set = pickWinRateSet(card, table, allowed);
  const w = set ? table.cards[card.id][set] : null;
  return { ...card, wrSet: set, wrRaw: w?.gihWr ?? null, wrAdj: w?.adjWr ?? null, games: w?.games ?? null };
}
