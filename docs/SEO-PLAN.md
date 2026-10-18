# SEO Plan — foodhubbie-web.web.app

Ordered, one item at a time. Status: ✅ done · 🔧 now · ⏳ queued · ➖ N/A (5-page static site).
Target keyword: "restaurant management software for pizzerias" (+ clusters below).

---

## Phase 1 — Technical plumbing (fast, do this week)

| # | Item | Status | Action | Done when |
|---|------|--------|--------|-----------|
| 1 | GSC setup | ✅ | Verified via `google9f7ca857bd7b6d53.html`; keep file deployed forever | — |
| 2 | Sitemap submitted | ✅ | `sitemap.xml` + `robots.txt` live; "Couldn't fetch" self-resolves | Indexed pages > 0 in GSC |
| 3 | Request indexing | ✅ | All 5 URLs submitted | — |
| 4 | Canonical tags | ✅ | Self-referencing canonicals on all 5 pages (deployed + live-verified) | Done |
| 5 | GA4 | 🔧 CODE DONE | `website/shared/ga4.js` on all 5 pages + CSP opened for gstatic/GA. Pending: **user enables Google Analytics in Firebase console** (Project → Analytics → Enable, 1 min) — until then beacons carry `id=undefined` | Realtime report shows our visits |
| 6 | Image alt text | ✅ | Audited: index.html 30 images all have descriptive alt; form pages have no images | Done |
| 7 | Heading structure | ✅ | Audited: exactly one H1 per page, H2 sections clean | Done |
| 8 | Titles 50–60 chars + unique metas | ✅ | Unique descriptions already on all 5; index title trimmed to 58 chars keyword-first | Done |
| 9 | Core Web Vitals | ✅ | Lighthouse (mobile) after fixes — hero img eager+preload, Google Fonts non-blocking on all 5 pages. Perf: 81/97/98/97/97, LCP 2.3/2.0/1.8/2.0/1.9s all green, CLS ≈0 | Done — revisit with field data in 2 weeks |
| 10 | Mobile friendly | ✅ | Responsive build | — |
| 11 | Crawlable JS content | ✅ | Site is static HTML — content server-rendered by Firebase Hosting | — |
| 12 | Clean URLs | ✅ | Hosted aliases live: /signup /architecture /book /contact → 200 (canonicals keep pointing at .html) | Done |
| 13 | 404s / redirect chains | ✅ | Catch-all `**` rewrite dropped (was serving index = soft-404 for any path); custom 404.html live — `/xyz` returns 404 | Done — internal link audit clean |
| 14 | Breadcrumbs | ✅ | Visible breadcrumb + BreadcrumbList schema on architecture.html | Done |
| 15 | Orphan pages | ✅ | All 5 pages in nav/footer | — |
| 16 | Schema test | ⏳ | Existing: Organization, WebSite, SoftwareApplication, FAQPage. Run Rich Results Test (user, 2 min) | 0 errors |
| 17 | Bing Webmaster | ⏳ (user OTP) | Import site from GSC in 1 click at bing.com/webmasters; submit same sitemap | Bing shows pages |

## Phase 2 — Quick wins

| # | Item | Status | Action |
|---|------|--------|--------|
| 18 | Rewrite low-CTR titles | ✅ done for index | Re-audit after Phase 1; GSC CTR data needs ~2 weeks of impressions |
| 19 | Page-2 pages / declining pages | ➖ | New site — nothing to refresh yet; revisit at 3 months |
| 20 | "People also ask" | ⏳ | Expand FAQ (currently 6 Q&As) with PAA pulled from target keyword searches; keep FAQPage schema in sync |
| 21 | dateModified | ⏳ | Add `dateModified` to JSON-LD on each page; bump on real content edits |

## Phase 3 — Content buildout (1 page/week; the actual ranking engine)

Cluster: **restaurant management software** (pillar = index.html)

| # | Page | Type | Target query |
|---|------|------|--------------|
| 22 | **QR code ordering system for restaurants** ✅ | feature | `qr code ordering system` — live `/qr-ordering.html` (2026-10-18): keyword-front title 51c, 5-Q FAQPage schema, BreadcrumbList, home-nav + footers interlinked, clean alias /qr-ordering; Lighthouse perf 96, LCP 2.1s. → user: request indexing in GSC |
| 23 | **Restaurant POS billing software** ✅ | feature | `restaurant pos software india` — live `/pos-billing.html` (2026-10-18): 50c keyword-front title, 5-Q FAQPage schema (cost vs monthly vendors, split bills, reports), BreadcrumbList, pos/payment-tracking screenshots, home-nav + footers interlinked, sitemap updated. Lighthouse perf 93, LCP 2.2s. → request indexing in GSC |
| 24 | **Kitchen display system (KDS)** ✅ | feature | `kitchen display system` — live `/kds.html` (2026-10-18): 52c keyword-front title, 5-Q FAQPage schema, BreadcrumbList, live-orders/orders/orders-update screenshots, preloaded hero. Lighthouse perf 92, LCP 2.8s. → request indexing in GSC |
| 25 | **Rider delivery management** ✅ | feature | `delivery management software restaurant` — live `/riders.html` (2026-10-18): 52c keyword-front title, 4-Q FAQPage schema, BreadcrumbList, rider-management/rider-login screenshots, clean alias /riders, sitemap → 9 URLs. Lighthouse perf 96, LCP 2.1s. → request indexing in GSC |
| 26 | Use case: pizzerias & cloud kitchens | use-case | `software for pizza shop` |
| 27 | FoodHubbie vs Petpooja / Posist | comparison | `petpooja alternatives` |
| 28 | Best restaurant management software in India 2026 | listicle | `best restaurant management software` |
| 29 | Pricing page (public) | money page | `restaurant software price india` |

Method for keyword picking (free): Google autocomplete + PAA + competitor sitemaps (Petpooja, Posist, DotVs, SlickPOS blogs). Fix cannibalization by rule: 1 intent = 1 page (log in this file before writing).

## Phase 4 — E-E-A-T

| # | Item | Status | Action |
|---|------|--------|--------|
| 30 | About / author bio | ⏳ | Real founder bio (name, photo, experience) on contact.html + author byline on blog-type pages |
| 31 | Trust signals | ⏳ | Real testimonials when available (current testimonial hidden as unverifiable — restore only with a real one), privacy policy page |

## Parked (explicitly skipped for now)
- GBP video verification — user does it manually; profile is live & complete (see PROJECT_LEDGER.md 2026-10-17 entry).
- Paid keyword tools — free methods only until traffic justifies them.
