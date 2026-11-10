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
export { walletGateCheck } from './scheduled/walletGateCheck';
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
