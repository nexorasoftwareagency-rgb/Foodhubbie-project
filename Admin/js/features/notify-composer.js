// ============================================================================
// CUSTOMER NOTIFICATION CHECKLIST — COMPOSER
//
// The Customers tab lets an owner pick guests and send them ONE message:
//   - as a Customer APP push  -> one call to the tenantNotify Function
//   - as a WhatsApp message  -> the SAME campaign the Promotions tab writes
//                                (bot/promotions/campaigns + bot/commands),
//                                so the bot remains the only WhatsApp sender.
//
// The composer is prefilled from the selected guests (their names, favourite
// dish, last visit, segment, consent) and is honest about who will actually
// receive it: the reach numbers come from notify-eligibility.js, which uses
// the same rules the server and the bot enforce.
//
// The message generator is DETERMINISTIC - real guest data composed into a
// segment-appropriate pattern. It is not AI and does not pretend to be.
//
// One request per batch (never one per guest), one history row, one campaign.
// ============================================================================

import { Outlet, BUSINESS_ID, tenantRef, set, push } from '../firebase.js';
import { showToast, showConfirm } from '../ui-utils.js';
import { logger } from '../utils/logger.js';
import { esc, num } from './customer-profile-view.js';
import { loadApprovedWaTemplates } from './promotions-templates.js';
import { buildCampaignPayload } from './promotions.js';
import { sendNotify, syncServerClock, isQuietHours } from './notify-client.js';
import {
    evaluateBatch, blockedSummary, generateDraft, dominantIntent, dominantDish,
    BLOCK_REASONS, MAX_WA_RECIPIENTS,
} from './notify-eligibility.js';

const $ = (id) => document.getElementById(id);

