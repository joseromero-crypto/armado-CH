# Armado CH — v2 Build Plan (relanzamiento de pruebas)

Reviewed against `index.html` @ `0449b8d` (1638 lines, working tree clean).
Companion to `armadoCHhandoff.md` — that file stays the reference for how v1 works; this one says what changes.

---

## 0. Start here (for the Claude Code session that builds this)

**What this is.** A build spec for v2 of the Calii Armado CH app, agreed in a planning session with Jose (Operations Manager, owner of the app). Nothing in it has been built. `armadoCHhandoff.md` in the same folder remains the reference for how v1 works today — read it first; this document only describes what changes.

**Repo facts** (from the handoff, verified 2026-08-28):
- Single file: `~/Desktop/armado-CH/index.html`, 1,638 lines, vanilla JS, no build step. Working tree clean at `0449b8d`.
- Supabase Storage (bucket `solcitudesarmado`, note the intentional typo) + Netlify auto-deploy from `main`.
- Local dev: `python3 -m http.server 8080` — `imagedb.json` will not load over `file://`.
- Deploy: `find .git -name "*.lock" -delete 2>/dev/null; git add . && git commit -m "…" && git push`

**Ground rules, distilled from the planning session.** These are Jose's, they came up repeatedly, and they should survive contact with implementation details:

1. **No cheap exits or skips.** No bulk actions, no one-tap shortcuts that make abandoning an item easier than the standard two taps. Speed comes from not searching, never from making quitting cheaper.
2. **The only assembler inputs are barcode and quantity.** Everything else is displayed and read.
3. **Advisory, never blocking.** Inventory lights inform; they never disable an item, auto-skip, or reorder pending rows.
4. **Never break the safety invariant.** Any assembly with ≥1 confirmed item must leave either a Supabase report or a resumable partial. Every async path must preserve this.
5. **Round 1 is sacred.** Its behaviour, its report shape and its registration step are unchanged by everything in §3.5.
6. **Measure before building.** Several features here exist to produce a number that decides whether the next feature is worth building at all. Don't skip the measuring phase to get to the interesting one.
7. **Facts, not forecasts.** Where the app estimates, it shows its arithmetic to the person reading it.

**Build order.** Seven phases in §4, each independently deployable. Phase 1 is small, self-contained and depends on nothing. Phases 4 and 5 are the valuable ones and the risky ones. Phase 5b is explicitly conditional on data from 5a.

**Before starting, check §7** — several phases are blocked or shaped by questions only Jose can answer.

---

## 1. Feature review — verdicts

| # | Feature | Verdict | Why |
|---|---|---|---|
| 1 | Coordinator PIN (`coordinator_pin.txt`) | **Keep** | One entry per session, no real cost. Security-by-obscurity, but adequate internally. |
| 2 | CSV upload per hub + `Sin pedido` badge | **Keep** | Works. |
| 3 | Suspicious-barcode detection on upload | **Keep** | Catches Sheets precision loss before it reaches the floor. Cheap, coordinator-side only. |
| 4 | Coordinator partial warning on upload | **Keep** | Prevents a new order silently orphaning an in-progress one. |
| 5 | Assembler manager (`assemblers.json`) | **Keep** | Needed for per-assembler timing — it is what makes the metrics attributable. |
| 6 | Hub select → auto-fetch latest order | **Keep** | Zero-input start. |
| 7 | Partial save / resume banner | **Keep** | Load-bearing for the safety invariant. Extended in §3.1 (session segments). |
| 8 | Save & exit (💾) | **Keep** | Extended: closes the current timing segment. |
| 9 | Inline accordion item panel | **Keep** | Fewer screen transitions than v0 detail screen. |
| 10 | Barcode scan + leading-zero bypass (`bcMatch`) | **Keep** | Core control. Not touched. |
| 11 | Barcode exception paths (UNAVAIL / WRONGSYS) | **Keep** | Considered collapsing them into one escape; rejected — WRONGSYS captures the physical code, which is the input for fixing the catalog. |
| 12 | Faltante (⚑) | **Keep, extend** | Gains a two-button sub-branch: *No se encontró* / *Fecha no cumple* — the escape hatch for a non-compliant expiry date (§2). |
| 13 | Qty input, blank by default | **Keep for v2** | Prefill deferred — see §6. |
| 14 | **Expiry date: manual DD/MM/AAAA + block on confirm** | **REMOVE** | The counterproductive one. Two extra interactions per SKU (focus, 8 digits) on every single item, to re-key data the app already computes. |
| 15 | "Sin fecha de vencimiento" bypass | **REMOVE** | Only exists to escape #14. |
| 16 | Per-item `confirmedAt` + per-item `assembler` | **Keep — now foundational** | Already half the timing instrumentation. |
| 17 | Report upload with visible status + retry | **Keep, extend** | Gains a third state: queued offline (§3.6). |
| 18 | `exitKeepingPartial()` safety invariant | **Keep — do not break** | Every assembly with ≥1 confirmed item leaves either a report or a resumable partial. The outbox must preserve this. |
| 19 | localStorage history (`calii_order_history`) | **Keep** | Silent belt-and-braces. |
| 20 | Image DB lookup | **Keep** | Visual confirmation is faster than reading a name. |
| 21 | `screen-detail` (orphan HTML) | **REMOVE** | Dead since the accordion refactor; no navigation reaches it. |
| 22 | `orderPath()` | **Verify, remove if dead** | Uploads use date-stamped paths built elsewhere. Confirm before deleting. |
| 23 | `Inventario hub saliente` shown as "Inv. CH" tag | **Keep, reinterpret** | Today it reads as available stock. It is a global CH snapshot that ignores every other hub's request — the root of §3.4. |

Net: two removals that touch the assembler's hands (#14, #15), one dead-code removal, everything else preserved.

---

## 2. Change: expiry date becomes read-only

**Rule:** the only assembler inputs are **barcode** and **piezas**. The minimum acceptable expiry date is displayed, never typed, never validated, never blocking.

### Remove
- `exp-date-field` input, `exp-msg`, `.exp-input` / `.exp-ok` / `.exp-err` CSS
- "Sin fecha de vencimiento" button
- `formatExpDateInput()`, `markNoExpDate()`, `resetExpDate()`
- the entire expiry block in `confirmItem()` (the `if(result.expDate!=='N/A'){…}` stanza)
- `expDate` from the result object and from `refreshDetailPanel()`'s value preservation
- the `· Venc: …` note in `showSummary()`'s item rows

### Keep and repurpose
- `computeMinExpDate(item)` and `formatMinExpDate(d)` — unchanged logic, now display-only.
- In `buildDetailPanelHtml()`, replace the whole expiry `d-section` with a **single high-contrast banner placed directly above the qty input** (last thing read before picking):

```
📅  Vencimiento mínimo: 15/09/2026
    No armar producto con fecha anterior
```

  - Amber background, not a status pill — it must not look like something already resolved.
  - When `computeMinExpDate` returns null (no shelf-life columns in the CSV): render nothing. No empty placeholder.
- Also surface it **in the list row** as a compact `📅 15/09` chip, so the date is visible while walking to the position, before the panel is even opened.

### Escape hatch — ⚑ Faltante gains a sub-branch
If the physical product does not meet the minimum date, the correct action is not to send it. That is a *different fact* from "no había producto" and must not collapse into the same report state.

Tapping **⚑ Faltante** no longer resolves the item immediately. It replaces the action row with a two-button branch:

```
 ¿Por qué no se arma?
 [ 📭 No se encontró ]   [ 📅 Fecha no cumple ]   [ ← ]
```

