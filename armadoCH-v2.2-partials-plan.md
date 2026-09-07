# Armado CH — v2.2: partial-save durability

Reviewed against `index.html` @ `e352481` (3,795 lines). Companion to `armadoCH-v2-plan.md`,
`armadoCH-v2.1-plan.md` and `armadoCHhandoff.md`. Nothing here has been built.

Written after a real data-loss incident on **2026-09-04**: MH Condesa lost 254 of 421 resolved
SKUs overnight. The data was recovered from the `picks` table and re-uploaded by hand
(see §5.3 — that manual recovery is the reference implementation for Fix F5).

## How to use this document

**§1** is the incident and the evidence. **§2** is the audit: every path in the current code that
can destroy a partial, numbered D1–D14. **§3** ranks which of them caused this one and explains
why we cannot know for certain. **§4** is the fix set, F1–F11, each with its cost. **§5** is the
build order, **§6** the acceptance tests.

**Part B** at the end is a separate, unrelated request: filter and sort on the summary screen
(the one reached from 📋 Pedidos armados). It shares no code with §1–§8 and can be built before,
after or alongside them.

Every fix carries a **Verdict** line: `BUILD` / `BUILD (phase 2)` / `REJECTED` (with the
reasoning, so it isn't re-derived). Nothing is left undecided — every item is BUILD except the
merge in F9, which is rejected outright.

**Nothing here may break v2's ground rules**: the only assembler inputs are barcode and quantity;
advisory signals never block, disable or reorder; **any assembly with ≥1 confirmed item must leave
either a report or a resumable partial**; no cheap exits or bulk skips; round 1's report shape,
filename and registration step stay byte-for-byte unchanged.

That third rule is the one this document exists to enforce. Today the code states it as an
intention and does not defend it anywhere.

---

# 1. The incident

## 1.1 What was observed

Israel assembled MH Condesa on 03/09 against `orders/mh-condesa/2026-09-03.csv`, saved progress,
re-entered later the same day and resumed successfully. On the morning of 04/09 the resume card was
gone; the only thing on screen was the `⚠ Tu solicitud es del 03/09 — NO es de hoy` banner from
v2.1 §4.

## 1.2 What the server actually showed

| Check | Result |
|---|---|
| `partials/mh-condesa/2026-09-03.json` | **absent** — the prefix `partials/mh-condesa/` had no objects at all |
| `orders/mh-condesa/2026-09-03.csv` | present, `updated_at` 2026-09-03T15:14:28Z, never replaced |
| `reports/mh-condesa/*` | empty — the assembly was never finalized |
| `picks` where `fecha=2026-09-03 and hub='MH Condesa'` | **267 rows**, 254 distinct SKUs, armador Israel, 20:59:30Z → 23:11:01Z |
| `picks` where `fecha=2026-09-04 and hub='MH Condesa'` | none |
| Other hubs on 04/09 | Contry, Cumbres, Guadalupe, San Nicolás, Avícola all had fresh `order_date=2026-09-04` picks |

So: the coordinator did **not** re-upload Condesa, nobody finished it, nobody started a new
Condesa assembly, and the partial file was deleted.

## 1.3 Why multi-day was supposed to work

This is a bug, not a design limit. The code already commits to multi-day resume in three places:

- `partialSbPath()` (index.html:3663) — `// Path keyed by order file date (not today) so partials survive across calendar days`
- `resumePartialSave()` (index.html:3750) — `// The gap between the last segment's end and now (e.g. overnight) is never counted.`
- `partialKey()` (index.html:3662) — `// Keys are hub-only — one partial per hub, any assembler can pick it up`

The **identity model is already correct**: a partial belongs to a hub + order date, never to an
assembler or a device. Any armador, on any phone, on any day, is the intended behaviour, and each
item stores its own `assembler` so a hub assembled by two people over two days attributes correctly
per SKU. Nothing in §4 changes that model. What fails is the **storage layer underneath it**.

---

# 2. The audit — every way a partial can die

A partial lives in exactly two places: `localStorage[calii_partial_<hub-slug>]` (device-local) and
`partials/<hub-slug>/<orderDate>.json` in the bucket (the only cross-device copy). Here is every
path in the current code that removes either one.

| # | Path | Kills | Silent? | Fixed by |
|---|---|---|---|---|
| D1 | `savePartialToSupabase` deletes before it writes | remote | yes | F1 |
| D2 | `startAssembly()` clears unconditionally, racing an un-awaited check | both | yes | F2, F3 |
| D3 | "Nuevo armado" deletes with no confirmation | both | no, but one tap | F4 |
| D4 | `newOrder()` via `cancelOrBack()` / `requestSaveAndExit()` when `done===0` | both | yes | F2 |
| D5 | `clearPartialSave(hub)` called without an orderDate | local (any date) | yes | F1 |
| D6 | `flushOutbox` clears after a queued report lands | both | n/a — correct | — |
| D7 | Coordinator upload deletes **all** dates for that hub | both | warned, but vaguely | F9 |
| D8 | Coordinator deletes the order CSV → partial orphaned | neither, but unreachable | yes | F5 |
| D9 | `localStorage` quota exceeded → `catch(_){}` | local | **yes** | F7 |
| D10 | Browser eviction / different device / private tab | local | yes | F5, F6 |
| D11 | `loadPartialProgress` reads local first, never compares `savedAt` | newer remote work | **yes** | F6 |
| D12 | `beforeunload` doesn't cover the delete→write window, and is ignored on mobile | remote | yes | F1, F8 |
| D13 | A truncated write is indistinguishable from "no partial" | remote | **yes** | F1 |
| D14 | `picks` holds a full server-side record and nothing ever reads it back | — | — | F5 |

## D1 — delete-then-write, on every single confirm

```js
// index.html:3681
async function savePartialToSupabase(payload, seq){
  const path=partialSbPath(payload.hub, payload.orderDate);
  try{ await sbDelete(path); }catch(_){}          // ← remote copy no longer exists
  if(seq!==_partialSaveSeq) return;               // ← and this can return right here
  await fetch(`${SB_URL}/storage/v1/object/${BUCKET}/${path}`, { method:'POST', ... });
}
```

Between the `await sbDelete` and the POST landing, **there is no remote copy of the assembly**.
`savePartialProgress()` is called from `confirmItem` (index.html:2079) and `markFaltante`
(index.html:2094) — that is once per resolved item, so Condesa opened this window **267 times** in
one afternoon. Three ways it stays open forever:

- **D1a** — the seq guard returns after the delete has already happened. Save A deletes, save B
  bumps `_partialSaveSeq`, A returns without writing. Correct only if B completes; nothing checks.
- **D1b** — the page goes away between the two calls: tab closed, phone locked, app backgrounded,
  OS reclaims the tab. `saveAndExit()` (index.html:3568) fires `savePartialProgress()` and then
  *synchronously* navigates to home without awaiting it — so "Guardar y salir" followed by closing
  the browser is the single most likely way to lose the remote copy, and it is exactly the gesture
  an assembler makes at the end of a shift.
- **D1c** — the network drops. The call site is `savePartialToSupabase(payload,seq).catch(()=>{})`
  (index.html:3678). No retry, no outbox, no toast. Reports, picks and `inventario_dia` all go
  through the offline outbox; **the partial is the one thing that does not**.

The comment at index.html:1497 explains why the delete exists: `hard error = file already exists
(no anon UPDATE policy)`. So the bucket's RLS allows INSERT and DELETE but not UPDATE, and the code
works around it destructively.

## D2 — `startAssembly()` clears, and the guard that should stop it is a race

```js
// index.html:1744
function startAssembly(){
  // User chose to start fresh — discard any in-progress partial for this hub
  if(S.hub){ clearPartialSave(S.hub); }
```

The only thing preventing this from firing on a hub that *has* a partial is
`updateStartBtn()` (index.html:905): `const blockedByPartial=!!_pendingPartial;`.

But `_pendingPartial` is set inside `checkForPartialSave()`, which `finishOrderLoad()` calls
**without awaiting it** (index.html:1270). When `localStorage` misses — which is precisely the
multi-device case this whole feature exists for — the lookup needs a Supabase round-trip. During
that round-trip `Iniciar Armado` is enabled and the partial is intact on the server. One tap
deletes it.

Three variants make the window wider:

- If `loadPartialProgress` throws or hangs (slow warehouse wifi), `_pendingPartial` stays `null`
  **permanently** and the button is never blocked at all.
- If the assembler list is empty, `needsAssembler` is false and the button enables the instant the
  order loads — no name-selection delay to absorb the race.
- The stale-list modal is dismissed with a tap in roughly the same screen position, which primes a
  second tap.

## D3 — "Nuevo armado" is a one-tap destroy with no confirmation

```html
<!-- index.html:3743, inside the partial notice -->
<button class="partial-resume-btn" onclick="resumePartialSave()">↩ Continuar pedido</button>
<button class="partial-discard-btn" onclick="discardPartialSave()">Nuevo armado</button>
```

`discardPartialSave()` (index.html:3777) calls `clearPartialSave(hub, od)` immediately — local and
remote, no modal, no undo. It sits directly beside the button the assembler actually wants, on a
card that appears without warning. "Guardar y salir" — a *non-destructive* action — gets a
confirmation modal; this one does not.

This is also the only violation in the file of the standing rule *"no cheap exits and skips"*.

## D4 — `newOrder()` on the back arrow

`cancelOrBack()` (index.html:3562) and `requestSaveAndExit()` (index.html:3548) both call bare
`newOrder()` when `done===0`, and `newOrder()` (index.html:3606) calls `clearPartialSave`. On its
own that is defensible. Combined with D2 it is not: race → blank assembly starts → assembler sees
an unexpectedly empty list → taps `←` → `done===0` → the partial is deleted a second time, this
time deliberately by the code.

## D5 — the local key has no date in it

`partialKey(hub)` is date-less, so `clearPartialSave(hub, someDate)` always does
`localStorage.removeItem(calii_partial_<hub>)` regardless of which order date the local copy holds,
while only deleting `someDate` remotely. `finalizeAssembly()` (index.html:2328) calls
`clearPartialSave(hub)` with no date at all and relies on `S.orderDate` still being set. It happens
to be set today; nothing enforces it.

## D7 — a coordinator upload deletes every date, not just the one it replaces

```js
// index.html:1514
const partialFiles=(await sbList(`partials/${HUB_SLUG[hub]}/`)).filter(f=>f.name.endsWith('.json'));
```

That is *all* partials for the hub. Uploading a fresh 04/09 Condesa file deletes the in-flight
03/09 assembly. The modal says `Existe un armado en progreso para ${hub}` — it does not say
**254 de 421, armados por Israel, del 03/09**, which is the information that would stop the tap.

## D9 — the local copy fails silently when storage is full

```js
try{ localStorage.setItem(partialKey(S.hub),JSON.stringify(payload)); }catch(_){}
```

The Condesa payload is **470 KB** because `items` carries all 30 columns of every order row. The
same origin also stores `calii_order_cache_<slug>` (another full copy of `items`, per hub — 7 hubs),
the image-DB cache (`imagedb.json` is 1.29 MB), `calii_order_history` (whole report CSVs),
`calii_metrics_cache` and `calii_outbox` (whole report bodies). A 5 MB origin quota is reachable,
and when it is reached `setItem` throws, the `catch` swallows it, and the device silently has no
local backup — leaving the fragile remote copy as the only one.

## D11 — local-first is wrong on a shared tablet

```js
// index.html:3693 — loadPartialProgress
const raw=localStorage.getItem(partialKey(hub));
if(raw){ const p=JSON.parse(raw); if(p.hub===hub&&p.orderDate===orderDate&&p.items?.length) return p; }
// Supabase is only reached if the above misses
```

Nothing compares `savedAt`. Phone A holds an old copy; Israel does two more hours on phone B; phone
A opens the hub, gets its own stale copy, resumes, confirms one item — and the first
`savePartialProgress()` overwrites the remote with the older state. This is not just an availability
bug; it is **silent loss of newer work**, and it is the one failure in this list that can happen
with no network problem, no mis-tap and no full disk.

## D13 — a corrupt write looks exactly like no partial

The Supabase branch of `loadPartialProgress` wraps `JSON.parse` in `try/catch` and returns `null`.
A truncated body (D1c mid-flight) therefore presents to the assembler as "no hay progreso guardado",
and then the first fresh save overwrites it.

## D14 — the safety net already exists and nothing reads it

`recordPick()` (index.html:2945) writes one row per confirm and per faltante, server-side,
**immediately**, with the outbox behind it:

```js
const row={ fecha:todayStr(), hub:S.hub, ronda:S.ronda, sku_key:skuKeyOf(item),
  producto:..., unidad:..., cantidad:Number(r.picked)||0, senal, luz:..., seg_busqueda:...,
  armador:S.assembler||null, order_date:S.orderDate||null };
```

Every field needed to rebuild a partial is in there — `hub`, `order_date`, `sku_key`, `cantidad`,
`senal`, `armador`, `ts`. It is queried today only for the semáforo and the faltantes CSV, never for
recovery. This is why 03/09 was recoverable at all, and it is the basis of F5.

---

# 3. What caused this one

**Honest answer: it cannot be determined from the evidence, because the app records nothing when a
partial is deleted.** That gap is itself the first finding — see F10.

Ranked by how well each fits the observed state (remote gone, local gone or absent, no report, no
picks on 04/09, order file untouched):

1. **D3 — someone tapped "Nuevo armado."** Best fit. It is the only single deliberate action that
   removes both copies instantly and leaves no other trace. The assembler met the unfamiliar stale-list
   modal first, dismissed it, then met a two-button card; "Nuevo armado" reads like "empezar el
   armado de hoy" to someone who has been told the list is not today's.
2. **D2 + D4 — tapped `Iniciar Armado` before the remote check resolved, then `←`.** Fits equally
   well and requires no mistake at all, only a fast thumb on a slow connection. More likely than
   usual on 04/09 if the device had no local copy, since that is exactly the case that forces the
   slow path.
3. **D1b/D1c on 03/09 + D10 on 04/09.** The remote copy died at "Guardar y salir" on Wednesday; the
   successful same-day re-entry Israel reported came from `localStorage`; Thursday's session was a
   different device or an evicted store, so there was nothing left. Fits the timeline exactly,
   including the detail that it *worked* on re-entry the first day.

All three are real defects present in the shipped code and all three are worth closing regardless of
which one fired. The fix set below closes all of them.

---

# 4. The fixes

## F1 — Write before you delete: versioned partial files

**Verdict: BUILD. This is the root-cause fix.**

**Rule:** a partial is never removed until its replacement is confirmed written.

Replace the single mutable object with an append-then-prune scheme:

```
partials/<hub-slug>/<orderDate>__<epochMs>.json
```

- **Save** — POST the new file. Only after a 2xx, list the prefix and delete every older file for
  the same `(hub, orderDate)` beyond the newest **3**. Never delete first, ever.
- **Read** — `sbList('partials/<hub>/')`, filter to the `<orderDate>__` prefix, sort descending,
  fetch and `JSON.parse` the newest that parses. A corrupt newest file falls back to the previous
  one instead of presenting as "no partial" — this closes D13 for free.
- **Clear** — delete every file for that `(hub, orderDate)`, unchanged semantics, but only from the
  three legitimate callers listed in F2.
- **Legacy** — on read, if no versioned file exists, try the old flat
  `partials/<hub>/<orderDate>.json` path. Keep this fallback for 30 days, then delete it. Do not
  migrate existing files; the first save writes a versioned one.

**Cost:** one extra LIST per hub entry (the app already does a LIST for orders on the same screen —
no perceptible change), and up to 3× the storage for partials, which for 7 hubs is under 10 MB.

**Rejected alternative:** adding an anon UPDATE policy to the bucket so `x-upsert:true` works
without the delete. Simpler and it does close D1 — but it leaves D13 open, gives no recovery
snapshots, and moves a durability guarantee into Supabase dashboard state that isn't visible in the
repo. If you want it anyway, add it *as well as* F1, not instead of it.

**Also fix in the same pass (D5):** put the order date in the local key —
`calii_partial_<hub-slug>__<orderDate>` — and make `clearPartialSave(hub, orderDate)` require the
date. Add a one-time sweep that removes any legacy date-less `calii_partial_*` key after reading it.

## F2 — No read path may ever delete a partial

**Verdict: BUILD.**

**Rule:** a partial is destroyed by exactly three things, and nothing else:

1. an explicit destructive confirmation from the assembler (F4),
2. a report for that `(hub, orderDate)` landing successfully (`finalizeAssembly`, `flushOutbox`),
3. the coordinator replacing that order date's file, after the confirmation in F9.

Changes:

- **`startAssembly()` (index.html:1746)** — delete the `clearPartialSave(S.hub)` line outright.
  Starting fresh does not need to pre-delete anything; the first `savePartialProgress()` writes a
  new version that supersedes it (F1), and if the assembler abandons before confirming a single item
  there was nothing worth writing anyway.
- **`cancelOrBack()` (index.html:3565) and `requestSaveAndExit()` (index.html:3552)** — replace
  `newOrder()` with `newOrder(true)` (keep the partial) in the `done===0` branch. Leaving the hub
  without resolving anything must not be able to destroy work that was already there.
- **`newOrder()` (index.html:3608)** — invert the default. `newOrder()` keeps the partial;
  `newOrder({clearPartial:true})` destroys it. Only the post-report call site (index.html:2340)
  passes it. A destructive default on a function called from five places is how D4 happened.

**Cost:** a partial can now outlive an abandoned fresh start and be offered again on the next entry.
That is the correct trade — an extra "Continuar / Nuevo armado" card costs one tap; the current
behaviour cost a day's work.

## F3 — Never enable a fresh start on an unverified hub

**Verdict: BUILD.**

- `finishOrderLoad()` (index.html:1256) must **`await checkForPartialSave()`**.
- While the check is in flight, `Iniciar Armado` stays disabled and reads `Verificando progreso…`.
  Add `S._partialCheck = 'pending' | 'none' | 'found' | 'error'` and fold it into `updateStartBtn()`.
- On a definitive miss (404 from storage **and** a localStorage miss) → `'none'`, button enables
  normally.
- **On an error that is not a definitive miss** (network failure, 5xx, timeout) → `'error'`, the
  button stays disabled and shows `⚠ No pude verificar si hay progreso guardado · Reintentar`.
  Starting fresh on a hub whose partial state is unknown is the exact mistake that costs a day.
- **Escape hatch:** after the retry has failed once, offer `Empezar de cero de todos modos`, which
  routes through the F4 confirmation with the text *"No se pudo verificar si este hub tiene un
  armado guardado. Si lo hay, se perderá."* A hub that has genuinely never been started must still
  be startable in a dead zone.

**Cost:** one to two seconds before `Iniciar Armado` lights up. Acceptable — the assembler is
selecting their name in that window anyway.

## F4 — Confirm every destructive action, and name the loss

**Verdict: BUILD.**

`discardPartialSave()` gets the same treatment `saveAndExit` already has — `showModal(..., 'm-danger', ...)`:

> **⚠ Empezar de cero**
> Se perderán los **254 de 421** productos ya armados por **Israel** el **03/09**.
> Tendrás que armar todo el pedido otra vez. Esta acción no se puede deshacer.
> [ Sí, empezar de cero ] [ Cancelar ]

The counts come from `_pendingPartial` and are already computed for the notice text at
index.html:3733. Relabel the button `Empezar de cero` — "Nuevo armado" reads like a neutral
navigation choice, which is how it gets tapped.

**Cost:** one extra tap on an action that should be rare. Directly in line with the "no cheap exits"
rule.

## F5 — Rebuild from `picks` — the actual safety net

**Verdict: BUILD. Highest value item in this document.**

`picks` is an append-only, server-side, outbox-backed record of every confirm. As long as it exists,
losing a partial is an inconvenience rather than a day of rework. Make it a first-class feature.

**New function** `rebuildPartialFromPicks(hub, orderDate, ronda)`:

1. `pgSelect('picks', 'hub=eq.<hub>&order_date=eq.<orderDate>&ronda=eq.<ronda>&order=ts.asc&select=sku_key,cantidad,senal,armador,ts,seg_busqueda')`
   — key on **`order_date`**, never `fecha`; `recordPick` stamps `fecha` with the calendar day, so a
   multi-day assembly's picks are spread across several `fecha` values and only `order_date` groups
   them correctly.
2. Dedupe by `sku_key`, keeping the **last** row by `ts` (a re-confirmed item legitimately overwrites
   an earlier faltante — on 03/09 three of the twenty `no_encontrado` rows were later picked).
3. Map onto `S.items` by `skuKeyOf(item)` and derive `status` with `confirmItem`'s own rule, so a
   rebuild and a live session can never disagree:

```js
const reqQ = unit==='Kg' ? (parseFloat(it['Solicitud (kg/pz)'])||0)
                         : Math.ceil(parseFloat(it['Solicitud (kg/pz)'])||0);
const tol  = unit==='Kg' ? 0.05 : 0.5;
let st;
if (p.senal==='fecha_corta')            st='shortdate';
else if (picked===0)                    st='skipped';
else if (Math.abs(picked-reqQ)<=tol)    st='completed';
else if (picked>reqQ)                   st='sobrante';
else                                    st='partial';
```

4. Fill `confirmedAt` from `ts`, `assembler` from `armador`, `handleSec` from `seg_busqueda`.
   Set `openedAt`/`firstOpenedAt`/`touches`/`bcAttempts` to null/0 — **these are not recoverable and
   that is accepted.** Set `bcStatus:'scanned'` and `scannedBC:<sysBC>` for positive picks (an item
   cannot be confirmed without a scan or an explicit override), `'pending'` for faltantes,
   `'nosys'` where the row has no barcode.
5. Tag every rebuilt result `_restored:true` and the payload `restoredFrom:'picks'`.

**Surfaces:**

- **Assembler** — in `checkForPartialSave`, when no partial is found *and* picks exist for this
  `(hub, orderDate, ronda)`, show a distinct card instead of a blank start:
  `🛟 Recuperar armado del 03/09 — 254 de 421 · Israel` with a `Recuperar` button. Do not
  auto-recover silently; the assembler should know why the screen looks different.
- **Coordinator** — a `🛟 Recuperar armado` button per hub on the coordinator screen, so this can be
  done without engineering help. It writes the rebuilt partial and reports the counts.

**Metrics integrity:** a rebuilt assembly has no real `handleSec` for most items and one synthetic
segment spanning first→last pick. Stamp the report and the metrics sidecar with `recuperado:true`
and **exclude restored assemblies from `segMedianoPorSku` and the velocity figures**, or
`velocidad-armado` will treat a reconstructed 2h10m wall-clock span as a measured picking rate.
Counts (completo/sobrante/parcial/faltante) are exact and stay in.

**Cost:** reconstructed timing detail is lost. Explicitly accepted — the alternative is re-assembling
254 SKUs.

## F6 — Newest wins between local and remote

**Verdict: BUILD.**

`loadPartialProgress` fetches **both** copies, compares `savedAt`, returns the newer, and writes the
winner back to `localStorage`. Offline, the remote fetch fails and the local copy is used as it is
today. This closes D11, which is the only silent-corruption path in the list.

Add `deviceId` (a random id in `localStorage`, generated once) to the payload, and when the remote
copy is newer *and* came from a different device, say so on the resume card:
`Continuado en otro dispositivo a las 16:42`. Two people on two phones is a supported workflow; it
should be visible, not silent.

**Cost:** one extra GET per hub entry, in parallel with the order fetch. None in practice.

## F7 — Make the local copy small, and make its failure loud

**Verdict: BUILD.**

**Trim the payload.** `items` currently carries all 30 CSV columns. Verified by grepping every
`item['…']` access in the file, the app reads exactly **nine** order-row fields:

```
Producto · Código de barras · Kg/Pz · Solicitud (kg/pz) · Posición armado ·
Inventario hub saliente · Vida anaquel usuarios (min. días) ·
Vida anaquel usuarios (min. fecha) · Salida (kg/pz) · Envío - Solicitud (#)
```

(`Unidad`, `Estado`, `Solicitado`, `Armado`, `Verificación código` are read only from *report* rows
in `reportRowToSummary` and the registro parser — never from order rows. `generateCSV` passes
nothing else through.) Projecting `items` to these fields takes the Condesa payload from **470 KB to
roughly 90 KB**. Apply the same projection to `calii_order_cache_<slug>`.

⚠️ Before shipping this, re-run the grep — if any future column is read from an order row and is not
in the projection, the resume produces blank cells in the report.

**Handle the quota instead of swallowing it.** Replace the bare `catch(_){}` with a helper that, on
`QuotaExceededError`, evicts in this order and retries: image-DB cache → `calii_order_cache_*` for
hubs other than the current one → `calii_order_history`. If it still fails, set
`S._localBackupFailed=true` and show a persistent chip on the list screen:
`⚠ Sin respaldo local en este dispositivo — el progreso se guarda sólo en la nube`. The assembler
cannot fix it, but they can stop assuming the phone is a backup.

## F8 — Flush on `pagehide`, not just `beforeunload`

**Verdict: BUILD (phase 2).**

`beforeunload` (index.html:3648) is unreliable on mobile Safari and does not cover the home screen
after `saveAndExit`. Add `visibilitychange → hidden` and `pagehide` handlers that flush a pending
save with `fetch(..., {keepalive:true})`.

**Constraint:** `keepalive` bodies are capped at 64 KB. Even trimmed (F7) a 421-item payload exceeds
that, so the beacon must send a **compact delta** — `{hub, orderDate, savedAt, results}` with
`results` reduced to `[i, status, picked, senal]` tuples — which the reader re-hydrates against the
order CSV.

Marked phase 2 deliberately: once F1 removes the destructive window and F5 provides the `picks`
fallback, a lost final flush costs at most the last item, not the assembly. Build it only if F1–F7
have shipped and something still goes missing.

## F9 — Coordinator upload: scope it, price it, and offer a non-destructive option

**Verdict: BUILD all three bullets. The merge option is REJECTED — reasoning recorded below so it
isn't re-derived.**

### F9a — Scope the deletion to the order date being replaced (build)

`checkPartialThenUpload` (index.html:1514) lists `partials/<hub>/` and deletes **every** file it
finds. A new 04/09 file therefore destroys an in-flight 03/09 assembly. Filter to the order date
being uploaded. This is the bullet that actually matters for multi-day hubs — Condesa and Zapopan
run across days by definition, so a fresh upload for the *next* order will routinely collide with
the *previous* one still in progress.

### F9b — State the real cost in the modal (build)

Read the partial and name the loss instead of the current generic sentence:

> **⚠ Armado en progreso — MH Condesa**
> Hay **254 de 421** productos armados por **Israel** contra el pedido del **03/09**.
> Si subes este archivo, ese avance se pierde y hay que armar el pedido completo otra vez.

### F9c — Third button: `Subir sin borrar el progreso` (build)

The upload proceeds; the partial is left completely alone. The in-flight assembler keeps working
against the list they already hold (`resumePartialSave` sets `S.items` from the partial itself, so
the newly uploaded file is loaded and then discarded on resume — the partial is self-contained and
this needs no new machinery). The new file becomes the baseline for whoever starts next.

This is the escape hatch for "I need to correct a file while someone is assembling", and it costs
nothing: no reconciliation, no silent rewriting of anything an assembler already did.

### Why merging the two files is REJECTED

The proposal was: match old and new by `sku_key`, keep resolved statuses for SKUs present in both,
mark the rest pending. Three cases, and the middle one is disqualifying.

| Case | What merge does | Verdict |
|---|---|---|
| SKU only in the **new** file | mark pending | fine, trivial |
| SKU only in the **old** file | drop the row | **unsafe** — the product is already physically on the pallet. Dropping it means those pieces appear in no report, so the salida is never registered and inventory drifts with nothing to trace it to |
| SKU in **both**, already resolved, `Solicitud` changed | keep the resolved status | **disqualifying** — see below |

The third case is the killer. `status` is derived by comparing `picked` against `Solicitud (kg/pz)`
at the moment of the confirm (`confirmItem`, index.html:2073). Israel picks 3 against a request of
0.51 → `sobrante`, correct. The corrected file says the request is 8 → that same pick is now
`parcial`, the item still displays as **resolved**, and nobody tells Israel to go get five more.
The pedido ships short and the app reports it as done.

That is a **silent quantity error introduced by the system** — the exact failure mode that got
prefilled quantities deferred out of v2 ("fears it would cause system-vs-physical quantity
errors"). The same objection applies here with more force, because here the assembler never even
sees the number that changed.

The alternative — re-open every SKU whose `Solicitud` moved — means an assembler who finished an
item gets it handed back with no explanation, in the middle of a list they thought they were done
with. That is worse than either extreme.

**Every other fix in this document removes a way to lose data silently. A merge would add one.**
That asymmetry is the decision.

### What to do instead when a file genuinely needs correcting mid-assembly

1. **`Subir sin borrar` (F9c)** — the assembler finishes against the list they started with. The
   report reflects what was physically picked against what was requested *at the time*, which is
   the honest record.
2. **Then run a complemento (r2)** if the correction adds or increases anything. That path already
   exists (`armadoCH-v2.1-plan.md` §3.5), the team already understands it, it produces its own
   register, and it never rewrites a completed round. A corrected file mid-assembly is a
   complemento by another name — treat it as one.

The one cost of this approach: if the correction was "don't send this SKU at all", the assembler
still picks it. That is recoverable — the product goes back on the shelf and the discrepancy is
visible in the report. A silently wrong quantity is not recoverable, because nobody knows to look.

## F10 — Record why a partial was destroyed

**Verdict: BUILD. Cheap, and the reason §3 has a ranking instead of an answer.**

New table `partial_events`, one row on every save, clear and restore:

| column | value |
|---|---|
| `hub`, `order_date`, `ronda` | context |
| `action` | `saved` · `cleared` · `restored` |
| `reason` | `discard_button` · `report_uploaded` · `outbox_report` · `coordinator_upload` · `rebuild_from_picks` |
| `armador`, `done`, `total`, `device_id`, `ts` | who, how much, where, when |

Insert fire-and-forget through the existing outbox on failure. Surface the last 20 rows on the
coordinator screen under the existing conflicts panel. The next incident becomes a ten-second query.

## F11 — Multi-day: don't let midnight wipe a resumed session

**Verdict: BUILD (narrow scope only).**

`pollPicks` (index.html:2793) resets everything when the calendar day changes:

```js
if(S._picksDay && S._picksDay!==todayStr()){ await loadPicks(); loadInvDia(); updateLightChips(); return; }
```

For a session left open across midnight this wipes the picks buffer and the lights mid-assembly.
Make the reset re-derive lights **without** touching `S.results`, `S.segments` or the partial, and
ensure a missing `inventario_dia/<today>.json` (normal for a hub with no upload today) degrades to
"sin dato" rather than an implied zero.

**The light's own arithmetic does not change.** `loadPicks` keeps querying `fecha=eq.todayStr()`.
Per `armadoCH-v2.1-plan.md` §1, consumption is same-day by definition and filtering picks by
`order_date` would trade a false red for a false green. On day 2 of Condesa the light correctly
counts only day 2's consumption. **`order_date` is the key for recovery (F5), never for the
semáforo.**

---

# 5. Build order

Each step is independently shippable and leaves the app in a working state.

| Step | Fixes | Why this order |
|---|---|---|
| 1 | **F1** + F5's local-key date fix | Stops the bleeding. Nothing else matters if saves keep destroying themselves. |
| 2 | **F5** | The safety net. After this, every remaining bug is recoverable in-app without engineering. |
| 3 | **F2 + F3 + F4** | The three delete-on-read/mis-tap paths. Ship together — they touch the same three functions. |
| 4 | **F6 + F7** | Multi-device correctness and the silent local failure. |
| 5 | **F10** | Observability, so step 6 is informed by data. |
| 6 | **F9a + F9b + F9c**, **F11** | Coordinator and midnight edges. |
| 7 | F8 | Only if steps 1–6 leave a real gap. |
| — | **Part B** | Independent of everything above; slot in wherever convenient. |

Bump `CACHE_NAME` in `sw.js` on every deploy — it is currently `calii-armado-v2-1-fixpack`.

## 5.3 Reference implementation — the manual recovery already performed

The 03/09 Condesa partial was rebuilt and re-uploaded on 04/09 using exactly the F5 algorithm:
parse `orders/mh-condesa/2026-09-03.csv` → filter `Solicitud (kg/pz) > 0` → filter
`Inventario hub saliente > 0` (421 rows) → sort with `parsePos` → fetch the 267 picks → dedupe by
`sku_key` keeping the last `ts` → derive status with `confirmItem`'s rule → POST to
`partials/mh-condesa/2026-09-03.json`. Result: 421 items, 254 resolved — 143 completo, 82 sobrante,
12 parcial, 17 faltante, 167 pendiente. Read back and verified.

The 82 sobrantes are real, not an artifact: Condesa's requests are fractional (`Solicitud` of 0.51
against a box of 3) and assemblers round up to whole presentations. Any test that asserts
"sobrante should be rare" is asserting the wrong thing.

---

# 6. Acceptance tests

Run against a scratch hub with a 10-SKU order. **T1–T5 are the regression suite for this incident.**

| # | Test | Expected |
|---|---|---|
| T1 | Resolve 3 items, kill the tab mid-save (throttle to offline, confirm, close), reopen on **another device** | Resume card shows 3/10 |
| T2 | Resolve 3 items, "Guardar y salir", immediately force-quit the browser, reopen next calendar day on another device | Resume card shows 3/10 |
| T3 | Resolve 3 items, save, clear the device's site data entirely, reopen | 🛟 Recuperar card appears with 3/10 from `picks` |
| T4 | Select the hub and tap `Iniciar Armado` as fast as possible while the network is throttled to 3G | Button reads `Verificando progreso…` and cannot be tapped; resume card appears |
| T5 | Tap `Empezar de cero` on a hub with a partial | Danger modal naming count + armador + date; Cancelar leaves the partial intact both locally and remotely |
| T6 | Resolve 3 on phone A, 2 more on phone B, reopen on A | A shows 5/10 and `Continuado en otro dispositivo`; A's stale copy never overwrites |
| T7 | Enter a hub with no order file at all | `No hay pedido cargado`, unchanged |
| T8 | Enter a hub with an order but no partial and no picks | Normal fresh start, no card, no extra delay beyond the check |
| T9 | Coordinator uploads a **new date** for a hub with an in-flight older partial | Older partial survives; no modal |
| T10 | Coordinator re-uploads the **same date** | Modal states count + armador + date; on confirm the partial is gone |
| T11 | Finish an assembly normally, report uploads | Partial cleared, all versions pruned, `partial_events` shows `cleared/report_uploaded` |
| T12 | Finish with the network down | Report queued, partial **kept**; on reconnect the outbox lands and clears it |
| T13 | Fill `localStorage` to the quota, then resolve an item | Eviction runs and the save succeeds, or the `sin respaldo local` chip appears — never a silent no-op |
| T14 | Resume a partial written by the **current** version, then one written by the pre-v2.2 flat path | Both resume identically |
| T15 | Leave a list open across midnight | Lights re-derive; `S.results` and the partial are untouched |

---

# 7. What deliberately does not change

- **The identity model.** Hub + order date, never assembler, never device. Any armador on any phone
  on any day. F1–F11 make this actually true; none of them narrow it.
- **The semáforo's arithmetic.** Consumption stays `fecha = today`, all hubs. `order_date` is used
  for recovery only. (`armadoCH-v2.1-plan.md` §1 — do not relitigate.)
- **`recordPick`'s row shape.** F5 depends on it; it is now load-bearing for recovery, not just for
  the light. Adding columns is fine; removing or renaming `order_date`, `sku_key`, `cantidad`,
  `senal` or `armador` breaks recovery.
- **Round 1's report shape, filename and the registration step.** Byte-for-byte.
- **The stale-list banner and its blocking modal** (v2.1 §4). It behaved correctly on 04/09 — it was
  the only thing that told anyone something was wrong.

---

# 8. Open questions for Jose

1. **F5 auto-recover** — when a partial is missing but `picks` exist, should the app offer the
   🛟 card (proposed) or restore silently? Proposal is to offer, so the assembler knows the state
   was reconstructed and that per-item timings are not real.
2. **Restored assemblies in `velocidad-armado`** — proposal is to exclude their timing data and keep
   their counts. Confirm that is what you want for the baseline comparison.
3. **How long to keep partial versions** — proposal is the newest 3 per `(hub, orderDate)`, plus a
   coordinator-side prune of anything older than 30 days.

## Resolved — recorded so they aren't relitigated

- **Merging a corrected order file into an in-flight partial.** Rejected 04/09. A changed
  `Solicitud` on an already-resolved SKU silently converts a correct `sobrante` into an unflagged
  `parcial`, and the pedido ships short with the app reporting it complete. Replaced by F9c
  (`Subir sin borrar el progreso`) plus the existing complemento path. Full reasoning in §4 F9.
- **Filtering the semáforo's picks by `order_date`.** Rejected in `armadoCH-v2.1-plan.md` §1 and
  re-confirmed here: consumption is consumption. `order_date` is the key for recovery only.

---

# Part B — Summary screen (Pedidos armados): filter and sort

**Unrelated to the incident.** Independent of §1–§8 and of every fix in §4; ship in any order.
Nothing here touches partials, `picks`, the report CSV, or `_pendingReport`.

## B1. Which screen this is

The **summary screen** — `renderSummaryBody` (index.html:2142) — the one headed
`✅ Pedido completado` with the four stat tiles (Total / Completos / Parciales / Faltantes) over a
flat list of rows showing `posición · código · Falta N` and the armado quantity on the right.

It is reached two ways, and both must get the controls:

| Entry | Mode | Current order |
|---|---|---|
| `showSummary()` (index.html:2174) — after tapping Terminar en la lista | `'live'` | `S.items` order, i.e. `sortItems` → `parsePos` |
| `openFinishedSummary()` (index.html:2273) — armador side, **📋 Pedidos armados** | `'readonly'` | explicit `parsePos` sort at index.html:2289 |

**Both are ordered by `Posición armado` today, and that stays the default.** Confirmed from the
running app 06/09.

> ⚠️ Do not confuse this with the **coordinator's Registro screen** (`openRegistro` /
> `renderRegistro`, index.html:3449), which is a different screen with tick checkboxes and *is*
> sorted A–Z (`localeCompare`, index.html:3477). Part B does not touch it. If it ever needs the
> same treatment, the one trap there is that `key:'r'+i` is assigned in `.map((r,i)=>…)` **before**
> the sort — keep it that way or every saved tick re-binds to the wrong product.

