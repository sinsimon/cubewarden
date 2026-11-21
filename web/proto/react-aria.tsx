/**
 * Workbench mockup on React Aria Components (behaviour and ARIA from the library, styles in react-aria.html).
 * Static: no engine, hard-coded data. Build: npm run build:proto (writes web/proto/react-aria.js).
 */
import { useMemo, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  Breadcrumb, Breadcrumbs, Button, Cell, Checkbox, Column, Dialog, DialogTrigger, Input, Link, Menu,
  MenuItem, MenuTrigger, Modal, ModalOverlay, Popover, Row, SearchField, Switch, Table, TableBody, TableHeader, Tag,
  TagGroup, TagList, Tree, TreeItem, TreeItemContent, type Key, type Selection, type SortDescriptor,
} from "react-aria-components";

type Card = { name: string; cost: string; type: string; mv: number; wrAdj: number; wrRaw: number; set: string; rarity: string; rules: string[] };
type Status = "pass" | "warn" | "fail";
type Rule = { id: string; name: string; min: number; max?: number; count: number; status: Status; target: string };
type Scope = { id: string; name: string; status: Status; count: number | string; pips?: string; desc?: string };

// Foundations (FDN) white cards with 17Lands win rates: a 25-card sample.
const CARDS: Card[] = JSON.parse(document.getElementById("cards")!.textContent!);

const RULES: Rule[] = ([
  { id: "removal", name: "Removal", min: 6 },
  { id: "tricks", name: "Combat tricks", min: 6 },
  { id: "protection", name: "Protection", min: 4 },
  { id: "flying", name: "Flying", min: 5 },
  { id: "lifegain", name: "Lifegain", min: 5 },
  { id: "counters", name: "+1/+1 counters", min: 4 },
  { id: "creatures", name: "Creatures", min: 12, max: 15 },
  { id: "size", name: "Cards in colour", min: 30, max: 30 },
] as Omit<Rule, "count" | "status" | "target">[]).map((r) => {
  const count = r.id === "size" ? CARDS.length : CARDS.filter((c) => c.rules.includes(r.id)).length;
  const max = r.max ?? Infinity;
  const off = count < r.min ? r.min - count : count > max ? count - max : 0;
  const status: Status = off === 0 ? "pass" : off === 1 ? "warn" : "fail";
  const target = r.max === undefined || r.min === r.max ? `${r.min}` : `${r.min}–${r.max}`;
  return { ...r, count, status, target };
});

const STATUS = { pass: "Pass", warn: "Close", fail: "Fail" } as const;
const GLYPH = { pass: "✓", warn: "⚠", fail: "✕" } as const;

const SECTIONS: { id: string; name: string; items: Scope[] }[] = [
  { id: "sec-cube", name: "Whole cube", items: [{ id: "cube", name: "Standard Limited All Stars", status: "fail", count: 435 }] },
  { id: "sec-colours", name: "Colours", items: [
    { id: "all-colours", name: "All colours", status: "fail", count: "3 rules" },
    { id: "white", name: "White", status: RULES.some((r) => r.status === "fail") ? "fail" : "pass", count: CARDS.length, pips: "W", desc: "Mono-white nonland cards. This mockup shows a 25-card sample from Foundations." },
    { id: "blue", name: "Blue", status: "pass", count: 65, pips: "U" },
    { id: "black", name: "Black", status: "fail", count: 61, pips: "B" },
    { id: "red", name: "Red", status: "warn", count: 62, pips: "R" },
    { id: "green", name: "Green", status: "pass", count: 59, pips: "G" },
    { id: "colourless", name: "Colourless", status: "pass", count: 26, pips: "C" },
    { id: "lands", name: "Lands", status: "warn", count: 55, pips: "N" },
  ] },
  { id: "sec-archetypes", name: "Archetypes", items: [
    { id: "all-archetypes", name: "All archetypes", status: "fail", count: "3 rules" },
    { id: "azorius", name: "Azorius Flying Tempo", status: "pass", count: 94, pips: "WU" },
    { id: "orzhov", name: "Orzhov Aristocrats", status: "pass", count: 62, pips: "WB" },
    { id: "boros", name: "Boros Go Wide Aggro", status: "warn", count: 50, pips: "RW" },
    { id: "selesnya", name: "Selesnya +1/+1 Counters", status: "warn", count: 52, pips: "GW" },
    { id: "dimir", name: "Dimir Graveyard", status: "pass", count: 63, pips: "UB" },
    { id: "izzet", name: "Izzet Spells", status: "fail", count: 130, pips: "UR" },
    { id: "simic", name: "Simic Ramp", status: "pass", count: 74, pips: "GU" },
    { id: "rakdos", name: "Rakdos Sacrifice", status: "pass", count: 67, pips: "BR" },
    { id: "golgari", name: "Golgari Graveyard", status: "pass", count: 51, pips: "BG" },
    { id: "gruul", name: "Gruul Ramp", status: "warn", count: 74, pips: "RG" },
  ] },
];
const SCOPES = SECTIONS.flatMap((s) => s.items);

