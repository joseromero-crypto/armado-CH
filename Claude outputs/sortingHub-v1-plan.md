# Calii Sorting Hub — v1 Build Plan

> Build spec for Claude Code. Drop this file in the root of the new repo and start Claude Code with the prompt in §11.
> Working name: **Sorting Hub** (repo `sorting-hub`). Rename freely — only the slugs/bucket names in §4 need to stay consistent.

---

## 1. Problem & goal

When a product that was at **0 stock** arrives at a hub, nobody has a reliable reference for where it goes. The only source is the person's memory (Retool has it, but it's buried in tools built for something else). Over a couple of months the sorting drifts and goes stale.

**Goal:** a phone web app where a hub worker picks their hub once, then just **scans** — and immediately sees the product image and its **sorting position (Pasillo-Estante-Nivel)** for *that* hub.

Success criteria for v1:
- Scan → result on screen in **< 1 second** (lookup is 100% local after load).
- Works with a Bluetooth/USB scanner **and** the phone camera.
- Keeps working if the hub wifi drops (last downloaded sorting stays on the phone).
- A coordinator can refresh any hub's sorting file or the image base in under a minute.

**Out of scope for v1 (decided):** editing positions, reporting wrong/missing positions, scan logs/metrics, hub map sketch (see §10 for later versions). The app is **read-only** for hub users — it shows what the file says, nothing else.

---

## 2. Tech stack (same philosophy as armado-CH)

