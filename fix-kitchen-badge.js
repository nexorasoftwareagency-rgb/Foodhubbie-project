const fs = require('fs');
let content = fs.readFileSync('D:\Foodhubbie Project\Admin\js\features\orders.js', 'utf8');
const marker = `        }
    }

    // ---------------------------------------------------------------------`;
const idx = content.indexOf(marker);
if (idx >= 0) {
    const insert = `    function updateLiveBadge() {
        const liveBadge = document.getElementById("badge-live");
        // Count orders with KDS-visible statuses: Placed, Confirmed, Ready
        // (Served with unpaid also counts - same as renderOrders logic)
        let count = 0;
        state.ordersMap.forEach(o => {
            if (!o) return;
            const status = (o.status || "").trim();
            if (status === "Placed" || status === "Confirmed" || status === "Ready" ||
                (status === "Served" && o.paymentStatus !== "Paid" && !o.paidAt)) {
                count++;
            }
        });
        if (liveBadge) {
            liveBadge.innerText = count;
            if (count > 0) {
                liveBadge.classList.remove("hidden");
            } else {
                liveBadge.classList.add("hidden");
            }
        }
    }

`;
    const before = content.substring(0, idx);
    const after = content.substring(idx);
    content = before + insert + after;
    fs.writeFileSync('D:\Foodhubbie Project\Admin\js\features\orders.js', content, 'utf8');
    console.log("Done");
} else {
    console.log("Marker not found");
}