const Dot = ({ s }: { s: Status }) => <><span className={`st ${s}`} aria-hidden="true" /><span className="sr-only">{STATUS[s]}: </span></>;
const Pips = ({ p }: { p?: string }) => p
  ? <span className="pips" aria-hidden="true">{[...p].map((x, i) => <span key={i} className={`pip ${x}`}>{x === "N" ? "L" : x === "C" ? "◇" : x}</span>)}</span>
  : null;
const Cost = ({ c }: { c: string }) => (
  <span className="pips" role="img" aria-label={c}>
    {[...c.matchAll(/\{([^}]+)\}/g)].map((m, i) => <span key={i} className={`pip ${/\d/.test(m[1]) ? "C" : m[1]}`}>{m[1]}</span>)}
  </span>
);
// React Aria has no progress ring: a drawn one, decorative (the text carries the numbers).
const Ring = ({ r }: { r: Rule }) => {
  const c = 2 * Math.PI * 5, p = Math.min(1, r.count / r.min);
  return (
    <svg className={`ring ${r.status}`} viewBox="0 0 14 14" aria-hidden="true">
      <circle className="track" cx="7" cy="7" r="5" fill="none" strokeWidth="3" />
      <circle className="ind" cx="7" cy="7" r="5" fill="none" strokeWidth="3" strokeDasharray={`${c * p} ${c}`} />
    </svg>
  );
};
const Chevron = () => <svg width="10" height="10" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2" /></svg>;
const Caret = () => <svg width="10" height="10" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 6l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" /></svg>;
const Box = ({ isSelected, isIndeterminate }: { isSelected: boolean; isIndeterminate: boolean }) => (
  <span className="box" aria-hidden="true">
    {isIndeterminate ? <svg viewBox="0 0 12 12"><path d="M2.5 6h7" stroke="currentColor" strokeWidth="2" /></svg>
      : isSelected ? <svg viewBox="0 0 12 12"><path d="M2.5 6.2l2.4 2.4 4.6-5" fill="none" stroke="currentColor" strokeWidth="2" /></svg> : null}
  </span>
);

function NodeRow({ children, hasKids }: { children: ReactNode; hasKids: boolean }) {
  return (
    <TreeItemContent>
      {() => <>
        {hasKids ? <Button slot="chevron" className="chev"><Chevron /></Button> : <span className="chev" aria-hidden="true" />}
        {children}
      </>}
    </TreeItemContent>
  );
}

function ScopeTree({ current, onSelect }: { current: Key; onSelect: (k: string) => void }) {
  const [expanded, setExpanded] = useState<Selection>(new Set(["sec-cube", "sec-colours", "sec-archetypes", "white"]));
  return (
    <Tree
      aria-label="Scopes, rules and mechanics"
      className="tree"
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={new Set([current])}
      onSelectionChange={(keys) => {
        const k = [...(keys as Set<Key>)][0];
        if (k && !String(k).startsWith("sec-")) onSelect(String(k));
      }}
      expandedKeys={expanded}
      onExpandedChange={setExpanded}
    >
      {SECTIONS.map((s) => (
        <TreeItem key={s.id} id={s.id} textValue={s.name} className="ti section">
          <NodeRow hasKids><span className="nm">{s.name}</span></NodeRow>
          {s.items.map((it) => (
            <TreeItem key={it.id} id={it.id} textValue={it.name} className="ti">
              <NodeRow hasKids={it.id === "white"}>
                <Dot s={it.status} /><Pips p={it.pips} /><span className="nm">{it.name}</span><span className="ct">{it.count}</span>
              </NodeRow>
              {it.id === "white" && RULES.map((r) => (
                <TreeItem key={r.id} id={`rule:${r.id}`} textValue={r.name} className="ti">
                  <NodeRow hasKids={false}>
                    <Dot s={r.status} /><span className="nm">{r.name}</span><span className="ct">{r.count}/{r.target}</span>
                  </NodeRow>
                </TreeItem>
              ))}
            </TreeItem>
          ))}
        </TreeItem>
      ))}
    </Tree>
  );
}

