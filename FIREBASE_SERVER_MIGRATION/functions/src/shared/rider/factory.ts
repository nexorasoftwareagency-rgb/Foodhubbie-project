/**
 * Batch 23h — the only construction path for the vendored rider push module.
 *
 * `bot/rider-push.js` is vendored byte-for-byte into `lib/vendor/` by
 * `scripts/copy-vendor.cjs`, so the WhatsApp bot and these triggers build the
 * same copy text and resolve `order.riderId` (UID or email) with the same
 * rules. The tenant is pinned FROM THE EVENT PATH — never a reverse-index
 * guess (the e2e business holds an outlet literally named `pizza`).
 */

import * as path from 'path';
import { logger } from 'firebase-functions/v2';
import { getDB, getMessaging } from '../firebase/admin';
import { isDeadPushCode } from '../notify/caps';
import { formatOrderId } from '../utils';

/* eslint-disable @typescript-eslint/no-var-requires */
const { createRiderPush, riderStatusEvent } = require(
  path.join(__dirname, '../../vendor/bot/rider-push.js'),
);
/* eslint-enable @typescript-eslint/no-var-requires */

export { riderStatusEvent };

export function makeRiderPush(bid: string, oid: string) {
  const db = getDB();
  const base = `businesses/${bid}/outlets/${oid}`;
  return createRiderPush({
    db,
    // The bot's resolvePath(path, outlet) signature. Here the tenant is known,
    // so the outlet argument is deliberately ignored.
    resolvePath: (p: string) => `${base}/${p}`,
    getRiderByEmail: async (email: string) => {
      const riders = (await db.ref(`${base}/riders`).once('value')).val() || {};
      const want = String(email).toLowerCase();
      for (const uid of Object.keys(riders)) {
        if (String((riders[uid] && riders[uid].email) || '').toLowerCase() === want) {
          return { uid, ...riders[uid] };
        }
      }
      return null;
    },
    isDeadPushCode,
    // Lazy handle: a cold-start ordering change in the Admin SDK cannot break
    // the factory, and no Messaging instance outlives an invocation.
    messaging: { send: (msg: any) => getMessaging().send(msg) },
    formatOrderId,
    log: (message: string, meta?: Record<string, unknown>) => logger.warn(message, meta),
  });
}
