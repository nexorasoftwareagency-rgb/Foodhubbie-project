/**
 * Foodhubbie Firebase Functions 2nd Gen - Main Entry Point
 * 
 * Exports all HTTPS, Callable, Task Queue, Scheduled, and Trigger functions.
 * 
 * Deployment: firebase deploy --only functions
 */

// HTTPS Functions (Public Endpoints)
export { whatsappWebhook } from './api/whatsappWebhook';

// Task Queue Functions (Async Processing)
export { processInboundMessage } from './taskqueue/processInboundMessage';
export { sendOutboundMessage } from './taskqueue/sendOutboundMessage';

// Scheduled Functions (Cron Jobs)
// walletGateCheck was DELETED in batch 14: it read the legacy (pruned)
// `businesses/{bid}/outlets/{oid}/billing` node, so it always believed every
// outlet was disarmed and reopened an armed gate within a minute — while
// bot-control-api/wallet-watch.js is the real publisher. Never re-add a second
// writer of `walletGate`.
export { metaCostPublisher } from './scheduled/metaCostPublisher';
// Batch 23a: out-of-band "box silent" alert. This is the ONLY watcher that runs
// outside EC2 - the 2026-11-11 outage was invisible for 13 hours because every
// signal we owned was written by the host that died.
export { platformHealth } from './scheduled/platformHealth';

// Callable Functions (Admin/Client)
export { botControl } from './api/botControl';
export { onboardingApprove } from './api/onboardingApprove';
export { qrMenuOrder } from './api/qrMenuOrder';
export { qrMenuPayment } from './api/qrMenuPayment';
export { getWhatsAppQuota } from './api/getWhatsAppQuota';
export { transportSwitch } from './api/transportSwitch';

// RTDB Triggers (Event-Driven)
export { onOrderStatusChange } from './triggers/onOrderStatusChange';
// Batch 23c: runs the bot's own web/app order finalizer in DRY-RUN against live
// orders and compares its verdict with what the bot actually produced. It never
// writes to an order, a stock count, a reward or a billing row — only to
// `migrationShadow/orderFinalizer/...`. See the file header for the two stages.
export {
  onWebOrderPlacedShadow,
  onWebOrderFinalizedShadow,
} from './triggers/orderFinalizerShadow';
// onWalletUpdate was DELETED in batch 14: it triggered on
// `walletBilling/{bid}/{oid}/balancePaise` — the META API credit line, not the
// restaurant wallet — and published the CUSTOMER-facing order gate from it,
// ignoring `wallet.enforce` entirely. Its balanceHistory rows had no reader.
// Never re-add a second writer of `walletGate`.
