/**
 * Bot Usage template - renders today's count + 7-day trend bar chart
 */

import { escapeHtml } from '/js/utils.js';

export function _istDate(ts) {
  if (!ts) return '';
  return new Date(ts + 5.5 * 3600000).toISOString().split('T')[0];
}

function _dayLabelShort(dateStr) {
  const d = new Date(dateStr + 'T00:00:00+05:30');
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function renderBotUsage(usage, transport) {
  if (!usage || typeof usage !== 'object') {
    return '<div style="color:var(--text-tertiary);padding:8px 0">No outbound data yet. Data appears after the bot starts sending messages.</div>';
  }

  // Build 7-day series (oldest → newest)
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000 + 5.5 * 3600000);
    days.push(d.toISOString().split('T')[0]);
  }
  const series = days.map(d => ({ date: d, count: usage[d]?.total || 0 }));
  const maxCount = Math.max(1, ...series.map(d => d.count));

  // Today's breakdown
  const today = _istDate(Date.now());
  const todayData = usage[today] || {};
  const todayTotal = todayData.total || 0;

  // Warning level
  let warnColor = '';
  let warnLabel = '';
  if (todayTotal >= 500) { warnColor = '#ef4444'; warnLabel = 'Approaching Baileys ban threshold'; }
  else if (todayTotal >= 400) { warnColor = '#f59e0b'; warnLabel = 'Nearing daily limit'; }

  const barChartHtml = series.map(s => {
    const h = maxCount > 0 ? Math.max(2, (s.count / maxCount) * 60) : 2;
    const color = s.count >= 500 ? '#ef4444' : s.count >= 400 ? '#f59e0b' : 'var(--accent, #25D366)';
    return `<div style="display:flex;flex-direction:column;align-items:center;flex:1;min-width:0">
      <div style="font-size:10px;color:var(--text-secondary);margin-bottom:3px;font-variant-numeric:tabular-nums">${s.count || ''}</div>
      <div style="width:100%;max-width:28px;height:${h}px;background:${color};border-radius:3px 3px 0 0;min-height:2px;transition:height .3s"></div>
      <div style="font-size:9px;color:var(--text-tertiary);margin-top:3px;white-space:nowrap">${_dayLabelShort(s.date)}</div>
    </div>`;
  }).join('');

  return `
    <div style="padding:4px 0">
      ${warnLabel ? `<div style="display:flex;align-items:center;gap:6px;margin-bottom:12px;padding:8px 10px;background:${warnColor}18;border:1px solid ${warnColor}44;border-radius:8px;font-size:12.5px;color:${warnColor}">
        <svg data-lucide="alert-triangle" style="width:14px;height:14px;flex:none"></svg> ${warnLabel} (${todayTotal}/500)
      </div>` : ''}

      <div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap">
        <div style="flex:1;min-width:100px;padding:10px 12px;background:rgba(var(--accent-rgb,37,211,102),.06);border-radius:8px;text-align:center">
          <div style="font-size:22px;font-weight:700;color:var(--accent,#25D366);line-height:1.2;font-variant-numeric:tabular-nums">${todayTotal}</div>
          <div style="font-size:10px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.4px">Sent Today</div>
        </div>
        <div style="flex:1;min-width:80px;padding:10px 12px;background:rgba(34,197,94,.04);border-radius:8px;text-align:center">
          <div style="font-size:16px;font-weight:600;color:var(--text-primary,#111);line-height:1.2;font-variant-numeric:tabular-nums">${todayData.order_notification || 0}</div>
          <div style="font-size:10px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.4px">Orders</div>
        </div>
        <div style="flex:1;min-width:80px;padding:10px 12px;background:rgba(34,197,94,.04);border-radius:8px;text-align:center">
          <div style="font-size:16px;font-weight:600;color:var(--text-primary,#111);line-height:1.2;font-variant-numeric:tabular-nums">${todayData.rider_broadcast || 0}</div>
          <div style="font-size:10px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.4px">Riders</div>
        </div>
        <div style="flex:1;min-width:80px;padding:10px 12px;background:rgba(34,197,94,.04);border-radius:8px;text-align:center">
          <div style="font-size:16px;font-weight:600;color:var(--text-primary,#111);line-height:1.2;font-variant-numeric:tabular-nums">${todayData.promo || 0}</div>
          <div style="font-size:10px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.4px">Promos</div>
        </div>
      </div>

      <div style="margin-bottom:4px;font-size:11px;color:var(--text-secondary);font-weight:600;text-transform:uppercase;letter-spacing:.5px">7-Day Trend</div>
      <div style="display:flex;align-items:flex-end;gap:4px;height:90px;padding:6px 0;border-bottom:1px solid var(--glass-border,#2a2f3a)">${barChartHtml}</div>

      <div style="margin-top:12px;font-size:11.5px;color:var(--text-tertiary);line-height:1.6">
        Baileys soft limit: 500 messages/day · Threshold: <span style="color:#f59e0b">400</span>/<span style="color:#ef4444">500</span> · Transport: <span class="mono">${escapeHtml(transport === 'meta' ? 'Official API' : 'WhatsApp Web')}</span>
      </div>
    </div>`;
}