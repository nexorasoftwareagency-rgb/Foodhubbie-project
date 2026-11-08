import { auth, db, ref, get } from '../firebase.js';
import { showToast } from '../ui-utils.js';
import { escapeHtml } from '../utils.js';
import { loadLucide } from '../ui.js';

const TEMPLATES = [
{
category: '🎉 New Customer Offers',
items: [
{
title: 'Welcome Offer',
body: 'Hey {name}! 🎉 So glad you\'re here! Enjoy {offer} on your very first order — just for you.\n\n📲 To grab this offer, just WhatsApp us "Hi" or "Menu" and start ordering!',
note: 'Replace {offer} with the actual discount (e.g. "20% off", "₹100 off")'
},
{
title: 'First Order Discount',
body: 'Hi {name}! 💛 Your first order with us = {discount}% OFF, no minimum needed!\n\n📲 To grab this offer, just WhatsApp us "Hi" or "Menu" and start ordering!',
note: 'Set {discount} to your desired percentage'
},
{
title: 'New Customer Bundle',
body: 'Welcome to the family, {name}! 🥳 Here\'s a sweet starter pack — {offer} on your first 3 orders. No strings, just yummy food!\n\n📲 To grab this offer, just WhatsApp us "Hi" or "Menu" and start ordering!',
note: 'Works well with a multi-use offer'
},
]
},
{
category: '🔥 Discounts & Sales',
items: [
{
title: 'Flat Discount',
body: 'Flash sale alert, {name}! 🚀 Get ₹{amount} OFF on orders above ₹{minOrder}. Quick, grab this before it\'s gone!\n\n📲 To grab this offer, just WhatsApp us "Hi" or "Menu" and start ordering!',
note: 'Set {amount} to the discount value and {minOrder} to the minimum order value'
},
{
title: 'Percentage Off',
body: '{name}, guess what? 🎈 You get {percent}% OFF on your entire order today! Don\'t wait — order now and save big!\n\n📲 To grab this offer, just WhatsApp us "Hi" or "Menu" and start ordering!',
note: 'Perfect for a percentage-type discount'
},
{
title: 'Buy One Get One',
body: 'B1G1 FREE, {name}! 🎉 Order any large pizza and get another large absolutely FREE. Yes, it\'s that simple — order now!\n\n📲 To order, just WhatsApp us "Hi" or "Menu"!',
note: 'Create a flat discount coupon equal to the price of one large pizza'
},
{
title: 'Clearance Sale',
body: 'Psst, {name}! 🏷️ Selected items are UP TO {percent}% OFF! Stock is flying — grab your favourites before they\'re gone!\n\n📲 To grab this offer, just WhatsApp us "Hi" or "Menu" and start ordering!',
note: 'Best when introducing new items and clearing old stock'
},
]
},
{
category: '📅 Weekend & Seasonal',
items: [
{
title: 'Weekend Special',
body: 'Weekend = treat time, {name}! 🎶 Enjoy {offer} this Saturday & Sunday only. Perfect for a cozy night in!\n\n📲 To grab this offer, just WhatsApp us "Hi" or "Menu" and start ordering!',
note: 'Activate the discount to run only on weekends'
},
{
title: 'Festival Offer',
body: 'Happy {festival}, {name}! 🎆✨ Celebrate with us — get {offer} on orders above ₹{minOrder}. Wishing you and your family a wonderful {festival}!\n\n📲 To grab this offer, just WhatsApp us "Hi" or "Menu" and start ordering!',
note: 'Replace {festival} with Diwali, Christmas, Eid, etc.'
},
{
title: 'Monsoon Special',
body: 'Rainy day = food day, {name}! ☔🍽️ Stay cozy at home with {offer} on your order. Free delivery on orders above ₹{minOrder}!\n\n📲 To grab this offer, just WhatsApp us "Hi" or "Menu" and start ordering!',
note: 'Perfect for monsoon months — send on rainy afternoons'
},
{
title: 'Summer Cooler',
body: 'Beat the heat, {name}! ☀️🥤 Grab any drink + get {percent}% OFF on your meal. Cool deal for a hot day!\n\n📲 To grab this offer, just WhatsApp us "Hi" or "Menu" and start ordering!',
note: 'Pair with beverage items for maximum impact'
},
]
},
{
category: '💛 Re-engagement & Win-back',
items: [
{
title: 'We Miss You',
body: 'We miss you, {name}! 💛 It\'s been too long. Come back and enjoy {offer} on your next order. Your favourites are waiting!\n\n📲 To grab this offer, just WhatsApp us "Hi" or "Menu" and start ordering!',
note: 'Target customers inactive for 30+ days'
},
{
title: 'Come Back Offer',
body: 'Hi {name}! 👋 We\'ve been saving a little something for you — {offer} on your next order. Can\'t wait to serve you again!\n\n📲 To grab this offer, just WhatsApp us "Hi" or "Menu" and start ordering!',
note: 'Use a higher-value offer for customers inactive 60+ days'
},
{
title: 'Last Order Reminder',
body: 'Hey {name}! ⏰ Your cart is still waiting! Complete your order now and get {offer}. Your food is ready for you!\n\n📲 To grab this offer, just WhatsApp us "Hi" or "Menu" and start ordering!',
note: 'Best sent within 24 hours of an abandoned cart'
},
]
},
{
category: '🤝 Referral & Loyalty',
items: [
{
title: 'Refer a Friend',
body: 'Share the love, {name}! 🤝 Refer a friend and you BOTH get {offer} on your next order. Go ahead, spread the yum!\n\n📲 To grab this offer, just WhatsApp us "Hi" or "Menu" and start ordering!',
note: 'Create a reusable offer for referrals'
},
{
title: 'Loyalty Bonus',
body: 'You\'re a rockstar, {name}! ⭐ Thank you for being such an amazing customer. Enjoy {offer} as a special loyalty thank-you. You deserve this!\n\n📲 To grab this offer, just WhatsApp us "Hi" or "Menu" and start ordering!',
note: 'Target customers with 5+ orders in the last 3 months'
},
{
title: 'VIP Appreciation',
body: 'Dear {name}, you\'re one of our most loved customers! 🌟 Here\'s an exclusive VIP treat — {offer} just for you. Valid for 7 days. You\'re the best!\n\n📲 To grab this offer, just WhatsApp us "Hi" or "Menu" and start ordering!',
note: 'Best for top 10% customers by order frequency or value'
},
]
},
{
category: '🆕 New Menu & Launches',
items: [
{
title: 'New Item Launch',
body: 'Something yummy is here, {name}! 🆕 Try our brand new {itemName} — {description}. Order now and get {offer}! Be the first to taste it!\n\n📲 To grab this offer, just WhatsApp us "Hi" or "Menu" and start ordering!',
note: 'Replace {itemName} and {description} with details about the new item'
},
{
title: 'Seasonal Menu',
body: 'Introducing our {season} special menu, {name}! 🍂✨ Fresh flavours, same great taste. Enjoy {offer} on any item from the {season} collection. Yum!\n\n📲 To grab this offer, just WhatsApp us "Hi" or "Menu" and start ordering!',
note: 'Update {season} to Spring, Summer, Monsoon, Autumn, or Winter'
},
{
title: 'Chef\'s Special',
body: 'Our chef made something JUST for you, {name}! 👨‍🍳✨ Try the new {itemName} — {description}. Get {offer}! Chef says you\'ll love it!\n\n📲 To grab this offer, just WhatsApp us "Hi" or "Menu" and start ordering!',
note: 'Chef recommendations feel exclusive and personal'
},
]
},
{
category: '🎉 Birthday & Special Days',
items: [
{
title: 'Birthday Offer',
body: 'HAPPY BIRTHDAY, {name}! 🎉🎈 Treat yourself to {offer} on us! Valid for 3 days. Have the most amazing day! Love, the whole {storeName} team 💛\n\n📲 To grab this offer, just WhatsApp us "Hi" or "Menu" and start ordering!',
note: 'Send on the customer\'s birthday morning for best results'
},
{
title: 'Anniversary Offer',
body: 'Happy Anniversary, {name}! 🎊💛 Thank you for being with us. Celebrate with {offer} on your order. Here\'s to many more delicious moments together!\n\n📲 To grab this offer, just WhatsApp us "Hi" or "Menu" and start ordering!',
note: 'Use the customer\'s first order date as their anniversary'
},
]
},
{
category: '⚡ Urgent & Flash Deals',
items: [
{
title: 'Flash Sale',
body: '⚡ FLASH SALE ⚡ {name}, get {offer} for the next {hours} hours ONLY! Hurry — this won\'t last long!\n\n📲 To grab this offer, just WhatsApp us "Hi" or "Menu" and start ordering!',
note: 'Use with a short-lived discount for urgency'
},
{
title: 'Slow Hour Boost',
body: 'Hey {name}! 🕐 Afternoon slump? Get {offer} on your delivery right now. Beat the dinner rush and enjoy a quiet meal!\n\n📲 To grab this offer, just WhatsApp us "Hi" or "Menu" and start ordering!',
note: 'Send during slow hours (2-5 PM) to boost afternoon orders'
},
{
title: 'Last Minute Deal',
body: 'Tonight only, {name}! 🌙✨ Get {offer} on orders placed in the next {hours} hours. Dinner just got WAY more delicious!\n\n📲 To grab this offer, just WhatsApp us "Hi" or "Menu" and start ordering!',
note: 'Send in the evening (6-8 PM) for dinner rush boost'
},
]
},
  {
    category: '🎉 New Customer Offers',
    items: [
      {
        title: 'Welcome Offer',
        body: 'Hey {name}! 🎉 So glad you\'re here! Enjoy {offer} on your very first order — just for you.\n\n📲 To grab this offer, just WhatsApp us "Hi" or "Menu" and start ordering!',
        note: 'Replace {offer} with the actual discount (e.g. "20% off", "₹100 off")'
      },
      {
        title: 'First Order Discount',
        body: 'Hi {name}! 💛 Your first order with us = {discount}% OFF, no minimum needed!\n\n📲 To grab this offer, just WhatsApp us "Hi" or "Menu" and start ordering!',
        note: 'Set {discount} to your desired percentage'
      },
      {
        title: 'New Customer Bundle',
        body: 'Welcome to the family, {name}! 🥳 Here\'s a sweet starter pack — {offer} on your first 3 orders. No strings, just yummy food!\n\n📲 To grab this offer, just WhatsApp us "Hi" or "Menu" and start ordering!',
        note: 'Works well with a multi-use offer'
      },
    ]
  },
  {
    category: '🔥 Discounts & Sales',
    items: [
      {
        title: 'Flat Discount',
        body: 'Flash sale alert, {name}! 🚀 Get ₹{amount} OFF on orders above ₹{minOrder}. Quick, grab this before it\'s gone!\n\n📲 To grab this offer, just WhatsApp us "Hi" or "Menu" and start ordering!',
        note: 'Set {amount} to the discount value and {minOrder} to the minimum order value'
      },
      {
        title: 'Percentage Off',
        body: '{name}, guess what? 🎈 You get {percent}% OFF on your entire order today! Don\'t wait — order now and save big!\n\n📲 To grab this offer, just WhatsApp us "Hi" or "Menu" and start ordering!',
        note: 'Perfect for a percentage-type discount'
      },
      {
        title: 'Buy One Get One',
        body: 'B1G1 FREE, {name}! 🎉 Order any large pizza and get another large absolutely FREE. Yes, it\'s that simple — order now!\n\n📲 To order, just WhatsApp us "Hi" or "Menu"!',
        note: 'Create a flat discount coupon equal to the price of one large pizza'
      },
      {
        title: 'Clearance Sale',
        body: 'Psst, {name}! 🏷️ Selected items are UP TO {percent}% OFF! Stock is flying — grab your favourites before they\'re gone!\n\n📲 To grab this offer, just WhatsApp us "Hi" or "Menu" and start ordering!',
        note: 'Best when introducing new items and clearing old stock'
      },
    ]
  },
  {
    category: '📅 Weekend & Seasonal',
    items: [
      {
        title: 'Weekend Special',
        body: 'Weekend = treat time, {name}! 🎶 Enjoy {offer} this Saturday & Sunday only. Perfect for a cozy night in!\n\n📲 To grab this offer, just WhatsApp us "Hi" or "Menu" and start ordering!',
        note: 'Activate the discount to run only on weekends'
      },
      {
        title: 'Festival Offer',
        body: 'Happy {festival}, {name}! 🎆✨ Celebrate with us — get {offer} on orders above ₹{minOrder}. Wishing you and your family a wonderful {festival}!\n\n📲 To grab this offer, just WhatsApp us "Hi" or "Menu" and start ordering!',
        note: 'Replace {festival} with Diwali, Christmas, Eid, etc.'
      },
      {
        title: 'Monsoon Special',
        body: 'Rainy day = food day, {name}! ☔🍽️ Stay cozy at home with {offer} on your order. Free delivery on orders above ₹{minOrder}!\n\n📲 To grab this offer, just WhatsApp us "Hi" or "Menu" and start ordering!',
        note: 'Perfect for monsoon months — send on rainy afternoons'
      },
      {
        title: 'Summer Cooler',
        body: 'Beat the heat, {name}! ☀️🥤 Grab any drink + get {percent}% OFF on your meal. Cool deal for a hot day!\n\n📲 To grab this offer, just WhatsApp us "Hi" or "Menu" and start ordering!',
        note: 'Pair with beverage items for maximum impact'
      },
    ]
  },
  {
    category: '💛 Re-engagement & Win-back',
    items: [
      {
        title: 'We Miss You',
        body: 'We miss you, {name}! 💛 It\'s been too long. Come back and enjoy {offer} on your next order. Your favourites are waiting!\n\n📲 To grab this offer, just WhatsApp us "Hi" or "Menu" and start ordering!',
        note: 'Target customers inactive for 30+ days'
      },
      {
        title: 'Come Back Offer',
        body: 'Hi {name}! 👋 We\'ve been saving a little something for you — {offer} on your next order. Can\'t wait to serve you again!\n\n📲 To grab this offer, just WhatsApp us "Hi" or "Menu" and start ordering!',
        note: 'Use a higher-value offer for customers inactive 60+ days'
      },
      {
        title: 'Last Order Reminder',
        body: 'Hey {name}! ⏰ Your cart is still waiting! Complete your order now and get {offer}. Your food is ready for you!\n\n📲 To grab this offer, just WhatsApp us "Hi" or "Menu" and start ordering!',
        note: 'Best sent within 24 hours of an abandoned cart'
      },
    ]
  },
  {
    category: '🤝 Referral & Loyalty',
    items: [
      {
        title: 'Refer a Friend',
        body: 'Share the love, {name}! 🤝 Refer a friend and you BOTH get {offer} on your next order. Go ahead, spread the yum!\n\n📲 To grab this offer, just WhatsApp us "Hi" or "Menu" and start ordering!',
        note: 'Create a reusable offer for referrals'
      },
      {
        title: 'Loyalty Bonus',
        body: 'You\'re a rockstar, {name}! ⭐ Thank you for being such an amazing customer. Enjoy {offer} as a special loyalty thank-you. You deserve this!\n\n📲 To grab this offer, just WhatsApp us "Hi" or "Menu" and start ordering!',
        note: 'Target customers with 5+ orders in the last 3 months'
      },
      {
        title: 'VIP Appreciation',
        body: 'Dear {name}, you\'re one of our most loved customers! 🌟 Here\'s an exclusive VIP treat — {offer} just for you. Valid for 7 days. You\'re the best!\n\n📲 To grab this offer, just WhatsApp us "Hi" or "Menu" and start ordering!',
        note: 'Best for top 10% customers by order frequency or value'
      },
    ]
  },
  {
    category: '🆕 New Menu & Launches',
    items: [
      {
        title: 'New Item Launch',
        body: 'Something yummy is here, {name}! 🆕 Try our brand new {itemName} — {description}. Order now and get {offer}! Be the first to taste it!\n\n📲 To grab this offer, just WhatsApp us "Hi" or "Menu" and start ordering!',
        note: 'Replace {itemName} and {description} with details about the new item'
      },
      {
        title: 'Seasonal Menu',
        body: 'Introducing our {season} special menu, {name}! 🍂✨ Fresh flavours, same great taste. Enjoy {offer} on any item from the {season} collection. Yum!\n\n📲 To grab this offer, just WhatsApp us "Hi" or "Menu" and start ordering!',
        note: 'Update {season} to Spring, Summer, Monsoon, Autumn, or Winter'
      },
      {
        title: 'Chef\'s Special',
        body: 'Our chef made something JUST for you, {name}! 👨‍🍳✨ Try the new {itemName} — {description}. Get {offer}! Chef says you\'ll love it!\n\n📲 To grab this offer, just WhatsApp us "Hi" or "Menu" and start ordering!',
        note: 'Chef recommendations feel exclusive and personal'
      },
    ]
  },
  {
    category: '🎉 Birthday & Special Days',
    items: [
      {
        title: 'Birthday Offer',
        body: 'HAPPY BIRTHDAY, {name}! 🎉🎈 Treat yourself to {offer} on us! Valid for 3 days. Have the most amazing day! Love, the whole {storeName} team 💛\n\n📲 To grab this offer, just WhatsApp us "Hi" or "Menu" and start ordering!',
        note: 'Send on the customer\'s birthday morning for best results'
      },
      {
        title: 'Anniversary Offer',
        body: 'Happy Anniversary, {name}! 🎊💛 Thank you for being with us. Celebrate with {offer} on your order. Here\'s to many more delicious moments together!\n\n📲 To grab this offer, just WhatsApp us "Hi" or "Menu" and start ordering!',
        note: 'Use the customer\'s first order date as their anniversary'
      },
    ]
  },
];

