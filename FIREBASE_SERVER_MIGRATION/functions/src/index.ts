/**
 * Foodhubbie Firebase Functions 2nd Gen - Main Entry Point
 * 
 * Exports all HTTPS, Callable, Task Queue, Scheduled, and Trigger functions.
 * 
 * Deployment: firebase deploy --only functions
 */

// HTTPS Functions (Public Endpoints)
export { whatsappWebhook } from './api/whatsappWebhook';
// Batch 23d-1: the first control-API routes to leave EC2. Uploads were the most
// valuable to move first — every dish/category/combo/status image save goes
// through them, and they need no pm2 or socket. Wired by `config/mediaUrl`.
export { tenantMedia } from './api/tenantMedia';
// Batch 23d-2: the App Notifications send route. Pure cloud (verified token →
// tenant → FCM + inbox), so admin push works with the box down. Wired by
// `config/notifyUrl`.
export { tenantNotify } from './api/tenantNotify';
// Batch 23d-3: Supreme's onboarding group — D2 email-verified status,
// approve-onboarding (creates the tenant from a signup) and update-password.
// Pure cloud (Auth admin + RTDB), no pm2/socket. Wired by `config/adminUrl`.
export { tenantOnboarding } from './api/tenantOnboarding';

// Task Queue Functions (Async Processing)
export { processInboundMessage } from './taskqueue/processInboundMessage';
export { sendOutboundMessage } from './taskqueue/sendOutboundMessage';

// Scheduled Functions (Cron Jobs)
// walletGateCheck was DELETED in batch 14: it read the legacy (pruned)
// `businesses/{bid}/outlets/{oid}/billing` node, so it always believed every
// outlet was disarmed and reopened an armed gate within a minute.
export { metaCostPublisher } from './scheduled/metaCostPublisher';
// Batch 23a: out-of-band "box silent" alert. This is the ONLY watcher that runs
// outside EC2 - the 2026-11-11 outage was invisible for 13 hours because every
// signal we owned was written by the host that died.
export { platformHealth } from './scheduled/platformHealth';
// Batch 23d-4: website signup auto-approval + the 72 h unverified cleanup that
// used to live inside bot-control-api. Polls every 2 min (an RTDB trigger does
// not replay requests written while the function was cold); reuses the SAME
// `approveOnboardingRequest` the Supreme endpoint uses. Cleanup ships in
// observe mode - `meta/onboardingAuto/cleanupEnforce` turns deletion on.
export { onboardingWatcher } from './scheduled/onboardingWatcher';
// Batch 23i: daily rider settlement at 23:00 IST. Ports
// `runDailySettlement()` out of bot-control-api/server.js: riders with pending
// cash get one settlement record the admin can pay and the rider can confirm.
// No money moves. Enumerates `riderIndex` (never the `businesses` tree) and
// keeps the control API's `meta/dailySettlementLastRun` day claim, so the box
// and the cloud can never both settle a day. `foodhubbie-demo` is skipped.
export { dailySettlement } from './scheduled/dailySettlement';
// Batch 23j: the nightly public-demo reseed at 03:00 IST. The box cron died with
// the host on 2026-11-11 AND its seeder was broken independently (it read
// `Admin/js/demo/demo-data.js`, deleted as an orphan by the KDS review), so the
// demo has been frozen ever since. The builder is `tools/demo-seed-core.cjs`,
// vendored so the CLI and this function run the same bytes. It only touches the
// demo tenant: `businesses/foodhubbie-demo`, the server-only `walletBilling`
// row, `admins/{uid}`, removes `outletIndex/demo`, and never writes `whatsapp`.
export { demoReseed } from './scheduled/demoReseed';
// Batch 23l: the wallet gate publisher. The 60 s EC2 `wallet-watch.js` pass is
// deleted — it could never gate an armed outlet again with the box down. This
// job rebuilds every armed outlet's order-fee index exactly and sweeps gate +
// summary for unarmed outlets; the triggers below keep it fresh between passes.
export { walletGateReconcile } from './scheduled/walletGateReconcile';
// Batch: EC2 retirement — promo campaign scheduler. Picks up scheduled
// campaigns whose runAt is due and enqueues send tasks. Config flag:
// config/promoScheduler/enabled === true. Demo hard-skipped.
export { promoScheduler } from './scheduled/promoScheduler';
// Sends daily/weekly/monthly sales reports to outlet admins via WhatsApp.
// Config flag: config/dailyReports/enabled === true. Demo hard-skipped.
export { dailyReports } from './scheduled/dailyReports';