// The composer styles travel with the module (injected once) so the feature
// ships without touching the shared stylesheet and its cache-buster.
const NOTIFY_COMPOSER_CSS = `
#notifyComposerModal .notify-composer-modal { max-width: 620px; width: min(94vw, 620px); }
#notifyComposerModal .notify-composer-body { display: flex; flex-direction: column; gap: 14px; padding: 18px 20px; max-height: 68vh; overflow-y: auto; }
#notifyComposerModal .notify-eyebrow { margin: 0 0 2px; font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--mob-sub); }
#notifyComposerModal .notify-tabs { display: flex; gap: 6px; background: var(--mob-bg); padding: 4px; border-radius: 10px; }
#notifyComposerModal .notify-tab {
    appearance: none; border: 0; background: transparent; color: var(--mob-sub);
    font-size: 12.5px; font-weight: 800; padding: 8px 14px; border-radius: 8px; cursor: pointer; flex: 1 1 0;
}
#notifyComposerModal .notify-tab[aria-selected="true"] { background: #fff; color: var(--mob-ink); box-shadow: 0 1px 2px rgba(15,23,42,.12); }
#notifyComposerModal .notify-tab:focus-visible { outline: 2px solid var(--mob-blue); outline-offset: 2px; }
#notifyComposerModal .notify-audience { border: 1px solid var(--mob-border); border-radius: 12px; padding: 12px; }
#notifyComposerModal .notify-aud-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
#notifyComposerModal .notify-aud-label { font-size: 11.5px; font-weight: 800; color: var(--mob-sub); text-transform: uppercase; letter-spacing: .05em; }
#notifyComposerModal .notify-aud-count { font-size: 12px; font-weight: 800; background: var(--mob-ink); color: #fff; border-radius: 999px; padding: 2px 9px; }
#notifyComposerModal .notify-guest-chips { display: flex; flex-wrap: wrap; gap: 5px; }
#notifyComposerModal .notify-guest-chip { font-size: 12px; font-weight: 700; background: var(--mob-bg); color: var(--mob-ink); border-radius: 999px; padding: 3px 10px; }
#notifyComposerModal .notify-guest-more { color: var(--mob-sub); font-style: italic; }
#notifyComposerModal .notify-facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 8px 14px; margin: 12px 0 0; }
#notifyComposerModal .notify-facts dt { font-size: 10.5px; font-weight: 800; color: var(--mob-sub); text-transform: uppercase; letter-spacing: .04em; }
#notifyComposerModal .notify-facts dd { margin: 2px 0 0; font-size: 13px; font-weight: 700; color: var(--mob-ink); }
#notifyComposerModal .notify-reach { border-radius: 12px; padding: 12px; background: var(--mob-bg); }
#notifyComposerModal .notify-reach-line { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; }
#notifyComposerModal .notify-reach-count { font-size: 17px; font-weight: 900; color: var(--mob-ink); }
#notifyComposerModal .notify-reach-what { font-size: 12.5px; color: var(--mob-sub); }
#notifyComposerModal .notify-blocked { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
#notifyComposerModal .notify-blocked-title { font-size: 11px; font-weight: 800; color: var(--mob-sub); text-transform: uppercase; }
#notifyComposerModal .notify-block-chip { font-size: 11px; font-weight: 800; background: #fff; border: 1px solid var(--mob-border); color: var(--mob-sub); border-radius: 999px; padding: 2px 8px; }
#notifyComposerModal .notify-block-chip-bad { background: var(--mob-red-light); color: var(--mob-red); border-color: transparent; }
#notifyComposerModal .notify-gate { margin-top: 9px; font-size: 12.5px; color: var(--mob-ink); }
#notifyComposerModal .notify-gate strong { display: block; font-size: 12.5px; }
#notifyComposerModal .notify-gate ul { margin: 4px 0 0; padding-left: 18px; color: var(--mob-sub); }
#notifyComposerModal .notify-gate.warn { background: var(--mob-amber-light); border-radius: 10px; padding: 9px 11px; }
#notifyComposerModal .notify-field { display: flex; flex-direction: column; gap: 5px; }
#notifyComposerModal .notify-field > label { font-size: 12px; font-weight: 800; color: var(--mob-ink); }
#notifyComposerModal .notify-hint { font-size: 11.5px; color: var(--mob-sub); font-weight: 600; }
#notifyComposerModal .notify-input {
    width: 100%; border: 1px solid var(--mob-border); border-radius: 10px;
    padding: 9px 11px; font-size: 14px; font-family: inherit; color: var(--mob-ink); background: #fff;
}
#notifyComposerModal .notify-input:focus { outline: 2px solid var(--mob-blue); outline-offset: 0; border-color: var(--mob-blue); }
#notifyComposerModal .notify-textarea { resize: vertical; min-height: 88px; line-height: 1.5; }
#notifyComposerModal .notify-field-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 2px; }
#notifyComposerModal .notify-check { display: flex; align-items: center; gap: 7px; font-size: 12.5px; font-weight: 700; color: var(--mob-sub); }
#notifyComposerModal .notify-composer-foot { align-items: center; justify-content: space-between; flex-wrap: wrap; }
#notifyComposerModal .notify-result { flex: 1 1 220px; font-size: 12.5px; color: var(--mob-ink); display: flex; flex-direction: column; gap: 2px; }
#notifyComposerModal .notify-result-note { font-size: 11.5px; color: var(--mob-sub); }
#notifyComposerModal .notify-result-ok strong { color: var(--mob-green); }
#notifyComposerModal .notify-result-warn strong { color: #b45309; }
#notifyComposerModal .notify-result-error strong { color: var(--mob-red); }
@media (max-width: 640px) {
    #notifyComposerModal .notify-composer-modal { max-width: none; width: 100%; border-radius: 14px; }
    #notifyComposerModal .notify-composer-body { max-height: 62vh; }
    #notifyComposerModal .notify-composer-foot { flex-direction: column; align-items: stretch; }
    #notifyComposerModal .notify-composer-foot .btn-primary,
    #notifyComposerModal .notify-composer-foot .btn-secondary { width: 100%; min-height: 44px; }
}
`;

