# Armado CH — notes for Claude Code

Calii's inter-hub order assembly app. Coordinators upload order CSVs; assemblers on phones scan + type
quantities; reports land in Supabase and are typed into Retool by hand.

**Read `armadoCHhandoff.md` before changing anything.** It is the reference, rewritten from the code. §8
(lifecycles) is mandatory before touching saving, deleting or recovery. The `armadoCH-v2*-plan.md` files are
history (shipped), not current behaviour.

## Shape
- Everything is in `index.html` (HTML + CSS + vanilla JS). No framework, no build step, no package.json.
  Match the surrounding style: dense one-liners, short comments, `S.*` for global state, Spanish UI text.
- `sw.js` service worker (network-first). `manual/manual-armado-ch.md` is the staff manual, rendered
  in-app at runtime. Edit the .md to change it.
- Supabase via raw `fetch`: Storage bucket `solcitudesarmado` (typo is intentional) + tables `picks`,
  `partial_events`. The anon key in `index.html` is **production**.

## Rules that must survive any change
1. Assembler inputs are only barcode + quantity. No new fields to type.
2. Advisory signals never block, disable, auto-skip or reorder items.
3. No cheap exits: no bulk actions, faltante is always two taps.
4. **Safety invariant:** any assembly with ≥1 resolved item leaves a report or a resumable partial.
   Never add a code path that deletes a partial outside the triggers listed in handoff §8.2.
5. Round 1's report columns, filename and registration flow stay byte-for-byte the same.
6. All dates/times via `serverNow()` + `TZ` helpers (`todayStr`, `localDateStr`, `localHM`) — never the
   device clock or `toISOString().slice(0,10)`.
7. Storage has no anon UPDATE policy: rewrite in place = delete-then-insert. Partials are versioned files.
8. A new Supabase table needs explicit `grant`s in the same SQL that creates it (handoff §3).
9. If you read a new order-CSV column, add it to `ORDER_ROW_FIELDS`.

## Workflow
- Local: `python3 -m http.server 8080` → http://localhost:8080 (not `file://`).
- **Local runs write to prod.** Stub `sbUpload`, `sbDelete`, `pgInsert` in the browser before testing any
  write flow. Don't query prod data without asking.
- Build → test on localhost, a few quick checks per phase; push only when the whole set works.
- Real business exports go in `fixtures/` (gitignored). Never commit them; the GitHub repo is public.
- Before each deploy: bump `CACHE_NAME` in `sw.js` if `index.html` changed · run a full assembly end to end
  if `confirmItem` / `generateCSV` / status maps changed · **update `armadoCHhandoff.md` in the same commit**.
- Deploy (only when Jose asks): `find .git -name "*.lock" -delete 2>/dev/null; git add . && git commit -m "…" && git push`
  — Netlify auto-deploys `main`.
