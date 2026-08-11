/**
 * Roshani ERP — Firebase Cloud Functions
 *
 * Handles push notifications when orders are assigned to riders
 * or when order status changes. Replaces the deprecated client-side
 * fcm-sender.js stub.
 */

const { onValueWritten } = require("firebase-functions/v2/database");
const { initializeApp } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");
const { getMessaging } = require("firebase-admin/messaging");

initializeApp();

const OUTLETS = ["pizza", "cake"];

/**
 * Trigger: When an order is written/updated under any outlet.
 * Detects rider assignment and status changes → sends FCM to rider.
 */
exports.onOrderUpdate = onValueWritten(
  {
    ref: "/{outlet}/orders/{orderId}",
  },
  async (event) => {
    const outlet = event.params.outlet;
    if (!OUTLETS.includes(outlet)) return;

    const before = event.data.before.val();
    const after = event.data.after.val();

    if (!after) return; // Order deleted — skip

    const orderId = event.params.orderId;
    const riderId = after.riderId;
    const riderIdBefore = before?.riderId;

    // 1. New rider assignment
    if (riderId && riderId !== riderIdBefore) {
      await sendToRider(riderId, {
        notification: {
          title: "New Order Assigned!",
          body: `Order #${orderId.slice(-5)} for ₹${after.total || 0} — Please check the app.`,
        },
        data: {
          orderId,
          outlet,
          type: "rider_assigned",
          url: "./index.html",
        },
      });
    }

    // 2. Status change (only if rider is assigned)
    if (riderId && after.status !== before?.status) {
      const status = after.status || "";
      const statusBody = getStatusBody(status, orderId, after.total);

      if (statusBody) {
        await sendToRider(riderId, {
          notification: {
            title: `Order #${orderId.slice(-5)}`,
            body: statusBody,
          },
          data: {
            orderId,
            outlet,
            type: "status_change",
            status,
            url: "./index.html",
          },
        });
      }
    }
  }
);

/**
 * Trigger: When a new order is created under any outlet (for admin notification).
 * Sends FCM to all admin devices.
 */
exports.onNewOrder = onValueWritten(
  {
    ref: "/{outlet}/orders/{orderId}",
  },
  async (event) => {
    const outlet = event.params.outlet;
    if (!OUTLETS.includes(outlet)) return;

    const after = event.data.after.val();
    const before = event.data.before.val();

    if (!after || before) return; // Only on new creation

    const orderId = event.params.orderId;

    await sendToAdmins({
      notification: {
        title: `New Order #${orderId.slice(-5)}`,
        body: `${after.customerName || "Customer"} · ₹${after.total || 0} · ${outlet.toUpperCase()}`,
      },
      data: {
        orderId,
        outlet,
        type: "new_order",
      },
    });
  }
);

/**
 * Get a human-readable status body for rider notifications.
 */
function getStatusBody(status, orderId, total) {
  const s = (status || "").toLowerCase();
  if (s === "ready" || s === "packed" || s === "cooked") {
    return `Order #${orderId.slice(-5)} is ready for pickup!`;
  }
  if (s === "cancelled") {
    return `Order #${orderId.slice(-5)} has been cancelled.`;
  }
  // Don't send for every status — only key ones
  return null;
}

/**
 * Send FCM push notification to a single rider by their UID.
 * Reads fcmToken from riders/{riderId}/fcmToken.
 */
async function sendToRider(riderId, payload) {
  try {
    const db = getDatabase();
    const snap = await db.ref(`riders/${riderId}/fcmToken`).once("value");
    const token = snap.val();

    if (!token) {
      console.warn(`[FCM] No fcmToken for rider ${riderId}`);
      return;
    }

    const message = {
      ...payload,
      token,
      android: { priority: "high" },
      webpush: { headers: { TTL: "300" } },
    };

    const response = await getMessaging().send(message);
    console.log(`[FCM] Sent to rider ${riderId}: ${response}`);
  } catch (err) {
    console.error(`[FCM] Failed to send to rider ${riderId}:`, err.message);
  }
}

/**
 * Send FCM push notification to ALL admin devices.
 * Reads all fcmToken values from admins/ node.
 */
async function sendToAdmins(payload) {
  try {
    const db = getDatabase();
    const snap = await db.ref("admins").once("value");
    const admins = snap.val();

    if (!admins) return;

    const tokens = Object.values(admins)
      .map((a) => a.fcmToken)
      .filter(Boolean);
    const unique = [...new Set(tokens)];

    if (unique.length === 0) {
      console.warn("[FCM] No admin fcmTokens found");
      return;
    }

    const message = {
      ...payload,
      tokens: unique,
      android: { priority: "high" },
      webpush: { headers: { TTL: "300" } },
    };

    const response = await getMessaging().sendEachForMulticast(message);
    console.log(
      `[FCM] Sent to ${unique.length} admin devices: ${response.successCount} success, ${response.failureCount} failure`
    );

    // Clean up invalid tokens
    if (response.failureCount > 0) {
      const db = getDatabase();
      response.responses.forEach((resp, idx) => {
        if (
          !resp.success &&
          (resp.error?.code === "messaging/registration-token-not-registered" ||
            resp.error?.code === "messaging/invalid-registration-token")
        ) {
          console.log(`[FCM] Removing invalid token: ${unique[idx].slice(0, 20)}...`);
          // Find and remove the invalid token
          Object.entries(admins).forEach(([uid, data]) => {
            if (data.fcmToken === unique[idx]) {
              db.ref(`admins/${uid}/fcmToken`).remove();
            }
          });
        }
      });
    }
  } catch (err) {
    console.error("[FCM] Failed to send to admins:", err.message);
  }
}


