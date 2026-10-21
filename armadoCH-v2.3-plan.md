# Armado CH — v2.3 plan

Written 2026-10-20 against `index.html` @ `5479ffc`, revised the same day with Jose's answers and a real
Retool export (`fixtures/retool_salida_fixture.csv`, gitignored). Cites `armadoCHhandoff.md` as **H§8.2** etc.
Nothing here is built yet.

| Part | What |
|---|---|
| **A** | Coordinator tab becomes pages with a top menu (no infinite scroll) |
| **B** | Order status: every uploaded order shows Pendiente / En progreso / Armado / Capturado |
| **C** | Respaldos: every saved assembly is kept 30 days and the coordinator can restore it, per hub |
| **D** | Safety fixes underneath B and C (multi-day orders, r2, filenames, retries) |
| **E** | Careful deletes: say what breaks, then make the person type BORRAR |
| **F** | Verificar captura: upload the Retool export, compare against the app |

**Ground rules (unchanged):** assembler inputs are barcode + quantity · advisory never blocks items · no cheap
exits · ≥1 resolved item always leaves a report or a resumable partial.
**Changed by Jose (2026-10-20):** the report filename may change — it now carries the order date and the
finish date (D1). Report **columns** stay the same.

### Words used in this plan
- **Armado en progreso** (code: *partial*) — an order an assembler started and hasn't finished. Saved after
  every confirmed product.
- **Respaldo** — a saved copy of an armado en progreso, or of a deleted order or report. Kept 30 days.
- **Picks** — the server table that gets one row each time an assembler confirms or marks faltante. Never deleted.

---

## 0. Verified in production (read-only, 2026-10-20)

| # | Question | Answer | Consequence |
|---|---|---|---|
| V1 | Is `picks.order_date` a `date`, and what do R2 picks store? | **Date column.** `recordPick` sends `2026-09-11-r2`; Postgres stores `2026-09-11`. A query for `…-r2` is coerced the same way and matches. | R2 recovery works **by accident** — `ronda` is what separates R1 from R2. D3: send/query the bare date + `ronda` explicitly so it stops depending on the coercion. Low risk, small change. |
| V2 | Does overwriting an existing file work? | **Not answerable read-only.** No order file in the bucket shows `updated_at > created_at`, so no same-day overwrite has ever succeeded — or none was tried. | Build `sbReplace()` (D4) defensively anyway: cheap, and correct either way. Optional: Jose checks *Storage → Policies* for an UPDATE policy. |
| V3 | API max rows? | **1000.** `picks` has 22,256 rows; a query without paging returns rows 0–999. Daily picks run 442–870 (870 on 20/10) across all hubs. | Day-wide queries are about to truncate silently. **Page every `pgSelect` (`Range` header) in Phase 1.** |

### Also found while looking (changes the design)