- Two taps for a skip, still zero typing. The common path (confirm) is untouched at one tap.
- `markFaltante(reason)` takes `'notfound' | 'shortdate'`.

**Statuses:** keep `ITEM_STATUS.SKIPPED = 'skipped'` for *no se encontró* — existing reports and any in-flight partials stay readable. Add `ITEM_STATUS.SHORTDATE = 'shortdate'`.

| Status | Row icon | Estado in CSV |
|---|---|---|
| `skipped` | ❌ | `Faltante` |
| `shortdate` | 📅 | `Faltante (fecha corta)` |

Both count as skipped everywhere they are aggregated (progress bar, summary "faltantes" tile, `pctCompleto`), but they are counted separately in the metrics payload as `faltantes` and `fechaCorta`. Add `shortdate` to the ❓ legend, and to the icon maps in `renderList()`, `updateListRow()` and `showSummary()` — four places, easy to miss one.

`fechaCorta` per hub over time is worth watching on its own: it is a shelf-life quality signal about what the CH is receiving, not about the assembler.

### Report CSV impact
- Column `Fecha vencimiento` → renamed **`Vencimiento mínimo`**, populated with the computed minimum that was displayed (blank when none).
- This keeps traceability of *what rule was in force per item* without an input. Accept the trade: the report no longer records what was physically on the box.

---

## 3. Additions

### 3.1 Timing instrumentation

**Per-item** (new fields on each result object):
| Field | Set where | Meaning |
|---|---|---|
| `openedAt` | `openDetail()` — every open, overwrites | Start of the current handling attempt |
| `firstOpenedAt` | `openDetail()` — first open only | For touch analysis |
| `touches` | `openDetail()` — increment | How many times the item was opened before it resolved |
| `handleSec` | `confirmItem()` / `markFaltante()` | `round((confirmedAt − openedAt)/1000)`, capped at `MAX_HANDLE_SEC` (default **300**) so an item left open during a break doesn't poison the median |
| `bcAttempts` | `onBCInput()` — increment on mismatch | Scan friction signal |

**Per-session** (new on `S`):
```js
S.segments = []   // [{ start: ISO, end: ISO|null, assembler: string }]
```
- Push a new open segment in `startAssembly()` and in `resumePartialSave()`.
- Close the open segment (`end = now`) in `saveAndExit()`, `showSummary()`, `exitKeepingPartial()`.
- `segments` is persisted inside the partial payload, so a resumed order carries its full history and the overnight gap is never counted.

**Derived metrics** (`computeOrderMetrics(items, results, segments, hub)`):
- `minutosReloj` — sum of segment durations (wall-clock, break-inclusive)
- `minutosActivos` — same, minus every inter-item gap longer than `IDLE_GAP_MIN` (default **5** min). Both are reported; do not collapse them into one number.
- `skusArmados` — results with status ≠ pending
- `skusHrReloj`, `skusHrActivo`
- `segMedianoPorSku` — median `handleSec`
- `faltantes`, `fechaCorta`, `parciales`, `pctCompleto`
- `porArmador[]` — `{ armador, skus, minutosActivos, skusHr }`, splitting on the per-item `assembler` field that already exists
- `flags[]` — see §3.3

Constants at the top of the script, commented as tunable: `IDLE_GAP_MIN = 5`, `MAX_HANDLE_SEC = 300`.

**Persistence** — one sidecar per assembly, written alongside the report:
```
metrics/{hub-slug}/{same stem as the report csv}.json
```
Payload: `{ v:2, hub, fecha, armadores[], orderDate, skusTotal, skusArmados, minutosReloj, minutosActivos, skusHrReloj, skusHrActivo, segMedianoPorSku, faltantes, fechaCorta, parciales, pctCompleto, porArmador[], flags[], segments[], generatedAt }`

`segments[]` is carried into the payload verbatim so an irregular assembly can be inspected after the fact without re-deriving it.

Sidecar rather than parsing report CSVs: the metrics screen must open in one round-trip per new assembly, not download every report ever written.

**Report CSV** gains one column: `Segundos en producto` (`handleSec`, blank for pending). Cheap, and it is the raw data behind the median.

**Order of operations in `showSummary()`** — must not weaken the safety invariant:
1. upload report CSV → on success `clearPartialSave()` (unchanged)
2. *then* upload metrics JSON, **fire-and-forget through the outbox**
3. a failed metrics upload never disables `Terminar armado` and never shows an error to the assembler

### 3.2 Coordinator metrics screen

New `screen-metrics`, reached from a button in the coordinator header. **A table, not a dashboard** — no charts, no KPI cards.

One row per completed assembly:

`⚑ · Fecha · Hub · Armador(es) · SKUs · Min reloj · Min activos · SKUs/hr · Faltantes · Fecha corta · % completo · Seg/SKU`

- **`⚑` column** — the irregularity flags from §3.3, as icons with a tooltip/tap for the full text. Flagged rows get a subtle amber left border. **Never hidden, never dropped.**
- **Filters** (a single row of controls above the table): Armador (select), Hub (select), Periodo (7 / 30 / 90 días / todo), and a `Solo irregulares` toggle (off by default — it *narrows to* flagged rows for inspection, it never removes them from the default view). Filters combine.
- **Sort**: click any column header to sort, click again to reverse. Default `Fecha` desc. SKUs desc is one click away — that is the "de más a menos SKUs" view.
- **Footer row**: totals for SKUs and minutes, weighted average SKUs/hr (total SKUs ÷ total hours — *not* the mean of the rates).
- **⬇ Descargar CSV**: exports exactly the current filtered + sorted view, same columns plus a `Flags` column (semicolon-separated codes) and a `Regular` column (`Sí`/`No`), BOM prefixed, filename `metricas_armado_{YYYY-MM-DD}.csv`. The flag codes travel with the data so filtering happens in the sheet too.
- No manual/baseline data anywhere in this screen — comparison happens outside the app.

**Loading**: `sbList('metrics/{hub-slug}/')` for each hub, then fetch each JSON in parallel batches of 8. Metrics files are immutable, so cache each parsed payload in localStorage under `calii_metrics_cache` keyed by path and only fetch paths not already cached. Coordinator sees a `↺` to force a full refetch.

### 3.3 Irregular assembly flags

**Nothing is ever excluded.** Every assembly appears in the table and in the export; the irregular ones are marked so you can see *why* a number looks odd instead of quietly losing it. Computed in `computeOrderMetrics()` and stored in `flags[]`.

| Code | Icon | Condition | Default threshold |
|---|---|---|---|
| `CRUZA_DIA` | 🌙 | First and last activity fall on different calendar dates | — |
| `MULTI_SESION` | ⏸ | More than one segment (someone used 💾 Guardar y salir) | — |
| `PAUSA_LARGA` | 🕐 | Any gap between consecutive item actions exceeds the threshold | **15 min** (`FLAG_GAP_MIN`) |
| `MULTI_ARMADOR` | 👥 | More than one distinct `assembler` across the results | — |
| `PEDIDO_CHICO` | 🔹 | Fewer SKUs than the threshold — small orders have unstable rates | **10 SKUs** (`FLAG_MIN_SKUS`) |
| `INCOMPLETO` | ⏳ | Finished with items still `pending` | — |
| `REPORTE_DIFERIDO` | 📶 | Report was queued offline and uploaded later — wall-clock end time is the *finish* time, not the upload time, but worth knowing | — |
| `SIN_TIEMPO` | ⛔ | `minutosReloj` ≤ 0 or missing (v1 report, or a data bug) — the row's rate columns are meaningless | — |

All thresholds are constants at the top of the script, commented as tunable, and distinct from `IDLE_GAP_MIN` (5 min, which *subtracts* idle time). `FLAG_GAP_MIN` (15 min) only *labels* the assembly. Two different jobs, two different numbers — do not merge them.