let _cssInjected = false;
function _injectCss() {
    if (_cssInjected) return;
    _cssInjected = true;
    const style = document.createElement('style');
    style.id = 'notifyComposerStyle';
    style.textContent = NOTIFY_COMPOSER_CSS;
    document.head.appendChild(style);
}

let _rows = [];
let _ctx = {};
let _channel = 'push';
let _sending = false;
let _wired = false;
let _templatesLoaded = false;

/** The channel's honest reach numbers + why the others are blocked. */
function _reach() {
    return evaluateBatch(_rows, _ctx);
}

/** The guests this channel can actually reach, in selection order. */
function _reachablePhones(channel) {
    const r = _reach();
    return _rows
        .filter((row) => {
            const g = r.per[row.phone] || {};
            const list = channel === 'wa' ? g.wa : g.push;
            return Array.isArray(list) && list.length === 0;
        })
        .map((row) => row.phone)
        .filter(Boolean);
}

/** The median "days since last visit" of the selection (a guest fact). */
function _medianDaysSince() {
    const days = _rows
        .map((r) => (r.lifetime && Number.isFinite(r.lifetime.daysInactive) ? r.lifetime.daysInactive : null))
        .filter((d) => d !== null)
        .sort((a, b) => a - b);
    if (!days.length) return null;
    const mid = Math.floor(days.length / 2);
    return days.length % 2 ? days[mid] : Math.round((days[mid - 1] + days[mid]) / 2);
}

function _segmentMix() {
    const counts = {};
    for (const r of _rows) {
        const label = (r.action && r.action.segment) || 'Other';
        counts[label] = (counts[label] || 0) + 1;
    }
    return Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .map(([label, n]) => `${n} ${label}`);
}

function _renderAudience() {
    const host = $('notifyAudience');
    if (!host) return;
    const shown = _rows.slice(0, 12);
    const rest = _rows.length - shown.length;
    const chips = shown.map((r) => `
        <span class="notify-guest-chip" title="${esc(r.name || 'Guest')} · ${esc(r.displayPhone || r.phone || '')}">
            ${esc(r.name || 'Guest')}
        </span>`).join('');
    const more = rest > 0 ? `<span class="notify-guest-chip notify-guest-more">+${esc(num(rest))} more</span>` : '';

    const dom = dominantIntent(_rows);
    const dish = dominantDish(_rows);
    const days = _medianDaysSince();
    const facts = [
        ['Store', _ctx.storeName || '—'],
        ['Most ordered', dish ? `${dish.name} (${dish.guests} of ${_rows.length})` : 'no paid dish yet'],
        ['Last visit', days === null ? 'no paid visit' : `${days} day${days === 1 ? '' : 's'} ago (median)`],
        ['Segments', _segmentMix().join(' · ') || '—'],
        ['About them', dom.intent === 'lapsed' ? 'gone quiet — a win-back message fits' :
            dom.intent === 'at-risk' ? 'visits have slowed — a check-in fits' :
                dom.intent === 'new' ? 'new guests — a welcome fits' :
                    dom.intent === 'champion' ? 'your regulars — a thank-you fits' : 'a general message fits'],
    ];
    host.innerHTML = `
        <div class="notify-aud-head">
            <span class="notify-aud-label">Selected guests</span>
            <span class="notify-aud-count">${esc(num(_rows.length))}</span>
        </div>
        <div class="notify-guest-chips">${chips}${more}</div>
        <dl class="notify-facts">
            ${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}
        </dl>`;
}

