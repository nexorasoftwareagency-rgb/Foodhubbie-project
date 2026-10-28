/**
 * Demo pages — System: Settings (all subtabs incl. Staff Management, Roles,
 * Attendance, Shifts, Leave, Payroll, Security Audit, Bot Control, Integrations)
 * and the demo-only Supreme Admin preview.
 *
 * Everything is readable. Every save/send/provision/deploy control funnels into
 * the shared restriction notification — the demo never has credentials, and the
 * page itself never imports the Firebase SDK or calls the bot-control API.
 */

import {
    money, num, esc, badge, statusBadge, kpiStrip, panel, sectionTitle, table,
    emptyState, searchBar, select, tabs, field, input, textarea, toggle,
    restrictedBtn, noteBar, simulatedTag, toast, drawerShell, progress, dateOf,
} from './ui-kit.js';
import * as store from './store.js';
import { computePayroll } from '../../shared/payroll-math.js';

// ------------------------------------------------------------------- Settings

const settingsUi = {
    section: 'general',
    staffPage: 'staff',
};

const SETTINGS_SECTIONS = [
    { id: 'general', label: 'General' },
    { id: 'tax-services', label: 'Tax & Services' },
    { id: 'whatsapp-bot', label: 'WhatsApp Bot & Promos' },
    { id: 'marketing', label: 'Marketing' },
    { id: 'delivery-fee', label: 'Delivery Fee' },
    { id: 'qr-menu-offer', label: 'QR Menu Offer' },
    { id: 'features', label: 'Features' },
    { id: 'receipt-dev', label: 'Receipt Designer' },
    { id: 'staff-management', label: 'Staff Management' },
    { id: 'security-audit', label: 'Security & Audit' },
    { id: 'integrations', label: 'Integrations' },
];

