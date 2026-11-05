/**
 * FoodHubbie ERP | PAYROLL MATH (pure — no imports, runnable in node or browser)
 * Single source of truth for staff payroll computation. Consumed by:
 *   Admin/js/features/staff-management.js  (payroll run preview + Close run)
 *
 * Model (OrderRestro-derived spec, clean-room implementation — plan §3.1):
 *   - MONTHLY staff: basePay = rate × (periodDays / daysInMonth(periodStart)).
 *     A full calendar month pays exactly the rate. Unpaid-leave deduction:
 *     rate / daysInMonth per unpaid day (paid leave deducts nothing).
 *   - HOURLY staff: basePay = rate × hoursWorked. No leave deduction —
 *     hourly staff simply don't clock unpaid days.
 *   - Tip pool: split proportional to clocked MINUTES; the LAST eligible
 *     recipient (staff array order) absorbs the rounding so shares sum to
 *     the pool exactly — no lost rupees, no over-pay.
 *   - Output line: { userId, payType, hoursWorked, basePay, tipShare,
 *     unpaidLeaveDeduction, netPay } with netPay = basePay + tipShare −
 *     unpaidLeaveDeduction. NOT floored at 0: payroll lines are audit
 *     records — an impossible negative (bad inputs) must stay visible,
 *     not be hidden by a clamp. Callers must pass sane inputs (unpaid
 *     leave days within the period).
 *   - Money in major units (₹), round2 everywhere. Period dates are
 *     'YYYY-MM-DD' strings; all date math is UTC so timezone shifts can
 *     never move a day boundary.
 *
 * The Admin UI aggregates RTDB nodes (attendance minutes, approved unpaid
 * leave days) into the per-uid maps this module consumes — the math itself
 * stays pure and fully unit-checkable.
 */

// EPSILON-guarded half-up rounding (same convention as money-math.js /
// discount-rules.js — exact .005 boundaries round up, not down).
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * Inclusive day count between two 'YYYY-MM-DD' dates.
 * @param {string} start - 'YYYY-MM-DD'
 * @param {string} end   - 'YYYY-MM-DD'
 * @returns {number} days inclusive (0 when end < start or inputs are bad)
 */
export function daysInclusive(start, end) {
    const s = parseYmd(start), e = parseYmd(end);
    if (!s || !e) return 0;
    const diff = Math.round((e.ms - s.ms) / 86400000) + 1;
    return diff > 0 ? diff : 0;
}

/**
 * Number of days in the calendar month containing the given date.
 * @param {string} dateStr - 'YYYY-MM-DD' (any day of that month)
 * @returns {number} 28 | 29 | 30 | 31 (0 on bad input)
 */
export function daysInMonthOf(dateStr) {
    const d = parseYmd(dateStr);
    if (!d) return 0;
    // Day 0 of the next month = last day of this month (UTC, no TZ drift).
    return new Date(Date.UTC(d.y, d.m, 0)).getUTCDate();
}

// 'YYYY-MM-DD' → { y, m (1-12), d, ms (UTC midnight) } or null.
function parseYmd(s) {
    if (typeof s !== 'string') return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
    if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return { y, m: mo, d, ms: Date.UTC(y, mo - 1, d) };
}

/**
 * Compute payroll lines for one period.
 *
 * @param {Object} opts
 * @param {string} opts.periodStart - 'YYYY-MM-DD' inclusive
 * @param {string} opts.periodEnd   - 'YYYY-MM-DD' inclusive
 * @param {number} [opts.tipPool]   - total tips to split in ₹
 * @param {Array}  opts.staff       - [{ uid, payType: 'MONTHLY'|'HOURLY', rate }]
 *                                   order defines the tip "last recipient"
 * @param {Object} [opts.minutesByUid]          - { uid: clocked minutes in period }
 * @param {Object} [opts.unpaidLeaveDaysByUid]  - { uid: approved UNPAID leave days in period }
 * @returns {Array} lines [{ userId, payType, hoursWorked, basePay, tipShare, unpaidLeaveDeduction, netPay }]
 */