`CRUZA_DIA` and `MULTI_SESION` will co-occur most of the time; that is fine, both are true and each answers a different question.

**Footer aggregates ignore rows flagged `SIN_TIEMPO`** (they would divide by zero) but count every other flagged row. If any row is excluded from the footer, say so in the footer text — never silently.

### 3.4 Semáforo de inventario (cross-hub contention)

**Problem.** `Inventario hub saliente` is a global CH snapshot taken when the file was downloaded. Every hub sees the same 15 units. Contry asks 5, Cumbres 6, San Nicolás 8, Guadalupe 5, Avícola 5 — 29 against 15. Stock does not decrement when an assembly finishes; it decrements when the system registers it, which lands in the *next* download. So four of five assemblers hunt for something already gone, at roughly 5 minutes each.

#### Scope — one warehouse, no grouping needed
**Every hub is assembled from CH Guadalupe.** Contry, Cumbres, Guadalupe, San Nicolás and Avícola (Saltillo, but operationally treated as a Monterrey hub) are same-day inner-city deliveries; Condesa and Zapopan are larger weekly orders shipped out. All seven draw from the same physical stock, so **all seven contend with each other** and the check runs across the whole hub list.

Keep the map in the code anyway, one line, all hubs pointing at `'CH-GDLP'` — if a second CH ever opens, the logic doesn't have to be rewritten. Note the operational consequence: a Condesa or Zapopan week is a demand spike against the same shelf, so contention is worst on those days and the coordinator view (below) matters most then.

#### Design decision: the light reports facts, it does not allocate

The earlier draft ranked hubs by upload order and pre-committed stock to whoever was first. Jose's objection kills it, and correctly: *"this means prioritizing one hub over another and we don't have any real priority. If it's purely based on who got uploaded first, the first file will probably have a 100 % fill rate and the last a very poor one."*

That is exactly what would happen, and worse, the app would be the thing causing it. Forecasting who *will* take the stock is an allocation policy wearing a traffic light's clothes, and it needs a business rule nobody has.

**So the forecast is dropped. The light is computed only from what has actually been picked.**

```
disponible(s) = inventario(s) − consumido(s)

consumido(s)  = Σ picked(s) today across all hubs except this one,
                from finished reports AND in-progress assemblies
```

| Light | Condition | What it means |
|---|---|---|
| 🟢 | `disponible ≥ solicitado` | Nobody has taken enough to affect you. **Show nothing.** |
| 🟡 | `0 < disponible < solicitado` | "Otros hubs ya armaron N — puede que solo encuentres ~M" |
| 🔴 | `disponible ≤ 0` | "Ya se armó todo el inventario — probablemente ya no hay" |

Why this resolves the fairness problem rather than dodging it:

