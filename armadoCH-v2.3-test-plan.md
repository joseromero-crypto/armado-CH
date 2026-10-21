# Armado CH v2.3 — end-to-end test (run in a new Claude Code chat)

**Goal:** one full pass of the app at phone size in the Browser pane, against **live production data, with every
write stubbed**, before v2.3 is pushed. Jose does not test manually — this replaces the "test on a real phone" step.

**Start the new chat with:**
> Read `CLAUDE.md`, then `armadoCH-v2.3-test-plan.md`, and run the test exactly as written. Don't push.

Code under test: `main` at `24ccc8a` or later (v2.3 Phases 0–7 + Part F). `CACHE_NAME` `calii-armado-v2-3-p5`.
Reference: `armadoCHhandoff.md` (§7 screens, §8 lifecycles, §9.12 Verificar captura).

---

## 0. Safety rules — read before touching anything

1. **The anon key in `index.html` writes to production.** Every test runs only in the `http://localhost:8080` tab,
   and only after the write stub (§2) is installed. Reinstall it after **every** navigation or reload.
2. **Close any `file:///…/index.html` tab.** Editing `index.html` makes the editor open it as a `file://` tab that
   runs the code **without** the stub (this caused real deletes on 2026-10-20). Check `tabs_context` at the start
   and after any edit; close those tabs. Don't edit `index.html` during the test unless a fix is needed.
3. **Reads against production are allowed** (Jose authorized read-only access). No writes, no pushes.
4. **Don't type the coordinator PIN.** Open the coordinator with `showScreen('coordinator'); loadCoordinatorScreen()`.
5. At the end, confirm production is untouched (§5) and clean the test tab's localStorage (§6).

---

## 1. Setup

The pane's own launcher can't read `~/Desktop` (macOS privacy), so serve from the shell:

```bash
cd /Users/adrianrodriguez/Desktop/armado-CH && exec python3 -m http.server 8080 --bind 127.0.0.1
```
Run it with `run_in_background: true`. Then `preview_start` with name `armado-local` (`.claude/launch.json` attaches
to `http://localhost:8080`, it doesn't start a process). Set the viewport: `resize_window` preset **mobile**
(375×812). Reset to desktop at the end.

Fixtures (gitignored, served locally at `/fixtures/…`):
- `retool_salida_fixture.csv` — real Retool export, **MH Contry, order 19/10/2026**
- `report_contry_2026-10-19_fixture.csv` — its report · `pedido_completo_contry_2026-10-19_fixture.json` — its order

## 2. The write stub (install first, after every reload)

```js
window.__writes=[]; const _f=window.fetch; window.__realFetch=_f;
window.fetch=async(u,o={})=>{ const m=(o.method||'GET').toUpperCase(); const url=String(u);
  if(m==='GET'||m==='HEAD'||(m==='POST'&&url.includes('/object/list/'))) return _f(u,o);   // reads pass through
  window.__writes.push({m, url:url.replace(/^https:\/\/[^/]+(\/storage\/v1\/object\/solcitudesarmado)?/,''), body:typeof o.body==='string'?o.body:''});
  return new Response('{}',{status:200,headers:{'Content-Type':'application/json'}}); };    // every write is faked
'stub on'
```
`window.__writes` is the log of what *would* have been written — several cases check it. To simulate "no network"
for a path, wrap the stub so that path throws `new TypeError('Failed to fetch')`.

**Facts that change daily** (which hubs have an order today, what's in progress): read them from the screens
first; the expected results below describe behaviour, not specific numbers, except where a fixture fixes them.

---

## 3. Assembler flow (phone size)

Pick a hub that has an order loaded (its card on 📦 Pedidos shows `✓ Pedido dd/mm`). If a real assembler is
mid-assembly on it, the hub screen will show "Continuar" — that's fine (writes are stubbed); note it.

| # | Do | Expect |
|---|---|---|
| A1 | Home → **Armar Pedido** → tap the hub | Status strip `✓ Cargado el …` (or amber `⚠ … NO es de hoy` + blocking modal if the order isn't today's — tap "Entendido"). Name dropdown appears. `Iniciar Armado` reads `Verificando progreso…` then enables (or stays disabled with a resume / ✅ "ya se terminó" / 🛟 card) |
| A2 | Pick a name → **Iniciar Armado** (or **Continuar**) | List screen: header `← hub ❓ 💾`, `N/N`, Finalizar, `Todos · Pendientes`. Rows sorted by position, with image / name / position / qty, `📅 DD/MM` chip where the order has shelf-life |
| A3 | Tap the first pending row → type its barcode into `#bc-field` (value = the row's "Código" tag) + Enter | `✓ Código correcto`, focus jumps to quantity. A wrong code → `❌ Código no coincide` and Confirmar refuses |
| A4 | Enter the requested quantity → **Confirmar ✓** | Row turns ✅, `N/N` +1, the next pending row opens by itself. `__writes` has a `partials/{hub}/{date}__…json` POST, a `picks` insert and a `partial_events` "saved" |
| A5 | Next row: enter more than requested (e.g. +12) → Confirmar | ⬆️ Sobrante |
| A6 | Next row: **⚑ Faltante** → **📭 No se encontró** | ❌, opens the next one. Faltante is two taps, never one |
| A7 | **💾** → modal shows `N/M` → **Guardar y salir** | Back home, toast `✓ Progreso guardado` |
| A8 | Armar Pedido → same hub | Resume card `📂 Pedido en progreso · <name> · N de M` (from this phone's local copy). **Continuar pedido** → list restored with the same rows done |
| A9 | Network-fail test: make partial POSTs throw, confirm one more item, then set `_syncSince=Date.now()-3*60000; updateSyncChip()` | `☁ Sin sincronizar desde HH:MM — tu avance está en este teléfono` under the header; 💾 modal adds the ☁ warning; home pill `⏳ 1 pendiente de enviar`. Restore the stub → `_syncAttempt=0; await runPartialSync()` → chip, pill and `calii_partial_pending_sync` all gone |
| A10 | **Finalizar pedido** → (pending modal) → summary | Tiles count the full set; sort `Posición / A–Z / Estado`, search, chips work and never change the tiles. `← Seguir armando` returns to the list unchanged |
| A11 | Summary → **Terminar armado** | `✅ Reporte guardado correctamente` → `Listo →`. `__writes`: report `reports/{slug}/{orderDate}_{finishDate}_{HH-MM}_{Armadores}.csv` (**two dates**), a `respaldos/…__terminado.json` **before** the partial DELETEs, `partial_events` cleared/report_uploaded, metrics sidecar. Report body: header row identical to `Hub,Armador,Fecha,Hora,Posición armado,Producto,Código en sistema,Código físico escaneado,Unidad,Solicitado,Inventario CH,Armado,Verificación código,Estado,Vencimiento mínimo,Segundos en producto` |
| A12 | Resume card → **Empezar de cero** (set up with a fake `_pendingPartial` if needed) | Typed dialog: "…escribe la palabra BORRAR…", button grey until `borrar` is typed (case/accents ignored). Confirm → respaldo POST before any DELETE |
| A13 | Setup → **📋 Pedidos armados** → open one | Read-only summary of a finished report, `← Volver` returns |

## 4. Coordinator (phone size) — open with `showScreen('coordinator'); await loadCoordinatorScreen()`

| # | Do | Expect |
|---|---|---|
| C1 | Header + menu | Header: only `←` and `↺`. Menu (sideways scroll): 📦 Pedidos · ✅ Armados · ☑️ Verificar captura · 📭 Faltantes · 📊 Métricas · 🔄 Cierre · 👤 Armadores · 🖼 Imágenes. One page visible at a time; last page remembered after reload |
| C2 | 📦 Pedidos | Morning banner `Pedidos del <weekday> … · N de M armados · K capturados`. Cards appear within ~1–2 s with `…`, then statuses: ⚪ / 🟡 N/M · who · hace X / ✅ N/M · who · terminado HH:MM / 🔒 / 🔴. **Only the current order** per hub. Buttons: Subir CSV · 📄 No surtido · (🛟 / Cerrar como terminado when 🟡/🔴) · 🗂 Respaldos · 🗑. No `429` in the console |
| C3 | ✅ Armados → Hoy / Historial | Grouped by order date, headings like `Lunes 19 oct 2026 · ayer — 5 armados`; R2 indented under R1; Historial hub + 7/30/90/todo filters; 📋 opens the registro copilot |
| C4 | ☑️ Verificar captura → **MH Contry** card → upload `/fixtures/retool_salida_fixture.csv` (via `DataTransfer` on `#vc-file-mh-contry`) | Verified against **19/10** (toast if the card's newest order is later). `✅ Mismo pedido (451 de 451 …)`, `153 productos · ✅ 152 correctos · 🔴 1 error de captura`, first row **Prispas 130g — armado 6, no capturado**. Faltantes left blank are **not** flagged. `__writes`: `verificaciones/mh-contry/2026-10-19.json`. Card gains `Pedido 19/10: ⚠️ 1 error · Ver` |
| C5 | Same file on the **MH Cumbres** card | Modal `⛔ Archivo equivocado … solo ~33 de ~511 coinciden. Parece ser el archivo de MH Contry (pedido del 19/10)`. Nothing written. "Subir otro archivo" re-opens the Cumbres picker |
| C6 | Planted errors: copy the fixture, swap Salida of *Doraditas de chocolate* ↔ *Doraditas de semillas*, set *Sal La Fina 250g* → 160 → upload on Contry | Rows tagged `intercambiado con «…»` (both), `un dígito de más o de menos`; worst first. ⬇ CSV (intercept `triggerDownload`) has **Hub** and **Pedido** columns on every row |
| C7 | 📭 Faltantes, 📊 Métricas, 🔄 Cierre, 👤 Armadores, 🖼 Imágenes | Each loads; Métricas table ~130+ rows for 30 days, filters work, ↺ reloads it |
| C8 | 🗂 Respaldos on a hub (Contry has real copies) | Sections: Avance guardado ahora · (🔴 Avance perdido — needs the `picks_por_pedido` view, which exists) · Respaldos (30 días) · 📜 Eventos. **Ver** opens a copy read-only, `← Volver` returns |
| C9 | Upload stop: `window.orderStatus=async()=>({kind:'progreso',done:112,total:301,armadores:['Diego'],at:Date.now()-3600e3})`, then `uploadHubCSV({files:[new File([csv],'o.csv')],value:''},'MH Contry')` with any small valid order CSV. Restore `orderStatus` after | Only if Contry's loaded order isn't today's: `⛔ MH Contry todavía no termina el pedido del dd/mm … 112 de 301 · Diego`, Ver respaldos / grey **Subir de todos modos** until `SUBIR`. **Zero writes before typing.** (If Contry's order *is* today's, the stop correctly doesn't apply — note it) |
| C10 | Cerrar como terminado from Respaldos on a real unfinished copy (Contry 14/09-r2, 1/7, if still there) | Typed `CERRAR` → `__writes`: R2 report first, then respaldo, `partial_events` cerrado_coordinador, partial DELETEs, metrics with `INCOMPLETO` + `CERRADO_COORDINADOR` |
| C11 | Order 🗑 on a finished order / on one forced to look in progress / report 🗑 | Finished → plain confirm that says what assemblers will see after; in progress → typed BORRAR; report → always typed, says product count |

## 5. Confirm production is untouched (read-only, with the real fetch)

```js
window.fetch=window.__realFetch;
({contryPartials:(await sbList('partials/mh-contry/')).length, contryRespaldos:(await sbList('respaldos/mh-contry/')).length,
  verifContry:(await sbList('verificaciones/mh-contry/')).length, verifCumbres:(await sbList('verificaciones/mh-cumbres/')).length})
```
Compare with the same query run **before** the test (do it right after §2 and note the numbers). They must match.

## 6. Clean up the test tab

Remove what the test left in this tab's localStorage (it's local to the test browser, but keep it clean):
`calii_partial_*` keys created during the test, `calii_partial_pending_sync`, `calii_outbox` (should be empty).
Reset the viewport to desktop. Stop nothing else — the background server can stay.

## 7. What this test cannot cover — say so in the report

- A real **Bluetooth scanner** (simulated by typing into `#bc-field` + Enter).
- **iOS Safari** specifics (the pane is Chromium) — sticky headers, file pickers, `inputmode="none"`.
- **Real writes** to Supabase (stubbed on purpose): uploads, deletes, the outbox flushing for real.
- Multi-device behaviour (two phones on one order).

## 8. Report back to Jose

A table: case id · pass/fail · one line of evidence (what was seen or written). Then: failures with the exact
symptom and a proposed fix (don't fix without asking), the §7 limits, and whether v2.3 is ready to push.
**Don't push** — Jose decides. Deploy command for reference:
`cd ~/Desktop/armado-CH && git push`
