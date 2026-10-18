# FoodHubbie launch series — 3 × 28s one-take episodes

Same system throughout: `motion.js` + `look.js` (Geist/Inter/Geist Mono, brand `#ec4c0c`),
one carrier element per episode, camera chases the carrier, gather → seal → wordmark
(full seal only in EP3; EP1/EP2 end on episode card + next-episode pointer).

Graphics rule (better graphics): real product frames wherever they exist —
`../foodhubbie-launch-28s/shots/` (19) + `../../../Promo-Campaign/footage/` take frames
(status screen, dashboard, orders history, menu grid, promos tab). DOM rebuilds only
where no screenshot exists (chat bubble, rider map accents).

## Episodes

| EP | Name | Carrier | Arc | Dir |
|---|---|---|---|---|
| 1 | ORDER | ticket | QR scan → menu → customize → cart → KDS → rider → delivered → chat ping | `film/foodhubbie-ep1-order/` |
| 2 | GROW | coupon chip | combos → discounts → coupon → campaign launch → customers → feedback → notifications | `film/foodhubbie-ep2-grow/` (needs batch2 screenshots) |
| 3 | MONEY | ₹ coin | POS → payments → expenses → costs → analytics → settings/audit → wordmark seal | `film/foodhubbie-ep3-money/` (needs batch2 screenshots) |

## Shared contract (all episodes)

```js
window.__meta = { dur: 28, fps: 30, cuts: [], inFrame: { carrier: [1.3, 23.4] } };
window.__track = (t) => ({ carrier: [x, y, w, h, op], ... });
window.__motion = (t0, t1) => max(screenTravel, carrier travel);
```

Gates per episode: probe (continuity ≥ 0.75, framing 0 off) → stills → render 1080p30 →
sound (palette score, times from comp T) → verify_promo PASS → review → 4K60 + README.

## Build order

EP1 now (all graphics banked) → batch2 screenshots (post-auth-cooldown) → EP2 → EP3 →
review all three drafts → 4K60 ×3.
