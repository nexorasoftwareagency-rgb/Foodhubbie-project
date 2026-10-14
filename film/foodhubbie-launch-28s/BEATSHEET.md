# FoodHubbie launch film — beat sheet

**Concept A · "One order travels" · 28.0 s · 1920×1080 · 30 fps drafts → 4K60 final**
Case dir: `D:\Foodhubbie Project\film\foodhubbie-launch-28s\`
Look: `look.json` (measured from product shots — ground `#fcfcfc`-family overridden by dark brand ground, accent `#ec4c0c`, accent2 `#24c45c`, display Geist 700, text Inter 500, mono Geist Mono)

## Story in one line

A QR scan at Table 01 births an order ticket; the ticket itself travels the whole suite —
pressing START ORDERING, pressing PLACE ORDER, landing in the KDS, becoming the delivery pin,
becoming the WhatsApp notification, becoming the rupee on the analytics card — then the whole
cast gathers and folds into the FoodHubbie wordmark.

The **ticket is the actor and the universal carrier**: one DOM element (`#ticket`) never leaves
the screen until the seal. Every beat boundary is carried by it. No hand cursor — the ticket
causes every reaction itself (it presses the buttons).

## World

One continuous world strip, camera `OM.camera` keyed to chase the ticket. Ground = brand dark
radial (`#35140a → #120c0a`, from the menu welcome), `OM.lattice` dots at depth 1.2, fixed
256² noise overlay (banding rule), vignette.

| station | world x | content | asset |
|---|---|---|---|
| S0 QR | 0 | white QR stand card 560×600 | `shots/qr-stand.png` |
| S1 phone | 1100 | phone frame 480×900, content swaps welcome → dishes → cart | `shots/menu-dinein.png`, `shots/menu-dishes.png`, `shots/menu-cart.png` (center-column crop) |
| S2 KDS | 3800 | Kitchen Display card (empty CONFIRM/PREPARING/READY lanes) | `shots/admin-kitchen.png` |
| S3 rider | 6400 | rebuilt delivery card (dark, route line, ETA) — rider login shot too weak for dispatch narrative | DOM (styled like `shots/rider.png`) |
| S4 chat | 8700 | rebuilt WhatsApp chat card (green bubbles) | DOM |
| S5 money | 10800 | analytics card + ₹ count-up + 4 rising bars | `shots/admin-analytics.png` + DOM overlay |
| gather | center 5500 | all 6 cards fan into a row + supreme + website tiles | + `shots/website.png`, `shots/supreme.png` |

Ticket states (one element, `morphRect`-style size/position lerp, text spans swap):
seed 44×44 → ticket 300×150 → KDS card 320×200 → pin 96×120 → bubble 340×110 → ₹ chip 240×130 → seed (fold).

## Camera (final keys)

Keys chase the ticket; intro pull `y 516 / zoom 1.62`; whips on `cubicInOut` (3.20, 11.35, 13.62,
16.60→16.80, 20.30); camera returns to centre + zoom-in for the seal (locks before fold).
Hand float × `handEnv` (0 in rests, 0 after 25.0). Shakes on landings (KDS 8.4, pin 11.4,
bubble 14.4, gather 21.05, seal 23.0). Pull-out zoom → 0.31 at gather (20.30–21.05, smoother).
Rests: no drift, no hand — truly still.

## Beat table

| # | t | beat | length | camera | carries into next |
|---|---|---|---|---|---|
| 1 | 0.0 | QR macro: stand fills frame, one QR eye pulses orange (2 pulses), ground breathes | 1.4 | zoom 2.3→2.05 slow sine | pulse point |
| 2 | 1.4 | **Seed**: module lights → ticket springs out (popIn + impact), QR card kicks (shake 1.4) | 1.2 | holds, then pre-lead right | **ticket** born at module point |
| 3 | 2.6 | **Scan→Menu**: whip right to phone (expoInOut); ticket lands on START ORDERING, `press` dips button + ring; phone content swaps welcome→dishes; 8 dish cards stagger-rise (popIn, 0.06 stagger) | 3.2 | whip + settle | **ticket** (survives, pressed the button) |
| 4 | 5.8 | **REST 1**: dead still on dish grid; ticket resting on the Cheese Pizza card | 1.2 | still | ticket on card |
| 5 | 7.0 | **Order→Kitchen**: content slides welcome-style to cart (0.3 s); ticket presses PLACE ORDER (7.4, impact); ticket arcs (hop) out of phone → chases to KDS, lands in CONFIRM lane (8.4, squash+shake); status staccato on ticket: **RECEIVED → PREPARING → READY** (0.3 s each, 8.9/9.2/9.5); lanes' counters tick | 3.6 | chase right, snap-land | **ticket** = KDS card in lane |
| 6 | 10.6 | **Kitchen→Road**: ticket compresses to pin (morphRect), drops (gravity) onto rebuilt rider card, landing shake (11.4); route line draws dash-offset 11.6–12.6; ETA row springs in | 2.8 | chase, settle | **ticket→pin** |
| 7 | 13.4 | **Road→WhatsApp**: pin slides left into chat card, inflates to green bubble; 2 message lines `wordRise` (13.8/14.1); typing dots tick (14.4); tick ✓ pops | 2.6 | holds | **pin→bubble** |
| 8 | 16.0 | **WhatsApp→Money**: bubble pops up-left (liftOut); ripples leave its point (ripple 0.5 s); whip to analytics; ₹ **count-up 0 → ₹1,24,860** (expoOut, 16.8–17.9); 4 bars rise staggered (17.0+0.12i) | 2.8 | whip + settle | ripple origin → **₹ chip** |
| 9 | 18.8 | **REST 2**: dead still on ₹ + bars | 1.2 | still | — |
| 10 | 20.3 | **Gather**: camera pulls out (zoom → 0.31, smoother, 0.75 s); 6 station cards + website + supreme tiles fan in on arcs (`gather`, stagger 0.08, arc up); ticket shrinks to seed at center | 2.1 | pull-out | **cast → row**, ticket center |
| 11 | 22.4 | **Seal**: cast folds into turning disc (`seal`, camera back to centre + zoom-in before fold); disc stamps down (impact 23.0); **FOODHUBBIE** letters drop with squash (`letterDrop` stagger 0.055) | 1.6 | still (camera locked) | **cast→seal→wordmark** |
| 12 | 24.0 | **Tagline**: `typeOn` "One scan. whole restaurant." at 38 cps + caret; sub-line wordRise: "QR menu · Admin · Kitchen · Riders · WhatsApp" | 1.0 | still | caret → cursor dot |
| 13 | 25.0 | **End**: URL `foodhubbie-web.web.app` + "Start your restaurant today" spring in as unit; from 25.6 **dead still** to 28.0 | 3.0 | locked | end (exempt) |