## B2. What to build

Two controls in a single row between the stat tiles (`.sum-stats`) and the list (`#sum-list`).
Both are **view-only**: they change what is displayed and in what order, and nothing else.

Both entry points converge on the same normalized row shape, so one implementation covers both:

```js
{ producto, unit, reqStr, req, pickStr, pick, status, bcStatus, bc, pos }
```

### B2a — Sort (segmented control, 3 options)

| Option | Order | Notes |
|---|---|---|
| **Posición** | `parsePos(r.pos)` | **Default, unchanged.** Matches the order the system you type into uses, and the order the product was physically picked in. |
| **A–Z** | `producto` ascending | `localeCompare(b.producto,'es',{sensitivity:'base',numeric:true})` — accents fold, and `Calii 60g` sorts before `Calii 500g`. |
| **Estado** | Faltantes → Parciales → Sobrantes → Sin armar → Completos, then `posición` within each | Everything that needs a decision first; the long tail of Completos last. |

The sort helpers already exist — `parsePos` is in the file and `openFinishedSummary` already uses
it. Nothing new is needed to build this beyond the comparator for A–Z and Estado.

Persist the choice under `calii_sum_sort`. It is a stable preference of whoever registers, not a
per-assembly one.

### B2b — Filter

A text box plus four chips:

