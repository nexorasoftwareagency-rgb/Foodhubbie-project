/**
 * Batch 23g — one construction path for the vendored loyalty engine and the
 * redemption queue handler.
 *
 * The code itself is `bot/loyalty-engine.js` + `bot/redeem.js`, copied
 * byte-for-byte into `lib/vendor/` by `scripts/copy-vendor.cjs` (run by
 * `npm run build`). This file only supplies the tenant-pinned deps:
 *
 *   - `resolvePath` pins the tenant from the EVENT PATH, never from a
 *     reverse-index guess: the e2e business has an outlet literally named
 *     `pizza`, so a name-based lookup would write the LIVE tenant's loyalty.
 *   - `businessIdFor` is the pinned bid (the engine stores it on every node).
 *   - `onTierUp` is deliberately NOT passed: in the cloud the tier-up push is
 *     the `onLoyaltyTierUp` RTDB trigger (batch 23e), which fires from the
 *     loyalty write itself. Passing the bot's FCM sender here would send twice.
 */

import * as path from 'path';
import { tenantDb } from '../order-finalizer/factory';

/* eslint-disable @typescript-eslint/no-var-requires */
const VENDOR = path.join(__dirname, '../../vendor');
const { createLoyaltyEngine } = require(path.join(VENDOR, 'bot/loyalty-engine.js'));
const redeem = require(path.join(VENDOR, 'bot/redeem.js'));
const loyaltyMath = require(path.join(VENDOR, 'shared/loyalty-math.js'));
const moneyMath = require(path.join(VENDOR, 'shared/money-math.js'));
const { isDineInOrder, formatOrderId } = require(path.join(VENDOR, 'bot/utils.js'));
/* eslint-enable @typescript-eslint/no-var-requires */

export function makeLoyaltyEngine(bid: string, oid: string) {
  const { db, resolvePath } = tenantDb(bid, oid);
  const engine = createLoyaltyEngine({
    db,
    resolvePath,
    loyaltyMath,
    moneyMath,
    redeem,
    isDineInOrder,
    formatOrderId,
    businessIdFor: () => bid,
    defaultOutlet: oid,
  });
  return { engine, db, resolvePath, redeem };
}
