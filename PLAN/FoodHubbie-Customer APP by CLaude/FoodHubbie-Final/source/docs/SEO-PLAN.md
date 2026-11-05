# SEO Plan — foodhubbie-web.web.app

Ordered, one item at a time. Status: ✅ done · 🔧 now · ⏳ queued · ➖ N/A (static site). Phases 1–3 done (2026-10-18); Phase 4 blocked on real testimonial; Phase 5 = external-plan audit done (2026-10-22); user-assisted items pending (GA enable, GSC re-index, Bing, Rich Results test).
Target keyword: "restaurant and cafe management software" (pivoted 2026-10-18 — owner directive: no pizza-specific keywords; all pizza mentions swept from site copy, titles, FAQs, forms, llms.txt).

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
| 21 | dateModified | ✅ | `"dateModified":"2026-10-18"` added to FAQPage JSON-LD root on index + all 8 content pages (dateModified lives on CreativeWork supertype — valid; utility pages signup/book/contact skipped, nothing changes there). All 19 JSON-LD blocks parse-verified (`tools/check-schema.cjs`); bump date on real content edits | Done |

## Phase 3 — Content buildout (1 page/week; the actual ranking engine)

Cluster: **restaurant management software** (pillar = index.html)

| # | Page | Type | Target query |
|---|------|------|--------------|
| 22 | **QR code ordering system for restaurants** ✅ | feature | `qr code ordering system` — live `/qr-ordering.html` (2026-10-18): keyword-front title 51c, 5-Q FAQPage schema, BreadcrumbList, home-nav + footers interlinked, clean alias /qr-ordering; Lighthouse perf 96, LCP 2.1s. → user: request indexing in GSC |
| 23 | **Restaurant POS billing software** ✅ | feature | `restaurant pos software india` — live `/pos-billing.html` (2026-10-18): 50c keyword-front title, 5-Q FAQPage schema (cost vs monthly vendors, split bills, reports), BreadcrumbList, pos/payment-tracking screenshots, home-nav + footers interlinked, sitemap updated. Lighthouse perf 93, LCP 2.2s. → request indexing in GSC |
| 24 | **Kitchen display system (KDS)** ✅ | feature | `kitchen display system` — live `/kds.html` (2026-10-18): 52c keyword-front title, 5-Q FAQPage schema, BreadcrumbList, live-orders/orders/orders-update screenshots, preloaded hero. Lighthouse perf 92, LCP 2.8s. → request indexing in GSC |
| 25 | **Rider delivery management** ✅ | feature | `delivery management software restaurant` — live `/riders.html` (2026-10-18): 52c keyword-front title, 4-Q FAQPage schema, BreadcrumbList, rider-management/rider-login screenshots, clean alias /riders, sitemap → 9 URLs. Lighthouse perf 96, LCP 2.1s. → request indexing in GSC |
| 26 | **Use case: restaurants & cafes** ✅ | use-case | `software for restaurants and cafes` — live `/use-cases.html` (2026-10-18): 4 format cards (cafes / family restaurants / cloud kitchens / quick-service), 4-Q FAQPage schema, BreadcrumbList, home title+meta repositioned restaurant-and-cafe. Lighthouse ~88-96. → request indexing in GSC |
| 27 | **FoodHubbie vs Petpooja / Posist** ✅ | comparison | `petpooja alternatives` — live `/compare.html` (2026-10-18): honest 9-row structure table (per-order vs monthly), "When NOT to pick us" honesty card (chains → enterprise suites), 4-Q FAQPage (cheapest POS, alternatives verdict, riders included, no hardware). Competitor claims hedged to structure-level. Lighthouse perf 95, LCP 2.3s. → request indexing in GSC |
| 28 | **Best restaurant management software in India 2026** ✅ | listicle | `best restaurant management software` — live `/best-software.html` (2026-10-18): honest by-category guide (per-order systems / monthly POS suites / aggregator-dependent) instead of fake rankings, 6-point buyer checklist anchoring to #checklist, 4-Q FAQPage schema. perf 93. → request indexing in GSC |
| 29 | **Pricing page (public)** ✅ | money page | `restaurant software price india` — live `/pricing.html` (2026-10-18): 4 per-order rate cards (₹1 counter/₹2 QR/₹5 WhatsApp/₹1 promo) + ₹500 setup strip + worked month examples, 5-Q FAQPage schema, home nav Pricing now links here. **ga4.js rewritten** — SDK loaded after window `load` (dynamic import) to kill TBT: pricing perf 84→93, benefits all pages. → request indexing in GSC |