- **Search** — matches `producto` **and** `bc` (barcode), substring, accent- and case-insensitive.
  Run `normName()` over both sides for the product so `pina` finds `Piña`. The barcode is already
  in the row shape and already displayed (`<span class="sum-bc">`), so searching it is free.
  Placeholder: `Buscar producto o código…`.
- **Chips:** `Todos` · `Faltantes` · `Revisar` · `Sin armar`.
  - `Faltantes` → `SKIP_STATUSES` (skipped + shortdate).
  - `Revisar` → `QTY_ISSUE_STATUSES` (parcial + sobrante + legacy) **plus** any row whose
    `bcStatus` is `UNAVAIL` or `WRONGSYS` — the same definition the ⚠ notes in `summaryRowHtml`
    already use, so a quantity-perfect row with a barcode discrepancy still surfaces.
  - `Sin armar` → `status === PENDING`.

`✕ Limpiar` clears the box and returns the chip to `Todos`.

## B3. Three constraints — these are the whole design

**1. The stat tiles always count the full set, never the filtered view.**
`#st-total` / `#st-ok` / `#st-part` / `#st-skip` are computed at the top of `renderSummaryBody`
from `rows`. Leave that computation exactly where it is and feed it the **unfiltered** array. A
filter that also shrank the tiles would read `Total 12 · Completos 12` and look like a finished
pedido. When a filter or search is active, add one line above the list:
`Mostrando 12 de 34 · Ver todos`. The way back to everything must be one tap and always visible.