const pct = (x: number) => (x * 100).toFixed(1) + "%";

function App() {
  const [scope, setScope] = useState("white");
  const [rule, setRule] = useState<string | null>("removal");
  const [sort, setSort] = useState<SortDescriptor>({ column: "mv", direction: "ascending" });
  const [selected, setSelected] = useState<Selection>(new Set());
  const [query, setQuery] = useState("");
  const [scaled, setScaled] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  const select = (s: string, r: string | null) => { setScope(s); setRule(s === "white" ? r : null); setNavOpen(false); };
  const onTree = (k: string) => k.startsWith("rule:") ? select("white", k.slice(5)) : select(k, k === "white" ? rule ?? "removal" : null);
  const treeKey = rule && scope === "white" ? `rule:${rule}` : scope;
  const s = SCOPES.find((x) => x.id === scope)!;
  const r = RULES.find((x) => x.id === rule);

  const rows = useMemo(() => {
    if (scope !== "white") return [];
    const key = sort.column as keyof Card, dir = sort.direction === "descending" ? -1 : 1;
    return CARDS.filter((c) => !query || `${c.name} ${c.type}`.toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => (a[key] < b[key] ? -dir : a[key] > b[key] ? dir : a.name.localeCompare(b.name)));
  }, [scope, sort, query]);
  const counted = (c: Card) => !!r && (r.id === "size" || c.rules.includes(r.id));
  const hits = rows.filter(counted).length;

  const tree = <ScopeTree current={treeKey} onSelect={onTree} />;

  return (
    <div className="shell">
      <header className="appbar">
        <DialogTrigger isOpen={navOpen} onOpenChange={setNavOpen}>
          <Button className="iconbtn menu" aria-label="Scopes">
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.6" /></svg>
          </Button>
          <ModalOverlay className="overlay" isDismissable>
            <Modal className="sheet">
              <Dialog className="sheet-dialog" aria-label="Scopes, rules and mechanics">
                {tree}
              </Dialog>
            </Modal>
          </ModalOverlay>
        </DialogTrigger>
        <span className="brand">Standard Limited All Stars</span>
        <nav className="views" aria-label="Views">
          <Link className="view" href="#" aria-current="page">Workbench</Link>
          <Link className="view" href="#">Overview</Link>
        </nav>
        <span className="spacer" />
        <span className="meta">435 cards, target 360</span>
        <Switch className="switch" isSelected={scaled} onChange={setScaled}>
          <span className="track" aria-hidden="true"><span className="thumb" /></span>Scaled to 360
        </Switch>
        <Button className="btn">Changes <span className="pillcount">166</span></Button>
      </header>

      <aside className="side">{tree}</aside>

      <main className="content" id="main">
        <Breadcrumbs className="crumbs" aria-label="Scope">
          <Breadcrumb id="cube"><Link className="crumb" onPress={() => select("cube", null)}>Cube</Link></Breadcrumb>
          <Breadcrumb id="scope">
            <Link className="crumb" onPress={() => select(scope === "cube" ? "white" : scope, rule)}>{scope === "cube" ? "All scopes" : s.name}</Link>
            <MenuTrigger>
              <Button className="iconbtn sib" aria-label="Other scopes"><Caret /></Button>
              <Popover className="popover" placement="bottom start">
                <Menu className="menu-list" onAction={(k) => select(String(k), String(k) === "white" ? "removal" : null)}>
                  {SECTIONS.slice(1).flatMap((sec) => sec.items).map((it) => <MenuItem key={it.id} id={it.id} className="mi">{it.name}</MenuItem>)}
                </Menu>
              </Popover>
            </MenuTrigger>
          </Breadcrumb>
          {r && (
            <Breadcrumb id="rule">
              <Link className="crumb">{r.name}</Link>
              <MenuTrigger>
                <Button className="iconbtn sib" aria-label="Other rules"><Caret /></Button>
                <Popover className="popover" placement="bottom start">
                  <Menu className="menu-list" onAction={(k) => select("white", String(k))}>
                    {RULES.map((x) => <MenuItem key={x.id} id={x.id} className="mi">{x.name}</MenuItem>)}
                  </Menu>
                </Popover>
              </MenuTrigger>
            </Breadcrumb>
          )}
        </Breadcrumbs>

        <div className="titlebar">
          {s.pips && <span className="pips big" aria-hidden="true"><Pips p={s.pips} /></span>}
          <h1>{s.name}</h1>
          <span className={`badge ${s.status}`}>{STATUS[s.status]}</span>
        </div>
        <p className="desc">{s.desc ?? "Static mockup: only White has rules and card data."}</p>

        {scope === "white" && (
          <TagGroup
            className="rules"
            aria-label="Rules and mechanics of this scope"
            selectionMode="single"
            disallowEmptySelection
            selectedKeys={rule ? [rule] : []}
            onSelectionChange={(keys) => { const k = [...(keys as Set<Key>)][0]; if (k) select("white", String(k)); }}
          >
            <TagList className="chips">
              {RULES.map((x) => (
                <Tag key={x.id} id={x.id} className="chip" textValue={`${x.name} ${x.count} of ${x.target}, ${STATUS[x.status]}`}>
                  <Ring r={x} />{x.name} <span className="n">{x.count}/{x.target}</span>
                  <span className={`g ${x.status}`} aria-hidden="true">{GLYPH[x.status]}</span><span className="sr-only">, {STATUS[x.status]}</span>
                </Tag>
              ))}
            </TagList>
          </TagGroup>
        )}

        <div className="toolbar">
          <SearchField className="search" aria-label="Search cards" value={query} onChange={setQuery}>
            <Input placeholder="Search, or filter: otag:removal t:creature mv<=3" />
          </SearchField>
          <Button className="btn">Filter</Button>
          <Button className="btn">Columns</Button>
          <span className="count" role="status">{scope === "white" ? `${rows.length} of ${CARDS.length} cards${r ? ` · ${hits} counted by ${r.name}` : ""}` : ""}</span>
        </div>

        <div className="tablewrap">
          <Table
            className="cards"
            aria-label={r ? `${s.name} cards; rows counted by ${r.name} are highlighted` : `${s.name} cards`}
            selectionMode="multiple"
            selectedKeys={selected}
            onSelectionChange={setSelected}
            sortDescriptor={sort}
            onSortChange={setSort}
          >
            <TableHeader>
              <Column className="sel"><Checkbox slot="selection" className="cb">{(p) => <Box {...p} />}</Checkbox></Column>
              <Column id="name" isRowHeader allowsSorting>Name</Column>
              <Column id="cost" className="col-cost">Mana cost</Column>
              <Column id="type" allowsSorting className="col-type">Type</Column>
              <Column id="mv" allowsSorting className="num">MV</Column>
              <Column id="set" allowsSorting className="col-set">Set</Column>
              <Column id="wrAdj" allowsSorting className="num">Adj WR</Column>
              <Column id="wrRaw" allowsSorting className="num col-raw">Raw WR</Column>
              <Column id="hit">{r ? r.name : "Rule"}</Column>
            </TableHeader>
            <TableBody items={rows} renderEmptyState={() => scope === "white" ? "No cards match the search." : "Static mockup: only White has card data."}>
              {(c) => (
                <Row id={c.name} className={counted(c) ? "row hit" : "row"}>
                  <Cell className="sel"><Checkbox slot="selection" className="cb">{(p) => <Box {...p} />}</Checkbox></Cell>
                  <Cell className="name">{c.name}</Cell>
                  <Cell className="col-cost"><Cost c={c.cost} /></Cell>
                  <Cell className="type col-type">{c.type}</Cell>
                  <Cell className="num">{c.mv}</Cell>
                  <Cell className="col-set">{c.set}</Cell>
                  <Cell className="num">{pct(c.wrAdj)}</Cell>
                  <Cell className="num col-raw">{pct(c.wrRaw)}</Cell>
                  <Cell className="hitcell">{counted(c) ? <>✓<span className="sr-only"> counted</span></> : ""}</Cell>
                </Row>
              )}
            </TableBody>
          </Table>
        </div>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