export function computePayroll({ periodStart, periodEnd, tipPool = 0, staff = [], minutesByUid = {}, unpaidLeaveDaysByUid = {} } = {}) {
    const periodDays = daysInclusive(periodStart, periodEnd);
    const monthDays = daysInMonthOf(periodStart) || periodDays || 1;
    const pool = Math.max(0, round2(Number(tipPool) || 0));

    const lines = (Array.isArray(staff) ? staff : []).map(s => {
        const uid = s && s.uid;
        const rate = Math.max(0, Number(s && s.rate) || 0);
        const payType = (s && s.payType) === 'HOURLY' ? 'HOURLY' : 'MONTHLY';
        const minutes = Math.max(0, Math.round(Number(minutesByUid[uid]) || 0));
        const unpaidDays = Math.max(0, Number(unpaidLeaveDaysByUid[uid]) || 0);
        const hoursWorked = round2(minutes / 60);

        let basePay = 0, unpaidLeaveDeduction = 0;
        if (payType === 'MONTHLY') {
            // Full calendar month ⇒ exactly the rate; prorate partial periods.
            basePay = round2(rate * periodDays / monthDays);
            unpaidLeaveDeduction = round2(rate / monthDays * unpaidDays);
        } else {
            // HOURLY: from raw minutes (never from the rounded display hours —
            // that would compound rounding into pay). Leave never deducts.
            basePay = round2(rate * minutes / 60);
        }
        return {
            userId: uid,
            payType,
            hoursWorked,
            basePay,
            tipShare: 0, // filled by the tip pass below
            unpaidLeaveDeduction,
            netPay: 0,   // filled after tip pass
        };
    });

    // Tip pool: proportional to clocked minutes; last eligible absorbs rounding.
    if (pool > 0) {
        const eligible = lines.filter(l => l.hoursWorked > 0);
        const totalMinutes = eligible.reduce((sum, l) => sum + Math.round(l.hoursWorked * 60), 0);
        if (totalMinutes > 0) {
            let used = 0;
            eligible.forEach((l, i) => {
                const mins = Math.round(l.hoursWorked * 60);
                if (i < eligible.length - 1) {
                    l.tipShare = round2(pool * mins / totalMinutes);
                    used = round2(used + l.tipShare);
                } else {
                    // Last recipient absorbs rounding: pool − everything before.
                    l.tipShare = round2(pool - used);
                }
            });
        }
    }

    for (const l of lines) {
        l.netPay = round2(l.basePay + l.tipShare - l.unpaidLeaveDeduction);
    }
    return lines;
}