export function renderSettings(root, ctx) {
    const d = store.getData();
    const s = d.settings;

    const sectionBody = {
        general: () => `
            <div class="demo-form-grid">
                ${field('Restaurant name', input('setName', d.outlet.name))}
                ${field('Display name', input('setDisplay', d.outlet.displayName))}
                ${field('Phone', input('setPhone', d.outlet.phone))}
                ${field('Email', input('setEmail', d.outlet.email))}
                ${field('GSTIN', input('setGstin', d.outlet.gstin))}
                ${field('FSSAI licence', input('setFssai', d.outlet.fssai))}
            </div>
            ${field('Address', textarea('setAddress', d.outlet.address, { rows: 2 }))}
            ${noteBar('These values are sample data for a fictional restaurant. Saving store details is disabled in the demo.', 'info')}`,

        'tax-services': () => `
            <div class="demo-form-grid">
                ${field('CGST %', input('setCgst', s.tax[0].rate, { type: 'number', attrs: 'step="0.5"' }))}
                ${field('SGST %', input('setSgst', s.tax[1].rate, { type: 'number', attrs: 'step="0.5"' }))}
                ${field('Service charge %', input('setSc', s.serviceCharge.rate, { type: 'number', attrs: 'step="0.5"' }))}
            </div>
            <div class="mt-14">${toggle('setScEnabled', s.serviceCharge.enabled, 'Apply service charge on dine-in')}</div>
            ${noteBar('Tax is charged on the net taxable value (subtotal − discount), the same rule implemented in <code>shared/money-math.js</code>. Changes here are not saved.', 'info')}`,

        'whatsapp-bot': () => renderBotSection(d),
        marketing: () => `
            ${field('Review link', input('setReview', s.marketing.reviewLink))}
            <div class="mt-14">${toggle('setKillSwitch', s.marketing.killSwitch, 'Respect WhatsApp kill switch')}</div>
            ${noteBar('Marketing settings drive the live bot. In the demo they are read-only and no message can be sent.', 'info')}`,
        'delivery-fee': () => `
            <div class="demo-form-grid">
                ${field('Base delivery fee (₹)', input('setBaseFee', s.delivery.baseFee, { type: 'number' }))}
                ${field('Free delivery above (₹)', input('setFreeAbove', s.delivery.freeAbove, { type: 'number' }))}
                ${field('Delivery radius (km)', input('setRadius', s.delivery.radiusKm, { type: 'number' }))}
            </div>
            ${table({
            columns: ['Up to (km)', 'Fee'],
            rows: s.delivery.slabs.map(x => [`${x.upToKm} km`, money(x.fee)]),
        })}
            ${noteBar('Slabs mirror the live delivery-fee model. Nothing here is saved from the demo.', 'info')}`,
        'qr-menu-offer': () => `
            ${field('Offer text on the QR menu', input('setOffer', s.qrMenu.offerText))}
            <div class="mt-14">${toggle('setOfferShow', s.qrMenu.showOffer, 'Show offer banner on customer menu')}</div>
            ${noteBar('Editing this changes what guests see on the QR menu in the live product. Restricted here.', 'info')}`,
        features: () => `
            <div class="demo-check-list">
                ${Object.entries(s.features).map(([k, v]) => `<div class="demo-check-row">
                    <span>${esc(k.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase()))}</span>
                    ${badge(v ? 'Enabled' : 'Disabled', v ? 'ok' : 'muted')}
                </div>`).join('')}
            </div>
            ${noteBar('Feature flags decide which modules exist for the outlet. The demo shows the enabled set as a preview only.', 'info')}`,
        'receipt-dev': () => `
            <div class="demo-receipt">
                <div class="demo-receipt__head">
                    <b>${esc(d.outlet.name)}</b>
                    <span>${esc(d.outlet.address)}</span>
                    <span>GSTIN ${esc(d.outlet.gstin)}</span>
                </div>
                <div class="demo-receipt__body">
                    <div class="demo-row-between"><span>Margherita × 1</span><b>${money(299)}</b></div>
                    <div class="demo-row-between"><span>Garlic Bread × 1</span><b>${money(149)}</b></div>
                    <div class="demo-row-between"><span>CGST 2.5%</span><b>${money(11.2)}</b></div>
                    <div class="demo-row-between"><span>SGST 2.5%</span><b>${money(11.2)}</b></div>
                    <div class="demo-row-between demo-receipt__total"><span>Total</span><b>${money(470.4)}</b></div>
                </div>
                <div class="demo-receipt__foot">Demo receipt preview — not a tax invoice</div>
            </div>
            ${noteBar('The live receipt template is printed through the outlet print bridge. Preview only here.', 'info')}`,
        'staff-management': () => renderStaffSection(d, ctx),
        'security-audit': () => renderSecuritySection(d),
        integrations: () => renderIntegrationsSection(d),
    };

    root.innerHTML = `
        ${noteBar('<b>Settings are preview-only in Demo Mode.</b> Every field below shows representative sample values; saving any of them is blocked with an explanation.', 'warn', 'shield-alert')}
        ${panel('Store & delivery settings', `
            <div class="settings-subtabs demo-settings-subtabs" role="tablist">
                ${SETTINGS_SECTIONS.map(x => `<button type="button" role="tab" class="settings-subtab${x.id === settingsUi.section ? ' active' : ''}" aria-selected="${x.id === settingsUi.section}" data-settings-tab="${x.id}">${esc(x.label)}</button>`).join('')}
            </div>
            <div class="demo-settings-body mt-20">${(sectionBody[settingsUi.section] || sectionBody.general)()}</div>
            <div class="demo-settings-foot">
                ${restrictedBtn('Save settings', 'Saving store settings writes to the live outlet configuration', { cls: 'btn-primary', small: false })}
                ${restrictedBtn('Reset to defaults', 'Resetting settings changes the live outlet configuration')}
            </div>`, `<span class="demo-sim-tag"><i data-lucide="flask-conical" class="icon-14"></i> Read-only preview</span>`, { icon: 'settings' })}`;

    root.querySelectorAll('[data-settings-tab]').forEach(b => b.addEventListener('click', () => {
        settingsUi.section = b.getAttribute('data-settings-tab');
        ctx.rerender();
    }));
    root.querySelectorAll('[data-sm-page]').forEach(b => b.addEventListener('click', () => {
        settingsUi.staffPage = b.getAttribute('data-sm-page');
        ctx.rerender();
    }));
    root.querySelector('#staffSearch')?.addEventListener('input', (e) => {
        staffUi.q = e.target.value;
        ctx.rerender({ keepFocus: '#staffSearch' });
    });
    root.querySelectorAll('[data-staff-view]').forEach(b => b.addEventListener('click', () => {
        const st = store.getData().staff.find(x => x.uid === b.getAttribute('data-staff-view'));
        if (!st) return;
        const body = `<div class="demo-stack">
            <div class="demo-kv">
                <span>Role</span><b>${esc((store.getData().roles[st.role] || {}).name || st.role)}</b>
                <span>Status</span><b>${badge(st.status)}</b>
                <span>Email</span><b>${esc(st.email)}</b>
                <span>Pay type</span><b>${esc(st.payType)} · ${st.payType === 'MONTHLY' ? money(st.rate) + '/month' : money(st.rate) + '/hour'}</b>
                <span>Last sign-in</span><b>${esc(st.lastSignIn)}</b>
            </div>
            ${noteBar('Passwords, PIN hashes and invitation tokens are never included in the demo dataset.', 'warn', 'shield-alert')}
        </div>`;
        document.body.insertAdjacentHTML('beforeend', drawerShell('demoStaffDrawer', st.displayName, body,
            restrictedBtn('Edit staff member', 'Staff changes write to the live authentication account') +
            restrictedBtn('Reset password', 'Password resets affect the live account') +
            restrictedBtn('Disable account', 'Disabling an account affects real staff sign-in')));
        const drawer = document.getElementById('demoStaffDrawer');
        drawer.classList.add('is-open');
        drawer.addEventListener('click', (e) => { if (e.target.closest('[data-drawer-close]')) { drawer.remove(); } });
        if (window.lucide) window.lucide.createIcons({ root: drawer });
    }));
}