- **Orders are deleted daily.** Every hub has exactly one file in `orders/` (today's); Condesa and Zapopan have
  none. So the coordinator 🗑 is a **daily routine**, not a rare event. → Deleting a **finished** order must stay a
  one-tap confirm (E), and nothing may depend on the order CSV still existing.
- **`pedido_completo/` keeps every day's full order** (42 days for Contry, all 451 rows). → It is the order source
  for Verificar captura (F2), rebuilds and status — not `orders/`.
- **Finished orders get resumed.** Contry had partials for 13/10 and 08/10 whose confirmed products all predate the
  order's report, but which were re-saved hours later — someone resumed the finished order ("Rangel" at 15:56 on
  13/10). The 14/09-r2 one is a genuinely unfinished complemento (no R2 report). → A report wins **unless the
  partial has products confirmed after it** (B1). Phase 1's sweep archives the resumed leftovers; Phase 3 stops the
  resume itself (C3: don't offer "Continuar" for an order that already has a report and no later work).

---

# Part A — Coordinator pages

**Verdict: BUILD.** The coordinator screen is one long scroll today (H§7.5). Replace it with a sticky top menu
and one page at a time.

```
┌ ← Coordinador                                   📊  ↺ ┐
│ [Pedidos] [Armados] [Verificar] [Faltantes] [Cierre] [Armadores] [Imágenes] │  ← scrolls sideways on a phone
└──────────────────────────────────────────────────────┘
```

| Page | Content | From today's screen |
|---|---|---|
| **Cargar pedidos** | Morning banner (B2) · one card per hub: upload, status (B1), 📄 No surtido, Respaldos (C), 🗑 | "Cargar pedidos" + 🛟 |
| **Armados terminados** | `Hoy` / `Historial` toggle. Grouped by day (B3) | "Reportes activos" + "Ver historial" |
| **Verificar captura** | Per hub upload of the Retool export → result (F) | new |
| **Faltantes armador** | Faltantes de hoy, conflictos de inventario, ⬇ Faltantes del día CSV | "Inventario — hoy" |
| **Inventario de cierre** | Upload, Revisar, complementos | unchanged content |
| **Armadores** | Name list | unchanged |
| **Base de imágenes** | Masterview upload | unchanged |

- 📊 Métricas — **moved into the menu** (Jose, 2026-10-21); the header keeps only ← and ↺.
- The last page used is remembered on the device. Each page loads its data when opened (today everything
  loads at once, which is part of why the screen is slow).
- Pages are `<section>`s inside `screen-coordinator`; `showCoordPage(name)`. No new screens, so the existing
  `← back to coordinator` paths keep working.
- The partial-events log moves into Respaldos (C), where it means something.

---

# Part B — Order status

**Verdict: BUILD.**

## B1 — Status per order

Every order file gets one status, computed from what's in the bucket:

| Status | Means | Source |
|---|---|---|
| ⚪ **Pendiente** | Uploaded, nobody started | order file, no partial, no picks |
| 🟡 **En progreso 254/421** · Israel · hace 2 h | Started, not finished | newest partial version |
| ✅ **Armado 421/421** · 18:42 | Finished, report uploaded | report linked to this order (D1) |
| ✅ **Armado con pendientes 400/421** | Finished with products left unconfirmed | report has `Pendiente` rows |
| ☑️ **Capturado** / ⚠️ **Captura con errores (3)** | Retool export verified (F) | `verificaciones/` result |
| 🔴 **Se perdió el avance — recuperable** | Picks exist, no partial, no report | picks summary view (C4) |

**A report wins, unless there is later work.** If a report exists, the status is ✅ — unless a partial for the same
order has products confirmed after the report's time (a real second pass), which shows as 🟡 *Continuado después del
reporte*. The order source is `pedido_completo/`, because the
order CSV itself is deleted daily.

Each hub card on **Cargar pedidos** shows **only its current order** and its status. **Decided 2026-10-20 (Jose):**
older orders are not shown on the cards ("status is about the current uploaded order"); yesterday is covered by the
morning banner, and anything older lives in Respaldos.

## B2 — Morning banner

Top of **Cargar pedidos**:

> **Pedidos de ayer — lunes 19 oct:** 6 de 7 armados · 5 capturados · 1 en progreso (MH Condesa 254/421)

"Ayer" = the previous order date that had uploads. Tapping a hub in the banner opens its card. This is the
"every morning he should see all of yesterday's files completed" view.

## B3 — Armados terminados

- **Hoy**: today's reports, by hub.
- **Historial**: grouped by day with a clear header, newest first, collapsed except the latest 3 days:
  ```
  ▾ Lunes 19 oct 2026 · 7 armados
      MH Contry      18:42 · Diego          421/421  ☑️ Capturado     ⬇ 📋 🗑
      MH Condesa     pedido 18/10 · terminado 19/10 · Israel  254/421 ⚠️ 3 errores
        └ 🔄 Complemento  20:10 · Diego     12/12
  ▸ Domingo 18 oct 2026 · 6 armados
  ```
- The day is the **order date**. A multi-day order says both dates on its row.
- Filter: hub · last 7 / 30 / 90 days.
- ✅ **Built early (2026-10-20, with Phase 2):** day grouping, weekday headings, hub/period filters. Still Phase 3:
  the per-row `N/M` and ☑️ Capturado chips (need the status data).

---

# Part C — Respaldos (30 days)

**Verdict: BUILD.** Replaces the 🛟 Recuperar button.

> **About 🛟:** it exists in the code today, but only appears in a rare case (the saved progress is gone but the
> scan history isn't, and no report exists). That's why you've never seen it. v2.3 folds it into Respaldos as
> one of the restore options.

## C1 — Nothing that was saved gets thrown away for 30 days

Today a saved armado en progreso is **deleted** when the order is finished, when an assembler taps "Empezar de
cero", or when the coordinator re-uploads over it. Change: before any of those deletes, copy the newest saved
version to

```
respaldos/{hub-slug}/{orderDate}__{epochMs}__{motivo}.json
  motivo ∈ terminado · empezar_de_cero · subida_coordinador · pedido_borrado · reporte_borrado
```

The copy is written **first**; if it can't be written, the delete doesn't happen (offline → the delete is
refused; it is never urgent). Deleted **order** and **report** files go there too (as their CSV text). Pruned
after 30 days when the coordinator opens Respaldos.

While an order is still in progress, the newest 5 saves are kept (today: 3). Each save is a full copy of the
progress, ~90 KB.

## C2 — The Respaldos panel (per hub)

Opened from each hub card. One list, newest first:

| Pedido | Qué pasó | Avance | Quién | Cuándo | |
|---|---|---|---|---|---|
| 20/10 | 🟡 En progreso (último guardado) | 112/301 | Diego | hoy 10:42 | Ver · Restaurar… |
| 19/10 | ✅ Terminado — reporte subido | 298/298 | Diego, Ana | ayer 18:42 | Ver · Restaurar… |
| 18/10 | ⚠️ Borrado por armador ("Empezar de cero") | 254/421 | Israel | sáb 09:10 | Ver · Restaurar… |
| 18/10 | 📄 Pedido borrado por coordinador | — | — | sáb 08:00 | Restaurar pedido |
| 17/10 | 🔴 Se perdió — se puede reconstruir del historial de escaneos | 87 escaneos | Ana | | Reconstruir… |

- **Ver** — read-only summary of that copy (same summary screen assemblers use).
- **Restaurar** — makes that copy the current armado en progreso for its order, so any assembler can continue
  it from the hub. Modal says what it replaces (`Ahora hay 112/301 guardado — se reemplaza por 254/421`).
  If the order file is gone, it's restored too. Restoring a finished order warns that finishing it again
  creates a second report.
- **Reconstruir** — today's rebuild-from-picks. If the order CSV is gone it uses the respaldo or the
  `pedido_completo` copy (H§12.2).
- **Eventos** — the partial-events log for that hub (who saved, who deleted, why).
- **⬇** — downloads the copy (JSON + a provisional report CSV) as an offline backup.

## C3 — Unfinished previous order = red flag for the coordinator

An unfinished older order means the coordinator uploaded over work in progress. That's the coordinator's
problem to catch **before** it happens, not the assembler's to sort out afterwards.

- **On upload** (`uploadHubCSV`, before anything is written): if the hub's current order is ⚪ Pendiente,
  🟡 En progreso or 🔴 recuperable, stop with a red modal:
  > **⛔ MH Condesa todavía no termina el pedido del 03/09**
  > 254 de 421 productos armados · Israel · último guardado hace 3 h
  > Si subes el pedido nuevo, los armadores dejarán de ver el del 03/09.
  > [ Cancelar ] [ Ver Respaldos ] [ Subir de todos modos… ] ← typed BORRAR-style confirm (`SUBIR`)
  The override is logged to `partial_events` (`coordinator_override`).
- **Status page:** *(dropped 2026-10-20 — cards show only the current order; the upload stop above is where an
  unfinished order gets caught)*
- **Assembler side: no change.** Assemblers keep seeing only the hub's newest order. The old progress is not
  lost (it stays in Respaldos); the coordinator decides whether to restore it as the current order.
- If picks show lost progress and nothing is saved, the "recuperar" card **blocks Iniciar Armado** until it's
  resolved, like a saved armado does (H§12.3).

## C5 — Coordinator closes an order as finished

**Verdict: BUILD (approved by Jose).** For when an order must go out as it is — e.g. only half was assembled in
time — or an assembler left without finishing.

- From a 🟡 / ⛔ order on its hub card, or from a row in Respaldos: **Cerrar como terminado**.
- Shows the same summary the assembler sees (tiles + list), then the typed confirm:
  > **Cerrar el pedido de MH Condesa (03/09) como terminado**
  > Se generará el reporte con **254 de 421** productos armados. Los **167 sin armar** quedan como *Pendiente*
  > y no se capturan en Retool. Se guarda un respaldo por 30 días.
  > **Para confirmar, escribe la palabra CERRAR en el cuadro de abajo y toca "Cerrar".**
- Produces a normal report (same columns; pending rows = `Pendiente`, which the registro copilot already drops)
  through the same `finalizeAssembly` path, so it clears the partial, writes the respaldo (`motivo:
  cerrado_por_coordinador`) and the metrics sidecar (flags `INCOMPLETO` + new `CERRADO_COORDINADOR`).
- Status becomes ✅ **Cerrado por coordinador 254/421**. Logged to `partial_events`.
- Works from a rebuild too (picks → partial → close), so an order whose progress was lost can still produce
  its report.

## C4 — Picks summary view (Jose runs once)

```sql
create view public.picks_por_pedido with (security_invoker = true) as
select hub, order_date, ronda,
       count(*) as picks, count(distinct sku_key) as skus,
       array_agg(distinct armador) filter (where armador is not null) as armadores,
       min(ts) as primero, max(ts) as ultimo
from public.picks group by hub, order_date, ronda;
grant select on public.picks_por_pedido to anon;
```
Lets the status and Respaldos pages know "picks exist for this order" without downloading thousands of rows.

---

# Part D — Safety fixes underneath

## D1 — Report filename carries both dates

**Verdict: BUILD (approved by Jose).**
```
reports/{hub-slug}/{orderDate}_{finishDate}_{HH-MM}_{Armadores}.csv
reports/{hub-slug}/{orderDate}_r2_{finishDate}_{HH-MM}_{Armadores}.csv
```
Same for the metrics sidecar. The coordinator's "active vs historial" split, `armadoMapForHub`,
`hasReportForOrderDate` and Pedidos armados then match on the order date, which fixes H§12.8 (🛟 offered for
finished orders; Revisar double-requesting). `reportDisplayInfo` reads both formats; old files (one date) are
treated as order date = finish date. Report **columns** unchanged.

## D2 — Round 2 handled the same everywhere

One `latestOrderFile()` helper for every caller; the coordinator shows R1 and R2 separately with their own
status and 🗑. Fixes H§12.9 (🗑 currently deletes the R1 file when an R2 exists).

## D3 — Round-2 picks key

Per V1: `recordPick`, the rebuild, the 🛟/status checks and `partial_events` send and query
`order_date = bare date` plus `ronda`, never the `-r2` suffix.

## D4 — Overwrites

`sbReplace(path, body, type)`: try upsert; on a 4xx, keep a respaldo of the existing file, then
delete-then-insert. Used by `doUpload` (order + `pedido_completo`), `generarComplemento`, `uploadCierre`, and
the new `verificaciones/` writes.

## D4b — Paging

`pgSelectAll(table, query)` follows `Content-Range` with `Range: a-b` headers until done. Replace every
day-wide `pgSelect('picks', …)` (semáforo load, desmentido positives, faltantes, inventory-today, rebuild).

## D5 — Saves that fail retry, and say so

A failed save to the server retries (5 s, 15 s, then every 60 s) instead of waiting for the next confirm.
After 2 minutes behind: `☁ Sin sincronizar desde 10:42 — tu avance está en este teléfono` under the list
header. Save & exit warns when this phone still holds unsent progress. Advisory only.

## D6 — Old local copies

On boot, delete this phone's local copies for orders that have a report **and** are older than 7 days.

---

# Part E — Careful deletes

**Verdict: BUILD.** One shared confirm dialog for every risky delete:

> **⚠ Borrar el pedido de MH Condesa (03/09)**
>
> Esto es lo que se pierde:
> • Armado en progreso: **254 de 421** productos, armados por **Israel**
> • Después de borrarlo, los armadores verán el pedido del **02/09** (viejo)
>
> Se guarda un respaldo por 30 días.
>
> **Para confirmar, escribe la palabra BORRAR en el cuadro de abajo y toca "Borrar".**
> [ ____________ ]
> [ Cancelar ]  [ Borrar ] ← gris hasta que diga BORRAR

- Accepts `borrar` in any case, ignores spaces/accents. The button stays grey with the hint `Escribe BORRAR`
  until it matches.
- Used for: coordinator order 🗑, report 🗑, "Subir y borrar progreso", the assembler's "Empezar de cero",
  and "Cerrar como terminado" (C5, word `CERRAR`).
- **When nothing unfinished is attached, a normal confirm is enough — no typing.** That covers the daily routine
  of deleting yesterday's **finished** order (§0): its report and `pedido_completo` keep everything. Typing is only
  asked when the order has unfinished progress (a saved armado without a report, or picks without a report).
- The pre-flight list always says **what changes for assemblers** (e.g. falling back to an older order), which
  is silent today (H§8.1).

---

# Part F — Verificar captura

**Verdict: BUILD.** Catch misclicks made while typing salidas into Retool, plus assembly errors that were typed
"correctly".

## F1 — What the export looks like (measured on the sample)

- Same table and columns as the order CSV, with `Salida (kg/pz)` filled in. 451 rows, all `Solicitud > 0`.
- **No hub column** → the coordinator picks the hub on upload (one file per hub per day).
- Extra useful columns: `Actualización salida` (when it was saved — all 147 within 2 seconds, so the whole
  grid is saved at once), `Registrado por` (who typed it), `Faltante` (`true` when salida = 0 was marked
  faltante), `Envío - Solicitud (#)` (= salida − solicitud).
- 147 rows have a salida (122 > 0, 25 = 0); 304 rows are blank — the reserva, never assembled.
- `Inventario hub saliente` in this export is **after** registration (32 rows with salida now show 0), so it
  cannot be used to tell activos from reserva. The app's own order is the reference.
- Over-delivery is normal and large: 19 products shipped 6–37 more pieces than requested (e.g. 13 requested →
  50 shipped, ratio 3.8×). These are whole boxes, not errors.
- **It is MH Contry, order of 19/10** (delivery 20/10), assembled by Ángel, report
  `MH_Contry_2026-10-19_15-17_Angel.csv`. Both files and the matching `pedido_completo` are in `fixtures/`.

## F1b — Prototype run on the real files (2026-10-20)

Rules below implemented in a throwaway script and run against `pedido_completo` + report + Retool export:

| Check | Result |
|---|---|
| Same order | **451 / 451** solicitudes identical (100 %). 152 activos in the order = 152 rows in the report |
| Capture | **147 of 153 correct** |
| 🔴 Armado, no capturado | **Prispas 130g** — armado 6, Salida blank in Retool. A real miss. |
| 🟡 Faltante sin marcar | 5 faltantes left blank instead of 0 / Faltante (Chilorio Chata, Chips de jícama Calii, Ruffles, Chip's, Pepsi Light 2.5L) |
| 🟠 Posible error de armado | none (largest over-delivery 3.8×) |

Planted errors in a scratch copy — all caught: two neighbouring values swapped → both flagged "valor de un renglón
vecino" (**to fix:** label the pair *intercambiados*) · 16 typed as 160 → "un dígito de más" · 17 typed as 5 →
capturado diferente · salida typed on a faltante row and on a reserva row → capturado sin armar · app armado 30 for
solicitud 3, typed 30 → 🟠 posible error de armado with capture OK.

## F2 — Is this the same order?

Before comparing quantities, prove the file is the order we think it is. Compare `Solicitud (kg/pz)` per
product between the export and the app's order — they are long decimals (`37.07333916935858`), so an exact
match means the same order.

| Matching Solicitud | Verdict shown |
|---|---|
| ≥ 90 % of products | ✅ Mismo pedido |
| 60–90 % | ⚠️ Probablemente el mismo pedido — algunas solicitudes cambiaron |
| < 60 % | ⛔ No parece el pedido de {hub} del {fecha} — ¿hub o día equivocado? (stops; can override) |

Also checked: the export's assembled rows vs the app's assembled rows. A few mismatches are human error, which
is exactly what the check is for; most mismatches mean the wrong file.

**Which order:** default = the hub's newest order that has a report. A date picker allows an older one. The order
rows come from `pedido_completo/{hub}/{date}.json` (the order CSV is usually already deleted); the assembled
quantities from that order's report(s) — R1 + R2 summed. If the order isn't finished yet, the check uses the saved
progress and says so.

## F3 — Three numbers per product

For each product (joined by barcode, then by name — same join as the cierre check):
**S** = Solicitud (from the order) · **A** = Armado in the app (R1 + R2 total) · **R** = Salida typed in Retool.

### Capture check — A vs R (exact)

| Result | Rule | Example |
|---|---|---|
| ✅ Correcto | R = A (Kg ± 0.01) | |
| 🔴 **Capturado diferente** | R ≠ A | armó 24, capturó 42 |
| ↳ *parece del renglón vecino* | R equals A of the product just above/below | value typed one row off |
| ↳ *intercambiado con el vecino* | R and the neighbour's R are each other's A | two values swapped |
| ↳ *un dígito de más / de menos* | R = A×10, A÷10, or a repeated digit | 12 → 120, 12 → 1 |
| 🔴 **Armado, no capturado** | A > 0, R blank | |
| 🔴 **Capturado sin armar** | R > 0, A = 0 / not in the app's list | salida typed on a reserva row |
| 🟡 Faltante sin marcar | A = 0, R blank, `Faltante` not ticked | |

"Neighbour" is checked in **both** orders a typist might have seen: A–Z (the registro copilot's order) and the
export's own row order.

### Assembly check — A vs S (independent of Retool)

Catches the case where the app shows a wrong quantity that was then typed "correctly":

| Result | Rule (Pz) | Rule (Kg) |
|---|---|---|
| OK | A ≤ S + 2 pieces | A ≤ S + 0.2 kg |
| Sobrante normal (shown, not flagged) | anything up to 5× S | up to 3× S |
| 🟠 **Posible error de armado** | A ≥ 5× S **and** A ≥ S + 10 | A ≥ 3× S **and** A ≥ S + 2 kg |

The thresholds are constants at the top of the script (like `FLAG_GAP_MIN`). Checked against the sample: the
largest box over-delivery is 3.9×, so none of today's 19 legit sobrantes trip the flag, while "asked 10, assembled
100" does. If A vs S is flagged **and** R = A, the row says
`Posible error de armado — se capturó igual que en la app, revisar físicamente`.

## F4 — Result screen

What the real Contry 19/10 file would show:
```
MH Contry · pedido del 19/10 · armado por Ángel · capturado por aux.calidad 19/10 16:15
✅ Mismo pedido (451 de 451 solicitudes idénticas)

153 productos · ✅ 147 correctos · 🔴 1 error de captura · 🟡 5 faltantes sin marcar
[Errores] [Todo]                                                 ⬇ CSV

🔴 Prispas 130g                         pedido 6 · armado 6 · no capturado en Retool
🟡 Chilorio de cerdo Chata 215g         faltante · Salida vacía (capturar 0 o marcar Faltante)
…
```
With misclicks, rows read like:
```
🔴 Doraditas de chocolate / Doraditas de semillas   intercambiados — armado 6 y 7, capturado 7 y 6
🔴 Sal La Fina 250g        armado 16 · capturado 160 · un dígito de más
🟠 Canela molida McCormick pedido 3 · armado 30 · capturado 30 — posible error de armado, revisar físicamente
```

- Saved to `verificaciones/{hub-slug}/{orderDate}.json` (summary + rows). That's what turns the order status into
  ☑️ Capturado / ⚠️ Captura con errores (B1), and what the morning banner counts.
- Re-uploading after fixing Retool replaces the result (with a respaldo of the old one).
- Read-only toward Retool: it never writes there.

---

## 6. Build order

| Phase | Items | Why |
|---|---|---|
| 0 | ~~V1–V3~~ done (§0) | |
| 1 ✅ built 2026-10-20 (uncommitted) | **C1** respaldos before every delete (+ sweep resumed leftovers) · **D1** filenames · **D2** r2 helper · **D3** · **D4** `sbReplace` · **D4b** paging | Makes everything undoable, makes "is this finished?" answerable, stops the 1000-row truncation before daily picks pass it |
| 2 ✅ built 2026-10-20 (uncommitted) | **A** coordinator pages | Frame for everything below; pure UI, low risk. Also: hub cards wrap to two lines on a phone (the name was squeezed to "M C"); the partial-events log stays on Faltantes until Respaldos exists (Phase 4) |
| 3 ✅ built 2026-10-20 (uncommitted) | **B** status + morning banner + historial · resume guard for finished orders · **perf**: request queue (max 8, 429 retry), two-stage load, maintenance once a day — the first build fired ~47 requests per open and Supabase rate-limited them (pages empty) | Didn't need the C4 view: status uses the bucket lists, metrics sidecars (cached) and a `limit=1` picks check; the view waits for Respaldos (Phase 4). Pre-v2.3 multi-day reports are matched through their sidecar's `orderDate` |
| 4 ✅ built 2026-10-21 (uncommitted) | **C2/C3/C5** Respaldos panel + upload stop for unfinished orders + Cerrar como terminado | Restaurar for a partial only on the order loaded now and with no report; the lost-progress list needs the `picks_por_pedido` view (C4) — degrades to a note without it |
| 5 | **E** careful deletes | |
| 6 ✅ built 2026-10-20 (uncommitted) | **F** verificar captura | Built ahead of 4–5. Additions over the spec: rows sorted worst-first; a ⛔ file hides its rows; status chip + banner count on Pedidos. **Changed by Jose:** no 🟡 "faltante sin marcar" — only real mistakes; **per-hub cards like Cargar pedidos**, the order cross-check is a wrong-file guard (mismatch → warning + re-upload, never saved) |
| 7 | **D5/D6** retry chip + local cleanup | |

Each phase: build on localhost with Supabase writes stubbed, ≤3 quick checks, ship when the set works, bump
`CACHE_NAME`, update the handoff in the same commit.

## 7. Acceptance tests

| # | Test | Expected |
|---|---|---|
| T1 | Assembler "Empezar de cero" on 3/10 (types BORRAR) | Respaldos lists it as "Borrado por armador"; Restaurar → hub shows 3/10 again |
| T2 | Finish an order normally | Respaldos lists "Terminado"; status ✅ Armado; report name has both dates |
| T3 | Order 03/09 at 254/421; coordinator uploads 04/09 | Red ⛔ modal before upload; Cancelar writes nothing; override needs typed SUBIR; afterwards the card shows 03/09 in red; assemblers see only 04/09 |
| T4 | Coordinator deletes an order with progress | Dialog names the progress and the fallback date; Borrar grey until BORRAR typed; order + progress in Respaldos |
| T5 | Restore a deleted order | Assemblers load it again, same rows |
| T6 | R1 + R2 same date | Both shown with own status; 🗑 on R2 only removes the r2 |
| T7 | Morning with 6 finished + 1 in progress yesterday | Banner: "6 de 7 armados · 1 en progreso (…)" |
| T8 | Verificar with `fixtures/retool_salida_fixture.csv` on MH Contry 19/10 | ✅ Mismo pedido 451/451; 147 correctos; 🔴 Prispas no capturado; 🟡 5 faltantes sin marcar — same as F1b |
| T9 | Verificar with another hub's order selected | ⛔ No parece el pedido |
| T10 | Same planted errors as F1b in a copy of the sample | Swap labelled "intercambiados"; 160 "dígito de más"; others as in F1b |
| T10b | Coordinator "Cerrar como terminado" on a 3/10 order | Typed CERRAR; report with 7 Pendiente rows; status ✅ Cerrado por coordinador; respaldo listed |
| T10c | Delete yesterday's finished order (daily routine) | One-tap confirm, no typing; report and pedido_completo untouched |
| T11 | Report with an armado of 100 for a solicitud of 10 | 🟠 Posible error de armado, even when R = 100 |
| T12 | Network off 3 min mid-assembly | ☁ chip after 2 min; clears after reconnect |
| T13 | Full normal assembly | Report columns identical to today's |
| T14 | Old single-date report files | Show in Historial under the right day; registro copilot still works |

## 8. Decisions

Settled 2026-10-20: sample = MH Contry 19/10 (F1) · coordinator can close an order as finished (C5) · read-only
production checks done (§0) · trash/respaldos 30 days · typed confirms with explicit Spanish instructions · Historial
grouped by day with weekday · assemblers see only the newest order; an unfinished older one is the coordinator's
red flag (C3).

Still open (none blocks Phase 1):
1. **Why is each day's order deleted?** If it's so assemblers don't open yesterday's list, the upload of a new day
   could do that by itself once C3's stop exists — then 🗑 becomes rare again. Not required; it only changes how
   prominent 🗑 needs to be.
2. *(Optional)* Check *Storage → Policies* for an UPDATE policy on the bucket (V2). D4 is built either way.
