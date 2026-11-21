/**
 * CubeCobra: reading a public cube, and saving rules inside it.
 *
 * CubeCobra has no write API, so rules travel inside the cube's own text: either a hidden markdown line
 *   [cubewarden-v1]: cw:<base64url of deflate-raw(JSON config)>
 * (a CommonMark link reference definition: CubeCobra's markdown renderer never displays it), or a visible block
 *   ```cubewarden v1
 *   <data>
 *   ```
 * The public cube JSON (cubecobra.com/cube/api/cubeJSON/<id>) returns the primer tabs, so importing restores the rules.
 */
import type { Card, Config } from "./model.ts";
import { colorSet } from "./colors.ts";
import { slug } from "./slug.ts";

const BLOCK_RE = /```cubewarden v1\s+([A-Za-z0-9_-]+)\s*```|^\[cubewarden-v1\]:\s*cw:([A-Za-z0-9_-]+)\s*$/m;

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  return new Uint8Array(await new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream)).arrayBuffer());
}
function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64url(t: string): Uint8Array {
  const s = atob(t.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

/** Config → markdown to paste into CubeCobra: a visible fenced block, or with { hidden: true } one invisible line. */
export async function encodeRules(config: Config, opts: { hidden?: boolean } = {}): Promise<string> {
  const z = b64url(await pipe(new TextEncoder().encode(JSON.stringify(config)), new CompressionStream("deflate-raw")));
  return opts.hidden ? `[cubewarden-v1]: cw:${z}` : "```cubewarden v1\n" + z + "\n```";
}

/** Finds saved rules in any text (About, primer tab) and returns the config, or null when there are none. */
export async function decodeRules(text: string): Promise<Config | null> {
  const m = BLOCK_RE.exec(text || "");
  if (!m) return null;
  try {
    const raw = await pipe(unb64url(m[1] || m[2]), new DecompressionStream("deflate-raw"));
    return JSON.parse(new TextDecoder().decode(raw));
  } catch {
    throw new Error("The cubewarden rules in this text are damaged: they were probably changed while pasting.");
  }
}

/** CubeCobra's parsed_cost (reversed symbols, "split" between faces) → "{1}{W}{U}". */
function costFromParsed(parsed: string[] | null | undefined): string {
  const faces: string[][] = [[]];
  for (const x of [...(parsed || [])].reverse()) {
    if (x === "split") faces.push([]);
    else faces[faces.length - 1].push("{" + x.toUpperCase().replace("-", "/") + "}");
  }
  return faces.map((f) => f.join("")).filter(Boolean).join(" // ");
}

/** True when every coloured symbol of the front face is hybrid ({W/U}), so either colour can cast it. */
export function isHybridCost(cost: string): boolean {
  const syms = ((cost || "").split(" // ")[0].match(/\{[^}]+\}/g) || []).map((x) => x.slice(1, -1).toLowerCase());
  const coloured = syms.filter((x) => /[wubrg]/.test(x));
  return coloured.length > 0 && coloured.every((x) => x.includes("/") && "wubrg".includes(x.split("/")[1]));
}

interface CubeCobraDetails {
  oracle_id: string; scryfall_id?: string; name: string; colors?: string[]; color_identity?: string[]; parsed_cost?: string[];
  type?: string; cmc?: number | string; power?: string | null; toughness?: string | null; oracle_text?: string; keywords?: string[];
  oracle_tags?: string[]; set?: string; collector_number?: string; rarity?: string; image_normal?: string;
  elo?: number; cubeCount?: number; pickCount?: number;
}
interface CubeCobraItem { details?: CubeCobraDetails; tags?: string[] }
export interface CubeCobraJson {
  id?: string; shortId?: string; name?: string; description?: string;
  primerTabs?: { title?: string; content?: string }[];
  cards?: { mainboard?: CubeCobraItem[]; maybeboard?: CubeCobraItem[] };
}

/** A CubeCobra card → our card. */
export function cardFromCubeCobra(d: CubeCobraDetails): Card {
  const manaCost = costFromParsed(d.parsed_cost);
  return {
    id: d.oracle_id, name: d.name, colors: colorSet((d.colors || []).join("")), identity: colorSet((d.color_identity || []).join("")),
    manaCost, hybrid: isHybridCost(manaCost), type: d.type || "", mv: Number(d.cmc) || 0, power: d.power ?? null, toughness: d.toughness ?? null,
    text: d.oracle_text || "", keywords: (d.keywords || []).map((x) => x.toLowerCase()), tags: (d.oracle_tags || []).map(slug),
    set: d.set ?? null, number: d.collector_number ?? null, rarity: d.rarity ?? null, printSets: d.set ? [d.set] : [],
    image: d.image_normal || null, scryfallId: d.scryfall_id ?? null,
    wrDelta: null, wrRaw: null, games: null, ccElo: d.elo ?? null, ccCubes: d.cubeCount ?? null, ccPicks: d.pickCount ?? null,
  };
}

export interface CubeCobraCube {
  id: string | null;
  name: string;
  mainboard: string[];
  maybeboard: string[];
  /** Every card of both boards; cards found in `known` are reused, with the cube's own tags added. */
  cards: Record<string, Card>;
  /** Cards listed more than once in the mainboard, counted once. */
  duplicates: number;
  /** The CubeCobra tags used in the cube. */
  tags: string[];
  /** Rules saved in the cube's text, or null. */
  config: Config | null;
  texts: string[];
}

/** Reads CubeCobra's public cube JSON. `known` = card data we already have (with win rates), by oracle id. */
export async function readCubeCobra(json: CubeCobraJson, known: Record<string, Card> = {}): Promise<CubeCobraCube> {
  const cards: Record<string, Card> = {};
  const tags = new Set<string>();
  const board = (items: CubeCobraItem[] = []) => items.flatMap((it) => {
    const d = it.details;
    if (!d?.oracle_id) return [];
    const ccTags = (it.tags || []).filter(Boolean);
    ccTags.forEach((t) => tags.add(t));
    const base = known[d.oracle_id] ?? cardFromCubeCobra(d);
    cards[d.oracle_id] = ccTags.length ? { ...base, ccTags } : base;
    return [d.oracle_id];
  });
  const listed = board(json.cards?.mainboard);
  const mainboard = [...new Set(listed)];
  const maybeboard = board(json.cards?.maybeboard);
  const texts = [json.description || "", ...(json.primerTabs || []).map((t) => t.content || "")].filter(Boolean);
  let config: Config | null = null;
  for (const t of texts) {
    try { config = await decodeRules(t); } catch { config = null; }
    if (config) break;
  }
  return { id: json.shortId || json.id || null, name: json.name || "", mainboard, duplicates: listed.length - mainboard.length, maybeboard, cards, tags: [...tags], config, texts };
}

/** Fetches a public cube (read only). */
export async function fetchCubeCobra(id: string, known: Record<string, Card> = {}, fetchImpl: typeof fetch = fetch): Promise<CubeCobraCube> {
  const res = await fetchImpl("https://cubecobra.com/cube/api/cubeJSON/" + encodeURIComponent(id));
  if (!res.ok) throw new Error(`CubeCobra answered ${res.status} for cube "${id}"`);
  return readCubeCobra(await res.json(), known);
}

/** Link to a CubeCobra cube list filtered with CubeCobra's own filter syntax (the "f" parameter). */
export function cubeCobraListUrl(cubeId: string, filterText?: string): string {
  return `https://cubecobra.com/cube/list/${encodeURIComponent(cubeId)}` + (filterText ? "?f=" + encodeURIComponent(filterText) : "");
}
