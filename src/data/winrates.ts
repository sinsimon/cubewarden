/**
 * 17Lands win rates: GIH WR (games where the card was in the opening hand or drawn) and an adjusted WR
 * that removes the strength of the decks the card was played in. Two sources: a precomputed file, or
 * 17Lands' public Card Ratings and Color Ratings endpoints.
 *
 * Cards carry the WR Δ (Card.wrDelta): the adjusted WR minus the set's centre, in points. The centre of a set is the
 * mean adjusted WR of its commons and uncommons, so an average common or uncommon is 0 in every set and cards from
 * different sets compare (the adjusted WR alone still carries each event's overall win rate).
 */
import { readFile } from "node:fs/promises";
import type { Card } from "../model.ts";
import { colorSet } from "../colors.ts";
import type { Http } from "./http.ts";
import { searchAll } from "./scryfall-cards.ts";

/** rarity = the card's rarity in that set, when the source gives it (17Lands Card Ratings do). */
export interface WinRate { gihWr: number; adjWr: number | null; games: number; rarity?: string | null }

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
 * The hosted data (`data publish`) takes Premier Draft only; the sets listed here are its documented exceptions
 * (today: spm alone).
 */
export const EVENTS: Record<string, { event: string; format: string; printedNamesFrom?: string }> = {
  spm: { event: "OM1", format: "PickTwoDraft", printedNamesFrom: "om1" },
};
/** The 17Lands event and format of a Scryfall set code. */
export const eventOf = (set: string) => EVENTS[set] ?? { event: set.toUpperCase(), format: "PremierDraft" };

/** True when 17Lands' Card Ratings report games for the set's event (Premier Draft, or its EVENTS exception): it is being drafted now. */
export async function hasLiveRatings(http: Http, set: string): Promise<boolean> {
  const { event, format } = eventOf(set);
  const rows = await http.json<RatingRow[]>(`https://www.17lands.com/card_ratings/data?expansion=${event}&format=${format}`);
  return Array.isArray(rows) && rows.some((r) => (r.ever_drawn_game_count ?? 0) > 0);
}

// ---- precomputed file -------------------------------------------------------------------------

interface WinRateFile {
  source?: string;
  sets?: Record<string, { released?: string; asOf?: string }>;
  cards?: Record<string, Record<string, { gihWr?: number; adjWr?: number; games?: number; rarity?: string }>>;
}

/** Reads { sets: { <set>: { released } }, cards: { <oracle id>: { <set>: { gihWr, adjWr, games, rarity? } } } }. */
export async function readWinRateFile(path: string): Promise<WinRateTable> {
  const f: WinRateFile = JSON.parse(await readFile(path, "utf8"));
  const cards: WinRateTable["cards"] = {};
  for (const [id, bySet] of Object.entries(f.cards || {})) {
    for (const [set, w] of Object.entries(bySet)) {
      if (typeof w.gihWr !== "number") continue;
      (cards[id] ||= {})[set] = { gihWr: w.gihWr, adjWr: w.adjWr ?? null, games: w.games ?? 0, ...(w.rarity ? { rarity: w.rarity } : {}) };
    }
  }
  const sets = Object.fromEntries(Object.entries(f.sets || {}).map(([k, s]) => [k, { released: s.released ?? null, asOf: s.asOf ?? null }]));
  return { source: f.source || path, sets, cards };
}

// ---- 17Lands endpoints ------------------------------------------------------------------------

interface RatingRow { name: string; color?: string; rarity?: string; ever_drawn_win_rate?: number | null; ever_drawn_game_count?: number | null }
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
export async function printedNames(http: Http, set: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const c of await searchAll(http, `set:${set}`)) {
    for (const f of [c, ...(c.card_faces || [])]) {
      if (f.printed_name && f.name && !out.has(f.printed_name.toLowerCase())) out.set(f.printed_name.toLowerCase(), f.name);
    }
  }
  return out;
}

/** Lower case, and the "?" spelling 17Lands archives use for non-ASCII letters ("Bespoke B?"). */
const nameKeys = (name: string) => {
  const keys = [name, name.split(" // ")[0]].map((n) => n.toLowerCase());
  return [...new Set([...keys, ...keys.map((k) => k.replace(/[^\x00-\x7f]/g, "?"))])];
};

/**
 * A 17Lands name → the oracle id of the card printed in `set` with that name (full name or front face),
 * after renaming Arena names with `rename` (Arena name → paper name, lower case keys).
 */
export function nameMatcher(cards: Card[], set: string, rename: Map<string, string> = new Map()): (name: string) => string | undefined {
  const index = new Map<string, string>();
  for (const c of cards) {
    if (!c.printSets.includes(set)) continue;
    for (const k of nameKeys(c.name)) if (!index.has(k)) index.set(k, c.id);
  }
  return (name) => {
    const paper = rename.get(name.toLowerCase()) ?? name;
    for (const k of nameKeys(paper)) if (index.has(k)) return index.get(k);
    return undefined;
  };
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * One set from 17Lands' Card Ratings (GIH WR) and Color Ratings (deck baselines for the adjusted WR, see
 * adjustedFromPairs). Card Ratings only carries games while the set is being drafted.
 */
