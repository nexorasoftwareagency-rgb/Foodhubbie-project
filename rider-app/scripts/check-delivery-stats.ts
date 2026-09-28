// Runnable check for the riderStats money path: node scripts/check-delivery-stats.ts
import { strict as assert } from "node:assert";
import { applyDeliveryStat, FLAG_TTL_MS } from "../src/lib/deliveryStats.ts";

const now = Date.now();

// first delivery bootstraps totals
const first = applyDeliveryStat(null, "03-161126-1", 40, now);
assert.equal(first.totalOrders, 1);
assert.equal(first.totalEarnings, 40);

// retry of the same order is a no-op (idempotent)
assert.deepEqual(applyDeliveryStat(first, "03-161126-1", 40, now + 1000), first);

// legacy boolean flags: still idempotent for their own key, dropped for new writes
const legacy = { totalOrders: 5, totalEarnings: 200, deliveredOrders: { "02-010126-9": true } };
assert.ok(applyDeliveryStat(legacy, "02-010126-9", 30, now) === legacy);
const afterLegacy = applyDeliveryStat(legacy, "03-161126-2", 30, now);
assert.equal(afterLegacy.totalOrders, 6);
assert.equal(afterLegacy.totalEarnings, 230);
assert.deepEqual(afterLegacy.deliveredOrders, { "03-161126-2": now });

// fresh numeric flags survive, stale ones are pruned → map stays bounded
const mixed = {
  totalOrders: 3,
  totalEarnings: 90,
  deliveredOrders: { fresh: now - 1000, stale: now - FLAG_TTL_MS - 1 },
};
const pruned = applyDeliveryStat(mixed, "03-161126-3", 25, now);
assert.equal(pruned.deliveredOrders?.fresh, now - 1000);
assert.equal(pruned.deliveredOrders?.stale, undefined);
assert.equal(Object.keys(pruned.deliveredOrders || {}).length, 2);
assert.equal(pruned.totalOrders, 4);

console.log("check-delivery-stats: all asserts passed");
