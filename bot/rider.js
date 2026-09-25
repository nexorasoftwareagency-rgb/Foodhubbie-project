/**
 * BOT Rider Notifications — pickup, assignment, broadcast.
 * Requires: formatJid, addInAppNotification, getData.
 */

const { formatJid, isSocketDead, getBroadcastDelayRangeMs, sleep, randomBetween, OutboundTracker, formatOrderId } = require('./utils');
const { db, resolvePath } = require('./firebase');
const { paceBurstSend } = require('./send-pacer');
const outboundTracker = new OutboundTracker(db, resolvePath);

async function _sendToRiderWithRetry(sock, riderJid, msg) {
    try {
        await sock.sendMessage(riderJid, { text: msg }, { _logChat: false });
    } catch (firstErr) {
        if (isSocketDead(sock)) throw firstErr;
        console.warn(`[RIDER] Send hiccup for ${riderJid}, retrying once in 4s: ${firstErr.message}`);
        await sleep(4000);
        await sock.sendMessage(riderJid, { text: msg }, { _logChat: false });
    }
}

function buildRiderOrderMessage(order, { title, footer, id, includeOutlet = false, includeOTP = false } = {}) {
    let itemsText = "";
    const items = order.normalizedItems || order.items || [];
    items.forEach((item) => {
        const qty = item.quantity || item.qty || 1;
        const price = item.lineTotal || item.total || (item.price * qty) || 0;
        itemsText += `• *${item.name || item.item}* (${item.size || 'Reg'}) x${qty} - ₹${price}\n`;
        if (item.addons && item.addons.length > 0) {
            const addonNames = Array.isArray(item.addons)
                ? item.addons.map(a => a.name || a).join(", ")
                : Object.keys(item.addons).join(", ");
            itemsText += `  _Addons: ${addonNames}_\n`;
        }
    });

    const mapsLink = (order.lat && order.lng) ? `https://www.google.com/maps?q=${order.lat},${order.lng}` : (order.locationLink || "");

    let msg = `${title}\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `🆔 *Order ID:* #${order.orderId || id || 'N/A'}\n`;
    if (includeOutlet) msg += `🏪 *Outlet:* ${(order.outlet || 'pizza').toUpperCase()}\n`;
    msg += `🧾 *INVOICE DETAILS:*\n`;
    msg += `${itemsText}`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `💰 *Subtotal:* ₹${order.subtotal || order.itemTotal || 0}\n`;
    if (order.deliveryFee) msg += `🚚 *Delivery:* ₹${order.deliveryFee}\n`;
    if (order.discount) msg += `🎁 *Discount${order.discountMode === 'percent' && order.discountValue ? ` (${order.discountValue}% off)` : ''}:* -₹${order.discount}\n`;
    msg += `💵 *TOTAL: ₹${order.total || 0}* (${order.paymentMethod || 'N/A'})\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `👤 *CUSTOMER INFO:*\n`;
    msg += `*Name:* ${order.customerName || 'Customer'}\n`;
    msg += `*Phone:* ${order.phone || 'N/A'}\n`;
    msg += `*Address:* ${order.address || 'Address not provided'}\n`;
    msg += `*Distance:* ${order.distanceKm ? order.distanceKm + ' km' : 'N/A'}\n`;
    if (mapsLink) msg += `📍 *Location:* ${mapsLink}\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    if (includeOTP) msg += `🔑 *DELIVERY OTP:* ${order.deliveryOTP || order.otp || 'N/A'}\n━━━━━━━━━━━━━━━━━━━━\n`;
    msg += footer;

    return msg;
}

async function notifyRiderPickup(sock, order, addInAppNotification) {
    try {
        if (!sock || isSocketDead(sock)) return;
        const riderPhone = order.riderPhone;
        const riderId = order.riderId || order.assignedRider;
        if (!riderPhone) return;

        const riderJid = formatJid(riderPhone);
        if (!riderJid) {
            console.warn(`[RIDER] ⚠️ Cannot notify pickup: Invalid JID for phone ${riderPhone}`);
            return;
        }

        const msg = buildRiderOrderMessage(order, {
            title: `🛵 *READY FOR PICKUP* 🛵`,
            footer: `_The order is packed and waiting. Please arrive at the outlet immediately!_`,
            includeOTP: true,
        });

        await sock.sendMessage(riderJid, { text: msg }, { _logChat: false });
        console.log(`[RIDER] ✅ Pickup notification sent to ${riderPhone}`);

        if (riderId) {
            await addInAppNotification(riderId, "Order Ready for Pickup!", `Order #${order.orderId || ''} is packed and waiting for you.`, 'warning', 'package', order.outlet);
        }
    } catch (err) {
        console.error("[RIDER] ❌ Rider Pickup Notify Error:", err);
    }
}