Method for keyword picking (free): Google autocomplete + PAA + competitor sitemaps (Petpooja, Posist, DotVs, SlickPOS blogs). Fix cannibalization by rule: 1 intent = 1 page (log in this file before writing).

## Phase 4 — E-E-A-T

| # | Item | Status | Action |
|---|------|--------|--------|
| 30 | About / author bio | ⏳ | Real founder bio (name, photo, experience) on contact.html + author byline on blog-type pages |
| 31 | Trust signals | ⏳ | Real testimonials when available (current testimonial hidden as unverifiable — restore only with a real one), privacy policy page |

## Phase 5 — External plan audit (2026-10-22)

A third-party SEO plan (homepage/meta/H1 rewrites, keyword-to-page table, 4 articles, technical
checklist, off-site authority, 90-day roadmap) was reviewed against this file. **Most of it is
already built.** Mapping:

| External-plan item | Verdict | Where it already lives |
|---|---|---|
| Homepage title / meta / H1 | ✅ already | title `Restaurant and Cafe Management Software | FoodHubbie`, meta names QR + kitchen + rider + ₹1–5 per order, H1 `Restaurant Management Software That Runs Your Cafe on Autopilot` — keyword-first, matches the 2026-10-18 pivot |
| Product screenshot + alt + caption above fold | ✅ already | hero `admin-dashboard.webp` (preloaded, descriptive alt), 32s demo video with caption |
| Visible pricing summary on homepage | ✅ already | pricing section + FAQ (₹1–5 per order, ₹500 setup) |
| Pricing consistency (the plan's own flag) | ✅ verified | ₹500 one-time setup + ₹1/₹2/₹5/₹1 rates identical on homepage, /pricing, /compare, /billing-policy, /refund-policy, /signup, /faq schema, llms.txt — `tools/check-copy-consistency.cjs` now guards it |
| Dedicated page per intent (POS / QR / WhatsApp / KDS / delivery / pricing) | ✅ already | /pos-billing /qr-ordering /whatsapp-ordering /kds /riders /pricing |
| Technical checklist (GSC, sitemap, robots, canonical, CWV, mobile, schema, 404s) | ✅ done in Phase 1 | — |
| Article 1 — POS buyer's guide | ➖ skip | /best-software + /pos-billing already own that intent (1 intent = 1 page) |
| Article 2 — QR table ordering | ➖ skip | /qr-ordering owns it |
| Article 3 — KDS vs paper KOT | ➖ skip | /kds carries a full "KOT vs KDS: what actually changes" comparison table |
| Article 4 — pizzeria page + "software for pizzerias" keyword | ⛔ rejected | conflicts with the 2026-10-18 owner directive (no pizza-specific keywords) |
| "0% commission" stat | ✅ fixed 2026-10-22 | homepage stat now names the plan the 1% option belongs to |
| Off-site authority (listings, reviews, links) | 🔧 kit ready | `docs/BACKLINK-KIT.md` — GBP / JustDial / IndiaMART copy, now de-pizzai'd and price-consistent |
| GSC access, custom domain, Rich Results test | ⏳ user | cannot be done from the repo |

### Added by this audit
- `tools/check-copy-consistency.cjs` — fails the build if a setup fee other than ₹500, the ambiguous
  "0% commission" stat, a pizza term, a stray phone/email in the canonical-fact files, or a page
  missing from `sitemap.xml` creeps back in. Run: `node tools/check-copy-consistency.cjs`.
- `website/llms.txt` — the 7 live pages missing from its index (inventory, whatsapp-ordering,
  whatsapp-marketing, table-management, customer-database, multi-outlet, restaurant-analytics) added.
- `docs/BACKLINK-KIT.md` — "pizzerias"/"Pizza, cake" replaced with "restaurants and cafes"/"Cafes,
  restaurants" so external listings say the same thing as the site.

### Second audit round (2026-10-22, same day)
- **WhatsApp absolute claim removed** — `/whatsapp-ordering` said "Official API, no ban risk" and
  "carries no ban risk from bulk sends". Now: "Official API, no false promises" + a FAQ answer that
  states Meta controls delivery, template approval and account standing, that promotional sending is
  switched off on an unofficial connection, and that no provider can guarantee a number is never
  restricted. Matches the homepage FAQ and `/whatsapp-policy`. The `FAQPage` answer was regenerated
  from the visible `<details>` copy (both now identical).
- **Competitor pricing is now dated** — `/compare`, `/best-software` and `/riders` state that other
  vendors' price ranges and the 20–30% aggregator commission are *indicative, checked October 2026*
  and must be confirmed with each vendor. No invented sources.
- **`llms.txt` WhatsApp bullet corrected** — it named Baileys for chat/ordering, contradicting the
  site's official-API wording. It now describes the real per-outlet model (WhatsApp Official plan =
  Meta Cloud API; a QR-paired connection still takes orders but promotional campaigns are
  hard-blocked on it).
