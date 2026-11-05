# Unify Masterview — one catalog for Armado CH, Sorting Hub, MH Recibo and Invoice Reader

Status: Phases 1, 2 and 3 done 2026-11-05, and the first real upload is published. Phases 4.1, 4.2 and 4.3, and the three static apps' parts of Phase 6, are done and committed, and go live when Jose pushes. Phase 4.4 is next; until then Invoice Reader doesn't read `masterview/`. Written 2026-11-03 from the code in the four repos and the all-cities export
(`table-data - 2026-11-03T101825.372.csv`, which had the wrong column set; see §0).

This file lives in all four repos (armado-CH, sorting-hub, mh-recibo, calii-invoice-reader), as
identical copies. In each repo, do only that repo's phases. If you change the plan, copy the change to
the other three.

**Revision 2026-11-03 (b):**
- Retool can't export all cities with all columns: the query fails, and the columns can't be chosen.
- So the upload is **one full-column export per city** (Monterrey, Saltillo, CDMX, Guadalajara), all
  sent together in one upload.
- The all-cities file with fewer columns is only used to cross-check SKU counts (Phase 3).

## Why

- Today every app has its own copy of Masterview, and each one is Monterrey only:
  - Armado CH → `solcitudesarmado/imagedb/`
  - Sorting Hub → `sorting-hub/imagedb/`
  - MH Recibo reads both of those and uses whichever was uploaded last
  - Invoice Reader → its own `products` table, in a different Supabase project
- Products that exist only in Saltillo, CDMX or Guadalajara are missing everywhere. A CDMX scan in
  Sorting Hub shows nothing, and a Saltillo invoice with a local product can't be matched or found by
  search.
