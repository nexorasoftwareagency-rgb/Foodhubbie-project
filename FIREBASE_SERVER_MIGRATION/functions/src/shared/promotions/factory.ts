/**
 * Batch 23q — the Functions-side promotions runtime.
 *
 * The campaign logic is NOT here. It lives in two socket-free bot modules,
 * copied byte-for-byte into `lib/vendor/` by `scripts/copy-vendor.cjs`:
 *
 *   bot/promotions-rules.js   every decision — quiet hours, warm-up ladder,
 *                             scheduling, pause reasons, pacing, consent copy.
 *   bot/promotions-engine.js  `runSlice()` (one bounded slice of a campaign),
 *                             the per-campaign lease, token charge, opt-out,
 *                             failure circuit breaker, 30-day log expiry.
 *
 * `bot/promotions.js` binds the SAME engine to the bot's Baileys socket; this
 * file binds it to a Cloud API transport, so the bot and the cloud sweep can
 * never drift (the batch-23q reason the old 400-line bot copy was deleted).
 *
 * What a request-scoped runtime must add, and nothing else:
 *
 *   - a transport that always claims `isMeta: true`. `makeMetaTransport()`
 *     returns a sock-shaped object with no `isMeta` flag, and the engine uses
 *     that flag to refuse promotional sends on a non-official transport. The
 *     wrapper here is what makes the cloud path legal instead of pausing every
 *     campaign with `transport-blocked`.
 *   - a tenant pinned from the EVENT PATH (`businesses/{bid}/outlets/{oid}`),
 *     never a reverse-index guess — the e2e business holds an outlet literally
 *     named `pizza`.
 *   - the RTDB-backed freeze read. `bot/utils.js isJidFrozen` is an in-process
 *     Map; a Function has no process between invocations, so the same
 *     ban-proofing state is read from `bot/chatState/{phone10}/frozenUntil`
 *     (written by `bot/inbound-flow.js`).
 *   - `isDegraded` is a constant `false`: a Cloud API transport has no socket to
 *     lose and no crypto session to thrash.
 *   - the outbound counter the Admin chat/analytics KPIs read
 *     (`bot/usage/{IST-date}` `{total, promo, updatedAt}`), because the engine
 *     cannot see the bot's `OutboundTracker`.
 *
 * `walletBilling/{bid}/{oid}` is the server-only ledger. It must NEVER go
 * through `tenantPathResolver` (that would produce a phantom tenant path) and
 * the engine reads it through the absolute `billingPath`.
 */

import * as path from 'path';
import { getDB } from '../firebase/admin';
import { makeTenantTransport, tenantPathResolver } from '../whatsapp/factory';

/* eslint-disable @typescript-eslint/no-var-requires */
// `../../vendor`, not `../vendor`: this file compiles to `lib/shared/promotions/`,
// so the parent of that folder is `lib/` where `copy-vendor.cjs` writes `vendor/`.
const VENDOR = path.join(__dirname, '../../vendor');
const { createPromotionsEngine } = require(path.join(VENDOR, 'bot/promotions-engine.js'));
const PROMO_RULES = require(path.join(VENDOR, 'bot/promotions-rules.js'));
/* eslint-enable @typescript-eslint/no-var-requires */

type Log = (...args: any[]) => void;

/** Exported so the sweep can share `TERMINAL_STATUSES` instead of re-listing it. */
export { PROMO_RULES };

/**
 * `walletBilling/{bid}/{oid}/{path}` — absolute, exactly like the bot's
 * `bot/firebase.js billingPath()`. The engine passes an outlet argument that is
 * deliberately ignored: re-resolving this path would write a token charge to a
 * node nobody reads.
 */
export function promotionBillingPath(bid: string, oid: string) {
  return (p: string) => `walletBilling/${bid}/${oid}/${String(p || '').replace(/^\/+/, '')}`;
}

export interface PromotionTransportOptions {
  log?: Log;
}

/**
 * The engine-shaped transport (`{isMeta, sendTemplate?, sendMessage}`).
 * Throws when the outlet has no WhatsApp number connected or the platform token
 * is missing — the caller turns that into a `no-number` pause, never a send
 * from another tenant's number.
 */
