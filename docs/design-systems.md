# Design systems for the cubewarden page

Research date: 21 November 2026. The question was which open-source design system, usable without React, could
replace the hand-written CSS in `web/index.html` and keep the dense, Airtable-like look. The system should enforce
design and accessibility rules itself.

**Short answer.** Vaadin web components with the Aura theme come first. Among the free, maintained systems it has
the best data grid (sorting, checkbox selection with range select, virtual scrolling, `role="treegrid"`), under
Apache 2.0, with an annual external accessibility audit. Vaadin has no stand-alone tree-view component. The same
grid with a tree column renders our left tree as an ARIA treegrid, edit buttons included, and the nested Side Nav
is the alternative. It also lacks a progress ring and a chip. Web Awesome is second. It has the best defaults, a
real tree and the easiest CDN, but its data grid is paid, so the main table would stay hand-built. Carbon is third.
It has both a tree and a table, but the look is IBM's and it ships the heaviest JS of the four I bundled.

## How the facts were gathered

- Versions, release dates and licences come from the npm registry (`npm view <pkg> version license time`) on 21 Nov
  2026. Package pages: `https://www.npmjs.com/package/<pkg>`.
- Component coverage comes from the published package files, listed through the jsDelivr API
  (`https://data.jsdelivr.com/v1/packages/npm/<pkg>@<version>?structure=tree`) and, for the top candidates, from the
  installed source. These facts are marked **[pkg]**.
- Claims about accessibility, theming and licensing come from each project's own docs or README, marked **[docs]**
  with the URL. Where a page was silent, the text says "no statement found" rather than guessing.
- Bundle sizes were measured with esbuild 0.28.2 (`--bundle --minify --format=esm`, then `gzip -9`) over the
  components cubewarden needs (list under the size table). They are JS only; theme CSS is listed separately.

## What cubewarden needs (from `web/index.html`)

- **Left tree.** Three levels: section headings (Whole cube, Colours, Archetypes), scope nodes (cube, each colour,
  each archetype, the two "shared rules" nodes), then the rules and mechanics of the open scope. Each row carries a
  status glyph, a count or value and an edit button. Clicking a scope node changes the main view, so the tree works
  as navigation.
- **Main table.** Every card in the scope (a cube is 360 to 540 cards), a checkbox column with select-all,
  click / Cmd-click / Shift-click selection, sortable headers including a computed "rule value" column, row classes
  for hit / bad / selected / focused, and page-level shortcuts (J/K, Space, X, Cmd-A, Backspace).
- A second table in the Add/Replace finder (150 rows, pick checkboxes, sortable, column picker).
- Rule-editor drawer with a nested AND/OR filter builder (selects, text inputs, chips, a "Not" checkbox), modals,
  tabs / segmented buttons, one switch ("Scaled"), tooltips (today `title=`), status badges and pills, a progress
  ring, `<details>` sections, toasts.
- Build. The page already loads an esbuild bundle (`web/dist/cubewarden.js`, built by `scripts/build-web.ts`), so a
  second esbuild entry for UI components costs little.

## Comparison

"Tree" and "Table" are the deciding columns. "Table" means a component with sorting and row selection, not CSS for a
plain `<table>`.

