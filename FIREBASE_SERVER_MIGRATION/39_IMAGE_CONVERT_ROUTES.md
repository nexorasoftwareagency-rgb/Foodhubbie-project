# 39 - Image-convert routes: deleted, not ported (batch 23k)

`bot-control-api/server.js` still served two `requireSuperOnly` routes after the
box went dark: `POST /api/images/convert` and `POST /api/images/convert-batch`
(both `sharp`). Doc 24 listed `convert-batch` as "remains on the box — `sharp`".
Before porting anything, this batch checked whether the feature should exist at
all. It should not. **Decision: delete it; no Function, no `sharp` in the
Functions bundle.**

## 1. What the pre-pass actually did

The only caller was the Supreme onboarding wizard
(`SupremeAdmin/js/features/restaurant-onboarding.js`). After creating the
tenant it fetched the chosen template's status images, converted them to PNG
base64, and wrote:

```
businesses/{bid}/outlets/{oid}/bot/{imgPlaced|imgConfirmed|imgReady|imgOut|imgDelivered}Png
```

The single-image route had **zero callers** anywhere in the repo (client or
server).

## 2. Five independent reasons it was dead

Measured live on 2026-11-16 (Admin SDK reads, no writes):

| # | evidence | consequence |
|---|---|---|
| 1 | **Every outlet on the estate carries `*Png` count = 0** — scanned all `outletIndex` entries plus `pizza`, `cake`, `outlet`; no `img*Png` key exists under either `bot/` or `settings/Bot/` | the pre-pass has never produced a durable value anyone used |
| 2 | the bot reads **`settings/Bot`** (`getData("settings/Bot", order.outlet)`, `bot/index.js:1511`), never the outlet `bot/` node for images | the wizard wrote `bot/{key}Png` to a node nothing reads; `bot/` is pair/status/transport |
| 3 | template defaults already ship **https JPEGs** — `appTemplates/{pizza,cake,kitchen}/defaults/bot/imgConfirmed` = `https://foodhubbie-assets.web.app/images/status/confirmed.jpg`; `whatsappTemplates` has no `defaults` | the inputs were valid images before conversion |
| 4 | the bot converts at **send time** — normal path converts URL/JPEG → PNG via sharp (`bot/index.js:770-777`) and falls back to text on any image failure | the pre-pass only saved one fetch + one sharp call per status message |
| 5 | base64 in RTDB is the **cost incident** — batch 13 measured live pizza `settings/Bot` at **1,352,155 B → 1,404 B**; every one of those values was this class of inline blob, downloaded on bot boot and every admin outlet read | re-adding ~5 base64 PNGs per new tenant re-creates the exact egress batch 13/15 removed |

Two tenants (`-p5aidfx57acc4on6ffv`, `-p5wn8ta7qeasj79wlag`) do carry
`settings/Bot.img*` as inline **`data:image/svg+xml`** placeholders from an
older default source. Those are unrelated to this feature (not `*Png`, not
written by the wizard) and are deliberately untouched here.

## 3. What changed

| file | change |
|---|---|
| `bot-control-api/server.js` | both routes deleted, `require('sharp')` removed |
| `bot-control-api/package.json` | `sharp` dependency removed (no other use in that package) |
| `SupremeAdmin/js/features/restaurant-onboarding.js` | the post-create pre-conversion block deleted; a comment names this doc. (The template images themselves were also landing on the wrong node — fixed separately, doc 40.) |
| `bot/index.js` | **unchanged on purpose** — it still prefers `img*Png \|\| img*` and keeps the `data:image/png;base64,` fast path, so any legacy value would still send. Removing that tolerance needs a live bot deploy and buys nothing |

New tenants get the template's https JPEG in `settings/Bot` (the node the bot and
the Admin settings card actually read — see doc 40 for the write-target fix),
and the bot fetches/converts at send time. Nothing about status messages changes
for the live outlet (it already uses Storage URLs).

## 4. Why not port it

- It is not a backend job whose absence breaks anything (doc 24 already marked
  it non-fatal); it is a pre-optimisation for a read path that does not exist.
- Porting it would either keep the base64-in-RTDB write (regressing batches
  13/15) or require a new supreme-scoped Storage upload route — new surface,
  new auth path, new tests, all to save one fetch per status message.
- It keeps `sharp` (~native binary) out of the Functions deploy, which matters
  given the batch 23j Cloud Run CPU ceiling.

**What would change this decision:** a future flow that genuinely needs raster
conversion server-side (e.g. SVG → PNG for WhatsApp delivery, or resize-on-upload
limits). The shape then is a supreme-scoped route in `tenantMedia.ts` that writes
the result to **Cloud Storage** and returns a URL — never base64 into RTDB.

## 5. Verification

- `node tests/image-convert-removal.check.cjs` — guard (CI step
  `test:image-convert`): no route, no `sharp` in either package, no wizard call,
  no `${key}Png` write anywhere in client code, template defaults still https,
  the bot's read tolerance still pinned, doc present. **16/16.**
- `node --check` on both edited JS files.
- `SupremeAdmin` rebuilt + `hosting:supreme` deployed (version
  `aad288d.20261116T041010Z`, later rebuilt with the doc-40 fixes); the live
  bundle no longer contains `convert-batch`.
- Live wizard E2E on a throwaway tenant through the deployed dashboard
  (`%TEMP%/opencode/e2e-23k-image-convert.cjs`) — **28/28**: tenant created,
  profile reached, owner login created by the `tenantOnboarding` Function,
  status images are the template https URLs, no `*Png` key, no inline base64,
  no convert request, 0 unexpected console errors, fixtures restored
  byte-identically.
- Encoding guard green.

**The verification found three real blockers, none of them caused by removing
the pre-pass** — the atomic create was already failing with
`PERMISSION_DENIED`. Two rules `.validate` bugs and a wrong image write target
are fixed and recorded in `40_ONBOARDING_CREATE_FIXES.md`.

