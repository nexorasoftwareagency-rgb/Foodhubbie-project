const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

const serviceAccountPath = path.join(__dirname, "bot", "service-account.json");
if (!fs.existsSync(serviceAccountPath)) {
    console.error("Service account not found at:", serviceAccountPath);
    process.exit(1);
}

admin.initializeApp({
    credential: admin.credential.cert(serviceAccountPath),
    databaseURL: "https://foodhubbie-10-default-rtdb.firebaseio.com"
});

const db = admin.database();

async function backfillAnalytics() {
    console.log("Starting analytics backfill...");
    const startTime = Date.now();

    const businessesSnap = await db.ref("businesses").once("value");
    const businesses = businessesSnap.val() || {};

    let totalOutlets = 0;
    let updatedCount = 0;
    let errorCount = 0;

    for (const [bizId, bizData] of Object.entries(businesses)) {
        if (!bizData?.outlets) continue;

        for (const [outletId, outletData] of Object.entries(bizData.outlets)) {
            totalOutlets++;
            try {
                const sessionsSnap = await db.ref("businesses/roshani-pizza/outlets/" + outletId + "/tableSessions").once("value");
                const analyticsSnap = await db.ref("businesses/roshani-pizza/outlets/" + outletId + "/tableAnalytics").once("value");

                const sessions = sessionsSnap.val() || {};
                const analytics = analyticsSnap.val() || { totalRevenue: 0, totalOrders: 0, avgSessionTime: 0, occupancyRate: 0 };

                let computedRevenue = 0;
                let totalOrders = 0;

                for (const [sessionId, session] of Object.entries(sessions)) {
                    if (!session) continue;
                    const isPaid = session.status === "closed" && session.paidAt;
                    if (isPaid) {
                        if (typeof session.paidAmount === "number" && session.paidAmount > 0) {
                            computedRevenue += session.paidAmount;
                        } else {
                            const orders = session.orders || {};
                            for (const [oid, order] of Object.entries(orders)) {
                                if (order.status !== "Cancelled" && order.paymentStatus === "Paid") {
                                    computedRevenue += Number(order.total || 0);
                                }
                            }
                        }
                        totalOrders += (session.orders || []).length;
                    }
                }

                const currentRevenue = analytics.totalRevenue || 0;
                const currentOrders = analytics.totalOrders || 0;

                if (computedRevenue !== currentRevenue || totalOrders !== (analytics.totalOrders || 0)) {
                    await db.ref("businesses/roshani-pizza/outlets/" + outletId + "/tableAnalytics").update({
                        totalRevenue: computedRevenue,
                        totalOrders: totalOrders
                    });
                    console.log("  [" + outletId + "] Updated: revenue " + (analytics.totalRevenue || 0) + " -> " + computedRevenue + ", orders " + (analytics.totalOrders || 0) + " -> " + totalOrders);
                    updatedCount++;
                } else {
                    console.log("  [" + outletId + "] No change needed");
                }

            } catch (e) {
                console.error("  [" + outletId + "] Error:", e.message);
                errorCount++;
            }
        }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log("\n=== Backfill Complete ===");
    console.log("Outlets processed: " + totalOutlets);
    console.log("Analytics updated: " + updatedCount);
    console.log("Errors: " + errorCount);
    console.log("Duration: " + duration + "s");
    process.exit(0);
}

backfillAnalytics().catch(e => {
    console.error("Fatal error:", e);
    process.exit(1);
});
