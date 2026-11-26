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
// promoScheduler was DELETED in batch 23n (never deployed). It ported only the
// "which campaigns are due" half of `bot/promotions.js` and handed every
// recipient to the `sendOutboundMessage` task queue — which is the superseded
// product on a taskQueue path that still falls back to the wrong
// `foodhubbie-prod` project. Batch 23q replaced that idea with the real engine:
// `promotionSweep` below runs the SAME vendored `runSlice()` the bot runs, so
// pacing, opt-out, consent, prepaid tokens, template shells and every pause
// reason are byte-identical. Do not re-add a stub here.
// Batch 23n: daily/weekly/monthly sales summary over the Cloud API (the bot's
// `sendDailyReportSafely` was socket-only). Config flag:
// config/dailyReports/enabled === true. Demo hard-skipped.
export { dailyReports } from './scheduled/dailyReports';
// Batch 23q: the promotions dispatcher. One tick per minute reads the tiny
// `meta/promotionsActive` index (written by `onPromotionStatus`) and runs ONE
// bounded slice per due campaign, so a 70-90 minute campaign fits inside
// request-scoped runtimes. It also owns the daily 30-day log/campaign expiry.
// Config flag: config/promotionsRelay/enabled === true. Demo hard-skipped.
export { promotionSweep } from './scheduled/promotionSweep';

// Callable Functions (Admin/Client)
export { botControl } from './api/botControl';
export { onboardingApprove } from './api/onboardingApprove';
export { qrMenuOrder } from './api/qrMenuOrder';
export { qrMenuPayment } from './api/qrMenuPayment';
export { getWhatsAppQuota } from './api/getWhatsAppQuota';
export { transportSwitch } from './api/transportSwitch';

// RTDB Triggers (Event-Driven)
export { onOrderStatusChange } from './triggers/onOrderStatusChange';
// Batch 23m: drains the webhookInbox queue that whatsappWebhook writes to and
// runs the real inbound handler (`bot/inbound-flow.js`, vendored) — greeting,
// menu CTA, webview token, opt-out, strikes/freeze, rate limit, chat log.
// Config flag: config/webhookInbox/enabled === true. Demo hard-skipped.
export { onWebhookInboxMessage } from './triggers/webhookInbox';
// Batch 23n: WhatsApp "NEW ORDER" alert to the outlet's own team, parity with
// the bot's `alertAdminFinalizedWebOrder`. Fires on the finalizer's
// `stockDeducted` leaf (once per order, after the money is final) and claims
// `_adminWaNotified` before sending. Config flag:
// config/orderStatusAlert/enabled === true. Demo hard-skipped.
export { onOrderStatusAlert } from './triggers/orderStatusAlert';
// Batch 23o: the dashboard's `bot/commands` queue — the Admin Chat tab (and the
// Analytics/Riders service messages) write `SEND_GENERIC_MESSAGE` there and the
// bot's socket-only listener drained it. This ports that branch: text first, the
// approved template only on Graph 131047 (outside the 24h window), RTDB-backed
// freeze, real chat row with the Graph message id. Batch 23q added the
// `SEND_PROMOTION` hand-off (own flag `config/promotionsRelay`, delete-then-run
// so the campaign document stays the source of truth); the report actions stay
// untouched. Config flags: config/botCommands/enabled + config/promotionsRelay.
// Demo hard-skipped.
export { onBotCommand } from './triggers/botCommands';
// Batch 23q: keeps `meta/promotionsActive/{bid}/{oid}/{campaignId}` in step with
// a campaign's status leaf, so the per-minute sweep never queries every outlet's
// campaigns node. It never runs a slice — slice 1 is `onBotCommand`, every later
// slice is `promotionSweep`. Config flag: config/promotionsRelay/enabled.
export { onPromotionStatus } from './triggers/promotionRelay';
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
