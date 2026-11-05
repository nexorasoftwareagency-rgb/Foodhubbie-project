/**
 * FoodHubbie ERP | CUSTOMER APP LINK (pure - no imports)
 *
 * The customer app IS the menu hosting site, scoped per outlet by ?b=/?o=
 * (dynamic-manifest.js bakes the same pair into start_url, so an install
 * from this link always reopens THIS restaurant).
 *
 * Keep the host in ONE place. Admin Settings and Supreme both build the
 * customer-facing link from here, so a host change can never leave the two
 * dashboards handing out different URLs.
 *
 * Runnable self-check: node shared/app-link.js
 */

export const APP_HOST = 'https://foodhubbie-qrmenu.web.app';

/**
 * @param {string} bid business id
 * @param {string} oid outlet id
 * @returns {string} absolute customer-app link, or '' when either id is missing
 */
export function appLink(bid, oid) {
    const b = String(bid || '').trim();
    const o = String(oid || '').trim();
    if (!b || !o) return '';
    return `${APP_HOST}/?b=${encodeURIComponent(b)}&o=${encodeURIComponent(o)}`;
}

if (typeof process !== 'undefined' && process.argv?.[1]?.includes('app-link')) {
    import('node:assert').then(({ default: assert }) => {
        assert.strictEqual(appLink('roshani-pizza', 'pizza'), 'https://foodhubbie-qrmenu.web.app/?b=roshani-pizza&o=pizza');
        assert.strictEqual(appLink('a b', 'c&d'), 'https://foodhubbie-qrmenu.web.app/?b=a%20b&o=c%26d', 'ids are URL-encoded');
        assert.strictEqual(appLink('', 'pizza'), '', 'missing business id -> no link');
        assert.strictEqual(appLink('roshani-pizza', ''), '', 'missing outlet id -> no link');
        assert.strictEqual(appLink('  roshani-pizza  ', '  pizza  '), 'https://foodhubbie-qrmenu.web.app/?b=roshani-pizza&o=pizza', 'ids trimmed');
        assert.ok(!APP_HOST.endsWith('/'), 'host carries no trailing slash');
        console.log('app-link OK');
    }).catch(e => { console.error(e); process.exit(1); });
}
