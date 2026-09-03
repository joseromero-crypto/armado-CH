# Armado CH — v2.1 fix pack

Reviewed against `index.html` @ `a0b89b5` (3,030 lines). Companion to `armadoCH-v2-plan.md` (the v2 build spec)
and `armadoCHhandoff.md` (how the app works today). Nothing here has been built.

## How to use this document

**Part A (§1–§7)** — the inventory semáforo day-mix fix, plus the image DB moving to a coordinator upload.
Decided; build as written.
**Part B (§8–§12)** — ten findings from the first live test on the floor. Independent of Part A, ship in any
order, suggested sequence in §10.

Everything here is **approved and specced**, except the three items in §7 and the three in §11, which are
marked as open and are operational calls, not technical ones. Where I changed my mind mid-design the rejected
option is recorded with its reasoning — do not re-derive it.

**Nothing in this document may break v2's ground rules**: the only assembler inputs are barcode and quantity;
advisory signals never block, disable or reorder; any assembly with ≥1 confirmed item must leave either a
report or a resumable partial; no cheap exits or bulk skips; round 1's report shape, filename and registration
step stay byte-for-byte unchanged.

**Companion files in this folder**
| File | What it is |
|---|---|
| `armadoCHhandoff.md` | How the app works today — the reference. Read first. |
| `armadoCH-v2-plan.md` | The v2 build spec that produced the current code |
| `armadoCH-v2.1-plan.md` | **This file** |
| `manual/manual-armado-ch.md` · `.pdf` | The Spanish user manual (§9) |

---

## 1. The problem, stated precisely

`disponible = inventario − consumido` mixes two sources with different ages:

| Term | Source | Age |
|---|---|---|
| `inventario` | `Inventario hub saliente` on the row of **the CSV this phone loaded** (`itemInventario`, index.html:2155) | as old as that file |
| `consumido` | `picks` rows where `fecha = today`, all hubs but mine (`recomputeLights`, index.html:2205) | always today |

`doUpload` (index.html:1215) always writes to `orders/{hub}/{todayStr()}.csv`, so **a file's date is its upload date**.
A "stale file" is therefore exactly one thing: the coordinator did not upload for that hub today, and
`fetchOrderForHub` (index.html:967) picked yesterday's — or last week's — file, with no date check anywhere.
It prints `✓ Cargado el 2026-08-25` and nothing else happens.

When that hub's snapshot is older than the picks being subtracted from it, the light is arithmetic across two
different days. Which direction it fails depends on the case, and the expensive one is a **false red** — the
only colour that tells someone not to start looking.

### Why the obvious fix is the wrong one

The first instinct is to filter the picks: only count picks whose `order_date` matches mine. `recordPick`
(index.html:2288) already writes `order_date` on every row and nothing ever queries it back.

**That is wrong, and it should not be built.** A hub assembling from a stale file is still physically taking
stock off the same shelf today. Filtering its picks out would hide real consumption from every other hub —
trading a false red for a false green, which is the failure that costs five minutes of hunting per SKU and is
the reason the semáforo exists at all.

**Consumption is consumption. The pick side stays exactly as it is.** The fix belongs on the inventory side.

---

## 2. Fix A — day-anchored inventory baseline

**Rule:** the light's `inventario` term is always **the freshest snapshot of that SKU uploaded today**, whichever
hub's file it came from. Never a value from a file uploaded on an earlier day.

