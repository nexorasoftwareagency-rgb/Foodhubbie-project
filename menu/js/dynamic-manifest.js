/**
 * menu/js/dynamic-manifest.js
 *
 * Replaces the static manifest.json link with one generated per-outlet at
 * load time. Every restaurant shares this one codebase/origin, so a static
 * manifest.json means every installed icon has the same start_url/id -
 * the browser would treat installs from different restaurants as "the
 * same app", and an installed icon has no reliable way to remember which
 * restaurant it belongs to once relaunched (start_url carries no outlet
 * info). This fixes both problems at once:
 *
 *   - name/short_name/icons/theme_color stay constant "FoodHubbie"
 *     branding on every install, matching the confirmed design: outer
 *     branding is FoodHubbie, inner content is the specific restaurant.
 *   - id/start_url are unique per outlet (?o=/?b= baked in), so each
 *     install is a genuinely separate, correctly-scoped app, and reopening
 *     an installed icon always returns to the right restaurant.
 *
 * Icons are real files under menu/icons/ referenced by ABSOLUTE url, not
 * relative paths: the manifest is a blob: URL, which has no usable base
 * path. They used to be inlined as ~320 KB of base64 in this file, which
 * every app boot had to download; the files are cached by the browser and
 * only fetched when the icon is actually needed.
 *
 * Runs as a plain synchronous script (not a module) so it executes
 * immediately in document order, right after the static manifest <link> -
 * by the time it runs, that <link> is already in the DOM to update.
 *
 * Firebase Hosting CSP for this site already includes
 * "manifest-src 'self' blob:" and "img-src ... data: ...", so this
 * approach works without any CSP changes.
 *
 * Caveat, not yet verified on-device: iOS Safari's handling of a
 * Blob-based manifest during "Add to Home Screen" is less predictable
 * than Chromium's. Works correctly in code; needs a real iOS device test.
 */
(function () {
    var qs = new URLSearchParams(window.location.search);
    var o = qs.get('o');
    var b = qs.get('b');

    // No outlet in the URL at all (e.g. a bare bookmark with no history of
    // ever loading this fix) - nothing reliable to scope the manifest to,
    // so leave the static manifest.json in place rather than guess.
    if (!o) return;

    var params = 'o=' + encodeURIComponent(o) + (b ? '&b=' + encodeURIComponent(b) : '');
    // NOTE: never add the session token (?t=) here. The installed icon
    // represents the customer's ongoing relationship with this restaurant,
    // not one specific table visit - session establishment still runs
    // fresh every time the app opens, exactly as it does today.
    //
    // These MUST be absolute. The manifest is served from a blob: URL, and a
    // blob has no usable base path, so a relative "./index.html" resolves to
    // nothing - Chrome drops it ("property 'start_url' ignored, URL is
    // invalid") and the install loses its per-outlet start_url and scope.
    // Build them against the real path of the current outlet instead.
    var outletBase = window.location.pathname.replace(/[^/]*$/, '') || '/';
    var scopedUrl = new URL('index.html?' + params, window.location.origin + outletBase).href;
    var scopeUrl = new URL(outletBase, window.location.origin).href;

    var manifest = {
        name: 'FoodHubbie',
        short_name: 'FoodHubbie',
        id: scopedUrl,
        description: 'Order food online',
        start_url: scopedUrl,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#ffffff',
        theme_color: '#E84908',
        scope: scopeUrl,
        dir: 'ltr',
        lang: 'en-US',
        icons: [
            {
                src: window.location.origin + '/icons/icon-192.png',
                sizes: '192x192',
                type: 'image/png',
                purpose: 'any'
            },
            {
                src: window.location.origin + '/icons/icon-512.png',
                sizes: '512x512',
                type: 'image/png',
                purpose: 'any maskable'
            }
        ]
    };

    var blob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var link = document.querySelector('link[rel="manifest"]');
    if (link) link.setAttribute('href', url);
})();