/**
 * Quota & Analytics templates
 */

import { escapeHtml } from '/js/utils.js';

// Same cache-per-outlet pattern as wa-templates.js. The profile page rebuilds
// #profile-content on every live tick (~30s), which used to blank this card to
// "Checking quota…" until the fetch resolved. The rendered HTML is cached so a
// rebuild can re-inject it, and refreshed after a minute so the send counter
// does not freeze while the page stays open.
export let quotaHtml = null;
let quotaFetchedFor = null;
let quotaFetchedAt = 0;
const QUOTA_REFRESH_MS = 60 * 1000;

/** Drop the cache when navigating to another outlet. */
export function resetQuotaCache() {
  quotaFetchedFor = null;
  quotaHtml = null;
  quotaFetchedAt = 0;
}

export async function loadQuota(bid, oid) {
  let el = document.getElementById('quota-content');
  if (!el) return;
  const key = `${bid}/${oid}`;
  if (quotaFetchedFor === key && quotaHtml && Date.now() - quotaFetchedAt < QUOTA_REFRESH_MS) {
    el.innerHTML = quotaHtml;
    return;
  }
  // Claim the outlet before the await so a re-render tick re-injects this
  // outlet's cached card. A failed first fetch leaves quotaHtml null, so the
  // next tick retries.
  quotaFetchedFor = key;
  try {
    const token = await firebase.auth().currentUser.getIdToken();
    // This loads during first render — wait for the tunnel URL bootstrap,
    // otherwise the fetch goes to the stale fallback host.
    if (window.TUNNEL_READY) await window.TUNNEL_READY;
    const res = await fetch(`${window.TUNNEL_URL}/api/whatsapp/quota/${bid}/${oid}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`${res.status}`);
    const payload = await res.json();
    // Server answers `{ quota: {...} }`; older builds answered flat
    // `{ tier, used, limit }`. Accept both so a stale API cannot blank the card.
    const q = payload.quota || payload || {};
    const used = Number(q.used) || 0;
    const limit = Number(q.limit);

    // Navigated to another outlet while this was in flight — drop the stale
    // response instead of painting outlet A's numbers onto outlet B's card.
    if (quotaFetchedFor !== key) return;
    // A live tick may have rebuilt #profile-content during the await; paint the
    // element that is actually on screen, not the detached one.
    el = document.getElementById('quota-content');
    if (!el) return;

    // A Graph failure is a soft state, not an error: an outlet can still hold a
    // test/removed number id. Show the real local counter + why the cap is
    // unknown instead of a fake 0/1000 gauge. A non-numeric or zero limit is
    // treated the same way — `q.limit == null` alone would let NaN through and
    // render "5/NaN".
    if (q.available === false || !Number.isFinite(limit) || limit <= 0) {
      el.innerHTML = `
        <div style="padding:10px 12px;border-radius:8px;background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.25);margin-bottom:8px">
          <div style="font-size:16px;font-weight:700;color:var(--text-primary,#111);line-height:1.2">${used} sent today</div>
          <div style="font-size:10px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.4px">Messages sent (IST day)</div>
        </div>
        <div style="font-size:11.5px;color:var(--text-secondary);line-height:1.6">
          Sending limit not available${q.reason ? ` — <span style="color:#b45309">${escapeHtml(String(q.reason))}</span>` : ''}.<br>
          <a href="https://business.facebook.com/wa/manage/" target="_blank" rel="noopener" style="color:var(--accent)">View in Meta Business Suite</a>
        </div>`;
    } else {
      const pct = Math.min(100, Math.round((used / limit) * 100));
      const color = pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : 'var(--accent,#25D366)';
      el.innerHTML = `
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
          <div style="flex:1;min-width:100px;padding:8px 12px;background:rgba(var(--accent-rgb,37,211,102),.06);border-radius:8px;text-align:center">
            <div style="font-size:20px;font-weight:700;color:var(--accent,#25D366);line-height:1.2">${used}/${limit}</div>
            <div style="font-size:10px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.4px">Used / Limit</div>
          </div>
          <div style="flex:1;min-width:80px;padding:10px 12px;background:rgba(34,197,94,.04);border-radius:8px;text-align:center">
            <div style="font-size:16px;font-weight:600;color:var(--text-primary,#111);line-height:1.2">${Math.max(0, limit - used)}</div>
            <div style="font-size:10px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.4px">Remaining</div>
          </div>
        </div>
        <div style="height:8px;background:var(--glass-border,#2a2f3a);border-radius:4px;overflow:hidden;margin-bottom:8px">
          <div style="width:${pct}%;height:100%;background:${color};transition:width .3s"></div>
        </div>
        <div style="font-size:11.5px;color:var(--text-secondary);line-height:1.6">
          ${q.tier ? `${escapeHtml(String(q.tier))} · ` : ''}Cap resets at midnight UTC · count is per IST day · <a href="https://business.facebook.com/wa/manage/" target="_blank" rel="noopener" style="color:var(--accent)">View in Meta Business Suite</a>
        </div>`;
    }
  } catch (err) {
    console.error('loadQuota failed', err);
    if (quotaFetchedFor !== key) return; // navigated away mid-flight
    el = document.getElementById('quota-content');
    if (!el) return;
    // Keep the last good card on a transient failure (the element may have just
    // been rebuilt by a re-render tick), and honour the refresh window before
    // retrying. With nothing cached, show the hard error but do NOT cache it —
    // the next tick should retry instead of freezing the error for a minute.
    if (quotaHtml) {
      el.innerHTML = quotaHtml;
      quotaFetchedAt = Date.now();
      return;
    }
    el.innerHTML = 'Could not load quota. Check Meta System User Token on server.';
    return;
  }
  quotaHtml = el.innerHTML;
  quotaFetchedAt = Date.now();
}