// ------------------------------------------------------- Staff management block

const staffUi = { q: '' };

function renderStaffSection(d, ctx) {
    const page = settingsUi.staffPage;
    const q = staffUi.q.trim().toLowerCase();
    const staff = d.staff.filter(s => !q || `${s.displayName} ${s.email} ${s.role}`.toLowerCase().includes(q));
    const todayKey = Object.keys(d.attendance).sort().pop();
    const today = d.attendance[todayKey] || {};

    const tabsHtml = `<div class="sm-subtabs" role="tablist">
        ${[['staff', 'Staff'], ['roles', 'Roles & Access'], ['attendance', 'Attendance'], ['shifts', 'Shifts'], ['leave', 'Leave'], ['payroll', 'Payroll']]
            .map(([id, label]) => `<button type="button" role="tab" class="sm-subtab${page === id ? ' active' : ''}" aria-selected="${page === id}" data-sm-page="${id}">${esc(label)}</button>`).join('')}
    </div>`;

    let body = '';

    if (page === 'staff') {
        const roleName = (key) => (d.roles[key] || {}).name || key;
        body = `
            <div class="demo-toolbar">
                ${searchBar('staffSearch', 'Search staff…', staffUi.q)}
                <span class="demo-spacer"></span>
                ${restrictedBtn('Invite staff', 'Invitations create real authentication accounts', { cls: 'btn-primary' })}
                ${restrictedBtn('Bulk import', 'Imports create real accounts')}
            </div>
            ${table({
            columns: ['Member', 'Role', 'Pay', 'Status', 'Last sign-in', 'Actions'],
            rows: staff.map(s => [
                `<b>${esc(s.displayName)}</b><br><span class="text-muted-small">${esc(s.email)}</span>`,
                badge(roleName(s.role), s.role === 'owner' ? 'warn' : 'info'),
                `${esc(s.payType)}<br><span class="text-muted-small">${s.payType === 'MONTHLY' ? money(s.rate) + '/mo' : money(s.rate) + '/hr'}</span>`,
                badge(s.status),
                `<span class="text-muted-small">${esc(s.lastSignIn)}</span>`,
                `<button type="button" class="btn-text-primary-sm" data-staff-view="${esc(s.uid)}">View</button>`,
            ]),
            empty: 'No staff match this search.',
        })}`;
    } else if (page === 'roles') {
        body = `
            ${noteBar('Roles decide which tabs a member can open. The checkboxes below are a preview; changing them is restricted.', 'info')}
            <div class="demo-role-matrix">
                ${Object.entries(d.roles).map(([key, r]) => `<article class="demo-role-card">
                    <div class="demo-row-between"><h4>${esc(r.name)}</h4>${badge(`level ${r.level}`, r.level >= 2 ? 'warn' : r.level >= 1 ? 'info' : 'muted')}</div>
                    <p class="text-muted-small">${r.tabs.includes('*') ? 'Access to every tab' : `${r.tabs.length} tab(s) allowed`}</p>
                    <div class="demo-role-card__tabs">
                        ${(r.tabs.includes('*') ? ['all tabs'] : r.tabs).map(t => `<span class="demo-badge" data-tone="muted">${esc(t)}</span>`).join('')}
                    </div>
                    <div class="mt-14">${restrictedBtn('Edit permissions', 'Permission changes alter live access control')}</div>
                </article>`).join('')}
            </div>`;
    } else if (page === 'attendance') {
        const keys = Object.keys(d.attendance).sort().reverse();
        body = `
            ${table({
            columns: ['Date', ...d.staff.map(s => s.displayName.split(' ')[0])],
            rows: keys.map(k => [esc(k), ...d.staff.map(s => {
                const a = d.attendance[k][s.uid];
                return a ? `<b>${Math.floor(a.minutes / 60)}h ${a.minutes % 60}m</b><br><span class="text-muted-small">in ${esc(a.inAt || '—')}</span>` : '<span class="text-muted-small">—</span>';
            })]),
        })}
            <p class="text-muted-small mt-14">Attendance is synthetic, shaped like <code>attendance/{{date}}/{{uid}}</code> in the live database.</p>
            <div class="mt-14">${restrictedBtn('Export attendance', 'Exports read the live attendance records')}</div>`;
    } else if (page === 'shifts') {
        const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        body = `
            ${table({
            columns: ['Member', ...days],
            rows: d.staff.map(s => [
                `<b>${esc(s.displayName)}</b>`,
                ...days.map(day => {
                    const list = d.shifts.filter(x => x.uid === s.uid && x.day === day);
                    return list.length
                        ? list.map(x => `<span class="demo-shift">${esc(x.start)}–${esc(x.end)}</span>`).join(' ')
                        : '<span class="text-muted-small">—</span>';
                }),
            ]),
        })}
            <div class="mt-14">${restrictedBtn('Add shift', 'Shift changes apply to the live roster')}</div>`;
    } else if (page === 'leave') {
        body = `
            ${table({
            columns: ['Member', 'From', 'To', 'Reason', 'Status', 'Actions'],
            rows: d.leave.map(l => [
                `<b>${esc((d.staff.find(s => s.uid === l.uid) || {}).displayName || l.uid)}</b>`,
                esc(l.from), esc(l.to), esc(l.reason), badge(l.status),
                l.status === 'Pending' ? restrictedBtn('Approve / Reject', 'Leave decisions update real payroll') : '<span class="text-muted-small">—</span>',
            ]),
            empty: 'No leave requests in demo data.',
        })}`;
    } else {
        // Payroll — computed with the real shared/payroll-math.js
        const now = new Date(d.now);
        const pad = (n) => String(n).padStart(2, '0');
        const periodEnd = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
        const periodStart = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
        const minutesByUid = {};
        for (const [date, rows] of Object.entries(d.attendance)) {
            if (date < periodStart || date > periodEnd) continue;
            for (const [uid, a] of Object.entries(rows)) {
                minutesByUid[uid] = (minutesByUid[uid] || 0) + (Number(a.minutes) || 0);
            }
        }
        const eligible = d.staff.filter(s => s.status !== 'Invited' && s.payType && Number(s.rate) > 0)
            .map(s => ({ uid: s.uid, payType: s.payType, rate: Number(s.rate) }));
        const lines = computePayroll({ periodStart, periodEnd, tipPool: 0, staff: eligible, minutesByUid });
        const nameOf = (uid) => (d.staff.find(s => s.uid === uid) || {}).displayName || uid;
        const net = lines.reduce((sum, l) => sum + l.netPay, 0);
        const hours = Math.round(Object.values(minutesByUid).reduce((a, b) => a + b, 0) / 60);
        const monthShort = now.toLocaleDateString('en-IN', { month: 'short' });
        const periodLabel = `${now.getDate()} ${monthShort} MTD`;

        body = `
            ${kpiStrip([
            { value: money(net), label: 'Payroll (MTD, demo)', delta: `${lines.length} staff`, primary: true },
            { value: periodLabel, label: 'Period', delta: `${periodStart} → ${periodEnd}` },
            { value: money(0), label: 'Tip Pool', delta: 'set in the live run' },
            { value: `${hours} h`, label: 'Hours Logged', delta: 'from demo attendance' },
        ])}
            ${table({
            columns: ['Member', 'Pay type', 'Hours', 'Base pay', 'Tips', 'Unpaid leave', 'Net pay'],
            rows: lines.map(l => [
                `<b>${esc(nameOf(l.userId))}</b>`,
                esc(l.payType),
                num(Math.round(l.hoursWorked)),
                money(l.basePay),
                money(l.tipShare),
                l.unpaidLeaveDeduction ? `− ${money(l.unpaidLeaveDeduction)}` : '—',
                `<b>${money(l.netPay)}</b>`,
            ]),
        })}
            <p class="text-muted-small mt-14">Computed by the real <code>shared/payroll-math.js</code> (MONTHLY proration + unpaid-leave deduction, HOURLY from clocked minutes).</p>
            <div class="mt-14 demo-row-gap">
                ${restrictedBtn('Close payroll run', 'Closing a run snapshots immutable payroll records', { cls: 'btn-primary' })}
                ${restrictedBtn('Download payslips', 'Payslips are generated from live payroll records')}
            </div>`;
    }

    return `${tabsHtml}<div class="mt-20">${body}</div>`;
}