function _renderReach() {
    const host = $('notifyReach');
    if (!host) return;
    const r = _reach();
    const channel = _channel === 'wa' ? r.wa : r.push;
    const label = _channel === 'wa' ? 'WhatsApp message' : 'Customer APP push';

    const blocked = blockedSummary(channel.blocked);
    const blockedHtml = blocked.length
        ? `<div class="notify-blocked">
               <span class="notify-blocked-title">Skipped</span>
               ${blocked.map((b) => `<span class="notify-block-chip" title="${esc(BLOCK_REASONS[b.id]?.label || b.id)}">${esc(b.short)} · ${esc(num(b.count))}</span>`).join('')}
           </div>`
        : '';

    let gates = '';
    if (_channel === 'wa') {
        const gateList = (channel.gates || []).map((id) => {
            const g = BLOCK_REASONS[id] || { label: id };
            return `<span class="notify-block-chip notify-block-chip-bad" title="${esc(g.label)}">${esc(g.short || id)}</span>`;
        }).join('');
        if (gateList) {
            gates = `<div class="notify-gate warn"><strong>This outlet cannot send WhatsApp messages yet.</strong>
                <ul>${(channel.gates || []).map((id) => `<li>${esc((BLOCK_REASONS[id] || {}).label || id)}</li>`).join('')}</ul></div>`;
        }
    } else if (channel.quiet) {
        gates = `<div class="notify-gate warn"><strong>Marketing pushes pause 9 PM - 9 AM IST.</strong>
            Nothing would be delivered right now - send after 9:00 AM.</div>`;
    }

    const capped = _channel === 'wa' && channel.capped
        ? `<div class="notify-gate warn">Only the first ${esc(num(channel.cap))} recipients are used - this selection has ${esc(num(channel.reachable))}.</div>`
        : '';

    host.innerHTML = `
        <div class="notify-reach-line">
            <span class="notify-reach-count">Up to ${esc(num(channel.reachable))} of ${esc(num(r.total))}</span>
            <span class="notify-reach-what">can get this ${esc(label)}</span>
        </div>
        ${blockedHtml}${gates}${capped}`;
}

function _syncChannelUi() {
    const pushTab = document.querySelector('[data-notify-channel="push"]');
    const waTab = document.querySelector('[data-notify-channel="wa"]');
    if (pushTab) pushTab.setAttribute('aria-selected', _channel === 'push' ? 'true' : 'false');
    if (waTab) waTab.setAttribute('aria-selected', _channel === 'wa' ? 'true' : 'false');

    const waRow = $('notifyWaRow');
    if (waRow) waRow.classList.toggle('hidden', _channel !== 'wa');

    const titleField = document.querySelector('.notify-field-title');
    if (titleField) titleField.classList.toggle('hidden', _channel !== 'push');
    const titleInput = $('notifyTitleInput');
    if (titleInput) titleInput.disabled = _channel !== 'push';

    const bodyInput = $('notifyBodyInput');
    if (bodyInput) bodyInput.placeholder = _channel === 'wa'
        ? 'Personalized per guest - {name}, {storeName} and {lastOrderDate} are replaced at send time.'
        : 'One message for every device - do not use {name} here.';

    const btn = $('notifySendBtn');
    if (btn) {
        const r = _reach();
        const channel = _channel === 'wa' ? r.wa : r.push;
        const n = _channel === 'wa' ? Math.min(channel.reachable, channel.cap) : channel.reachable;
        const blocked = _channel === 'wa' && channel.gates.length > 0;
        const quiet = _channel === 'push' && channel.quiet;
        btn.disabled = _sending || n === 0 || blocked || quiet;
        btn.textContent = _sending
            ? 'Sending…'
            : (blocked ? 'WhatsApp sending unavailable'
                : (quiet ? 'Paused until 9:00 AM'
                    : `Send to ${num(n)} guest${n === 1 ? '' : 's'}`));
    }
    const count = $('notifyCharCount');
    if (count && bodyInput) count.textContent = `${bodyInput.value.length} / 300`;
}

function _render() {
    _renderAudience();
    _renderReach();
    _syncChannelUi();
}

/** Compose the draft from the guests' own details (deterministic, not AI). */
function _generate() {
    const draft = generateDraft(_rows, _ctx, { channel: _channel });
    const title = $('notifyTitleInput');
    const body = $('notifyBodyInput');
    if (title && _channel === 'push') title.value = draft.title;
    if (body) body.value = draft.body;
    _syncChannelUi();
    showToast(`Draft composed from ${draft.dish ? draft.dish : 'your guests’ details'}. Edit it before sending.`, 'info');
}

