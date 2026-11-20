export const WUBRG = "WUBRG";

/** Any colour string ("uw", "W/U", "GWU") → canonical WUBRG order, upper case. */
export function colorSet(s: string | null | undefined): string {
  const up = String(s || "").toUpperCase();
  return WUBRG.split("").filter((c) => up.includes(c)).join("");
}