// --------------------------------------------------------------- Bot section

function renderBotSection(d) {
    const b = d.bot;
    return `
        <div class="demo-row-between mb-16">
            <div class="demo-row-gap">
                ${badge(b.status === 'online' ? 'Online' : 'Offline', b.status === 'online' ? 'ok' : 'bad')}
                <span class="text-muted-small">${esc(b.pairedNumber)} · transport ${esc(b.transport)}</span>
            </div>
            <div class="demo-row-gap">
                ${restrictedBtn('Restart bot', 'Restarting a bot process affects the live WhatsApp session', { cls: 'btn-primary' })}
                ${restrictedBtn('Stop bot', 'Stopping the bot halts live customer messaging')}
                ${restrictedBtn('Re-scan QR', 'Pairing a device connects a real WhatsApp account')}
            </div>
        </div>
        ${simulatedTag('Bot status, wallet and templates are snapshot values')}
        <div class="demo-form-grid mt-16">
            ${field('Last seen', input('botSeen', b.lastSeen, { attrs: 'readonly' }))}
            ${field('Uptime', input('botUptime', b.uptime, { attrs: 'readonly' }))}
            ${field('Promo tokens', input('botWallet', String(b.wallet.balance), { attrs: 'readonly' }), 'Not spendable in the demo')}
            ${field('Tokens used this month', input('botUsed', String(b.wallet.usedThisMonth), { attrs: 'readonly' }))}
        </div>
        <h4 class="mt-20 mb-8">Approved templates (snapshot)</h4>
        ${table({
        columns: ['Template', 'Category', 'Status', 'Params'],
        rows: b.templates.map(t => [`<b>${esc(t.name)}</b>`, esc(t.category), badge(t.status, t.status === 'Approved' ? 'ok' : t.status === 'Rejected (plain text)' ? 'bad' : 'warn'), String(t.params)]),
    })}
        <h4 class="mt-20 mb-8">Conversation flow</h4>
        <div class="demo-flow">${b.flows.map((f, i) => `<span class="demo-flow__step">${esc(f)}</span>${i < b.flows.length - 1 ? '<i data-lucide="chevron-right" class="icon-14"></i>' : ''}`).join('')}</div>
        <h4 class="mt-20 mb-8">Recent messages (demo)</h4>
        ${table({
        columns: ['Time', 'Direction', 'Message', 'Status'],
        rows: b.messageLog.map(m => [`<span class="text-muted-small">${esc(m.at)}</span>`, badge(m.dir === 'in' ? 'Inbound' : 'Outbound', m.dir === 'in' ? 'info' : 'ok'), esc(m.text), badge(m.status, 'muted')]),
    })}
        <div class="mt-16">${restrictedBtn('Open live message log', 'Live logs contain real customer conversations')}</div>
        ${noteBar('Promotional messaging is hard-blocked on the Baileys transport in the live bot, and completely unavailable here. No WhatsApp API is contacted by the demo.', 'warn')}`;
}

