# Calii Armado CH — Project Handoff

## Overview
Mobile-friendly web app for assembling inter-hub orders at Calii (Mexican grocery delivery). A coordinator uploads CSV order files; assemblers on phones select their hub, the order auto-loads, and they assemble item by item confirming barcodes and quantities. Completed reports are saved to Supabase and downloadable by the coordinator from any device.

---

## Deployment
- **Live URL**: Netlify (connected to GitHub repo `joseromero-crypto/armado-CH`)
- **Repo**: `https://github.com/joseromero-crypto/armado-CH`
- **Branch**: `main` — Netlify auto-deploys on push
- **Local dev**: `cd ~/Desktop/armado-CH && python3 -m http.server 8080` → `http://localhost:8080`
- **Deploy workflow**: edit files → `git add . && git commit -m "..." && git push`

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
| Report (auto-saved on finish) | `reports/{hub-slug}/{YYYY-MM-DD}_{HH-MM}.csv` |
| Coordinator PIN | `coordinator_pin.txt` (bucket root) |

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
- Uploads CSV per hub via file picker
- Badge shows last upload date (e.g. `✓ 2026-05-07`) or `Sin pedido`
- 🗑 button next to each hub clears the uploaded order (with confirmation modal)
- **Active reports**: reports generated since the last upload for each hub — shown with ⬇ and 🗑 buttons
- **Archived reports**: all older reports — collapsible section ("📁 Ver historial"), shown dimmed
- Reports are never auto-deleted from Supabase — full history preserved

### Assembler flow
- Selects hub → app lists `orders/{hub-slug}/` and fetches the **latest** file (not date-restricted)
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
Columns: `Hub, Fecha, Hora, Posición armado, Producto, Código en sistema, Código físico escaneado, Unidad, Solicitado, Armado, Verificación código, Estado, Fecha vencimiento`

- Column `Fecha vencimiento` — assembler-entered expiry date (DD/MM/AAAA), `Sin fecha de vencimiento` if bypassed, blank if faltante/pending
- Column previously named `Recogido` — renamed to `Armado`
- BOM (`﻿`) prepended for Excel compatibility
- Auto-uploaded to Supabase on `showSummary()` via `getReportPath(hub)` (sync, timestamp-based)
- Download filename: `{Hub_slug}_{YYYY-MM-DD}_{HH-MM}.csv`
- State is captured in **local variables** at the start of `showSummary` before upload — prevents race condition where `newOrder()` clears global state mid-async
- Also saved to localStorage as a silent backup (not shown in UI)

---

## Supabase API Functions
```js
sbUpload(path, content)   // POST with x-upsert:true — creates or overwrites
sbFetch(path)             // GET public URL (no auth required)
sbList(prefix)            // POST list, limit 500, sorted by name desc
sbDelete(path)            // DELETE /storage/v1/object/{BUCKET}/{path} — requires DELETE policy
```
**Important**: `sbDelete` uses the single-object endpoint (`DELETE .../object/{bucket}/{path}`), NOT the batch `/object/delete/{bucket}` prefixes endpoint. The prefixes endpoint treats paths as folder prefixes, not exact filenames, and will return "object not found" for exact file paths.

---

## localStorage Backup
Key: `calii_order_history`
- Entries purged daily (only today's kept)
- Each entry: `{ id, date, hub, total, ok, skipped, time, filename, csv }`
- Silent fallback only — not shown in UI
- Primary storage is Supabase

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
- `todayStr()` uses UTC — edge case if app is used right at midnight in MX timezone

---

## Files Claude Has Direct Access To
- `/Users/adrianrodriguez/Desktop/armado-CH/index.html` — edit directly
- `/Users/adrianrodriguez/Desktop/armado-CH/imagedb.json` — read-only reference
- `/Users/adrianrodriguez/Desktop/armado-CH/netlify.toml` — cache config
- `/Users/adrianrodriguez/Desktop/armado-CH/armadoCHhandoff.md` — this file
