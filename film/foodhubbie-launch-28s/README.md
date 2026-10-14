# FoodHubbie launch film — 28 s

Concept A · **"One order travels"** · 3840×2160 · 60 fps · one take, no cuts

The order ticket is born at a QR scan, travels the whole suite — pressing START ORDERING,
landing in the KDS, becoming the delivery pin, the WhatsApp message, the rupee on the analytics
card — then the whole cast gathers and folds into the FoodHubbie wordmark.

## Files

| file | what |
|---|---|
| `film.mp4` | **the deliverable** — 4K60, 28.0 s, with sound (H.264, CRF 16) |
| `draft.mp4` | 1080p30 review copy (same cut) |
| `comp.html` | the composition (open in a browser; `?t=12.5` to scrub, `?play` to play) |
| `look.js` / `look.json` | measured look (Geist display, Inter text, Geist Mono, brand orange `#ec4c0c`) |
| `motion.js` | motion library (camera, gather, seal, morph, hop, press, …) |
| `sfx_score.py` / `sfx.wav` | the sound score (times read from comp's own `T` constants) |
| `BEATSHEET.md` | beat table, world layout, camera keys, verification log |
| `shots/` | 16 product screenshots (live, 0 page errors) |
| `stills/` | look-check + check frames |

## Verification (both renders VERDICT: PASS)

continuity 1.00 (ticket carries every boundary) · framing 0 off (ticket 1.35–22.95 s, word 24–28 s) ·
curves soft 48–70 % @ 180° shutter · audio peak −8.0 dBFS, clipped 0, quiet 0.776 · rest/burst/not-flat PASS

## Rebuild

```
python scripts/look.py apply look.json comp.html     # after look.json edits
python scripts/probe.py comp.html                    # continuity / curves / framing
python scripts/render.py comp.html --out draft.mp4 --sfx sfx.wav            # 1080p30
python scripts/render.py comp.html --out film.mp4 --final --sfx sfx.wav --resume  # 4K60
python scripts/verify_promo.py film.mp4 --comp comp.html
```
