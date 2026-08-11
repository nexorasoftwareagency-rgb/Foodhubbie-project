/**
 * BOT Reports — daily, weekly, monthly sales reports.
 * Requires: OUTLET, OUTLET_NAME, OUTLET_EMOJI, getData, getCachedAdminJids, getISTDateInfo, getISTDateString.
 */

const { getISTDateInfo, getISTDateString, isSocketDead } = require('./utils');

async function sendDailyReport(sock, ctx, targetDate = null) {
    const { OUTLET, OUTLET_NAME, OUTLET_EMOJI, getData, getCachedAdminJids } = ctx;
    try {
        if (!sock || isSocketDead(sock)) return;
        const ist = getISTDateInfo();
        const dateStr = targetDate || ist.dateStr;

        console.log(`[Report] Generating Daily Report for: ${dateStr}`);

        let totalOrders = 0;
        let totalRevenue = 0;
        let reportDetails = "";

        const orders = await getData(`${OUTLET}/orders`);
        if (orders) {
            let outletOrders = 0;
            let outletRevenue = 0;
            let statusBreakdown = {};

            Object.values(orders).forEach(order => {
                if (!order.createdAt) return;
                const oDateStr = getISTDateString(order.createdAt);
                if (oDateStr === dateStr) {
                    outletOrders++;
                    const s = order.status || "Unknown";
                    statusBreakdown[s] = (statusBreakdown[s] || 0) + 1;
                    if (order.status === "Delivered" || order.status === "Confirmed" || order.paymentStatus === "Paid") {
                        const cleanTotal = Number(String(order.total ?? 0).replace(/,/g, ''));
                outletRevenue += Number.isFinite(cleanTotal) ? cleanTotal : 0;
                    }
                }
            });

            if (outletOrders > 0) {
                reportDetails += `\n${OUTLET === 'pizza' ? '🍕' : '🎂'} *${OUTLET.toUpperCase()} OUTLET:*\n`;
                reportDetails += `   📦 Total Orders: ${outletOrders}\n`;
                reportDetails += `   💰 Real Sales: ₹${outletRevenue.toLocaleString()}\n`;
                const breakdownStr = Object.entries(statusBreakdown)
                    .map(([s, count]) => `      ▫️ ${s}: ${count}`)
                    .join('\n');
                reportDetails += `   📊 Breakdown:\n${breakdownStr}\n`;
            }

            totalOrders += outletOrders;
            totalRevenue += outletRevenue;
        }

        const jids = await getCachedAdminJids();
        const displayDate = new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
        const nowIST = getISTDateInfo().istObject;

        const msg = `📊 *${OUTLET_NAME.toUpperCase()} — DAILY SALES REPORT* ${OUTLET_EMOJI}\n\n` +
            `📅 Sales Date: *${displayDate}*\n` +
            `⏰ Generated: ${nowIST.getUTCHours().toString().padStart(2, '0')}:${nowIST.getUTCMinutes().toString().padStart(2, '0')} IST\n\n` +
            (reportDetails || "_No sales recorded for this date._\n") +
            `\n💵 *TOTAL REVENUE:* ₹${totalRevenue.toLocaleString()}\n` +
            `📦 *TOTAL ORDERS:* ${totalOrders}\n\n` +
            `_Sent automatically by ${OUTLET_NAME} Bot_`;

        await Promise.allSettled(jids.map(jid => sock.sendMessage(jid, { text: msg })));
        console.log(`📊 Daily report for ${dateStr} broadcast to ${jids.length} numbers`);
    } catch (err) { console.error("Daily Report Error:", err); }
}