**2. Display order must never reach `_pendingReport`.**
In `'live'` mode `showSummary` builds `_pendingReport` (path, csv, items, results, segments) from
`S.items` / `S.results` **before** it calls `renderSummaryBody`, and `finalizeAssembly` uploads
exactly that. So sorting the display is already safe — the report cannot move. Keep it that way:
sort a **copy** for display, never `S.items`, never `S.results`, and never re-derive
`_pendingReport` or `generateCSV` input from the displayed rows. Add a comment at index.html:2182
saying so.

**3. The summary's filter and the list screen's filter stay separate.**
The picking list has its own `_listFilter`, reset to `'all'` in `startAssembly` and
`resumePartialSave`. `← Seguir armando` (`backToListFromSummary`) must not carry the summary's
filter back into the list, and vice versa. Two screens, two independent view states.

## B4. Implementation notes

- Add module state: `_sumRows` (the full normalized array as passed in), `_sumSort`
  (`'pos' | 'az' | 'estado'`, seeded from `localStorage`), `_sumFilter` (`{q:'', chip:'todos'}`,
  reset on every screen entry).
- `renderSummaryBody(rows, metaLine, mode)` keeps its signature. It stores `rows` in `_sumRows`,
  computes the tiles from `_sumRows`, then delegates the list to a new
  `renderSummaryList()` which applies filter → sort → `summaryRowHtml`. The control handlers call
  `renderSummaryList()` only, so the tiles never recompute.