async function _loadWaTemplates() {
    if (_templatesLoaded) return;
    _templatesLoaded = true;
    const select = $('notifyWaTemplate');
    if (!select) return;
    try {
        await loadApprovedWaTemplates(BUSINESS_ID(), Outlet.current, select);
    } catch (err) {
        logger.warn('NOTIFY', 'template list failed', err);
    }
}

/** One request for the whole batch - never one request per guest. */
async function _sendPush() {
    const phones = _reachablePhones('push');
    if (!phones.length) throw new Error('None of the selected guests can receive a Customer APP push.');
    const title = ($('notifyTitleInput')?.value || '').trim();
    const body = ($('notifyBodyInput')?.value || '').trim();
    if (!title || !body) throw new Error('Write a title and a message first.');

    const result = await sendNotify({
        title,
        body,
        type: 'promo',
        audience: 'phones',
        phones,
        data: { type: 'promo', typeLabel: 'Offer / Promo', source: 'customer-checklist' },
    });

    const sent = Number(result.sent || 0);
    const failed = Number(result.failed || 0);
    const inbox = Number(result.inbox || 0);
    const total = Number(result.total || 0);
    const bits = [`Sent to ${sent} device${sent === 1 ? '' : 's'}`];
    if (failed) bits.push(`${failed} failed`);
    if (inbox) bits.push(`${inbox} in the in-app inbox`);
    if (total < phones.length) bits.push(`${phones.length - total} skipped (daily limit)`);
    _showResult(sent > 0 ? 'ok' : 'warn', bits.join(' · '), 'A delivered push cannot be pulled back.');
    return sent;
}

/** The WhatsApp half writes the SAME campaign the Promotions tab writes. */
async function _sendWhatsApp() {
    const phones = _reachablePhones('wa');
    if (!phones.length) throw new Error('None of the selected guests can receive a WhatsApp message.');
    const body = ($('notifyBodyInput')?.value || '').trim();
    if (!body) throw new Error('Write a message first.');

    const r = _reach();
    const capped = Math.min(phones.length, r.wa.cap);
    const recipients = phones.slice(0, capped);

    const waTemplateName = ($('notifyWaTemplate')?.value || '').trim() || 'proactive_promo';
    const sendStopMsg = !!$('notifySendStop')?.checked;

    const { campaignId, campaignDoc, command } = buildCampaignPayload({
        recipients,
        template: body,
        waTemplateName,
        sendStopMsg,
        requestedBy: window.currentAdmin?.uid || 'admin',
        status: 'running',
    });

    const outlet = Outlet.current;
    await set(tenantRef(outlet, `bot/promotions/campaigns/${campaignId}`), campaignDoc);
    const cmdRef = push(tenantRef(outlet, 'bot/commands'));
    await set(cmdRef, command);

    _showResult('ok',
        `Campaign ${campaignId} queued for ${capped} recipient${capped === 1 ? '' : 's'}. The bot sends them one at a time (8-15 s apart).`,
        'A WhatsApp message cannot be recalled. You can stop the remaining sends from Promotions.');
    return capped;
}

function _showResult(tone, message, note) {
    const host = $('notifyResult');
    if (!host) return;
    host.className = `notify-result notify-result-${tone}`;
    host.innerHTML = `<strong>${esc(message)}</strong>${note ? `<span class="notify-result-note">${esc(note)}</span>` : ''}`;
}

