/**
 * The hosted page (e.g. on Vercel): no project folder, so the card data is assembled in the browser from
 *   - the published per-set card files (`<base>/index.json`, `<base>/sets/<set>.json`, built by the data Action),
 *   - the person's cube, read from CubeCobra's public cube JSON (its cards carry tags and CubeCobra stats),
 *   - Scryfall's collection API for any card still missing (e.g. a pasted list).
 * The person's work stays in the browser (localStorage); this module only decides which cards to load.
 */
import type { Card, Config } from "./model.ts";
import { fetchCubeCobra } from "./cubecobra.ts";
import { cardFromPrintings, type ScryfallCard } from "./data/scryfall-cards.ts";
import { SOURCES } from "./sources.ts";

export interface SetInfo { code: string; name: string; released: string; cards: number; wr?: { source: string | null; asOf: string | null } }
export interface DataIndex { version: 1; builtAt: string; sets: SetInfo[] }
interface Shard { set: string; cards: Card[] }
interface SavedState { config?: Config; current?: string[]; original?: string[]; source?: { id?: string } | null }

const COLORS = ["W", "U", "B", "R", "G", "C", "L"] as const;
export const EMPTY_CONFIG: Config = { version: 1, cube: { name: "My cube" }, colors: COLORS.map((code) => ({ code, mechanics: [] })), archetypes: [], rules: [] };

/**
 * One card per oracle id from several set files. Win rates: the set the cube shows the card in when that set is
 * loaded, else the most recently released loaded set that has them. printSets: union.
 */
export function mergeCards(shards: Shard[], index: DataIndex, cubeCards: Record<string, Card> = {}): Card[] {
  const released = Object.fromEntries(index.sets.map((s) => [s.code, s.released]));
  const ordered = [...shards].sort((a, b) => (released[b.set] || "").localeCompare(released[a.set] || ""));
  const out = new Map<string, Card>();
  const wrBySet = new Map<string, Map<string, Card>>();
  for (const sh of ordered) {
    for (const c of sh.cards) {
      if (c.wrAdj != null || c.wrRaw != null) {
        if (!wrBySet.has(c.id)) wrBySet.set(c.id, new Map());
        wrBySet.get(c.id)!.set(sh.set, c);
      }
      const seen = out.get(c.id);
      if (!seen) { out.set(c.id, { ...c }); continue; }
      seen.printSets = [...new Set([...seen.printSets, ...c.printSets])].sort();
      if (seen.wrAdj == null && seen.wrRaw == null && (c.wrAdj != null || c.wrRaw != null)) {
        Object.assign(seen, { wrAdj: c.wrAdj, wrRaw: c.wrRaw, games: c.games, wrSet: c.wrSet });
      }
    }
  }
  for (const [id, cc] of Object.entries(cubeCards)) {
    const base = out.get(id);
    if (!base) { out.set(id, cc); continue; }
    const own = cc.set ? wrBySet.get(id)?.get(cc.set) : undefined;
    out.set(id, {
      ...base,
      set: cc.set ?? base.set, number: cc.number ?? base.number, rarity: cc.rarity ?? base.rarity,
      image: cc.image ?? base.image, scryfallId: cc.scryfallId ?? base.scryfallId,
      printSets: [...new Set([...base.printSets, ...(cc.set ? [cc.set] : [])])].sort(),
      ...(cc.ccTags?.length ? { ccTags: cc.ccTags } : {}),
      ...(own ? { wrAdj: own.wrAdj, wrRaw: own.wrRaw, games: own.games, wrSet: own.wrSet } : {}),
    });
  }
  return [...out.values()];
}

async function json<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json() as Promise<T>;
}

/** Scryfall collection lookup (75 identifiers per call): cards by oracle id or by name. */
async function scryfallCollection(identifiers: ({ oracle_id: string } | { name: string })[]): Promise<{ found: ScryfallCard[]; missing: unknown[] }> {
  const found: ScryfallCard[] = [], missing: unknown[] = [];
  for (let i = 0; i < identifiers.length; i += 75) {
    const r = await fetch("https://api.scryfall.com/cards/collection", {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ identifiers: identifiers.slice(i, i + 75) }),
    });
    if (!r.ok) throw new Error(`Scryfall answered ${r.status}`);
    const d = await r.json() as { data: ScryfallCard[]; not_found?: unknown[] };
    found.push(...d.data);
    missing.push(...(d.not_found || []));
    if (i + 75 < identifiers.length) await new Promise((ok) => setTimeout(ok, 120));
  }
  return { found, missing };
}

/** A pasted list → oracle ids, through Scryfall (any card in Magic). */
export async function resolveNames(names: string[]): Promise<{ ids: string[]; missing: string[]; cards: Card[] }> {
  const uniq = [...new Set(names)];
  const { found, missing } = await scryfallCollection(uniq.map((name) => ({ name })));
  const cards = found.filter((c) => c.oracle_id).map((c) => cardFromPrintings([c]));
  return { ids: [...new Set(cards.map((c) => c.id))], cards, missing: missing.map((m) => (m as { name?: string }).name || String(m)) };
}

export interface HostedInfo { base: string; index: DataIndex; loadedSets: string[]; cubeId: string | null; errors: string[] }

/** Builds window.CUBE_DATA for the hosted page from the saved state (if any). */
export async function loadHosted(opts: { storageKey: string; base: string }) {
  let state: SavedState | null = null;
  try { state = JSON.parse(localStorage.getItem(opts.storageKey) || "null"); } catch { state = null; }
  const errors: string[] = [];
  const index = await json<DataIndex>(`${opts.base}/index.json`);
  const cubeId = state?.config?.cube && (state.config.cube as { cubeCobraId?: string }).cubeCobraId || state?.source?.id || null;
  let cubeCards: Record<string, Card> = {};
  if (cubeId) {
    try { cubeCards = (await fetchCubeCobra(cubeId)).cards; } catch (e) { errors.push(`CubeCobra cube ${cubeId}: ${(e as Error).message}`); }
  }
  // Every published set: about 2 MB compressed. The cube's own "every card" rules still narrow the searches.
  const sets = index.sets.map((x) => x.code);
  const shards = (await Promise.all(sets.map((s) => json<Shard>(`${opts.base}/sets/${s}.json`).catch((e) => { errors.push(`set ${s}: ${e.message}`); return null; }))))
    .filter((x): x is Shard => !!x);
  let cards = mergeCards(shards, index, cubeCards);
  const have = new Set(cards.map((c) => c.id));
  const missing = [...new Set([...(state?.current || []), ...(state?.original || [])])].filter((id) => !have.has(id));
  if (missing.length) {
    try { cards = cards.concat((await scryfallCollection(missing.map((oracle_id) => ({ oracle_id })))).found.filter((c) => c.oracle_id).map((c) => cardFromPrintings([c]))); }
    catch (e) { errors.push(`Scryfall: ${(e as Error).message}`); }
  }
  const hosted: HostedInfo = { base: opts.base, index, loadedSets: shards.map((s) => s.set), cubeId, errors };
  (globalThis as { CUBE_DATA?: unknown }).CUBE_DATA = {
    builtAt: index.builtAt, cards, sources: SOURCES, seed: structuredClone(EMPTY_CONFIG), hosted,
    cube: { name: "My cube", source: cubeId ? `CubeCobra cube ${cubeId}` : "this browser", original: [], current: [] },
  };
  return hosted;
}