- **It is an observation, not a prediction.** "11 of 15 were already assembled today" is a fact. Facts need no priority policy and nobody argues with them.
- **Fairness stays physical.** Whoever reaches the shelf first takes it — exactly as today. The app never tells hub 5 to stand down in favour of hub 1; it only tells hub 5 what is already gone once it is actually gone.
- **Everything starts green**, as Jose put it, and only degrades as real picks land. No hub is ever penalised for the order its file arrived in.
- **The information that was in the forecast is not lost — it moves to where it is actionable.** "5 hubs want 29 against 15" is useless to an assembler (they can't rebalance anything) and valuable to the coordinator (who can). See the coordinator section below.

*Optional, low-risk:* on a SKU where same-day demand exceeds stock, add a neutral grey line **inside the item panel only** — `ⓘ 5 hubs pidieron 29 · inventario 15` — with no colour and no chip on the row. Information without instruction. Drop it if it proves to be noise.

#### Two kinds of red — only one of them is trustworthy

The earlier draft let a single assembler's "no está" turn a SKU red for everyone. Jose's objection stands and the design was wrong: *"I don't trust one assembler's ability to block everyone from assembling… if we give them wings to skip an item or two they will do it."*

That points at a distinction the earlier draft collapsed:

| | **Red by arithmetic** | **Red by testimony** |
|---|---|---|
| Basis | System said 15, and 15 units were confirmed picked — each barcode-scanned | One person looked and didn't see it |
| Depends on | Nothing but data captured under control | That person's diligence that minute |
| Can be gamed | No | Yes, trivially |
| **Verdict** | **🔴 — don't start** | **Never 🔴. At 3 reports, 🟡** |

#### What each colour instructs

The colours are not severity grades, they are three different instructions:

| Light | Condition | Instruction to the assembler |
|---|---|---|
| 🟢 (no chip) | `disponible ≥ solicitado` | Normal. Search as always. |
| 🟡 | `0 < disponible < solicitado`, **or** 3+ assemblers reported not finding it | **Búscalo, y si no está a la vista marca faltante y sigue.** Start, quit early. |
| 🔴 | `disponible ≤ 0` — arithmetic only | **No lo busques.** The stock that existed has been picked and scanned by other hubs. Mark faltante and move on. |

Red is the only case where the app tells someone *not to start*, and it earns that because it is arithmetic, not opinion: every unit it counts was scanned and confirmed by a person who then had to enter a quantity. Testimony never reaches that bar, so it tops out at yellow — start, but don't sink five minutes into it.

`FLAG_NOTFOUND_MIN` (default **3**) is the testimony threshold, tunable at the top of the file. Below 3, nothing is shown at all.

#### When a skip is contradicted

If Rangel marks *no se encontró* and Daniel later confirms a pick on that same SKU, one of two things happened: stock arrived, or Rangel didn't look hard enough. Both are worth surfacing, and the second is the single best skip-abuse detector available.

**In-app, for the assembler who skipped it** — no push notification, no pop-up. Interrupting someone mid-pick to send them walking backwards is worse than the item is worth. Instead:
- The skipped row gains a **🔁 chip** and a `revisar` sub-state (still counted as faltante everywhere; this is a hint, not a status change).
- Those rows **move to a collapsed section at the bottom of the list**, `🔁 2 por revisar`, sorted by position within it. They are already resolved, so they are no longer part of the forward walking route — grouping them is right precisely because acting on them means a second sweep, and the section shows each one's position for that.
- The list header shows a `🔁 2` chip that scrolls to the section. Pending items never move; only resolved-and-contradicted ones collect there.
- If they still have the order open, they can go back and pick it. If they've finished, nothing happens and nothing is lost.

**For Jose** — `faltantesDesmentidos` in the metrics: skips that another assembler contradicted the same day. This is stronger evidence than `faltantesRapidos`, because a colleague physically found the thing. One or two a week is noise. A pattern on one name is a conversation.

#### Making skip behaviour visible instead of trusting it away

Three fields, no new UI, all free once §3.1 exists:

- **`luzAlSkip`** — what colour the item was showing at the moment of the faltante (`verde` / `amarillo` / `rojo` / `sin_dato`). Recorded automatically; nobody presses anything. Skips clustering on green items is the signal.
- **`faltantesRapidos`** — faltantes marked under `MIN_SEARCH_SEC` (default **10 s**) after the item was opened. A real search takes longer.
- **`faltantesDesmentidos`** — as above.

All three roll into the metrics payload and get a column in the coordinator table. **No bulk skips, no shortcut buttons, anywhere in the app** — per Jose: *"I don't like cheap exits or skips."* Every skip costs the same two taps through ⚑ Faltante regardless of the light.

#### Live means live — every pick, not every finish

Jose's condition: *"updated every time someone picks an item"*, not when an assembly finishes. The `picks` table below delivers exactly that: **one row per confirm**. The moment Daniel confirms 15 units the row exists.

**How the other phones find out — plain version.** Two ways a phone can learn something changed on the server:

- **Polling** — the phone asks, on a timer: *"anything new since 10:04:15?"* Almost always the answer is "no", which costs a few hundred bytes. Every 15 seconds, all day.
- **A socket (websocket)** — the phone opens one permanent connection and the server pushes changes down it the instant they happen. Faster, and no repeated asking.

A socket sounds strictly better, and in an office it is. In a warehouse it has one nasty failure: **when wifi drops, the connection dies silently.** The phone doesn't get an error — it just stops receiving, and every light freezes on whatever colour it last saw. The assembler is looking at a screen that appears live and is twenty minutes stale, which is worse than no feature at all. Polling can't fail that way: a missed question is simply asked again ten seconds later, and the next answer includes everything missed in between.

So: **poll every 10 s while the list screen is open** (`POLL_MS`, tunable down to 5 s — an empty incremental answer is a few hundred bytes, so the cost of halving it is negligible), plus immediately after the assembler's own confirm, on order load, and on a manual ↺. The query only asks for rows newer than the last one seen, so a typical answer is empty. Sockets stay available as a later speed-up layered *on top* of the poll, never replacing it.

**Never re-render a panel the assembler has open.** Lights refresh on list rows and on next open — a colour changing under someone's thumb mid-scan is how you get a mis-pick.

#### Where the numbers live — a `picks` table

Computing consumption by parsing every report CSV and partial JSON on a phone is the wrong shape: N fetches, N parses, on bad wifi, per assembler — and it could never be live per pick. One Postgres table in the Supabase project that already exists:

```sql
create table picks (
  id           bigserial primary key,
  fecha        date not null,
  hub          text not null,
  ronda        int  not null default 1,   -- see §3.5
  sku_key      text not null,             -- cleanBC(barcode) or norm:<normName>
  producto     text,
  unidad       text,                      -- 'Kg' | 'Pz'
  cantidad     numeric not null,          -- 0 for a faltante
  senal        text,                      -- null | 'no_encontrado' | 'fecha_corta'
  luz          text,                      -- light shown at the moment of the action
  seg_busqueda int,                       -- handleSec, feeds faltantesRapidos
  armador      text,
  order_date   date,
  ts           timestamptz default now()
);
create index on picks (fecha, ts);
create index on picks (fecha, sku_key);
```
Policies: `INSERT` + `SELECT` for `anon` — the same posture as the existing public bucket and the anon key already in the JS. No new risk category.

- One row per confirm / faltante, fire-and-forget through the outbox (§3.6), so an offline phone doesn't lose picks.
- Also the raw log behind both coordinator views, and the foundation v3 parallel picking needs.

#### Join key and data hazards
- **Key = cleaned barcode** (`cleanBC`). No barcode → `norm:<normName(Producto)>`, flagged `confianza:'nombre'`; those may raise 🟡 but never 🔴. A false name-join producing a red is worse than a missed warning.
- **Kg vs Pz**: aggregate only within the same unit. Same SKU as Kg in one order and Pz in another → skip the check for that SKU and log it. Never convert.
- **Inventory disagreement between files**: use the most recent upload's value; surface a large spread to the coordinator, since it means a download is stale.
- **Missing or unreachable data → no lights at all.** Assembly runs exactly as v1. Never load-bearing.

#### Nothing gets reordered
A red item keeps its place in the list. Position sort is the walking route; moving contested items to the bottom means walking it twice for anyone who does look. The light changes how long you spend at a position, never which positions you visit or in what order.

#### What the assembler sees
- **List row**: 🟡 or 🔴 chip beside the quantity. **Green shows nothing** — marking the 90 % that is fine trains everyone to ignore colour.
- **Item panel**, above the qty input:
  ```
  🔴 Ya no hay — no lo busques
     Inventario CH 15 · otros hubs ya armaron 15 hoy · 10:04
  ```
  ```
  🟡 Puede que ya no haya
     Inventario CH 15 · otros hubs ya armaron 12 hoy · pediste 5
     Búscalo, y si no está a la vista marca faltante y sigue
  ```
  ```
  🟡 3 armadores no lo encontraron hoy
     Búscalo, y si no está a la vista marca faltante y sigue
  ```
  Showing the arithmetic is what makes it trusted — a bare coloured dot gets ignored the first time someone finds the product anyway.

#### Measure whether the light is telling the truth
`rojosEncontrados`, `rojosNoEncontrados`, `verdesNoEncontrados`, plus the three skip-behaviour fields above.

- High `rojosEncontrados` → the light is too pessimistic and people are being told to give up on real product. The dangerous failure, invisible without the counter. (Note it can only be non-zero if someone ignores a red and searches anyway — which is exactly why red must never disable the item.)
- `verdesNoEncontrados` → consumption the app cannot see: sales, merma, transfers, miscounts.

Review after week one before tuning anything.

#### Coordinator views
Two sections, both nearly free once `picks` exists:

> **⚠️ Conflictos de inventario — hoy**
> `Leche Lala 1L · Inv 15 · pedido 29 en 5 hubs · faltan 14` — sorted by shortfall
>
> **📭 Faltantes de hoy**
> `Leche Lala 1L · 3 hubs · faltaron 11 pz · 1 desmentido` — every SKU that went unassembled, aggregated across hubs, split by reason (no encontrado / fecha corta / sin inventario)

The first lets you cut Avícola's request from 5 to 1 *before* anyone walks the floor. Warning the assembler saves 5 minutes; fixing the request saves the trip.

#### Deferred
- **Suggested per-hub allocation** ("te tocan 3 de 5") — out. Invites confirming a quantity nobody counted.
- **Websocket / Supabase Realtime** — as a speed layer over the poll, never the source of truth.
- **Retool live inventory** — the real fix, when read-only access lands. Everything above degrades into it cleanly: swap the `inventario` term for the live number, delete nothing else.

### 3.5 Reserva y segunda ronda (items filtered out for zero stock)

**The fact that changes this:** the coordinator filters zero-inventory SKUs out *before* downloading. A request of 800+ SKUs can reach the app as ~100. Everything the assembler never sees is invisible to the app too — which is why `verdesNoEncontrados` was the wrong instrument for measuring mid-assembly arrivals. The number that matters is **how many filtered-out SKUs have stock by the end of the day**, and today nobody knows it.

**The second fact, which makes the fix practical:** assembly runs a day ahead. Monday's work leaves Tuesday morning. A supplementary list generated at 17:00 has a whole evening to be assembled.

#### The order file — verified against a real unfiltered export

Sample analysed: 287 rows × 30 columns. **This is what will be uploaded once pre-filtering stops.**

| | Count | Share |
|---|---|---|
| Rows requested (`Solicitud (kg/pz) > 0`) | 287 | 100 % |
| **activos** — `Inventario hub saliente > 0` | **112** | 39 % |
| **reserva** — `Inventario hub saliente = 0` | **175** | **61 %** |

**Six out of ten requested SKUs never reach an assembler today.** That is the pool Phase 5a measures against, and it is far larger than the earlier "800 → 100" estimate implied in proportion. How many of those 175 acquire stock during the day is exactly the unknown, but the upper bound is much bigger than assumed — which raises the expected value of §3.5 and is an argument for running 5a early.

Column notes for the build:
- `Solicitud (kg/pz)` — request. Non-zero on all 287 rows, so v1's `Solicitud > 0` filter removes nothing here; **`Inventario hub saliente == 0` is the operative split.**
- `Vida anaquel usuarios (min. fecha)` — `Sep-11` (239) / `Sep-4` (48). Short English-abbreviation format, which `computeMinExpDate` already handles. **Round-2 files re-emit these verbatim, so no new parsing anywhere.**
- `Kg/Pz` — 285 `Pz`, 2 blank. No `Kg` rows.
- `Código de barras` — 3 blank, **0 duplicates, 0 corrupted** in this export. Name fallback still needed for the 3.
- `Posición armado` — blank on 18 rows (6 %); existing `parsePos` fallback sorts them last.
- **No `sku` column** — confirms the join stays barcode-primary, product-name-secondary.
- `SKU proveedor` populated on 230 of 287 — not unique enough to be a key, but useful for display.

##### The order file is also the registration form
`Salida (kg/pz)`, `Faltante`, `Envío - Solicitud (#)` and `Nro. de unidades` exist as columns and are **empty on all 287 rows**. These are the fields somebody fills in after assembly — which is why the round-2 report below names its total column `Salida (kg/pz)`, matching the system's own wording rather than inventing one.

This also raises a question worth asking (§7): if registration means typing into those fields, the app could emit the **original order rows with `Salida (kg/pz)` and `Faltante` already filled in** — turning registration from row-by-row typing into a paste or an upload. Potentially a bigger time saving than anything on the assembly side. Not specced here because it depends on how registration is actually performed.

#### The inventory file — verified against a real export

Sample analysed: 3,827 rows × 46 columns (*Registro de inventario*, direct Retool CSV export).

| Column | Use | Notes from the sample |
|---|---|---|
| `Final [AUTO]` | **the inventory number** | Clean: 3,827/3,827 numeric, no blanks, no negatives. **1,908 rows > 0, 1,919 at exactly 0** — half the catalogue sits at zero, consistent with a request of 800 arriving as ~100 |
| `Código de barras` | **primary join key** | 65 blank, 3 duplicated, 7 ending in 3+ zeros |
| `Producto` | **secondary join key** + display | |
| `Recepción` | why it changed | >0 on 49 rows — labels a revived SKU *"llegó mercancía"* versus a stock correction |
| `Kg / Pz` | unit | ⚠️ note the spaces — the order CSV uses `Kg/Pz` |
| `Posición armado` | display only | 228 blank |

**Only two things are strictly required: a key and `Final [AUTO]`.**

##### Join key — barcode first, product name second
`sku` is unique in this file but cannot be relied on to exist in the order export, so it is not the key. Per Jose: **barcode and product name are the strongest cross-references.** So:

1. `cleanBC(Código de barras)` when present and unambiguous;
2. `normName(Producto)` when the barcode is blank (65 rows here) **or duplicated** (3 rows) — the name disambiguates the duplicates rather than forcing them to be dropped.

A row that matches on neither is reported as `sin coincidencia`, never silently treated as zero stock.

##### Barcode corruption stays a real defence
The detector keeps its job. This export is clean because it came straight out of Retool, but the order file passes through other people's hands and other people's spreadsheet settings on the way — which is where the precision loss happens. Jose's own machine isn't the risk; the process around it is.

##### Expiry dates need no new code
Round-2 orders are **re-emitted from the stored original request rows**, in the original order-CSV format, `May-15` and all. `computeMinExpDate` is never asked to parse the inventory file's ISO timestamps, and nothing about the current date handling is touched. This is the whole reason for storing full rows rather than a reduced projection — see below.

#### What gets stored at upload

On upload, the coordinator's file splits into **activos** (`Inventario hub saliente > 0`) and **reserva** (zero). But rather than persisting a reduced reserva record, store the **entire original request, rows verbatim**:

```
pedido_completo/{hub-slug}/{orderDate}.json   →  { orderDate, hub, uploadedAt, rows: [ ...raw CSV row objects... ] }
```

Round-2 generation then re-emits selected rows with the same headers the app already knows how to read and write. No second parser, no format branch, no risk of a generated file behaving differently from an uploaded one. `no_surtido_{hub}_{fecha}.csv` is exported for the coordinator from the same data.

**Assemblers never see reserva rows.** Not greyed out, not collapsed at the bottom, not present. They cannot be skipped because they cannot be seen, and the walking route is identical to today's.

#### Round 2 covers the outstanding balance, not just the reserva ⚠️ CORRECTION

Jose's question — *"if an item requested 10 and had 5 inventory and later received 30 pieces, do we add it as well?"* — breaks the design I wrote. That item was **not** in the reserva. It was an activo, it was presented, the assembler picked 5 of 10, and the hub is still 5 short. A reserva-only round 2 misses it entirely.

**So the rule generalises, and gets simpler:**

> A SKU joins round 2 when **`solicitado − armado_hasta_ahora > 0`** and **`Final [AUTO] > 0`** in the closing inventory.
> The quantity requested is the **outstanding balance**, not the original amount.

| Round-1 outcome | Solicitado | Armado | Round-2 line |
|---|---|---|---|
| Reserva (never shown, 0 stock) | 10 | 0 | **10** |
| Partial fill | 10 | 5 | **5** |
| Faltante — no se encontró | 10 | 0 | **10** |
| Faltante — fecha corta | 10 | 0 | **10** (new stock may carry better dates) |
| Complete | 10 | 10 | — not a candidate |

The reserva is simply the subset where `armado = 0` because nobody was ever shown the row. One rule, one query, and it catches the case that would otherwise have been found in production by a hub arriving short.

**Not capping by inventory stands** — per Jose, always ask for what is outstanding; if there isn't enough, it gets logged manually. Netting out what was already assembled is a different thing and is not optional: re-requesting 10 when 5 are already in the box would have someone assemble them twice.

**Availability in round 2 works exactly as in round 1** — green for everyone until someone picks, the §3.4 arithmetic doing the rest. No second allocation rule. As Jose puts it: if new stock arrived, there is probably enough for everyone.

#### ⚠️ The cross-check compares against NEW stock, never against the level

**Jose's warning, confirmed by the export.** At cross-check time the assembled pieces have not been discounted yet, so `Final [AUTO]` still counts product that is already sitting in a box.

The sample file proves it. The identity holds on **3,826 of 3,827 rows**:

```
Final [AUTO] = Inv. día anterior + Recepción + Compra − Envío − Salida − Merma
```

and in that export **`Envío` and `Salida` are zero on every single row**. Assembly outflow is not in `Final [AUTO]` at all. A naive `Final [AUTO] > 0` test would revive items whose only "stock" is the units an assembler already picked — sending someone to hunt for product that is physically in a box three metres away. That is the exact failure this whole feature exists to prevent, reintroduced at the other end.

The file also shows the case we are looking for, cleanly:

> `Bebida de jamaica sin azúcar lata Zobo` — `Inv. día anterior = 0`, `Recepción = 72`, `Final [AUTO] = 72`, `Actualización recepción = 12:08:50`

Zero at the start of the day, 72 arrived at midday. That is a round-2 candidate, and it is identifiable without touching the level.

##### Two candidate classes

**Class A — reserva revival.** `Inventario hub saliente = 0` in the morning order file, `Final [AUTO] > 0` now.
Safe to test on the level, because nothing could have been assembled from it — the row was never shown to anyone, so no undiscounted assembly can be inflating the number.

**Class B — shortfall restock.** The item was an activo, `pendiente = solicitado − armado > 0`, and **`Recepción > 0` with `Actualización recepción` later than the order file's download**.
Here the level is untrustworthy, so require an actual reception *event*. `Recepción` is a direct statement that units arrived; the level is a residue of six other movements.

**Never use `Final [AUTO] − Inventario apertura` as the test.** It conflates receipts with sales and merma, and the moment `Envío`/`Salida` start being populated — the columns exist, they are simply unused today — it breaks silently in the direction that costs walking time.

##### `Recepción` resets daily — confirmed
Jose has confirmed the daily reset, so a non-zero `Recepción` in the closing file means *received today*.

**The timestamp filter is still required.** In the sample, most receptions land at 07:34 and one at 12:08 — so a same-day reception can easily predate the order download, in which case its stock is already counted in `Inventario hub saliente` and the item is not a new candidate. Class B therefore tests **`Actualización recepción` later than the order file's upload time**, not merely `Recepción > 0`. The column is populated on 49 of 49 reception rows, so the filter is always available.

#### The coordinator screen

A new section, below *Cargar pedidos*:

> **🔄 Inventario de cierre**
> `[ Subir registro de inventario ]`  ·  last upload: *28/08 17:04*
> `[ Revisar inventario nuevo vs pendientes ]`

Pressing **Revisar** evaluates the two candidate classes above against every hub's outstanding balance for the current `orderDate`:

```
Inventario nuevo vs pendientes — 28/08 17:04

  MH Contry ........... 13 SKUs con inventario nuevo   [ Ver ]  [ Generar complemento ]
  MH Cumbres ..........  2 SKUs con inventario nuevo   [ Ver ]  [ Generar complemento ]
  MH Guadalupe ........  0
  MH San Nicolás ......  7 SKUs con inventario nuevo   [ Ver ]  [ Generar complemento ]
  MH Avícola ..........  0
  ─────────────────────────────────────────────
  22 SKUs en 3 hubs · 9 con recepción registrada hoy

  [ Generar todos los complementos ]        [ Cerrar ]
```

- **Ver** expands the list: producto, pendiente (solicitado − armado), `Recepción` today with its timestamp, `Final [AUTO]` now, posición, class (`A reserva` / `B recepción`) and origin (`reserva` / `parcial` / `faltante`).
- **Generation is explicit, never automatic.** Review, then press.
- Generating writes `orders/{hub-slug}/{fecha}-r2.csv` and it appears to the assembler as **Complemento** in the setup screen — a normal order in every other respect.
- A hub with an unfinished round 1 has its button disabled with the reason shown; finish round 1 first, or the two collide on the same hub.
- Re-running *Revisar* after generating is idempotent — already-generated SKUs drop out.
- The inventory export is ~1 MB / 3,800 rows. Parse it coordinator-side only; never send it to a phone.

#### Registering it downstream — R1 unchanged, R2 reports a cumulative total

**Settled:** registration happens **as soon as round 1 finishes**. So round 1 changes in no way at all — same report, same filename, same registration step, same habit. Nothing about the existing flow is touched, which is the safest possible posture for a feature whose frequency is still unknown.

**Settled:** the system's `Salida` field holds a **cumulative total, typed by hand**. Per Jose: *"if in R1 they typed 3 and round 2 they have to add 4, they must type 7, not 4."*

That kills my earlier "round-2 report contains only round-2 quantities" design — it would hand the registrar a 4 when the field needs a 7, and the subtraction-in-reverse would be done in someone's head at the end of a long day.

**The round-2 report therefore carries three quantity columns:**

| Column | Value | Purpose |
|---|---|---|
| `Armado en la mañana` | R1 quantity for that SKU | Lets the registrar sanity-check against what they already typed |
| `Armado complemento` | R2 quantity | What this round added |
| **`Salida (kg/pz)`** | **R1 + R2** | **The number they type.** Named to match the system's own field |

```
reports/{hub-slug}/{fecha}_r2_{HH-MM}_{Armadores}.csv
# COMPLEMENTO — capturar "Salida (kg/pz)", ya incluye lo armado en la mañana
```

- Only SKUs touched in round 2 appear. Untouched SKUs are already registered correctly and must not be restated.
- The round-1 report stays in Supabase untouched.
- In the coordinator list, round-2 reports are shown indented under their round-1 sibling for the same hub and date, so the relationship is visible.

**Consolidated R1+R2 report → deferred.** It would only be right if registration moved to once-before-dispatch. Reasoning recorded in §6.

#### It measures itself from day one
Even with generation switched off, this produces the number Jose does not currently have. From the sample export, the pool is **175 zero-stock SKUs out of 287 requested** for one hub on one day. What 5a reports is how many of those acquire stock before the closing snapshot:

> *"of 175 SKUs filtered out this morning, 22 had stock by 17:00."*

If it is 2, drop 5b and keep `no_surtido` for reordering. If it is 40, it is the highest-value feature in the app. Either way the answer arrives in two weeks with no risk to round 1.

#### Handling notes
- Keep one real inventory export in the repo as a test fixture — **untracked**, in `.gitignore`. It is live business data and the repo pushes to GitHub.
- `Faltante armador` in the inventory file is out of scope — that column belongs to a different part of the operation. Ignore it.

#### Deferred
- **Scheduled/automatic round-2 generation** — v2 has a button. Automate once the frequency is known.
- **Reserva rows in the outgoing report** — would tell the receiving hub what it asked for and didn't get, but it changes a file other people consume. Separate `no_surtido` CSV for now.
- **Consolidated R1+R2 report** — only correct if registration ever moves to once-before-dispatch. Today R1 is registered immediately, so a consolidated file would double-count.

### 3.6 Offline resilience

**Outbox** — `calii_outbox` in localStorage:
```js
{ id, kind:'report'|'metrics'|'partial'|'pick', path, body, contentType, hub, orderDate, createdAt, tries, lastError }
```

- Picks (§3.4) go through the same queue: an offline phone still records every confirm, and the rows land in order on reconnect. A `pick` that arrives late is still correct — the light it feeds is a daily total, not a live cursor.
- `sbUploadQueued(path, body, meta)` — attempts the upload; on network failure enqueues and resolves `'queued'`; on a 4xx that is not a network problem, rejects (a real error, still worth showing).
- `flushOutbox()` runs on: app boot, `window.addEventListener('online')`, opening the coordinator screen, and a 30 s interval that only ticks while the outbox is non-empty. Exponential-ish backoff via `tries`.
- **Invariant preservation**: when a report is queued rather than uploaded, `clearPartialSave()` is **not** called in `showSummary()` — it is called by `flushOutbox()` when that specific report finally lands. Carry `hub` + `orderDate` on the outbox entry so the flusher knows which partial to clear.

**Summary screen — three states now:**
| State | Strip | Button |
|---|---|---|
| uploaded | ✅ Reporte guardado correctamente | `Terminar armado` → `newOrder()` |
| queued (offline) | 📶 Sin conexión — el reporte se enviará solo al reconectar | `Terminar armado` → `newOrder()` **enabled** |
| hard error | ❌ Error al guardar | `Reintentar` + `Salir (reporte pendiente)` (unchanged) |

Queued must enable the button. An assembler standing in a dead zone cannot be held hostage by the strip — that was the original v1 failure mode in a different costume.

**Home screen indicator**: when the outbox is non-empty, a pill under the two main buttons — `⏳ 1 reporte pendiente de enviar` — tappable to force a flush. Green flash + auto-hide on success.

**Order cache**: after `fetchOrderForHub()` parses successfully, store `{orderDate, items}` in `calii_order_cache_{hubSlug}`. If the fetch fails and a cache exists for that hub, load from cache and show `⚠ Sin conexión — usando el pedido guardado del {fecha}`. A reload in a dead zone stops being fatal.

**Service worker** (optional, own phase — see §4): cache-first for `index.html`, `imagedb.json` and the PapaParse CDN file so the app *opens* without signal. Without it, everything above only helps sessions that were already loaded.

---

### 3.7 Registration copilot (optional — the typing is manual and will stay manual)

**Constraint, stated plainly:** the app has no Retool connection, no write permission and no upload path. Every assembled quantity is typed into Retool by hand, row by row, and nothing in this plan changes that. What *can* change is how long that typing takes and how many mistakes it produces.

Four things, in descending value. All are cheap; none require anything from Retool.

#### 1. Emit the registration copy in alphabetical order by product name
`S.items = sortItems(items)` (index.html:748) sorts by `Posición armado`, so the report comes out in walking-route order. **The walking-route report stays exactly as it is** — it works and it is not the problem.

Add a second export, `registro_{hub}_{fecha}.csv`, **sorted alphabetically by `Producto`**. Retool can be sorted the same way with one click on the column header, so the two lists line up and the typist goes straight down both without hunting.

Sort with `localeCompare('es')` so accented names land where a Spanish speaker expects them, and so the app's order matches Retool's rather than diverging on the first `Ñ` or `Á`.

#### 2. Print only what gets typed
The registration copy carries the minimum: **identifier, `Salida (kg/pz)`, `Faltante`**. No requested amount, no barcode, no position, no status prose. Every extra column is something the eye has to skip past 112 times.

Quantities formatted as the exact string to type — `13`, not `13.08372309233879`, not `13 Pz`. Integers for `Pz`, two decimals for `Kg`, nothing else.

#### 3. Split exceptions from the mechanical rows
Two blocks in the registration copy:
- **Completos** — `armado = solicitado`. Mechanical, no thinking, type and move on.
- **Revisar** — partials, faltantes, fecha corta, discrepancias. These need attention and they are where registration errors actually happen.

Same file, clearly separated, exceptions first while attention is freshest.

#### 4. A tick-off view so nobody loses their place
The single largest source of rework in manual entry is losing the line and either skipping a row or entering it twice. A coordinator screen listing the registration rows, each tappable to mark as typed, with a running `48 / 112` counter and state surviving a refresh (localStorage; it is one person on one device, so no sync needed).

Used on a phone beside the computer, or a second tab. Costs an afternoon to build.

#### Explicitly not proposed
- **Scripted form-filling against the Retool UI** (userscript / browser automation). Technically possible — the people typing already have edit rights — but it is fragile against any UI change, it routes around a permission boundary someone set deliberately, and if it silently mis-fills, the damage lands in inventory where it is expensive. Not worth it. If typing volume ever justifies automation, the honest move is asking for write access, not simulating a person.
- **Anything requiring Retool cooperation.** Out of scope by definition until access changes.

#### Worth asking for anyway
Read-only Retool access is already something Jose is pursuing for the KPI work. It doesn't help registration — that needs write — but it would kill the closing-inventory upload step in §3.5 and make the §3.4 lights read real stock instead of an estimate. Different ask, different value, same conversation.

---

## 4. Build phases

Ship in this order; each phase is independently deployable and testable.

**Phase 1 — Expiry removal + Faltante sub-branch** (smallest, highest confidence)
Removes #14/#15, adds the read-only banner + list chip, adds the two-branch skip and the `shortdate` status across all four icon maps and the legend, renames the CSV column, deletes `screen-detail`.
✅ Done when: an item is confirmed with only a scan and a quantity; the minimum date is visible in both the row and the panel; a `Fecha no cumple` skip appears in the report as `Faltante (fecha corta)` and a `No se encontró` skip as `Faltante`.

**Phase 2 — Timing instrumentation + flags**
Result fields, `S.segments`, `computeOrderMetrics()`, the §3.3 flags, metrics sidecar upload, `Segundos en producto` column.
✅ Done when: an assembly with a deliberate 20-minute break produces `minutosReloj` ≫ `minutosActivos` **and** carries `PAUSA_LARGA`; and a save-and-exit → resume next day carries `CRUZA_DIA` + `MULTI_SESION` without the overnight gap landing in either minutes figure.

**Phase 3 — Metrics screen**
Table, flag column, filters, sort, footer, CSV export, cache.
✅ Done when: filtering to one assembler and sorting by SKUs desc gives a table whose CSV export matches what is on screen row for row, flags included; and a flagged assembly is visible by default rather than filtered out.

**Phase 4 — Semáforo de inventario** (§3.4)
`picks` table + policies, one row per confirm/faltante with `luz` and `seg_busqueda`, 15 s incremental poll, row chips, panel text with the arithmetic, testimony counter at 3 → 🟡, 🔁 revisar state, both coordinator views, accuracy and skip-behaviour counters.
✅ Done when: two phones, one SKU with 15 in stock — hub A confirms 15 and hub B's row goes 🔴 *"no lo busques"* within 10 s with the arithmetic shown, without either assembly being finished; every light starts green each morning regardless of upload order; one assembler's faltante changes nothing for anyone, three turn it 🟡 *"búscalo y si no está sigue"*, never 🔴; a skip contradicted by another assembler shows 🔁 on the first one's row and lands in `faltantesDesmentidos`; skipping costs the same two taps at every colour, with no bulk action anywhere; and with the `picks` table unreachable, assembly runs exactly as v1 with no lights and no errors.

**Phase 5a — Reserva y medición** (§3.5 — no new assembly behaviour, no risk to round 1)
Full-request upload, `pedido_completo/*.json` with verbatim rows, invisible reserva split, `no_surtido` CSV, closing-inventory upload slot, the *Revisar* cross-check and its per-hub summary. **Read-only: it reports, it generates nothing.**
This is the phase that answers "how many SKUs are we even talking about". Two weeks of it may be all that is ever needed.
✅ Done when: a full request uploads with zero-stock rows present and the assembler's list is identical to what the pre-filtered file would have produced; `no_surtido` matches the filtered rows exactly; an item requested 10 with 5 assembled shows **5** pending, not 10; a fully-assembled item never appears; a Class A revival (morning inventory 0, stock now) is listed; a Class B candidate appears only when `Recepción > 0` after the order download, never on the level alone.

**Phase 5b — Generación de complementos** (only if 5a's numbers justify it)
Per-hub *Generar complemento*, `orders/{hub}/{fecha}-r2.csv`, Complemento label in setup, `ronda` on reports and picks, separate round-2 register report.
✅ Done when: the generated Complemento parses with the existing order reader and its expiry dates render exactly as round 1's did; it assembles and reports like any other order, tagged `ronda 2`; the round-2 report carries `Armado en la mañana`, `Armado complemento` and a `Salida (kg/pz)` equal to their sum, and lists only SKUs touched in round 2; round 1's report and registration flow are byte-for-byte unchanged; re-running *Revisar* afterwards drops those SKUs.

**Phase 5c — Registration copilot** (§3.7 — optional, independent of 5a/5b)
Source-order registration export, minimal columns, exceptions split, tick-off view. Nothing here touches the assembler flow; it can be built at any point, including before Phase 4.
✅ Done when: the registration copy lists rows alphabetically by product name (`localeCompare('es')`), shows only the fields that get typed, separates exceptions from mechanical rows, and the tick-off counter survives a page refresh.

**Phase 6 — Offline resilience**
Outbox (reports, metrics, picks), three-state summary, home pill, order cache. Service worker last and separately — the only piece that can cause a stale-app-version problem, so it needs `CACHE_NAME` bumped on every deploy plus `skipWaiting` + `clients.claim`.
✅ Done when: airplane mode during finish → report queues, button enables, partial survives; reconnect → report uploads and the partial clears; and the killer case — airplane mode → close app → reopen → reconnect → report still arrives.

**Phase 7 — Handoff update**
`armadoCHhandoff.md` updated with everything above plus the v3 backlog in §6.

---

## 5. Test relaunch protocol

You have manual baseline timing. Protecting the comparison matters more than the app changes do.

### Why wall-clock — the asymmetry

The problem is not the app's data, it is the baseline's. The app records a timestamp **per item**, so it can reconstruct anything: total elapsed, active time, idle gaps, seconds per SKU. The manual baseline has one row per assembly — `Armador, MH, Fecha, SKUs, Minutos, SKUs/Hr` — a single `Minutos` figure with no internal structure. There is no way to subtract a break from it after the fact, because nobody wrote down when the break happened.

So the two sides can only meet at the level the *poorer* dataset supports:

| | Manual baseline | App |
|---|---|---|
| Total elapsed minutes | ✅ yes (`Minutos`) | ✅ `minutosReloj` |
| Active minutes (breaks removed) | ❌ **not recoverable** | ✅ `minutosActivos` |

Comparing manual `Minutos` against app `minutosActivos` would compare a number that includes interruptions against one that has them stripped out — the app would look faster even if it changed nothing. That is the whole point: **headline comparison = manual `Minutos` vs `minutosReloj`.** `minutosActivos` is a diagnostic — it tells you how much of an assembly was real picking versus waiting — not a comparison number.

### Settled

`Minutos` in the Velocidad Armado sheet was captured manually — the assembler wrote down the hour they started and the hour they finished, no pauses recorded. That is wall-clock elapsed, breaks included.

**→ Headline comparison is manual `Minutos` vs `minutosReloj`.** Confirmed, not assumed.

Two consequences worth carrying into the analysis:
- **Granularity.** Hand-written start/end times are rounded to the nearest 5 or 10 minutes, and rounding at both ends is not symmetric — people round the start down and the end up more often than the reverse, which inflates the baseline's minutes slightly. It biases *in the app's favour*, so treat a small app win (<10 %) as noise rather than a result.
- **Small orders are unusable.** A 20-minute assembly recorded to the nearest 5 minutes carries ±25 % error. This is what `PEDIDO_CHICO` is for — keep those rows, read them separately.

The §3.3 flags exist for exactly this reason: an assembly with `PAUSA_LARGA` or `CRUZA_DIA` has a `minutosReloj` that is not comparable to a manual stopwatch run, so you can see which rows to read carefully instead of discovering the distortion in an average.

**Sequence**
1. **Shakedown — 3 days, 1 hub, 2 assemblers.** Goal is bugs, not numbers.
2. **Pilot — 2 weeks minimum.** Only assemblers who appear in the manual baseline, only hubs that appear in it. Same product mix, same shift.
3. Each assembler's **first 3 orders** carry a learning curve and will read as "the app is slower". Keep them — same principle as the flags — but mark the cutoff date per assembler so the analysis can report *with* and *without* the ramp-up rather than picking one silently.

**Confounders to record, or the result is unreadable:** order size (SKUs per order — already captured), hub, assembler, day of week, and whether a second assembler joined mid-order. Order size is the one you flagged as an open question on the Velocidad Armado sheet; the metrics table now answers it directly — sort by SKUs and read the SKUs/hr column.

**Success criteria — decide these before the data comes in, not after.** Suggested: app-assisted SKUs/hr within −10 % of baseline is a *win*, because the app is buying barcode verification and per-item traceability that the manual process does not produce at all. Treat a speed *gain* as a bonus, not the bar.

**Also worth watching**: `bcAttempts` and `touches`. High values on specific SKUs point at bad catalog barcodes rather than slow assemblers.

---

## 6. Deferred to v3+ (record in the handoff)

- **Prefilled quantity** — one-tap accept of the requested amount. Real speed lever, but Jose's concern stands: it invites confirming a quantity that was never physically counted, and the error lands in inventory where it is expensive. Revisit only if v2 data shows quantity entry is a top-3 time sink, and then consider prefilling only for `Pz` items with requested qty = 1.
- **Parallel multi-assembler picking** — two or more assemblers on the same order simultaneously, each seeing what the other has claimed. The current partial-save model is one-writer; this needs real-time claim locking (Supabase Realtime or short-poll on a claims file), not an extension of partials. Biggest available reduction in wall-clock minutes per order, and the biggest build.
- **Barcode exception simplification** — collapse UNAVAIL/WRONGSYS if v2 data shows the distinction is not being used correctly.

---

## 7. Open questions

Ordered by what they block. Nothing in Phases 1–4 is blocked; the open items sit under Phase 5.

| # | Question | Blocks | Notes |
|---|---|---|---|
| 1 | **How is an assembly actually registered — typing into the system row by row, or pasting/uploading?** | Nothing yet; could reshape 5b and be worth more than it | The order export ships with `Salida (kg/pz)`, `Faltante`, `Nro. de unidades` and `Envío - Solicitud (#)` empty — they are fill-in fields. If registration is manual typing, the app could emit those same rows **pre-filled**, turning registration into a paste. Potentially a larger saving than anything on the assembly side. |
| 2 | **What time does the closing inventory export get pulled?** | Phase 5a operational fit | Assumed ~17:00, leaving the evening for a complemento. If it's later, the window may not be usable. |
| 3 | **Does anything downstream break if a hub receives two reports for one date?** | Phase 5b | Round-2 reports are additive and separately registered; worth confirming nobody's process assumes one file per hub-day. |
| 4 | **Is 61 % zero-stock typical, or was that day unusual?** | Sizing only | One hub, one day. If typical, the reserva is the majority of every request and 5a should run early. |

### Resolved during planning — recorded so they aren't relitigated

- **Registration copy sort order** → alphabetical by product name; Retool gets sorted the same way so both lists run top-to-bottom together. The walking-route report is unchanged.
- **Coordinator stops pre-filtering zero-stock rows** → confirmed, it's a simple instruction. Sample of the unfiltered upload provided and verified: 287 rows, 175 at zero stock.
- **`Recepción` resets daily** → confirmed. Class B still filters on `Actualización recepción` later than the order upload, because same-day receptions can predate the download.
- **Registration is cumulative** → the system's `Salida` field is overwritten with a running total, so the round-2 report carries `Armado en la mañana`, `Armado complemento` and `Salida (kg/pz)` = R1+R2.
- **Order CSV has no `sku` column** → confirmed against the real export. Join stays barcode-primary, product-name-secondary.
- **Baseline comparison** → manual `Minutos` (hand-written start/end, no pauses) vs `minutosReloj`. Wall-clock both sides.
- **Expiry** → displayed read-only, never typed. `Faltante` gains a *No se encontró* / *Fecha no cumple* sub-branch.
- **Queue priority for the inventory light** → rejected. The light reports consumption, it never allocates.
- **Testimony red** → rejected. Not-found is a counter; 3 reports raise 🟡, never 🔴.
- **One-tap skip on flagged items** → rejected. Skipping costs the same everywhere.
- **Bulk skip for zero-inventory rows** → rejected. Those rows are never shown to an assembler at all.
- **Websocket as source of truth** → rejected in favour of a 10 s incremental poll; sockets may be layered on later.
- **Consolidated R1+R2 report** → rejected. R1 is registered immediately, so consolidation would double-count.
- **Level test (`Final [AUTO] > 0`) for restocks** → rejected. `Envío`/`Salida` are zero on all 3,827 sample rows, so assembly outflow isn't reflected; only reception events are trustworthy.
- **Qty prefill, parallel picking** → deferred to v3 with reasoning in §6.
- **Any automated write into Retool** → impossible, not deferred. No connection, no upload path, no edit permission. Registration is manual typing; §3.7 only makes the typing faster. Scripted form-filling against the Retool UI was considered and rejected — fragile, routes around a deliberate permission boundary, and mis-fills land in inventory.
