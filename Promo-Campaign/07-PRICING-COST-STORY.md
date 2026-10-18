# Pricing + cost story — pitch lines, not price sheets

Facts from PRICING_AND_TERMS.md, Research/PER-RESTAURANT-COST.md, WHATSAPP-BOT-COST.md.

## The lines to say on camera
- "No per-order commission. Base is ₹1 a placed order — or ₹750 a month flat. Break-even at 750 orders."
- "Premium ₹1,250 a month: rider app, campaigns, advanced analytics included. Meta messages passed through at cost."
- "Shift one Swiggy order a day to direct WhatsApp and the month pays for itself — you keep the ~30% commission."
- "Quiet restaurant costs us $0 in infra; a busy one a few dollars — your data lives in your Firebase, you own it."
- "Promo messages cost ₹1 token each with a pre-flight balance check — no surprise bills, ever."

## Numbers to keep honest
- Meta India Sep-2026: Utility/Auth/Service ~₹0.115/msg, Marketing ₹0.86/msg; Oct-2026 in-window service billed, first 1,000 service msgs/number free.
- Bot runs on EC2 (t3.small ~$15) or Firebase-only with no bot; Baileys transport = ₹0 Meta but promos stay blocked there by design.
- Landing placeholders ([X]+ orders, [X]% fewer missed) are UNPROVEN — do not quote until a case study exists. Planned direction only: +40% orders via QR, −90% errors via KDS.