- **Single `index.html`**, vanilla HTML/CSS/JS, no framework, no build step.
- **PapaParse 5.4.1** (cdnjs) — CSV parsing (same URL armado-CH uses).
- **Camera scanning:** native `BarcodeDetector` when the browser has it (Chrome/Android) → fallback to **html5-qrcode 2.3.8** (jsDelivr or cdnjs — verify the URL loads) for iOS Safari and anything without it. Load the fallback lazily, only when the camera button is tapped.
- **Supabase Storage** (new, separate project — §9.1) for the per-hub sorting files, image base and coordinator PIN. Use **`@supabase/supabase-js@2` from jsDelivr** so the new-style *publishable* key and the legacy *anon* key both work without hand-rolled headers.
- **Netlify** static hosting, auto-deploy from GitHub `main`.
- **Service worker + web manifest** so it installs to the home screen and opens offline.
- Brand: Calii teal `--green:#00c3b3`, `--green-dark:#007a6e`, `--green-light:#E0F7F5` (copy the variables from armado-CH).
- All UI text in **Spanish**. All dates pinned to `America/Monterrey` via `Intl` (lesson from armado-CH's UTC+8 phones).

### Files
```
sorting-hub/
├── index.html          # entire app
├── sw.js               # service worker (network-first shell, like armado-CH)
├── manifest.webmanifest
├── icon-192.png, icon-512.png
├── imagedb.json        # copied from armado-CH as the image fallback floor
├── netlify.toml        # cache headers (copy armado-CH's, adjust names)
├── .gitignore          # fixtures/ and *.csv — real business data never goes to GitHub
├── CLAUDE.md           # short repo notes for Claude Code (created in Phase 0)
└── sortingHub-v1-plan.md   # this file
```

---

## 3. Screens & flow

```
[Inicio: elegir hub] ──tap hub──▶ [Escanear] ──scan──▶ result card (same screen)
        │                              │
        └─ "Coordinador" (PIN) ──▶ [Panel coordinador: subir sorting por hub · subir Masterview]
```

### 3.1 Inicio — choose hub
- 8 big buttons: **Contry, Cumbres, Guadalupe, San Nicolás, Avícola, Zapopan, Condesa, CH Guadalupe**.
- Under each: "Sorting actualizado dd/mm" (or "Sin archivo" greyed out and not selectable).
- The chosen hub is remembered on the device (`localStorage`, try/catch). Next time the app opens **straight into Escanear** for that hub.
- Small "Coordinador" link at the bottom → PIN.

### 3.2 Escanear — the only thing a hub user does
- Header: hub name (big) · "Cambiar hub" link · freshness line "Sorting del dd/mm/aaaa" — turns **amber if older than `STALE_DAYS` (14)**.
- One barcode input, **always focused** (BT scanners type + Enter). Re-focus after every result, after closing the camera, and on any tap outside a button. Use `inputmode="none"` so the on-screen keyboard doesn't pop up when a hardware scanner is used; a small ⌨️ toggle switches to `inputmode="numeric"` for typing a code by hand.
- 📷 **Cámara** button → full-screen camera overlay (rear camera), detects EAN-13, EAN-8, UPC-A, UPC-E, Code-128. On detection: vibrate, close overlay, show result.
- **Result card** (replaces the previous one on every scan — no "OK" tap needed between scans):
  - Product image (large, `object-fit:contain`, placeholder if missing).
  - Product name.
  - **Position, huge**: `B-4-6`, and below it the breakdown **Pasillo B · Estante 4 · Nivel 6** (+ "Posición en nivel: 8" when that column has a value).
  - Temperature badge from `Temp`: Ambiente / Refrigerado (1–14) / Congelado (-18).
  - Barcode (small, grey).
- **Incomplete position** (only aisle, e.g. `[N- - ]`): show what exists — big `N`, breakdown "Pasillo N · Estante — · Nivel —". No warning text, no action (read-only decision).
- **No position at all**: big "Sin posición asignada".
- **Several products share the barcode** (10 duplicates in the example file, e.g. the Calii artesanal cookies): show all of them as stacked cards, each with its own position.
- **Barcode not in this hub's file**: "No está en el sorting de {hub}". If the image base knows the barcode, still show the image + name from it so the user at least confirms what it is.
- Quick feedback: short beep/vibration on found, different pattern on not found (`navigator.vibrate`, guarded).
- Keep the last 5 scans as a small tappable strip under the card (in memory only) — handy when unloading a box with several SKUs.

### 3.3 Coordinator panel (PIN)
- PIN read from `config/coordinator_pin.txt` in the bucket (same pattern as armado-CH). Session-cached, resets on refresh.
- **Per hub** row: last upload date/time, product count, position-quality summary (§5.4), and a **"Subir sorting"** file input.
- **Image base**: "Subir exportación Masterview" — weekly or when an image bug is reported (reuse armado-CH's `masterviewReduce` + ≥1000-key sanity check).

---

## 4. Data & storage

### 4.1 Hubs
| Display | Slug |
|---|---|
| MH Contry | `mh-contry` |
| MH Cumbres | `mh-cumbres` |
| MH Guadalupe | `mh-guadalupe` |
| MH San Nicolás | `mh-san-nicolas` |
| MH Avícola | `mh-avicola` |
| MH Zapopan | `mh-zapopan` |
| MH Condesa | `mh-condesa` |
| CH Guadalupe | `ch-guadalupe` |

Keep the list in one `HUBS` constant at the top of the script (same slugs as armado-CH for the 7 MH hubs).

### 4.2 Supabase Storage layout — bucket `sorting-hub` (public)
| Path | Content |
|---|---|
| `sorting/{slug}/latest.json` | Slim sorting for the hub (§4.4) |
| `sorting/{slug}/version.txt` | ISO timestamp of the upload — phones check this tiny file first and only download `latest.json` when it changed |
| `sorting/{slug}/raw/{YYYY-MM-DD_HH-mm}.csv` | Original uploaded CSV, kept as history / undo |
| `imagedb/latest.json` + `imagedb/version.txt` | Image map from Masterview (same shape as armado-CH) |
| `config/coordinator_pin.txt` | 4-digit PIN |

Overwrites use **upsert** (the new project gets an UPDATE policy — §9.1), so there's no delete-then-insert gap like in armado-CH.

### 4.3 Input: sorting CSV (Retool "table-data" export, one per hub)
Columns in the example (4,856 products):
`Producto, Proveedor, Código de barras, SKU proveedor, Temp, Kg/Pz, Inventario, Categoría, Posición armado, Pasillo, Estante, Nivel, Posición dentro del nivel (opcional), Requiere sorting`

Parsing rules:
- UTF-8 with BOM (strip it). Match headers with armado-CH's `normHeader`/`pickCol` (case/accent-insensitive).
- **Required headers:** `Producto`, `Código de barras`, `Pasillo`, `Estante`, `Nivel`. If missing → block the upload with a clear message.
- Barcode: `cleanBC` (scientific notation / `.0`) then `bcKey` (strip leading zeros) — both copied from armado-CH. Scanners that prepend a `0` (UPC-A read as EAN-13) then match automatically.
- **Position source of truth = the `Pasillo` / `Estante` / `Nivel` columns.** Fall back to parsing `Posición armado` (`[B-4-6]`) only when all three are empty.
- Normalize for display only: trim, uppercase the aisle. Never "fix" values beyond that — the app shows what the file says.
- Ignored in v1: `Proveedor`, `SKU proveedor`, `Kg/Pz`, `Inventario` (snapshot, would mislead), `Categoría`, `Requiere sorting`.

### 4.4 Stored shape (`latest.json`)
```json
{
  "hub": "mh-contry",
  "updatedAt": "2026-09-22T17:08:01-06:00",
  "sourceFile": "table-data - 2026-09-22T170801.904.csv",
  "count": 4856,
  "quality": { "full": 4069, "partial": 737, "none": 50, "oddAisles": ["i","|","G}","Ñ","0","3","p","f","k","z"] },
  "items": [
    ["Aceite de oliva extra virgen Inés 500ml", "7503026980057", "B", "4", "6", "", "Ambiente"]
  ]
}
```
Array rows (name, bcKey, pasillo, estante, nivel, subpos, temp) keep it ~400–500 KB for ~5k products. Build the lookup index on the phone after load: `Map<bcKey, row[]>` (array to support duplicates).

### 4.5 Phone-side cache (offline)
- On hub open: fetch `version.txt` (`cache:'no-store'`). If it matches the cached version → use cache; else download `latest.json` and cache it. Same for the image base.
- Cache in `localStorage` per hub key (`sh_sorting_{slug}`) wrapped in try/catch; only the **selected** hub is cached, to stay well under the ~5 MB limit (sorting ≈0.5 MB + images ≈1.3 MB). If `setItem` throws, keep working from memory and show a small "sin caché offline" note.
- Offline with a cache → works normally and the freshness line says "(sin conexión)". Offline with no cache → "Conéctate a internet una vez para descargar el sorting de {hub}".

---

## 5. Upload safeguards (coordinator side)

These exist because the most likely failure is a **wrong file on the right hub**, and nothing on the hub side would notice.

1. **Required headers** check (§4.3) — block.
2. **Row count sanity** — fewer than 500 products → block ("¿Es la exportación completa?").
3. **Wrong-hub guard** — compare against the hub's current `latest.json`: if **more than 30 %** of barcodes present in both files changed position, show a blocking confirm: "El X % de las posiciones cambió respecto al archivo anterior de {hub}. ¿Seguro que es el archivo de {hub}?". Different hubs have different sortings, so a mix-up shows up as a massive change.
4. **Quality summary** shown after every upload and stored in `quality`: complete positions / only aisle / no position / odd aisle values (lowercase, symbols, digits — in the example: `i`, `|`, `G}`, `Ñ`, `0`, `3`, `p`, `f`, `k`, `z`). This is informational for the coordinator to fix in Retool; the app still shows the values as-is.
5. **Barcode corruption check** — reuse armado-CH's rule (ends in 3+ zeros and not a key in the image base) → warning modal listing them.
6. Always save the raw CSV to `sorting/{slug}/raw/` before publishing, so a bad upload can be rolled back by re-uploading the previous file.

---

## 6. Barcode lookup details

```
scan → cleanBC → bcKey → index.get(key)
  ├─ found (1)      → single card
  ├─ found (n>1)    → stacked cards
  └─ not found      → try imageDb[key] for name/image → "No está en el sorting de {hub}"
```
- Debounce: ignore an identical scan within 1.5 s (camera fires repeatedly).
- Strip whitespace/control chars some BT scanners append (`\r`, `\t`, GS `\x1d`).
- GS1-128 / long codes: if the scan is longer than 14 digits, also try the embedded GTIN (AI `01` → 14 digits → `bcKey`).

---

## 7. Camera scanning details

- Needs **HTTPS** (Netlify gives it) and camera permission; show a clear Spanish message if denied ("Permite la cámara en la configuración del navegador").
- Rear camera (`facingMode: 'environment'`), torch toggle if `track.getCapabilities().torch` exists (hub back rooms are dark).
- Stop the stream every time the overlay closes (battery + iOS gets upset otherwise).
- Path A: `BarcodeDetector` + `requestAnimationFrame` loop on a `<video>`.
- Path B: html5-qrcode (`Html5Qrcode` class, not the full UI widget) restricted to 1D formats for speed.

---

## 8. PWA / offline

- `manifest.webmanifest`: name "Calii Sorting", `display: standalone`, teal theme color, icons 192/512.
- `sw.js`: copy armado-CH's network-first pattern. Never intercept `supabase.co`. Pre-cache shell, PapaParse, `imagedb.json`. Bump `CACHE_NAME` on every deploy that changes `index.html`.
- Tell hubs to "Agregar a pantalla de inicio" so it opens like an app.

---

## 9. Setup steps (you do these once)

### 9.1 Supabase (new project)
1. supabase.com → **New project** → name `calii-sorting` → pick the closest region (e.g. East US / West US) → set a DB password (save it, you won't need it for v1).
2. **Storage → New bucket** → name `sorting-hub` → **Public bucket ON**.
3. **SQL Editor → New query**, run:
   ```sql
   create policy "sh read"   on storage.objects for select to anon using (bucket_id = 'sorting-hub');
   create policy "sh insert" on storage.objects for insert to anon with check (bucket_id = 'sorting-hub');
   create policy "sh update" on storage.objects for update to anon using (bucket_id = 'sorting-hub') with check (bucket_id = 'sorting-hub');
   create policy "sh delete" on storage.objects for delete to anon using (bucket_id = 'sorting-hub');
   ```
4. Storage → `sorting-hub` → create folder `config` → upload a text file `coordinator_pin.txt` containing only the PIN (e.g. `4821`).
5. **Project Settings → API Keys**: copy the **Project URL** and the **publishable** key (or legacy **anon** key). These go in the top of `index.html` — they're meant to be public. **Never** paste the `secret` / `service_role` key anywhere in the app.
6. Free-tier note: projects pause after ~7 days with no activity. Daily scanning keeps it awake; if it ever pauses, "Restore" in the dashboard.

> Honest security note: same model as armado-CH — the PIN is checked in the browser and the anon key can write to the bucket, so someone who reads the page source could overwrite files. Acceptable for an internal tool; the `raw/` history (§5.6) is the safety net. If it ever matters, v2 can move uploads behind a Supabase Edge Function that checks the PIN server-side.

### 9.2 GitHub
1. Create the folder `~/Desktop/sorting-hub`, put this plan inside, and open Claude Code there.
2. Claude Code runs `git init`, creates `.gitignore` first (with `fixtures/` and `*.csv`), then commits.
3. **GitHub Desktop → File → Add Local Repository → `~/Desktop/sorting-hub` → Publish repository** (account `joseromero-crypto`, private is fine).
4. From then on: commit in the terminal (or let Claude Code commit), **push with the Push button in GitHub Desktop**.

### 9.3 Netlify
1. app.netlify.com → **Add new site → Import an existing project → GitHub** → authorize if asked → pick `sorting-hub`.
2. Build settings: **Build command: empty · Publish directory: `.`** → Deploy.
3. Site configuration → **Change site name** → e.g. `calii-sorting` → URL `calii-sorting.netlify.app`.
4. Every push to `main` redeploys automatically (~30 s).

### 9.4 First data load
1. Open the site → Coordinador → PIN.
2. Upload the Masterview export (image base).
3. For each hub, export its sorting table from Retool (Código de barras column as plain text) and upload it on that hub's row.
4. On a hub phone: open the site, pick the hub, Agregar a pantalla de inicio, scan a few items.

---

## 10. Build phases for Claude Code

Each phase ends with a commit and a short test list. Don't start the next phase until the current one works on a real phone.

**Phase 0 — Scaffold**
- Repo files from §2, `.gitignore` first, `CLAUDE.md` with: single-file rule, no build step, hub slugs, bucket paths, "never `git push` from the terminal — Jose pushes with GitHub Desktop".
- Constants block at the top of the script: `SB_URL`, `SB_KEY`, `BUCKET`, `HUBS`, `STALE_DAYS=14`, `WRONG_HUB_THRESHOLD=0.30`, `MIN_ROWS=500`, `TZ='America/Monterrey'`.
- Copy from armado-CH: `cleanBC`, `bcKey`, `normHeader`, `pickCol`, `normName`, `masterviewReduce`, image-DB loader, `serverNow`/timezone helpers, brand CSS variables, `imagedb.json`.
- Local test: `python3 -m http.server 8080`.

**Phase 1 — Coordinator uploads**
- PIN screen, per-hub upload rows, Masterview upload.
- CSV → slim JSON (§4.4) with all safeguards (§5). Test with the example file in `fixtures/` (gitignored).

**Phase 2 — Hub select + scan (BT scanner / typed)**
- Inicio, Escanear, lookup index, result card states (full / partial / none / duplicate / not found), last-5 strip, remembered hub, freshness line.

**Phase 3 — Camera**
- Overlay, BarcodeDetector path, html5-qrcode fallback, torch, permission errors, debounce.

**Phase 4 — Offline + PWA**
- version.txt caching, localStorage cache, service worker, manifest/icons, offline messages.

**Phase 5 — QA**
- Test on one Android (Chrome) and one iPhone (Safari), with and without a BT scanner, online and in airplane mode.
- Cases: normal barcode, barcode with scanner-added leading `0`, duplicated barcode, aisle-only position, no position, barcode from another hub, product without image, stale file (>14 days), wrong-hub upload guard, bad CSV (missing headers).

### Later versions (not now)
- **Hub map sketch**: per-hub layout JSON (`layouts/{slug}.json` with aisle rectangles) and highlight the scanned position in color. Keep all position parsing in one `parsePosition()` so the map reuses it.
- Reporting wrong/missing positions to the coordinator.
- Scan log (which SKUs arrive at 0 stock, per hub, per day).
- Search by name for the ~350 products with no barcode.

---

## 11. Prompt to start Claude Code

> Read `sortingHub-v1-plan.md`. We're building a brand-new app, not modifying armado-CH — but copy the listed helpers from `~/Desktop/armado-CH/index.html` (read-only, don't edit that repo). Do Phase 0 now, then stop and tell me what to test. Ask before any decision the plan doesn't cover. Commit at the end of each phase; I'll push from GitHub Desktop.

---

## 12. Open questions for Jose

1. **`B01`–`B16` aisles** are all `-18` products with no estante/nivel in the example — are these freezers? If so, v1 could label them "Congelador B09" instead of "Pasillo B09".
2. Which hub is the example file from? (Only matters for naming the test fixture.)
3. Is **14 days** the right point to flag a sorting file as old?
4. Should CH Guadalupe be visually separated from the 7 MH hubs on the start screen?