- The goal is **one upload, one place, every city**. That place has one row per SKU for what is the
  same everywhere (name, barcode, image), plus one row per SKU and city for what changes by city
  (provider, local name, whether it's sold there).

## Facts from the all-cities export (2026-11-03)

- 23,086 rows, one per SKU and city. No SKU repeats inside a city. `sku` is the same product in every
  city, so **`sku` is the product key**.
- `id` is the Retool row id, and it is **different per city**. It must not be used as the product key:
  Invoice Reader uses it today, and with this file each product would be stored 3–5 times.
- City counts:
  - Monterrey 4,896, Saltillo 4,714, CDMX 4,528, Guadalajara 4,474, Querétaro 4,471, Puebla 3.
- SKUs that are not in Monterrey:
  - Saltillo +56, CDMX +302, Guadalajara +302, Puebla +3.
  - Only 48 of the CDMX and Guadalajara extras overlap, so 598 extras in total without Querétaro.
  - Querétaro would add +624.
- Columns that differ by city for the same SKU: Proveedor (4,111 SKUs), prices, tiers, `1 in N`,
  `% of Sales`.
- `Item` differs for 36 SKUs. Most are capitalization, but some are regional names:
  - DBK414 is "Tomate huaje ahorramás" in Monterrey and Saltillo, and "Jitomate saladet ahorramás" in
    CDMX and Guadalajara.
  - BAJ837 is "Naranja importada" in Monterrey and "Naranja navel importada" in CDMX.

## Decisions (answers to the open questions)

1. **Where the master Masterview lives.** In the shared armado-ch Supabase project
   (`uuqqtksxlgkztenojufm`), in two places:
   - Tables `mv_imports`, `mv_products` and `mv_product_city`, for Invoice Reader. These are the source
     of truth.
   - A public bucket `masterview/` with a small `latest.json` and `version.txt`, for the three static
     apps. This file is generated from the tables on every import.

   Putting it "in Sorting Hub" would change nothing about cost. Since 2026-10-29 Sorting Hub, Armado CH
   and MH Recibo are all buckets in the **same project**, so storage and egress are billed to that one
   project whichever bucket holds the file. A neutral `masterview` bucket keeps it from looking like it
   belongs to one app.

2. **Does size matter?** A little, and only in two places:
   - **Phone download.** The slim JSON is about 1.5 MB, a little over today's 1.3 MB, because it now
     includes about 600 more products. Phones cache it and only download it again when `version.txt`
     changes. A weekly upload means about one download per phone per week, which is negligible.
   - **Database.** The four full exports have about 90 columns × 18.6k rows, around 20 MB of CSV. Storing every
     column in `raw` per city would be about 100 MB of jsonb, most of it prices that no app reads. The
     importer **keeps only a whitelist of columns** (§2.3). Expected size is under 25 MB.

3. **Is it "the most recent of any uploaded"?** No. There is exactly one upload path and one file, so
   nothing has to decide which copy is newest. The "newest of two buckets" logic in MH Recibo goes
   away.

4. **Remove the upload buttons in the other apps?** **Yes.** Once the new path is live (Phase 6),
   remove "Subir Masterview" from Armado CH (coordinator tab) and Sorting Hub (Inicio). Replace it with
   a read-only status line:

   > Masterview actualizado el 03/11 · se sube desde Invoice Reader → Masterview (admin)

   Otherwise someone uploads in Sorting Hub, sees "✓ actualizado", and nothing reads that copy.

5. **Who uploads, and from where?** **Invoice Reader → a new admin-only "Masterview" screen** (§2.4).
   Today the catalog panel is visible to everyone and only the import is restricted (`canImport`). The
   new screen is hidden from receivers entirely, and only `members.role = 'admin'` sees the entry. It is the only one of
   the four apps with a login (Google, @calii.com, `admin` role) and server-side code (Netlify functions
   with the service-role key).
   - The three static apps write with the public anon key, and their repos on GitHub are public. If
     uploads stayed there, anyone with the key could overwrite or wipe the catalog.
   - With uploads only through the server function, the `masterview` bucket and `mv_*` tables get **no
     anon write policies at all**.

6. **City handling, kept simple.** Product lookups never filter by city (show everything, so nothing
   goes missing). Each app knows its hub's city only to:
   - rank results: the hub's city first;
   - show an advisory pill, "No se vende en {Ciudad}", where that helps (Sorting Hub, Invoice Reader).
     It never blocks anything.

7. **Hub → city map.** One source: a new `city` column on Invoice Reader's `hubs` table. The importer
   copies it into `latest.json` (`hubCities`), so the static apps don't hard-code it.

   | Hub | City |
   |---|---|
   | MH Contry, MH Cumbres, MH Guadalupe, MH San Nicolás, CH Guadalupe | Monterrey |
   | MH Avícola | Saltillo |
   | MH Zapopan | Guadalajara |
   | MH Condesa | CDMX |

8. **Only the four cities with hubs are uploaded:** Monterrey, Saltillo, CDMX and Guadalajara.
   - Querétaro and Puebla are left out.
   - If a hub opens there later, export that city, add it to the upload, and add a row to `hubs` with
     its city. The importer accepts any city name.

9. **Store only the columns that are used** (the whitelist in §2.3).
   - If a column is needed later, add it to the whitelist and upload again.
   - The last raw CSV of each city is kept in the `catalogs` bucket (one file per city, overwritten on
     each upload), so a new column can be filled from it right away without a new export.

10. **One upload = the per-city files together.** Pick 1–4 CSVs at once in the Masterview screen.
    - Each file is one city: the `city` column, all rows the same value.
    - **Only the cities in the upload are replaced.** The others keep their last import, so a CDMX-only
      fix can be just the CDMX file.
    - The normal weekly routine is all four.

---

## Phase 0: Jose: get the right export

- [ ] Export Masterview **once per city**: Monterrey, Saltillo, CDMX and Guadalajara.
  - Use the **full column set**. That's the one with `Image URL`, `Código de Barras`, `SKU Proveedor`,
    `Unidad de compra` and `Peso neto o piezas (por unidad de compra)`, plus `city`. It's the same set
    as `private/catalog/table-data - 2026-10-27T161019.962.csv`.
- [ ] Save the four files to `~/Desktop/calii-invoice-reader/private/catalog/` (gitignored), with the
      city in the file name (e.g. `mv_monterrey_2026-11-03.csv`).
- [ ] Also put the all-cities lean export from 2026-11-03 there. Phase 3 uses it to check that no city
      lost SKUs.

---

## Phase 1: Invoice Reader → armado-ch Supabase project (repo `calii-invoice-reader`)

**Result: done 2026-11-05.** The steps below are kept as the record of what was planned.

- **Where it runs:** `.env.local` and the Netlify site (`https://invoicereader.joseromero.co`) both point to
  `uuqqtksxlgkztenojufm`. The old project is untouched. Don't delete it until Jose says so.
- **Collisions:** none. Nothing belonging to Armado CH, Sorting Hub or MH Recibo was changed.
- **What was applied:** `supabase/shared-project/setup.sql`, generated from `supabase/migrations`, including the
  attempt-fence migration and explicit grants on every table (`authenticated` read, `service_role` read/write, no
  `anon`).
- **What's in the project now:** 1 organization (same id as the old project), 9 hubs, 4,896 products from the
  2026-11-04 Retool export, 11 `supplier_mappings` (all linked to imported products), Jose as admin.
  `quantity_conversions` had 0 rows, so there was nothing to carry.
- **Checks passed:** bench `--replay` 238/238 quantities, 212 identity, 201 bulk-confirmable; 236/236 unit tests.
  - Local read through `netlify functions:serve`: LALA CWB-02767766, 15 rows, $0.027.
  - Live read on the Netlify site: Mission Foods 5004590079, 3 rows, $0.018.
- **Env names differ from step 6:** the app uses `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_PUBLISHABLE_KEY`. On Netlify, values are per deploy context, and `VITE_*` needs a redeploy.
- **What Phase 2 needs to know:**
  - The database is shared: never write a migration that loops over every function or table in `public`. An
    unscoped loop in `20261028160041_private_rls_helpers.sql` would have rewritten MH Recibo's `rec_alert_*`
    functions, so it now lists Invoice Reader's functions by name.
  - armado-ch limits API calls to a few seconds, so `import_masterview` (120 s) and `read_catalog_snapshot` (60 s,
    ~11 s measured) carry their own `statement_timeout`.
  - A Masterview import took about 29 s locally. That may be too long for a synchronous Netlify function and hasn't
    been tried on the live site, so the importer must handle it.
  - `import_masterview` upserts on `(org_id, external_id)`, so product ids survive a re-import.
  - `server/auth.ts` requires exactly one organization and deletes non-@calii Google logins. That's harmless today
    because no other app uses Supabase Auth, but it matters if one starts to.

**Check first, then act.** On 2026-11-03, `.env.local` still pointed to `mudavlghievjyddtjudp` (its own
project).

1. Check `SUPABASE_URL` / `VITE_SUPABASE_URL` in `.env.local` and in the Netlify site's env vars.
   - If both already point to project `uuqqtksxlgkztenojufm`, **skip to Phase 2**.
   - Otherwise, continue.
2. **Check for name collisions in the target project** before applying anything. List the existing
   tables, functions, triggers and buckets in `uuqqtksxlgkztenojufm`.
   - Invoice Reader creates generic names: `organizations`, `members`, `products`, `hubs`,
     `hub_members`, `documents`, … and buckets `invoices`, `catalogs`.
   - The project already has Armado's `picks` and `partial_events`, MH Recibo's `rec_*`, and the buckets
     `solcitudesarmado`, `sorting-hub` and `recibo`.
   - **If anything collides, stop and tell Jose. Never alter or drop another app's objects.**
3. Apply the migrations in order to the armado-ch project. Exception: `202610270001`'s `products` /
   `catalog_imports` and `202610270003`'s import function. Apply them for now, since they are replaced
   in Phase 2 and supplier_mappings needs `products` to exist until then.
   - **Also apply `20261102120000_lean_reader_no_attempt_fence.sql`**, which is not applied yet in the
     old project.
   - **Grants:** tables created after 2026-10-30 get no automatic Data API grants. Each migration
     already runs `grant select … to authenticated`. Add `grant select, insert, update, delete …
     to service_role` for every table, in the same SQL.
4. **Auth.** Enable the Google provider in the armado-ch project, with the same OAuth client and the
   new callback URL added in Google Cloud. Add the site URL and redirect URLs. Then check the
   @calii.com-only rule (`server/auth.ts`) and the auto-join as receiver.
   - Jose must be re-made `admin` in `members` after his first sign-in.
5. **Data to carry over.** Keep only `supplier_mappings` and `quantity_conversions`: they are learned
   knowledge. Their `product_id` values are remapped in Phase 2.
   - Everything else (sessions, documents, invoice photos, extraction jobs) is test data. Ask Jose
     whether to copy it or start clean. Default to **start clean**.
6. Update the env vars (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, anon key, `VITE_*`) in
   `.env.local` and on Netlify.
   - Run the bench with `--replay` (free) and one live upload through `netlify functions:serve`.
   - Done when a read lands in the new project.
7. Leave the old project alone for a week, then Jose deletes it.

---

## Phase 2: Shared catalog + the one importer (repo `calii-invoice-reader`)

**Result: done 2026-11-05.** The steps below are kept as the record of what was planned.

- **Where it runs:** deployed to `https://invoicereader.joseromero.co`. `products`, `catalog_imports`, `product_id` and the old functions
  are retired. The deploy first failed Netlify's secret scan: this file held the full Supabase URL, which equals the
  `SUPABASE_URL` value. Use the project ref in tracked files.
- **First real upload:** Jose, from the Masterview screen, all four cities. The run took 70 s, and `latest.json` and `version.txt`
  are public and agree (version `0e330dae`, 5,492 products, 48 `alt` keys, 8 hubs in `hubCities`). 72 products updated, 0 added,
  0 retired, 36 SKUs change name between cities, 56 barcodes with more than one SKU, no warnings. ZYZ063 is in `map`. All 11
  mappings point to current products. The 5 values that were older in the 11-03 files are current again.
- **Not checked yet:** an invoice read and confirm on the deployed site since the switch.
- **Left in the project:** the test import's `mv_imports` row, which is harmless.
- **Test import report (11-03 files, before the first upload):** Monterrey 4,896 / Saltillo 4,714 (+56 exclusive, 238 missing vs Monterrey) / CDMX 4,528 (+302, 670
  missing) / Guadalajara 4,474 (+302, 724 missing). 29 SKUs change name between cities, 56 barcodes belong to more than one
  SKU, 0 retired, no warnings. Full report: `private/catalog/mv-test-import-report.json`.
- **Remap:** 11 of 11 `supplier_mappings` mapped, no SKU changed, 0 unmapped. `quantity_conversions` has 0 rows.
- **Checks passed:** bench `--replay` 238/238 quantities, 212 identity, 201 bulk-confirmable, on the old CSV and on the 11-03
  Monterrey file through the importer's parser and whitelist (`--masterview`), with identical reports; 259/259 unit tests.
  The new catalog read has the same 4,896 SKUs as `products`.
- **Data:** the 11-03 files are a day older than `products` (11-04). 5 values differ for that reason alone: pieces per
  purchase unit on VWJ653, KFE338, PSH792, PDK723, and the name of ABP084.
- **Timing:** the four-file import took about 46 s locally, plus 11 s of upload. `read_mv_catalog` takes 1.9 s and 9 MB, down
  from ~11 s and 22 MB. `latest.json` would be 2.0 MB, not the 1.5 MB estimated.
- **Changed from the plan:**
  - `product_id` is replaced by a new column `mv_product_id` instead of being swapped in place, and retiring is a separate
    migration. So old and new code both work until the retire migration runs, and `confirm_receiving_row_v1` accepts both ids.
  - Matching reads Monterrey rows only (`MATCH_CITY` in `lean/catalog.ts`), so it stays exactly as before. Products that exist
    only in other cities reach matching and search in Phase 4.4.
  - The browser uploads to `catalogs/masterview/{city}/incoming-*.csv` with signed URLs. `latest.csv` is replaced only after the
    import commits, so a rejected file can't overwrite the last good one or break "Releer últimos archivos".
  - The background function reports through `catalogs/masterview/job.json`, because a rejected upload leaves no `mv_imports` row.
    That file also allows one import at a time.
  - `alt` only lists cities the `map` entry doesn't cover. A barcode repeated inside one city stays in the report, and readers
    keep the `map` entry there.
  - Re-importing identical files reuses the `mv_imports` row and moves its date.
  - `Item` keeps its exact text, including trailing spaces, because it's what gets copied back to Retool.
  - Invoice rows saved before the switch hold Retool ids and can't be confirmed until "Actualizar coincidencias" is pressed.

### 2.1 Schema: new migration `2026110xxxxx_masterview_shared.sql`

```sql
create table public.mv_imports(
  id uuid primary key default gen_random_uuid(),
  uploaded_at timestamptz not null default now(),
  uploaded_by uuid references auth.users,
  source_hash text not null unique,
  report jsonb not null);          -- counts per city, exclusives, name variants, barcode conflicts, warnings

create table public.mv_products(
  id uuid primary key default gen_random_uuid(),   -- stable; supplier_mappings / quantity_conversions point here
  sku text not null unique,
  name text not null,              -- Monterrey Item if MTY has it, else first city by CITY_PRIORITY
  base_city text not null,
  barcode text,                    -- from the base row; per-city overrides live in mv_product_city
  image_url text, full_res_image_url text,
  calii_unit text, marca text, description text, main_category text, temp text,
  raw jsonb not null,              -- whitelisted product-level columns only (§2.3)
  import_id uuid not null references public.mv_imports);

create table public.mv_product_city(
  sku text not null references public.mv_products(sku) on delete cascade,
  city text not null,
  retool_id text not null,         -- the export's `id`, per city
  name text not null,              -- Item in that city (regional names)
  barcode text,                    -- only if different from mv_products.barcode
  proveedor text, sku_proveedor text,
  unidad_compra text, piezas_por_unidad numeric,
  deshabilitar_compras boolean,
  raw jsonb not null,              -- whitelisted city-level columns only (§2.3)
  import_id uuid not null references public.mv_imports,
  primary key(sku, city));
create index mv_product_city_barcode on public.mv_product_city(barcode);
create index mv_product_city_supplier on public.mv_product_city(proveedor, sku_proveedor);
create index mv_products_barcode on public.mv_products(barcode);

alter table public.hubs add column city text;   -- seed with the table in Decisions §7
```

- **RLS:** enable it on all three tables. Add a `select` policy for authenticated members only. **No
  anon access, and no insert/update/delete except service_role.**
- **Grants**, in the same file:
  - `grant select … to authenticated`
  - `grant select, insert, update, delete … to service_role`
  - no anon grant
- **Bucket** `masterview`: public = true (read by URL, like `sorting-hub/imagedb`).
  - Create **no** storage policies for anon or authenticated. Only service_role writes.
  - The `catalogs` bucket's 15 MB limit is fine as it is: each per-city full export is about 5 MB.
  - Raw uploads are stored as `catalogs/masterview/{city}/latest.csv`, overwritten each time (see
    Decision 9).

### 2.2 Move Invoice Reader off its own `products`

- `supplier_mappings.product_id` and `quantity_conversions.product_id` → `mv_products.id`:
  1. Add the new FK columns.
  2. Fill them by joining old `products.external_id` (a Monterrey Retool id) → `mv_product_city.retool_id`
     → `sku` → `mv_products.id`.
  3. Report any rows that don't map. Don't drop them silently.
  4. Swap the FKs.
- Remove `products`, `catalog_imports`, `organizations.catalog_revision` and `import_masterview()` /
  `read_catalog_snapshot()` once nothing reads them.
  - The revision check (`catalogVersion` in `load`) now compares against the latest `mv_imports.id`.
- `review->product->id` in `invoice_rows` now holds `mv_products.id`. Old test rows can stay as they
  are.

### 2.3 Importer: rewrite `netlify/functions/catalog.ts` + `shared/catalog.ts` (`parseCatalog`)

- **Input: 1–4 CSV files in one upload**, each already in `catalogs/masterview/{city}/`. The browser
  uploads them first, then calls the function with the list of paths.
  - Each file must have exactly one value in `city`. Reject a file with mixed cities, and an upload
    with the same city twice.
  - Name the city in each error ("El archivo de CDMX no tiene la columna Image URL").
  - **All-or-nothing:** if any file fails a check, nothing is written for any city.
- **Run it as a background function** (`catalog-background.ts`, like `extract-background`):
  - Parsing about 20 MB across four files and upserting about 24k rows won't fit in a synchronous
    function's time limit.
  - The UI polls `mv_imports` for the result.
- **Partial uploads:**
  1. Replace `mv_product_city` only for the cities in the upload.
  2. Then recompute `mv_products` (base row, name, barcode, image) for every SKU touched.
  3. A SKU becomes retired only when it has **no city rows left** at all.
- **Required columns:** `id`, `sku`, `Item`, `city`, `Código de Barras`, `Image URL`, `Proveedor`.
  - If `Image URL` or `Código de Barras` is missing, reject with:
    > Falta Image URL / Código de Barras — ¿es la exportación completa de Masterview?

    That's the mistake made on 2026-11-03.
- **Rejects** (nothing is written):
  - duplicate `sku` inside a file
  - empty `sku` or `city`
  - a city whose row count dropped >10% vs its previous import, unless the admin ticks "Sí, es
    correcto" and uploads again. This catches a file that was exported with a filter on.
- **Base row per SKU:** Monterrey, else `CITY_PRIORITY = ['Monterrey','Saltillo','CDMX','Guadalajara']`.
  - Normalize city names (accents, case).
  - An unknown city is imported as it is, with a warning, and ranks after the listed ones.
- **Whitelist:** store only the columns some app reads. Everything else, mainly price and competitor
  columns, is dropped.
  - Product level: Image URL, Full Res. Image URL, Item, Description, Marca, Calii Unit, Default
    Selection Unit, Temp (°C), main_category, Internal Weight Per Piece (g), Source Unit, Assembly
    Category, Requires exp. date confirmation.
  - City level: id, city, Item, Código de Barras, Proveedor, SKU Proveedor, Unidad de compra, Peso neto
    o piezas (por unidad de compra), Deshabilitar compras, Shelf life min. user (days), Shelf life min.
    supplier (days).
  - Keep the list in one constant in `shared/catalog.ts`, and run `grep` across `lean/` and `server/`
    for every `raw[...]` use before trimming. If `match.ts` reads a column that's not on the list, add
    it.
  - To add a column later:
    1. Add it to the constant.
    2. Run the admin's "Releer últimos archivos" button, which re-imports from
       `catalogs/masterview/{city}/latest.csv` without a new Retool export.
- **Write order, all in one transaction (RPC, security definer, granted to service_role only):**
  1. Insert `mv_imports`.
  2. Upsert `mv_products` on `sku`, keeping `id` stable for existing SKUs.
  3. Replace `mv_product_city`: delete the rows not in the file, upsert the rest.

  SKUs missing from the new file are **not** deleted from `mv_products`, because mappings point at
  them. Mark them `raw.retired_at` instead, and the readers skip them.
- **Then publish the slim JSON** to `masterview/`. Write `latest.json` first and `version.txt` last
  (ISO timestamp = `mv_imports.uploaded_at`):

  ```json
  { "updatedAt": "...", "version": "<mv_imports.id>", "count": 5877,
    "cities": ["Monterrey","Saltillo","CDMX","Guadalajara"],
    "cityUpdatedAt": { "Monterrey":"...", "CDMX":"..." },
    "hubCities": { "mh-contry":"Monterrey", "...":"...", "mh-condesa":"CDMX" },
    "map": {
      "<bcKey>":   { "url":"...", "name":"<base name>", "sku":"APG267", "c":["Monterrey","Saltillo"] },
      "<normName>": "<url>"
    },
    "alt": { "<bcKey>": [ { "url":"...", "name":"...", "sku":"...", "c":["CDMX"] } ] }
  }
  ```

  - `map` keeps the shape Sorting Hub already reads: barcode entries are `{url, name}`, name entries
    are plain strings. `sku` and `c` are new fields, and old readers just ignore them.
  - Name keys are added for **every** city's `Item`, so "jitomate saladet ahorramás" finds the same
    image as "tomate huaje ahorramás". On a name clash, the Monterrey name wins.
  - `bcKey` = `cleanBC` + strip leading zeros, same as the apps. Each city row's barcode is indexed.
  - If one barcode maps to **different SKUs** in different cities, the base-city SKU goes in `map` and
    the others in `alt`. Readers pick from `alt` when its `c` includes the hub's city. List these in
    the import report too.
  - Products with no image still get a barcode entry (`url: null`), so the name and cities show up.
    Today they are skipped entirely.
- **Report**, shown in the Masterview screen after the import and stored in `mv_imports.report`:
  - rows and SKUs per city
  - exclusives per city (not in Monterrey)
  - SKUs per city missing vs Monterrey
  - SKUs that changed name between cities
  - barcode conflicts
  - SKUs retired
  - added / updated / unchanged

### 2.4 Admin-only "Masterview" screen (replaces the panel in `src/CatalogUpload.tsx`)

- **Visibility.** The entry (a header link or menu item "Masterview") renders only for
  `members.role = 'admin'`. Receivers never see the panel.
  - The function checks `admin` server-side too, as today. Hiding the link is not the security.
- **One file picker with multiple selection.** Each selected file shows as a row: detected city, rows,
  and any error.
  - The "Subir" button enables when every row is valid.
  - Cities not selected are shown as "sin cambios (última: 27/10)".
- **Header line:**
  > Único lugar donde se sube Masterview. Armado CH, Sorting Hub y MH Recibo lo leen de aquí.
- **Last import:** date, who uploaded it, the cities included, and the report (§2.3). Also the date of
  each city's last update, so a city that hasn't been refreshed in weeks stands out.
- **"Releer últimos archivos":** re-runs the import from the stored raw CSVs (Decision 9). Admin only.

### 2.5 Tests

- Update `tests/catalog-database.test.ts` and add `tests/masterview-import.test.ts`, using a small
  multi-city fixture built in code. No real data.
- Cover:
  - base-row choice
  - regional names
  - barcode conflict → `alt`
  - duplicate SKU in a file rejected
  - mixed-city file rejected
  - same city twice rejected
  - missing `Image URL` rejected (all-or-nothing across files)
  - city drop >10% blocked
  - partial upload (CDMX only) leaves the other cities untouched
  - a SKU retired only when no city has it
- Run `npm test`.

---

## Phase 3: Validate (repo `calii-invoice-reader`, script, free)

**Result: done 2026-11-05, nothing to accept.** `scripts/mv-compare.ts` on the four 11-03 exports against the all-cities lean file:

| City | Full / lean rows | SKU differences | `Item`, `Proveedor`, `Calii Unit`, `Source Unit` differences | No image | No barcode | Barcodes repeated in the city |
|---|---|---|---|---|---|---|
| Monterrey | 4,896 / 4,896 | 0 | 0 | 0 | 344 | 12 |
| Saltillo | 4,714 / 4,714 | 0 | 0 | 0 | 323 | 8 |
| CDMX | 4,528 / 4,528 | 0 | 0 | 0 | 310 | 7 |
| Guadalajara | 4,474 / 4,474 | 0 | 0 | 0 | 304 | 6 |

Full list: `private/catalog/mv-compare-2026-11-03.md`.

`scripts/mv-compare.ts <all-cities-lean.csv> <city.csv>...`: for each per-city full export, compare it
with that city's rows in the all-cities lean file.

- **Same set of SKUs**, with the count and the SKUs missing on either side listed.
  - Expected counts: Monterrey 4,896, Saltillo 4,714, CDMX 4,528, Guadalajara 4,474, give or take
    catalog changes since 11-03.
- For the columns both files have (`Item`, `Proveedor`, `Calii Unit`, `Source Unit`), list the
  differences.
- Also report, per city:
  - rows with no `Image URL`
  - rows with no `Código de Barras`
  - barcodes that repeat inside the city
- **Done when** the SKU sets match, or Jose has reviewed and accepted each difference.
- After that, the four per-city exports are the routine and the lean file isn't needed. Re-run this
  check only if a city's count looks off in the import report.

---

## Phase 4: Readers: switch the three static apps to `masterview/` first

Same change in each app's `loadImageDB`. Each app keeps its own fallbacks during the transition.

```js
const MV_BUCKET='masterview';
// 1. masterview/version.txt → cached latest.json (cache key = version)
// 2. old per-app imagedb/ (transition only; removed in Phase 6)
// 3. bundled imagedb.json
```

- Read `hubCities` from the JSON. **Don't hard-code it.** If it's missing (old JSON, or a fallback
  copy), treat the city as unknown and skip any city logic.
- Always read entries through `imgUrl()` / `imgName()`, since barcode entries are objects now.
  - Copy Sorting Hub's helpers (`imgUrl`, `imgName`, `pickEntry` in sorting-hub/index.html) where an app
    reads entries as plain strings.
- `alt` lookup: `pickEntry(bcKey, city)` returns `map[bcKey]` if its `c` includes `city`, else the `alt`
  entry whose `c` includes `city`, else `map[bcKey]`. Check `map` first: see the 4.1 result.
- Each repo:
  - bump `CACHE_NAME` in `sw.js`
  - test on localhost with write helpers stubbed (local runs write to prod)
  - commit
  - **don't push from the terminal**; Jose pushes with GitHub Desktop

### 4.1 Sorting Hub (repo `sorting-hub`)

**Result: done 2026-11-05, committed, not pushed.** The steps below are kept as the record of what was planned.

- **Live file checked first** (version `0e330dae`): `map` has 10,563 keys (5,081 barcodes, 5,482 names), `alt` 48 keys with one entry
  each, `hubCities` 8 hubs, `cityUpdatedAt` 4 cities. No `url: null` entries yet, and `version.txt` equals `updatedAt`.
- **Differs from the plan:**
  - `alt` is not limited to cities `map` doesn't cover. 3 barcodes repeated inside a city are in both: 7501055363346 (Saltillo, CDMX),
    7501005113373 (Saltillo, CDMX) and 7501055354672 (Guadalajara). Those stay on the `map` entry, so `pickEntry` checks `map` first.
    Taking `alt` first would show the wrong SKU there. The other three apps need the same order.
  - ZYZ063 (75041663) is CDMX and Guadalajara, not CDMX-only, and it's in Condesa's and Zapopan's sorting files.
  - Masterview is cached in Cache Storage (`calii-masterview`), not localStorage. About 2.03M characters plus a 0.39M sorting cache sits
    right at iPhone Safari's localStorage limit (about 2.5M, from memory, not measured here). `sw.js` must not delete that cache on activate.
  - A failed `version.txt` used to skip the cache and go to the bundled file. The order is now: `masterview/`, last cached Masterview
    whatever its version, old `sorting-hub/imagedb/`, bundled. MH Recibo and Armado CH should check for the same gap.
  - The bundled `imagedb.json` is a full copy of `latest.json`, so the offline floor has `alt`, `hubCities` and the pill too.
  - `masterviewReduce` went with `handleMasterviewFile`, since nothing else used it.
- **Checks passed, on localhost against the live bucket, with write helpers stubbed (0 writes):**
  - Condesa + 75041663: image, name, position O-1-4, no pill. Zapopan the same with G-4-2.
  - Contry + 75041663: image, name, "No se vende en Monterrey", "No está en el sorting de MH Contry".
  - Monterrey barcodes at Contry, in the file or not: no pill. Unknown barcode: no pill, no name.
  - Kinder Bueno 8005276 at Condesa: "No se vende en CDMX". `alt` hit 7501005113373 at Guadalajara: ZHA456. The 3 repeated barcodes: `map` SKU.
  - No `hubCities`: no pill.
  - Headless Chrome, network offline and server stopped: the shell came from the service worker and Masterview from the cache (10,563 keys,
    48 `alt`, 8 hubs), with the pill, the sorting cache and the 05/11 status line all working. With that cache deleted, the bundled file gave
    the same results. A new `CACHE_NAME` removed the old shell cache and kept `calii-masterview`. The old-imagedb fallback loaded 9,437 keys with no city logic.
- **Not checked yet:** real phones (Android Chrome, iPhone Safari).

- `loadImageDB` → `masterview/` first.
- Scan of a barcode that's **not in the hub's sorting file but is in Masterview** (the §3.2 path that
  already exists): if `c` doesn't include the hub's city, add a black pill:
  > No se vende en {Ciudad}

  It follows the theme (black pill, no new colour). This is what catches a Monterrey item scanned at
  Condesa.
- No change when the barcode is in the sorting file: the sorting file is the truth for that hub.
- `refreshImgDbStatus()` reads `masterview/version.txt`.
- Update CLAUDE.md's "Image base" section.

### 4.2 MH Recibo (repo `mh-recibo`)

**Result: done 2026-11-05, committed, not pushed.** The steps below are kept as the record of what was planned.

- **Differs from the plan:**
  - The city line is in the not-in-envío modal ("Este producto no viene en el envío."), not "Código no reconocido". `resolveCode` turns any
    code with a Masterview name into a product, so a code Masterview knows never reaches "Código no reconocido".
  - It also shows when that modal opens from a "Sin código" search, because it's checked on the product's barcode.
  - The old two-bucket fallback was removed here, not kept until Phase 6, so the order is `masterview/`, last cached Masterview whatever
    its version, bundled.
  - `mr_imgdb_cache` is removed at the start of every load, not only after a successful `masterview/` read, so a phone that opens offline frees it too.
  - `hubCity()` reads `INI.hub`, not `S.hub`, because Recepciones shows photos without opening Recibir. `getImgUrl`'s memo key includes the
    city, or a hub change would show the other city's `alt` photo.
  - A barcode entry with no `url` now falls through to the name lookup, as in Sorting Hub.
  - The Inicio line now uses `count` (5,492 productos), not keys / 2.
  - The loader still accepts the old flat `imagedb.json`: `netlify.toml` caches that file for 30 days, so a phone can hold it for a while. It
    works without city logic, and only offline on a phone with no cached Masterview. Sorting Hub has the same header. Not changed here.
- **Checks passed, on localhost in headless Chrome against the live bucket (version `0e330dae`), with `recibo` and `rec_*` faked in memory
  (0 writes reached Supabase; only GET and HEAD passed):**
  - First load: `version.txt` + `latest.json`, nothing from the old `imagedb/` folders, 10,563 keys, 48 `alt`, 8 hubs, `calii-masterview`
    written, old localStorage entry gone. Second load: `version.txt` only.
  - Kinder Bueno 8005276 at test-hub (`c` is Guadalajara only): image, name and "Este producto no se vende en Monterrey". Same line with CDMX at
    Condesa, no line at Zapopan.
  - Monterrey product not in the envío: same modal, no line. Unknown code: "Código no reconocido", unchanged.
  - `alt` hit 7501005113373 at Zapopan: ZHA456, CRX111 at Contry. The 3 repeated barcodes: `map` SKU. No `hubCities`: no line.
  - Real flow with the 29/10 Contry envío at test-hub: upload, 104 lines scanned, Kinder received as No esperado, 3 differences answered one by
    one, closed. Report and `cerrar` event written to the fake backend: 105 lines, 3 differences, 1 no esperado.
  - Network off, Supabase blocked and local server stopped: shell from the service worker, Masterview from the cache, and a real scan shows the
    name and the line. With that cache deleted, the bundled file gives the same results. A new `CACHE_NAME` removed the old shell cache and kept
    `calii-masterview`.
- **Not checked yet:** real phones (Android Chrome, iPhone Safari).

- `loadImageDB`: `masterview/` first, then the current "newest of `solcitudesarmado` / `sorting-hub`"
  logic as a fallback, then bundled. Remove the fallback in Phase 6.
- Unknown-code modal: if the code is in Masterview but `c` doesn't include the hub's city, add one
  line:
  > Este producto no se vende en {Ciudad}

  It's advisory only. No new modal, and it doesn't change the flow (rules 1–3).
- Update CLAUDE.md ("Product photos" line) and HANDOFF.md.

### 4.3 Armado CH (repo `armado-CH`)

**Result: done 2026-11-05, committed, not pushed.** The steps below are kept as the record of what was planned.

- **Differs from the plan:**
  - The order is `masterview/`, last cached Masterview whatever its version, bundled. The old `solcitudesarmado/imagedb/` read is gone, not kept as a
    fallback. `calii_imgdb_cache` is removed at the start of every load, and its step in `trySetLocalStorage`'s eviction went with it.
  - No city logic: `alt` and `hubCities` are not read, so `pickEntry` and `hubCity` were not copied.
  - `masterviewReduce` went with the upload. `pickCol` and `normHeader` stay, because Verificar captura uses them.
  - `detectSuspiciousBarcodes` still only asks whether the key exists, not `imgUrl()`: a known barcode with no image isn't a corrupted barcode.
  - `imgName()` was copied but nothing calls it yet: Armado shows the order's own product names.
  - `getImgUrl` skips any entry with no `url` at every step, not only the barcode step.
  - Images only appear in the assembly list and the item detail. The summary, Pedidos armados and Registro show text only.
- **Checks passed, on localhost in headless Chrome against the live bucket (version `0e330dae`), with Supabase faked in memory (0 writes reached Supabase, and
  a second block at the browser's network layer caught 0):**
  - First load: `version.txt` + `latest.json`, nothing from `imagedb/`, 10,563 keys, 5,492 productos, `calii-masterview` written, old localStorage entry
    gone. Second load: `version.txt` only.
  - Full MH Contry assembly with the 19/10 order (451 rows, 152 activos: complete, partial, sobrante, faltante and fecha corta), run through the same steps on
    the old and new builds with a fixed clock. Report path, report CSV (152 rows), all 616 writes, item order, list text, summary, Registro and Pedidos armados:
    identical.
  - Images: 150 of the 152 activos are the same. The other two are better: Tang has a newer photo, and Totopos Calii showed a Charras photo before.
  - Condesa order: 7501052470245 and 75013356 (CDMX only) and 75041663 (CDMX and Guadalajara) show their images, and none of the three was in the old file.
  - Network off and local server stopped: shell from the service worker, Masterview from the cache, and the Imágenes line still shows 05/11. With that cache
    deleted, the bundled file gives 10,563 keys and "Masterview sin conexión · …". The old flat file still loads.
  - Real upgrade on one origin, from the `-p6` build to this one: old shell cache removed, `calii-masterview` created, old localStorage entry gone. A later
    `CACHE_NAME` keeps `calii-masterview` with no new download.
- **Data to review:** 141 of the old file's 9,387 keys are not in Masterview now (62 barcodes, 79 names). `normName` is the same on both sides, so this is
  the catalog, not the code. When such a product is ordered, the old first-word and prefix fallbacks can show another product's photo. In the 19/10 order's reserva
  rows, Nachos Tostitos 400g (7501011173521) now shows Doritos, and Totopos Nūbe lemon pepper (767203598955) shows Charras. Barcode 767203598894, Totopos Nūbe
  enchilados in that order, is IYL425 Chips de camote in Masterview.
- **Follow-up 2026-11-05, committed, not pushed:** `getImgUrl` is now barcode then exact name only, and skips a barcode whose Masterview name shares no real word with the order's; in the 19/10 order 3 of 451 rows lost a photo (the three reserva rows above), the other 448 and all 152 activos are unchanged.
- **Not checked yet:** real phones (Android Chrome, iPhone Safari).

- `loadImageDB` → `masterview/` first.
- `masterviewReduce`'s output and the cached shape change to object entries. Use `imgUrl()`
  everywhere `S.imgDb[...]` is read as a string.
- **No city pill.** Assemblers pick what the order says, and rule 2 says advisory signals never block
  or reorder.
- Update `armadoCHhandoff.md` in the same commit (CLAUDE.md rule).
- Run one assembly end to end (no change to `confirmItem` / `generateCSV` expected).

### 4.4 Invoice Reader (repo `calii-invoice-reader`): city-aware matching

- `server/workspace.ts` `asCatalogItem(product, cityRow)`:
  - supplier, supplier SKU, unidad de compra and piezas por unidad come from **the hub's city row**,
    falling back to the base row
  - add every city's name as `aliases` for description matching
- `match()`:
  - the supplier vote and the supplier-SKU lookup use the hub's city first, then the whole catalog
  - candidates from another city are labelled "Otra ciudad ({Ciudad})" and never auto-confirm
    (`review` with that reason)
- The hub's city comes from `hubs.city`. If it's null, behave as today (whole catalog, Monterrey
  names).
- Check with `--replay` on the bench (free). All 13 invoices are Monterrey-region, so expect 238/238
  quantities and identity ≥ the current 212/238 with **no new wrong auto-confirms**.
  - Any regression → fix it in `match.ts`, not the prompt.

---

## Phase 5: First real upload

1. Jose uploads the four city files together in Invoice Reader → Masterview.
2. Check the report against the Phase 0 numbers: Monterrey ≈4,896, Saltillo ≈4,714, CDMX ≈4,528,
   Guadalajara ≈4,474, exclusives ≈56 / 302 / 302.
3. Open each static app on a phone. The status line shows the new date, and a CDMX-only barcode
   (e.g. ZYZ063, Aceite de canola Capullo 400ml) shows image + name in Sorting Hub with Condesa
   selected.

## Phase 6: Remove the other upload paths (after Phase 5 is live)

**Result, Sorting Hub, MH Recibo and Armado CH: done 2026-11-05, committed, not pushed.**

Sorting Hub:

- `handleMasterviewFile` and "Subir Masterview" are gone from Inicio. The card now reads "Masterview actualizado el 05/11 · se sube desde
  Invoice Reader (admin)", from `masterview/version.txt`, or the cached version when offline.
- Bundled `imagedb.json` refreshed from version `0e330dae` (1.3 MB to 2.0 MB).
- The old `sorting-hub/imagedb/` files were left in place and stay in `loadImageDB` as a fallback.

MH Recibo:

- The two-bucket fallback is gone from `loadImageDB`, and `ARMADO_BUCKET` went with it, since nothing else used it. MH Recibo no longer reads
  either old `imagedb/` folder. It never had an upload button.
- Bundled `imagedb.json` refreshed from version `0e330dae` (1.3 MB to 2.0 MB).

Armado CH:

- `uploadImageDB`, `masterviewReduce` and the upload button are gone. 🖼 Imágenes now reads "Masterview actualizado el 05/11 · se sube desde Invoice Reader (admin)",
  from `masterview/version.txt`, or the cached version when offline, with "5,492 productos" from `count` on the line below.
- Bundled `imagedb.json` is a full copy of `latest.json`, version `0e330dae` (1.3 MB to 2.0 MB).
- The old `solcitudesarmado/imagedb/` files were left in place, and nothing reads them.
- `netlify.toml` now revalidates `/imagedb.json` (`max-age=0, must-revalidate`). A phone that already holds the old file under the 30-day header keeps it until that
  expires, and the service worker's install can precache that same copy. It only matters offline with no cached Masterview, and the loader still reads it. Sorting Hub
  and MH Recibo still have the 30-day header.

- **Armado CH:** remove `uploadImageDB` and its button from the coordinator tab. Replace them with the
  status line from Decisions §4.
- **Sorting Hub:** remove `handleMasterviewFile` and "Subir Masterview" from Inicio. Same status line.
- **MH Recibo:** drop the old two-bucket fallback from `loadImageDB`.
- Leave the old `imagedb/` files where they are as a dead fallback (they're cheap), or ask Jose
  before deleting them.
- Refresh each app's bundled `imagedb.json` from the new `latest.json`, so the offline floor includes
  every city.
- Update each repo's CLAUDE.md / handoff to say Masterview is uploaded only in Invoice Reader.

## Weekly routine after this

1. Export Masterview from Retool once per city (Monterrey, Saltillo, CDMX, Guadalajara), full
   columns.
2. Select all four at once in Invoice Reader → Masterview, upload them, and check the report.

That's it: the other three apps pick it up when they next open.

## Out of scope

- City-specific prices: no app uses them.
- Hub sorting files: still uploaded per hub in Sorting Hub.
- Querétaro / Puebla (not uploaded; see Decision 8).
- Any write to Retool.
