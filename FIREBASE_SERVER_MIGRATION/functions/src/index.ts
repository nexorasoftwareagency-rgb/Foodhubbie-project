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

// Callable Functions (Admin/Client)
export { botControl } from './api/botControl';
export { onboardingApprove } from './api/onboardingApprove';
export { qrMenuOrder } from './api/qrMenuOrder';
export { qrMenuPayment } from './api/qrMenuPayment';
export { getWhatsAppQuota } from './api/getWhatsAppQuota';
export { transportSwitch } from './api/transportSwitch';

// RTDB Triggers (Event-Driven)
export { onOrderStatusChange } from './triggers/onOrderStatusChange';
export { onWalletUpdate } from './triggers/onWalletUpdate';