// ------------------------------------------------------------ Security section

function renderSecuritySection(d) {
    const sec = d.security;
    return `
        <div class="dashboard-grid">
            <div class="dashboard-main">
                ${panel('Audit log (demo)', table({
        columns: ['When', 'Actor', 'Action', 'Detail'],
        rows: d.auditLog.map(a => [esc(a.at), esc(a.actor), `<code>${esc(a.action)}</code>`, esc(a.detail)]),
    }), restrictedBtn('Export audit log', 'Audit exports read live security records'), { icon: 'scroll-text' })}
            </div>
            <div class="dashboard-sidebar">
                ${panel('Account security', `
                    <div class="demo-kv">
                        <span>Password login</span><b>${badge(sec.passwordLogin, 'ok')}</b>
                        <span>Two-factor</span><b>${esc(sec.twoFactor)}</b>
                        <span>Last password change</span><b>${esc(sec.lastPasswordChange)}</b>
                    </div>
                    <h4 class="mt-16 mb-8">Active sessions</h4>
                    <div class="demo-list">${sec.sessions.map(s => `
                        <div class="demo-list__row">
                            <div class="demo-list__main"><b>${esc(s.device)}</b><span class="text-muted-small">${esc(s.location)} · ${esc(s.last)}</span></div>
                            <div class="demo-list__value">${s.current ? badge('This device', 'ok') : ''}</div>
                        </div>`).join('')}</div>
                    <div class="mt-16 demo-row-gap">
                        ${restrictedBtn('Change password', 'Credentials are never handled in the demo', { cls: 'btn-primary' })}
                        ${restrictedBtn('Enable 2FA', 'Two-factor enrolment belongs to the live account')}
                        ${restrictedBtn('Revoke sessions', 'Revoking sessions affects real administrators')}
                    </div>`, '', { icon: 'shield' })}
                ${panel('API credentials (masked)', `
                    <div class="demo-list">${sec.apiKeys.map(k => `
                        <div class="demo-list__row">
                            <div class="demo-list__main"><b>${esc(k.label)}</b><span class="text-muted-small">created ${esc(k.created)}</span></div>
                            <div class="demo-list__value"><code>${esc(k.masked)}</code></div>
                        </div>`).join('')}</div>
                    ${noteBar('Secrets are masked in the demo and are never part of the demo bundle, fixtures or browser storage. Rotating or revealing a key is impossible without a live authenticated session.', 'warn', 'shield-alert')}
                    ${restrictedBtn('Rotate key', 'Key rotation invalidates live integrations')}`, '', { icon: 'key-round' })}
            </div>
        </div>`;
}

