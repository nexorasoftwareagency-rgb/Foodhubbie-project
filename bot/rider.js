/**
 * BOT Rider Notifications — pickup, assignment, broadcast.
 * Requires: formatJid, addInAppNotification, getData.
 */

const { formatJid, isSocketDead } = require('./utils');

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
        const riderId = order.riderId || order.assignedRiderUid;
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
        const riderId = order.riderId || order.assignedRiderUid;
        if (!riderPhone) {
            console.warn(`[RIDER] ⚠️ Cannot notify assignment: No phone number for order #${orderId.slice(-5)}`);
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
            id: orderId.slice(-5),
        });

        console.log(`[RIDER] 📤 Sending assignment message to rider: ${riderPhone} for #${orderId.slice(-5)}`);
        await sock.sendMessage(riderJid, { text: msg }, { _logChat: false });
        console.log(`[RIDER] ✅ Assignment notification sent to ${riderPhone}`);

        if (riderId) {
            await addInAppNotification(riderId, "New Order Assigned!", `You have been assigned to order #${order.orderId || orderId.slice(-5)}.`, 'info', 'truck', order.outlet);
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
                if (r.status !== "Online" || !r.phone) return false;
                const ts = r.lastSeen || r.location?.ts || 0;
                return ts && (Date.now() - ts) < RIDER_STALE_MS;
            });

        console.log(`[RIDER] 📢 Broadcasting pickup for #${orderId.slice(-5)} to ${onlineRiders.length} online riders.`);

        if (onlineRiders.length === 0) {
            console.log(`[RIDER] ⚠️ No online riders available for broadcast of #${orderId.slice(-5)}`);
            return;
        }

        const msg = buildRiderOrderMessage(order, {
            title: `🔔 *PICKUP AVAILABLE* 🔔`,
            footer: `🚀 *Go to Rider Portal now to Accept!*`,
            id: orderId.slice(-5),
            includeOutlet: true,
        });

        for (const rider of onlineRiders) {
            const riderJid = formatJid(rider.phone);
            if (riderJid) {
                try {
                    await sock.sendMessage(riderJid, { text: msg }, { _logChat: false });
                    await addInAppNotification(rider.uid, "New Pickup Available!", `Order #${orderId.slice(-5)} is ready for pickup.`, 'success', 'shopping-bag', order.outlet);
                } catch (sendErr) {
                    console.error(`[RIDER] ❌ Failed to send broadcast to ${rider.phone}:`, sendErr.message);
                }
            }
        }
    } catch (err) {
        console.error("[RIDER] ❌ Broadcast Error:", err);
    }
}

module.exports = { notifyRiderPickup, notifyRiderAssignment, broadcastPickupAvailable };