export async function renderTemplatePicker(container) {
if (!container) return;
container.innerHTML = `
<div style="max-height:60vh; overflow-y:auto; padding-right:4px;">
${TEMPLATES.map(group => `
<div class="mb-16">
<h4 class="template-category-title">${escapeHtml(group.category)}</h4>
<div class="template-grid">
${group.items.map(t => `
<div class="template-card" data-template="${escapeHtml(t.body)}" data-title="${escapeHtml(t.title)}">
<div class="template-card-header">
<span class="template-card-title">${escapeHtml(t.title)}</span>
<button class="btn-primary btn-small template-use-btn">Use</button>
</div>
<p class="template-card-body">${escapeHtml(truncate(t.body, 120))}</p>
${t.note ? `<p class="template-card-note">💡 ${escapeHtml(t.note)}</p>` : ''}
</div>
`).join('')}
</div>
</div>
`).join('')}
</div>
`;
await loadLucide();
    if (window.lucide) window.lucide.createIcons({ root: container });

container.querySelectorAll('.template-use-btn').forEach(btn => {
btn.addEventListener('click', () => {
const card = btn.closest('.template-card');
const body = card?.dataset.template;
if (!body) return;
const ta = document.getElementById('promoTemplate');
if (ta) { ta.value = body; ta.dispatchEvent(new Event('input', { bubbles: true })); }
const modal = document.getElementById('promoTemplatePickerModal');
if (modal) modal.classList.remove('active');
showToast('Template loaded — customize before launching', 'success');
});
});
}

