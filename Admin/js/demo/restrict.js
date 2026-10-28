/**
 * FoodHubbie Demo — the single restricted-action notification.
 *
 * Every protected operation in the demo funnels through `restrict()`. It never
 * calls a production service first, so the modal is proof of the block, not a
 * fallback after a failed write.
 *
 * Copy is fixed by the product spec — do not reword.
 */

export const RESTRICT_TITLE = 'Demo Mode — Access Restricted';
export const RESTRICT_MESSAGE = "You don't have access to this feature because you are using the FoodHubbie Demo Admin Dashboard. This feature is available only to authorized administrators in the live application.";
export const RESTRICT_BUTTON = 'Got it';

let _lastTrigger = null;
let _bound = false;

/**
 * The static replica (/demo/tour) carries these rules inline in its own HTML.
 * The live dashboard has no such block, so the modal brings its own — the copy
 * is kept identical to `Admin/demo.html` apart from the z-index (the ERP stacks
 * drawers/sidebars at 5000+ and its own modals at 10000+).
 */
const MODAL_CSS = `
.demo-modal{position:fixed;inset:0;z-index:100000;display:none;align-items:center;justify-content:center;padding:18px}
.demo-modal.is-open{display:flex}
.demo-modal__backdrop{position:absolute;inset:0;background:rgba(15,23,42,.55);-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px)}
.demo-modal__box{position:relative;width:min(460px,100%);background:#fff;border-radius:20px;padding:26px 24px 22px;
  box-shadow:0 40px 90px -40px rgba(15,23,42,.8);text-align:center;animation:demoPop .18s ease-out}
@keyframes demoPop{from{transform:translateY(8px) scale(.985);opacity:.6}to{transform:none;opacity:1}}
.demo-modal__icon{width:48px;height:48px;margin:0 auto 12px;display:flex;align-items:center;justify-content:center;
  border-radius:14px;background:#fff7ed;border:1px solid #fed7aa;color:var(--primary-dark,#c43d00)}
.demo-modal__icon i{width:24px;height:24px}
.demo-modal__title{margin:0 0 10px;font-size:17px;font-weight:800;letter-spacing:-.3px;color:#0f172a}
.demo-modal__text{margin:0;font-size:13px;line-height:1.6;color:var(--text-secondary,#475569)}
.demo-modal__feature{margin:12px 0 0;font-size:11.5px;font-weight:600;color:var(--text-tertiary,#94a3b8);
  background:#f8fafc;border:1px dashed rgba(15,23,42,.08);border-radius:9px;padding:6px 10px}
.demo-modal__btn{margin-top:18px;width:100%;justify-content:center}
body.demo-modal-open{overflow:hidden}
`;

function ensureStyles() {
    if (document.getElementById('demoModalStyles')) return;
    const style = document.createElement('style');
    style.id = 'demoModalStyles';
    style.textContent = MODAL_CSS;
    document.head.appendChild(style);
}

function ensureModal() {
    let modal = document.getElementById('demoRestrictModal');
    if (modal) return modal;

    ensureStyles();
    modal = document.createElement('div');
    modal.id = 'demoRestrictModal';
    modal.className = 'demo-modal';
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = `
        <div class="demo-modal__backdrop" data-restrict-close="1"></div>
        <div class="demo-modal__box" role="dialog" aria-modal="true"
             aria-labelledby="demoRestrictTitle" aria-describedby="demoRestrictMsg">
            <div class="demo-modal__icon" aria-hidden="true"><i data-lucide="shield-alert"></i></div>
            <h2 id="demoRestrictTitle" class="demo-modal__title">${RESTRICT_TITLE}</h2>
            <p id="demoRestrictMsg" class="demo-modal__text">${RESTRICT_MESSAGE}</p>
            <p class="demo-modal__feature" id="demoRestrictFeature" hidden></p>
            <button type="button" id="btnRestrictGotIt" class="btn-primary demo-modal__btn">${RESTRICT_BUTTON}</button>
        </div>`;
    document.body.appendChild(modal);

    modal.addEventListener('click', (e) => {
        if (e.target.closest('[data-restrict-close]') || e.target.closest('#btnRestrictGotIt')) {
            closeRestrict();
        }
    });
    if (window.lucide) window.lucide.createIcons({ root: modal });
    return modal;
}

export function closeRestrict() {
    const modal = document.getElementById('demoRestrictModal');
    if (!modal) return;
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('demo-modal-open');
    if (_lastTrigger && typeof _lastTrigger.focus === 'function') _lastTrigger.focus();
    _lastTrigger = null;
}

/**
 * Show the restriction notification.
 * @param {string} [feature] optional human label of the blocked capability
 * @param {Event|Element} [trigger] element/event that caused it (focus returns here on close)
 */
export function restrict(feature, trigger) {
    const modal = ensureModal();
    const label = document.getElementById('demoRestrictFeature');
    if (label) {
        if (feature) {
            label.hidden = false;
            label.textContent = `Blocked: ${feature}`;
        } else {
            label.hidden = true;
            label.textContent = '';
        }
    }
    _lastTrigger = (trigger && trigger.currentTarget) || (trigger instanceof Element ? trigger : document.activeElement);
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('demo-modal-open');

    if (!_bound) {
        _bound = true;
        document.addEventListener('keydown', (e) => {
            const m = document.getElementById('demoRestrictModal');
            if (e.key === 'Escape' && m && m.classList.contains('is-open')) {
                e.preventDefault();
                closeRestrict();
            }
        });
    }
    const btn = document.getElementById('btnRestrictGotIt');
    if (btn) requestAnimationFrame(() => btn.focus());
}

/**
 * Delegated binding: any element carrying `data-demo-restricted="<label>"`
 * opens the notification instead of performing its action.
 * Returns true when the event was a restricted click (already handled).
 */
export function handleRestrictedClick(e) {
    const el = e.target.closest('[data-demo-restricted]');
    if (!el) return false;
    e.preventDefault();
    e.stopPropagation();
    restrict(el.getAttribute('data-demo-restricted') || '', el);
    return true;
}

export function initRestrictDelegation() {
    document.addEventListener('click', (e) => { handleRestrictedClick(e); }, true);
}