async function _send() {
    if (_sending) return;
    const r = _reach();
    const channel = _channel === 'wa' ? r.wa : r.push;
    const n = _channel === 'wa' ? Math.min(channel.reachable, channel.cap) : channel.reachable;
    if (!n) { showToast('Nobody in this selection can receive the message.', 'warning'); return; }

    const title = ($('notifyTitleInput')?.value || '').trim();
    const body = ($('notifyBodyInput')?.value || '').trim();
    if (!body) { showToast('Write a message first.', 'warning'); $('notifyBodyInput')?.focus(); return; }
    if (_channel === 'push' && !title) { showToast('Write a title first.', 'warning'); $('notifyTitleInput')?.focus(); return; }

    const confirmText = _channel === 'wa'
        ? `Send this WhatsApp message to ${n} guest${n === 1 ? '' : 's'}?\n\n${n < channel.reachable ? `${channel.reachable - n} guest(s) will be skipped.` : ''}Sent messages cannot be recalled.`
        : `Send this push to up to ${n} device${n === 1 ? '' : 's'}?\n\nEach customer can get up to 3 offer pushes a day.`;
    const ok = await showConfirm(confirmText, _channel === 'wa' ? 'Confirm WhatsApp campaign' : 'Confirm notification');
    if (!ok) return;

    _sending = true;
    _syncChannelUi();
    try {
        if (_channel === 'wa') await _sendWhatsApp();
        else await _sendPush();
        const bodyEl = $('notifyBodyInput');
        if (bodyEl) bodyEl.value = '';
        const titleEl = $('notifyTitleInput');
        if (titleEl) titleEl.value = '';
    } catch (err) {
        logger.warn('NOTIFY', 'send failed', err);
        const msg = (err && err.message) || 'Could not send the message.';
        _showResult('error', msg);
        showToast(msg, 'error');
    } finally {
        _sending = false;
        _syncChannelUi();
    }
}

function _close() {
    const modal = $('notifyComposerModal');
    if (!modal) return;
    modal.classList.remove('active');
    document.body.classList.remove('modal-open');
}

/** Wire the modal ONCE - the composer is opened from the Customers tab. */
function _wire() {
    if (_wired) return;
    _wired = true;
    _injectCss();

    document.addEventListener('click', (e) => {
        const tab = e.target.closest('[data-notify-channel]');
        if (tab && $('notifyComposerModal')?.classList.contains('active')) {
            _channel = tab.dataset.notifyChannel === 'wa' ? 'wa' : 'push';
            _syncChannelUi();
            _renderReach();
            if (_channel === 'wa') _loadWaTemplates();
            return;
        }
        if (e.target.closest('[data-notify-close]')) _close();
    });

    const gen = $('notifyGenerateBtn');
    if (gen) gen.addEventListener('click', _generate);
    const send = $('notifySendBtn');
    if (send) send.addEventListener('click', _send);
    const body = $('notifyBodyInput');
    if (body) body.addEventListener('input', () => _syncChannelUi());
}

/**
 * Open the composer for the selected guests.
 * @param rows the selected customer rows (from customers-view.js)
 * @param ctx  { subscriptions, quiet, promoEnabled, killSwitch, transport,
 *               tokenBalance, storeName, maxWaRecipients }
 */
export async function openNotifyComposer({ rows = [], ctx = {} } = {}) {
    _rows = rows.slice();
    _ctx = Object.assign({ maxWaRecipients: MAX_WA_RECIPIENTS }, ctx || {});
    _channel = 'push';
    _templatesLoaded = false;

    _wire();
    await syncServerClock();
    // The quiet-hours window is the SERVER's, read from the same clock.
    _ctx.quiet = _ctx.quiet === undefined ? isQuietHours() : !!_ctx.quiet;

    const modal = $('notifyComposerModal');
    if (!modal) { showToast('The composer is missing from this build.', 'error'); return; }
    _render();

    // A fresh draft for every opening - the previous message must never be
    // resurrected with a different audience behind it.
    const title = $('notifyTitleInput');
    const body = $('notifyBodyInput');
    if (title) title.value = '';
    if (body) body.value = '';

    modal.classList.add('active');
    document.body.classList.add('modal-open');
    setTimeout(() => $('notifyBodyInput')?.focus(), 50);
}