- `openFinishedSummary` can drop its inline `parsePos` sort (index.html:2289) once
  `renderSummaryList` owns ordering — or keep it harmlessly, since `'pos'` is the default.
- Debounce the search input ~120 ms. Rebuild only `#sum-list`.
- **Preserve `scrollTop`** across any rebuild that isn't a sort or filter change.
- The controls belong in both modes. In `'readonly'` they are the whole point; in `'live'` they
  help someone scanning what they just finished before tapping Terminar.
- Mobile (this screen is used on a phone — see the screenshot): one line only, segmented sort on
  the left, search icon expanding to a full-width box on tap. It must not push the first product
  row below the fold on a 6.1" screen.
- Empty result: `Sin resultados para "…" · Ver todos` inside `#sum-list` — never a blank panel.

## B5. Acceptance tests

| # | Test | Expected |
|---|---|---|
| B-T1 | Open a finished pedido from 📋 Pedidos armados, cycle the three sorts | Rows re-order; the four stat tiles never change |
| B-T2 | Search `pina` | Matches `Piña`; tiles unchanged; `Mostrando N de 34 · Ver todos` appears and restores |
| B-T3 | Search a barcode fragment, e.g. `7672035` | Matches on the código shown in the row |
| B-T4 | Chip `Revisar` | Includes parciales, sobrantes **and** rows flagged `código ilegible` / `código discrepa` |
| B-T5 | In live mode: sort to A–Z, then tap **Terminar armado** | The uploaded report CSV is byte-identical to the same assembly finished without touching the sort |
| B-T6 | Live: sort + filter, tap **← Seguir armando** | The picking list is unfiltered and in its normal order |
| B-T7 | Reopen the screen later | Sort preference persisted; filter reset to `Todos` |
| B-T8 | A pedido with pendientes (`Resumen — N sin armar`) | Chip `Sin armar` isolates them; the title and tiles are unaffected |
| B-T9 | An r2 complemento summary | Sort and filter work; quantities and columns untouched |
| B-T10 | Filter down to 2 rows on a phone | No horizontal scroll; first row still above the fold |

## B6. What deliberately does not change

- **Posición armado stays the default order**, in both entry points.
- The four stat tiles, their labels and what they count.
- `summaryRowHtml` — the icons, the `posición · código · Falta N` line, the big armado quantity on
  the right.
- `_pendingReport`, `generateCSV`, the report filename and the registration step.
- `S.items` / `S.results` order.
- The coordinator's Registro screen (`renderRegistro`) — out of scope, see the note in B1.

## B7. Open item

- **Shared helper** — the metrics table (`armadoCH-v2.1-plan.md` §8.5) has its own sort/filter, and
  the coordinator Registro screen may want the same treatment later. Consider extracting the
  filter/sort into one small helper the three can share. Not required for Part B to ship — raised
  so it is a deliberate choice rather than an accident.