- **robots.txt / sitemap.xml / llms.txt verified deployed** — the audit tool could not fetch them;
  all three return HTTP 200 live (`/llms.txt` is served at the root path).
- **Guard extended** — `tools/check-copy-consistency.cjs` now also fails on absolute WhatsApp
  ban-risk wording ("no ban risk", "ban-free") and on any `FAQPage` answer that is not verbatim in the
  page's visible copy (the class of drift that just cost one manual re-sync on `/index.html`).
- **Third round (same day)** — the guard gained the structural checks a manual audit would redo every
  time: exactly one `<h1>`, title 25–60 chars and unique, meta description 70–160 chars and unique,
  canonical + `og:title` + `og:image` present, every `<img>` has an `alt`, no orphan page. Meta
  descriptions on 13 pages were over Google's ~160-char cut (worst: `/compare` at 210) and were
  trimmed keyword-first; `/contact` now says "FoodHubbie ERP" like every other surface. `docs/OFFSITE-KIT.md`
  added and covered by the same guard.
- **Still user-only**: GSC URL Inspection for the 7 priority URLs, Rich Results Test, Bing import,
  GA4 enablement, custom domain, and executing the off-site kit.

## Phase 6 — Off-site authority (external plan §6) — kit ready, execution is owner-side

`docs/OFFSITE-KIT.md` holds the whole pack: canonical facts, per-platform copy for
Capterra / GetApp / G2 / SoftwareSuggest / Crunchbase / JustDial / IndiaMART / GBP, the feature
and platform-field lists, LinkedIn + X + Instagram + YouTube post copy with UTMs, the honest
review-request and case-study templates, and the execution order. Nothing is mass-submitted —
one accurate profile per platform, no bought links, no manufactured reviews.

Two rules baked into the copy: link the **feature page that matches the post** (not the homepage),
and never broadcast promotions to a linked unofficial WhatsApp number (the software blocks them,
and bulk sending on those connections is the fastest way to get a number restricted).

## Parked (explicitly skipped for now)
- GBP video verification — user does it manually; profile is live & complete (see PROJECT_LEDGER.md 2026-10-17 entry).
- Paid keyword tools — free methods only until traffic justifies them.