async function _notifyBase() {
  if (window.TUNNEL_URL) return window.TUNNEL_URL;
  try {
    const snap = await get(ref(db, 'config/tunnelUrl'));
    const url = snap.val();
    if (url) window.TUNNEL_URL = url;
  } catch { /* fall through → hosting origin 404 with honest error */ }
  return window.TUNNEL_URL || '';
}

async function _getAdminAuthToken() {
  return auth.currentUser ? auth.currentUser.getIdToken() : Promise.resolve(null);
}

// Friendly labels for the platform's own approved shells, so the composer reads
// "Flash Sale — Order Now button" instead of "promo_cta_flash (MARKETING)".
// Templates not listed here still render as "<name> (<category>)".
const WA_TEMPLATE_LABELS = {
  proactive_promo: 'Special Offer — English',
  promo_hinglish_offer: 'Khaas Offer — Hinglish',
  promo_hinglish_discount: 'Sirf Aapke Liye — Hinglish',
  promo_hinglish_festive: 'Tyohaar Special — Hinglish',
  promo_hinglish_winback: 'Miss You — Hinglish',
  promo_cta_flash: '⚡ Flash Sale — Order Now button',
  promo_cta_cart: '🛒 Abandoned Cart — Order Now button',
  promo_cta_winback: '💚 Win-back — Order Now button',
  promo_cta_birthday: '🎂 Birthday — Order Now button',
  promo_cta_weekend: '🎉 Weekend Special — Order Now button',
  promo_cta_newitem: '🆕 New Item — Order Now button',
};

