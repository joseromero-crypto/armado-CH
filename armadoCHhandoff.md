# Calii Armado CH — Project Handoff

> **⚠️ v2 (relaunch) changed a lot of what's below.** Sections 1–8 describe the v1 architecture and
> still hold for the base flow. Everything added or changed in v2 — expiry read-only, timing metrics,
> the coordinator metrics screen, the inventory semáforo (`picks` table), reserva / closing-inventory
> cross-check, round-2 complementos, the registration copilot, and offline resilience — is in
> **[§9 v2 relaunch](#9-v2-relaunch--what-changed)** at the end. Read v1 for the foundations, §9 for current behaviour.
> The build spec that produced v2 is `armadoCH-v2-plan.md`.

## Overview
Mobile-friendly web app for assembling inter-hub orders at Calii (Mexican grocery delivery). A coordinator uploads CSV order files; assemblers on phones select their hub, the order auto-loads, and they assemble item by item confirming barcodes and quantities. Completed reports are saved to Supabase and downloadable by the coordinator from any device.

---

## Deployment
- **Live URL**: Netlify (connected to GitHub repo `joseromero-crypto/armado-CH`)
- **Repo**: `https://github.com/joseromero-crypto/armado-CH`
- **Branch**: `main` — Netlify auto-deploys on push
- **Local dev**: `cd ~/Desktop/armado-CH && python3 -m http.server 8080` → `http://localhost:8080`
- **Deploy workflow**: `cd ~/Desktop/armado-CH && find .git -name "*.lock" -delete 2>/dev/null; git add . && git commit -m "..." && git push`
  - The `find .git -name "*.lock" -delete` prefix clears stale lock files that can appear after interrupted git operations or sandbox usage

## File Structure
```
armado-CH/
├── index.html           # entire app — single file, no build step
├── imagedb.json         # 9,513-entry image DB (~1.3MB), keyed by barcode + normalized name
├── netlify.toml         # cache headers (imagedb.json: 30-day cache)
└── armadoCHhandoff.md   # this file
```

---

## Tech Stack
- Vanilla HTML/CSS/JS — no framework, no build tool
- **PapaParse** (CDN) — CSV parsing
- **Supabase Storage** — order CSV upload/fetch, report storage
- Static hosting on **Netlify**

---

## Supabase Config
```js
SB_URL  = 'https://uuqqtksxlgkztenojufm.supabase.co'
SB_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' // anon public key
BUCKET  = 'solcitudesarmado'  // NOTE: intentional typo — matches actual bucket name
```

### Storage path conventions
| Type | Path |
|------|------|
| Order (coordinator uploads) | `orders/{hub-slug}/{YYYY-MM-DD}.csv` |
| Report (auto-saved on finish) | `reports/{hub-slug}/{YYYY-MM-DD}_{HH-MM}_{AssemblerSlugs}.csv` |
| Partial save (in-progress assembly) | `partials/{hub-slug}/{order-file-date}.json` |
| Coordinator PIN | `coordinator_pin.txt` (bucket root) |
| Assembler list | `assemblers.json` (bucket root) |

### Hub slugs
| Display name | Slug |
|---|---|
| MH Contry | `mh-contry` |
| MH Cumbres | `mh-cumbres` |
| MH Guadalupe | `mh-guadalupe` |
| MH San Nicolás | `mh-san-nicolas` |
| MH Avícola | `mh-avicola` |
| MH Condesa | `mh-condesa` |
| MH Zapopan | `mh-zapopan` |

### Bucket policies (Supabase Storage)
- Bucket: `solcitudesarmado` (public bucket)
- Policies: **INSERT + SELECT + DELETE** for `anon` role, definition: `bucket_id = 'solcitudesarmado'`
- DELETE policy is required for the report and order delete buttons to work
- **Important**: there is NO UPDATE policy for anon. Any file that needs to be overwritten (e.g. `assemblers.json`) must be **deleted then re-inserted** — do not rely on `x-upsert:true` for existing files, as Supabase treats upsert of an existing object as UPDATE and will return HTTP 400

### Coordinator PIN
- Stored as a plain-text file at the **root** of the bucket: `coordinator_pin.txt`
- Content is just the 4-digit PIN, nothing else (e.g. `4821`)
- To change: update the file directly in the Supabase Storage dashboard
- Session-cached in JS (`_coordPinVerified` flag) — resets on page refresh
- If the file can't be fetched (network error), an error is shown — no fallback PIN

---

## App Flow

### Screens
1. **Home** (`screen-home`) — two buttons: Coordinador / Armar Pedido
2. **Coordinator** (`screen-coordinator`) — PIN-protected; upload CSVs per hub, view/download/delete reports and orders
3. **Setup** (`screen-setup`) — assembler selects hub → auto-fetches latest CSV from Supabase
4. **List** (`screen-list`) — scrollable item list with progress bar + ❓ legend button. Items expand **inline** (accordion) — no separate detail screen navigation.
5. **Summary** (`screen-summary`) — stats + item list + "Terminar armado" button (goes home)

> `screen-detail` still exists in the HTML but is no longer navigated to. All item interaction happens via inline expand panels within `screen-list`.

### Coordinator flow
- PIN entry required on first access each session
- **Cargar pedidos**: uploads CSV per hub via file picker; badge shows last upload date or `Sin pedido`; 🗑 clears the order (with confirmation modal)
- **Armadores**: list of assembler names stored in Supabase (`assemblers.json`). Coordinator types a name + Enter or taps `+` to add; taps `✕` to remove. Loaded and re-rendered every time the coordinator screen opens. Save uses delete-then-insert to work around the missing UPDATE policy.
- **Active reports**: reports generated since the last upload for each hub — shown with ⬇ and 🗑 buttons
- **Archived reports**: all older reports — collapsible section ("📁 Ver historial"), shown dimmed
- Reports are never auto-deleted from Supabase — full history preserved

### Assembler flow
- Selects hub → app lists `orders/{hub-slug}/` and fetches the **latest** file (not date-restricted)
- After hub loads, app immediately checks for a partial save for that hub (see Partial Save below)
- If a partial exists, a yellow banner appears with **"↩ Continuar pedido"** and **"Nuevo armado"** buttons; **"Iniciar Armado" is disabled** until the user resolves the banner
- Assembler list is re-fetched from Supabase and a name dropdown appears; start button requires both hub + name (unless no assemblers are configured)
- "Continuar pedido" requires a name to be selected first (if assembler list is configured) — toasts if not
- Status message shows: `✓ Cargado el {YYYY-MM-DD} — N productos`
- On finish: report auto-uploaded to Supabase; assembler taps "Terminar armado" → home
- No download button for assemblers
- No "Mis pedidos de hoy" history shown (removed)

### Order file persistence
- Uploaded files stay in Supabase until explicitly deleted by coordinator
- Multiple assemblies can be done from the same uploaded file — each generates a new timestamped report
- New upload for a hub moves previous reports to the archive section in the coordinator view

---

## CSV Format (input — from Calii system)
Key columns used:
| Column | Notes |
|--------|-------|
| `Producto` | Product name |
| `Código de barras` | May be scientific notation from Excel — cleaned by `cleanBC()` |
| `Posición armado` | Format `[A-1-2]` — used for sorting |
| `Solicitud (kg/pz)` | Requested quantity — may be decimal (e.g. 16.619) |
| `Kg/Pz` | Unit — either `"Kg"` or `"Pz"` |
| `Inventario hub saliente` | Current CH stock — displayed as "Inv. CH" tag in item panel |
| `Vida anaquel usuarios (min. fecha)` | Shelf-life base date (e.g. `May-15`) — combined with min. días to compute minimum acceptable expiry |
| `Vida anaquel usuarios (min. días)` | Days to add to min. fecha to get the minimum acceptable expiry date |

### CSV parsing rules
- `dynamicTyping: false` — critical, preserves barcodes as strings
- Filter: only rows where `Solicitud (kg/pz) > 0`
- Quantities: `Math.ceil()` for Pz units (16.619 → 17), `.toFixed(2)` for Kg

---

## Key Business Rules

### Barcode handling
Every item with a barcode in the system MUST have one of these resolved before confirming:
- **SCANNED** — physical barcode matched system barcode ✓
- **UNAVAIL** — assembler tapped "No puedo escanear" (unreadable)
- **WRONGSYS** — assembler scanned a different barcode than system has; actual scanned value saved to report
- **NOSYS** — no barcode in the system at all (auto-resolved, no scan required)

Confirming without resolving barcode is blocked with a toast error.

#### Leading-zero bypass (`bcMatch`)
Some scanners prepend a leading `0` to barcodes that the system stores without one (e.g. scanner reads `07501039122716`, system has `7501039122716`). `bcMatch(scanned, system)` strips leading zeros from both sides before comparing — if the digit sequences match, the scan is accepted as **SCANNED**. The actual scanned value (with the leading zero) is saved to `scannedBC` and written to the report.

### Barcode corruption detection (on coordinator upload)
Google Sheets / non-Excel exports sometimes lose precision on long numeric barcodes (e.g. `7501039122716` → `7501039000000`). On upload, the app detects this:
- Flag criteria: cleaned barcode ends in 3+ zeros **AND** that barcode is not a key in `imagedb.json`
- The 8 barcodes in imagedb.json that legitimately end in zeros are NOT flagged (they exist as valid keys)
- If suspicious barcodes found: blocking modal lists affected products; coordinator can re-export or continue anyway
- Root fix: coordinator should format barcode column as **Plain Text** before exporting from Google Sheets

### Expiry date
Every confirmed item requires an expiry date input (DD/MM/AAAA). Rules:
- Format validated: day 01–31, month 01–12, year unrestricted
- Must be **equal to or later** than the minimum acceptable date (`Vida anaquel usuarios (min. fecha)` + `Vida anaquel usuarios (min. días)` days). If earlier, confirm is blocked with a red field and a toast showing the minimum.
- "Sin fecha de vencimiento" button bypasses the field entirely — sets `expDate = 'N/A'`, shows a yellow bypass pill (same pattern as "No puedo escanear"). Written as `Sin fecha de vencimiento` in the report CSV.
- Faltante (⚑) bypasses expiry entirely — skipped items have `expDate = null`.
- `computeMinExpDate(item)` parses the base date (handles Spanish and English month abbreviations) and adds the days. If the date has already passed by more than 60 days, assumes next year.

### Faltante (skip)
Tapping ⚑ Faltante bypasses barcode and expiry date requirements entirely — marks item as skipped with 0 picked.

### Quantity
- Blank qty is not allowed on confirm
- Pz: `Math.ceil()` for requested, `Math.round()` for picked display
- Kg: `.toFixed(2)` throughout
- Tolerance for "Completo" status: ±0.05 Kg or ±0.5 Pz

### Item status values
| Status | Meaning |
|--------|---------|
| `pending` | Not yet acted on |
| `completed` | Qty within tolerance, BC verified |
| `partial` | Qty outside tolerance |
| `nobc` | Picked but barcode was unreadable |
| `wrongsys` | Picked but barcode discrepancy |
| `skipped` | Faltante / 0 picked |

---

## Barcode Cleaning (`cleanBC`)
Handles Excel/Sheets export corruption:
- Scientific notation: `7.5E+12` → `7501039122716`
- Trailing decimal: `7503004706204.0` → `7503004706204`
```js
function cleanBC(raw) {
  if (raw == null) return '';
  let s = String(raw).trim(); if (!s) return '';
  if (/[eE][+\-]?\d+$/.test(s)) { const n = Number(s); if (!isNaN(n) && isFinite(n)) s = n.toFixed(0); }
  s = s.replace(/\.0+$/, ''); if (s.includes('.')) s = s.split('.')[0];
  return s;
}
```

---

## Position Sorting
Format: `[A-1-2]` → parsed to `[letter, num1, num2]` tuple, sorted lexicographically.
```js
function parsePos(raw) {
  if (!raw) return ['￿', 9999, 9999];
  const s = String(raw).replace(/[\[\]\s]/g, ''), p = s.split('-');
  return [p[0]?.toUpperCase() || '￿', parseInt(p[1]) || 0, parseInt(p[2]) || 0];
}
```

---

## Image Database (`imagedb.json`)
- ~9,500 entries, keyed by **barcode string** AND **normalized product name**
- Built from Calii's catalog CSV
- Fetched on boot via `fetch('./imagedb.json')` — fails silently on `file://` (use python server locally)
- Cached 30 days by Netlify headers
- Lookup priority: exact barcode → exact name → first-word prefix → key prefix scan
- Also used for barcode corruption cross-reference on coordinator upload

---

## Report CSV (output)
Columns: `Hub, Armador, Fecha, Hora, Posición armado, Producto, Código en sistema, Código físico escaneado, Unidad, Solicitado, Inventario CH, Armado, Verificación código, Estado, Fecha vencimiento`

- Column `Armador` — **per-item**: whichever assembler confirmed that row (`r.assembler`); falls back to the session assembler for any pending items. Supports multi-assembler orders.
- Column `Hora` — time the **individual item** was confirmed or marked faltante (not the report generation time). Items left pending fall back to report generation time.
- Column `Inventario CH` — value of `Inventario hub saliente` from the order CSV; blank if not present
- Column `Fecha vencimiento` — assembler-entered expiry date (DD/MM/AAAA), `Sin fecha de vencimiento` if bypassed, blank if faltante/pending
- Column previously named `Recogido` — renamed to `Armado`
- BOM (`﻿`) prepended for Excel compatibility
- Auto-uploaded to Supabase on `showSummary()` via `getReportPath(hub, assemblerSlug)` (sync, timestamp-based)
- Download filename: `{Hub_slug}_{YYYY-MM-DD}_{HH-MM}_{AssemblerSlugs}.csv` — when multiple assemblers worked the order their slugs are joined alphabetically (e.g. `Diego_Jose`)
- Coordinator report display label: `HH:MM — Assembler Name` (parsed from filename by `reportDisplayInfo()`)
- Date and time in filenames use **local Mexico time** (via `localDateStr()` helper) — not UTC
- State (`hub`, `assembler`, `items`, `results`) is captured in **local variables** at the start of `showSummary` before upload — prevents race condition where `newOrder()` clears global state mid-async
- Also saved to localStorage as a silent backup (not shown in UI)

### Per-item timestamp
Each result object carries `confirmedAt: Date | null`. Set in `confirmItem()` and `markFaltante()` at the moment of action. `generateCSV()` uses `r.confirmedAt || now` per row to populate `Fecha` and `Hora`. This means the report accurately reflects when each item was handled, not when the assembler pressed "Finalizar".

---

## Supabase API Functions
```js
sbUpload(path, content)   // POST with x-upsert:true — safe for new files; see UPDATE note below
sbFetch(path)             // GET public URL (no auth required)
sbList(prefix)            // POST list, limit 500, sorted by name desc
sbDelete(path)            // DELETE /storage/v1/object/{BUCKET}/{path} — requires DELETE policy
```
**Important — `sbDelete`**: uses the single-object endpoint (`DELETE .../object/{bucket}/{path}`), NOT the batch `/object/delete/{bucket}` prefixes endpoint. The prefixes endpoint treats paths as folder prefixes and returns "object not found" for exact file paths.

**Important — overwriting files**: `sbUpload` with `x-upsert:true` triggers an UPDATE check when the file already exists. Since the anon policy has no UPDATE grant, this returns HTTP 400. For any file written repeatedly to the same path (currently only `assemblers.json`), the pattern is: `sbDelete` first (ignore 404), then `sbUpload`.

---

## localStorage Backup
Key: `calii_order_history`
- Entries purged daily (only today's kept)
- Each entry: `{ id, date, hub, total, ok, skipped, time, filename, csv }`
- Silent fallback only — not shown in UI
- Primary storage is Supabase

### Partial save key
Key: `calii_partial_{hubSlug}` (e.g. `calii_partial_mh_contry`)
- One entry per hub; overwritten on every item confirm/faltante
- Payload: `{ hub, items, results, savedAt, orderDate }` — results include `assembler` per item and `confirmedAt` as ISO string
- `orderDate` is the **order file date** (`S.orderDate`, set from the CSV filename when the order loads) — NOT today's date
- Mirrored to Supabase at `partials/{hub-slug}/{orderDate}.json` for cross-device access (delete-then-insert pattern, fire-and-forget)
- Validated on load: rejected if `orderDate` ≠ `S.orderDate` (the currently loaded order's date) or `items` is empty
- Partials persist across calendar days as long as the same order file is active — a partial for Condesa uploaded on May 13 will still resume on May 14, 15, etc.
- Becomes stale (silently ignored) only when the coordinator uploads a new order file for that hub (different date)
- Deleted automatically on `showSummary()` (order finished), `startAssembly()` (user chose fresh start), and `discardPartialSave()` (banner discard)

---

## Bluetooth Scanner Support
Scanners behave as keyboard input + Enter key. The barcode input field (`#bc-field`) auto-focuses when a product with a pending barcode is opened. `onBCKeydown` handles Enter to trigger validation.

---

## Brand / Styling
- Primary color: `#00c3b3` (Calii teal) — CSS variable `--green`
- Dark variant: `#007a6e` — `--green-dark`
- Light variant: `#E0F7F5` — `--green-light`
- All color references in CSS use these variables — do not hardcode `#4CAF50` or `#1B8A3E`

---

## UX Rules
- Toast: opacity-based show/hide, auto-hides after 1800ms (3000ms for expiry date errors), cleared on every screen navigation
- `beforeunload` warning fires if order is in progress and user tries to close/refresh
- Hub buttons disabled during Supabase fetch, re-enabled after
- No barcode placeholder shown (prevents manual typing instead of scanning)
- Qty field starts blank (not pre-filled with requested amount)
- Item order is suggested (sorted by position) but assembler can scroll freely
- ❓ legend button in list header explains all status icons and barcode states

### Inline accordion (item expand panels)
- Tapping a list row expands a panel **below it** — the rest of the list stays visible
- Tapping the same row again collapses it
- Only one panel open at a time — opening a new one collapses the previous
- Panel contains: product image (thumbnail), info tags (position, unit, barcode, Inv. CH), requested qty, barcode section, expiry date section, qty input, Faltante/Confirmar buttons
- `_expandedIdx` tracks which item is open (-1 = none)
- `refreshDetailPanel()` re-renders the open panel in-place (used by BC buttons and expiry bypass) while preserving unsaved qty and expiry field values
- `collapseDetail()` hides and empties the panel, removes the `expanded` CSS class from the row

---

## Known Issues / Notes
- `imagedb.json` fetch fails on `file://` — expected, use `python3 -m http.server 8080` locally
- localStorage backup is device-specific; coordinator uses Supabase reports for cross-device access
- Coordinator PIN is security-by-obscurity only (anon key is public in JS); sufficient for internal use

### Timezone fix (May 2026)
Mexico operates on permanent CST (UTC-6) with no daylight saving. Any assembly completed at or after 18:00 local would roll the UTC clock past midnight, causing report filenames to show the next calendar day with a "future" timestamp. Fixed by adding `localDateStr(d)` helper that builds `YYYY-MM-DD` from local date fields (`getFullYear/getMonth/getDate`) instead of `toISOString()`. All four date-stamping locations were updated: `todayStr()`, `getReportPath()`, `generateCSV()`, and `saveToHistory()`.

### Assembler feature (May 2026)
- Coordinator manages a named list of assemblers saved as `assemblers.json` in the bucket root
- Assembler selects their name from a dropdown after picking a hub; start button gated on both selections
- Assembler list is re-fetched inside `fetchOrderForHub` (not just at boot) to avoid a race condition where the boot fetch hadn't completed before the user picked a hub
- `slugify(name)` helper converts the assembler name to a safe filename segment (strips diacritics, replaces non-alphanumeric with `_`)
- `reportDisplayInfo(filename)` parses the new `HH-MM_Slug` suffix pattern and displays it as `HH:MM — Name` in the coordinator panel; legacy `HH-MM`-only filenames still display as `HH:MM`
- `generateCSV` signature: `(items, results, hub, assembler='', fileSuffix='')` — `assembler` is the session assembler (fallback for pending rows); per-confirmed-item assembler comes from `r.assembler`
- `getReportPath` signature: `(hub, assemblerSlug='')` — takes a **pre-slugified** string (output of `getAssemblersSlug`); does NOT apply `slugify()` internally
- `getAssemblersSlug(results, fallback='')` — collects all unique `r.assembler` values from results, sorts alphabetically, joins with `_`; used in `showSummary()` to build the filename slug
- Per-item `confirmedAt` timestamp added to result objects; set in `confirmItem()` and `markFaltante()`, used per-row in `generateCSV()`
- Per-item `assembler` field added to result objects; set in `confirmItem()` and `markFaltante()` to `S.assembler` at the moment of action

### Partial save / resume feature (May 2026)
- Assembly progress is auto-saved to localStorage + Supabase on every item confirm or faltante
- One partial save per hub — keyed by hub only, not by assembler, so any assembler can resume any hub's in-progress order
- When a hub is selected and the order loads, `checkForPartialSave()` runs immediately; if a matching partial exists a yellow banner shows: who has worked on it, how many items are done, and the last-saved time
- Banner buttons: **"↩ Continuar pedido"** (resumes with current assembler going forward) and **"Nuevo armado"** (discards partial and re-enables the start button)
- **"Iniciar Armado" button is disabled** while the banner is visible — re-enabled only after "Nuevo armado" is tapped. Prevents accidental overwrite.
- `resumePartialSave()` restores `S.items` and `S.results` (with ISO timestamps converted back to Date objects via `restoreDates()`); does not override `S.assembler` — the current session assembler continues from where the previous one left off
- `discardPartialSave()` removes the entry from both localStorage and Supabase (fire-and-forget delete), then calls `updateStartBtn()` to re-enable the button
- `startAssembly()` calls `clearPartialSave()` before initialising fresh results, so clicking "Iniciar Armado" after discarding via the banner is always safe
- `showSummary()` and `newOrder()` also call `clearPartialSave()` so no stale partials remain after an order is completed or abandoned
- `S.orderDate` — added to global state; set in `fetchOrderForHub` from the CSV filename (`uploadDate`). Used as the partial's identity key and Supabase path date. Reset to `''` on `newOrder()` and `saveAndExit()`.

#### Race condition fix (`_partialSaveSeq`)
`savePartialToSupabase` is fire-and-forget with two async steps (DELETE then POST). Without protection, a POST from an earlier save could land after `clearPartialSave` runs and re-create a stale partial in Supabase. Fix: a module-level `_partialSaveSeq` integer. `savePartialProgress` increments it and stamps the current value into the upload call. `clearPartialSave` also increments it. Before the POST step, `savePartialToSupabase` checks `if(seq !== _partialSaveSeq) return` — if anything newer intervened, the upload is aborted.

### Save and exit (May 2026)
- **💾 button** in the list screen header (between ❓ and "Finalizar pedido")
- `requestSaveAndExit()` — shows a confirmation modal with current progress count
- `saveAndExit()` — calls `savePartialProgress()` to flush to localStorage + Supabase, then resets all `S.*` state (including `S.orderDate`) and navigates home. Does **not** call `clearPartialSave` — the partial is intentionally kept for later resumption.

### Coordinator partial warning on upload (May 2026)
- `checkPartialThenUpload(hub, text, items, badge)` — inserted between CSV parse and `doUpload` in the upload flow
- Lists `partials/{hub-slug}/` in Supabase; if any `.json` files exist, shows a blocking modal: *"Existe un armado en progreso para este hub…"*
- On confirm: deletes all partial files for that hub, then proceeds to `doUpload`
- On cancel: upload is aborted, existing order and partial are untouched
- Also applies when the suspicious-barcode modal is confirmed (both checks run sequentially)

---

## Files Claude Has Direct Access To
- `/Users/adrianrodriguez/Desktop/armado-CH/index.html` — edit directly
- `/Users/adrianrodriguez/Desktop/armado-CH/imagedb.json` — read-only reference
- `/Users/adrianrodriguez/Desktop/armado-CH/netlify.toml` — cache config
- `/Users/adrianrodriguez/Desktop/armado-CH/sw.js` — service worker (v2)
- `/Users/adrianrodriguez/Desktop/armado-CH/armadoCHhandoff.md` — this file
- `/Users/adrianrodriguez/Desktop/armado-CH/armadoCH-v2-plan.md` — the v2 build spec

---

## 9. v2 relaunch — what changed

Built in seven phases (`armadoCH-v2-plan.md` §4). Each was independently deployable. Ground rules that
shaped everything: **the only assembler inputs are barcode + quantity**; advisory signals never block or
reorder; **never break the safety invariant** (any assembly with ≥1 confirmed item leaves a report *or* a
resumable partial); round 1 is sacred (nothing in §3.5 touches it).

### 9.0 Tunable constants (top of the `<script>`)
```
IDLE_GAP_MIN     = 5     // min · inter-item gaps longer than this are subtracted from minutosActivos
MAX_HANDLE_SEC   = 300   // per-item handling time cap
FLAG_GAP_MIN     = 15    // min · a longer inter-item gap flags the assembly PAUSA_LARGA
FLAG_MIN_SKUS    = 10    // orders smaller than this flag PEDIDO_CHICO
POLL_MS          = 10000 // list-screen poll for other hubs' picks
FLAG_NOTFOUND_MIN= 3     // distinct assemblers reporting "no se encontró" before a 🟡 (never 🔴)
MIN_SEARCH_SEC   = 10    // a faltante faster than this feeds faltantesRapidos
```

### 9.1 Expiry is read-only (Phase 1)
- No date field, no "Sin fecha" bypass. `computeMinExpDate()` / `formatMinExpDate()` kept, display-only.
- Panel: amber **`📅 Vencimiento mínimo: DD/MM/AAAA`** banner directly above the qty input (nothing when the CSV has no shelf-life columns). List row: compact `📅 DD/MM` chip.
- Report column `Fecha vencimiento` → **`Vencimiento mínimo`** (the computed minimum that was displayed; blank when none).
- **⚑ Faltante is now a two-button sub-branch**: `📭 No se encontró` (`ITEM_STATUS.SKIPPED` → Estado `Faltante`) / `📅 Fecha no cumple` (`ITEM_STATUS.SHORTDATE` → Estado `Faltante (fecha corta)`). Both aggregate as "faltante" in the progress bar / summary tile; counted separately in metrics (`faltantes`, `fechaCorta`). `SKIP_STATUSES = [SKIPPED, SHORTDATE]`.
- `screen-detail` (dead since the accordion refactor) deleted.
- `index.html` `<head>` now carries `no-cache` meta tags (single-file app updates in place).

### 9.2 Timing instrumentation + irregularity flags (Phase 2)
- **Per-result fields**: `openedAt`, `firstOpenedAt`, `touches` (in `openDetail`); `handleSec` (capped at `MAX_HANDLE_SEC`), `luzAlSkip` (in `confirmItem`/`markFaltante`); `bcAttempts` (in `onBCInput`); `_contradicted`, `_senal` (from the semáforo).
- **Per-session** `S.segments = [{start, end, assembler}]` — opened in `startAssembly`/`resumePartialSave`, closed in `saveAndExit`/`showSummary`/`exitKeepingPartial`, persisted in the partial payload. The gap between two segments (e.g. overnight) is never counted.
- **`computeOrderMetrics(items, results, segments, hub, opts)`** → the sidecar payload: `minutosReloj` (Σ segment durations) and `minutosActivos` (minus inter-item gaps > `IDLE_GAP_MIN`) — both reported, never merged; `skusHrReloj/Activo`, `segMedianoPorSku`, per-status counts, `porArmador[]`, `flags[]`, plus the §3.4 counters (`luzAlSkip{}`, `faltantesRapidos`, `faltantesDesmentidos`, `rojos/verdesEncontrados`), `ronda`.
- **Flags** (`FLAG_META` maps code → icon + text): `CRUZA_DIA` 🌙, `MULTI_SESION` ⏸, `PAUSA_LARGA` 🕐, `MULTI_ARMADOR` 👥, `PEDIDO_CHICO` 🔹, `INCOMPLETO` ⏳, `REPORTE_DIFERIDO` 📶 (set when the report went through the outbox), `SIN_TIEMPO` ⛔. Nothing is ever excluded — irregular assemblies are flagged, never dropped.
- **Sidecar**: `metrics/{hub-slug}/{same stem as the report}.json`, uploaded fire-and-forget in `showSummary`'s success branch (never blocks *Terminar armado*).
- Report CSV gains **`Segundos en producto`** (`handleSec`, blank for pending).

### 9.3 Coordinator metrics screen (Phase 3)
- `📊` in the coordinator header → `screen-metrics`. A **table**, one row per sidecar: `⚑ · Fecha · Hub · Armador(es) · SKUs · Min reloj · Min activos · SKUs/hr · Faltantes · Fecha corta · % completo · Seg/SKU`.
- Filters (armador / hub / periodo 7-30-90-todo / `Solo irregulares`, off by default) combine; click a header to sort (default Fecha desc). Flagged rows: amber left edge, never hidden.
- Footer: weighted SKUs/hr = **total SKUs ÷ total hours** (not the mean of rates); rows flagged `SIN_TIEMPO` are excluded and the footer says so.
- `⬇ CSV` exports the current filtered+sorted view + `Flags` + `Regular` columns, BOM, `metricas_armado_{fecha}.csv`.
- Immutable payloads cached in `localStorage` `calii_metrics_cache` (keyed by path); `↺` forces a full refetch. Empty/unreachable `metrics/` → empty state, no error.

### 9.4 Inventory semáforo — cross-hub contention (Phase 4)
- **`picks` Postgres table** (Supabase project, `INSERT` + `SELECT` for `anon`). One row per confirm/faltante via `recordPick()`: `sku_key` (`cleanBC` or `norm:<name>`), `cantidad` (0 for faltante), `senal` (`no_encontrado`/`fecha_corta`), `luz`, `seg_busqueda`, `ronda`. SQL is in `armadoCH-v2-plan.md` §3.4.
- **Poll** every `POLL_MS` while the list screen is open, plus after the assembler's own confirm, on order load, and on tapping the `N/N` progress label. Incremental (`ts >= last seen`).
- **Light** = `inventario − consumido por otros hubs` (own-hub picks are you). No consumption and no testimony → **green** (nothing shown), whatever the stock level — a zero-inventory SKU is the normal Faltante flow, not contention. 🟡 `0 < disponible < solicitado` **or** ≥ `FLAG_NOTFOUND_MIN` assemblers reported not finding it. 🔴 `disponible ≤ 0`, **arithmetic only** — testimony never reaches red; a `norm:`-joined SKU never reaches red.
- Panel block above the qty input shows the arithmetic (`Inventario CH 15 · otros hubs ya armaron 15 hoy`). **An open panel is never re-rendered by a poll** — chips update on list rows and on next open.
- Nothing is disabled or reordered by the light.
- **🔁 por revisar**: if you skip a SKU and another assembler later confirms a pick on it, your row gets a 🔁 chip, drops to a collapsed section at the bottom (`toggleRevisar()`), and the list header shows `🔁 N`. Pending rows never move. Metrics: `faltantesDesmentidos`.
- **Coordinator → "Inventario — hoy"** (collapsible, `toggleInvToday`): *⚠️ Conflictos* (SKUs where total demand across hubs > inventory, sorted by shortfall — parses every hub's current order) and *📭 Faltantes de hoy* (every unassembled SKU by hub + reason, contradictions flagged).
- **`picks` unreachable → no lights, no chips, no errors; assembly runs exactly as v1.**

### 9.5 Reserva + closing-inventory cross-check (Phase 5a) — read-only, measures nothing generated
- On upload, `doUpload` also writes `pedido_completo/{hub-slug}/{orderDate}.json` = `{orderDate, hub, uploadedAt, fields, rows}` — the **full request verbatim** (the uploaded order file is unchanged).
- `fetchOrderForHub` filters the assembler's list to **activos** (`Inventario hub saliente > 0`). Reserva rows are never shown. Fallback: an order with no inventory data at all shows everything (older / pre-filtered files unaffected).
- `📄` per hub row → `downloadNoSurtido()` → `no_surtido_{hub}_{fecha}.csv` (the reserva rows, original headers).
- **Coordinator → "🔄 Inventario de cierre"**: `uploadCierre()` parses the ~1 MB Retool export coordinator-side, stores a reduced projection at `inventario_cierre/{YYYY-MM-DD}.json` (`{k, nk, producto, unidad, final, recepcion, recepcionTs}`). **Revisar** (`revisarCierre`) cross-checks every hub's outstanding balance (`solicitado − armado`, from the latest R1 report + any R2) against it:
  - **Class A** — was reserva, `Final [AUTO] > 0` now (safe to test on the level; the row was never shown so no undiscounted assembly inflates it).
  - **Class B** — was an activo still short, with `Recepción > 0` and `Actualización recepción` **after** the order upload. `parseMxTs()` reads a tz-less timestamp as Mexico CST so this comparison is timezone-independent.
  - `sin coincidencia` rows are listed separately, never assumed to have or lack stock.
  - Headline: *"De N SKUs en reserva esta mañana, M tienen inventario ahora"* — the number the pilot exists to produce.
- Join key: `cleanBC` first, `normName` when the barcode is blank or duplicated in the inventory file.

### 9.6 Round-2 complementos (Phase 5b) — conditional on 5a's pilot number; code is ready
- **Revisar** shows **[ Generar complemento ]** per hub (+ **Generar todos**). Disabled while that hub's round 1 is unfinished (a `partials/{hub}/{date}.json` exists).
- `generarComplemento()` writes `orders/{hub-slug}/{orderDate}-r2.csv` from the candidate rows **verbatim** (all columns, incl. shelf-life), with `Solicitud (kg/pz)` overridden to the **outstanding balance**. Re-running Revisar drops already-generated SKUs (idempotent — `generatedR2Keys()`).
- The complemento auto-loads as **"🔄 Complemento del {fecha}"**: `S.ronda = 2`, `S.orderDate = "{date}-r2"` (own partial path, no collision with R1), `S._r1Armado` fetched from the R1 report. `recordPick` and the picks poll use `S.ronda`, so a complemento's semáforo only counts round-2 picks.
- **R2 register report**: `reports/{hub-slug}/{date}_r2_{HH-MM}_{Armadores}.csv`. First line `# COMPLEMENTO — capturar "Salida (kg/pz)"…`. Extra columns `Armado en la mañana` (R1 qty) · `Armado complemento` (R2 qty) · **`Salida (kg/pz)`** (their sum — the cumulative total the registrar types by hand). Only touched SKUs.
- **Round 1's order, report format, filename and registration step are byte-for-byte unchanged.** Coordinator report list indents R2 reports under their R1 sibling.

### 9.7 Registration copilot (Phase 5c)
- `📋` on each coordinator report row → `screen-registro`. Parses the report, sorts rows **alphabetically by product** (`localeCompare('es')`), splits into **⚠️ Revisar** (Estado ≠ Completo) then **✅ Completos**.
- Each row: a checkbox (tick as typed) + `Salida` + `Faltante` (= `Solicitado − Armado`). Running `N / total` counter; ticks persist in `localStorage` `calii_registro_ticks_{reportPath}`.
- `⬇` → `registro_{hub}_{fecha}.csv` — only `Producto, Salida (kg/pz), Faltante`, section-separated, BOM. Quantities as the exact string to type (integer for Pz, 2 decimals for Kg).
- **The typing stays 100% manual** — no Retool connection exists. This only makes it faster and harder to lose your place.

### 9.8 Offline resilience (Phase 6)
- **Outbox** — `localStorage` `calii_outbox`, entries `{id, kind:'report'|'metrics'|'pick', path, body, contentType, hub, orderDate, tries, ...}`. `isNetErr(e)` = the thrown message does **not** start with `NNN:` (a real server 4xx rethrows; a network failure queues).
- `sbUploadQueued(path, body, meta)` → `'uploaded'` | `'queued'` (or rejects on a hard 4xx). `flushOutbox()` runs on boot, `window 'online'`, opening the coordinator, and a 30 s timer that only ticks while the outbox is non-empty. Picks route through the same queue.
- **Invariant**: a *queued* report does **not** clear the partial in `showSummary` — `flushOutbox()` clears it (`clearPartialSave(hub, orderDate)`) when that specific report finally lands. `newOrder(keepPartial)` — the queued path passes `true`.
- **Summary screen, three states**: `✅ Reporte guardado` → *Terminar* → `newOrder()`; `📶 Sin conexión — el reporte se enviará solo` → *Terminar* **enabled** → `newOrder(true)`; `❌ Error al guardar` (hard 4xx) → *Reintentar* + *Salir (reporte pendiente)* (unchanged).
- **Home pill** `⏳ N pendiente(s) de enviar` (tap to flush; green `✓ Enviado` flash on success).
- **Order cache**: `fetchOrderForHub` stores `{orderDate, ronda, baseDate, items}` in `calii_order_cache_{hubSlug}` on success; on fetch failure it loads from there and shows `⚠ Sin conexión — usando el pedido guardado del {fecha}`.
- **Service worker** (`sw.js`): **network-first** for the shell (`index.html`, `imagedb.json`, PapaParse CDN) with cache fallback — online always gets the freshest deploy, offline still opens. **Deviation from the plan's "cache-first"** — chosen to eliminate the stale-app footgun. Supabase requests are never intercepted. **`CACHE_NAME` must be bumped on every deploy that changes `index.html`.** `skipWaiting` + `clients.claim`. SW registration silently no-ops on `http://192.168.x.x` LAN testing (needs HTTPS or localhost); works on Netlify.
- `netlify.toml` now sets `max-age=0, must-revalidate` for `/index.html` and `/sw.js`.

### 9.9 New Supabase storage paths (v2)
| Path | Written by | Content |
|---|---|---|
| `metrics/{hub-slug}/{report-stem}.json` | `uploadMetricsSidecar` | timing/flags sidecar (v:2) |
| `pedido_completo/{hub-slug}/{orderDate}.json` | `doUpload` | full request verbatim (`fields` + `rows`) |
| `inventario_cierre/{YYYY-MM-DD}.json` | `uploadCierre` | reduced closing-inventory projection |
| `orders/{hub-slug}/{orderDate}-r2.csv` | `generarComplemento` | round-2 order (Solicitud = outstanding balance) |
| `reports/{hub-slug}/{date}_r2_{HH-MM}_{Armadores}.csv` | `showSummary` (ronda 2) | round-2 register report (3 qty columns) |

Plus the `picks` Postgres table. New `localStorage` keys: `calii_outbox`, `calii_metrics_cache`, `calii_order_cache_{hubSlug}`, `calii_registro_ticks_{path}`.

### 9.10 Test fixtures
Keep one real order export and one real inventory export in `fixtures/` — **untracked** (`.gitignore` covers `fixtures/`, `inventario_*.csv`, etc.). The repo pushes to a public GitHub, and these are live business data.

---

## v3 backlog (deferred, with reasoning)

- **Prefilled quantity** — one-tap accept of the requested amount. Real speed lever, but it invites confirming a quantity that was never physically counted, and the error lands in inventory where it's expensive. Revisit only if v2 data shows quantity entry is a top-3 time sink; then consider prefilling only for `Pz` items with requested qty = 1.
- **Parallel multi-assembler picking** — two+ assemblers on one order simultaneously, each seeing what the other has claimed. Needs real-time claim locking (Supabase Realtime or a short-poll claims file), not an extension of the one-writer partial model. Biggest available cut in wall-clock minutes per order, and the biggest build. The `picks` table is the foundation.
- **Barcode exception simplification** — collapse `UNAVAIL` / `WRONGSYS` into one escape if v2 data shows the distinction isn't being used correctly. (`WRONGSYS` captures the physical code, which is the input for fixing the catalog — that's why it survived v2.)
- **Scheduled / automatic round-2 generation** — v2 has a button. Automate once the frequency is known from 5a.
- **Websocket / Supabase Realtime for the semáforo** — as a speed layer *over* the 10 s poll, never the source of truth (a warehouse wifi drop kills a socket silently; a missed poll is just re-asked).
- **Consolidated R1+R2 report** — only correct if registration ever moves to once-before-dispatch. Today R1 is registered immediately, so a consolidated file would double-count.
- **Retool live inventory** (read-only access) — the real fix for §9.5/§9.4: swap the `inventario` term for the live number, delete the closing-inventory upload step. Different ask from the write access §9.7 would need.

### Open questions (Jose)
1. **How is an assembly registered — typed row by row, or pasted/uploaded?** The order export ships with `Salida (kg/pz)`, `Faltante`, `Nro. de unidades`, `Envío - Solicitud (#)` empty — fill-in fields. If it's manual typing, the app could emit those rows pre-filled (bigger saving than anything on the assembly side). Shapes how far §9.7 goes.
2. **What time is the closing inventory export pulled?** Assumed ~17:00, leaving the evening for a complemento. Affects §9.5's operational fit, not the code.
