/**
 * Customer APP | what is LIVE and what is only SAVED.
 *
 * Every control in the Customer APP tab is listed here with one honest flag:
 *   live: true  -> the customer app / bot really reads this value today
 *   live: false -> it is saved to the database, but the customer app does not use it yet
 *
 * `reads` names a file + a text marker that proves a live control is read. The test
 * tests/customer-app-status.check.mjs searches the real customer-app source for that
 * marker, so if someone later wires a control into the app (or removes the code that
 * reads it) the test fails and says which label to flip. Labels cannot silently lie.
 */
export const APP_CONTROLS = {
    storeName:        { label: 'Store name',            live: true,  note: 'Shown in the app header.',                                   reads: ['menu/js/app.js', 'storeName'] },
    whatsappNumber:   { label: 'WhatsApp number',       live: true,  note: 'Used by the "Chat on WhatsApp" card.',                       reads: ['menu/js/ui.js', 's.whatsappNumber'] },
    googleReviewLink: { label: 'Google review link',    live: true,  note: 'Opens from the "Rate us" card.',                             reads: ['menu/js/ui.js', 's.googleReviewLink'] },
    facebookPage:    { label: 'Facebook page',          live: true,  note: 'Shown as a "Like us on Facebook" card.',                         reads: ['menu/js/ui.js', 's.facebook'] },
    instagramPage:   { label: 'Instagram page',         live: true,  note: 'Shown as a "Follow on Instagram" card.',                        reads: ['menu/js/ui.js', 's.instagram'] },
    promoPage:        { label: 'Coupons on Promo Page', live: true,  note: 'Only coupons marked "Show on Promo Page" appear.',           reads: ['menu/js/customer.js', 'offer.promoPage === true'] },
    pushNotes:        { label: 'Push notifications',    live: true,  note: 'Sent through the notification service.',                     reads: null },
    dishStock:        { label: 'Out-of-stock dishes',   live: true,  note: 'Dishes marked out of stock in Menu are hidden from customers.', reads: ['menu/js/app.js', 'd.stock !== false'] },

    address:          { label: 'Store address',         live: false, note: 'Saved, but the app does not show it yet.' },
    phone:            { label: 'Contact phone',         live: false, note: 'Saved, but the app does not show it yet.' },
    appWelcomeMessage:{ label: 'Welcome message',       live: false, note: 'Saved, but the app does not show it yet.' },
    dishVisible:      { label: 'Hide / show dishes',    live: false, note: 'The app ignores this switch. To hide a dish today, mark it Out of stock in Menu.' },
    categoryVisible:  { label: 'Hide / show categories',live: false, note: 'The app ignores this switch for now.' },
    featured:         { label: 'Featured dishes',       live: false, note: 'Saved, but the app does not highlight them yet.' },
    appFeatures:      { label: 'App feature switches',  live: false, note: 'Saved, but the app does not turn features on or off from here yet.' },
    orderTypes:       { label: 'Dine-in / Delivery / Pickup switches', live: false, note: 'Saved, but ordering in the app is not limited by them yet.' },
    loyaltyEnabled:   { label: 'Loyalty switch',        live: false, note: 'Saved, but the app does not read it. Loyalty is managed in the Loyalty tab.' },
    deliveryFee:      { label: 'Delivery fee',          live: false, note: 'Not used for pricing. The app charges delivery by distance slabs set in Delivery settings.' },
    minOrder:         { label: 'Minimum order',         live: false, note: 'Not enforced by the app yet.' },
    gstRate:          { label: 'GST rate',              live: false, note: 'Not used for pricing. Tax comes from your Tax settings.' },
    taxOnDeliveryFee: { label: 'GST on delivery fee',   live: false, note: 'Not used for pricing. Tax comes from your Tax settings.' },
    businessHours:    { label: 'Business hours',        live: false, note: 'Saved, but the app does not show "closed now" yet.' },
    timezone:         { label: 'Timezone',              live: false, note: 'Saved, but the app does not read it.' },
    themeColor:       { label: 'Theme colour',          live: false, note: 'The customer app keeps its own colours. This colour is used on your printable QR card.' },
    logoUrl:          { label: 'Logo URL',              live: false, note: 'Saved, but the app does not show it yet.' },
};

/** Small pill markup used next to a control. */
export function liveBadge(key) {
    const c = APP_CONTROLS[key];
    if (!c) return '';
    return c.live
        ? `<span class="ca-live" title="${c.note}">Live in app</span>`
        : `<span class="ca-saved" title="${c.note}">Saved, not applied yet</span>`;
}

export const notAppliedList = () => Object.entries(APP_CONTROLS).filter(([, c]) => !c.live).map(([k, c]) => ({ key: k, ...c }));
export const liveList = () => Object.entries(APP_CONTROLS).filter(([, c]) => c.live).map(([k, c]) => ({ key: k, ...c }));
