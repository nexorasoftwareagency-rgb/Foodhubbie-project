// ============================================================================
// LOYALTY DASHBOARD — VIEW LAYER (pure: no Firebase, no DOM, runnable in node)
//
// Everything the Loyalty tab shows is built here as plain strings from plain
// data, so it can be unit-tested (tests/loyalty-dashboard.check.mjs) and so
// loyalty.js only has to fetch, save and wire events.
//
// The earn / tender arithmetic is NOT re-implemented here. The caller passes
// the real functions from shared/loyalty-math.js (`calc`), so the "example
// bill" always shows exactly what the bot will award.
// ============================================================================

export const TIER_KEYS = ['bronze', 'silver', 'gold'];
export const TIER_LABEL = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold' };

export const DEFAULTS = {
    earnRatePaisePerPoint: 5000,
    expiryDays: 180,
    redeemValuePaisePerPoint: 100,
    minSpendAfterRedemption: 0,
    maxRedeemPercentOfOrder: 0,
    earnEnabled: true,
    dineInEarnEnabled: true,
    clawbackEnabled: true,
    tiers: {
        bronze: { min: 0, label: 'Bronze', multiplier: 1 },
        silver: { min: 1000, label: 'Silver', multiplier: 1.25 },
        gold: { min: 5000, label: 'Gold', multiplier: 1.5 }
    },
    rewards: [
        { id: 'free-samosa', label: 'Free Samosa', cost: 200, type: 'item' },
        { id: '10pct-off', label: '10% Off Next Order', cost: 500, type: 'discount' },
        { id: 'free-dessert', label: 'Free Dessert', cost: 800, type: 'item' }
    ]
};

// ------------------------------------------------------------------ helpers

export function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;').replace(/`/g, '&#96;');
}

export function num(n) {
    const v = Number(n);
    return Number.isFinite(v) ? v.toLocaleString('en-IN') : '0';
}

export function money(n) {
    const v = Number(n || 0);
    if (!Number.isFinite(v)) return '₹0';
    return '₹' + (v % 1 === 0 ? v.toLocaleString('en-IN') : v.toLocaleString('en-IN', { maximumFractionDigits: 2 }));
}

export function fmtPhone(p) {
    const d = String(p || '').replace(/\D/g, '').slice(-10);
    return d.length === 10 ? `${d.slice(0, 5)} ${d.slice(5)}` : String(p || '');
}