export async function cardRatingsForSet(http: Http, set: string, cards: Card[]) {
  const { event, format, printedNamesFrom } = eventOf(set);
  const ratingsUrl = `https://www.17lands.com/card_ratings/data?expansion=${event}&format=${format}`;
  const colorBase = `https://www.17lands.com/color_ratings/data?expansion=${event}&event_type=${format}&start_date=2020-01-01`;
  const ratings = await http.text(ratingsUrl);
  // The end date changes every day: the cache key leaves it out, so a rebuild stays offline.
  const colorRows = await http.json<ColorRow[]>(`${colorBase}&end_date=${today()}&combine_splash=true`, { cacheKey: `${colorBase}&combine_splash=true` });
  const rows: RatingRow[] = JSON.parse(ratings.text);
  const { overall, decks } = deckBaselines(colorRows);
  const all = colorRows.find((r) => r.is_summary && r.short_name === "All");
  const rename = printedNamesFrom ? await printedNames(http, printedNamesFrom) : new Map<string, string>();
  const match = nameMatcher(cards, set, rename);
  const found: Record<string, WinRate> = {};
  const unmatched: string[] = [];
  for (const r of rows) {
    const games = r.ever_drawn_game_count ?? 0;
    if (r.ever_drawn_win_rate == null || games < MIN_GAMES) continue;
    const id = match(r.name);
    if (!id) { unmatched.push(r.name); continue; }
    const adjWr = overall == null ? null : adjustedFromPairs(r.ever_drawn_win_rate, r.color ?? "", decks, overall);
    found[id] = { gihWr: r.ever_drawn_win_rate, adjWr, games, ...(r.rarity ? { rarity: r.rarity } : {}) };
  }
  const games = rows.reduce((n, r) => n + (r.ever_drawn_game_count ?? 0), 0);
  return { found, unmatched, asOf: ratings.fetchedAt.slice(0, 10), rows: rows.length, games, deckGames: all?.games ?? null };
}

/** Win rates for every set from 17Lands' public endpoints, matched by name to the cards printed in that set. */
export async function fetch17Lands(http: Http, sets: string[], cards: Card[], released: Record<string, string>, log?: (s: string) => void): Promise<WinRateTable> {
  const table: WinRateTable = { source: "17Lands Card Ratings and Color Ratings", sets: {}, cards: {}, unmatched: {} };
  for (const set of sets) {
    const r = await cardRatingsForSet(http, set, cards);
    for (const [id, w] of Object.entries(r.found)) (table.cards[id] ||= {})[set] = w;
    table.sets[set] = { released: released[set] ?? null, asOf: r.asOf };
    if (r.unmatched.length) table.unmatched![set] = r.unmatched;
    log?.(`  17Lands ${eventOf(set).event}: ${r.rows} rows, ${Object.keys(r.found).length} cards with ≥ ${MIN_GAMES} games` +
      (r.unmatched.length ? `, ${r.unmatched.length} not matched` : "") +
      (r.rows && !r.games ? " (17Lands returned the card list with no games)" : ""));
  }
  return table;
}

// ---- WR Δ ---------------------------------------------------------------------------------------

/** The rarities a set's centre is the mean of. */
export const CENTRE_RARITIES = ["common", "uncommon"];
const round = (x: number, digits: number) => Math.round(x * 10 ** digits) / 10 ** digits;

/** A set's centre: the mean adjusted WR of its commons and uncommons (a fraction, 4 decimals), or null with none. */
export function centreOf(cards: { rarity?: string | null; adjWr: number | null }[]): number | null {
  const adj = cards.filter((c) => c.adjWr != null && CENTRE_RARITIES.includes(c.rarity ?? "")).map((c) => c.adjWr!);
  return adj.length ? round(adj.reduce((s, x) => s + x, 0) / adj.length, 4) : null;
}

/** WR Δ in points (2 decimals) from an adjusted WR and its set's centre. */
export const deltaOf = (adjWr: number | null | undefined, centre: number | null | undefined): number | null =>
  adjWr == null || centre == null ? null : round((adjWr - centre) * 100, 2);

/** The adjusted WR back from a WR Δ and its centre (exact for values made by deltaOf from 4-decimal inputs). */
export const adjustedOf = (delta: number | null | undefined, centre: number | null | undefined): number | null =>
  delta == null || centre == null ? null : round(centre + delta / 100, 4);

/**
 * The centre of every set of a win rate table. A card's rarity in a set comes from the table when the source gives
 * it, else from the card when the card is shown in that set; cards with no known rarity there are left out.
 */
export function setCentres(table: WinRateTable, cards: Card[]): Record<string, number | null> {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const rows: Record<string, { rarity: string | null; adjWr: number | null }[]> = Object.fromEntries(Object.keys(table.sets).map((s) => [s, []]));
  for (const [id, bySet] of Object.entries(table.cards)) {
    for (const [set, w] of Object.entries(bySet)) {
      const card = byId.get(id);
      (rows[set] ||= []).push({ rarity: w.rarity ?? (card?.set === set ? card.rarity : null), adjWr: w.adjWr });
    }
  }
  return Object.fromEntries(Object.entries(rows).map(([s, r]) => [s, centreOf(r)]));
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

/** The card with its win rates from one set of the table; its WR Δ is centred on that set (centres: see setCentres). */
export function withWinRate(card: Card, table: WinRateTable, allowed: string[], centres: Record<string, number | null>): Card {
  const set = pickWinRateSet(card, table, allowed);
  const w = set ? table.cards[card.id][set] : null;
  return { ...card, wrSet: set, wrRaw: w?.gihWr ?? null, wrDelta: set ? deltaOf(w?.adjWr, centres[set]) : null, games: w?.games ?? null };
}
