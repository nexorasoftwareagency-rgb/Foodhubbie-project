/**
 * Meta Cost Tracking — a thin binding over the ONE cost recorder.
 *
 * The recorder is `bot/meta-cost.js`, copied byte-for-byte into `lib/vendor/`
 * (see `scripts/copy-vendor.cjs`), so the WhatsApp transport, this task-queue
 * caller and the dashboards all bill at the same rate table
 * (`shared/meta-cost-math.js`: ₹0.115 utility/auth/service · ₹0.86 marketing).
 *
 * Two bugs lived in the previous version of this file:
 *   1. hard-coded rates (`template/text -> 115`, everything else `86`), which
 *      drifted from the shared table the moment the rate card changed;
 *   2. it decremented `walletBilling/{bid}/{oid}/balancePaise` itself, racing
 *      `metaCostPublisher`, which DERIVES that node as
 *      `START_PAISE - metaUsage[month].totalCostPaise`. One node, one writer:
 *      the publisher owns `balancePaise`, so this function only records usage.
 */

import * as path from 'path';
import { getDB } from '../firebase/admin';

/* eslint-disable @typescript-eslint/no-var-requires */
const { createMetaCost } = require(path.join(__dirname, '../../vendor/bot/meta-cost.js'));
/* eslint-enable @typescript-eslint/no-var-requires */

/**
 * Record one delivered Meta send.
 *
 * @param type     the wire type the caller sent (`text`, `template`, …) — kept
 *                 for call-site compatibility; the rate comes from `category`.
 * @param category `utility` (default) or `marketing`. A marketing template must
 *                 be named as such by the caller: this layer has the send type,
 *                 not the template name.
 */
export async function recordMetaCost(
  businessId: string,
  outlet: string,
  type: string,
  category: 'utility' | 'marketing' = 'utility',
): Promise<void> {
  try {
    const cost = createMetaCost({ db: getDB(), bid: businessId, oid: outlet });
    await cost.record(category);
  } catch (error) {
    // Cost recording is informational — never fail a send because of it.
    console.error('[MetaCost] Failed to record cost', { type, error: (error as Error).message });
  }
}

export default {
  recordMetaCost,
};
