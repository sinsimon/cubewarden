/**
 * Workbench mockup on Mantine (components, theme and dark mode from Mantine; a few classes in mantine.html).
 * Static: no engine, hard-coded data. Build: npm run build:proto (writes web/proto/mantine.js and mantine.css).
 */
import "@mantine/core/styles.css";
import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AppShell, Badge, Box, Breadcrumbs, Burger, Button, Checkbox, Chip, Group, Menu, MantineProvider, RingProgress,
  ScrollArea, Switch, Table, Text, TextInput, Title, Tree, UnstyledButton, createTheme, useTree, type TreeNodeData,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { CARDS, GLYPH, RULES, SCOPES, SECTIONS, STATUS, type Card, type Rule, type Status } from "./mock-data.ts";

const theme = createTheme({
  fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  defaultRadius: "sm",
  primaryColor: "blue",
  fontSizes: { xs: "11px", sm: "13px", md: "14px", lg: "16px", xl: "18px" },
  headings: { sizes: { h1: { fontSize: "24px", lineHeight: "1.2" } } },
});

const COLOR: Record<Status, string> = { pass: "green", warn: "orange", fail: "red" };

const Dot = ({ s }: { s: Status }) => <><span className={`st ${s}`} aria-hidden="true" /><span className="sr-only">{STATUS[s]}: </span></>;
const Pips = ({ p, big }: { p?: string; big?: boolean }) => p
  ? <span className={`pips${big ? " big" : ""}`} aria-hidden="true">{[...p].map((x, i) => <span key={i} className={`pip ${x}`}>{x === "N" ? "L" : x === "C" ? "◇" : x}</span>)}</span>
  : null;
const Cost = ({ c }: { c: string }) => (
  <span className="pips" role="img" aria-label={c}>
    {[...c.matchAll(/\{([^}]+)\}/g)].map((m, i) => <span key={i} className={`pip ${/\d/.test(m[1]) ? "C" : m[1]}`}>{m[1]}</span>)}
  </span>
);
const Caret = () => <svg width="10" height="10" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 6l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" /></svg>;
const pct = (x: number) => (x * 100).toFixed(1) + "%";

// Tree data: sections, scopes, and White's rules. Values: "sec-*", scope ids, "rule:*".
const TREE: TreeNodeData[] = SECTIONS.map((s) => ({
  value: s.id,
  label: s.name,
  children: s.items.map((it) => ({
    value: it.id,
    label: it.name,
    nodeProps: { status: it.status, count: it.count, pips: it.pips },
    children: it.id === "white" ? RULES.map((r) => ({ value: `rule:${r.id}`, label: r.name, nodeProps: { status: r.status, count: `${r.count}/${r.target}` } })) : undefined,
  })),
}));

function ScopeTree({ current, onSelect }: { current: string; onSelect: (v: string) => void }) {
  const tree = useTree({
    initialExpandedState: { "sec-cube": true, "sec-colours": true, "sec-archetypes": true, white: true },
    selectedState: [current],
    onSelectedStateChange: (sel) => { const v = sel[sel.length - 1]; if (v && !v.startsWith("sec-")) onSelect(v); },
  });
  return (
    <Tree
      data={TREE}
      tree={tree}
      levelOffset={14}
      aria-label="Scopes, rules and mechanics"
      renderNode={({ node, expanded, hasChildren, elementProps, selected, level }) => (
        <Group gap={6} wrap="nowrap" {...elementProps} className={`${elementProps.className} tnode${level === 1 ? " section" : ""}${selected ? " on" : ""}`}>
          {hasChildren
            ? <svg className={`chev${expanded ? " open" : ""}`} width="10" height="10" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2" /></svg>
            : <span className="chev" />}
          {node.nodeProps?.status && <Dot s={node.nodeProps.status} />}
          <Pips p={node.nodeProps?.pips} />
          <span className="nm">{node.label}</span>
          {node.nodeProps?.count !== undefined && <span className="ct">{node.nodeProps.count}</span>}
        </Group>
      )}
    />
  );
}

function RuleChip({ r }: { r: Rule }) {
  return (
    <Chip value={r.id} size="sm" variant="outline" icon={<></>} classNames={{ label: "chip-label", iconWrapper: "chip-icon" }}>
      <RingProgress className="ring" size={18} thickness={3} roundCaps sections={[{ value: Math.min(100, (100 * r.count) / r.min), color: COLOR[r.status] }]} aria-hidden="true" />
      {r.name} <span className="n">{r.count}/{r.target}</span>
      <span className={`g ${r.status}`} aria-hidden="true">{GLYPH[r.status]}</span><span className="sr-only">, {STATUS[r.status]}</span>
    </Chip>
  );
}