/** Load approved WhatsApp templates from Meta's WABA and populate the
 *  promoWaTemplate select. ONLY templates Meta has APPROVED for this outlet are
 *  offered: an unapproved (or absent) name can never be delivered, so it must
 *  never be selectable. The hardcoded <option>s in index.html are only the
 *  pre-fetch / API-unreachable fallback and are replaced the moment Meta
 *  answers. */
export async function loadApprovedWaTemplates(bid, oid) {
  const select = document.getElementById('promoWaTemplate');
  if (!select) return;

  // Preserve the current selection across the rebuild.
  const current = select.value;

  try {
    const token = await _getAdminAuthToken();
    if (!token) {
      showToast('Not authenticated — templates unavailable', 'warning');
      return;
    }
    const base = await _notifyBase();
    if (!base) {
      showToast('Meta API endpoint not configured — using fallback templates', 'warning');
      return;
    }
    const url = `${base}/api/whatsapp/templates/${bid}/${oid}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 501) {
      showToast('Meta API endpoint not configured — using fallback templates', 'warning');
      return;
    }
    if (!res.ok) throw new Error(`Meta API failed ${res.status}`);
    const { wabaId, templates } = await res.json();
    // A promotional campaign must use a MARKETING template (Meta classifies and
    // bills by category) with at most ONE body variable — the bot fills {{1}}
    // with the offer text, so a 2-variable shell would fail at send. The Bot
    // Control API returns status/category lowercase; compare case-insensitively
    // anyway so a stale server can never silently empty this list again.
    const bodyVarCount = (t) => {
      const body = (t.components || []).find((c) => String(c.type).toUpperCase() === 'BODY');
      return new Set(String(body?.text || '').match(/\{\{\d+\}\}/g) || []).size;
    };
    const approved = (templates || []).filter((t) =>
      String(t.status).toLowerCase() === 'approved'
      && String(t.category).toLowerCase() === 'marketing'
      && bodyVarCount(t) <= 1);
    // Replace the seed list outright — nothing unapproved may stay selectable.
    select.innerHTML = '';
    if (approved.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No approved marketing template on this WABA';
      opt.disabled = true;
      select.appendChild(opt);
      showToast('No approved marketing template on this outlet WABA — campaigns fall back to plain text', 'warning');
      return;
    }
    // Stable order: the generic English shell first (the sane default for a new
    // campaign), then alphabetical.
    approved.sort((a, b) => (a.name === 'proactive_promo' ? -1 : b.name === 'proactive_promo' ? 1 : a.name.localeCompare(b.name)));
    approved.forEach((t) => {
      const opt = document.createElement('option');
      opt.value = t.name;
      opt.textContent = WA_TEMPLATE_LABELS[t.name] || `${t.name} (${String(t.category).toUpperCase()})`;
      select.appendChild(opt);
    });
    // Keep the previous choice only if Meta still approves it; never fall back
    // to a hardcoded name that may not exist on this WABA.
    select.value = (current && approved.some((t) => t.name === current)) ? current : approved[0].name;
    showToast(`Loaded ${approved.length} approved WhatsApp templates`, 'success');
  } catch (err) {
    // The hardcoded seed list stays as the offline fallback — but say so.
    console.error('Failed to load approved WhatsApp templates:', err);
    showToast('Could not load approved templates from Meta — showing default shells', 'warning');
  }
}

function truncate(s, max) {
if (s.length <= max) return s;
return s.substring(0, max).replace(/\s+\S*$/, '') + '…';
}