export async function makePromotionTransport(
  bid: string,
  oid: string,
  opts: PromotionTransportOptions = {},
) {
  const { transport } = await makeTenantTransport(bid, oid, opts);
  return {
    // Load-bearing: the engine pauses a non-meta transport before its first
    // send. A Cloud API transport is always official.
    isMeta: true,
    sendTemplate: (jid: any, payload: any) => (transport as any).sendTemplate(jid, payload),
    sendMessage: (jid: any, content: any, sendOpts?: any) =>
      (transport as any).sendMessage(jid, content, sendOpts),
  };
}

export interface PromotionEngineOptions {
  log?: Log;
  /**
   * Skip the transport entirely. The daily expiry pass only reads and deletes,
   * and a tenant that has no number connected still needs its 30-day-old logs
   * removed — building a transport there would throw for no reason.
   */
  skipTransport?: boolean;
}

export interface PromotionEngineHandle {
  engine: any;
  transport: any | null;
  transportError: string | null;
  db: any;
  resolvePath: (p: string) => string;
  billingPath: (p: string) => string;
  tenant: string;
  outlet: string;
}

/**
 * Build the ONE engine for a tenant. A missing number is NOT an error here: the
 * engine pauses the campaign with `no-number` (the owner sees why on the card)
 * instead of the trigger throwing and the campaign silently doing nothing.
 */
export async function makePromotionEngine(
  bid: string,
  oid: string,
  opts: PromotionEngineOptions = {},
): Promise<PromotionEngineHandle> {
  const db = getDB();
  const log: Log = opts.log || ((...a: any[]) => console.log(...a));
  const resolvePath = tenantPathResolver(bid, oid);
  const billingPath = promotionBillingPath(bid, oid);
  const tenant = `businesses/${bid}/outlets/${oid}`;

  const readTenant = async (p: string) => {
    try {
      const snap = await db.ref(`${tenant}/${p}`).once('value');
      return snap && typeof (snap as any).val === 'function' ? (snap as any).val() : null;
    } catch {
      return null;
    }
  };

  let transport: any = null;
  let transportError: string | null = null;
  if (opts.skipTransport === true) {
    // Expiry-only caller: no number needed, no transport built.
  } else {
    try {
      transport = await makePromotionTransport(bid, oid, { log: () => {} });
    } catch (e: any) {
      transportError = (e && e.message) || String(e);
      log(`[Promo] ${bid}/${oid} has no usable number yet: ${transportError}`);
    }
  }

  // Same bucket the bot's OutboundTracker writes, so `wa-analytics.js` and the
  // Chat tab KPIs keep counting promo sends after the move.
  const istDate = () => new Date(Date.now() + 5.5 * 3600000).toISOString().split('T')[0];

  const engine = createPromotionsEngine({
    db,
    resolvePath,
    billingPath,
    outlet: oid,
    transport,
    getStore: () => readTenant('settings/Store'),
    getCustomer: (phone: string) =>
      readTenant(`customers/${String(phone || '').replace(/\D/g, '').slice(-10)}`),
    // The warm-up ladder ramps from the day the number was linked. The cloud has
    // no `bot/pair` node; `waLinkSuccess()` stamps `whatsapp/connectedAt`.
    getFirstLinkedAt: async () => Number(await readTenant('whatsapp/connectedAt')) || 0,
    isFrozen: async (_jid: string, phone: string) => {
      const p10 = String(phone || '').replace(/\D/g, '').slice(-10);
      if (!p10) return false;
      const until = Number(await readTenant(`bot/chatState/${p10}/frozenUntil`)) || 0;
      return until > Date.now();
    },
    // A Cloud API transport cannot lose a socket and has no crypto session.
    isDegraded: async () => false,
    onTrack: () => {
      db.ref(`${tenant}/bot/usage/${istDate()}`)
        .transaction((cur: any) => {
          const next = cur || {};
          next.total = (next.total || 0) + 1;
          next.promo = (next.promo || 0) + 1;
          next.updatedAt = Date.now();
          return next;
        })
        .catch(() => {});
    },
    log: { log, info: log, warn: log, error: log, debug: log },
  });

  return { engine, transport, transportError, db, resolvePath, billingPath, tenant, outlet: oid };
}