type SortKey = "name" | "type" | "mv" | "set" | "wrAdj" | "wrRaw";
function Th({ k, label, sort, onSort, className }: { k: SortKey; label: string; sort: { key: SortKey; dir: 1 | -1 }; onSort: (k: SortKey) => void; className?: string }) {
  const on = sort.key === k;
  return (
    <Table.Th className={className} aria-sort={on ? (sort.dir > 0 ? "ascending" : "descending") : "none"}>
      <UnstyledButton className="sortbtn" onClick={() => onSort(k)}>
        {label}<span className="arrow" aria-hidden="true">{on ? (sort.dir > 0 ? "▲" : "▼") : ""}</span>
      </UnstyledButton>
    </Table.Th>
  );
}

function App() {
  const [opened, { toggle, close }] = useDisclosure(false);
  const [scope, setScope] = useState("white");
  const [rule, setRule] = useState<string | null>("removal");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "mv", dir: 1 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [scaled, setScaled] = useState(false);

  const select = (s: string, r: string | null) => { setScope(s); setRule(s === "white" ? r : null); close(); };
  const onTree = (v: string) => v.startsWith("rule:") ? select("white", v.slice(5)) : select(v, v === "white" ? rule ?? "removal" : null);
  const s = SCOPES.find((x) => x.id === scope)!;
  const r = RULES.find((x) => x.id === rule);

  const rows = useMemo(() => scope !== "white" ? [] : CARDS
    .filter((c) => !query || `${c.name} ${c.type}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => (a[sort.key] < b[sort.key] ? -sort.dir : a[sort.key] > b[sort.key] ? sort.dir : a.name.localeCompare(b.name))), [scope, sort, query]);
  const counted = (c: Card) => !!r && (r.id === "size" || c.rules.includes(r.id));
  const nSel = rows.filter((c) => selected.has(c.name)).length;
  const onSort = (k: SortKey) => setSort((p) => ({ key: k, dir: p.key === k ? (-p.dir as 1 | -1) : k.startsWith("wr") ? -1 : 1 }));
  const toggleRow = (name: string) => setSelected((p) => { const n = new Set(p); n.has(name) ? n.delete(name) : n.add(name); return n; });

  return (
    <AppShell header={{ height: 44 }} navbar={{ width: 280, breakpoint: "md", collapsed: { mobile: !opened } }} padding={0}>
      <AppShell.Header className="appbar">
        <Group h="100%" px="md" gap="sm" wrap="nowrap">
          <Burger opened={opened} onClick={toggle} hiddenFrom="md" size="sm" aria-label="Scopes" />
          <Text fw={600} truncate className="brand">Standard Limited All Stars</Text>
          <Group gap={2} visibleFrom="sm" component="nav" aria-label="Views">
            <Button size="compact-sm" variant="light" color="gray" component="a" href="#" aria-current="page">Workbench</Button>
            <Button size="compact-sm" variant="subtle" color="gray" component="a" href="#">Overview</Button>
          </Group>
          <Box style={{ flex: 1 }} />
          <Text size="sm" c="dimmed" visibleFrom="md">435 cards, target 360</Text>
          <Switch size="xs" label="Scaled to 360" checked={scaled} onChange={(e) => setScaled(e.currentTarget.checked)} visibleFrom="sm" />
          <Button size="compact-sm" variant="default" rightSection={<Badge size="xs" circle={false}>166</Badge>}>Changes</Button>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar className="side">
        <ScrollArea p={6}>
          <ScopeTree current={rule && scope === "white" ? `rule:${rule}` : scope} onSelect={onTree} />
        </ScrollArea>
      </AppShell.Navbar>

      <AppShell.Main>
        <Box className="content" id="main">
          <Breadcrumbs separator="/" separatorMargin={6} className="crumbs" component="nav" aria-label="Scope">
            <UnstyledButton className="crumb" onClick={() => select("cube", null)}>Cube</UnstyledButton>
            <Group gap={0} wrap="nowrap">
              <UnstyledButton className="crumb" onClick={() => select(scope === "cube" ? "white" : scope, rule)} aria-current={r ? undefined : "page"}>{scope === "cube" ? "All scopes" : s.name}</UnstyledButton>
              <Menu position="bottom-start" shadow="md" withinPortal>
                <Menu.Target><UnstyledButton className="sib" aria-label="Other scopes"><Caret /></UnstyledButton></Menu.Target>
                <Menu.Dropdown mah={360} style={{ overflowY: "auto" }}>
                  {SECTIONS.slice(1).map((sec, i) => [
                    i > 0 && <Menu.Divider key={`d${i}`} />,
                    ...sec.items.map((it) => <Menu.Item key={it.id} onClick={() => select(it.id, it.id === "white" ? "removal" : null)}>{it.name}</Menu.Item>),
                  ])}
                </Menu.Dropdown>
              </Menu>
            </Group>
            {r && (
              <Group gap={0} wrap="nowrap">
                <UnstyledButton className="crumb current" aria-current="page">{r.name}</UnstyledButton>
                <Menu position="bottom-start" shadow="md" withinPortal>
                  <Menu.Target><UnstyledButton className="sib" aria-label="Other rules"><Caret /></UnstyledButton></Menu.Target>
                  <Menu.Dropdown>
                    {RULES.map((x) => <Menu.Item key={x.id} onClick={() => select("white", x.id)}>{x.name}</Menu.Item>)}
                  </Menu.Dropdown>
                </Menu>
              </Group>
            )}
          </Breadcrumbs>

          <Group gap="sm" mt={6} mb={2} wrap="wrap">
            <Pips p={s.pips} big />
            <Title order={1}>{s.name}</Title>
            <Badge color={COLOR[s.status]} variant="light" size="sm" tt="none">{STATUS[s.status]}</Badge>
          </Group>
          <Text size="sm" c="dimmed" mb="sm">{s.desc ?? "Static mockup: only White has rules and card data."}</Text>

          {scope === "white" && (
            <div className="rules" role="radiogroup" aria-label="Rules and mechanics of this scope">
              <Chip.Group multiple={false} value={rule ?? undefined} onChange={(v) => select("white", v)}>
                <Group gap={6} className="chips">
                  {RULES.map((x) => <RuleChip key={x.id} r={x} />)}
                </Group>
              </Chip.Group>
            </div>
          )}

          <Group gap="xs" mb={8} wrap="wrap">
            <TextInput size="xs" className="search" placeholder="Search, or filter: otag:removal t:creature mv<=3" aria-label="Search cards" value={query} onChange={(e) => setQuery(e.currentTarget.value)} />
            <Button size="xs" variant="default">Filter</Button>
            <Button size="xs" variant="default">Columns</Button>
            <Text size="sm" c="dimmed" ml="auto" role="status">{scope === "white" ? `${rows.length} of ${CARDS.length} cards${r ? ` · ${rows.filter(counted).length} counted by ${r.name}` : ""}` : ""}</Text>
          </Group>

          <div className="tablewrap">
            <Table className="cards" highlightOnHover verticalSpacing={4} horizontalSpacing={8} stickyHeader withTableBorder
              aria-label={r ? `${s.name} cards; rows counted by ${r.name} are highlighted` : `${s.name} cards`}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th className="sel">
                    <Checkbox size="xs" aria-label="Select all cards" checked={rows.length > 0 && nSel === rows.length} indeterminate={nSel > 0 && nSel < rows.length}
                      onChange={(e) => setSelected(e.currentTarget.checked ? new Set(rows.map((c) => c.name)) : new Set())} />
                  </Table.Th>
                  <Th k="name" label="Name" sort={sort} onSort={onSort} />
                  <Table.Th className="col-cost">Mana cost</Table.Th>
                  <Th k="type" label="Type" sort={sort} onSort={onSort} className="col-type" />
                  <Th k="mv" label="MV" sort={sort} onSort={onSort} className="num" />
                  <Th k="set" label="Set" sort={sort} onSort={onSort} className="col-set" />
                  <Th k="wrAdj" label="Adj WR" sort={sort} onSort={onSort} className="num" />
                  <Th k="wrRaw" label="Raw WR" sort={sort} onSort={onSort} className="num col-raw" />
                  <Table.Th>{r ? r.name : "Rule"}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.length === 0 && <Table.Tr><Table.Td colSpan={9} className="empty">{scope === "white" ? "No cards match the search." : "Static mockup: only White has card data."}</Table.Td></Table.Tr>}
                {rows.map((c) => (
                  <Table.Tr key={c.name} className={counted(c) ? "hit" : undefined} data-selected={selected.has(c.name) || undefined}>
                    <Table.Td className="sel"><Checkbox size="xs" aria-label={`Select ${c.name}`} checked={selected.has(c.name)} onChange={() => toggleRow(c.name)} /></Table.Td>
                    <Table.Td className="name">{c.name}</Table.Td>
                    <Table.Td className="col-cost"><Cost c={c.cost} /></Table.Td>
                    <Table.Td className="type col-type">{c.type}</Table.Td>
                    <Table.Td className="num">{c.mv}</Table.Td>
                    <Table.Td className="col-set">{c.set}</Table.Td>
                    <Table.Td className="num">{pct(c.wrAdj)}</Table.Td>
                    <Table.Td className="num col-raw">{pct(c.wrRaw)}</Table.Td>
                    <Table.Td className="hitcell">{counted(c) ? <>✓<span className="sr-only"> counted</span></> : ""}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </div>
        </Box>
      </AppShell.Main>
    </AppShell>
  );
}

createRoot(document.getElementById("root")!).render(
  <MantineProvider theme={theme} defaultColorScheme="auto"><App /></MantineProvider>,
);
