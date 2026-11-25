/**
 * Reference cubes: other public CubeCobra cubes the project compares itself with. How many of them play a card.
 */
import type { Card } from "./model.ts";

/** A reference cube as the page holds it: loading, failed, or loaded with its mainboard (oracle ids) and cards. */
export type ReferenceState =
  | { status: "loading" | "error"; name: string }
  | { status: "ok"; name: string; ids: string[]; cardsById: Record<string, Card> };

export interface ReferenceCounts {
  /** Loaded reference cubes (failed ones are left out). */
  of: number;
  /** How many loaded reference cubes play the card. */
  count(card: Pick<Card, "id" | "name">): number;
  /** Names of the reference cubes that play the card. */
  names(card: Pick<Card, "id" | "name">): string[];
}

const norm = (name: string) => name.trim().toLowerCase();

/** Card presence across the reference cubes, matched by oracle id, or by name for a card listed under another id.
 *  null while any reference is still loading, or when none is loaded: there is no count to show yet. */
export function referenceCounts(refs: ReferenceState[]): ReferenceCounts | null {
  if (refs.some((r) => r.status === "loading")) return null;
  const loaded = refs.flatMap((r) => (r.status === "ok" ? [r] : []));
  if (!loaded.length) return null;
  const sets = loaded.map((r) => ({
    name: r.name,
    ids: new Set(r.ids),
    names: new Set(r.ids.map((id) => r.cardsById[id]?.name).filter((n): n is string => !!n).map(norm)),
  }));
  const names = (card: Pick<Card, "id" | "name">) => sets.filter((s) => s.ids.has(card.id) || s.names.has(norm(card.name))).map((s) => s.name);
  return { of: loaded.length, names, count: (card) => names(card).length };
}
