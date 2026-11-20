/** "Removal (Creature)" → "removal-creature", the shape of Scryfall oracle tags. */
export function slug(s: string): string {
  return String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