This is the "most recent upload wins" rule from `armadoCH-v2-plan.md` §3.4 ("Inventory disagreement between
files: use the most recent upload's value"), which was only ever implemented in the coordinator's conflicts
view (`loadInvToday`, index.html:2367) and never reached the assembler's light.

### Why most-recent is correct here, and why it's safe

Assemblies are registered into the system near end of day, so **no snapshot taken during the day reflects that
day's picking.** Every one of today's uploads is therefore the same start-of-day baseline for picking purposes,
and subtracting all of today's picks from any of them is correct. What a later snapshot *does* capture is an
intraday reception — the 10:00 file says 15, the 13:00 file says 40 because 25 arrived at 11:30. The later
number is strictly better information about what is on the shelf, and using it removes a false-red source.

**Most recent by upload timestamp — not the maximum.** If a later file shows a *lower* number (merma, a sale, a
correction posted midday), that lower number is also the truth and must win. `max()` would quietly ignore every
downward correction. Order by `uploadedAt`, take the last.

### When a later snapshot overrules an earlier one

The question this raises: inventory was 50, Contry assembled 10, then Cumbres uploads and the system now says
30 because of merma. Does the app show 30, or 20? And how does it know whether Contry's 10 are already inside
the 30 or still "in the air"?

**It shows 20, and 20 is correct** — because of one verified fact, which should be stated as a rule rather than
left as an assumption:

> **The `picks` table is the only authority on assembly outflow.
> The snapshot is the authority on everything else — receptions, merma, sales, corrections.
> Neither term is ever allowed to explain the other.**

`armadoCH-v2-plan.md` §3.5 verified this against a real 3,827-row export: the identity
`Final [AUTO] = Inv. día anterior + Recepción + Compra − Envío − Salida − Merma` holds on 3,826 of 3,827 rows,
and **`Envío` and `Salida` are zero on every single row**. Assembly outflow is not in the snapshot at all. So
the 50 → 30 drop is 20 units of merma, entirely disjoint from Contry's 10, and real availability is
`30 − 10 = 20`. The two terms never overlap, so there is nothing to double-count.

Note this is *not* a special case for mid-day uploads — it is the same rule that makes the normal 8am flow
correct. Freshness of the snapshot and the subtraction rule are independent concerns: **a fresher number is
never worse as a number.** The assumption lives entirely in what you subtract from it, never in the number
itself.

#### Two protections, because the rule rests on an external behaviour

The rule holds only while registration stays at end of day. If it ever moves intraday, a snapshot starts
containing some of that day's picking and the app would double-subtract. That must fail loudly, not silently:

**a. Detect the assumption breaking.** The order CSV already ships `Salida (kg/pz)` and `Envío - Solicitud (#)`
as empty fill-in columns (`armadoCH-v2-plan.md` §3.5, empty on all 287 rows of the sample). If an uploaded order
ever arrives with either non-zero, the premise is dead. Check it in `doUpload` (index.html:1215) and show the
coordinator a non-blocking warning: *"Este pedido trae Salida/Envío con valores — el semáforo asume que las
salidas de armado no están descontadas. Avisa antes de seguir."* Cheap, and it converts a silent wrong-red into
a sentence somebody reads.

**b. Cap red on the genuinely ambiguous SKU.** The only case where the app cannot tell is: a SKU receives a
**new snapshot today, at a time when picks on it were already recorded**. Then, and only then, it is unclear
whether those picks are inside the new number. So when the winning snapshot's `uploadedAt` is later than the
earliest pick on that SKU today:

- keep subtracting all of today's picks (the EOD prior is still the best available guess), **but**
- set `invAmbiguo: true` on the light and **cap the colour at 🟡**, same as `nameJoin` and `invFuente:'archivo'`.

In the normal pattern — every hub uploaded at 8am, before anybody picks — this never fires, because no pick
predates any upload. It fires only in the rare shape that produced the question, and it fires by withholding
the one instruction ("no lo busques") that a false reading makes expensive. Record `invAmbiguo` in the metrics
sidecar so the frequency is measurable rather than assumed.

### Implementation

**a. Coordinator writes a per-day baseline.** In `doUpload` (index.html:1215), alongside the existing
`pedido_completo` write, merge this hub's rows into a shared file:

```
inventario_dia/{YYYY-MM-DD}.json
{
  date: "2026-09-02",
  updatedAt: "2026-09-02T16:04:11.221Z",
  skus: {
    "7501039122716": { inv: 40, unidad: "Pz", hub: "MH Cumbres", uploadedAt: "2026-09-02T19:03:58.000Z" },
    "norm:leche entera lala 1l": { inv: 0, unidad: "Pz", hub: "MH Contry", uploadedAt: "..." }
  }
}
```

- Key with `skuKeyOf()` (index.html:2151) — identical to the picks key, so no second join ever exists.
- Read-merge-write: fetch the current file (404 → start empty), overwrite a SKU's entry only when this
  upload's `uploadedAt` is **later** than the stored one, then write back.
- Store `unidad` and refuse to overwrite across a unit change — same posture as `recomputeLights` (it already
  bails when the recorded unit differs, index.html:2239). Log it, don't convert.
- The bucket has **no UPDATE policy for anon** (handoff §"Bucket policies"), so this is the
  `sbDelete` → `sbUpload` pattern used for `assemblers.json`, not `x-upsert:true`.
- Route through `sbUploadQueued` (index.html:647), `kind:'inventario_dia'`, so a bad connection at the
  coordinator's desk can't silently drop a hub from the baseline.
- Uploads are minutes apart in practice, so the read-merge-write race is tolerable. If two uploads ever
  collide, the loser is one hub's rows for one day — recoverable by re-uploading that hub.

**b. Assembler loads it once, beside the picks.** In `startAssembly` (index.html:1351) and
`resumePartialSave` (index.html:2987), where `loadPicks()` is already called, also fetch
`inventario_dia/{todayStr()}.json` into `S._invDia` (default `null`). One small file, one round-trip, on the
same screen entry that already does one. Refresh it on the manual `↺` (the `N/N` progress tap, index.html:511);
do **not** put it on the 10 s poll — it changes at upload time, not at pick time.

**c. `itemInventario` resolves through the baseline.** Replace the direct row read (index.html:2155) with:

```
1. S._invDia.skus[skuKeyOf(item)] exists, and its unidad matches  → use its inv        (fresh: today)
2. otherwise                                                      → use the row value  (stale: file's own)
```

Carry which branch was taken onto the light object as `invFuente: 'dia' | 'archivo'`, because §2d depends on it.

**d. A stale baseline can never produce a red.** In `recomputeLights` (index.html:2205), extend the existing
`nameJoin` clause — a `norm:` key already caps at 🟡 for exactly this reason (unreliable basis, and a false red
is worse than a missed warning):

```js
const capped = nameJoin || invFuente === 'archivo';
if (disponible <= 0) color = capped ? 'amarillo' : 'rojo';
```

Yellow still fires, so the assembler is still told to look and quit early. Only the "don't start" instruction
is withheld, and only when the arithmetic has no same-day number to stand on.

**e. Panel text says which day it's arguing from.** The panel already shows its arithmetic
(`Inventario CH 15 · otros hubs ya armaron 15 hoy`) — that is what makes it trusted. When `invFuente` is
`'archivo'`, append the file's date so nobody has to guess:

```
🟡 Puede que ya no haya
   Inventario CH 15 (archivo del 25/08) · otros hubs ya armaron 12 hoy · pediste 5
   Búscalo, y si no está a la vista marca faltante y sigue
```

**f. The coordinator's conflicts view uses the same baseline.** `loadInvToday` (index.html:2347) currently
takes each hub's latest file with no date cutoff and resolves ties on the file-date *string*, so two same-day
files leave the first-iterated hub's value winning arbitrarily. Point it at `inventario_dia` for the `inv`
term and keep the per-hub files only for demand. Hubs whose latest file is not today's are still counted for
demand, but labelled `(pedido del 25/08)` in the row so a week-old request isn't read as today's.

### What deliberately does not change
- `recordPick` — unchanged, still `fecha: todayStr()`, still writes `order_date`.
- The pick queries in `loadPicks` / `pollPicks` — unchanged, still `fecha=eq.today & ronda=eq.S.ronda`.
- Testimony still tops out at 🟡 at `FLAG_NOTFOUND_MIN`.
- No inventory data at all → no light, exactly as now.
- `inventario_dia` unreachable → every SKU falls to branch 2, every red degrades to yellow, assembly continues.
  Nothing is load-bearing.

---

## 3. Fix B — reset the picks buffer when the calendar day changes

`pollPicks` (index.html:2181) recomputes `todayStr()` on every call but keeps `S._picks` and `S._picksMaxTs`
from before. An assembly held open across midnight therefore issues
`fecha=eq.<new day> & ts=gte.<yesterday's last ts>` and **appends** the new day's rows to a buffer still holding
yesterday's. Consumption is then summed across two days, `disponible` collapses, and rows go 🔴 on stock that
was never touched today.

Fix: stamp the buffer with the day it was loaded for and reload on rollover.

- Add `S._picksDay` (set in `loadPicks`, index.html:2168, to the `todayStr()` it queried with).
- First line of `pollPicks`: `if (S._picksDay !== todayStr()) { await loadPicks(); updateLightChips(); return; }`
- Reset `S._picksDay=''` everywhere `S._picks` is already cleared (index.html:1362, 2817, 2835, 2853, 3005).
- Same rollover check re-fetches `S._invDia` for the new day (§2b) — otherwise the buffer is today's and the
  baseline is yesterday's, which is the same bug wearing the other hat.

Rare, but it is a wrong red produced by the clock alone, and the fix is a guard clause.

---

## 4. Surfacing staleness

Neither fix above tells anyone a file is old; they only stop it from lying. Three cheap displays, no new state:

- **Setup screen.** `fetchOrderForHub` (index.html:967) already has `uploadDate`. When it isn't `todayStr()`,
  render the status strip amber: `⚠ Pedido del 25/08 (8 días) — N productos`. Same size, same position, still
  loads, still assembles. Information, not a gate.
- **Coordinator hub rows.** The badge already prints `✓ {date} ({n} prod.)`. Amber it when the date isn't today.
- **Metrics sidecar.** Add a flag `PEDIDO_VIEJO` 📅 to `FLAG_META` / `computeOrderMetrics`, set when
  `S.orderDate`'s base date ≠ the assembly date. Consistent with §3.3's rule — flag it, never exclude it — and
  it keeps stale-file assemblies legible when the pilot numbers are read.

---

## 5. Image DB from the Masterview export — measured against a real file

Sample analysed: `tabledata 28.csv`, **4,872 rows × 92 columns**, 4.8 MB.

### Columns this needs (verified present)

| Column | Coverage | Use |
|---|---|---|
| `Image URL` | **4,872 / 4,872** | the value stored in the map |
| `Item` | 4,872, all distinct | `normName()` key |
| `Código de Barras` | 4,520 present · 352 blank · **10 duplicated** | `cleanBC()` key |
| `Full Res. Image URL` | 4,872 / 4,872 | not used; available if the panel ever wants the large image |

⚠️ **The capitalisation differs from the order CSV.** Masterview says `Código de Barras`; the order export says
`Código de barras`. Match the header case-insensitively rather than by literal string, or this silently reads
every barcode as blank and the map degrades to name-only.
**Confirmed with Jose: the export cannot be edited**, so header matching is normalised in code — trim, lowercase and strip accents on every header before looking for `codigo de barras`, `item`, `image url`. Apply the same normalisation to the order CSV's headers while you are there.

Duplicated barcodes (10) and blanks (352) both resolve the same way the rest of the app already does: the row
still contributes its **name** key. Last row wins on a duplicated barcode — the map is for pictures, and a
wrong picture on 10 SKUs is not worth a conflict-resolution rule.

**Resulting map: 9,382 keys, 1.29 MB** — the same shape and effectively the same size as today's
`imagedb.json` (9,513 keys, 1.29 MB), so `getImgUrl` (index.html:882) is untouched and there is no new payload
concern on warehouse wifi.

### What four months of drift actually cost

Rebuilt map vs the bundled May file:

| | Count |
|---|---|
| Barcodes added since May | **195** |
| Barcodes removed | 270 |
| Keys new in the catalog | 437 |
| Keys gone from the catalog | 568 |
| **Same key, image URL changed** | **21** |

Those 21 are the quiet ones: the app is confidently showing an outdated picture for a product it *does* have
a key for, and nothing in the UI could reveal it.

### ⚠️ Correction to an earlier claim

I said the frozen DB was inflating `detectSuspiciousBarcodes` (index.html:829) false positives. **That was
overstated.** The eight barcodes ending in `000` are *identical* in the May file and today's export — zero
drift in four months. Refreshing the whitelist is still correct (a genuinely new `000` barcode would otherwise
be flagged), but it is a side benefit, not a reason to build this.

### A real join bug worth fixing in the same pass

**162 catalog barcodes carry leading zeros** (`011210009387`, `020899001797`, …). `getImgUrl` does an exact-key
lookup with no zero-stripping — unlike `bcMatch`, which already strips both sides for *scanning* precisely
because this happens. If the order CSV loses a leading zero on export (the same numeric coercion `cleanBC`
exists to undo), the barcode lookup misses and the product falls through to the name path.

Stripping leading zeros when building the map **and** when looking up produces **zero collisions** across all
4,509 distinct barcodes. It is free. **Approved — build it.**

### Implementation

A **`🖼 Base de imágenes`** slot in the coordinator tab, built like `uploadCierre` (index.html:2484): coordinator
picks the Masterview export, the browser parses it, a reduced projection goes to Supabase.

```
imagedb/latest.json   →  { updatedAt, count, map: { "<key>": "<url>", ... } }
```

- **Same map shape as today**, so `getImgUrl` needs only the leading-zero change above.
- **Boot order** in `loadImageDB` (index.html:868): `imagedb/latest.json` from Supabase → on any failure, the
  bundled `./imagedb.json`. The bundled file becomes the floor, not the source.
- **Cadence: weekly, or when an image/barcode problem is reported.** Not daily — the catalog moved 437 keys in
  four months. Show `Última actualización: 02/09` beside the button (from `updatedAt`) so staleness is visible
  rather than discovered.
- **Phone-side cache** in localStorage keyed on `updatedAt`: 1.3 MB downloads once per publish, not once per
  app open. Fetch a small `imagedb/version.txt` first if the full file proves heavy in the warehouse.
- Bucket has **no UPDATE policy for anon** — `sbDelete` then `sbUpload`, as with `assemblers.json`.
- **This is also what makes the fix reachable.** `sw.js` never intercepts Supabase (sw.js:28) and the fetch can
  carry `cache:'no-store'`, so an upload is live on the next app open. Editing `imagedb.json` in the repo
  instead would not reach a phone that already has it for up to 30 days (`max-age=2592000`, netlify.toml).
- Parse coordinator-side only, never on a phone — same posture as the ~1 MB closing-inventory file.

### Fix at the same time — the wrong-image fallback

`getImgUrl`'s fourth step scans all keys and returns the first where `name.startsWith(k)` **or
`k.startsWith(fw)`**, `fw` being the product's first word. The `fw.length > 3` guard applies only to the
*third* step, not inside this loop. A product absent from the map therefore matches the first key sharing its
first word — "Leche entera Alpura 1L" renders a photo of a different milk.

A wrong image is worse than no image here: the scan is the real control so it cannot produce a wrong confirm,
but it spends the trust that makes the picture worth showing at all. Require `fw.length >= 5` inside the loop
and prefer the 📦 placeholder over a prefix guess.

---

## 6. Acceptance tests

**Fix A — day-anchored baseline**
1. Two phones, same SKU. Contry loads today's file (inv 15); Cumbres' file uploaded later today says 40. Both
   phones use **40**. Contry confirms 15 → Cumbres shows 🟡 `40 · otros hubs ya armaron 15`, not 🔴.
2. Contry's latest file is 25/08, everyone else uploaded today. A SKU in today's baseline uses today's number
   on Contry's phone. A SKU present *only* in Contry's old file uses the file value, shows
   `(archivo del 25/08)` in the panel, and **caps at 🟡 even when `disponible ≤ 0`**.
3. A later upload lowering a SKU from 40 to 12 wins over the earlier 40. (Guards against `max()`.)
4. `inventario_dia/{today}.json` deleted → no crash, no error toast, every light degrades to at most 🟡,
   assembly completes and the report uploads normally.
5. A hub whose file is a week old still contributes its picks to every other hub's `consumido`.
   (Guards against the rejected pick-filter design.)

**Fix A — snapshot overrule (§2)**
6. Inv 50 at 08:00 → Contry confirms 10 at 09:30 → Cumbres uploads at 13:00 showing 30. Every phone reads
   **20** available, and the SKU shows 🟡 at most (`invAmbiguo`), never 🔴.
7. Normal day — all seven hubs upload at 08:00, first pick at 08:40: **no SKU is marked `invAmbiguo`** and reds
   behave exactly as they do today.
8. An order file uploaded with a non-zero `Salida (kg/pz)` raises the coordinator warning and still uploads.

**Fix B — midnight**
9. Assembly open across 23:59 → 00:01: `consumido` resets to the new day rather than summing both, no row turns
   🔴 from the rollover alone, and `S._invDia` is refetched for the new day.
10. Save-and-exit 22:00, resume 08:00: every light green, no leftover rows in the buffer.

**Images**
11. A Masterview upload makes a SKU added after May show its image without a deploy and without clearing the
    browser cache.
12. A product whose barcode carries a leading zero in the catalog but not in the order CSV resolves to the
    right image.
13. A product absent from the map shows 📦, never another product's photo.

**Untouched**
14. `picks` unreachable → no lights, no chips, no errors; assembly runs exactly as v1.
15. Round 1's report columns, filename and registration step are byte-for-byte unchanged.

---

## 7. Open questions

| # | Question | Blocks |
|---|---|---|
| 1 | **Should a stale-file hub be allowed to assemble at all**, or should the setup screen block and send them to the coordinator? Current spec: never block, only inform (§4). Consistent with "advisory, never blocking", but it is an operational call. | §4 |
| 2 | **Who owns the weekly Masterview upload, and does it belong behind the coordinator PIN or somewhere quieter?** It is a catalogue-wide action, not a daily-ops one. | §5 |
| 3 | **Is `Image URL` the right column, or should the panel use `Full Res. Image URL`?** Both are 100 % populated. Row thumbnails almost certainly want the former; the expanded panel might want the latter. | §5, cosmetic |

### Resolved — recorded so they aren't relitigated
- **Filtering picks by `order_date`** → rejected. A stale-file hub still takes real stock today; hiding its
  picks converts a false red into a false green, which is the more expensive error.
- **`max()` across snapshots** → rejected. Most-recent-by-`uploadedAt`, so downward corrections win too.
- **Whether a later snapshot already contains today's picking** → it does not; `Envío`/`Salida` are zero on all
  3,827 rows of the verified export. Picks are the sole authority on assembly outflow; the snapshot owns
  everything else. Instrumented (§2a) rather than trusted, and capped to 🟡 where ambiguous (§2b).
- **Putting `inventario_dia` on the 10 s poll** → rejected. It changes at upload, not at pick.
- **Blocking a stale order from loading** → not proposed. Advisory only; see open question 1.
- **Editing `imagedb.json` in the repo as the fix** → insufficient alone. The 30-day `max-age` means it would
  not reach phones that already have it.
- **Daily Masterview upload** → unnecessary. 437 keys moved in four months; weekly or on-report is enough.
- **The corruption-detector false-positive claim** → withdrawn, see §5. Zero drift in the `000` barcodes.

---

# Part B — findings from the first live test

Ten items from Jose's real-time run of the deployed v2. Independent of Part A; ship in any order.
Numbering below matches the order they were reported.

## 8. Assembler-facing fixes

### 8.1 Full product name (no truncation)
`.row-name` (index.html:149) is `white-space:nowrap; overflow:hidden; text-overflow:ellipsis`. Long names lose
their tail, which is where the size and presentation live — "Leche entera Lala 1L" vs "…Lala 250ml".

Fix: allow two lines and clamp there, so a row can't grow without bound but nothing important is cut.

```css
.row-name{ white-space:normal; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical;
           overflow:hidden; line-height:1.25 }
```

Also drop the ellipsis in the **panel** heading and the summary rows — those have the width and are the ones
being read at the shelf.

### 8.2 Images
Covered by §5 (Masterview upload). No separate work.

### 8.3 🔁 — say who found it, and jump to them

**The jump already works.** The header chip (index.html:507) calls `scrollToRevisar()`, which opens the
collapsed section and scrolls to it. Nothing to build; worth verifying it wasn't just missed in testing.

**The name is missing and is the useful half.** `recomputeLights` (index.html:2205) already computes
`b.pos` — the set of assemblers with a positive pick on that SKU — and then throws it away, keeping only a
boolean. `PICK_SELECT` already fetches `armador` and `hub`, so **no schema change and no extra query.**

- Store the evidence instead of the boolean:
  `S._contradicted[i] = { armadores:[...], hubs:[...], ts:<latest positive pick> }` (excluding `S.assembler`).
- Row chip keeps `🔁` but gains a `title`; the **panel** for a contradicted row shows the sentence:
  `🔁 Daniel (MH Cumbres) sí lo encontró a las 10:42 — pregúntale antes de dejarlo como faltante`
- More than one finder → `Daniel y 2 más`, full list in the panel.
- Carry `desmentidoPor` into the metrics sidecar alongside the existing `faltantesDesmentidos` count, so the
  coordinator table can show the name rather than only the number.

### 8.4 Split the quantity outcome into four states

Today `PARTIAL` means "not equal to requested" in either direction, and `⚠️` is shown for both. Jose's split:

| State | Rule | Icon | Estado in CSV |
|---|---|---|---|
| **Completo** | `\|armado − solicitado\| ≤ tol` | ✅ | `Completo` |
| **Sobrante** | `armado > solicitado + tol` | ⬆️ | `Sobrante` |
| **Parcial** | `0 < armado < solicitado − tol` | ⬇️ | `Parcial` |
| **Faltante** | `armado = 0` | ❌ | `Faltante` |

Tolerance unchanged: ±0.05 Kg / ±0.5 Pz (`confirmItem`, index.html:1645). Add
`ITEM_STATUS.SOBRANTE = 'sobrante'`.

#### ⚠️ This exposes a conflation worth fixing in the same pass

`confirmItem` (index.html:1646–1648) currently lets the **barcode** exception overwrite the **quantity**
outcome:

```js
else if(result.bcStatus===BC_STATUS.UNAVAIL)  result.status=ITEM_STATUS.NOBC;
else if(result.bcStatus===BC_STATUS.WRONGSYS) result.status=ITEM_STATUS.WRONGSYS;
else if(Math.abs(picked-reqQ)<=tol)           result.status=ITEM_STATUS.COMPLETED;
```

So an item picked at exactly the requested quantity, but with an unreadable barcode, reports as
`Parcial (BC ilegible)` — and it was not partial at all. These are two independent axes, and `bcStatus`
**already exists as its own field and already has its own CSV column** (`Verificación código`).

**Fix: `Estado` becomes purely the quantity outcome.** Evaluate the four states above unconditionally; drop
`NOBC` and `WRONGSYS` from `ITEM_STATUS` as *statuses* (keep them as `BC_STATUS` values, untouched). The row
shows the quantity icon plus a small `⚠` badge when `bcStatus` is an exception.

Everything that currently groups on `[PARTIAL, NOBC, WRONGSYS]` must be revisited — four sites:
index.html:1700 (summary tile), 1890 (`parciales` in metrics), 1813 (`estado` map in `generateCSV`), 1395 /
1712 (icon maps). **Careful:** the registration copilot (§9.7) splits *Revisar* vs *Completos* on
`Estado ≠ Completo`; it must now split on **`Estado ≠ Completo` OR `bcStatus` is an exception**, or barcode
discrepancies silently move into the mechanical block.

Migration: old reports and in-flight partials carry `nobc` / `wrongsys` / `partial`. Every read path
(`registro`, metrics, summary) must treat unknown legacy statuses as *Revisar* and never crash on them.

Also update: the ❓ legend, and `luzAlSkip` is unaffected.

### 8.5 Metrics — a second completion percentage
`pctCompleto` (index.html:1893) is `completos / skusTotal`, which reads as failure whenever a hub is simply
short on stock. Add alongside it, never replacing it:

```
pctSurtido = (completos + sobrantes + parciales) / skusTotal     // everything with ≥1 unit picked
```

- New metrics column **`% surtido`** next to `% completo` (`METRIC_COLS`, index.html:1976), in the CSV export
  (index.html:2136), and in the sidecar payload (index.html:1939).
- Only `Faltante` and `Faltante (fecha corta)` are excluded. `Pendiente` also stays out — an unfinished order
  should not read as surtido; the `INCOMPLETO` ⏳ flag already marks those rows.
- Keep the sidecar's `v:2` readers tolerant: an older sidecar has no `pctSurtido`; show `—`, not `0`.

### 8.6 The summary as a registration screen

Two changes, plus one new entry point.

**a. Make the picked number the biggest thing on the row.** The summary row (index.html:1714) prints
`Solicitado: 12 Pz · Armado: 10 Pz` at the same weight. For registration, **`Armado` is the only number being
typed.** Restructure: `Armado` large and bold on the right of each row, `Solicitado` small and grey beneath the
name. Same data, inverted hierarchy.

**b. Add a `Faltante` column to the summary row** (`solicitado − armado`), since the system asks for it too —
same two numbers the registration copilot already computes (§9.7).

**c. New assembler-side entry point: `📋 Pedidos armados`.**
On the setup screen, below the hub grid. Lists **only assemblies finished against orders currently in the
bucket** — not a history. For each: hub, date, time, assembler(s), `N/total`. Tapping one reopens the **same
summary view**, read-only, with no *Terminar armado* button.

- Source: `reports/{hub-slug}/` filtered to reports whose date matches a `.csv` still present in
  `orders/{hub-slug}/`. When the coordinator uploads a new order for a hub, that hub's older entries fall off
  by themselves — exactly the "not a historic view" behaviour asked for.
- Renders from the parsed report CSV, so it works for an assembly finished on another phone.
- No download button — this is the screen that *replaces* needing the download.
- Read-only: it must not re-upload, re-open a timing segment, or touch the partial.

### 8.7 Mobile — the `N/N` counter is off-screen
`.list-header-row` (index.html:130) is a single `display:flex` row holding back button, hub name, 🔁, ❓, 💾,
*Finalizar pedido* and the progress label. `.list-hub` takes `flex:1` and the buttons are `white-space:nowrap`,
so on a narrow phone the last child — the counter — is pushed past the right edge.

Fix: two rows instead of one.
- Row 1: `←` · hub name · `❓` `💾` `🔁`
- Row 2: `23 / 122` on the left, `Finalizar pedido` on the right, progress bar beneath.

The counter is glanced at constantly and *Finalizar* is pressed once, so the counter earns the stable
position. Test at 360 px wide (the narrowest common Android) and with the longest hub name, `MH San Nicolás`.

### 8.8 Faltantes report (per day, for the inventory owner)
A coordinator button — `📭 Faltantes del día` — next to the existing *Inventario — hoy* section, producing
`faltantes_{YYYY-MM-DD}.csv`.

Source is the `picks` table, which already carries everything needed:
`fecha, hub, sku_key, producto, unidad, cantidad, senal, armador, ts, order_date` — one query,
`fecha=eq.{date}&senal=not.is.null`. Position and CH inventory are not on `picks`, so join them from each hub's
order file (already fetched by `loadInvToday`, index.html:2352).

| Column | Source |
|---|---|
| `Fecha` | pick |
| `Hub` | pick |
| `Producto` | pick |
| `Código de barras` | `sku_key` (blank when it starts with `norm:`) |
| `Posición armado` | order file |
| `Inventario CH` | order file (`Inventario hub saliente`) |
| `Solicitado` | order file |
| `Motivo` | `No se encontró` / `Fecha corta` |
| `Armador` | pick |
| `Hora` | `ts`, local Mexico time |
| `Desmentido` | `Sí` when another assembler has a positive pick on that SKU the same day — the row the inventory owner should check first |

Sorted by `Posición armado` so it can be walked in one pass. BOM prefixed, like every other export.

### 8.9 Pending-only filter
A segmented control in the list header, row 2: **`Todos` · `Pendientes`**.

- Pure view filter over `S.items` — never re-sorts, never renumbers, never touches `S.results` or `_expandedIdx`.
- Default `Todos`. Selection is per-session, not persisted.
- Confirming the last pending item while filtered leaves an empty list; show
  `✓ No quedan pendientes` with a button back to `Todos`, not a blank screen.
- The 🔁 *por revisar* section stays visible in both modes — those rows are resolved but actionable.
- Does not conflict with the ground rule against cheap exits: it hides nothing from the report and makes no
  action cheaper. It only shortens the scroll.

### 8.10 Manual — in-app screen (the document itself is §9)
Spanish, covering coordinator + assembler + metrics + inventory + offline. Two surfaces: a PDF, and an in-app
screen reachable from the home screen (`📖 Manual`) — not the ❓ legend, which stays as the quick
status-icon reference it is.

The in-app version is a `screen-manual` with collapsible sections, rendered from a constant so it works
offline like everything else. Deep-link the assembler sections from the ❓ legend footer
(*"¿Cómo funciona el semáforo? → Manual"*).

### 8.11 The panel opens showing its bottom, hiding the product name

**Reported:** tapping an item opens the keyboard and lands the view on the bottom of the panel, so the
assembler cannot see which product they are on.

Three separate causes, stacking:

1. **`openDetail` scrolls the wrong element.** index.html:1453 calls
   `panel.scrollIntoView({block:'nearest'})` — the *panel*, not the row. With a tall panel, `nearest` scrolls
   until the panel's **bottom** edge is visible, pushing the row (and the name) off the top.
2. **`.list-header` is `position:sticky; top:0`** (index.html:129). `scrollIntoView` knows nothing about it, so
   even a correctly-scrolled row can end up underneath the header.
3. **The keyboard opens and scrolls again.** 120 ms later, `#bc-field` is focused (index.html:1455). On a
   phone that raises the software keyboard, which shrinks the visual viewport and triggers a *second*
   browser-controlled scroll to keep the focused input visible. That one is the biggest jump and the app does
   not control it.

**The panel has no product name of its own.** The name lives only in the row above it, which is why any scroll
error hides it completely. That is the underlying gap, and it is worth fixing whatever happens to the scroll.

#### Fix, in order of value

**a. `inputmode="none"` on `#bc-field`** (index.html:1490). This is the root fix for cause 3: it tells the
browser not to raise a software keyboard while still accepting focus and still accepting input from the
Bluetooth scanner, which the OS sees as a hardware keyboard. The field is **never meant to be typed into by
hand** — the handoff already records that the placeholder was removed precisely to discourage manual entry —
so suppressing the keyboard costs nothing and removes the whole viewport-shrink cascade.

*Fallback, if manual entry is ever genuinely needed:* a small `⌨` button beside the field that flips
`inputmode` to `text` and refocuses. Do not add it pre-emptively; add it only if the floor asks.

`#qty-field` keeps its keyboard — the assembler does type there. So the panel still needs (b).

**b. A sticky title inside the panel.** Make the panel self-sufficient rather than dependent on scroll
position: a compact bar as the panel's first child, `position:sticky; top:0` within the panel, holding the
**full product name** and the position code.

```
┌──────────────────────────────────────────┐
│ Leche entera Lala 1L            [A-1-2]  │  ← sticky inside the panel
├──────────────────────────────────────────┤
│ (imagen) · tags · código · 📅 · cantidad │
```

With the name always on screen, a scroll landing a little low stops being a defect. This is the change that
makes the screen robust across browsers rather than tuned for one.

**c. Scroll the row, anchored below the sticky header.** Replace the panel scroll with:

```js
row.scrollIntoView({ behavior:'smooth', block:'start' });
```

and give the row a scroll offset equal to the header height so it lands *below* it, not under it:

```css
.item-row { scroll-margin-top: 72px; }   /* ≈ height of .list-header */
```

`scroll-margin-top` is the CSS-native way to handle a sticky header and needs no measurement in JS. If §8.7
turns the header into two rows, update this value in the same pass — the two are coupled.

**Verify on a real phone, not a desktop emulator.** Keyboard/viewport behaviour is the part desktop DevTools
does not reproduce. Check: iOS Safari and Chrome Android, a long product name, an item with a barcode
(should raise no keyboard) and one without (goes straight to qty, keyboard expected).

---

## 9. The manual — already written

`manual/manual-armado-ch.md` (source) and `manual/manual-armado-ch.pdf` (18 pages, A4) are **done and in this
folder.** Spanish, covering: what the app is and who uses what · the full assembler flow · the semáforo and
why red is arithmetic-only · the full coordinator flow · reserva and round 2 including why the cross-check
cannot read the inventory level · registration · metrics with both time measures and all eight flags · offline
behaviour · a troubleshooting table · a glossary.

**Do not rewrite it.** Two jobs remain:

1. **Keep it true as Part B lands.** Features not yet shipped are marked *(llega en la próxima versión)* —
   the four quantity states (§8.4) and `% surtido` (§8.5). When those deploy, delete those parentheticals and
   nothing else. §8.11's `inputmode` change needs no manual edit.
2. **Build the in-app screen** (§8.10): `screen-manual`, reached from a `📖 Manual` button on the home screen,
   rendered from a JS constant so it works offline like the rest of the app. Sections collapsible. Deep-link
   the assembler-facing sections from the ❓ legend footer (*"¿Cómo funciona el semáforo? → Manual"*). The
   ❓ legend stays what it is — the quick status-icon reference — and is not replaced.

Regenerate the PDF from the `.md` after any edit; keep both in sync.

---

## 10. Suggested build order for Part B

1. **8.1, 8.7, 8.11** — layout and one input attribute, no business logic, immediately felt on the floor.
   Ship first. 8.11a (`inputmode="none"`) is a one-attribute change and probably the single highest
   value-per-character fix in this document.
2. **8.9** — small, self-contained, biggest daily comfort win.
3. **8.3** — no schema change, the data is already fetched.
4. **8.4 + 8.5** — do together; 8.5's `pctSurtido` needs 8.4's `sobrante`. The riskiest item in Part B
   because of the four grouping sites and the legacy-status migration. Test with an old report open in the
   registration copilot before deploying.
5. **8.8** — one query plus a join already written.
6. **8.6** — the largest, and the one whose operational value should be confirmed first: does a screen
   actually replace the printout, or does the registrar want paper regardless?

## 11. Open questions — Part B

| # | Question | Blocks |
|---|---|---|
| 1 | **Does `Sobrante` need to reach the system differently from `Completo`?** The app can report it, but if registration types the same `Salida` either way, the split is for measurement only. Changes nothing in the code; changes what the manual says. | 8.4, manual |
| 2 | **Does the inventory owner want `faltantes_{fecha}.csv` per day, or per day *and* hub?** One file sorted by position walks the CH once; per-hub files match how requests arrive. | 8.8 |
| 3 | **Should `📋 Pedidos armados` be visible to every assembler, or PIN-gated?** It exposes other people's assemblies. Reading is harmless; naming is not always. | 8.6c |
| ~~4~~ | ~~The ±0.5 Pz tolerance~~ — **withdrawn, no decision needed.** Checked against the code: `reqQ` is `Math.ceil(...)` so it is always a whole number, and assemblers enter whole pieces. `\|12−12\| = 0` → Completo; `\|13−12\| = 1` → not Completo. Any tolerance between 0 and 1 gives identical results, so ±0.5 is already equivalent to 0 and the four-state split works correctly as written. Add a code comment so nobody reads it as a ±0.5-piece grace. The Kg tolerance (±0.05) is doing real work and stays. | — |

---

## 12. Before every deploy — checklist

1. **Bump `CACHE_NAME` in `sw.js`** on every deploy that changes `index.html`. This is the one footgun that
   ships a stale app to phones that already have it, and it is silent. It is already called out in
   `armadoCHhandoff.md` §9.8; it is repeated here because it will be forgotten otherwise.
2. **Test on a real phone**, not a desktop emulator — mandatory for §8.7 and §8.11, where keyboard and
   viewport behaviour is exactly what DevTools does not reproduce. iOS Safari and Chrome Android.
3. **Run one full assembly end to end** after any change touching `confirmItem`, `generateCSV` or the status
   maps (§8.4 especially): confirm → faltante both reasons → save & exit → resume → finish → check the report
   CSV opens correctly and the registration copilot still splits Revisar vs Completos.
4. **Open an old report in the registration copilot** after §8.4, to prove legacy `nobc`/`wrongsys`/`partial`
   statuses still render and do not crash.
5. **Deploy**: `find .git -name "*.lock" -delete 2>/dev/null; git add . && git commit -m "…" && git push`
6. **Update `armadoCHhandoff.md`** with whatever shipped. The handoff is the reference the next session reads
   first; a change that is not in it does not exist.
