import { navigate } from '/js/main.js';
import { flattenOutlets } from '/js/data-store.js';

let activeIndex = 0;
let currentResults = [];

export function open() {
  if (document.getElementById('command-palette')) return; // already open

  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal open command-palette-overlay" id="command-palette">
      <div class="command-palette-box">
        <div class="command-palette-input-row">
          <svg data-lucide="search"></svg>
          <input type="text" id="cp-input" placeholder="Jump to a restaurant or outlet…" autocomplete="off" role="combobox" aria-expanded="true" aria-controls="cp-results" aria-autocomplete="list" aria-activedescendant="cp-active" />
          <kbd>esc</kbd>
        </div>
        <div id="cp-results" class="command-palette-results" role="listbox" aria-label="Restaurants"></div>
      </div>
    </div>`;
  refreshIcons(root);

  const modal = document.getElementById('command-palette');
  const input = document.getElementById('cp-input');
  input.focus();

  renderResults(flattenOutlets().slice(0, 8), '');

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    const rows = flattenOutlets();
    const filtered = q
      ? rows.filter((r) => r.outletName.toLowerCase().includes(q) || r.businessName.toLowerCase().includes(q))
      : rows.slice(0, 8);
    renderResults(filtered.slice(0, 8), q);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveActive(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveActive(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); selectActive(); }
    else if (e.key === 'Escape') { close(); }
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();
    const row = e.target.closest('[data-cp-index]');
    if (row) { activeIndex = Number(row.dataset.cpIndex); selectActive(); }
  });

  document.addEventListener('keydown', escListener);
  window.addEventListener('hashchange', close, { once: true }); // catches browser back/forward while open - the case Escape/click-outside/select don't cover
}

function escListener(e) {
  if (e.key === 'Escape') close();
}

function moveActive(delta) {
  if (!currentResults.length) return;
  activeIndex = (activeIndex + delta + currentResults.length) % currentResults.length;
  highlightActive();
}

function highlightActive() {
  const input = document.getElementById('cp-input');
  document.querySelectorAll('#cp-results [data-cp-index]').forEach((el) => {
    const isActive = Number(el.dataset.cpIndex) === activeIndex;
    el.classList.toggle('active', isActive);
    el.setAttribute('aria-selected', String(isActive));
  });
  if (input) input.setAttribute('aria-activedescendant', `cp-${activeIndex}`);
}

function selectActive() {
  const row = currentResults[activeIndex];
  if (!row) return;
  navigate(`profile/${row.bid}/${row.oid}`);
  close();
}

function renderResults(rows, query) {
  currentResults = rows;
  activeIndex = 0;
  const el = document.getElementById('cp-results');
  if (!el) return;

  if (!rows.length) {
    el.innerHTML = `<div class="command-palette-empty">${query ? 'No matches.' : 'Start typing to search…'}</div>`;
    return;
  }

  el.innerHTML = rows.map((r, i) => `
    <div class="command-palette-row${i === 0 ? ' active' : ''}" data-cp-index="${i}" role="option" id="cp-${i}" aria-selected="${i === activeIndex}">
      <div>
        <div class="cp-row-title">${escapeHtml(r.outletName)}</div>
        <div class="cp-row-sub">${escapeHtml(r.businessName)}</div>
      </div>
      ${statusPillHtml(r.botStatus)}
    </div>
  `).join('');
  refreshIcons(el);
}

function close() {
  const modal = document.getElementById('command-palette');
  if (!modal) return;
  document.removeEventListener('keydown', escListener);
  window.removeEventListener('hashchange', close); // {once:true} alone only cleans up if hashchange actually fires - also remove explicitly here for the Escape/click-outside/select paths
  modal.classList.remove('open');
  setTimeout(() => { document.getElementById('modal-root').innerHTML = ''; }, 150);
}