| System | Licence | Latest (npm, date) | CDN | Tree | Table | Missing for us | Accessibility claim | Light/dark, density |
|---|---|---|---|---|---|---|---|---|
| **Vaadin web components** (Aura theme) | Apache-2.0 for the core set; Grid Pro, CRUD, Charts and others are commercial | `@vaadin/grid` 25.3.7, 19 Nov 2026 | No official CDN; esbuild, or jsDelivr `+esm` resolves | **No tree-view component.** Substitutes: Grid tree column (`role="treegrid"`), Side Nav (nested links) | **Yes**: `vaadin-grid` with sort, selection column, range select, virtual scroll | Tree view, progress ring, chip | WCAG 2.1 A/AA target, yearly audit by TetraLogical [docs] | Aura uses `light-dark()`; `--aura-base-size` sets density [pkg] |
| **Web Awesome** (Shoelace successor) | MIT (free "Core"); Pro is paid | 3.15.0, 17 Nov 2026 | Yes, official (`ka-f.webawesome.com`) and jsDelivr | **Yes**: `wa-tree` | **No** in Core: `wa-data-grid` is Pro only; Core styles native `<table>` | Data grid, combobox (both Pro) | General commitment, no WCAG level named [docs] | `.wa-light` / `.wa-dark`, `--wa-space-scale` [docs][pkg] |
| **IBM Carbon Web Components** | Apache-2.0 | 2.68.0, 18 Nov 2026 (v3 alpha also published) | Yes, official IBM CDN per component; jsDelivr needs a bundler (bare `lit` imports) | **Yes**: `cds-tree-view`, sizes `xs`/`sm` | **Yes**: `cds-table`, sort, batch selection, expandable rows, sizes `xs`..`xl` | Progress ring | IBM Accessibility Checklist, "based on WCAG AA, Section 508, and European standards" [docs] | Themes white/g10/g90/g100 via `--cds-*` tokens |
| **SAP UI5 Web Components** | Apache-2.0 | 2.29.0, 18 Nov 2026 | **No**, by policy ("There is no CDN for UI5 Web Components") [docs] | **Yes**: `ui5-tree` | **Yes**: `ui5-table` with selection feature; header `sortIndicator` is visual, app sorts | Drawer (Fiori layouts instead), standalone tooltip, progress ring | "HTML, ARIA 1.2, and WCAG 2.2 standards", high-contrast themes [docs] | `sap_horizon`, `sap_horizon_dark`, high-contrast [pkg: `@ui5/webcomponents-theming`]; compact density via `data-ui5-compact-size` [pkg] |
| **Adobe Spectrum Web Components** | Apache-2.0 | 1.12.6, 9 Nov 2026 | Packages on npm; bundler | **No** (`tree-view` only as a 2022 prerelease); `sp-sidenav` multilevel up to 3 levels | **Yes**: `sp-table`, sortable, `selects="multiple"`, virtualized, `density="compact"` | Tree | No statement found in README | Not checked |
| **Microsoft Fluent UI Web Components** v3 | MIT | 3.2.1, 10 Nov 2026 | Yes, unpkg (README) | **Yes**: `tree`, `tree-item` | **No** (no data grid in v3) | Table, toast, breadcrumb | No v3 statement found; the Microsoft Learn overview (2021, FAST-based v2) says "highly accessible" | `webLightTheme` / `webDarkTheme` tokens |
| **Material Web** | Apache-2.0 | 2.5.0, 15 Jul 2026 | npm | No | No | Tree, table, drawer, tooltip, toast | n/a | n/a. "MWC is in maintenance mode pending new maintainers" [docs] |
| **GOV.UK Frontend** | MIT | 6.6.0, 15 Oct 2026 | npm | No | No sortable table found | Not web components (HTML/CSS/JS, Nunjucks) | WCAG AA target, axe plus manual AT testing [docs] | Built for UK government services |
| **PatternFly Elements** | MIT | 5.0.0, 3 May 2026 | npm | No | `pf-v5-table` (sortable, selected markup) [pkg] | Tree, drawer, toast, breadcrumb | No statement found in README | Red Hat look |
| **Lion** (ING) | MIT | `@lion/ui` 0.27.0, 7 Nov 2026 | npm | No | No | Tree, table, styling (white-label, unstyled) | "Aimed at compliance with the WCAG 2.2 AA standard" [docs] | You bring all styles |
| **Shoelace** | MIT | 2.20.1, 11 Mar 2025 | Yes (jsDelivr `cdn/` build) | Yes (`cdn/components/tree/tree.js` [pkg]) | No | Not maintained | n/a | "Shoelace is sunset. There is no active development" [docs] |
| Siemens iX (extra) | MIT | 5.3.0, 12 Oct 2026 | npm | `ix-tree` [pkg] | Via `@siemens/ix-aggrid` (AG Grid) | n/a | Not checked | Industrial look |
| Esri Calcite (extra) | **Not open source**: Esri Master License Agreement [pkg LICENSE.md] | 5.2.1 | n/a | n/a | n/a | Excluded on licence | n/a | n/a |

