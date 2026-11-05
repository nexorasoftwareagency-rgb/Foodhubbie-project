# SEO Execution Plan — www.foodhubbie.in

**Goal:** Move the marketing site from `foodhubbie-web.web.app` to `www.foodhubbie.in` with full on-page + technical + off-page SEO.

**Status:** Phase 0 (custom domain) is user-side only. Everything else is repo-ready.

> Builds on `docs/SEO-PLAN.md` (already done: technical plumbing, feature pages, schema, CWV, E-E-A-T skeleton, off-site kit). This file adds the **custom domain migration** — the one thing blocking `www.foodhubbie.in` from going live — plus a file-by-file change map and a verification script.

---

## 0. Prerequisite — buy + configure `foodhubbie.in` (user-only, cannot be done from repo)

| Step | Where | Detail |
|------|-------|--------|
| 0.1 | Domain registrar | Buy `foodhubbie.in` (~₹100–900/yr). Candidates already researched: `foodhubbie.com` / `foodhubbie.in` / `foodhubbie.co`. |
| 0.2 | Firebase Console → Hosting → `website` target (`foodhubbie-web`) | Add custom domain `www.foodhubbie.in`. Firebase auto-provisions SSL. |
| 0.3 | DNS registrar | Add the CNAME/A records Firebase gives you. Point `www.foodhubbie.in` → Firebase Hosting. |
| 0.4 | Firebase Console → Project settings | Enable Google Analytics (1 min). GA4 code is already in `website/shared/ga4.js` — it no-ops until Analytics is enabled. |
| 0.5 | Google Search Console | Add `https://foodhubbie.in/` as a new property (domain property preferred). Verify via DNS TXT. Submit `sitemap.xml`. |
| 0.6 | Bing Webmaster Tools | Import from GSC, submit same sitemap. |

**After 0.1–0.6 are live, run the repo-side migration below.**

---

## 1. Repo-side URL migration — `foodhubbie-web.web.app` → `www.foodhubbie.in`

Run one global replace across the repo (exclude `node_modules`, `.git`, images, videos, credentials):

```
find:  https://foodhubbie.in
replace: https://foodhubbie.in
```

Files affected (23 HTML + sitemap + llms.txt + docs):

| File | What changes |
|------|-------------|
| `website/index.html` | canonical, og:image, og:url, schema `@id`/`url` ×2, logo URL, WhatsApp "From:" params ×2 |
| `website/{22 other pages}.html` | canonical + og:image on each (architecture, book, compare, billing-policy, contact, customer-database, inventory, kds, multi-outlet, pos-billing, pricing, privacy, qr-ordering, refund-policy, restaurant-analytics, riders, signup, table-management, use-cases, whatsapp-marketing, whatsapp-ordering, whatsapp-policy, best-software) |
| `website/sitemap.xml` | all 23 `<loc>` URLs |
| `website/llms.txt` | all page URLs |
| `website/robots.txt` | Sitemap line |
| `docs/BACKLINK-KIT.md` | Website canonical fact |
| `docs/OFFSITE-KIT.md` | Website canonical fact + 4 UTM links |
| `docs/SEO-PLAN.md` | header title + references |
| `docs/PLAN-PROMOTE-SAAS.md` | site link |
| `docs/META-PLATFORM-AUDIT.md` | blocker note (resolved once domain live) |
| `ACCESS.md` | website row |