## Boundary / carry audit (probe)

| boundary ~t | survivors | verdict |
|---|---|---|
| 2.6 QR→phone | ticket (moves ≥2% diag), QR exits left | carried |
| 7.4 cart→hop | ticket presses, stays on screen | carried |
| 8.4 phone→KDS | ticket lands in lane (same element) | carried |
| 11.0 KDS→rider | ticket→pin morph, same element | carried |
| 13.4 rider→chat | pin→bubble, same element | carried |
| 16.4 chat→money | liftOut origin → ripple → ₹ chip continuity; ₹ chip carries | carried |
| 20.8 single→gather row | all cards survive as cast; ticket center | carried |
| 23.6 cast→wordmark | seal disc large ≥3% frame, anchored; letters grow from it | anchored/carried |
| 25.0 → end | last 1.2 s exempt | — |

Target: carry score ≥ 0.75, zero bare boundaries outside bursts/end.

## Rhythm pre-check

- Lengths: 1.4, 1.2, 3.2, 1.2, 3.6, 2.8, 2.6, 2.8, 1.2, 2.4, 1.6, 1.0, 3.0 → mean 2.19, σ 0.84 → **CV 0.38** (≥0.25 ✓)
- Dead still: rest1 1.2 + rest2 1.2 + end 2.4 + intro holds ≈ 6.8 s ≈ **24–27%** (≥25% target; intro pulse counts low not still — if short, extend rest1 to 1.4)
- Longest quiet ≥1 s ✓ (1.2/1.2/2.4)
- Bursts: dish stagger (8 pops / 1.0 s @ 2.8) + status staccato (3 hits / 0.9 s @ 9.4) — non-uniform intervals ✓
- Curves: majority sineInOut/quintInOut (soft); expoInOut only on 3 whips; snaps < 30% of travel → median t80 ≥ .55 ✓

## Contract

```js
window.__meta = { dur: 28, fps: 30, cuts: [],
  inFrame: { ticket: [1.3, 23.4] } };
window.__track = (t) => ({ ticket: [x, y, w, h, op], ... });   // screen boxes
window.__motion = (t0, t1) => max(screenTravel, ticket travel);
```

## Sound (step 7 — done)

`sfx_score.py` reads `T` from comp.html itself (18 events, peak −8 dBFS): bubble on seed (1.4),
air whoosh on hop (2.6), key woods on presses (3.1/7.4), sub-thocks on lands (8.4/11.4/16.75),
3 glass ticks on staccato, bubble on chat (13.55), air on money (16.0), one riser breath through
rest2 tail into gather (19.65→21.05), gather hit, fold suck-in (22.4), seal stamp sub+ring (23.0),
falling air on end card (24.95). No music — action score only, rests silent (per sound.md).

## Verification (draft 1080p30 — VERDICT: PASS)

`verify_promo.py draft.mp4 --comp` → rest ✓ (still 0.405, quiet 5.0s), burst ✓ (7 bursts),
not-flat ✓ (0.52), audio ✓ (peak −8.0 dBFS, clipped 0, quiet 0.776), continuity ✓ (1.00,
1 boundary carried via ticket), curves ✓ (peak 521 px/frame, shutter 180°, soft 70%, t80 0.60),
framing ✓ (ticket 1.35–22.95 s, word 24–28 s, 0 off). Render: 840 frames / 3181 captures, 0 page errors.
Check frames: `stills/chk-3.10.png` (press on real button), `chk-16.70.png` (chip clear of KPIs),
`chk-21.50.png` (8-tile wall full width), `chk-23.05.png` (stamp).

## Assets

- Look material: `C:\Users\2nile\.config\opencode\skills\onetake\shots\` (16 shots, all verified live, 0 page errors)
- Product lib: `motion.js` (copied here), `look.json` (copied here)
- Build order: comp.html → `probe.py` (no bare) → `stills.py` look check → `render.py` draft 1080p30 → sound → `verify_promo.py --comp` → user review → 4K60 + README