export function fmtDate(ts) {
    if (!ts) return '—';
    const d = new Date(Number(ts));
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit', timeZone: 'Asia/Kolkata' })
        + ', ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}

function trimNum(x) {
    const v = Number(x);
    if (!Number.isFinite(v)) return '';
    return String(+v.toFixed(2));
}

export function tierLabel(t, config) {
    const fromCfg = config && config.tiers && config.tiers[t] && config.tiers[t].label;
    return fromCfg || TIER_LABEL[t] || String(t || '');
}

export function tierForPoints(pts, config) {
    const tiers = (config && config.tiers) || DEFAULTS.tiers;
    let t = 'bronze';
    for (const k of TIER_KEYS) {
        const td = tiers[k];
        if (td && typeof td.min === 'number' && pts >= td.min) t = k;
    }
    return t;
}

// Next tier above the customer's lifetime points, with % progress through the
// current band. Returns null at the top tier.
export function nextTier(pts, config) {
    const tiers = (config && config.tiers) || DEFAULTS.tiers;
    const cur = tierForPoints(pts, config);
    const curMin = (tiers[cur] && tiers[cur].min) || 0;
    for (const k of TIER_KEYS) {
        const td = tiers[k];
        if (td && typeof td.min === 'number' && td.min > curMin) {
            const range = td.min - curMin;
            return {
                key: k, label: tierLabel(k, config), min: td.min, multiplier: td.multiplier,
                remaining: Math.max(0, td.min - pts),
                percent: range > 0 ? Math.max(0, Math.min(100, Math.floor(((pts - curMin) / range) * 100))) : 100
            };
        }
    }
    return null;
}

// ------------------------------------------------------------------- config

export function cloneConfig(c) {
    if (!c) return JSON.parse(JSON.stringify(DEFAULTS));
    const tiers = {};
    for (const k of TIER_KEYS) tiers[k] = { ...DEFAULTS.tiers[k], ...((c.tiers && c.tiers[k]) || {}) };
    return {
        earnRatePaisePerPoint: Number(c.earnRatePaisePerPoint) || DEFAULTS.earnRatePaisePerPoint,
        redeemValuePaisePerPoint: (Number.isFinite(Number(c.redeemValuePaisePerPoint)) && Number(c.redeemValuePaisePerPoint) > 0)
            ? Number(c.redeemValuePaisePerPoint) : DEFAULTS.redeemValuePaisePerPoint,
        minSpendAfterRedemption: Number(c.minSpendAfterRedemption) || 0,
        maxRedeemPercentOfOrder: Math.max(0, Math.min(100, Number(c.maxRedeemPercentOfOrder) || 0)),
        expiryDays: c.expiryDays != null && Number.isFinite(Number(c.expiryDays))
            ? Math.max(0, Math.round(Number(c.expiryDays))) : DEFAULTS.expiryDays,
        earnEnabled: c.earnEnabled !== false,
        dineInEarnEnabled: c.dineInEarnEnabled !== false,
        clawbackEnabled: c.clawbackEnabled !== false,
        tiers,
        rewards: Array.isArray(c.rewards) ? c.rewards.map(r => ({ ...r })) : DEFAULTS.rewards.map(r => ({ ...r }))
    };
}

// The object written to loyalty/config. Same fields and shape as before the
// redesign — only the screen that produces them changed.
export function buildPayload(config, overrides = {}) {
    const c = cloneConfig(config);
    return { ...c, ...overrides };
}

// Config -> the strings shown in the Rules form.
export function formFromConfig(config) {
    const c = cloneConfig(config);
    return {
        earnRs: trimNum(c.earnRatePaisePerPoint / 100),
        redeemRs: trimNum(c.redeemValuePaisePerPoint / 100),
        minSpend: trimNum(c.minSpendAfterRedemption),
        maxPct: trimNum(c.maxRedeemPercentOfOrder),
        expiry: trimNum(c.expiryDays),
        earnOn: c.earnEnabled,
        dineOn: c.dineInEarnEnabled,
        clawOn: c.clawbackEnabled,
        silverMin: trimNum(c.tiers.silver.min),
        goldMin: trimNum(c.tiers.gold.min),
        bronzeMult: trimNum(c.tiers.bronze.multiplier),
        silverMult: trimNum(c.tiers.silver.multiplier),
        goldMult: trimNum(c.tiers.gold.multiplier)
    };
}

const toNum = (s) => (s === '' || s === null || s === undefined) ? NaN : Number(s);

// Rules form -> config fields, or a list of problems to show the owner.
export function validateForm(v, baseConfig) {
    const errors = [];
    const bad = (id, msg) => errors.push({ id, msg });
    const earnRs = toNum(v.earnRs);
    if (!Number.isFinite(earnRs) || earnRs <= 0) bad('loyalty-earn-rate', 'Enter how many rupees a customer spends to earn 1 point.');
    const redeemRs = toNum(v.redeemRs);
    if (!Number.isFinite(redeemRs) || redeemRs <= 0) bad('loyalty-redeem-value', 'Enter what 1 point is worth at checkout, in rupees.');
    const minSpend = v.minSpend === '' ? 0 : toNum(v.minSpend);
    if (!Number.isFinite(minSpend) || minSpend < 0) bad('loyalty-min-spend', 'Minimum spend cannot be negative. Use 0 for no minimum.');
    const maxPct = v.maxPct === '' ? 0 : toNum(v.maxPct);
    if (!Number.isFinite(maxPct) || maxPct < 0 || maxPct > 100) bad('loyalty-max-redeem-pct', 'Enter a percentage from 0 to 100. Use 0 for no cap.');
    const expiry = toNum(v.expiry);
    if (!Number.isFinite(expiry) || expiry < 0) bad('loyalty-expiry-days', 'Enter a number of days. Use 0 if points should never expire.');
    const silverMin = toNum(v.silverMin);
    const goldMin = toNum(v.goldMin);
    if (!Number.isFinite(silverMin) || silverMin <= 0) bad('loyalty-tier-silver-min', 'Silver must start above 0 points.');
    if (!Number.isFinite(goldMin) || goldMin <= 0) bad('loyalty-tier-gold-min', 'Gold must start above 0 points.');
    if (Number.isFinite(silverMin) && Number.isFinite(goldMin) && goldMin <= silverMin) bad('loyalty-tier-gold-min', 'Gold must start at more points than Silver.');
    const mults = {};
    for (const k of TIER_KEYS) {
        const m = toNum(v[k + 'Mult']);
        if (!Number.isFinite(m) || m <= 0) bad(`loyalty-tier-${k}-mult`, `Enter how many times more ${TIER_LABEL[k]} members earn (1 = the normal rate).`);
        mults[k] = m;
    }
    if (errors.length) return { ok: false, errors };
    const base = cloneConfig(baseConfig);
    const label = (k) => (base.tiers[k] && base.tiers[k].label) || TIER_LABEL[k];
    return {
        ok: true,
        errors: [],
        fields: {
            earnRatePaisePerPoint: Math.round(earnRs * 100),
            redeemValuePaisePerPoint: Math.round(redeemRs * 100),
            minSpendAfterRedemption: minSpend,
            maxRedeemPercentOfOrder: maxPct,
            expiryDays: Math.round(expiry),
            earnEnabled: !!v.earnOn,
            dineInEarnEnabled: !!v.dineOn,
            clawbackEnabled: !!v.clawOn,
            tiers: {
                bronze: { min: 0, label: label('bronze'), multiplier: mults.bronze },
                silver: { min: silverMin, label: label('silver'), multiplier: mults.silver },
                gold: { min: goldMin, label: label('gold'), multiplier: mults.gold }
            }
        }
    };
}

export function sameForm(a, b) {
    if (!a || !b) return false;
    return Object.keys(a).every(k => a[k] === b[k]) && Object.keys(b).every(k => a[k] === b[k]);
}

// ------------------------------------------------- "% back" and quick picks

// How much of the bill a normal-rate (x1) member gets back, in %, from the
// form's current earn and redeem numbers. null if either is not a number.
export function backPct(v) {
    const earn = toNum(v.earnRs), redeem = toNum(v.redeemRs);
    if (!(earn > 0) || !(redeem > 0)) return null;
    return (redeem / earn) * 100;
}

// Spend-per-point (rupees) that gives `pct` % back at the current point value.
export function earnForBackPct(pct, redeemRs) {
    const r = Number(redeemRs), p = Number(pct);
    if (!(r > 0) || !(p > 0)) return null;
    return Math.round(((r * 100) / p) * 100) / 100;
}

export const QUICK_PICKS = [1, 2, 4];

// ------------------------------------------------------------------ health

// Plain-language "is this program set up sensibly?" list for the Overview.
// level 'ok' = nothing to do, 'attention' = worth a look. Never blocks anything.
export function healthChecks({ config, configured, stats }) {
    const c = config || cloneConfig(null);
    const out = [];
    out.push(c.earnEnabled !== false
        ? { id: 'earning', level: 'ok', title: 'Earning is on', detail: 'Customers get points on new orders.' }
        : { id: 'earning', level: 'attention', title: 'Earning is paused', detail: 'Nobody gets new points until you turn it back on.', action: 'loyalty-toggle-earning', actionLabel: 'Turn on' });
    out.push(configured === false
        ? { id: 'saved', level: 'attention', title: 'You are on the standard rules', detail: 'They work, but they are not saved as yours yet.', action: 'loyalty-view', view: 'rules', actionLabel: 'Review rules' }
        : { id: 'saved', level: 'ok', title: 'Your rules are saved', detail: `Spend ${money(c.earnRatePaisePerPoint / 100)} to earn 1 point; each point is worth ${money(c.redeemValuePaisePerPoint / 100)}.` });
    const rewards = c.rewards || [];
    if (!rewards.length) {
        out.push({ id: 'rewards', level: 'attention', title: 'No rewards to spend points on', detail: 'Points feel pointless without something to get.', action: 'loyalty-view', view: 'rewards', actionLabel: 'Add a reward' });
    } else {
        const cheapest = rewards.reduce((a, r) => (Number(r.cost) < Number(a.cost) ? r : a), rewards[0]);
        const spendRs = Math.round((Number(cheapest.cost) || 0) * (c.earnRatePaisePerPoint / 100));
        out.push({ id: 'rewards', level: 'ok', title: `${num(rewards.length)} ${rewards.length === 1 ? 'reward' : 'rewards'} on offer`, detail: `The cheapest, ${cheapest.label || 'a reward'}, takes ${num(cheapest.cost)} points, about ${money(spendRs)} of spending.` });
    }
    out.push(c.expiryDays > 0
        ? { id: 'expiry', level: 'ok', title: 'Points expire', detail: `After ${num(c.expiryDays)} days without an order.` }
        : { id: 'expiry', level: 'attention', title: 'Points never expire', detail: 'Unused points pile up and stay owed to customers forever.', action: 'loyalty-view', view: 'rules', actionLabel: 'Set expiry' });
    out.push(c.maxRedeemPercentOfOrder > 0
        ? { id: 'cap', level: 'ok', title: 'Points pay part of a bill', detail: `At most ${trimNum(c.maxRedeemPercentOfOrder)}% of one bill.` }
        : { id: 'cap', level: 'attention', title: 'Points can pay a whole bill', detail: 'A customer with enough points could pay nothing. Set a limit if that worries you.', action: 'loyalty-view', view: 'rules', actionLabel: 'Set a limit' });
    if (stats && stats.members === 0) {
        out.push({ id: 'members', level: 'attention', title: 'No one has earned points yet', detail: 'Points are added when a customer\u2019s order is paid.' });
    }
    return out;
}

// -------------------------------------------------------------- the example

// What a bill of `billRs` earns and is worth at each tier, using the form's
// current (possibly unsaved) numbers. `calc` = { computeEarnPoints,
// computeTenderPaise } from shared/loyalty-math.js.
export function buildExample(v, billRs, calc) {
    const earnRs = toNum(v.earnRs), redeemRs = toNum(v.redeemRs);
    const bill = Number(billRs);
    if (!(earnRs > 0) || !(redeemRs > 0) || !(bill >= 0) || !calc) return { ok: false };
    const ratePaise = Math.round(earnRs * 100);
    const redeemPaise = Math.round(redeemRs * 100);
    const tiers = TIER_KEYS.map(k => {
        const m = toNum(v[k + 'Mult']);
        const mult = m > 0 ? m : 1;
        const points = calc.computeEarnPoints(bill, ratePaise, mult);
        const worthRs = (points * redeemPaise) / 100;
        return { key: k, points, worthRs, backPct: bill > 0 ? (worthRs / bill) * 100 : 0 };
    });
    const minSpend = v.minSpend === '' ? 0 : toNum(v.minSpend);
    const maxPct = v.maxPct === '' ? 0 : toNum(v.maxPct);
    const tenderPaise = calc.computeTenderPaise({
        points: 1e9,
        redeemValuePaisePerPoint: redeemPaise,
        totalDuePaise: Math.round(bill * 100),
        minSpendAfterRedemptionPaise: Math.round((Number.isFinite(minSpend) ? minSpend : 0) * 100),
        subtotalPaise: Math.round(bill * 100),
        maxRedeemPercentOfOrder: Number.isFinite(maxPct) ? maxPct : 0
    });
    const expiry = toNum(v.expiry);
    return {
        ok: true, bill, tiers,
        maxPayWithPointsRs: tenderPaise / 100,
        capped: tenderPaise < Math.round(bill * 100),
        expiryDays: Number.isFinite(expiry) ? expiry : null,
        earnOn: !!v.earnOn
    };
}

// ------------------------------------------------------------------- stats

// First usable name from the places the apps store it, else ''.
export function pickName(...candidates) {
    for (const c of candidates) {
        const t = typeof c === 'string' ? c.trim() : '';
        if (t) return t.slice(0, 40);
    }
    return '';
}

// Points outstanding = what members could spend today (the `points` balance
// on each customers/{phone}/loyalty row, NOT lifetime points). Pure so it can
// be tested; the controller feeds it the rows it fetched.
export function tallyOutstanding(rows, config, meta = {}) {
    const list = (Array.isArray(rows) ? rows : []).filter(r => r && typeof r === 'object');
    let points = 0, holders = 0;
    for (const r of list) {
        const p = Math.max(0, Number(r.points) || 0);
        points += p;
        if (p > 0) holders++;
    }
    const valuePaise = (config && config.redeemValuePaisePerPoint) || DEFAULTS.redeemValuePaisePerPoint;
    return {
        points, holders, counted: list.length,
        valueRs: Math.round((points * valuePaise) / 100),
        failed: Number(meta.failed) || 0,
        total: Number(meta.total) || list.length,
        at: meta.at || null
    };
}

// Roll the loyalty/rankings rows up into what the Overview needs.
export function summarize(rows, config) {
    const list = (Array.isArray(rows) ? rows : []).filter(r => r && typeof r === 'object');
    const counts = { bronze: 0, silver: 0, gold: 0 };
    let lifetime = 0, spent = 0;
    for (const r of list) {
        const pts = Number(r.lifetimePoints) || 0;
        lifetime += pts;
        spent += Number(r.totalSpent) || 0;
        const t = TIER_KEYS.includes(r.tier) ? r.tier : tierForPoints(pts, config);
        counts[t]++;
    }
    const valuePaise = (config && config.redeemValuePaisePerPoint) || DEFAULTS.redeemValuePaisePerPoint;
    const top = list.slice().sort((a, b) =>
        (Number(b.lifetimePoints) || 0) - (Number(a.lifetimePoints) || 0)
        || (Number(b.totalSpent) || 0) - (Number(a.totalSpent) || 0)
        || String(a.phone).localeCompare(String(b.phone))
    ).slice(0, 8);
    return {
        members: list.length, lifetime, spent,
        valueRs: Math.round((lifetime * valuePaise) / 100),
        counts, top
    };
}

// ------------------------------------------------------------------- markup

const VIEWS = [
    ['overview', 'Overview'],
    ['members', 'Members'],
    ['rewards', 'Rewards'],
    ['rules', 'Rules']
];

export function tierChip(t, config) {
    const k = TIER_KEYS.includes(t) ? t : 'bronze';
    return `<span class="lyd-tier lyd-tier-${k}"><i aria-hidden="true"></i>${esc(tierLabel(k, config))}</span>`;
}

export function renderShell({ view, earnOn, dirty, outlet, body }) {
    const tabs = VIEWS.map(([k, label]) => {
        const on = k === view;
        const dot = (k === 'rules' && dirty) ? '<span class="lyd-unsaved-dot" title="Unsaved changes"><span class="lyd-sr">Unsaved changes</span></span>' : '';
        return `<button type="button" role="tab" id="lyd-tab-${k}" class="lyd-tab" data-action="loyalty-view" data-view="${k}"
            aria-selected="${on}" aria-controls="lyd-panel" tabindex="${on ? 0 : -1}">${label}${dot}</button>`;
    }).join('');
    return `
    <div class="lyd">
        <div class="lyd-orbs" aria-hidden="true"><i></i><i></i><i></i></div>
        <div class="lyd-inner">
        <header class="lyd-head">
            <div>
                <h2 class="lyd-title">Loyalty</h2>
                <p class="lyd-lede">Points your regulars earn and spend at ${esc(outlet || 'this kitchen')}.</p>
            </div>
            <div class="lyd-earn">
                <button type="button" role="switch" class="lyd-switch" id="lyd-earn-switch" data-action="loyalty-toggle-earning"
                    aria-checked="${earnOn ? 'true' : 'false'}" aria-labelledby="lyd-earn-state"><span class="lyd-switch-knob"></span></button>
                <div>
                    <strong id="lyd-earn-state">${earnOn ? 'Earning is on' : 'Earning is paused'}</strong>
                    <span>${earnOn ? 'Customers get points on new orders.' : 'No new points until you turn it back on.'}</span>
                </div>
            </div>
        </header>
        <div class="lyd-tabs" role="tablist" aria-label="Loyalty sections">${tabs}</div>
        <section class="lyd-panel" id="lyd-panel" role="tabpanel" aria-labelledby="lyd-tab-${esc(view)}" tabindex="0">${body}</section>
        <div class="lyd-sr" role="status" aria-live="polite" id="lyd-live"></div>
        </div>
    </div>`;
}

export function renderHealth(items) {
    const attention = items.filter(i => i.level === 'attention').length;
    const rows = items.map(i => {
        const act = i.action
            ? `<button type="button" class="btn-secondary btn-small lyd-health-act" data-action="${esc(i.action)}"${i.view ? ` data-view="${esc(i.view)}"` : ''}>${esc(i.actionLabel)}</button>` : '';
        return `<li class="lyd-health-row is-${i.level}">
            <span class="lyd-hico" aria-hidden="true">${i.level === 'ok' ? '\u2713' : '!'}</span>
            <div class="lyd-health-text"><strong><span class="lyd-sr">${i.level === 'ok' ? 'Good: ' : 'Needs a look: '}</span>${esc(i.title)}</strong><span>${esc(i.detail)}</span></div>
            ${act}
        </li>`;
    }).join('');
    return `
    <section class="lyd-block lyd-health" aria-labelledby="lyd-health-h">
        <h3 class="lyd-h" id="lyd-health-h">Program health</h3>
        <p class="lyd-sub">${attention === 0 ? 'Everything looks sensible.' : `${attention} ${attention === 1 ? 'thing is' : 'things are'} worth a look. Nothing here stops customers from earning.`}</p>
        <ul class="lyd-health-list">${rows}</ul>
    </section>`;
}

function figure(value, caption, id) {
    return `<div class="lyd-fig"><span class="lyd-fig-num"${id ? ` id="${id}"` : ''}>${value}</span><span class="lyd-fig-cap">${caption}</span></div>`;
}

// "Points outstanding" figure with its Update button. state: idle | counting | done
function outstandingFigure({ outstanding, state, progress, membersKnown }) {
    const counting = state === 'counting';
    let num_ = '\u2014', cap = 'Points members can spend now. Press Update to count them.';
    if (outstanding) {
        num_ = num(outstanding.points);
        cap = `Points outstanding, worth ${money(outstanding.valueRs)}. ${num(outstanding.holders)} ${outstanding.holders === 1 ? 'member holds' : 'members hold'} them.`;
    }
    if (counting) {
        cap = `Counting ${num(progress ? progress.done : 0)} of ${num(progress ? progress.total : 0)} members\u2026`;
    }
    const when = outstanding && outstanding.at && !counting
        ? `<span class="lyd-fig-when">Counted ${esc(fmtDate(outstanding.at))}${outstanding.failed ? `. ${num(outstanding.failed)} could not be read, so this may be low.` : '.'}</span>` : '';
    const btn = `<button type="button" class="btn-secondary btn-small lyd-update" data-action="loyalty-update-outstanding" id="lyd-update-outstanding"${counting || !membersKnown ? ' disabled' : ''}>${counting ? 'Counting\u2026' : (outstanding ? 'Update' : 'Count now')}</button>`;
    return `<div class="lyd-fig lyd-fig-outstanding"><span class="lyd-fig-num" id="lyd-outstanding-num">${num_}</span><span class="lyd-fig-cap" id="lyd-outstanding-cap">${cap}</span>${when}${btn}</div>`;
}

export function renderOverview({ config, stats, adjustments, configured, loading, failed, names, outstanding, outstandingState, progress }) {
    const nameOf = (ph) => (names && names[ph]) || '';
    const c = config;
    const s = stats;
    const dash = loading ? '…' : '—';
    const glance = `
        <div class="lyd-glance" role="group" aria-label="Program totals">
            ${figure(s ? num(s.members) : dash, 'Members earning points')}
            ${figure(s ? num(s.lifetime) : dash, 'Points handed out')}
            ${outstandingFigure({ outstanding, state: outstandingState, progress, membersKnown: !!(s && s.members) })}
            ${figure(s ? money(s.spent) : dash, 'Spent by members')}
        </div>`;
    const earnLine = `<p class="lyd-note">Right now: spend ${money(c.earnRatePaisePerPoint / 100)} to earn 1 point. Each point is worth ${money(c.redeemValuePaisePerPoint / 100)} at checkout.${configured === false ? ' You have not saved your own rules yet, so these standard ones apply. You can change them under Rules.' : ''}</p>`;

    if (failed) {
        return `${glance}${earnLine}<div class="lyd-empty" role="alert"><p><strong>Could not load member numbers.</strong></p><p>Check your connection, then try again.</p><button type="button" class="btn-secondary btn-small" data-action="loyalty-refresh">Try again</button></div>`;
    }
    if (s && s.members === 0) {
        return `${glance}${earnLine}
        <div class="lyd-empty">
            <p><strong>Nobody has earned points yet.</strong></p>
            <p>Points are added when a customer's order is paid. Check that earning is on and that the rules look right.</p>
            <button type="button" class="btn-primary btn-small" data-action="loyalty-view" data-view="rules">Review the rules</button>
        </div>`;
    }

    let tiersHtml = '';
    if (s) {
        const total = Math.max(1, s.members);
        const segs = TIER_KEYS.filter(k => s.counts[k] > 0).map(k =>
            `<span class="lyd-seg lyd-seg-${k}" style="flex:${s.counts[k]} 1 0"></span>`).join('');
        const label = TIER_KEYS.map(k => `${tierLabel(k, c)} ${s.counts[k]}`).join(', ');
        const legend = TIER_KEYS.map(k => {
            const t = c.tiers[k];
            const pct = Math.round((s.counts[k] / total) * 100);
            const rule = k === 'bronze' ? 'Everyone starts here' : `From ${num(t.min)} points`;
            return `<li>${tierChip(k, c)}<span class="lyd-legend-count">${num(s.counts[k])} <small>${pct}%</small></span><span class="lyd-legend-rule">${rule}, earns ${trimNum(t.multiplier)}×</span></li>`;
        }).join('');
        tiersHtml = `
        <section class="lyd-block">
            <h3 class="lyd-h">Members by tier</h3>
            <div class="lyd-tierbar" role="img" aria-label="${esc(label)}">${segs}</div>
            <ul class="lyd-legend">${legend}</ul>
        </section>`;
    }

    let topHtml = '';
    if (s && s.top.length) {
        topHtml = `
        <section class="lyd-block">
            <h3 class="lyd-h">Top members</h3>
            <p class="lyd-sub">Ranked by points earned over time.</p>
            <ol class="lyd-list lyd-top">
                ${s.top.map((r, i) => `
                <li>
                    <span class="lyd-rank">${i + 1}</span>
                    <button type="button" class="lyd-link lyd-who" data-action="loyalty-open-member" data-phone="${esc(r.phone)}" aria-label="Open ${esc(nameOf(r.phone) || fmtPhone(r.phone))}">
                        <span class="lyd-who-name">${esc(nameOf(r.phone) || fmtPhone(r.phone))}</span>${nameOf(r.phone) ? `<span class="lyd-who-phone">${esc(fmtPhone(r.phone))}</span>` : ''}
                    </button>
                    ${tierChip(r.tier, c)}
                    <span class="lyd-top-pts">${num(r.lifetimePoints)} points</span>
                    <span class="lyd-top-spent">${money(r.totalSpent)} spent</span>
                </li>`).join('')}
            </ol>
        </section>`;
    }

    let adjHtml = '';
    if (Array.isArray(adjustments)) {
        adjHtml = `
        <section class="lyd-block">
            <h3 class="lyd-h">Recent manual changes</h3>
            <p class="lyd-sub">Points you added or removed by hand. Every change is kept on record.</p>
            ${adjustments.length ? `<ul class="lyd-list lyd-adjs">
                ${adjustments.map(a => {
                    const d = Number(a.delta) || 0;
                    return `<li>
                        <span class="lyd-delta ${d > 0 ? 'is-plus' : 'is-minus'}">${d > 0 ? '+' : '−'}${num(Math.abs(d))} points</span>
                        <button type="button" class="lyd-link" data-action="loyalty-open-member" data-phone="${esc(a.phone)}">${esc(nameOf(a.phone) || fmtPhone(a.phone))}</button>
                        <span class="lyd-adj-reason">${esc(a.reason)}</span>
                        <span class="lyd-adj-when">${esc(fmtDate(a.createdAt))}</span>
                    </li>`;
                }).join('')}
            </ul>` : `<p class="lyd-quiet">No manual changes yet.</p>`}
        </section>`;
    }

    const healthHtml = renderHealth(healthChecks({ config: c, configured, stats: s }));
    return `${glance}${earnLine}
    ${healthHtml}
    <div class="lyd-cols">
        <div>${tiersHtml}${topHtml}</div>
        <div>${adjHtml}</div>
    </div>
    <p class="lyd-foot"><button type="button" class="btn-secondary btn-small" data-action="loyalty-refresh">Refresh numbers</button></p>`;
}

export function renderMembers({ prefill }) {
    return `
    <form class="lyd-find" data-lyd-find autocomplete="off">
        <div class="lyd-field">
            <label for="loyalty-lookup-phone">Customer's mobile number</label>
            <input type="tel" inputmode="numeric" id="loyalty-lookup-phone" class="lyd-input" maxlength="15" placeholder="98765 43210" value="${esc(prefill || '')}">
        </div>
        <button type="submit" class="btn-primary" data-action="loyalty-search-customer" id="loyalty-search-customer">Find customer</button>
    </form>
    <p class="lyd-sub">See their tier, points, rewards used and recent orders. You can also add or remove points here.</p>
    <div id="loyalty-customer-result" aria-live="polite"></div>`;
}

export function renderNoRecord(phone) {
    return `<div class="lyd-empty"><p><strong>${esc(fmtPhone(phone))} has no points yet.</strong></p>
        <p>A loyalty record is created when this customer's first order is paid. Points can be adjusted after that.</p></div>`;
}

export function renderMemberSheet({ phone, app, loy, rank, rewards, orders }, config) {
    const L = loy || {};
    const A = app || {};
    const lifetime = Number(L.lifetimePoints) || 0;
    const balance = Math.max(0, Number(L.points) || 0);
    const tier = TIER_KEYS.includes(L.tier) ? L.tier : tierForPoints(lifetime, config);
    const nt = nextTier(lifetime, config);
    const worth = (balance * (config.redeemValuePaisePerPoint || 100)) / 100;
    const rankTxt = rank && Number.isFinite(Number(rank.rank)) ? `#${Number(rank.rank)} of this kitchen's customers` : 'Not ranked yet';

    const prog = nt
        ? `<div class="lyd-prog">
            <div class="lyd-prog-text"><strong>${num(nt.remaining)} more points</strong> to reach ${esc(nt.label)}</div>
            <div class="lyd-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${nt.percent}" aria-label="Progress to ${esc(nt.label)}"><span style="width:${nt.percent}%"></span></div>
          </div>`
        : `<div class="lyd-prog"><div class="lyd-prog-text"><strong>Top tier reached.</strong> ${esc(tierLabel(tier, config))} members earn points at ${trimNum(((config.tiers || {})[tier] || {}).multiplier || 1)}\u00d7.</div></div>`;

    const redeemed = rewards.length
        ? `<ul class="lyd-list lyd-hist">${rewards.map(r => `
            <li><span class="lyd-hist-main">${esc(r.label || r.rewardId || 'Reward')}</span>
            <span class="lyd-hist-meta">Code ${esc(r.code || '—')}</span>
            <span class="lyd-hist-meta">${esc(fmtDate(r.redeemedAt))}</span>
            <span class="lyd-pill">${esc(r.status || 'active')}</span></li>`).join('')}</ul>`
        : `<p class="lyd-quiet">No rewards used yet.</p>`;

    const recent = orders.length
        ? `<ul class="lyd-list lyd-hist">${orders.map(o => `
            <li><span class="lyd-hist-main">${esc(o.orderId || o.id || '—')}</span>
            <span class="lyd-hist-meta">${esc(fmtDate(o.createdAt))}</span>
            <span class="lyd-hist-meta lyd-money">${money(o.total || 0)}</span>
            <span class="lyd-pill">${esc(o.status || 'Placed')}</span></li>`).join('')}</ul>`
        : `<p class="lyd-quiet">No orders found.</p>`;

    return `
    <article class="lyd-member">
        <header class="lyd-member-head">
            <div>
                <h3 class="lyd-member-name">${esc(A.name || 'No name on file')}</h3>
                <p class="lyd-member-phone">${esc(fmtPhone(phone))}</p>
            </div>
            ${tierChip(tier, config)}
        </header>
        <div class="lyd-balance">
            <div>
                <span class="lyd-balance-num" id="lyd-balance" data-balance="${balance}">${num(balance)}</span>
                <span class="lyd-balance-cap">points to spend, worth ${money(worth)} at checkout</span>
            </div>
            ${prog}
        </div>
        <dl class="lyd-facts">
            <div><dt>Points earned over time</dt><dd>${num(lifetime)}</dd></div>
            <div><dt>Total spent</dt><dd>${money(L.totalSpent || 0)}</dd></div>
            <div><dt>Orders</dt><dd>${num(L.orderCount || orders.length)}</dd></div>
            <div><dt>Rank</dt><dd class="lyd-facts-rank">${esc(rankTxt)}</dd></div>
        </dl>
        <section class="lyd-block">
            <h4 class="lyd-h">Add or remove points</h4>
            <div class="lyd-adjust">
                <div class="lyd-field">
                    <label for="loyalty-adj-delta">Change by</label>
                    <input type="number" step="1" id="loyalty-adj-delta" class="lyd-input lyd-input-short" placeholder="-50 or 25">
                </div>
                <div class="lyd-field lyd-grow">
                    <label for="loyalty-adj-reason">Reason</label>
                    <input type="text" id="loyalty-adj-reason" class="lyd-input" maxlength="200" placeholder="For example: goodwill, or a lost order">
                </div>
                <button type="button" class="btn-primary" data-action="loyalty-adjust-points" data-phone="${esc(phone)}">Apply change</button>
            </div>
            <p class="lyd-sub" id="lyd-adj-preview" aria-live="polite">Only the points to spend change. Their tier and points earned over time stay as they are.</p>
        </section>
        <section class="lyd-block"><h4 class="lyd-h">Rewards used</h4>${redeemed}</section>
        <section class="lyd-block"><h4 class="lyd-h">Recent orders</h4>${recent}</section>
    </article>`;
}

export function renderRewards({ config, editingId }) {
    const rewards = config.rewards || [];
    const pointRs = (config.redeemValuePaisePerPoint || 100) / 100;
    const typeOpts = (sel) => `<option value="item"${sel === 'discount' ? '' : ' selected'}>Free item</option>
                <option value="discount"${sel === 'discount' ? ' selected' : ''}>Discount</option>`;
    const rows = rewards.map(r => {
        if (editingId && editingId === r.id) {
            return `
            <li class="lyd-reward is-editing" data-reward="${esc(r.id)}">
                <div class="lyd-reward-form">
                    <div class="lyd-field lyd-grow"><label for="lyd-edit-label">Reward name</label>
                        <input type="text" id="lyd-edit-label" class="lyd-input" data-field="label" value="${esc(r.label)}" maxlength="60"></div>
                    <div class="lyd-field"><label for="lyd-edit-cost">Cost in points</label>
                        <input type="number" id="lyd-edit-cost" class="lyd-input lyd-input-short" min="0" step="1" data-field="cost" value="${Number(r.cost) || 0}"></div>
                    <div class="lyd-field"><label for="lyd-edit-type">Type</label>
                        <select id="lyd-edit-type" class="lyd-input" data-field="type">${typeOpts(r.type)}</select></div>
                    <div class="lyd-actions">
                        <button type="button" class="btn-primary btn-small" data-action="loyalty-save-reward" data-reward-id="${esc(r.id)}">Save reward</button>
                        <button type="button" class="btn-secondary btn-small" data-action="loyalty-cancel-edit" data-reward-id="${esc(r.id)}">Cancel</button>
                    </div>
                </div>
            </li>`;
        }
        const cost = Number(r.cost) || 0;
        return `
        <li class="lyd-reward" data-reward="${esc(r.id)}">
            <div class="lyd-reward-main">
                <strong>${esc(r.label || 'Reward')}</strong>
                <span class="lyd-pill">${r.type === 'discount' ? 'Discount' : 'Free item'}</span>
            </div>
            <div class="lyd-reward-cost"><b>${num(cost)} points</b><span>${money(cost * pointRs)} of points</span></div>
            <div class="lyd-actions">
                <button type="button" class="btn-secondary btn-small" data-action="loyalty-edit-reward" data-reward-id="${esc(r.id)}" aria-label="Edit ${esc(r.label)}">Edit</button>
                <button type="button" class="btn-secondary btn-small" data-action="loyalty-delete-reward" data-reward-id="${esc(r.id)}" aria-label="Delete ${esc(r.label)}">Delete</button>
            </div>
        </li>`;
    }).join('');

    return `
    <section class="lyd-block">
        <h3 class="lyd-h">What customers can get</h3>
        <p class="lyd-sub">Customers pick a reward in the app and pay for it with points. A reward you delete stays valid for anyone who already claimed it.</p>
        ${rewards.length ? `<ul class="lyd-list lyd-rewards">${rows}</ul>` : `<div class="lyd-empty"><p><strong>No rewards yet.</strong></p><p>Add your first one below. Customers will see it in the app.</p></div>`}
    </section>
    <section class="lyd-block lyd-add">
        <h3 class="lyd-h">Add a reward</h3>
        <div class="lyd-reward-form">
            <div class="lyd-field lyd-grow"><label for="loyalty-new-label">Reward name</label>
                <input type="text" id="loyalty-new-label" class="lyd-input" maxlength="60" placeholder="For example: Free samosa"></div>
            <div class="lyd-field"><label for="loyalty-new-cost">Cost in points</label>
                <input type="number" id="loyalty-new-cost" class="lyd-input lyd-input-short" min="0" step="1" placeholder="200"></div>
            <div class="lyd-field"><label for="loyalty-new-type">Type</label>
                <select id="loyalty-new-type" class="lyd-input">${typeOpts('item')}</select></div>
            <button type="button" class="btn-primary" data-action="loyalty-add-reward">Add reward</button>
        </div>
        <p class="lyd-sub">A free item is a dish the kitchen hands over. A discount takes money off the bill.</p>
    </section>`;
}

// The receipt. Rendered into #lyd-bill and re-rendered live as the form changes.
export function renderBill(ex, billRs) {
    if (!ex || !ex.ok) {
        return `<div class="lyd-bill-body"><p class="lyd-quiet">Fill in the numbers on the left to see an example.</p></div>`;
    }
    const lines = ex.tiers.map(t => `
        <li><span>${esc(TIER_LABEL[t.key])} member earns</span>
        <b>${num(t.points)} ${t.points === 1 ? 'point' : 'points'}</b>
        <span class="lyd-bill-sub">worth ${money(t.worthRs)}, ${trimNum(t.backPct)}% back</span></li>`).join('');
    const pay = ex.capped
        ? `At most <b>${money(ex.maxPayWithPointsRs)}</b> of this bill can be paid with points.`
        : `The whole bill can be paid with points.`;
    const exp = ex.expiryDays === null ? '' : (ex.expiryDays === 0
        ? 'Points never expire.'
        : `Points expire after ${num(ex.expiryDays)} days without an order.`);
    return `
    <div class="lyd-bill-body">
        <div class="lyd-bill-total"><span>Bill</span><b>${money(ex.bill)}</b></div>
        <ul class="lyd-bill-lines">${lines}</ul>
        <p class="lyd-bill-pay">${pay}</p>
        <p class="lyd-bill-exp">${esc(exp)}${ex.earnOn ? '' : ' Earning is switched off, so nobody earns this right now.'}</p>
    </div>`;
}

export function renderQuickPicks(form) {
    const cur = backPct(form);
    const chips = QUICK_PICKS.map(p => {
        const target = earnForBackPct(p, toNum(form.redeemRs));
        const on = cur !== null && Math.abs(cur - p) < 0.01;
        return `<button type="button" class="lyd-chip" data-action="loyalty-quick-rate" data-pct="${p}" aria-pressed="${on}"${target === null ? ' disabled' : ''}>${p}% back</button>`;
    }).join('');
    return `<div class="lyd-quick" role="group" aria-label="Quick picks for how generous earning is">
        <span class="lyd-quick-label">Quick pick</span>${chips}
        <small id="lyd-back-note">${cur === null ? '' : `A normal-rate member gets about ${trimNum(Math.round(cur * 100) / 100)}% back on every bill.`}</small>
    </div>`;
}

function fieldInput({ id, label, value, hint, step, min, max, short }) {
    return `
    <div class="lyd-field">
        <label for="${id}">${label}</label>
        <input type="number" inputmode="decimal" id="${id}" class="lyd-input${short ? ' lyd-input-short' : ''}" data-rule value="${esc(value)}"${step ? ` step="${step}"` : ''}${min !== undefined ? ` min="${min}"` : ''}${max !== undefined ? ` max="${max}"` : ''}>
        ${hint ? `<small>${hint}</small>` : ''}
    </div>`;
}

function check(id, checked, label, hint) {
    return `
    <label class="lyd-check" for="${id}">
        <input type="checkbox" id="${id}" data-rule${checked ? ' checked' : ''}>
        <span><b>${label}</b><small>${hint}</small></span>
    </label>`;
}

export function renderRules({ form, dirty, billRs, example }) {
    const tierRow = (k, minId, minVal) => `
        <div class="lyd-tier-row">
            ${tierChip(k)}
            ${k === 'bronze'
                ? `<div class="lyd-tier-fixed"><b>Starts at</b><span>Everyone starts here</span></div>`
                : fieldInput({ id: minId, label: 'Starts at (points)', value: minVal, step: 1, min: 1, short: true })}
            ${fieldInput({ id: `loyalty-tier-${k}-mult`, label: 'Earns points at', value: form[k + 'Mult'], step: 0.05, min: 0.1, short: true })}
        </div>`;
    return `
    <div class="lyd-rules">
        <form class="lyd-rules-form" id="lyd-rules-form" novalidate>
            <fieldset class="lyd-set">
                <legend>Earning points</legend>
                ${fieldInput({ id: 'loyalty-earn-rate', label: 'Customer spends (₹) to earn 1 point', value: form.earnRs, step: 1, min: 1, short: true })}
                ${renderQuickPicks(form)}
                ${check('loyalty-earn-enabled', form.earnOn, 'Points earning', 'Turn off to pause all earning.')}
                ${check('loyalty-dinein-earn-enabled', form.dineOn, 'Dine-in earning', 'Give points when a table bill is paid.')}
                ${check('loyalty-clawback-enabled', form.clawOn, 'Take points back on cancel or void', 'Reverse the points when an order is cancelled or a paid bill is voided.')}
            </fieldset>
            <fieldset class="lyd-set">
                <legend>Tiers</legend>
                <p class="lyd-sub">Members move up on points earned over time. Higher tiers earn points faster: 1 is the normal rate, 1.5 is half as fast again.</p>
                ${tierRow('bronze')}
                ${tierRow('silver', 'loyalty-tier-silver-min', form.silverMin)}
                ${tierRow('gold', 'loyalty-tier-gold-min', form.goldMin)}
            </fieldset>
            <fieldset class="lyd-set">
                <legend>Spending points</legend>
                ${fieldInput({ id: 'loyalty-redeem-value', label: '1 point is worth (₹)', value: form.redeemRs, step: 0.25, min: 0.25, short: true })}
                ${fieldInput({ id: 'loyalty-max-redeem-pct', label: 'Most of a bill points can pay (%)', value: form.maxPct, step: 1, min: 0, max: 100, short: true, hint: '0 = no limit. 10 means points pay at most 10% of one bill.' })}
                ${fieldInput({ id: 'loyalty-min-spend', label: 'Customer still pays at least (₹)', value: form.minSpend, step: 10, min: 0, short: true, hint: '0 = no minimum.' })}
            </fieldset>
            <fieldset class="lyd-set">
                <legend>Expiry</legend>
                ${fieldInput({ id: 'loyalty-expiry-days', label: 'Points expire after (days without an order)', value: form.expiry, step: 30, min: 0, short: true, hint: '0 = points never expire. The usual choice is 180.' })}
            </fieldset>
            <div class="lyd-savebar${dirty ? ' is-dirty' : ''}" id="lyd-savebar">
                <span class="lyd-savebar-msg" id="lyd-savebar-msg">${dirty ? 'You have unsaved changes.' : 'All changes saved.'}</span>
                <button type="button" class="btn-secondary" data-action="loyalty-discard"${dirty ? '' : ' disabled'} id="lyd-discard">Discard changes</button>
                <button type="button" class="btn-primary" data-action="loyalty-save-config" id="lyd-save">Save rules</button>
            </div>
        </form>
        <aside class="lyd-bill" aria-labelledby="lyd-bill-h">
            <div class="lyd-bill-head">
                <h3 id="lyd-bill-h">What a bill earns</h3>
                <div class="lyd-field">
                    <label for="lyd-bill-amount">Example bill (₹)</label>
                    <input type="number" id="lyd-bill-amount" class="lyd-input lyd-input-short" min="0" step="50" value="${esc(billRs)}">
                </div>
            </div>
            <div id="lyd-bill" aria-live="polite">${renderBill(example, billRs)}</div>
            <p class="lyd-bill-note">Uses the numbers in the form, saved or not.</p>
        </aside>
    </div>`;
}

// --------------------------------------------------------------------- CSS

export const LOYALTY_CSS = `
.lyd{
  --lyd-ink:#141a22; --lyd-sub:#4e5968; --lyd-line:rgba(20,26,34,.09); --lyd-paper:#fff; --lyd-wash:rgba(255,255,255,.5);
  --lyd-accent:var(--primary,#E84908); --lyd-ok:#157347; --lyd-bad:#b42318; --lyd-warn:#9a5b00;
  --lyd-bronze:#8f5324; --lyd-bronze-bg:#f8eadf;
  --lyd-silver:#46515f; --lyd-silver-bg:#e8ecf2;
  --lyd-gold:#7d5a00; --lyd-gold-bg:#fbf0c8;
  --g-bg:rgba(255,255,255,.58); --g-bg-strong:rgba(255,255,255,.76);
  --g-edge:rgba(255,255,255,.85); --g-shadow:0 10px 32px rgba(52,44,120,.10),0 1px 2px rgba(20,26,34,.05);
  --g-blur:blur(18px) saturate(160%);
  position:relative; overflow:hidden; overflow:clip; isolation:isolate;
  color:var(--lyd-ink); font-family:'Inter',system-ui,sans-serif; font-size:14px; line-height:1.5;
  max-width:1120px; margin:8px auto 40px; padding:24px;
  border-radius:28px; border:1px solid rgba(255,255,255,.9);
  background:linear-gradient(160deg,#f5f0ff 0%,#eef5ff 46%,#fff2ea 100%);
  box-shadow:0 20px 60px rgba(52,44,120,.12);
}
.lyd *{box-sizing:border-box}
.lyd :where(h2,h3,h4,p,ul,ol,dl,dd,fieldset,legend){margin:0;padding:0}
.lyd :where(ul,ol){list-style:none}
.lyd button{font-family:inherit}
.lyd-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.lyd :focus-visible{outline:2px solid var(--lyd-accent);outline-offset:2px;border-radius:6px}

/* backdrop: three soft colour fields the glass refracts */
.lyd-orbs{position:absolute;inset:0;z-index:-1;pointer-events:none}
.lyd-orbs i{position:absolute;display:block;border-radius:50%;filter:blur(56px);opacity:.75}
.lyd-orbs i:nth-child(1){width:380px;height:380px;left:-90px;top:-70px;background:#ffb48a}
.lyd-orbs i:nth-child(2){width:440px;height:440px;right:-140px;top:140px;background:#b9a6ff}
.lyd-orbs i:nth-child(3){width:400px;height:400px;left:28%;bottom:-170px;background:#8fe3d4}
.lyd-inner{position:relative}

/* glass surfaces */
.lyd-head,.lyd-glance,.lyd-block,.lyd-set,.lyd-member,.lyd-tabs,.lyd-empty,.lyd-savebar,.lyd-earn{
  background:var(--g-bg); border:1px solid var(--g-edge);
  -webkit-backdrop-filter:var(--g-blur); backdrop-filter:var(--g-blur);
  box-shadow:var(--g-shadow), inset 0 1px 0 rgba(255,255,255,.9);
}
@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){
  .lyd-head,.lyd-glance,.lyd-block,.lyd-set,.lyd-member,.lyd-tabs,.lyd-empty,.lyd-savebar,.lyd-earn{background:rgba(255,255,255,.94)}
}

.lyd-head{display:flex;justify-content:space-between;align-items:center;gap:16px 24px;flex-wrap:wrap;margin-bottom:16px;padding:20px 22px;border-radius:22px;background:var(--g-bg-strong)}
.lyd-title{font-size:28px;line-height:1.15;font-weight:800;letter-spacing:-.02em}
.lyd-lede{color:var(--lyd-sub);margin-top:3px;max-width:46ch}
.lyd-earn{display:flex;align-items:center;gap:12px;padding:10px 16px 10px 12px;border-radius:16px;box-shadow:none;background:rgba(255,255,255,.62)}
.lyd-earn strong{display:block;font-size:13.5px}
.lyd-earn span{display:block;font-size:12.5px;color:var(--lyd-sub)}
.lyd-switch{flex:none;width:44px;height:26px;border-radius:13px;border:0;padding:3px;cursor:pointer;background:#aeb7c4;transition:background .18s}
.lyd .lyd-switch{width:44px;height:26px;min-width:44px;min-height:26px;max-height:26px}
.lyd-switch[aria-checked="true"]{background:linear-gradient(135deg,#1f9d63,#157347)}
.lyd-switch-knob{display:block;width:20px;height:20px;border-radius:50%;background:#fff;transition:transform .18s cubic-bezier(.3,.7,.3,1);box-shadow:0 1px 3px rgba(0,0,0,.28)}
.lyd-switch[aria-checked="true"] .lyd-switch-knob{transform:translateX(18px)}
.lyd-switch:disabled{opacity:.6;cursor:wait}

.lyd-tabs{display:flex;gap:4px;padding:5px;border-radius:16px;margin-bottom:18px;overflow-x:auto;scrollbar-width:none}
.lyd-tabs::-webkit-scrollbar{display:none}
.lyd-tab{position:relative;flex:1 0 auto;background:none;border:0;border-radius:11px;padding:10px 18px;font-size:14px;font-weight:600;color:var(--lyd-sub);cursor:pointer;min-height:44px;transition:background .18s,color .18s,box-shadow .18s}
.lyd-tab:hover{color:var(--lyd-ink);background:rgba(255,255,255,.5)}
.lyd-tab[aria-selected="true"]{color:var(--lyd-ink);background:#fff;box-shadow:0 2px 10px rgba(52,44,120,.14)}
.lyd-unsaved-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--lyd-accent);margin-left:7px;vertical-align:middle}
.lyd-panel:focus{outline:none}
.lyd-panel.is-entering{animation:lyd-in .26s cubic-bezier(.2,.7,.2,1)}
@keyframes lyd-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}

.lyd-h{font-size:16px;font-weight:700;line-height:1.3}
.lyd-sub{color:var(--lyd-sub);font-size:13px;margin-top:3px;max-width:62ch}
.lyd-note{color:var(--lyd-sub);font-size:13px;margin:12px 4px 18px}
.lyd-quiet{color:var(--lyd-sub);font-size:13px;margin-top:8px}
.lyd-foot{margin-top:8px}
.lyd-block{padding:20px 22px;border-radius:18px;margin-bottom:18px}
.lyd-block .lyd-h + *{margin-top:10px}
.lyd-block .lyd-h + .lyd-sub{margin-top:3px}
.lyd-block .lyd-sub + *{margin-top:14px}

.lyd-glance{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border-radius:22px;background:var(--g-bg-strong)}
.lyd-fig{padding:18px 20px;border-left:1px solid var(--lyd-line);min-width:0}
.lyd-fig:first-child{border-left:0}
.lyd-fig-num{display:block;font-size:30px;line-height:1.1;font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:-.02em;overflow-wrap:anywhere}
.lyd-fig-cap{display:block;font-size:12.5px;color:var(--lyd-sub);margin-top:4px}
.lyd-fig-when{display:block;font-size:12px;color:var(--lyd-sub);margin-top:4px}
.lyd-update{margin-top:10px}
.lyd-fig-outstanding{background:linear-gradient(160deg,rgba(255,255,255,.0),rgba(232,73,8,.07))}

.lyd-cols{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:0 18px;align-items:start}

/* program health */
.lyd-health-list{display:grid;gap:2px}
.lyd-health-row{display:grid;grid-template-columns:30px minmax(0,1fr) auto;gap:12px;align-items:center;padding:10px 0;border-top:1px solid var(--lyd-line)}
.lyd-health-row:first-child{border-top:0}
.lyd-hico{display:grid;place-items:center;width:28px;height:28px;border-radius:50%;font-weight:800;font-size:14px;line-height:1}
.lyd-health-row.is-ok .lyd-hico{background:#dff3e8;color:var(--lyd-ok)}
.lyd-health-row.is-attention .lyd-hico{background:#fdeccc;color:var(--lyd-warn)}
.lyd-health-text strong{display:block;font-size:13.5px}
.lyd-health-text > span{display:block;font-size:12.5px;color:var(--lyd-sub)}

.lyd-tier{display:inline-flex;align-items:center;gap:6px;padding:2px 10px 2px 8px;border-radius:999px;font-size:12.5px;font-weight:700;border:1px solid transparent;white-space:nowrap;box-shadow:inset 0 1px 0 rgba(255,255,255,.7)}
.lyd-tier i{width:8px;height:8px;border-radius:50%;background:currentColor}
.lyd-tier-bronze{color:var(--lyd-bronze);background:var(--lyd-bronze-bg);border-color:#ecd2bd}
.lyd-tier-silver{color:var(--lyd-silver);background:var(--lyd-silver-bg);border-color:#d3d9e1}
.lyd-tier-gold{color:var(--lyd-gold);background:var(--lyd-gold-bg);border-color:#efdc92}

.lyd-tierbar{display:flex;gap:3px;height:16px;border-radius:8px;overflow:hidden;box-shadow:inset 0 1px 2px rgba(20,26,34,.12)}
.lyd-seg{display:block;min-width:6px;transition:flex-grow .5s ease}
.lyd-seg-bronze{background:linear-gradient(180deg,#d38c58,#b76d36)}
.lyd-seg-silver{background:linear-gradient(180deg,#a3aebb,#7f8b9a)}
.lyd-seg-gold{background:linear-gradient(180deg,#e6b930,#c99708)}
.lyd-legend{display:grid;gap:8px;margin-top:14px}
.lyd-legend li{display:grid;grid-template-columns:96px 72px 1fr;gap:10px;align-items:center}
.lyd-legend-count{font-weight:700;font-variant-numeric:tabular-nums}
.lyd-legend-count small{font-weight:500;color:var(--lyd-sub);margin-left:3px}
.lyd-legend-rule{color:var(--lyd-sub);font-size:12.5px}

.lyd-list li{display:grid;align-items:center;gap:4px 14px;padding:11px 0;border-top:1px solid var(--lyd-line)}
.lyd-list li:first-child{border-top:0;padding-top:2px}
.lyd-top li{grid-template-columns:22px minmax(0,1.2fr) auto auto auto}
.lyd-rank{font-variant-numeric:tabular-nums;color:var(--lyd-sub);font-weight:700}
.lyd-top-pts{font-weight:600;font-variant-numeric:tabular-nums;text-align:right}
.lyd-top-spent{color:var(--lyd-sub);font-variant-numeric:tabular-nums;text-align:right;min-width:92px}
.lyd-link{background:none;border:0;padding:6px 0;margin:-6px 0;font-weight:700;font-size:14px;color:var(--lyd-ink);text-align:left;cursor:pointer;text-decoration:underline;text-decoration-color:rgba(20,26,34,.18);text-underline-offset:3px;min-height:32px;font-variant-numeric:tabular-nums}
.lyd-link:hover{text-decoration-color:var(--lyd-accent)}
.lyd-who{display:flex;flex-direction:column;align-items:flex-start;gap:0;padding:2px 0;margin:-2px 0;text-decoration:none;min-width:0}
.lyd-who-name{font-weight:700;overflow-wrap:anywhere;text-decoration:underline;text-decoration-color:rgba(20,26,34,.18);text-underline-offset:3px}
.lyd-who:hover .lyd-who-name{text-decoration-color:var(--lyd-accent)}
.lyd-who-phone{font-weight:500;font-size:12.5px;color:var(--lyd-sub)}
.lyd-adjs li{grid-template-columns:auto minmax(0,1fr);}
.lyd-delta{font-weight:800;font-variant-numeric:tabular-nums}
.lyd-delta.is-plus{color:var(--lyd-ok)}.lyd-delta.is-minus{color:var(--lyd-bad)}
.lyd-adj-reason{grid-column:1 / -1;color:var(--lyd-ink);overflow-wrap:anywhere}
.lyd-adj-when{grid-column:1 / -1;color:var(--lyd-sub);font-size:12px}

.lyd-empty{border:1px dashed rgba(20,26,34,.22);border-radius:18px;padding:22px;display:grid;gap:6px;justify-items:start;margin-top:8px;box-shadow:none}
.lyd-empty p{max-width:56ch}
.lyd-empty .btn-primary,.lyd-empty .btn-secondary{margin-top:8px}

.lyd-field{display:flex;flex-direction:column;gap:4px;min-width:0}
.lyd-field label{font-size:12.5px;font-weight:600;color:var(--lyd-ink)}
.lyd-field small{color:var(--lyd-sub);font-size:12px;max-width:44ch}
.lyd-grow{flex:1 1 220px}
.lyd-input{width:100%;height:44px;padding:0 12px;border:1px solid rgba(20,26,34,.16);border-radius:12px;background:rgba(255,255,255,.88);color:var(--lyd-ink);font:inherit;font-variant-numeric:tabular-nums;transition:border-color .15s,box-shadow .15s,background .15s}
.lyd-input-short{max-width:150px}
.lyd-input:hover{border-color:rgba(20,26,34,.32)}
.lyd-input:focus-visible{outline:none;border-color:var(--lyd-accent);background:#fff;box-shadow:0 0 0 4px rgba(232,73,8,.16)}
.lyd-input[aria-invalid="true"]{border-color:var(--lyd-bad);background:#fff6f5;box-shadow:0 0 0 4px rgba(180,35,24,.10)}
.lyd-find{display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap}
.lyd-find .lyd-input{width:260px;max-width:100%}
.lyd-find + .lyd-sub{margin:10px 4px 20px}
.lyd .btn-primary,.lyd .btn-secondary{min-height:44px}
.lyd .btn-small{min-height:36px}
.lyd .btn-secondary{background:rgba(255,255,255,.7)}

.lyd-member{border-radius:22px;background:var(--g-bg-strong);padding:24px}
.lyd-member .lyd-block{background:none;border:0;box-shadow:none;-webkit-backdrop-filter:none;backdrop-filter:none;padding:0;border-radius:0;margin-bottom:26px}
.lyd-member .lyd-block:last-child{margin-bottom:0}
.lyd-member-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}
.lyd-member-name{font-size:20px;font-weight:800;line-height:1.25;letter-spacing:-.01em}
.lyd-member-phone{color:var(--lyd-sub);font-variant-numeric:tabular-nums}
.lyd-balance{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:18px 36px;align-items:center;margin:20px 0;padding:18px 0;border-top:1px solid var(--lyd-line);border-bottom:1px solid var(--lyd-line)}
.lyd-balance-num{display:block;font-size:48px;line-height:1;font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:-.03em}
.lyd-balance-cap{display:block;color:var(--lyd-sub);font-size:13px;margin-top:6px}
.lyd-prog-text{font-size:13px;margin-bottom:8px}
.lyd-bar{height:10px;border-radius:5px;background:rgba(20,26,34,.09);overflow:hidden}
.lyd-bar span{display:block;height:100%;background:linear-gradient(90deg,#f0702f,var(--lyd-accent));border-radius:5px;transition:width .6s cubic-bezier(.2,.7,.2,1)}
.lyd-facts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px 18px;margin-bottom:26px}
.lyd-facts dt{font-size:12.5px;color:var(--lyd-sub)}
.lyd-facts dd{font-size:18px;font-weight:700;font-variant-numeric:tabular-nums;margin-top:2px}
.lyd-facts dd.lyd-facts-rank{font-size:14px;font-weight:600;padding-top:3px}
.lyd-adjust{display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap}
.lyd-hist li{grid-template-columns:minmax(0,1.3fr) minmax(0,1fr) auto auto}
.lyd-hist-main{font-weight:600;overflow-wrap:anywhere}
.lyd-hist-meta{color:var(--lyd-sub);font-size:13px}
.lyd-money{font-variant-numeric:tabular-nums;color:var(--lyd-ink);text-align:right}
.lyd-pill{display:inline-block;padding:1px 9px;border-radius:999px;background:rgba(255,255,255,.7);border:1px solid var(--lyd-line);font-size:12px;font-weight:600;color:var(--lyd-sub);white-space:nowrap}

.lyd-rewards li{grid-template-columns:minmax(0,1.5fr) minmax(0,1fr) auto}
.lyd-reward-main{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.lyd-reward-cost{display:flex;flex-direction:column;font-variant-numeric:tabular-nums}
.lyd-reward-cost span{font-size:12.5px;color:var(--lyd-sub)}
.lyd-actions{display:flex;gap:8px;flex-wrap:wrap}
.lyd-reward-form{display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap}
.lyd-rewards li.is-editing{grid-template-columns:1fr}

.lyd-rules{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:0 24px;align-items:start}
.lyd-set{border-radius:18px;margin:0 0 18px;padding:20px 22px;display:flex;flex-direction:column;gap:14px;min-width:0}
.lyd-set legend{float:left;width:100%;font-size:16px;font-weight:700;line-height:1.3;padding:0;margin:0 0 2px}
.lyd-quick{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.lyd-quick-label{font-size:12.5px;font-weight:600;color:var(--lyd-sub);margin-right:2px}
.lyd-quick small{flex:1 0 100%;color:var(--lyd-sub);font-size:12.5px}
.lyd-chip{min-height:36px;padding:0 14px;border-radius:999px;border:1px solid rgba(20,26,34,.16);background:rgba(255,255,255,.7);color:var(--lyd-ink);font-weight:600;font-size:13px;cursor:pointer;transition:background .15s,border-color .15s,box-shadow .15s}
.lyd-chip:hover:not(:disabled){border-color:var(--lyd-accent)}
.lyd-chip[aria-pressed="true"]{background:var(--lyd-accent);border-color:var(--lyd-accent);color:#fff;box-shadow:0 4px 12px rgba(232,73,8,.28)}
.lyd-chip:disabled{opacity:.5;cursor:not-allowed}
.lyd-check{display:flex;gap:10px;align-items:flex-start;cursor:pointer}
.lyd-check input{margin-top:3px;width:18px;height:18px;accent-color:var(--lyd-accent);flex:none}
.lyd-check b{display:block;font-size:13.5px;font-weight:600}
.lyd-check small{display:block;color:var(--lyd-sub);font-size:12.5px}
.lyd-tier-row{display:grid;grid-template-columns:104px 150px 150px;gap:12px 16px;align-items:start;padding:12px 0;border-top:1px solid var(--lyd-line)}
.lyd-tier-row .lyd-tier{justify-self:start;margin-top:24px}
.lyd-tier-fixed{display:flex;flex-direction:column;gap:4px}
.lyd-tier-fixed b{font-size:12.5px;font-weight:600}
.lyd-tier-fixed span{display:flex;align-items:center;height:44px;color:var(--lyd-sub);font-size:13px}
.lyd-savebar{position:sticky;bottom:10px;z-index:5;display:flex;gap:10px;align-items:center;justify-content:flex-end;flex-wrap:wrap;padding:12px 14px;border-radius:16px;background:var(--g-bg-strong);transition:box-shadow .2s,border-color .2s}
.lyd-savebar-msg{margin-right:auto;color:var(--lyd-sub);font-size:13px}
.lyd-savebar.is-dirty{border-color:rgba(232,73,8,.45);box-shadow:var(--g-shadow),0 0 0 3px rgba(232,73,8,.12)}
.lyd-savebar.is-dirty .lyd-savebar-msg{color:var(--lyd-ink);font-weight:600}

.lyd-bill{position:sticky;top:12px;background:var(--lyd-paper);padding:18px 20px 26px;border-radius:8px 8px 0 0;
  filter:drop-shadow(0 0 .6px #8d97a5) drop-shadow(0 14px 22px rgba(52,44,120,.18));
  font-variant-numeric:tabular-nums}
.lyd-bill::after{content:"";position:absolute;left:0;right:0;bottom:-9px;height:9px;
  background:linear-gradient(135deg,var(--lyd-paper) 50%,transparent 50%) 0 0/14px 9px repeat-x,
             linear-gradient(225deg,var(--lyd-paper) 50%,transparent 50%) 0 0/14px 9px repeat-x}
.lyd-bill-head{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;padding-bottom:14px;border-bottom:1px dashed #b4bcc8}
.lyd-bill-head h3{font-size:15.5px;font-weight:800;line-height:1.3}
.lyd-bill-total{display:flex;justify-content:space-between;align-items:baseline;padding:14px 0 10px;font-size:15px}
.lyd-bill-total b{font-size:24px;font-weight:800}
.lyd-bill-lines li{display:grid;grid-template-columns:1fr auto;gap:0 12px;padding:8px 0;border-top:1px dashed #d3d9e1}
.lyd-bill-lines li > span:first-child{color:var(--lyd-sub);font-size:13px}
.lyd-bill-lines li b{font-size:15px;text-align:right}
.lyd-bill-sub{grid-column:1 / -1;text-align:right;color:var(--lyd-sub);font-size:12.5px}
.lyd-bill-pay{margin-top:12px;padding-top:12px;border-top:1px dashed #b4bcc8;font-size:13px}
.lyd-bill-exp{margin-top:6px;font-size:12.5px;color:var(--lyd-sub)}
.lyd-bill-note{margin-top:12px;font-size:12px;color:var(--lyd-sub)}

@media (max-width:980px){
  .lyd-rules{grid-template-columns:minmax(0,1fr)}
  .lyd-bill{position:static;order:-1;margin-bottom:18px}
  .lyd-cols{grid-template-columns:minmax(0,1fr)}
}
@media (max-width:680px){
  .lyd{padding:12px;border-radius:22px;margin:4px 0 28px;--g-blur:blur(12px) saturate(150%)}
  .lyd-orbs i{filter:blur(44px)}
  .lyd-head{padding:16px}
  .lyd-title{font-size:24px}
  .lyd-earn{width:100%}
  .lyd-tab{padding:10px 12px}
  .lyd-block,.lyd-set{padding:16px}
  .lyd-glance{grid-template-columns:repeat(2,minmax(0,1fr))}
  .lyd-fig:nth-child(3){border-left:0}
  .lyd-fig:nth-child(n+3){border-top:1px solid var(--lyd-line)}
  .lyd-legend li{grid-template-columns:96px 1fr}
  .lyd-legend-rule{grid-column:1 / -1}
  .lyd-top li{grid-template-columns:22px minmax(0,1fr) auto}
  .lyd-top li .lyd-top-pts{grid-column:2 / 3;text-align:left}
  .lyd-top li .lyd-top-spent{grid-column:3 / 4;text-align:right;min-width:0}
  .lyd-health-row{grid-template-columns:30px minmax(0,1fr)}
  .lyd-health-act{grid-column:2 / -1;justify-self:start}
  .lyd-balance{grid-template-columns:1fr}
  .lyd-facts{grid-template-columns:repeat(2,minmax(0,1fr))}
  .lyd-hist li{grid-template-columns:1fr auto}
  .lyd-rewards li{grid-template-columns:1fr}
  .lyd-tier-row{grid-template-columns:1fr 1fr}
  .lyd-tier-row .lyd-tier{grid-column:1 / -1;margin-top:0}
  .lyd-input-short{max-width:none}
  .lyd-link{min-height:44px;display:inline-flex;align-items:center}
  .lyd-who{min-height:44px;justify-content:center;align-items:flex-start;margin:0}
  .lyd .btn-small,.lyd .lyd-update,.lyd .lyd-chip{min-height:44px}
  .lyd-check input{width:22px;height:22px}
  .lyd-fig{padding:14px}
  .lyd-fig-num{font-size:24px}
  .lyd-find .lyd-field{flex:1 1 100%}
  .lyd-find .lyd-input{width:100%}
  .lyd-member{padding:16px}
  .lyd-savebar .btn-primary,.lyd-savebar .btn-secondary{flex:1 1 auto}
}
@media (max-width:360px){
  .lyd{padding:10px}
  .lyd-tab{padding:10px 8px;font-size:13px}
}
@media (prefers-reduced-motion:reduce){
  .lyd *,.lyd *::before,.lyd *::after{animation:none !important;transition:none !important}
}
`;