// Callable Functions (Admin/Client)
export { botControl } from './api/botControl';
export { onboardingApprove } from './api/onboardingApprove';
export { qrMenuOrder } from './api/qrMenuOrder';
export { qrMenuPayment } from './api/qrMenuPayment';
export { getWhatsAppQuota } from './api/getWhatsAppQuota';
export { transportSwitch } from './api/transportSwitch';

// RTDB Triggers (Event-Driven)
export { onOrderStatusChange } from './triggers/onOrderStatusChange';
// Batch: EC2 retirement — drains the webhookInbox queue that whatsappWebhook
// writes to, and enqueues processInboundMessage tasks. Config flag:
// config/webhookInbox/enabled === true. Demo hard-skipped.
export { onWebhookInboxMessage } from './triggers/webhookInbox';
// Sends WhatsApp "NEW ORDER" alert to outlet admins when status flips to Placed.
// Config flag: config/orderStatusAlert/enabled === true. Demo hard-skipped.
export { onOrderStatusAlert } from './triggers/orderStatusAlert';
// Batch 23c: runs the bot's own web/app order finalizer in DRY-RUN against live
// orders and compares its verdict with what the bot actually produced. It never
// writes to an order, a stock count, a reward or a billing row — only to
// `migrationShadow/orderFinalizer/...`. See the file header for the two stages.
export {
  onWebOrderPlacedShadow,
  onWebOrderFinalizedShadow,
} from './triggers/orderFinalizerShadow';
// Batch 23e: the three push paths that only existed inside the EC2 bot — new
// order -> admin devices, order status -> customer inbox + FCM, loyalty tier up
// -> customer inbox + FCM. Pure Admin SDK + FCM. `config/pushRelay/enabled`
// is the ONE switch: while it is not `true` every trigger is a no-op and the
// bot keeps sending, so this deploy alone changes no behaviour.
export {
  onOrderPushAdmin,
  onOrderPushCustomer,
  onLoyaltyTierUp,
} from './triggers/pushRelay';
// Batch 23f: the real browser-order finalizer (re-price, discount, reward
// tender, stock, profile, discount usage) and the cancel-side compensations
// (discount release + stock restore). `config/orderFinalizer/enabled === true`
// is the ONE switch: while it is not `true` both triggers are no-ops and the
// bot keeps finalizing, so this deploy alone changes no behaviour.
export {
  onWebOrderPlaced,
  onOrderCancelledCompensate,
} from './triggers/orderFinalizer';
// Batch 23g: loyalty — accrual on Delivered/Served, clawback on cancel/refund
// and bill void, dine-in earn on paymentStatus:'Paid', plus the app reward
// redemption queue. `config/loyaltyRelay/enabled === true` is the ONE switch:
// while it is not `true` every trigger is a no-op and the bot keeps owning
// loyalty, so this deploy alone changes no behaviour. The tier-up push is not
// here — `onLoyaltyTierUp` above fires from the loyalty write itself.
export {
  onOrderLoyaltyStatus,
  onOrderLoyaltyPayment,
  onRedeemRequest,
} from './triggers/loyaltyRelay';
// Batch 23h: rider pushes — assignment and the pickup/cancellation statuses.
// `config/riderRelay/enabled === true` is the ONE switch: while it is not
// `true` both triggers are no-ops and the bot keeps sending, so this deploy
// alone changes no behaviour. The `rider_assigned` WhatsApp TEMPLATE stays in
// the bot — it rides the socket and cannot follow.
export { onRiderAssigned, onRiderStatus } from './triggers/riderRelay';
// onWalletUpdate was DELETED in batch 14: it triggered on
// `walletBilling/{bid}/{oid}/balancePaise` — the META API credit line, not the
// restaurant wallet — and published the CUSTOMER-facing order gate from it,
// ignoring `wallet.enforce` entirely. Its balanceHistory rows had no reader.
// Never re-add a second writer of `walletGate`.
// Batch 23l: the one writer — an incremental order-fee index in `meta/walletWatch`
// fed by these three triggers, with `walletGateReconcile` above as the hourly
// authority. `bot-control-api/wallet-watch.js` (the EC2 60 s pass) is deleted in
// this batch, so there is no second owner and no feature flag.
export {
  onOrderBillingChange,
  onWalletLedgerChange,
  onWalletGateTouched,
} from './triggers/walletGate';
