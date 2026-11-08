/**
 * Tiny helpers shared by the Supreme Admin list screens (UI only, no data access).
 *  - sortRows / nextSort : click-a-header sorting that remembers direction
 *  - sortHeader          : <th> markup with an arrow and aria-sort
 *  - statStrip / chips   : the compact summary strip + filter chips used on every list
 */
import { escapeHtml } from '/js/utils.js';

/** Sort a copy of rows. `cols[key]` returns the comparable value for a row. */
export function sortRows(rows, sort, cols) {
  if (!sort || !cols[sort.key]) return rows;
  const get = cols[sort.key];
  const dir = sort.dir === 'desc' ? -1 : 1;
  return rows.slice().sort((a, b) => {
    const x = get(a), y = get(b);
    if (x == null && y == null) return 0;
    if (x == null) return 1;           // empty values always sink to the bottom
    if (y == null) return -1;
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
    return String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' }) * dir;
  });
}

/** Clicking the active column flips direction; a new column starts ascending (or descending for numbers). */
export function nextSort(sort, key, numeric = false) {
  if (sort && sort.key === key) return { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: numeric ? 'desc' : 'asc' };
}

/** <th> that sorts when clicked. `action` is the registered data-action name. */
export function sortHeader({ action, key, label, sort, numeric = false, cls = '' }) {
  const active = sort && sort.key === key;
  const aria = active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
  return `<th scope="col" class="th-sort ${numeric ? 'num' : ''} ${cls}" aria-sort="${aria}">
    <button type="button" class="th-sort-btn" data-action="${action}" data-key="${key}" data-numeric="${numeric ? 1 : 0}">${escapeHtml(label)}<span class="th-arrow" aria-hidden="true">${active ? (sort.dir === 'asc' ? '▲' : '▼') : ''}</span></button>
  </th>`;
}

/**
 * Compact summary strip. items: [{ label, value, sub?, tone?, action?, data? , active? }]
 * An item with `action` becomes a button (usually "apply this filter").
 */
export function statStrip(items, id = '') {
  return `<div class="stat-strip" ${id ? `id="${id}"` : ''}>${items.map((it) => {
    const inner = `<span class="stat-label">${escapeHtml(it.label)}</span>
      <span class="stat-value ${it.tone ? 'tone-' + it.tone : ''}">${it.value}${it.sub ? `<small>${escapeHtml(it.sub)}</small>` : ''}</span>`;
    if (!it.action) return `<div class="stat">${inner}</div>`;
    const data = Object.entries(it.data || {}).map(([k, v]) => `data-${k}="${escapeHtml(v)}"`).join(' ');
    return `<button type="button" class="stat stat-btn ${it.active ? 'active' : ''}" data-action="${it.action}" ${data} aria-pressed="${!!it.active}">${inner}</button>`;
  }).join('')}</div>`;
}

/** Filter chips with counts. items: [{ id, label, count?, tone? }] */
export function chips({ items, active, action, label = 'Filter' }) {
  return `<div class="chip-row" role="group" aria-label="${escapeHtml(label)}">${items.map((c) =>
    `<button type="button" class="chip ${c.id === active ? 'active' : ''} ${c.tone ? 'tone-' + c.tone : ''}" data-action="${action}" data-chip="${escapeHtml(c.id)}" aria-pressed="${c.id === active}">${escapeHtml(c.label)}${c.count != null ? `<span class="chip-count">${c.count}</span>` : ''}</button>`).join('')}</div>`;
}

/**
 * These screens rebuild their chips/headers on every filter or sort, which
 * destroys the control that was just activated. Keyboard focus would fall back
 * to <body> (the next Tab starts over). Put it back on the re-rendered twin.
 */
export function keepFocus(selector) {
  const el = document.querySelector(selector);
  if (el) el.focus({ preventScroll: true });
}