**Do not change:** `website/shared/ga4.js` (Firebase config stays `foodhubbie-10`, that's the project ID, not the domain), `firebase.json` (Firebase handles the custom domain mapping in console), any `wa.me/` WhatsApp links (those use phone number, not domain).

---

## 2. Complete SEO checklist (phases)

### Phase 0 — Custom domain (above) ⏳ blocked on user

### Phase 1 — Technical plumbing (already done in `docs/SEO-PLAN.md`, re-verify after domain flip)
- [ ] Canonical tags self-referencing on all 23 pages (point to `www.foodhubbie.in/…`)
- [ ] Sitemap submitted to GSC + Bing
- [ ] `robots.txt` allows all, sitemap declared
- [ ] GSC property verified for `www.foodhubbie.in`
- [ ] GA4 enabled in Firebase (beacons currently carry `id=undefined`)
- [ ] Custom 404.html live (already present)
- [ ] Clean URLs via `cleanUrls: true` in firebase.json website target (already set)
- [ ] HSTS + CSP headers already set in firebase.json
- [ ] One H1 per page, unique titles 25–60 chars, meta descriptions 70–160 chars (already audited; guard in `tools/check-copy-consistency.cjs`)

### Phase 2 — On-page content (already live)
- [ ] Target keyword: "restaurant and cafe management software" (pizza-specific terms removed per owner directive)
- [ ] Feature pages: `/qr-ordering`, `/pos-billing`, `/kds`, `/riders`, `/whatsapp-ordering`, `/table-management`, `/inventory`, `/customer-database`, `/multi-outlet`, `/restaurant-analytics`
- [ ] Money pages: `/pricing`, `/compare`, `/best-software`, `/use-cases`, `/architecture`
- [ ] Trust pages: `/privacy`, `/billing-policy`, `/refund-policy`, `/whatsapp-policy`
- [ ] FAQPage schema on all feature + money pages
- [ ] Organization + WebSite + SoftwareApplication schema on homepage
- [ ] BreadcrumbList schema on architecture.html
- [ ] `llms.txt` at root (AI crawler discovery)

### Phase 3 — E-E-A-T (blocked on real testimonial)
- [ ] Real founder bio on contact.html
- [ ] Real testimonial (current one hidden as unverifiable)
- [ ] Privacy policy page (already live)

### Phase 4 — Off-site authority (kit ready, owner-executed)
- [ ] Google Business Profile (live — refresh with `website/assets/shots/` photos)
- [ ] Capterra + GetApp + G2 listings (copy in `docs/OFFSITE-KIT.md`)
- [ ] LinkedIn + X + Instagram + YouTube posts (copy in `docs/OFFSITE-KIT.md`, link feature pages not homepage, add UTMs)
- [ ] SoftwareSuggest + Crunchbase + JustDial + IndiaMART
- [ ] Review requests to first 3 real customers
- [ ] `docs/BACKLINK-KIT.md` — one accurate profile per platform, no bought links

---

## 3. Verification script

I'll add a small repo tool that fails if any canonical / sitemap / llms URL still points at the old web.app domain after migration.

`tools/check-domain-migration.cjs`:

```js
// ponytail: one-file guard — run after the custom domain flip, before deploy
const fs = require('fs');
const path = require('path');

const OLD = 'https://foodhubbie.in';
const NEW = 'https://foodhubbie.in';
const ROOT = process.cwd();
const EXT = ['.html', '.xml', '.txt', '.md'];
const SKIP = ['node_modules', '.git', '.firebase', '.playwright-mcp', '.pw-profile'];

let hits = 0;
let files = 0;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(full); continue; }
    if (!EXT.includes(path.extname(entry.name))) continue;
    files++;
    const src = fs.readFileSync(full, 'utf8');
    const idx = src.indexOf(OLD);
    if (idx !== -1) {
      hits++;
      const line = src.slice(0, idx).split('\n').length;
      console.log(`  ${path.relative(ROOT, full)}:${line} — still references ${OLD}`);
    }
  }
}

walk(ROOT);
console.log(`\nScanned ${files} files. ${hits} still reference ${OLD}.`);
process.exit(hits === 0 ? 0 : 1);
```

Usage: `node tools/check-domain-migration.cjs` — exit 0 means clean, exit 1 lists stragglers.

Add to `package.json` scripts:
```json
"seo:check-domain": "node tools/check-domain-migration.cjs"
```

---

## 4. What I can do vs. what you must do

**I can do (repo side):**
- Create `tools/check-domain-migration.cjs` + wire it into `package.json`
- Perform the `foodhubbie-web.web.app` → `www.foodhubbie.in` search-replace across all 23 HTML + sitemap + llms.txt + docs (once you confirm the domain is live in Firebase)
- Bump `dateModified` in schema on pages that changed
- Re-verify `check-copy-consistency.cjs` still passes

**You must do (Firebase / registrar / console side):**
- Buy `foodhubbie.in`
- Add it as a custom domain on the `website` hosting target in Firebase Console
- Add DNS records at your registrar
- Enable Google Analytics in Firebase project settings
- Verify `www.foodhubbie.in` in Google Search Console + submit sitemap
- Import into Bing Webmaster Tools
- Execute off-site kit (GBP, directories, social) — needs your platform logins

---

## 5. Next step

Tell me when `www.foodhubbie.in` is configured in Firebase Hosting and I'll run the repo-side migration + verification script, then we flip canonicals and re-submit to GSC/Bing.


