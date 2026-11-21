import { describe, expect, it } from "vitest";
import { parseFilter, toScryfall, type Mechanic } from "../src/index.ts";

const mech = (id: string, filter: string, priority?: "primary" | "secondary"): Mechanic =>
  ({ id, name: id, priority, filter: parseFilter(filter) });
const MECHS = [mech("tricks", "t:instant"), mech("fliers", "kw:flying t:creature", "secondary"), mech("ramp", "otag:ramp", "primary")];
const q = (f: string, mechanics?: Mechanic[]) => toScryfall(parseFilter(f), { mechanics });

describe("opening a filter with member: on Scryfall", () => {
  it("replaces member:<id> with that mechanic's filter", () => {
    expect(q("member:tricks mv<=2", MECHS)).toMatchObject({ query: "((t:instant) mv<=2)", skipped: [] });
    expect(q("member:fliers", MECHS).query).toBe("(kw:flying t:creature)");
  });
  it("replaces member:any with every mechanic, and primary/secondary with those of that priority", () => {
    expect(q("member:any", MECHS).query).toBe("(t:instant or (kw:flying t:creature) or otag:ramp)");
    expect(q("member:primary", MECHS).query).toBe("(t:instant or otag:ramp)");
    expect(q("member:secondary", MECHS).query).toBe("(kw:flying t:creature)");
  });
  it("negates a member condition as -( … )", () => {
    expect(q("-member:tricks t:creature", MECHS).query).toBe("(-(t:instant) t:creature)");
    expect(q("-member:fliers", MECHS).query).toBe("-(kw:flying t:creature)");
  });
  it("still skips a member: it cannot resolve", () => {
    const none = q("member:tricks t:creature");
    expect(none.query).toBe("t:creature");
    expect(none.skipped).toHaveLength(1);
    const unknown = q("member:nope t:creature", MECHS);
    expect(unknown.query).toBe("t:creature");
    expect(unknown.skipped).toHaveLength(1);
  });
  it("does not loop on a mechanic that names itself", () => {
    const self = [mech("loop", "member:loop t:instant")];
    expect(q("member:loop", self).query).toBe("(t:instant)");
  });
});
