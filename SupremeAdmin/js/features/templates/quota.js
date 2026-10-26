/**
 * Quota & Analytics templates
 */

export async function loadQuota(bid, oid) {
  const el = document.getElementById('quota-content');
  if (!el) return;
  try {
    const token = await firebase.auth().currentUser.getIdToken();
    const res = await fetch(`${window.TUNNEL_URL}/api/whatsapp/quota/${bid}/${oid}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`${res.status}`);
    const { quota } = await res.json();
    const q = quota || {};
    const used = q.used ?? 0;
    const limit = q.limit ?? 1000;
    const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
    const color = pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : 'var(--accent,#25D366)';
    document.getElementById('quota-content').innerHTML = `
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
        Quota resets at midnight UTC · <a href="https://business.facebook.com/wa/manage/" target="_blank" rel="noopener" style="color:var(--accent)">View in Meta Business Suite</a>
      </div>`;
  } catch (err) {
    console.error('loadQuota failed', err);
    document.getElementById('quota-content').innerHTML = 'Could not load quota. Check Meta System User Token on server.';
  }
}