// ---------------------------------------------------------------------------
// Self-check: `node shared/payroll-math.js`
// ---------------------------------------------------------------------------
if (typeof process !== 'undefined' && process.argv?.[1]?.includes('payroll-math')) {
    import('node:assert').then(({ default: assert }) => {
        // date helpers
        assert.strictEqual(daysInclusive('2026-02-01', '2026-02-28'), 28);
        assert.strictEqual(daysInclusive('2024-02-01', '2024-02-29'), 29, 'leap year');
        assert.strictEqual(daysInclusive('2026-02-01', '2026-03-01'), 29, 'inclusive across months');
        assert.strictEqual(daysInclusive('2026-03-01', '2026-02-01'), 0, 'reversed period');
        assert.strictEqual(daysInMonthOf('2026-02-10'), 28);
        assert.strictEqual(daysInMonthOf('2024-02-10'), 29, 'leap Feb');
        assert.strictEqual(daysInMonthOf('2026-01-31'), 31);
        assert.strictEqual(daysInMonthOf('2026-04-02'), 30);
        assert.strictEqual(daysInMonthOf('garbage'), 0);

        // MONTHLY: full calendar month pays exactly the rate
        const full = computePayroll({
            periodStart: '2026-10-01', periodEnd: '2026-10-31', tipPool: 0,
            staff: [{ uid: 'u1', payType: 'MONTHLY', rate: 30000 }],
            minutesByUid: { u1: 0 }, unpaidLeaveDaysByUid: {},
        });
        assert.strictEqual(full[0].basePay, 30000, 'full month == rate');
        assert.strictEqual(full[0].netPay, 30000);

        // MONTHLY: partial period prorates (15 of 31 days)
        const half = computePayroll({
            periodStart: '2026-10-01', periodEnd: '2026-10-15',
            staff: [{ uid: 'u1', payType: 'MONTHLY', rate: 31000 }],
        });
        assert.strictEqual(half[0].basePay, 15000, '15/31 × 31000 = 15000');

        // MONTHLY: unpaid-leave deduction = rate/daysInMonth per day
        const leave = computePayroll({
            periodStart: '2026-10-01', periodEnd: '2026-10-31',
            staff: [{ uid: 'u1', payType: 'MONTHLY', rate: 31000 }],
            unpaidLeaveDaysByUid: { u1: 2 },
        });
        assert.strictEqual(leave[0].unpaidLeaveDeduction, 2000, '31000/31 × 2');
        assert.strictEqual(leave[0].netPay, 29000);

        // HOURLY: rate × hours from raw minutes; leave never deducts
        const hourly = computePayroll({
            periodStart: '2026-10-01', periodEnd: '2026-10-31',
            staff: [{ uid: 'h1', payType: 'HOURLY', rate: 60 }],
            minutesByUid: { h1: 907 }, // 15h07m
            unpaidLeaveDaysByUid: { h1: 3 }, // ignored for hourly
        });
        assert.strictEqual(hourly[0].hoursWorked, 15.12);
        assert.strictEqual(hourly[0].basePay, 907 * 60 / 60, '60 × 15.116… = 907');
        assert.strictEqual(hourly[0].unpaidLeaveDeduction, 0, 'hourly: no leave deduction');
        assert.strictEqual(hourly[0].netPay, 907);

        // Tip pool: proportional to minutes, LAST absorbs rounding, sum exact
        const tips = computePayroll({
            periodStart: '2026-10-01', periodEnd: '2026-10-31', tipPool: 100,
            staff: [
                { uid: 'a', payType: 'HOURLY', rate: 50 },
                { uid: 'b', payType: 'HOURLY', rate: 50 },
                { uid: 'c', payType: 'HOURLY', rate: 50 },
            ],
            minutesByUid: { a: 600, b: 300, c: 100 }, // 10h / 5h / 1h42m? no: 100min
        });
        // shares: a=60, b=30, c=absorbs → 10
        assert.strictEqual(tips[0].tipShare, 60);
        assert.strictEqual(tips[1].tipShare, 30);
        assert.strictEqual(tips[2].tipShare, 10, 'last absorbs rounding');
        assert.strictEqual(round2(tips.reduce((s, l) => s + l.tipShare, 0)), 100, 'tip shares sum to pool exactly');

        // Tip rounding absorption with an ugly pool
        const tips2 = computePayroll({
            periodStart: '2026-10-01', periodEnd: '2026-10-31', tipPool: 10,
            staff: [
                { uid: 'a', payType: 'HOURLY', rate: 50 },
                { uid: 'b', payType: 'HOURLY', rate: 50 },
                { uid: 'c', payType: 'HOURLY', rate: 50 },
            ],
            minutesByUid: { a: 100, b: 100, c: 100 },
        });
        assert.strictEqual(tips2[0].tipShare, 3.33);
        assert.strictEqual(tips2[1].tipShare, 3.33);
        assert.strictEqual(tips2[2].tipShare, 3.34, 'absorber takes the extra paisa');
        assert.strictEqual(round2(tips2.reduce((s, l) => s + l.tipShare, 0)), 10);

        // Zero-hours staff: line present, no tip, monthly still earns base
        const mixed = computePayroll({
            periodStart: '2026-10-01', periodEnd: '2026-10-31', tipPool: 500,
            staff: [
                { uid: 'work', payType: 'HOURLY', rate: 50 },
                { uid: 'off', payType: 'MONTHLY', rate: 20000 },
            ],
            minutesByUid: { work: 600 },
        });
        assert.strictEqual(mixed[1].tipShare, 0, 'no hours → no tip');
        assert.strictEqual(mixed[1].basePay, 20000, 'monthly base unaffected by hours');
        assert.strictEqual(mixed[0].tipShare, 500, 'sole earner takes whole pool');

        // No eligible recipients: pool undistributable → all shares 0
        const none = computePayroll({
            periodStart: '2026-10-01', periodEnd: '2026-10-31', tipPool: 500,
            staff: [{ uid: 'x', payType: 'MONTHLY', rate: 1000 }],
            minutesByUid: {},
        });
        assert.strictEqual(none[0].tipShare, 0, 'pool with no clocked hours → 0 shares');

        // Hostile inputs: strings, negatives, missing maps
        const hostile = computePayroll({
            periodStart: '2026-10-01', periodEnd: '2026-10-31',
            tipPool: '-50',
            staff: [{ uid: 'u1', payType: 'WEIRD', rate: '-100' }],
            minutesByUid: { u1: '-30' },
            unpaidLeaveDaysByUid: { u1: '-2' },
        });
        assert.strictEqual(hostile[0].payType, 'MONTHLY', 'unknown payType → MONTHLY default');
        assert.strictEqual(hostile[0].basePay, 0, 'negative rate coerced to 0');
        assert.strictEqual(hostile[0].tipShare, 0, 'negative pool clamped to 0');
        assert.strictEqual(hostile[0].unpaidLeaveDeduction, 0, 'negative leave days coerced');
        assert.deepStrictEqual(computePayroll({}), [], 'no staff → no lines');

        console.log('payroll-math OK');
    }).catch(e => { console.error(e); process.exit(1); });
}
