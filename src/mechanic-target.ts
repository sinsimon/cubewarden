/**
 * A mechanic's target. Mechanics are named filters; the target that goes with one lives in a rule of the same
 * scope that counts exactly that mechanic, count(member:<id>) >= n: the mechanic's linked rule. The page edits
 * the two as one thing; the config keeps them apart, as rules can also measure what no single mechanic is.
 *
 * Old projects can still hold a target on the mechanic itself: it is read as the mechanic's target until the
 * mechanic is saved, which moves it into the linked rule.
 */
import type { Condition, Config, Constraint, Filter, Mechanic, Rule, Scope } from "./model.ts";

/** A target as the mechanic editor holds it: the constraint (none = no target) and "fixed" (never scaled). */
export interface MechanicTarget {
  constraint: Constraint | null;
  absolute?: boolean;
}

function sameScope(a: Scope, b: Scope): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "color" && b.kind === "color") return a.color === b.color;
  if (a.kind === "archetype" && b.kind === "archetype") return a.id === b.id;
  return true;
}

function mechanicsOf(config: Config, scope: Scope): Mechanic[] {
  if (scope.kind === "color") return config.colors.find((c) => c.code === scope.color)?.mechanics || [];
  if (scope.kind === "archetype") return config.archetypes.find((a) => a.id === scope.id)?.mechanics || [];
  return [];
}

/** The one condition a filter is, when it is exactly one: a bare condition or a group holding only it. */
function single(f: Filter | Condition | null | undefined): Condition | null {
  if (!f) return null;
  if ("field" in f) return f;
  if (f.not || f.items.length !== 1) return null;
  return single(f.items[0]);
}

/** Whether a rule is a mechanic's linked rule: same scope, and a count of exactly member:<mechanic id>. */
export function isLinkedRule(rule: Rule, scope: Scope, mechanicId: string): boolean {
  if (!sameScope(rule.scope, scope) || rule.measure?.kind !== "count") return false;
  const c = single(rule.filter);
  return !!c && c.field === "member" && !c.not && c.op === "is" && c.value === mechanicId;
}

/** Every rule linked to a mechanic of the scope, in config order (none when the scope has no such mechanic). */
export function linkedRules(config: Config, scope: Scope, mechanicId: string): Rule[] {
  if (!mechanicsOf(config, scope).some((m) => m.id === mechanicId)) return [];
  return config.rules.filter((r) => isLinkedRule(r, scope, mechanicId));
}

/** The rule that holds a mechanic's target: the first linked one. Further linked rules stay plain rules. */
export function linkedRule(config: Config, scope: Scope, mechanicId: string): Rule | null {
  return linkedRules(config, scope, mechanicId)[0] ?? null;
}

/** The mechanic a rule is the target of, when the rule is the first one linked to a mechanic of its scope. */
export function mechanicOfRule(config: Config, rule: Rule): Mechanic | null {
  const c = single(rule.filter);
  if (!c || c.field !== "member" || typeof c.value !== "string") return null;
  const mech = mechanicsOf(config, rule.scope).find((m) => m.id === c.value);
  return mech && linkedRule(config, rule.scope, mech.id)?.id === rule.id ? mech : null;
}

/** A mechanic's target: its linked rule's, else a target kept on the mechanic by an older project, else none. */
export function mechanicTarget(config: Config, scope: Scope, mechanicId: string): MechanicTarget & { ruleId: string | null } {
  const rule = linkedRule(config, scope, mechanicId);
  if (rule) return { constraint: rule.constraint ?? null, absolute: rule.measure.kind === "count" && !!rule.measure.absolute, ruleId: rule.id };
  const mech = mechanicsOf(config, scope).find((m) => m.id === mechanicId);
  return { constraint: mech?.constraint ?? null, absolute: false, ruleId: null };
}

function freeRuleId(config: Config, mechanicId: string): string {
  const ids = new Set(config.rules.map((r) => r.id));
  const base = `r-${mechanicId}`;
  if (!ids.has(base)) return base;
  let n = 2;
  while (ids.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/**
 * A copy of the config with a mechanic saved in a colour or archetype, with its target. The mechanic keeps no
 * target of its own. With a target, the linked rule is updated in place (name, priority, target, fixed; its id,
 * description and position stay) or created as r-<mechanic id>; without one, the linked rule goes.
 */
export function saveMechanic(config: Config, scope: Scope, mechanic: Mechanic, target: MechanicTarget): Config {
  const out: Config = structuredClone(config);
  const list = scope.kind === "color" ? out.colors.find((c) => c.code === scope.color)?.mechanics
    : scope.kind === "archetype" ? out.archetypes.find((a) => a.id === scope.id)?.mechanics : undefined;
  if (!list) throw new Error("Mechanics belong to a colour or an archetype");
  const { constraint: _legacy, ...plain } = structuredClone(mechanic);
  const mech: Mechanic = plain;
  const at = list.findIndex((m) => m.id === mech.id);
  if (at >= 0) list[at] = mech; else list.push(mech);

  const old = linkedRule(out, scope, mech.id);
  if (!target.constraint) {
    if (old) out.rules = out.rules.filter((r) => r !== old);
    return out;
  }
  const measure = target.absolute ? { kind: "count" as const, absolute: true } : { kind: "count" as const };
  const rule: Rule = old ?? { id: freeRuleId(out, mech.id), name: "", scope: structuredClone(scope), measure,
    filter: { op: "and", items: [{ field: "member", op: "is", value: mech.id }] } };
  rule.name = mech.name;
  if (mech.priority) rule.priority = mech.priority;
  else if (!old || rule.priority) rule.priority = "primary";
  rule.measure = measure;
  rule.constraint = structuredClone(target.constraint);
  if (!old) out.rules.push(rule);
  return out;
}

/** A copy of the config without a mechanic and every rule linked to it. Rules that use it in a larger filter stay. */
export function removeMechanic(config: Config, scope: Scope, mechanicId: string): Config {
  const linked = new Set(linkedRules(config, scope, mechanicId).map((r) => r.id));
  const out: Config = structuredClone(config);
  out.rules = out.rules.filter((r) => !linked.has(r.id));
  const owner = scope.kind === "color" ? out.colors.find((c) => c.code === scope.color)
    : scope.kind === "archetype" ? out.archetypes.find((a) => a.id === scope.id) : undefined;
  if (owner) owner.mechanics = (owner.mechanics || []).filter((m) => m.id !== mechanicId);
  return out;
}
