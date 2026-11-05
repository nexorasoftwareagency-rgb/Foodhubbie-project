// Unified order ID → display string. Callers add "#".
// DDMMYY-N and OUTLET-DDMMYY-N pass through; legacy YYYYMMDD-NNNN → DDMMYY-N; push-keys → last-6 upper.
// menu copy: menu/shared/format-order-id.js — keep in sync (menu site can't reach /shared).
export function formatOrderId(o) {
  const id = typeof o === 'string' ? o : (o && (o.orderId || o.id)) || '';
  if (!id) return 'N/A';
  if (/^(?:.+-)?\d{6}-\d+$/.test(id)) return id;
  const m = String(id).match(/^(\d{4})(\d{2})(\d{2})-(\d+)$/);
  if (m) return `${m[3]}${m[2]}${m[1].slice(2)}-${Number(m[4])}`;
  return String(id).slice(-6).toUpperCase();
}