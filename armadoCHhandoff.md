# Calii Armado CH — Handoff

> **Source of truth: the code.** This file was rewritten on 2026-10-20 by reading all of `index.html`
> (4,407 lines) at commit `ea20426`. It describes what the app **does today**, not what any plan said
> it would do. Where the code and an older plan disagree, the code wins and this file follows the code.
>
> The plan files (`armadoCH-v2-plan.md`, `-v2.1-plan.md`, `-v2.2-partials-plan.md`) are now **history**:
> they explain *why* things were built. They are all shipped. Read them only for the reasoning
> behind a decision; never use them to learn current behaviour.
>
> **Rule:** a change that ships without updating this file did not happen. Update the relevant section
> in the same commit.

Contents: [1 What it is](#1-what-it-is) · [2 Repo & workflow](#2-repo-deploy-workflow) ·
[3 Supabase](#3-supabase) · [4 Storage map](#4-storage-map) · [5 localStorage](#5-localstorage-keys) ·
[6 Data model](#6-data-model) · [7 Screens](#7-screens--flows) · [8 Lifecycles](#8-lifecycles--when-things-exist-and-what-deletes-them) ·
[9 Subsystems](#9-subsystems) · [10 Report CSV](#10-report-csv) · [11 Ground rules](#11-ground-rules--settled-decisions) ·
[12 Known issues](#12-known-issues--unverified) · [13 Backlog](#13-backlog)

---

## 1. What it is

Mobile web app for assembling **inter-hub orders** at Calii (grocery delivery, Monterrey). All seven
hubs (MH Contry, Cumbres, Guadalupe, San Nicolás, Avícola, Condesa, Zapopan) are picked from one
CH (CH Guadalupe — `HUB_CH` maps every hub to `'CH-GDLP'`).

| Role | Does |
|---|---|
| **Coordinador** (PIN) | Uploads each hub's order CSV, manages the assembler list, downloads reports, runs the registration copilot, metrics, inventory conflicts, closing-inventory cross-check, round-2 complementos, image DB upload, 🛟 recovery |
| **Armador** (no PIN) | Picks hub + name, assembles item by item (scan barcode, type quantity), saves & exits or finishes |
| **Inventory owner** | Receives the daily faltantes CSV |

Registration into **Retool is manual typing** by people. There is no Retool connection, no write access,
and that is a deliberate boundary (see §11). The app only makes the typing faster (§9.9).

The user-facing manual is `manual/manual-armado-ch.md` (Spanish, for staff). This file is for whoever
works on the code.

---

## 2. Repo, deploy, workflow

```
armado-CH/
├── index.html                  # the entire app — HTML + CSS + JS, one file, no build step
├── sw.js                       # service worker, network-first shell cache (CACHE_NAME 'calii-armado-v2-3-p3')
├── netlify.toml                # cache headers + X-Frame-Options/nosniff
├── imagedb.json                # bundled image DB (~1.3 MB, ~9.5k keys) — the FALLBACK, not the source (§9.10)
├── manual/manual-armado-ch.md  # staff manual; fetched at runtime by the in-app 📖 screen
├── manual/manual-armado-ch.pdf # stale snapshot of the .md — the in-app ⬇ PDF button supersedes it
├── armadoCHhandoff.md          # this file
├── CLAUDE.md                   # short working rules for Claude Code sessions
├── armadoCH-v2*.md             # historical plans (shipped)
└── Claude outputs/             # untracked scratch (contains the separate sorting-hub plan)
```

- **Hosting:** Netlify, auto-deploys `main` of GitHub `joseromero-crypto/armado-CH` (public repo).
- **Local dev:** `python3 -m http.server 8080` → `http://localhost:8080`. `imagedb.json` and the manual
  don't load over `file://`.
- **Local testing hits production.** The anon key and URL in `index.html` are prod. Any upload, pick or
  partial written from localhost lands in the live bucket/tables. Stub `sbUpload`/`pgInsert`/`sbDelete`
  in the browser before exercising write flows.
- **Deploy:** `find .git -name "*.lock" -delete 2>/dev/null; git add . && git commit -m "…" && git push`
- **Before every deploy:** bump `CACHE_NAME` in `sw.js` when `index.html` changed; run one full
  assembly end to end if `confirmItem` / `generateCSV` / status maps changed; update this file.
- **Never commit business data.** `.gitignore` covers `fixtures/`, `*_fixture.csv`, `inventario_*.csv`,
  `registro_de_inventario*.csv`, `pedido_completo*.csv`. Real exports go in `fixtures/`.

---

## 3. Supabase

```js
SB_URL = 'https://uuqqtksxlgkztenojufm.supabase.co'
SB_KEY = <anon public JWT, in index.html>
BUCKET = 'solcitudesarmado'   // intentional typo — matches the real bucket
```

Raw `fetch` calls, no supabase-js. Helpers (all near the top of the script):

| Helper | Does | Notes |
|---|---|---|
| `sbUpload(path, body, type)` | `POST /storage/v1/object/{bucket}/{path}` with `x-upsert:true` | Throws `Error("NNN: body")` on non-2xx |
| `sbFetch(path)` | `GET …/object/public/{bucket}/{path}` → text | Throws `Error("NNN")` |
| `sbList(prefix)` | `POST …/object/list/{bucket}`, limit 500, name desc | |
| `sbDelete(path)` | `DELETE …/object/{bucket}/{path}` (single-object endpoint) | The batch prefixes endpoint does not work for exact paths |
| `pgInsert(table,row)` / `pgSelect(table,query)` | PostgREST `/rest/v1/{table}` | **Max rows = 1000** per response |
| `sbReq(url,opts)` | every helper above/below goes through it: **max 8 requests in flight**, and a **429** waits (Retry-After or 0.5/1/2/4 s) and retries up to 4 times | v2.3 — unthrottled bursts got rate-limited and hubs rendered empty |
| `pgSelectAll(table,query)` | pages `pgSelect` (`limit`/`offset`, adds `order=id.asc` if none) | Use for anything day-wide (v2.3) |
| `sbReplace(path,body,type,{backup})` | upsert; on a 4xx delete-then-insert. `backup` keeps a respaldo of the old file first | For paths that may already exist (v2.3) |
| `latestOrderFile(files)` | `{date, base, r2, chosen}` — THE rule for a hub's current order | Every caller uses it (v2.3) |

**Storage policies (anon):** INSERT + SELECT + DELETE. **No UPDATE.** Overwriting an existing object with
upsert is treated as UPDATE and fails, so files rewritten in place use **delete-then-insert**
(`assemblers.json`, `inventario_dia`, `imagedb/*`). Partials avoid the problem by never overwriting (§8.2).
⚠ Several writers still rely on plain upsert over a possibly-existing path — see §12.

**Tables** (both exist and receive rows — verified 2026-10-20):

`picks` — one row per confirm or faltante (`recordPick`). Anon INSERT + SELECT.
```sql
id bigserial pk, fecha date, hub text, ronda int default 1, sku_key text, producto text, unidad text,
cantidad numeric, senal text /* null|'no_encontrado'|'fecha_corta' */, luz text, seg_busqueda int,
armador text, order_date date /* bare date — v2.3 sends bareOrderDate(); `ronda` separates R1/R2 */, ts timestamptz default now()
```
`partial_events` — one row per partial save / clear / restore (`recordPartialEvent`).
Columns: `hub, order_date, ronda, action ('saved'|'cleared'|'restored'), reason, armador, done, total, device_id, ts`.
`reason` ∈ `discard_button · report_uploaded · outbox_report · coordinator_upload · rebuild_from_picks` (null on saves).

Neither table is ever deleted from by the app. `picks` is load-bearing for the semáforo, the faltantes
views **and recovery** — never rename or drop `hub, order_date, ronda, sku_key, cantidad, senal, armador, ts`.

**New tables need explicit grants.** From 2026-10-30, Supabase stops auto-granting Data API access to new
`public` tables. Any table created after that date returns `permission denied` until granted, in the same
migration that creates it:
```sql
grant select, insert on public.<table> to anon;   -- trim to what the table needs
```
RLS policies still decide which rows. `picks` / `partial_events` predate the change and are unaffected.
Ref: https://github.com/orgs/supabase/discussions/45329

---

## 4. Storage map

Every path the app reads or writes, who writes it, and how it dies.

| Path | Written by | Read by | Deleted by |
|---|---|---|---|
| `orders/{slug}/{YYYY-MM-DD}.csv` | `doUpload` (date = **today**, always) | assembler `fetchOrderForHub`, coordinator, rebuild, inv-today, faltantes CSV | coordinator 🗑 `clearHubOrder` only |
| `orders/{slug}/{date}-r2.csv` | `generarComplemento` | `fetchOrderForHub` (preferred over the base file for the same date) | coordinator 🗑, only if it is the row the 🗑 points at (§12) |
| `pedido_completo/{slug}/{date}.json` | `doUpload` via outbox | 📄 No surtido, Revisar (cierre) | never |
| `inventario_dia/{date}.json` | `mergeInventarioDia` (every upload) | semáforo `loadInvDia`, coordinator conflicts | never (one file per day accumulates) |
| `partials/{slug}/{orderDate}__{epochMs}_{seq}.json` | `savePartialToSupabase` | `fetchRemotePartial` | `prunePartialVersions` (keeps newest 3), `clearPartialSave` |
| `partials/{slug}/{orderDate}.json` | nothing (pre-v2.2 legacy) | read as a fallback | `clearPartialSave` |
| `reports/{slug}/{orderDate}_{finishDate}_{HH-MM}_{Armadores}.csv` | `finalizeAssembly` (v2.3 two-date name) | coordinator lists, registro, 📋 Pedidos armados, `armadoMapForHub` | coordinator 🗑 `deleteReport` (respaldo first) |
| `reports/{slug}/{orderDate}_r2_{finishDate}_{HH-MM}_{Armadores}.csv` | same, ronda 2 | same | same |
| `respaldos/{slug}/{orderDate}__{epochMs}__{motivo}.json` | `writeRespaldo` — before every partial clear, order 🗑, report 🗑, same-day overwrite | (Phase 4: Respaldos panel) | `pruneRespaldos` after 30 days |
| `metrics/{slug}/{report stem}.json` | `uploadMetricsSidecar` | metrics screen | with its report, or 🗑 on the metrics row |
| `inventario_cierre/{date}.json` | `uploadCierre` | `loadCierre` (newest file) | never |
| `imagedb/latest.json`, `imagedb/version.txt` | `uploadImageDB` (delete-then-insert) | `loadImageDB` | replaced on upload |
| `assemblers.json` | `saveAssemblers` (delete-then-insert) | setup + coordinator | replaced on save |
| `coordinator_pin.txt` | edited by hand in the dashboard | `validatePin` | — |

`{slug}` = `HUB_SLUG[hub]` (`mh-contry`, `mh-cumbres`, `mh-guadalupe`, `mh-san-nicolas`, `mh-avicola`,
`mh-condesa`, `mh-zapopan`).

> **Report filenames (v2.3):** `{orderDate}_{finishDate}_{HH-MM}_{Armadores}` — the first 10 chars are always the
> order date, which is what every grouping uses. **Pre-v2.3 names** are `{finishDate}_{HH-MM}_…` (one date): for
> those the first 10 chars are the finish date, so a legacy multi-day report still groups under the wrong day.
> `reportDisplayInfo` returns `{dateStr (order), finishDate, label, isR2}` for both formats.

---

## 5. localStorage keys

All access is wrapped in try/catch. Writes that matter go through `trySetLocalStorage` (§8.2).

| Key | Content | Lifetime |
|---|---|---|
| `calii_partial_{slugify(hub)}__{orderDate}` (e.g. `calii_partial_MH_Contry__2026-10-20`) | full partial payload | until `clearPartialSave` — **old dates are never swept** |
| `calii_partial_{slugify(hub)}` | pre-v2.2 date-less key | removed the first time that hub's partial is loaded |
| `calii_order_cache_{slug}` | last loaded order `{orderDate, ronda, baseDate, items}` (projected rows) | overwritten per load; evicted on quota pressure |
| `calii_outbox` | queued uploads (§8.5) | until each lands |
| `calii_device_id` | random device id | forever |
| `calii_imgdb_cache` | `{v, map}` image DB | replaced when `version.txt` changes; first to go on quota pressure |
| `calii_order_history` | today's finished report CSVs (silent backup) | filtered to today on every save |
| `calii_metrics_cache` | metrics sidecars keyed by path | pruned to files that still exist |
| `calii_ordercount_{slug}` | `{date, activos, reserva}` from this device's last upload | coordinator display only |
| `calii_registro_ticks_{reportPath}` | ticked rows in the registration copilot | forever |
| `calii_sum_sort` | summary-screen sort preference | forever |
| `calii_coord_page` | last coordinator page (v2.3) | forever |
| `calii_coord_maint` | day the coordinator maintenance (sweep + respaldo pruning) last ran on this device | overwritten daily |

---

## 6. Data model

### 6.1 Order row (input CSV from Calii's system)
Parsed with PapaParse, `header:true, dynamicTyping:false` (keeps barcodes as strings). Rows with
`Solicitud (kg/pz) > 0` only. The app reads exactly these fields — `ORDER_ROW_FIELDS`, used to project
rows before persisting (partials, order cache):

`Producto · Código de barras · Kg/Pz · Solicitud (kg/pz) · Posición armado · Inventario hub saliente ·
Vida anaquel usuarios (min. días) · Vida anaquel usuarios (min. fecha) · Salida (kg/pz) · Envío - Solicitud (#)`

**If you read a new order column anywhere, add it to `ORDER_ROW_FIELDS`** or resumed sessions see it blank.
(`pedido_completo` and the r2 generator keep every column verbatim; they don't go through the projection.)

### 6.2 Global state `S`
`hub, assembler, assemblers[], items[], results[], imgDb, activeIdx, orderDate, segments[], ronda,
baseDate, _r1Armado, _recuperado, _orderLoaded, _orderStale, _partialCheck ('pending'|'none'|'found'|'error'),
_picks, _picksMaxTs, _picksDay, _lights, _contradicted, _pollTimer, _picksReachable, _invDia, _invDiaDay,
_localBackupFailed`.

`S.orderDate` is the **order file's name without `.csv`**: `2026-10-20` for round 1, `2026-10-20-r2` for a
complemento. It is the partial's identity and is stamped on every pick as `order_date`.

Module-level state worth knowing: `_pendingPartial`, `_pendingPartialOtherDevice`, `_recoverablePartial`,
`_partialSaveSeq`, `_pendingReport`, `_expandedIdx`, `_listFilter`, `_staleAck`, `_partialCheckRetried`,
`_sumRows/_sumSort/_sumFilter`, `_regState`, `_cierrePerHub`.

### 6.3 Result object (one per item, `S.results[i]`)
```
status, picked, bcStatus, scannedBC, confirmedAt (Date), assembler,
openedAt, firstOpenedAt, touches, handleSec, bcAttempts,      // timing
luzAlSkip, _invAmbiguo, _senal, _contradicted, _contradictedBy, _restored
```
Per-item `assembler` = whoever resolved that row, so multi-person orders attribute correctly.

### 6.4 Status vocabularies
- `ITEM_STATUS` — `pending · completed · sobrante · partial · skipped · shortdate`, plus legacy
  `nobc · wrongsys` (no longer produced; kept so old partials/reports render).
  `SKIP_STATUSES = [skipped, shortdate]`; `QTY_ISSUE_STATUSES = [partial, sobrante, nobc, wrongsys]`.
- **Estado is purely the quantity outcome.** `confirmItem`: `picked===0` → skipped; `|picked−req| ≤ tol`
  → completed; `> req` → sobrante; else partial. `tol` = 0.05 Kg / 0.5 Pz. `req` = `Math.ceil` for Pz.
- `BC_STATUS` — `pending · scanned · unavail · wrongsys · nosys`. The barcode axis lives only here and in
  the report's `Verificación código` column. A bad barcode shows a small `⚠` next to the row icon; it
  never changes Estado.

---

## 7. Screens & flows

Screens are `<div id="screen-X" class="screen">`; `showScreen(name)` swaps them.

### 7.1 Home
Coordinador (PIN) · Armar Pedido · 📖 Manual · `⏳ N pendiente(s) de enviar` outbox pill (tap = flush).

### 7.2 Setup (assembler)
1. Tap a hub → `pickHub` resets per-hub state → `fetchOrderForHub` (§8.1).
2. Status strip: `✓ Cargado el {date} — N productos`, `🔄 Complemento del {date}`, amber
   `⚠ Tu solicitud es del dd/mm (N días) — NO es de hoy` (tap re-opens the stale modal), or
   `⚠ Sin conexión — usando el pedido guardado`.
3. `finishOrderLoad`: reload `assemblers.json`, show the name dropdown, then **await**
   `checkForPartialSave` (§8.2).
4. One of three cards may appear in `#partial-save-notice`:
   - **📂 Pedido en progreso** — `↩ Continuar pedido` / `Empezar de cero` (danger modal naming count,
     armadores and date). Shows `Continuado en otro dispositivo a las HH:MM` when the winning copy came from
     another device.
   - **🛟 Recuperar armado** — no partial found, but picks exist and no report → rebuild from picks.
   - **✅ Este pedido ya se terminó** (v2.3) — a partial was found, but the order already has a report
     (`reportsForOrder`) and nothing in the partial was confirmed after it. No "Continuar" is offered, and the
     leftover is archived + deleted (`leftover_after_report`). This is what stops finished orders being resumed.
   - nothing.
5. **Iniciar Armado** is enabled only when: hub + order loaded, a name is picked (if any are configured),
   the stale modal was acknowledged (`_staleAck`), and `_partialCheck` is `'none'` with no pending
   partial. While checking it reads `Verificando progreso…`. On `'error'`: `⚠ No pude verificar… ·
   Reintentar`, and after one failed retry `Empezar de cero de todos modos` (danger modal).
6. Clock warning (red) if the device clock is off by more than 5 min from the server.
7. **📋 Pedidos armados** — finished reports for orders still in the bucket; opens the summary read-only.

### 7.3 List (assembling)
- Header row 1: `←` (`cancelOrBack`) · hub · ❓ legend · 💾 save & exit · `🔁 N` chip.
  Row 2: `N/N` (tap = refresh semáforo) · Finalizar pedido. Then `Todos · Pendientes` filter, progress bar.
  `--list-header-h` keeps the panel's sticky title and row scroll offset aligned with this header.
- Rows sorted by `Posición armado` (`parsePos` → `[letter, n1, n2]`). Pending rows never move.
  Contradicted skips (🔁) collect in an always-expanded section at the bottom.
- Row: image, 2-line name, position, requested qty, `📅 DD/MM` min-expiry chip, 🟡/🔴 light, status icon.
- Tapping a row opens an inline panel (accordion; one at a time; `_expandedIdx`). Panel: sticky title,
  🔁 note naming the finder, image, tags, requested qty, barcode section, semáforo block, min-expiry
  banner, qty input with ± steppers, `⚑ Faltante` / `Confirmar ✓`.
- `⚑ Faltante` → `📭 No se encontró` (skipped) / `📅 Fecha no cumple` (shortdate) / `←`. Two taps, always.
- After confirm/faltante the next **pending** item further down auto-opens (`advanceToNextPending`).
- Every confirm/faltante: `savePartialProgress()` + `recordPick()` + `pollPicks()`.
- `←` with nothing resolved → `newOrder()` (keeps any existing partial). With work → save & exit modal.

### 7.4 Summary
Reached from **Finalizar pedido** (`showSummary`, mode `'live'`) or from 📋 Pedidos armados
(`openFinishedSummary`, mode `'readonly'`).
- Tiles (Total / Completos / Parciales / Faltantes) always count the **full** set.
- Sort `Posición | A–Z | Estado` (persisted), search (product or barcode), chips
  `Todos · Faltantes · Revisar · Sin armar`, `Mostrando N de M · Ver todos`. Display only — sorts a copy.
- Live mode: `← Seguir armando` (reopens a timing segment) and **Terminar armado**. **Nothing uploads
  until Terminar** (`finalizeAssembly`). `_pendingReport` is built in `showSummary` from `S.items/S.results`
  directly, never from the displayed rows.
- Upload outcomes: `✅ Reporte guardado` → `Listo →` (clears the partial) · `📶 Sin conexión — se enviará
  solo` → `Listo →` (partial kept until the queued report lands) · `❌ Error al guardar` (hard 4xx) →
  Reintentar / `Salir (reporte pendiente)` (`exitKeepingPartial`).

### 7.5 Coordinator (PIN from `coordinator_pin.txt`, cached for the session)
**Pages under a sticky top menu (v2.3 Phase 2)** — one `<section class="coord-page">` visible at a time inside
`screen-coordinator`. Header: `←` · 📊 metrics · ↺ reload, then the menu (scrolls sideways on a phone).

- `showCoordPage(name)` shows one page, saves it to `calii_coord_page`, and loads that page's data.
- `loadCoordinatorScreen()` = drop cached data + flush the outbox + reload the **current** page. Called by ↺, PIN
  entry, the Métricas/Registro `←`, and after every upload/delete — so those keep the page you were on.
- **Two-stage load.** `getCoordHubData()` = stage 1, each hub's `orders/` + `reports/` + `partials/` lists
  (`fetchCoordHubData`, 21 requests) — enough to draw the Pedidos cards and all of Armados, shared until the next
  `loadCoordinatorScreen()`. `getCoordStatuses()` = stage 2 (`computeCoordStatuses`): status per hub, older
  unfinished orders, `pedido_completo` lists and the morning banner. Pedidos draws cards after stage 1 (chips `…`,
  "Cargando estado…") and redraws after stage 2; Armados never waits for stage 2. Measured 2026-10-20: cards 0.8 s,
  statuses 1.4 s cold / 1.0 s warm.
- A failed load shows `⚠ No se pudo cargar … Reintentar` (`coordLoadFailed`) — per page, or per hub card.
- `runCoordMaintenance` (leftover sweep + respaldo pruning, §8.2) runs **once a day per device**
  (`calii_coord_maint`), hub by hub, after stage 2 — never during the page load. Skipped when localStorage is
  unavailable (e.g. a `file://` tab).

| Menu | Page id | Content | Loader |
|---|---|---|---|
| 📦 Pedidos | `pedidos` | **Morning banner** (v2.3/B2): the newest order date before today from `pedido_completo/` (order CSVs are deleted daily), `N de M armados · K sin terminar`, a chip per unfinished hub that scrolls to its card. **Hub cards** (v2.3/B1): name + status chip (`⚪ Pendiente` · `🟡 En progreso N/M` · `🟡 Continuado después del reporte` · `✅ Armado N/M` / `con pendientes` · `🔴 Se perdió el avance`), `✓ Pedido dd/mm` badge (amber if not today, `· 🔄 R2`) + `N activos · M reserva`, who/when line, then `Subir CSV`, `📄 No surtido`, `🛟 Recuperar` (status = perdido), `🗑` / `🗑 R1`·`🗑 R2` | `renderMorningBanner`, `renderPedidosPage` |
| ✅ Armados | `armados` | `Hoy` = reports for the currently loaded orders (filename date ≥ the hub's order date) · `Historial` = everything older, dimmed, with hub + 7/30/90/todo filters (default 30). Both are **grouped by order date** (`renderReportGroups`): one collapsible block per day headed `Lunes 19 oct 2026 · ayer` with `N armados · M complementos`; inside, by hub, R2 indented under R1. Newest 3 days open in Historial. Each row: time — armador (+ `· terminado dd/mm` when finished on a later day), `📋` registro, `⬇ CSV`, `🗑`. Legacy one-date reports group under their finish date | `renderArmadosPage`, `renderArchive`, `setArchFilter`, `setArmadosView` |
| ☑️ Verificar captura | `verificar` | placeholder until v2.3 Part F | — |
| 📭 Faltantes | `faltantes` | `📭 Faltantes del día (CSV)` + ⚠️ conflicts (`Inv > 0` and demand across hubs > Inv), 📭 today's faltantes (desmentido markers), 📜 last 20 `partial_events` | `loadInvToday` |
| 🔄 Cierre | `cierre` | closing-inventory upload, `Revisar` → candidates → `Generar complemento` / `Generar todos` (§9.7) | `refreshCierreStatus` |
| 👤 Armadores | `armadores` | add / remove names | `loadAssemblers` + `renderAssemblerList` |
| 🖼 Imágenes | `imagenes` | Masterview upload (§9.10) | `refreshImgDbStatus` |

### 7.6 Metrics, Registro, Manual
- **📊 Métricas** — one row per sidecar; filters (armador, hub, 7/30/90/todo, solo irregulares), sortable
  headers, weighted SKUs/hr footer, `⬇ CSV` of the current view, per-row 🗑 (§9.8).
- **📋 Registro** — registration copilot (§9.9).
- **📖 Manual** — renders `manual/manual-armado-ch.md` at runtime with a tiny Markdown converter
  (`_mdToHtml`), one collapsible per `## ` section; `⬇ PDF` = `window.print()` with a print stylesheet.
  **To change the manual, edit the .md** — no code change needed.

---

## 8. Lifecycles — when things exist, and what deletes them

This is the section to read before touching saving, deleting or recovery.

### 8.1 Orders — when is an order available for assembly?
- A coordinator upload writes `orders/{slug}/{todayStr()}.csv`. **There is no way to upload for another
  date.** The full request also goes to `pedido_completo/` and merges into `inventario_dia/` (§9.6).
- `fetchOrderForHub` lists `orders/{slug}/`, takes the **max date** (by filename, `-r2` stripped), and loads
  `{date}-r2.csv` if it exists, else `{date}.csv`. Only that one file is ever reachable by an assembler.
- Rows filtered to `Solicitud > 0`, then to **activos** (`Inventario hub saliente > 0`). Fallback: if no row
  has inventory, or it's an r2, every requested row is shown. Reserva rows are never shown.
- **An order is available until a newer date is uploaded for that hub, or it is deleted.** No expiry. If
  it isn't today's, the stale modal must be acknowledged, but it can still be assembled.
- **Deleting the newest order silently falls back to the previous date's file** (the next max). 🗑 has one
  confirmation and checks nothing (partials, reports, picks).
- Offline: falls back to `calii_order_cache_{slug}`.
- Older order files are never deleted automatically; they just become unreachable.

### 8.2 Partials — how long they live
**Identity:** one partial per `(hub, orderDate)`. Never per assembler or device. Any armador on any phone on
any day can resume it.

**Save** (`savePartialProgress`, on every confirm/faltante, resume, save & exit, `exitKeepingPartial`):
- Skipped when nothing is resolved yet (no empty partials).
- Payload: `{hub, items (projected), results, segments, ronda, baseDate, r1Armado, savedAt, orderDate, deviceId}`.
- Local: `trySetLocalStorage` → on `QuotaExceededError` evicts image cache → other hubs' order caches →
  order history, retrying after each. If it still fails, the list shows
  `⚠ Sin respaldo local en este dispositivo`.
- Remote: **POST a new versioned file** `{orderDate}__{epochMs}_{seq}.json`. Never overwrites, so a remote
  copy always exists. After a 2xx, `prunePartialVersions` deletes all but the newest **5** (`PARTIAL_KEEP_VERSIONS`).
  `_partialSaveSeq` drops a save superseded by a newer save or a clear before it POSTs.
- The remote write is fire-and-forget with **no retry and no outbox**. A failed write is covered by the
  next save, the local copy, and `picks`.
- Each save writes a `partial_events` row (`saved`).

**Load** (`loadPartialProgress`): reads local **and** remote, returns the newer by `savedAt`, and writes a
newer remote back to local. Remote read = newest versioned file that parses, falling back to older versions,
then the legacy flat file. Returns `found | none | error`; `error` (couldn't confirm either way) keeps
Iniciar Armado blocked.

**What deletes a partial** — `async clearPartialSave(hub, orderDate, reason, done, total, {payload})` (v2.3):
1. finds the newest copy (local vs remote by `savedAt`, or `opts.payload`);
2. **writes it to `respaldos/` first** (motivo from `RESPALDO_MOTIVO`). If that write fails, or the remote state
   can't be confirmed, it **deletes nothing** and resolves `false`;
3. then removes the local key + every remote version + the legacy file, and logs `cleared`.

Exactly these callers:

| Trigger | Reason logged | Respaldo motivo | On respaldo failure |
|---|---|---|---|
| Report uploaded (`finalizeAssembly`) | `report_uploaded` | `terminado` | partial stays (swept later) |
| Queued report finally lands (`flushOutbox`) | `outbox_report` | `terminado` | partial stays (swept later) |
| `Empezar de cero` → danger modal → confirm | `discard_button` | `empezar_de_cero` | toast, card stays, nothing deleted |
| Coordinator same-day re-upload → `Subir y borrar progreso` | `coordinator_upload` | `subida_coordinador` | toast, upload aborted |
| Coordinator screen sweep (`sweepLeftoverPartials`) | `leftover_after_report` | `terminado` | stays |

Nothing else deletes a partial. `newOrder()` no longer clears anything (v2.3 removed its silent re-clear, which
could delete without a respaldo); `←`, `saveAndExit`, `startAssembly` keep it.

**Leftover sweep** (once per hub per session, on opening the coordinator): a partial whose order already has a
report **and** holds no product confirmed after that report's time is archived + deleted. It is judged on the last
`confirmedAt`, not the save time — see §12 item 11d for why.

**How long it lives:** remote — until one of the triggers above; its last copy then lives 30 days in respaldos.
Local — indefinitely, old dates are never swept.

**Order and report deletes** (`clearHubOrder`, `deleteReport`) also write a respaldo first (the CSV text; a report
also carries its metrics sidecar) and refuse to delete if it can't be written. `pruneRespaldos` removes respaldos
older than `RESPALDO_DAYS` (30) once per hub per session.

**When a partial becomes unreachable without being deleted:**
- **A newer order date is uploaded for that hub.** The assembler only checks the latest `orderDate`, and the
  coordinator's 🛟 only checks the latest order. The old partial survives in the bucket, but no screen shows it.
  The upload modal doesn't warn either, because the check is scoped to today's date. This is how a multi-day
  hub (Condesa, Zapopan) loses its resume card the next morning.
- **The order CSV is deleted.** The partial survives, but the hub now loads a different date (or nothing).
- **A complemento (`-r2`) is generated for the date.** The assembler then loads the r2. Generation is blocked
  while an R1 partial exists, so this only bites a fresh R1 started after generation.

**Starting fresh over existing work:**
- `forceStartIgnoringPartialCheck` (after a failed check + failed retry) starts fresh. Its first save becomes
  the newest version, and after 3 saves the old versions are pruned.
- When the 🛟 card is showing, `Iniciar Armado` is **enabled**. Starting fresh writes a new partial, and
  recovery is then never offered again for that order (it is only offered when no partial exists).

### 8.2b Order status (v2.3 Phase 3)
`orderStatus(hub, od, partialFiles, reportFiles)` — used by the Pedidos cards and the morning banner:
1. `reportsForOrder(hub, od, reportFiles)` — reports whose name starts with the order date; for pre-v2.3
   one-date names, legacy reports finished within 21 days whose **metrics sidecar `orderDate`** matches
   (sidecars cached via `cachedMetrics` in `calii_metrics_cache`). The same lookup feeds the resume guard and
   the leftover sweep, so they always agree on "is this order finished?".
2. Report found → **✅ armado** with N/M from its sidecar (`skusArmados/skusTotal`) — **unless** a partial for the
   same order has a product confirmed after the report time → **🟡 continuado**.
3. No report, partial found → **🟡 progreso** (done/total/armadores/savedAt from the newest version).
4. Neither → one `limit=1` picks query: picks → **🔴 perdido** (🛟 offered), else **⚪ pendiente**.

**Status is only about the hub's current order** (Jose, 2026-10-20). Older orders are not looked up or shown on
the cards; the morning banner covers yesterday. (An earlier build listed older unfinished partials in red —
Contry 14/09-r2 at 1/7, Cumbres 01/10 at 1/56 — and was removed as noise.)

### 8.3 Recovery from picks (🛟)
`rebuildPartialFromPicks(hub, orderDate, ronda)`:
1. Re-reads `orders/{slug}/{orderDate}.csv` with the same filters as the assembler (needs the order file).
2. `picks` where `hub, order_date, ronda` match, `ts` asc. Keyed on `order_date`, never `fecha`, because a
   multi-day assembly spans several `fecha` values.
3. Dedup by `sku_key`, last pick wins. Status derived with `confirmItem`'s rule.
4. `bcStatus` = scanned for positive picks, `confirmedAt` = pick ts, `handleSec` = `seg_busqueda`.
   Opens/touches/bc attempts are not recoverable. One synthetic segment first → last pick.
5. Tagged `_restored`, payload `restoredFrom:'picks'`; written through the normal versioned save; logs
   `restored / rebuild_from_picks`.

Surfaces: the assembler 🛟 card (only for the order on screen, only when no partial and no report) and the
coordinator 🛟 button (only for each hub's latest order). A recovered assembly finishes with
`S._recuperado` → metrics flag `RECUPERADO` 🛟, and timing/rate fields set to null.

### 8.4 Reports
- Path computed in `showSummary` from the **finish** time; uploaded in `finalizeAssembly` through
  `sbUploadQueued`. Never auto-deleted.
- **Active vs historial** on the coordinator screen: active = filename date ≥ the hub's latest order date.
- Deleting a report also deletes its metrics sidecar. It does **not** recreate a partial; if picks exist,
  the 🛟 button will appear for that order.

### 8.5 Outbox (`calii_outbox`)
- `sbUploadQueued` tries now; on a network error (`isNetErr`: message doesn't start with `NNN:`), it queues.
  A hard 4xx rejects to the caller.
- Kinds: `report`, `metrics`, `pick`, `pedido_completo`, `inventario_dia` (delete-then-insert on flush),
  `partial_event`.
- `flushOutbox` runs on boot, `online`, opening the coordinator screen, tapping the home pill, and every 30 s
  while non-empty. A landed `report` clears its partial. Non-report entries with a hard error are dropped
  after 2 tries; reports are kept forever.
- **Invariant:** a queued report does not clear the partial. Only the landed report does.

### 8.6 The safety invariant, as implemented
Any assembly with ≥1 resolved item leaves at least one of: a remote partial version, a local partial, a
report (uploaded or queued), and — independently — one `picks` row per resolved item (with its own outbox).
`picks` is the only copy that **no code path deletes**.

---

## 9. Subsystems

### 9.1 Time
- Every date/time goes through `serverNow()` (device clock + skew from Supabase's `Date` header, synced on
  boot and on return to foreground; v2.3 — taken from a `HEAD` on `picks`, because `HEAD /rest/v1/` now returns
  401 with no readable `Date`, which had silently switched the correction off) and `TZ='America/Monterrey'` formatters (`localDateStr`, `localHM`,
  `todayStr`). Fallback: fixed UTC-6. Reason: phones shipped set to UTC+8 were stamping the wrong day.
- Never use `new Date()` / `toISOString().slice(0,10)` / `toTimeString()` for a stamped date.

### 9.2 Barcodes
- `cleanBC` fixes Excel/Sheets damage (scientific notation, trailing `.0`).
- `bcMatch` accepts a match after stripping leading zeros on both sides (scanners add a `0`).
- `bcKey` strips leading zeros for image DB lookups.
- Upload check `detectSuspiciousBarcodes`: ends in 3+ zeros and isn't in the image DB → warning modal.
- Panel: scan field (`inputmode="none"`, Bluetooth scanner types + Enter), `No puedo escanear` (unavail),
  `Código equivocado en sistema` (wrongsys, requires a scan, saves the physical code). No barcode in the
  system → nosys, no scan needed. Confirm is blocked until the barcode is resolved.

### 9.3 Quantity & expiry
- Qty field starts empty on purpose; blank is rejected. Pz picked shown with `Math.round`, Kg `.toFixed(2)`.
- Minimum expiry is **read-only**: `computeMinExpDate` = `Vida anaquel (min. fecha)` + `(min. días)`;
  dates more than 60 days in the past roll to next year. Shown as an amber banner above the qty field and a
  `📅 DD/MM` chip on the row; written to the report as `Vencimiento mínimo`.

### 9.4 Timing
- `openDetail` stamps `openedAt` (every open), `firstOpenedAt`, `touches`. Confirm/faltante set
  `handleSec` (capped at `MAX_HANDLE_SEC` 300).
- `S.segments` — one per working session (`startAssembly`/resume open one; `showSummary`, `saveAndExit`,
  `exitKeepingPartial` close it). The gap between segments (e.g. overnight) is never counted.

### 9.5 Inventory semáforo
- Polls `picks` for **today's `fecha`** and the current `ronda` every `POLL_MS` (10 s) while the list is
  visible, plus after each own confirm, on load, and on tapping `N/N`. Incremental by `ts`.
- `disponible = inventario − consumed by OTHER hubs today`. Own hub's picks don't count.
  - No consumption and fewer than 3 "not found" reports → green (nothing shown), whatever the stock.
  - 🟡 `0 < disponible < solicitado`, or ≥ `FLAG_NOTFOUND_MIN` (3) assemblers reported not found.
  - 🔴 `disponible ≤ 0` — arithmetic only. Capped to 🟡 when the key is a name join (`norm:`), the
    inventory came from the file instead of today's baseline, or the baseline was uploaded after the
    first pick on that SKU (`invAmbiguo`).
- The open panel is never re-rendered by a poll. Nothing is disabled or reordered by a light.
- 🔁 contradiction: you marked `no se encontró` and someone else has a positive pick on that SKU today →
  row moves to the 🔁 section, the panel names who/where/when.
- Day rollover while open: picks reloaded from scratch for the new day; `S.results`, segments and the
  partial are untouched.
- `picks` unreachable → no lights, no errors.

### 9.6 Inventory baseline (`inventario_dia`)
Every upload merges the hub's `Inventario hub saliente` per SKU into `inventario_dia/{today}.json`; per SKU
the **latest upload wins** (even if lower). `itemInventario(item)` returns `{inv, fuente:'dia'|'archivo'}`.
`checkSalidaEnvio` warns if an uploaded order already has non-zero `Salida`/`Envío` (the semáforo assumes
assembly outflow isn't yet discounted in the snapshot).

### 9.7 Reserva, cierre and round 2
- **Reserva** = requested rows with zero inventory; never shown to assemblers. `📄 No surtido` downloads them
  from `pedido_completo`.
- **Cierre:** coordinator uploads Retool's *Registro de inventario* export → reduced to
  `{bc, nk, producto, unidad, final, recepcion, recepcionTs}` → `inventario_cierre/{date}.json`.
- **Revisar** (`revisarCierre`) per hub: outstanding = `solicitado − armado` (from the latest R1 report + all
  R2 reports, via `armadoMapForHub`). Candidates:
  - **Class A** — was reserva and `Final [AUTO] > 0` now.
  - **Class B** — was an activo still short, and `Recepción > 0` with `Actualización recepción` after the
    order upload (`parseMxTs` reads tz-less timestamps as CST).
  - Unmatched rows listed separately. Already-generated SKUs are skipped (idempotent).
- **Generar complemento** (blocked while an R1 partial exists) writes `orders/{slug}/{date}-r2.csv`
  (original columns, `Solicitud` = outstanding balance). It loads as `🔄 Complemento del {date}`,
  `S.ronda=2`, `S.orderDate={date}-r2`, `S._r1Armado` = R1 quantities.
- R2 report: only touched SKUs, first line `# COMPLEMENTO — capturar "Salida (kg/pz)"…`, extra columns
  `Armado en la mañana · Armado complemento · Salida (kg/pz)` (cumulative — the Retool field is a running total).

### 9.8 Metrics
- Sidecar from `computeOrderMetrics`: `minutosReloj` (Σ segments) and `minutosActivos` (minus inter-item gaps
  > `IDLE_GAP_MIN` 5 min) — both reported, never merged; SKUs/hr; median sec/SKU; counts and
  `% completo/parcial/sobrante/faltante/surtido`; `porArmador`; semáforo accuracy counters; `flags`.
- Flags: 🌙 `CRUZA_DIA` · ⏸ `MULTI_SESION` · 🕐 `PAUSA_LARGA` (>15 min) · 👥 `MULTI_ARMADOR` ·
  🔹 `PEDIDO_CHICO` (<10 SKUs) · ⏳ `INCOMPLETO` · 📶 `REPORTE_DIFERIDO` · 📅 `PEDIDO_VIEJO` ·
  ⛔ `SIN_TIEMPO` · 🛟 `RECUPERADO`. Irregular rows are flagged, never dropped.
- Footer rate = total SKUs ÷ total hours (not mean of rates), excluding `SIN_TIEMPO`.

### 9.9 Registration copilot (📋 on a report)
Parses the report, drops `Pendiente` rows, sorts **A–Z by product** (Retool is sorted the same way, so both
lists run together), splits into ⚠️ Revisar (Estado ≠ Completo, or a barcode exception) and ✅ Completos.
Each row: tick box + `Salida` + `Faltante`. Ticks persist per report. `⬇` exports `Producto, Salida, Faltante`.
Row keys `'r'+i` are assigned **before** the sort — keep it that way or saved ticks bind to the wrong product.
There is no comparison against what was actually typed into Retool.

### 9.10 Image DB
Boot: `imagedb/version.txt` → cached map if the version matches, else `imagedb/latest.json` → else the bundled
`./imagedb.json`. Coordinator uploads the Masterview CSV (`Item`, `Código de Barras`, `Image URL`, matched
case/accent-insensitively; ≥1000 keys or rejected). Lookup: bcKey → exact name → first word → prefix scan
(≥5 chars, so a missing product shows 📦 instead of a wrong photo).

### 9.11 Offline & service worker
`sw.js` is **network-first** for same-origin + cdnjs (online always gets the latest deploy; offline falls
back to cache). Precaches the shell, `imagedb.json`, the manual and PapaParse. Never intercepts `supabase.co`.
`skipWaiting` + `clients.claim`. **Bump `CACHE_NAME` on every deploy that changes `index.html`.**
`beforeunload` warns when an order is open and you're not on the summary.

---

## 10. Report CSV

Round 1 columns (unchanged since v2 — **byte-for-byte stable; Retool registration depends on it**):
```
Hub, Armador, Fecha, Hora, Posición armado, Producto, Código en sistema, Código físico escaneado, Unidad,
Solicitado, Inventario CH, Armado, Verificación código, Estado, Vencimiento mínimo, Segundos en producto
```
- `Armador`, `Fecha`, `Hora` are **per row** (who resolved it and when); pending rows use the session
  assembler and the report time.
- `Estado` ∈ `Completo · Sobrante · Parcial · Faltante · Faltante (fecha corta) · Pendiente`
  (legacy nobc/wrongsys → `Parcial`).
- `Verificación código` ∈ `Confirmado · No disponible (ilegible) · Discrepancia — código físico ≠ sistema ·
  Sin código en sistema · No escaneado`.
- All cells quoted, CRLF. A BOM is added only on browser download (`triggerDownload`), not in the bucket.
- R2 adds three columns and a leading `#` comment line (§9.7).
- Filename stem `{finishDate}_{HH-MM}_{Armadores}` (armador slugs sorted and joined with `_`);
  `reportDisplayInfo` turns it into `HH:MM — Name` (legacy stems still parse).

---

## 11. Ground rules & settled decisions

From Jose, repeated across every planning session. Changes must not break them.

1. **No cheap exits or skips.** No bulk actions, no one-tap abandon. Faltante is two taps everywhere.
2. **The only assembler inputs are barcode and quantity.** Everything else is displayed.
3. **Advisory, never blocking.** Lights and warnings inform; they never disable, auto-skip or reorder.
   (The stale-list modal and the partial check are gates on *starting*, not on items.)
4. **Safety invariant.** Any assembly with ≥1 resolved item leaves a report or a resumable partial.
5. **Round 1 is sacred.** Its report shape, filename and registration step don't change.
6. **Measure before building**, and **facts, not forecasts** — when the app estimates, it shows the arithmetic.

Settled — don't relitigate without new data:
- Qty prefill → deferred (invites confirming an uncounted quantity).
- Testimony never makes 🔴; queue priority for the light rejected; websocket as source of truth rejected.
- Semáforo consumption is keyed on `fecha` (today), never `order_date`. `order_date` is for recovery only.
- Merging a corrected order file into an in-flight partial → **rejected** (a changed `Solicitud` silently turns
  a correct sobrante into an unflagged parcial). Use `Subir sin borrar el progreso` + a complemento instead.
- Consolidated R1+R2 report → rejected (R1 is registered immediately; it would double-count).
- Any automated write into Retool → impossible by design (no connection or permission). Scripted UI filling
  was rejected.
- Bucket UPDATE policy as a substitute for versioned partials → rejected (it can be added *as well*, not instead).

---

## 12. Known issues & unverified

Found while reading the code on 2026-10-20. None fixed yet.

**Safety / recovery gaps**
1. **Older partials become invisible** when a newer order date is uploaded (§8.2). No screen lists all
   partials for a hub or across hubs.
2. **🛟 recovery needs the order CSV.** Delete the order and recovery fails, even though
   `pedido_completo/{slug}/{date}.json` still has every row.
3. **The 🛟 card doesn't block Iniciar Armado**, so a fresh start buries recoverable work.
4. **Order 🗑 is a single confirmation that checks nothing**, and silently promotes the previous date.
5. Remote partial writes have no retry/outbox (covered by the next save + local + picks).
6. Local partials for old order dates are never cleaned up; they count against the ~5 MB quota.
7. The legacy flat partial fallback is still read (the v2.2 plan said to drop it after 30 days).

**Date-equality assumptions (report filename date ≠ order date)**
8. **Fixed for new reports (v2.3 Phase 1):** names now start with the order date (Jose approved the change).
   Still true for **pre-v2.3** reports finished on a later day than their order: `hasReportForOrderDate` /
   `armadoMapForHub` match `name.startsWith(orderDate)`, so those old multi-day reports are not found (🛟 can be
   offered for them; Revisar can over-propose). Ages out with the old files.

**Round-2 inconsistencies**
9. **Fixed (v2.3 Phase 1):** every caller uses `latestOrderFile()`. The coordinator row shows `· 🔄 R2` and a
   separate `🗑 R1` / `🗑 R2`. (Before: `localeCompare` ranked the R1 file first, so 🗑 deleted R1 while
   assemblers loaded the r2.)
10. **Verified 2026-10-20:** `picks.order_date` is a `date` column. `recordPick` sends `S.orderDate`
    (`2026-09-11-r2`); Postgres stores `2026-09-11`, and a query filtering on `…-r2` is coerced the same way and
    matches. So R2 recovery works by accident; `ronda` is what actually separates R1 from R2 picks. Don't rely on
    the coercion: send/query the bare date + `ronda`. **Fixed (v2.3 Phase 1):** `recordPick`, recovery queries and
    `partial_events` send `bareOrderDate()`.

**Overwrite-without-delete**
11. **Handled (v2.3 Phase 1):** `doUpload` (order CSV + `pedido_completo`), `generarComplemento` and `uploadCierre`
    use `sbReplace` (upsert, then delete-then-insert on a 4xx; the replaced order is kept as a respaldo). Whether
    a plain upsert would have failed is still unverified (11e), but the code is now correct either way.

**Row limits**
11b. **Verified 2026-10-20: max rows = 1000** (`picks` holds 22,256 rows; an unpaged query returns 0–999).
    Daily picks across all hubs ran 442–870 in mid-October (870 on 20/10), so the cap is close. No `pgSelect`
    paginates; day-wide queries will truncate silently: `loadPicks` (self-heals over a few polls, since each poll continues from the last
    `ts`), the `cantidad=gt.0` "positives" queries behind desmentido detection and the faltantes CSV (do **not**
    self-heal), and any future cross-hub query. **Fixed (v2.3 Phase 1):** every day-wide picks query uses
    `pgSelectAll`. Only the `limit=1` existence check stays on `pgSelect`.

**How the bucket is actually used (observed 2026-10-20)**
11c. **The coordinator deletes each day's order.** Every hub had exactly one file in `orders/` (today's); Condesa
    and Zapopan had none. So order 🗑 is a daily routine, and anything needing an older order must read
    `pedido_completo/` (Contry: 42 days kept), not `orders/`.
11d. **Finished orders get resumed (resurrected partials).** `partials/mh-contry/` held files for 13/10 and 08/10
    whose every confirmed product predates the order's report (last confirm 12:57 vs report 13:27; 9:56 vs 10:36),
    but were **saved hours after** the report: the 13/10 one shows a new segment by "Rangel" at 15:56. Someone
    resumed an already-finished order — a stale local or remote copy offered the "Continuar" card — and
    `resumePartialSave` re-saved it at once. The sweep now archives these (judged on last `confirmedAt`).
    **Fixed (v2.3 Phase 3):** `checkForPartialSave` now asks `reportsForOrder` first and, for a finished order with no
    later work, shows "✅ Este pedido ya se terminó" instead of "Continuar" and archives the leftover.
    The 14/09-r2 partial is different: a complemento with no R2 report — genuinely unfinished.
11e. Re-upload overwrite (item 11) is still unverified: no order file shows `updated_at > created_at`, so no
    same-day overwrite has ever succeeded — or none was tried.

**Testing incident (2026-10-20)**
11f. During v2.3 testing the editor auto-opened `index.html` as a `file://` tab in the browser pane, which runs the
    local code against production with no write stub. The coordinator was opened in it and the Phase 1 sweep really
    archived + deleted Contry's 13/10 and 08/10 leftover partials. Both are preserved in `respaldos/mh-contry/`
    (`…__terminado.json`, 151/174 and 96/130, all work pre-dating their reports). Lesson: test only in the
    stubbed `http://localhost:8080` tab and close any `file://` tab after edits.

**Docs**
12. `manual/manual-armado-ch.md` predates v2.2: it still says "Nuevo armado" (now "Empezar de cero" with a
    danger modal) and doesn't mention 🛟 Recuperar, "Verificando progreso…", "Subir sin borrar el progreso",
    the summary sort/filter, or the clock warning.
13. `manual/manual-armado-ch.pdf` is stale; regenerate from the in-app ⬇ PDF or delete it.

---

## 13. Backlog

Next (v2.3, being planned):
- Bigger safety net for assembly saving; cautious order deletes; a coordinator recovery console listing every
  partial and recoverable assembly across hubs and dates (closes §12 items 1–4, 8).
- UX edits (to be specified).
- **Retool capture verification** — upload the Retool export after registration and compare `Salida` per SKU
  against the report to catch misclicks (wrong qty, shifted or swapped rows, typed-but-not-assembled,
  assembled-but-not-typed). Needs a real export sample in `fixtures/`.

Deferred (v3), with reasoning in `armadoCH-v2-plan.md` §6:
- Prefilled quantity (only if data shows qty entry is a top-3 time sink).
- Parallel multi-assembler picking (needs real-time claim locking; `picks` is the foundation).
- Collapsing UNAVAIL/WRONGSYS.
- Automatic round-2 generation; Realtime as a speed layer over the poll.
- Retool live inventory (read-only) to replace the cierre upload.

Open questions for Jose:
- What time is the closing-inventory export pulled? (Assumed ~17:00.)
- Should the report filename carry the order date (§12 item 8)? That touches R1's "sacred" filename.