### Bundle size for our component set

| System | JS min | JS min+gzip | Theme CSS min+gzip |
|---|---|---|---|
| Web Awesome 3.15.0 | 403 KB | **96 KB** | 14 KB (`webawesome.css` = layers + native + utilities + default theme) |
| Vaadin 25.3.7 | 579 KB | **146 KB** (151 KB before the usage-statistics opt-out) | 13 KB (`@vaadin/aura/dist/aura.css`) |
| UI5 2.29.0 | 1,073 KB | **222 KB** | inside the JS (default theme) |
| Carbon 2.68.0 | 2,698 KB | **321 KB** | inside the JS; dark tokens need `@carbon/styles` CSS (1.19 MB raw for all of it) |

Component set per system: tree, table (Carbon, UI5, Vaadin only), drawer or side panel, dialog, tabs, select,
combobox (Carbon, UI5, Vaadin), switch, tooltip, badge/tag, breadcrumb, details/accordion, toast/notification,
progress, checkbox, text input, button. Today's whole `web/index.html` is about 2,900 lines with no UI library, so
any of these adds weight; Web Awesome adds the least.

## Each candidate

**Vaadin web components (Aura theme).** The core set is Apache 2.0 and includes Grid, Side Nav, Dialog, Tabs,
Tabsheet, Select, Combo Box, Switch, Tooltip, Badge, Breadcrumbs, Details, Accordion, Notification, Progress Bar,
Popover and Master Detail Layout; Grid Pro, CRUD, Charts, Dashboard and a few more are commercial
([README](https://github.com/vaadin/web-components)). `vaadin-grid` ships sort columns, a selection column with
`drag-select` and Shift range selection, a tree column, multi-sort and virtual scrolling, and sets `role`,
`aria-multiselectable`, `aria-selected` and `aria-sort` itself [pkg: `@vaadin/grid/src/vaadin-grid-a11y-mixin.js`,
`vaadin-grid-selection-column-base-mixin.js`; usage in the
[package README](https://www.npmjs.com/package/@vaadin/grid)]. The grid's root has `role="treegrid"`, and its
keyboard code has an interaction mode (Enter or F2) for controls inside cells [pkg: `vaadin-grid.js`,
`vaadin-grid-keyboard-navigation-mixin.js`]. Tree data comes from a `dataProvider` that receives `parentItem`, with
`itemHasChildrenPath` and `expandedItems` [pkg]. Cells render into light DOM through renderer functions, so our
cell markup and CSS keep working. Text fields slot a native `<input>` into light DOM, so native
forms and labels work [pkg: `@vaadin/field-base/src/input-controller.js`]. Vaadin states its components target WCAG
2.1 A and AA and get "holistic testing once a year" by TetraLogical ([accessibility](https://vaadin.com/accessibility)).
Aura is the default theme in Vaadin 25 ([themes](https://vaadin.com/docs/latest/styling/themes)); its colours use CSS
`light-dark()`, and `--aura-base-size` (default 16) and `--aura-base-radius` scale spacing and corners [pkg:
`@vaadin/aura/src/color.css`, `src/size.css`]. The grid exposes `--vaadin-grid-cell-padding` and row colour tokens for
density. Gaps: no tree-view component, no official CDN, no progress ring, no chip component, and a
development-time usage-statistics package (details under gotchas).

**Web Awesome.** The best-looking defaults of the group, with an official CDN, an autoloader and form-associated
controls ("they will submit with forms just like native `<form>` controls",
[form controls](https://webawesome.com/docs/form-controls)). Core has `wa-tree` with `single`, `multiple`, `leaf`
and `leaf-multiple` selection and lazy loading ([tree](https://webawesome.com/docs/components/tree)); the tree code
handles arrow keys, Home/End and `aria-multiselectable` [pkg]. It also has drawer, dialog, tab group, select,
switch, tooltip, badge, tag, breadcrumb, details, toast (since 3.3), progress ring, page layout and split panel, all
"stable" in `custom-elements.json` [pkg]. The decisive gap: `wa-data-grid` (sorting, selection, tree rows,
virtualization) is "Included with Web Awesome Pro" ([data grid](https://webawesome.com/docs/components/data-grid),
[pricing](https://webawesome.com/pro)); combobox is Pro too. Core styles a plain `<table>` (`wa-zebra-rows`,
`wa-hover-rows`) [pkg: `styles/native.css`], so sorting, selection and their ARIA would stay our code. The
accessibility page names no WCAG level and says "No individual contributor ... can claim their software is 100%
accessible" ([accessibility](https://webawesome.com/docs/resources/accessibility)). Theming is strong: `--wa-*`
tokens, `.wa-light` / `.wa-dark` classes, `::part()` and `:state()`
([customizing](https://webawesome.com/docs/customizing)).

**IBM Carbon Web Components.** It covers both decisive pieces: `cds-tree-view` / `cds-tree-node` with sizes `xs`
and `sm`, and `cds-table` with `is-sortable`, `is-selectable`, batch actions, expandable rows, zebra rows and sizes
`xs` (24 px) to `xl` [pkg: `es/components/tree-view/defs.js`, `data-table/defs.js`;
[data table usage](https://carbondesignsystem.com/components/data-table/usage/)]. Custom sorting goes through
`customSortRow` [pkg]. There is an official per-component CDN
(`https://1.www.s81c.com/common/carbon/web-components/version/v2.68.0/<component>.min.js`, checked 200 for
`tree-view` and `data-table`) ([README](https://github.com/carbon-design-system/carbon/tree/main/packages/web-components)).
Accessibility follows the IBM checklist "based on WCAG AA, Section 508, and European standards"
([Carbon accessibility](https://carbondesignsystem.com/guidelines/accessibility/overview/)). Downsides: the IBM
visual language (Plex, square corners, heavy blue), the largest bundle here, no virtualization found in the table,
v2 form integration uses the `formdata` event, which "is deprecated and will be removed in v3"
([form.md](https://github.com/carbon-design-system/carbon/blob/main/packages/web-components/docs/form.md)), and a v3
alpha is already on npm. The documented theme switch uses Sass
([styling.md](https://github.com/carbon-design-system/carbon/blob/main/packages/web-components/docs/styling.md));
without Sass, the `.cds--g100` class from `@carbon/styles/css/styles.min.css` sets the dark tokens [pkg]. The
package runs `ibmtelemetry` on postinstall [pkg: `package.json`, `telemetry.yml`].

**SAP UI5 Web Components.** The most complete set: `ui5-tree` (selection modes), `ui5-table` with
`ui5-table-selection-multi`, virtualizer and growing features, `ui5-side-navigation` (Fiori), toast, tag,
breadcrumbs, panel, switch, combo box [pkg]. Its accessibility statement is the strongest on paper: "HTML, ARIA 1.2,
and WCAG 2.2 standards", plus high-contrast black and white themes
([accessibility](https://ui5.github.io/webcomponents/docs/advanced/accessibility/)). Two problems for us. The docs
say "There is no CDN for UI5 Web Components" and require a bundler that handles JSON imports
([first steps](https://ui5.github.io/webcomponents/docs/getting-started/first-steps/)). And the look is SAP Fiori
Horizon, which is a long way from Airtable and hard to re-theme. Table sorting is a visual indicator only
(`sortIndicator`); the app sorts [pkg].

**Adobe Spectrum Web Components.** `sp-table` is good. It has sortable heads with a `sorted` event, single or
multiple selection, virtualization and `density="compact"` ([table](https://opensource.adobe.com/spectrum-web-components/components/table/)).
There is no tree. `sp-sidenav variant="multilevel"` supports "up to three levels"
([sidenav](https://opensource.adobe.com/spectrum-web-components/components/sidenav/)), and the npm `tree-view`
package is a 2022 prerelease (`0.0.2-treeview.2502`). The repo now has `1st-gen` and `gen2` folders with no
migration note in the README ([repo](https://github.com/adobe/spectrum-web-components)), so expect churn.

**Microsoft Fluent UI Web Components v3.** Has tree, drawer, dialog, tablist, dropdown, switch, tooltip, badge,
accordion, progress bar [pkg: `dist/esm/`]. No data grid, no toast, no breadcrumb in v3. CDN via unpkg and
`setTheme(webLightTheme | webDarkTheme)` ([README](https://github.com/microsoft/fluentui/tree/master/packages/web-components)).

**Material Web.** "MWC is in maintenance mode pending new maintainers"
([repo](https://github.com/material-components/material-web)), and it lacks tree, table, drawer, tooltip and toast.
Out.

**GOV.UK Frontend.** Very good accessibility process (WCAG AA target, jest-axe and @axe-core/puppeteer plus manual
testing with screen readers, magnifiers and speech recognition,
[strategy](https://design-system.service.gov.uk/accessibility/accessibility-strategy/)). But it is HTML/CSS/JS with
Nunjucks macros, not web components, it is built "to create consistent ... government services"
([frontend](https://frontend.design-system.service.gov.uk/)), and it has no tree. Out.

**PatternFly Elements.** `pf-v5-*` elements including a table with sortable and selected markup [pkg], but no tree,
drawer or toast, and the latest release is May 2026 ([repo](https://github.com/patternfly/patternfly-elements)).
The Red Hat Design System (`@rhds/elements` 5.0.0) is brand-specific.

**Lion.** "An unopinionated, white-label layer", aimed at WCAG 2.2 AA ([repo](https://github.com/ing-bank/lion)).
Good accessible behaviour for forms, overlays and listboxes, but no tree, no table and no visual design, so it would
not enforce the look. Out.

**Shoelace.** "Shoelace is sunset" ([repo](https://github.com/shoelace-style/shoelace)). Use Web Awesome instead.

**Siemens iX and Esri Calcite.** iX is MIT with `ix-tree` and an AG Grid wrapper (`@siemens/ix-aggrid` 5.1.0), but
the look is industrial. I did not check it further. Calcite's licence is the Esri Master License Agreement
(`LICENSE.md` in `@esri/calcite-components@5.2.1`), so it fails the open-source requirement.

## Ranking

1. **Vaadin web components + Aura.** The table decides it. Airtable is itself a data grid, and `vaadin-grid`
   behaves like one, with virtual rows, frozen and resizable columns, a checkbox column with range select and
   keyboard cell navigation. The grid owns the table ARIA, and Vaadin is the only project here that names an
   outside auditor. The tree is weaker. There is no tree-view component, so the left tree becomes a second
   `vaadin-grid` with `vaadin-grid-tree-column`. That keeps the edit button in each row and today's click
   behaviour, at the cost of a dataProvider for the hierarchy. Side Nav would look more like a sidebar, but its
   rows are links, so the edit buttons would have to leave the rows and scope changes would go through
   query-string routing (see the map). Aura is token-driven and dark mode follows `color-scheme`. Whether it can
   look as light as Airtable is my judgement from the tokens, not something I rendered. Costs: an esbuild step (we
   already have one), about 146 KB gzip, and no progress ring or chip.
2. **Web Awesome.** Pick it if the look matters more than having the system own the table. It has a real tree
   (`wa-tree`), everything else except the table and combobox, a one-line CDN, and the smallest bundle. But the main
   table, where users spend their time, stays hand-built with our own sort and selection ARIA. The alternative is a
   Pro licence, which sits badly with an MIT project that wants free components.
3. **IBM Carbon.** Full coverage, including tree and table, an official CDN and a clear WCAG AA basis. It ranks
   third because the IBM visual language (Plex type, square corners, strong blue) is further from Airtable in my
   judgement, the bundle is twice Vaadin's, and the v2 to v3 migration (form handling) is pending.

SAP UI5 is a close fourth. It is complete and has the strongest accessibility statement, but no CDN by policy and
a Fiori look.

## Winner: how to load Vaadin and what to use where

### Loading

The recommended route is a second esbuild entry next to the engine bundle, with exact versions pinned in `package.json`. Put
them in `devDependencies`, like esbuild today. The published package ships the built bundle in `web/dist/`, so users
who install cubewarden should not download Vaadin's sources.

```jsonc
// package.json (sketch)
"devDependencies": {
  "@vaadin/aura": "25.3.7", "@vaadin/grid": "25.3.7", "@vaadin/side-nav": "25.3.7",
  "@vaadin/master-detail-layout": "25.3.7", "@vaadin/dialog": "25.3.7", "@vaadin/tabs": "25.3.7",
  "@vaadin/tabsheet": "25.3.7", "@vaadin/select": "25.3.7", "@vaadin/combo-box": "25.3.7",
  "@vaadin/switch": "25.3.7", "@vaadin/tooltip": "25.3.7", "@vaadin/badge": "25.3.7",
  "@vaadin/breadcrumbs": "25.3.7", "@vaadin/details": "25.3.7", "@vaadin/accordion": "25.3.7",
  "@vaadin/notification": "25.3.7", "@vaadin/progress-bar": "25.3.7", "@vaadin/checkbox": "25.3.7",
  "@vaadin/text-field": "25.3.7", "@vaadin/button": "25.3.7", "@vaadin/popover": "25.3.7"
},
"vaadin": { "disableUsageStatistics": true }
```

```js
// web/ui.js (entry): bundle with esbuild --bundle --minify --format=esm
import '@vaadin/grid/all-imports.js';
import '@vaadin/side-nav';            // registers vaadin-side-nav and vaadin-side-nav-item
import '@vaadin/master-detail-layout';
import '@vaadin/dialog';
import '@vaadin/tabs';                // vaadin-tabs + vaadin-tab
import '@vaadin/tabsheet';
import '@vaadin/select';
import '@vaadin/combo-box';
import '@vaadin/switch';
import '@vaadin/tooltip';
import '@vaadin/badge';
import '@vaadin/breadcrumbs';         // + vaadin-breadcrumbs-item
import '@vaadin/details';
import '@vaadin/accordion';           // + vaadin-accordion-panel
import '@vaadin/notification';
import '@vaadin/progress-bar';
import '@vaadin/checkbox';
import '@vaadin/text-field';
import '@vaadin/button';
import '@vaadin/popover';
```

For the theme, copy or import `@vaadin/aura/dist/aura.css` (one file, 80 KB raw, 13 KB gzip) before our own CSS. Vaadin's
docs say "Themes should always be loaded _before_ any other styles"
([themes](https://vaadin.com/docs/latest/styling/themes)).

Without a build, for prototypes only. All of these returned HTTP 200 on 21 Nov 2026. In the files I checked, jsDelivr
rewrote internal imports to exact URLs (`@vaadin/*@25.3.7`, `lit@3.3.3`), so modules shared between packages should
load once. I did not load this recipe in a browser. It is dozens of requests and not an official Vaadin
distribution.

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@vaadin/aura@25.3.7/dist/aura.css">
<script type="module">
  import 'https://cdn.jsdelivr.net/npm/@vaadin/grid@25.3.7/all-imports.js/+esm';
  import 'https://cdn.jsdelivr.net/npm/@vaadin/side-nav@25.3.7/+esm';
  import 'https://cdn.jsdelivr.net/npm/@vaadin/master-detail-layout@25.3.7/+esm';
  import 'https://cdn.jsdelivr.net/npm/@vaadin/dialog@25.3.7/+esm';
  import 'https://cdn.jsdelivr.net/npm/@vaadin/tabs@25.3.7/+esm';
  import 'https://cdn.jsdelivr.net/npm/@vaadin/tabsheet@25.3.7/+esm';
  import 'https://cdn.jsdelivr.net/npm/@vaadin/select@25.3.7/+esm';
  import 'https://cdn.jsdelivr.net/npm/@vaadin/combo-box@25.3.7/+esm';
  import 'https://cdn.jsdelivr.net/npm/@vaadin/switch@25.3.7/+esm';
  import 'https://cdn.jsdelivr.net/npm/@vaadin/tooltip@25.3.7/+esm';
  import 'https://cdn.jsdelivr.net/npm/@vaadin/badge@25.3.7/+esm';
  import 'https://cdn.jsdelivr.net/npm/@vaadin/breadcrumbs@25.3.7/+esm';
  import 'https://cdn.jsdelivr.net/npm/@vaadin/details@25.3.7/+esm';
  import 'https://cdn.jsdelivr.net/npm/@vaadin/accordion@25.3.7/+esm';
  import 'https://cdn.jsdelivr.net/npm/@vaadin/notification@25.3.7/+esm';
  import 'https://cdn.jsdelivr.net/npm/@vaadin/progress-bar@25.3.7/+esm';
  import 'https://cdn.jsdelivr.net/npm/@vaadin/checkbox@25.3.7/+esm';
  import 'https://cdn.jsdelivr.net/npm/@vaadin/text-field@25.3.7/+esm';
  import 'https://cdn.jsdelivr.net/npm/@vaadin/button@25.3.7/+esm';
  import 'https://cdn.jsdelivr.net/npm/@vaadin/popover@25.3.7/+esm';
</script>
```

### Component map

Tag names checked against the 25.3.7 sources (`static get is()` in each package's `src/`).

| cubewarden piece | Vaadin element(s) | Notes |
|---|---|---|
| Left tree (cube, colours, archetypes, then rules and mechanics) | Primary: `vaadin-grid` (`theme="no-border no-row-borders"`) with `vaadin-grid-tree-column` for the name, a narrow column for count or value, and a column renderer for the edit `vaadin-button`. Section headings (Whole cube, Colours, Archetypes) become top-level rows. | `role="treegrid"`; Enter or F2 reaches the edit button inside a row [pkg]. Hierarchy comes from a `dataProvider` with `parentItem`, plus `expandedItems`. Keeps today's click and edit behaviour. |
| Left tree, alternative | `vaadin-side-nav` (one per section, `collapsible`, `slot="label"` for the heading) with `vaadin-side-nav-item`, children in `slot="children"`, status glyph in `slot="prefix"`, count in `slot="suffix"` | Each item is an `<a>`, and the `prefix`, default and `suffix` slots all sit inside it [pkg: `src/vaadin-side-nav-item.js` render()], so an edit button cannot live in the row. Edit would move to the drawer, the `E` shortcut or the selected rule's header. The "current" item matches `location.pathname + search`, not the hash [pkg: `component-base/src/url-utils.js`], so the scope goes in the query (`?scope=archetype:x&sel=rule:y`), clicks go through `onNavigate`, and the nav's `location` property is set after `history.pushState`. |
| Main card table | `vaadin-grid` with `vaadin-grid-selection-column` (`drag-select`), `vaadin-grid-sort-column` or `vaadin-grid-column` + `vaadin-grid-sorter`, `vaadin-grid-column-group` if needed | Row classes (hit, bad, focus) via `cellPartNameGenerator`; columns take `resizable` and `frozen`; density via `--vaadin-grid-cell-padding` and `--aura-base-size`; variants `row-stripes`, `no-border`, `no-row-borders`, `column-borders`, `wrap-cell-content` [pkg]. Selection lives in `selectedItems`. |
| Finder table (Add / Replace) | Same `vaadin-grid` | The column picker becomes `vaadin-popover` with `vaadin-checkbox` items. |
| Rule-editor drawer | `vaadin-master-detail-layout` (`force-overlay`, `overlay-containment="layout"` or `page`) | Gives the drawer, backdrop and `backdrop-click` event [pkg]. |
| Filter builder (AND/OR groups) | `vaadin-select`, `vaadin-combo-box`, `vaadin-text-field`, `vaadin-checkbox` ("Not"), `vaadin-button` | No chip element in the free set. Chips become `vaadin-badge` plus a small `vaadin-button` to remove. |
| Modals | `vaadin-dialog` (Confirm Dialog is also in the free set) | |
| Tabs, view switch (Table / Images, Workbench / Overview) | `vaadin-tabs` + `vaadin-tab`; `vaadin-tabsheet` when tabs own panels | |
| "Scaled" switch | `vaadin-switch` | |
| Tooltips | `vaadin-tooltip for="id" text="..."` | Replaces today's `title=` attributes, which keyboard users cannot reach. |
| Badges, status pills | `vaadin-badge` with `theme="success"`, `warning`, `error`, `info`, `dot`, `filled`, `primary` | Variants from `aura/src/components/badge.css` [pkg]. |
| Breadcrumb | `vaadin-breadcrumbs` + `vaadin-breadcrumbs-item` | |
| `<details>` sections | `vaadin-details`, or `vaadin-accordion` + `vaadin-accordion-panel` for one-open-at-a-time | |
| Toasts | `vaadin-notification` (`Notification.show(text, options)`) | |
| Progress ring | none | Keep the SVG ring and colour it with Aura tokens, or use `vaadin-progress-bar`. |
| Buttons | `vaadin-button` | |

### Gotchas

- **Usage statistics.** `@vaadin/vaadin-usage-statistics` (2.1.3) comes with the components. Its README says it
  collects data "only ... when the application is in development mode", and the detector treats `localhost` /
  `127.0.0.1` with unminified code as development mode [pkg: `vaadin-development-mode-detector.js`].
  `cubewarden serve` runs on localhost for every user. What I tested:
  - The default install (no postinstall run) ships the collecting module. My minified esbuild bundle then contained
    `https://tools.vaadin.com/usage-stats/submit`.
  - The opt-out works through the package's postinstall (`check.cjs`). It reads
    `"vaadin": { "disableUsageStatistics": true }` from the project `package.json` and copies
    `vaadin-usage-statistics-optout.js` (an empty function) over the main file. After that swap the bundle had no
    submit URL and was 5 KB smaller gzipped.
  - So set the flag and make sure install scripts run (or do the copy in the build). Check the built bundle for
    `usage-stats/submit` in CI.
  - jsDelivr's `+esm` build of the module strips the commented collecting code, and it contained no submit URL.
- **Shortcuts vs grid keyboard.** The grid handles arrow keys, Space, Enter and F2 itself [pkg:
  `vaadin-grid-keyboard-navigation-mixin.js`]. Our J/K, X and Backspace shortcuts must skip events that come from
  inside the grid, or move to the grid's active-item events. One exception: Backspace (and Shift+Backspace) from the
  selection column, found with `grid.getEventContext(e).column`, removes the selected cards, so the key works right
  after ticking a row's checkbox.
- **Shadow DOM.** Style through Aura tokens, `--vaadin-*` properties and `::part()`. Cell content and slotted
  inputs are light DOM, so our existing cell CSS still applies there.
- **Commercial boundary.** Grid Pro (inline cell editing), CRUD, Charts, Dashboard and Rich Text Editor need a
  subscription ([README](https://github.com/vaadin/web-components)). Nothing in the map above uses them.

## Not verified

- Vaadin's per-component WCAG results live in a Google Sheet linked from vaadin.com/accessibility; I did not read
  it, so known gaps for Grid and Side Nav are unknown.
- Web Awesome's own keyboard and screen-reader documentation per component (the tree page has none).
- Carbon tree multi-select, Carbon table virtualization (none found in the source I read), Spectrum theming,
  GOV.UK table sorting, Siemens iX accessibility.
- Bundle sizes are for the listed component set with esbuild defaults; real numbers depend on the final imports.
- Nothing was rendered. The look comparisons (Aura close to Airtable, Carbon and UI5 further away) are judgement
  from tokens and docs, not screenshots. A one-page prototype of the table and tree in Aura would settle it.
