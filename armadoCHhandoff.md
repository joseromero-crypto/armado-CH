# Calii Armado CH — Project Handoff

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
| Partial save (in-progress assembly) | `partials/{hub-slug}/{YYYY-MM-DD}.json` |
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
Columns: `Hub, Armador, Fecha, Hora, Posición armado, Producto, Código en sistema, Código físico escaneado, Unidad, Solicitado, Armado, Verificación código, Estado, Fecha vencimiento`

- Column `Armador` — **per-item**: whichever assembler confirmed that row (`r.assembler`); falls back to the session assembler for any pending items. Supports multi-assembler orders.
- Column `Hora` — time the **individual item** was confirmed or marked faltante (not the report generation time). Items left pending fall back to report generation time.
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
- Mirrored to Supabase at `partials/{hub-slug}/{YYYY-MM-DD}.json` for cross-device access (delete-then-insert pattern, fire-and-forget)
- Validated on load: rejected if `orderDate` ≠ today or `items` is empty
- Deleted automatically on `showSummary()` (order finished) and `startAssembly()` (user chose fresh start)

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
- One partial save per hub per day — keyed by hub only, not by assembler, so any assembler can resume any hub's in-progress order
- When a hub is selected and the order loads, `checkForPartialSave()` runs immediately; if a partial exists for today a yellow banner shows: who has worked on it, how many items are done, and the last-saved time
- Banner buttons: **"↩ Continuar pedido"** (resumes with current assembler going forward) and **"Nuevo armado"** (discards partial and re-enables the start button)
- **"Iniciar Armado" button is disabled** while the banner is visible — re-enabled only after "Nuevo armado" is tapped. Prevents accidental overwrite.
- `resumePartialSave()` restores `S.items` and `S.results` (with ISO timestamps converted back to Date objects via `restoreDates()`); does not override `S.assembler` — the current session assembler continues from where the previous one left off
- `discardPartialSave()` removes the entry from both localStorage and Supabase (fire-and-forget delete), then calls `updateStartBtn()` to re-enable the button
- `startAssembly()` calls `clearPartialSave()` before initialising fresh results, so clicking "Iniciar Armado" after discarding via the banner is always safe
- `showSummary()` and `newOrder()` also call `clearPartialSave()` so no stale partials remain after an order is completed or abandoned

---

## Files Claude Has Direct Access To
- `/Users/adrianrodriguez/Desktop/armado-CH/index.html` — edit directly
- `/Users/adrianrodriguez/Desktop/armado-CH/imagedb.json` — read-only reference
- `/Users/adrianrodriguez/Desktop/armado-CH/netlify.toml` — cache config
- `/Users/adrianrodriguez/Desktop/armado-CH/armadoCHhandoff.md` — this file
