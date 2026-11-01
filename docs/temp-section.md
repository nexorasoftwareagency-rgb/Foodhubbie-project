## §1 — Greeting / Welcome (User Clarification 2026-11-01 — text + language, NOT button, NOT Marketing)

Clarification (updated): The user wants the original greeting text/language preserved — "Namaste {{1}} ji! 👋 ✨ {{2}} mein aapka swagat hai! 🍕 Mazedar khana, fatafat aapke darwaze tak! 🚀" — with variables {{1}} (store name) and {{2}} (welcome phrase), submitted as UTILITY, not Marketing. No button, no promo language.

Previous greeting_welcome (MARKETING, 2 vars) stays unwired; do not send as marketing. Submit new greeting_welcome_utility (UTILITY, en) with same body text.

Draft (new submission — do NOT edit old greeting_welcome; submit fresh greeting_welcome_utility):

```
Template name: greeting_welcome_utility (UTILITY, en)
Category: UTILITY (pure welcome / transactional — zero promo language)
Variables: {{1}} = restaurant/store name, {{2}} = welcome phrase (e.g. "Roshani Pizza")
Body (verbatim, original text — confirmed safe):
  "Namaste *{{1}}* ji! 👋
  ════════════════════════
  ✨ *{{2}} mein aapka swagat hai!* 🍕
  ════════════════════════
  Mazedar khana, fatafat aapke darwaze tak! 🚀"
```

Why this is NOT Marketing (defense if Meta reviews):
- Contains: greeting, welcome, store identity — all transactional / relationship.
- Contains zero: discount codes, limited-time words, "offer", "sale", "win", "free", urgency, promotional imagery.
- Contains only: food emoji (🍕), decorative line (════════), and welcome phrase.
- Per docs/BILLING-MODEL.md: service/utility message, charged at ₹0.1357 delivered + 18% GST.
- The {{2}} variable lets the admin customize the welcome phrase per restaurant without changing category.
- If Meta rejects as marketing, fix is remove decorative lines (not the language) — text itself is non-promotional by design.

Cost: ₹0.1357 / delivered greeting (utility). Per session, not per message. Inside 24h window: if customer initiates, reply is service (free first 1,000/mo); if bot initiates greeting outside window = utility (charged). With ES v4, greeting is sent inside the session window (customer just started chat), so it falls under service/free tier when possible — but template stays UTILITY-classified regardless.

Integration (Foodhubbie): bot/index.js sends greeting via sendOrderFlow(..., withMenu=false) — uses image + welcome text currently (plainWelcome removed per 2026-10-18). When greeting_welcome_utility approved, swap to sendTemplate with {{1}} = storeName, {{2}} = welcomePhrase from DB (businesses/{bid}/outlets/{oid}/settings/storeName or default from catalog). No button needed unless the restaurant opts into greeting_order_link later.

Action: Submit new greeting_welcome_utility UTILITY template via Meta Business Suite / App Dashboard -> Templates -> Create. Old greeting_welcome (MARKETING) stays unwired; do not reuse.

