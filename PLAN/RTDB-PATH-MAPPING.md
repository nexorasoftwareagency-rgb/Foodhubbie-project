================================================================================
FOODHUBIE — EC2 → CLOUD FUNCTIONS MIGRATION
RTDB PATH MAPPING (PLAN/RTDB-PATH-MAPPING.md)
================================================================================

Complete matrix of RTDB paths → functions that read/write them, with roles.

================================================================================
1. TOP-LEVEL RTDB NODES
================================================================================

Node                          | Reads                                  | Writes                                 | Roles
------------------------------|----------------------------------------|----------------------------------------|-------
businesses/{bid}              | outlet resolution, store settings      | outlet creation (onboarding)           | isSuper/isSupreme (write), signed-in (read)
businesses/{bid}/outlets/{oid}| outlet config, settings, bot state     | outlet settings, bot config            | outlet admin (own), isSuper/isSupreme
businesses/{bid}/outlets/{oid}/settings/Store | storeName, branding (public reads) | Admin save settings | signed-in non-anon (read), outlet admin (write)
businesses/{bid}/outlets/{oid}/settings/Delivery | delivery slabs, coords | Admin save delivery | outlet admin (write)
businesses/{bid}/outlets/{oid}/orders/{orderId} | order finalization, status alerts, loyalty | order creation (client), status updates (bot/cloud) | client (create), admin (read/write)
businesses/{bid}/outlets/{oid}/tableSessions | dining session state | session create/attach/close | client + admin
businesses/{bid}/outlets/{oid}/customers/{phone} | customer profile, loyalty, consent | customer registration | device-bound (own phone)
businesses/{bid}/outlets/{oid}/pushSubscriptions/{tokenKey} | FCM push targeting | client subscribes, cloud prunes dead | client (own token), cloud (prune)
businesses/{bid}/outlets/{oid}/pushInbox/{phone} | in-app notification list | cloud writes inbox rows | cloud (write), device-bound (read)
businesses/{bid}/outlets/{oid}/webhookInbox/{pushId} | inbound WhatsApp queue | whatsappWebhook writes, onWebhookInboxMessage deletes | whatsappWebhook (write), cloud trigger (delete)
businesses/{bid}/outlets/{oid}/bot/promotions/campaigns/{id} | promo scheduler reads | client creates campaigns, cloud updates status | client (create), cloud (status update)
businesses/{bid}/outlets/{oid}/bot/promotions/optout/{phone} | opt-out check | client opts out/in | client (own phone)
businesses/{bid}/outlets/{oid}/bot/redeemQueue/{reqId} | loyalty redeem trigger reads | client creates redemption request | client (create), cloud (process)
businesses/{bid}/outlets/{oid}/bot/redeemClaims/{key} | redeem claim checks | cloud redeem trigger writes claim | cloud only
bot/sessions/{jid}/{oid} | conversation session state | processInboundMessage writes | cloud only (NEW)
bot/rateLimits/{jid}/{oid} | rate limit counters | processInboundMessage writes | cloud only (NEW)
bot/strikes/{jid}/{oid} | ban-proofing strike count | processInboundMessage writes | cloud only (NEW)
bot/processedMessages/{msgId} | message dedupe | processInboundMessage writes | cloud only (NEW)
walletBilling/{bid}/{oid} | wallet gate publisher reads | Admin/Supreme payments, metaCostPublisher | super/supreme only (write)
meta/walletWatch/{bid}/{oid} | wallet gate index reads/writes | wallet-gate triggers + reconcile | cloud only
config/{feature}/enabled | feature flag gates | Admin/Supreme toggles | super/supreme only
outletIndex/{oid} | outlet→business resolution | onboarding creates entry | onboarding (write), all (read)
admins/{uid} | admin JIDs, roles, FCM tokens | onboarding creates, self-update | self (own), super/supreme (all)
chats/{customerId} | chat history list | chat-log.js writes, cloud processInboundMessage | cloud/write
chatMeta/{customerId} | chat meta mirror (50 limit) | chat-log.js writes | cloud/write
loyalty/{phone} | loyalty points, tier | loyalty triggers write | cloud/write
loyalty/rankings | leaderboard | loyalty triggers update | cloud/write
loyalty/config | earn/tier config | Admin saves | outlet admin (write)
riders/{uid} | rider profile, FCM token | rider app registers | rider (own)
settlements/{uid} | rider settlement records | dailySettlement writes | cloud only
bot/alerts/{outlet} | ban alerts | bot writes ban alerts | bot (EC2 only, being retired)

================================================================================
2. NEW PATHS (Cloud Functions Only)
================================================================================

Path                              | Written by                  | Read by                    | Purpose
----------------------------------|-----------------------------|----------------------------|----------
bot/sessions/{jid}/{oid}          | processInboundMessage       | processInboundMessage      | Conversation session state (replaces Redis)
bot/rateLimits/{jid}/{oid}        | processInboundMessage       | processInboundMessage      | Per-sender rate limiting (4-8s gap)
bot/strikes/{jid}/{oid}           | processInboundMessage       | processInboundMessage      | 3-strike ban-proofing freeze
bot/processedMessages/{msgId}     | processInboundMessage       | processInboundMessage      | Message ID dedupe (TTL 24h)
orders/{orderId}/_adminWaNotified | onOrderStatusAlert          | onOrderStatusAlert         | Admin WhatsApp alert dedupe

================================================================================
3. CONFIG FLAG PATHS
================================================================================

Path                              | Default | Gate                         | Set by
----------------------------------|---------|------------------------------|--------
config/webhookInbox/enabled       | false   | onWebhookInboxMessage        | Supreme Admin / RTDB console
config/orderStatusAlert/enabled   | false   | onOrderStatusAlert           | Supreme Admin / RTDB console
config/promoScheduler/enabled     | false   | promoScheduler               | Supreme Admin / RTDB console
config/dailyReports/enabled       | false   | dailyReports                 | Supreme Admin / RTDB console

Existing flags (already deployed, all ON):
config/orderFinalizer/enabled     | true    | onWebOrderPlaced, onOrderCancelledCompensate
config/loyaltyRelay/enabled       | true    | onOrderLoyaltyStatus, onOrderLoyaltyPayment, onRedeemRequest
config/riderRelay/enabled         | true    | onRiderAssigned, onRiderStatus
config/pushRelay/enabled          | true    | onOrderPushAdmin, onOrderPushCustomer, onLoyaltyTierUp

================================================================================
4. EGRESS GUARD (Batch-11 Lesson)
================================================================================

NO new function may read the whole `businesses` tree. All reads must be:
- Single leaf: db.ref(`businesses/{bid}/outlets/{oid}/...`).once('value')
- Indexed query: query(path, orderByChild('...'), limitToLast(N))
- outletIndex iteration (small: ~40 outlets max)

Forbidden: db.ref('businesses').once('value') — causes 5MB+ reads per invocation.

================================================================================
END OF RTDB PATH MAPPING
================================================================================