async function sendMonthlyReport(sock, ctx) {
    const { OUTLET, OUTLET_NAME, OUTLET_EMOJI, getData, getCachedAdminJids } = ctx;
    try {
        if (!sock || isSocketDead(sock)) return;
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

        let totalOrders = 0;
        let totalRevenue = 0;
        let reportDetails = "";

        const orders = await getData(`${OUTLET}/orders`);
        if (orders) {
            let outletOrders = 0;
            let outletRevenue = 0;

            Object.values(orders).forEach(order => {
                const orderTime = order.createdAt ? new Date(order.createdAt).getTime() : 0;
                if (orderTime >= startOfMonth) {
                    outletOrders++;
                    if (order.status === "Delivered" || order.status === "Confirmed" || order.paymentStatus === "Paid") {
                        const cleanTotal = Number(String(order.total ?? 0).replace(/,/g, ''));
                outletRevenue += Number.isFinite(cleanTotal) ? cleanTotal : 0;
                    }
                }
            });

            if (outletOrders > 0) {
                reportDetails += `\n${OUTLET === 'pizza' ? '🍕' : '🎂'} *${OUTLET.toUpperCase()} OUTLET:*\n`;
                reportDetails += `   📦 Orders: ${outletOrders}\n`;
                reportDetails += `   💰 Revenue: ₹${outletRevenue.toLocaleString()}\n`;
            }

            totalOrders += outletOrders;
            totalRevenue += outletRevenue;
        }

        const jids = await getCachedAdminJids();

        const msg = `📈 *${OUTLET_NAME.toUpperCase()} — MONTHLY SALES REPORT* ${OUTLET_EMOJI}\n\n` +
            `📅 Month: ${now.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}\n\n` +
            reportDetails +
            `\n\n💵 *MONTHLY TOTAL:* ₹${totalRevenue.toLocaleString()}\n` +
            `📦 *TOTAL ORDERS:* ${totalOrders}\n\n` +
            `_Sent automatically by ${OUTLET_NAME} Bot_`;

        await Promise.allSettled(jids.map(jid => sock.sendMessage(jid, { text: msg })));
        console.log(`📈 Monthly report broadcast to ${jids.length} numbers`);
    } catch (err) { console.error("Monthly Report Error:", err); }
}

async function sendWeeklyReport(sock, ctx) {
    const { OUTLET, OUTLET_NAME, OUTLET_EMOJI, getData, getCachedAdminJids } = ctx;
    try {
        if (!sock || isSocketDead(sock)) return;
        const now = new Date();
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - 7);
        const weekStartTime = startOfWeek.getTime();

        let totalOrders = 0;
        let totalRevenue = 0;
        let reportDetails = "";

        const orders = await getData(`${OUTLET}/orders`);
        if (orders) {
            let outletOrders = 0;
            let outletRevenue = 0;

            Object.values(orders).forEach(order => {
                const orderTime = order.createdAt ? new Date(order.createdAt).getTime() : 0;
                if (orderTime >= weekStartTime) {
                    outletOrders++;
                    if (order.status === "Delivered" || order.status === "Confirmed" || order.paymentStatus === "Paid") {
                        const cleanTotal = Number(String(order.total ?? 0).replace(/,/g, ''));
                outletRevenue += Number.isFinite(cleanTotal) ? cleanTotal : 0;
                    }
                }
            });

            if (outletOrders > 0) {
                reportDetails += `\n${OUTLET === 'pizza' ? '🍕' : '🎂'} *${OUTLET.toUpperCase()} OUTLET:*\n`;
                reportDetails += `   📦 Orders: ${outletOrders}\n`;
                reportDetails += `   💰 Revenue: ₹${outletRevenue.toLocaleString()}\n`;
            }

            totalOrders += outletOrders;
            totalRevenue += outletRevenue;
        }

        const jids = await getCachedAdminJids();

        const msg = `📊 *${OUTLET_NAME.toUpperCase()} — WEEKLY SALES REPORT* ${OUTLET_EMOJI}\n\n` +
            `📅 Week: ${startOfWeek.toLocaleDateString('en-IN')} - ${now.toLocaleDateString('en-IN')}\n\n` +
            reportDetails +
            `\n\n💵 *WEEKLY TOTAL:* ₹${totalRevenue.toLocaleString()}\n` +
            `📦 *TOTAL ORDERS:* ${totalOrders}\n\n` +
            `_Sent automatically by ${OUTLET_NAME} Bot_`;

        await Promise.allSettled(jids.map(jid => sock.sendMessage(jid, { text: msg })));
        console.log(`📊 Weekly report broadcast to ${jids.length} numbers`);
    } catch (err) { console.error("Weekly Report Error:", err); }
}

module.exports = { sendDailyReport, sendMonthlyReport, sendWeeklyReport };