// --------------------------------------------------------- Integrations block

function renderIntegrationsSection(d) {
    const rows = Object.entries(d.integrations).map(([key, v]) => [
        `<b>${esc(key.replace(/^./, c => c.toUpperCase()))}</b>`,
        esc(v.provider || '—'),
        badge(v.connected ? 'Connected' : 'Not connected', v.connected ? 'ok' : 'muted'),
        v.webhook ? `<code>${esc(v.webhook)}</code>` : (v.keyId ? `<code>${esc(v.keyId)}</code>` : '<span class="text-muted-small">—</span>'),
    ]);
    return `
        ${table({ columns: ['Integration', 'Provider', 'State', 'Credential (masked)'], rows })}
        ${noteBar('Provider names are illustrative. All credentials are masked placeholders — the demo holds no API keys, tokens or connection strings.', 'warn', 'shield-alert')}
        <div class="mt-16 demo-row-gap">
            ${restrictedBtn('Connect integration', 'Connecting an integration writes live credentials', { cls: 'btn-primary' })}
            ${restrictedBtn('Edit webhook', 'Webhook changes affect live message routing')}
            ${restrictedBtn('Test connection', 'Test calls reach real third-party services')}
        </div>`;
}

// ------------------------------------------------- Supreme Admin preview page

export function renderPlatform(root, ctx) {
    const d = store.getData();
    const tenants = [
        { name: 'Bella Napoli (demo)', plan: 'Growth', state: 'Active', usage: 1842, admin: 'ramesh.iyer@demo.example' },
        { name: 'Sample Bakery (demo)', plan: 'Starter', state: 'Active', usage: 640, admin: 'baker@demo.example' },
        { name: 'Demo Kitchen (demo)', plan: 'Trial', state: 'Disabled', usage: 0, admin: 'kitchen@demo.example' },
    ];

    root.innerHTML = `
        ${noteBar('This is a preview of the <b>Supreme Admin</b> platform console. It exists only in the demo so visitors can see the multi-tenant view — the real console lives on a separate hosting target and requires Supreme credentials.', 'warn', 'crown')}
        ${kpiStrip([
        { value: num(tenants.length), label: 'Restaurants', delta: `${tenants.filter(t => t.state === 'Active').length} active`, primary: true },
        { value: money(tenants.reduce((s, t) => s + t.usage, 0)), label: 'Platform Usage', delta: 'demo billing ledger' },
        { value: num(1), label: 'Trial Accounts', delta: 'demo pipeline' },
        { value: money(d.billing.setup.amount), label: 'Setup Fees', delta: `${d.billing.setup.date}` },
    ])}
        <div class="dashboard-grid">
            <div class="dashboard-main">
                ${panel('Tenants', table({
        columns: ['Restaurant', 'Plan', 'Plan state', 'Admin', 'Usage'],
        rows: tenants.map(t => [
            `<b>${esc(t.name)}</b>`,
            esc(t.plan),
            badge(t.state, t.state === 'Active' ? 'ok' : 'bad'),
            `<span class="text-muted-small">${esc(t.admin)}</span>`,
            money(t.usage),
        ]),
    }), restrictedBtn('Onboard restaurant', 'Creating a tenant provisions a real business, admin and bot'), { icon: 'building-2' })}
                ${panel('Payment records', table({
        columns: ['Date', 'Record', 'Amount', 'Method'],
        rows: [...d.billing.payments.map(p => [esc(p.date), esc(p.note), money(p.amount), esc(p.method)]),
        ...d.billing.charges.map(c => [esc(c.date), esc(c.note), money(c.amount), '—'])],
    }), restrictedBtn('Record payment', 'Payment records move real money'), { icon: 'receipt' })}
            </div>
            <div class="dashboard-sidebar">
                ${panel('Platform controls', `
                    <p class="text-muted-small mb-14">Tenant lifecycle, bot provisioning, billing and impersonation all require a real Supreme Admin session.</p>
                    ${restrictedBtn('Provision bot', 'Provisioning starts a real WhatsApp worker', { cls: 'btn-primary' })}
                    ${restrictedBtn('Disable tenant', 'Disabling a tenant blocks real ordering')}
                    ${restrictedBtn('Impersonate admin', 'Impersonation grants real tenant access')}
                    ${restrictedBtn('Deploy / rollback', 'Deployment affects the production servers')}
                    ${restrictedBtn('Open a tenant', 'Cross-tenant access is never available in the demo')}`, '', { icon: 'shield-alert' })}
                ${panel('Demo boundary', `
                    <div class="demo-kv">
                        <span>Tenant selection</span><b>Fixed: Bella Napoli (demo)</b>
                        <span>URL parameters</span><b>Ignored — no tenant override</b>
                        <span>Auth session</span><b>None (no Firebase SDK)</b>
                        <span>Data writes</span><b>In-memory only</b>
                    </div>`, '', { icon: 'lock' })}
            </div>
        </div>
        ${noteBar('There is no route, parameter or storage key that lets the demo point at a real business id. The demo page never initialises Firebase, so it has no credential to use even if one were guessed.', 'info')}`;
}