async function notifyRiderAssignment(sock, orderId, order, addInAppNotification) {
    try {
        if (!sock || isSocketDead(sock)) return;
        const riderPhone = order.riderPhone;
        const riderId = order.riderId || order.assignedRider;
        if (!riderPhone) {
            console.warn(`[RIDER] ⚠️ Cannot notify assignment: No phone number for order #${formatOrderId(order.orderId || orderId)}`);
            return;
        }

        const riderJid = formatJid(riderPhone);
        if (!riderJid) {
            console.warn(`[RIDER] ⚠️ Cannot notify assignment: Invalid JID for phone ${riderPhone}`);
            return;
        }

        const msg = buildRiderOrderMessage(order, {
            title: `🔔 *NEW ORDER ASSIGNED* 🔔`,
            footer: `🚀 *Please reach the outlet for pickup!*`,
            id: formatOrderId(order.orderId || orderId),
        });

        console.log(`[RIDER] 📤 Sending assignment message to rider: ${riderPhone} for #${formatOrderId(order.orderId || orderId)}`);
        await sock.sendMessage(riderJid, { text: msg }, { _logChat: false });
        outboundTracker.trackSend(order.outlet || 'pizza', 'rider_broadcast');
        console.log(`[RIDER] ✅ Assignment notification sent to ${riderPhone}`);

        if (riderId) {
            await addInAppNotification(riderId, "New Order Assigned!", `You have been assigned to order #${formatOrderId(order.orderId || orderId)}.`, 'info', 'truck', order.outlet);
        }
    } catch (err) {
        console.error("[RIDER] ❌ Rider Assignment Notify Error:", err);
    }
}

async function broadcastPickupAvailable(sock, orderId, order, getData, addInAppNotification) {
    try {
        if (!sock || isSocketDead(sock)) return;
        const outlet = order.outlet || 'pizza';
        const riders = await getData("riders", outlet) || {};

        const RIDER_STALE_MS = 5 * 60 * 1000;
        const onlineRiders = Object.entries(riders)
            .map(([uid, data]) => ({ uid, ...data }))
            .filter(r => {
                if (!r.phone) return false;
                const status = String(r.status || '').toLowerCase();
                if (status !== "online") return false;
                const ts = r.lastSeen || r.location?.ts || 0;
                return ts && (Date.now() - ts) < RIDER_STALE_MS;
            });

        console.log(`[RIDER] 📢 Broadcasting pickup for #${formatOrderId(order.orderId || orderId)} to ${onlineRiders.length} online riders.`);

        if (onlineRiders.length === 0) {
            console.log(`[RIDER] ⚠️ No online riders available for broadcast of #${formatOrderId(order.orderId || orderId)}`);
            return;
        }

        const msg = buildRiderOrderMessage(order, {
            title: `🔔 *PICKUP AVAILABLE* 🔔`,
            footer: `🚀 *Go to Rider Portal now to Accept!*`,
            id: formatOrderId(order.orderId || orderId),
            includeOutlet: true,
        });

        // Stagger sends instead of firing them all back-to-back — a tight
        // loop hitting many distinct numbers is a known ban-risk pattern,
        // and gets extra caution while this number is still in its warm-up
        // window (see getBroadcastDelayRangeMs).
        const pair = await getData('bot/pair', outlet).catch(() => null);
        const [minDelayMs, maxDelayMs] = getBroadcastDelayRangeMs(pair?.firstLinkedAt);

        let isFirstSend = true;
        for (const rider of onlineRiders) {
            const riderJid = formatJid(rider.phone);
            if (riderJid) {
                if (!isFirstSend) await sleep(randomBetween(minDelayMs, maxDelayMs));
                isFirstSend = false;
                try {
                    await paceBurstSend();
                    await _sendToRiderWithRetry(sock, riderJid, msg);
                    outboundTracker.trackSend(outlet, 'rider_broadcast');
                    await addInAppNotification(rider.uid, "New Pickup Available!", `Order #${formatOrderId(order.orderId || orderId)} is ready for pickup.`, 'success', 'shopping-bag', order.outlet);
                } catch (sendErr) {
                    console.error(`[RIDER] ❌ Failed to send broadcast to ${rider.phone}:`, sendErr.message);
                }
            }
        }
    } catch (err) {
        console.error("[RIDER] ❌ Broadcast Error:", err);
    }
}

async function notifyCustomerArrived(sock, order) {
    try {
        if (!sock || isSocketDead(sock)) return;
        const customerPhone = order.phone;
        if (!customerPhone) return;

        const customerJid = formatJid(customerPhone);
        if (!customerJid) {
            console.warn(`[RIDER] ⚠️ Cannot notify arrival: Invalid JID for phone ${customerPhone}`);
            return;
        }

        // Use the ARRIVED template (no OTP, just arrival confirmation)
        const msg = buildRiderOrderMessage(order, {
            title: `📍 *ARRIVED AT YOUR LOCATION* 📍`,
            footer: `I'm here with your order! Please have your OTP ready.`,
            id: formatOrderId(order.orderId || order.id),
            includeOutlet: true,
        });

        await sock.sendMessage(customerJid, { text: msg }, { _logChat: false });
        console.log(`[RIDER] ✅ Customer arrival notification sent to ${customerPhone}`);
    } catch (err) {
        console.error("[RIDER] ❌ Customer Arrival Notify Error:", err);
    }
}

module.exports = { notifyRiderPickup, notifyRiderAssignment, broadcastPickupAvailable, notifyCustomerArrived };
