# Risks & Mitigation - Firebase Functions Migration

## Risk Matrix

| ID | Risk | Probability | Impact | Score | Mitigation Status |
|----|------|-------------|--------|-------|-------------------|
| R1 | Meta 20s webhook SLA breach | Medium | Critical | **High** | minInstances=5, load testing |
| R2 | Message loss during cutover | Low | Critical | **High** | Traffic mirroring, DLQ, reconciliation |
| R3 | Cold start latency spikes | Medium | High | **Medium** | minInstances on critical paths |
| R4 | Scheduled function cost overrun | Medium | Medium | **Medium** | Adaptive schedules, budget alerts |
| R5 | RTDB trigger infinite loops | Low | Critical | **Medium** | Idempotency keys, change detection |
| R6 | Meta API rate limit exceeded | Medium | High | **Medium** | Client-side rate limiting, backoff |
| R7 | Secret rotation failure | Low | Critical | **Medium** | Automated rotation, fallback |
| R8 | Team knowledge gap | Medium | Medium | **Medium** | Pair programming, docs, training |
| R9 | Vendor lock-in (Firebase) | High | Low | **Medium** | Abstract interfaces, portable logic |
| R10 | Debugging production issues | Medium | Medium | **Medium** | Structured logging, correlation IDs |
| R11 | RTDB connection limits | Low | High | **Medium** | Connection pooling, efficient listeners |
| R12 | Task queue backlog buildup | Medium | High | **Medium** | Monitoring, auto-scaling, dead letter |
| R13 | FCM token invalidation storms | Low | Medium | **Low** | Batch invalidation handling |
| R14 | Timezone/IST bugs in scheduled | Medium | Medium | **Medium** | Explicit IST handling, tests |
| R15 | Data inconsistency (EC2 vs Functions) | Medium | High | **High** | Dual-write period, reconciliation |

---

## Detailed Risk Analysis

### R1: Meta 20s Webhook SLA Breach

**Scenario:** Firebase Functions cold start + processing exceeds 20s, Meta marks webhook as failed, stops delivery.

**Probability:** Medium (cold starts 100-500ms, but under load can spike)

**Impact:** Critical — Message loss, Meta may disable webhook

**Mitigation:**
```typescript
// 1. Keep instances warm
export const whatsappWebhook = onRequest({
  minInstances: 5,           // Always 5 warm
  maxInstances: 500,
  concurrency: 100,          // Handle bursts
}, handler);

// 2. Respond FIRST, process LATER
export async function handler(req, res) {
  // Verify signature (<50ms)
  if (!verifySignature(req)) return res.status(401).send('Invalid');
  
  // Enqueue to Cloud Tasks (<50ms)
  await enqueueTask('processInboundMessage', parsePayload(req));
  
  // Respond immediately
  return res.status(200).send('OK');
  
  // Actual processing happens async in task queue
}
```

**Validation:** Load test at 2× peak (1000 concurrent) — p99 < 500ms

**Rollback:** Cloudflare Worker routes back to EC2 in <5 min

---

### R2: Message Loss During Cutover

**Scenario:** Messages processed by both EC2 and Functions, or neither during transition.

**Probability:** Low (with proper mirroring)

**Impact:** Critical — Lost orders, customer complaints

**Mitigation:**
```typescript
// 1. Idempotency key on every message
interface MessageRecord {
  messageId: string;        // Meta message ID
  processedAt: number;
  processedBy: 'ec2' | 'functions';
}

// 2. Check before processing
async function processMessage(message: MetaMessage) {
  const record = await db.ref(`processedMessages/${message.id}`).once('value');
  if (record.exists()) {
    logger.warn('Duplicate message ignored', { messageId: message.id });
    return;
  }
  
  // Process...
  
  // Mark processed
  await db.ref(`processedMessages/${message.id}`).set({
    processedAt: Date.now(),
    processedBy: 'functions'
  });
}

// 3. Reconciliation job (run hourly during cutover)
async function reconcileMessages() {
  const ec2Processed = await getEC2ProcessedIds();
  const fnProcessed = await getFunctionsProcessedIds();
  
  const missed = ec2Processed.filter(id => !fnProcessed.has(id));
  const duplicate = fnProcessed.filter(id => ec2Processed.has(id));
  
  if (missed.length > 0) {
    await alertTeam(`Missed messages: ${missed.length}`);
    // Re-process missed
  }
}
```

**Validation:** Hourly reconciliation during 2-week mirror period

---

### R3: Cold Start Latency Spikes

**Scenario:** Sudden traffic spike causes new instance spin-up, 1-3s latency.

**Probability:** Medium (traffic patterns unpredictable)

**Impact:** High — Webhook timeouts, poor UX

**Mitigation:**
```typescript
// 1. Minimum instances on critical paths
const CRITICAL_FUNCTIONS = {
  whatsappWebhook: 5,
  paymentWebhook: 3,
  qrMenuOrder: 2,
};

// 2. Pre-warm on schedule (for predictable peaks)
export const prewarmWebhook = onSchedule({
  schedule: 'every 1 minutes', // During peak hours only
  timeZone: 'Asia/Kolkata',
}, async () => {
  const hour = new Date().getHours();
  if (hour >= 11 && hour <= 14) return; // Lunch
  if (hour >= 19 && hour <= 21) return; // Dinner
  // No-op during peaks (instances already warm)
});

// 3. Monitor cold start metric
await recordMetric('cold_start_total', 1, { function: 'whatsappWebhook' });
```

**Alert:** Cold start rate > 5% of invocations

---

### R4: Scheduled Function Cost Overrun

**Scenario:** Wallet gate checking all 100 outlets every minute = 4.3M invocations/mo

**Probability:** Medium (if adaptive logic fails)

**Impact:** Medium — Unexpected bill ($50-100/mo)

**Mitigation:**
```typescript
// 1. Hard limit in code
const MAX_OUTLETS_PER_RUN = 50; // Process in batches
const MAX_RUNS_PER_MINUTE = 2;

// 2. Budget alert at $50/mo Functions
// Firebase Console → Billing → Budgets → Alert at 80%

// 3. Daily cost tracking
export async function trackScheduledCosts() {
  const usage = await getFunctionsUsage('scheduled');
  if (usage.estimatedCost > 40) {
    await sendSlackAlert(`⚠️ Scheduled functions cost: $${usage.estimatedCost}/mo`);
  }
}

// 4. Fail-safe: disable non-critical schedules if over budget
if (monthlyCost > 80) {
  await disableSchedule('promoScheduler'); // Keep wallet, costs, reports
}
```

---

### R5: RTDB Trigger Infinite Loops

**Scenario:** Trigger writes to same path it listens to, causing infinite recursion.

**Probability:** Low (with proper patterns)

**Impact:** Critical — Function quota exhaustion, costs

**Mitigation:**
```typescript
// 1. Only trigger on SPECIFIC field changes
export const onOrderStatusChange = onValueWritten({
  ref: 'businesses/{bid}/outlets/{oid}/orders/{orderId}/status', // Specific field
}, handler);

// 2. Check for actual change
export async function handler(event) {
  const before = event.data.before.val();
  const after = event.data.after.val();
  
  if (before === after) return; // No-op
  
  // 3. Use idempotency key for downstream writes
  const idempotencyKey = `status-${event.params.orderId}-${after}-${Date.now()}`;
  const existing = await db.ref(`idempotency/${idempotencyKey}`).once('value');
  if (existing.exists()) return;
  
  await db.ref(`idempotency/${idempotencyKey}`).set(true);
  
  // 4. TTL on idempotency keys (24h)
  await db.ref(`idempotency/${idempotencyKey}`).set({
    createdAt: Date.now()
  }, { ttl: 86400000 }); // Requires RTDB TTL support or manual cleanup
}
```

---

### R6: Meta API Rate Limit Exceeded

**Scenario:** Burst of outbound messages exceeds Meta's 1000 req/sec limit.

**Probability:** Medium (promo campaigns, order bursts)

**Impact:** High — Message send failures, temporary blocks

**Mitigation:**
```typescript
// 1. Client-side rate limiter (per outlet)
class MetaRateLimiter {
  private tokens = new Map<string, number>();
  private readonly LIMIT = 800; // Leave 20% headroom
  private readonly REFILL = 1000 / 60; // Per second
  
  async acquire(outlet: string): Promise<void> {
    const now = Date.now();
    let tokens = this.tokens.get(outlet) ?? this.LIMIT;
    const lastRefill = this.lastRefill.get(outlet) ?? now;
    
    // Refill tokens
    tokens = Math.min(this.LIMIT, tokens + (now - lastRefill) * this.REFILL / 1000);
    
    if (tokens < 1) {
      const waitMs = (1 - tokens) / this.REFILL * 1000;
      await sleep(waitMs);
      tokens = 1;
    }
    
    this.tokens.set(outlet, tokens - 1);
    this.lastRefill.set(outlet, now);
  }
}

// 2. Task queue rate limits
export const sendOutboundMessage = onTaskDispatched({
  rateLimits: {
    maxDispatchesPerSecond: 200, // Per outlet effectively
    maxConcurrentDispatches: 500,
  },
}, handler);

// 3. Exponential backoff on 429
async function sendWithRetry(payload, attempt = 0) {
  try {
    return await metaApi.send(payload);
  } catch (error) {
    if (error.status === 429 && attempt < 3) {
      const retryAfter = error.headers['retry-after'] || 60;
      await sleep(retryAfter * 1000);
      return sendWithRetry(payload, attempt + 1);
    }
    throw error;
  }
}
```

---

### R7: Secret Rotation Failure

**Scenario:** Meta system user token expires (60 days), rotation fails, all sends fail.

**Probability:** Low (with automation)

**Impact:** Critical — Complete outage

**Mitigation:**
```bash
# 1. Automated rotation via Cloud Scheduler + Cloud Function
# Rotate 7 days before expiry

# 2. Dual-token strategy
# Keep old token valid during transition
# Secret Manager: META_SYSTEM_USER_TOKEN_CURRENT, META_SYSTEM_USER_TOKEN_PREVIOUS

# 3. Fallback to outlet-level WA_PERMANENT_TOKEN
# If system token fails, use outlet token (less privileges but works for sends)

# 4. Alert 14 days before expiry
export const checkTokenExpiry = onSchedule({
  schedule: '0 9 * * *', // Daily 9 AM
}, async () => {
  const expiry = await getTokenExpiry('META_SYSTEM_USER_TOKEN');
  const daysLeft = (expiry - Date.now()) / 86400000;
  
  if (daysLeft < 14) {
    await sendSlackAlert(`🔑 Meta token expires in ${daysLeft} days`);
  }
  if (daysLeft < 3) {
    await sendPagerDutyAlert(`🚨 Meta token expires in ${daysLeft} days!`);
  }
});
```

---

### R8: Team Knowledge Gap

**Scenario:** Team unfamiliar with Functions 2nd Gen, Cloud Tasks, structured logging.

**Probability:** Medium

**Impact:** Medium — Slower development, bugs

**Mitigation:**
| Action | Timeline | Owner |
|--------|----------|-------|
| Internal workshop: Functions 2nd Gen | Week 0 | Tech Lead |
| Pair programming (experienced + new) | Phase 1-3 | All |
| Runbook for common tasks | Phase 5 | DevOps |
| Debugging guide (logs, traces) | Phase 5 | DevOps |
| Code review checklist | Week 0 | Tech Lead |

---

### R9: Vendor Lock-in

**Scenario:** Deep Firebase integration makes future migration hard.

**Probability:** High

**Impact:** Low (strategic, not operational)

**Mitigation:**
```typescript
// 1. Abstract interfaces
interface Database {
  get(path: string): Promise<any>;
  set(path: string, value: any): Promise<void>;
  transaction(path: string, updater: (current) => any): Promise<void>;
}

interface MessageQueue {
  enqueue(queue: string, payload: any): Promise<void>;
}

interface SecretManager {
  get(name: string): Promise<string>;
}

// 2. Implementations
class FirebaseDatabase implements Database { ... }
class CloudTasksQueue implements MessageQueue { ... }
class SecretManagerClient implements SecretManager { ... }

// 3. Dependency injection
const container = {
  db: new FirebaseDatabase(),
  queue: new CloudTasksQueue(),
  secrets: new SecretManagerClient(),
};

// Business logic uses interfaces only
async function processOrder(payload, { db, queue }) { ... }
```

---

### R10: Debugging Production Issues

**Scenario:** Function fails in production, logs insufficient to diagnose.

**Probability:** Medium

**Impact:** Medium — Longer MTTR

**Mitigation:**
```typescript
// 1. Structured logging with correlation IDs
function createLogger(context: string) {
  return {
    info: (msg: string, meta?: object) => 
      logger.info(JSON.stringify({ 
        level: 'info', 
        context, 
        message: msg, 
        correlationId: getCorrelationId(),
        timestamp: new Date().toISOString(),
        ...meta 
      })),
    error: (msg: string, error: Error, meta?: object) => 
      logger.error(JSON.stringify({ 
        level: 'error', 
        context, 
        message: msg, 
        error: { message: error.message, stack: error.stack },
        correlationId: getCorrelationId(),
        timestamp: new Date().toISOString(),
        ...meta 
      })),
  };
}

// 2. Correlation ID propagation
function getCorrelationId(): string {
  return (globalThis as any).__correlationId || 'unknown';
}

function setCorrelationId(id: string) {
  (globalThis as any).__correlationId = id;
}

// In webhook handler
setCorrelationId(req.headers['x-correlation-id'] || uuidv4());

// In task queue
await enqueueTask('process', { ...payload, correlationId: getCorrelationId() });

// 3. Cloud Trace integration
import { TraceServiceClient } from '@google-cloud/trace';
```

---

### R11: RTDB Connection Limits

**Scenario:** Too many concurrent listeners/functions hit RTDB connection limits.

**Probability:** Low (Functions scale connections)

**Impact:** High — Trigger failures

**Mitigation:**
```typescript
// 1. Use Admin SDK singleton
// functions/src/shared/firebase/admin.ts
let adminApp: admin.app.App | null = null;

export function getAdminApp(): admin.app.App {
  if (!adminApp) {
    adminApp = admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      databaseURL: process.env.FIREBASE_DATABASE_URL,
    });
  }
  return adminApp;
}

export function getDB(): admin.database.Database {
  return getAdminApp().database();
}

// 2. Efficient triggers (specific paths, not wildcards)
// GOOD: 'businesses/{bid}/outlets/{oid}/orders/{orderId}/status'
// BAD: 'businesses/{bid}/outlets/{oid}/orders/{orderId}'

// 3. Batch RTDB operations
async function batchUpdate(updates: Record<string, any>) {
  const chunks = Object.entries(updates).reduce((acc, [path, value], i) => {
    const chunkIndex = Math.floor(i / 100);
    if (!acc[chunkIndex]) acc[chunkIndex] = {};
    acc[chunkIndex][path] = value;
    return acc;
  }, [] as Record<string, any>[]);
  
  await Promise.all(chunks.map(chunk => getDB().ref().update(chunk)));
}
```

---

### R12: Task Queue Backlog Buildup

**Scenario:** Processing slower than enqueueing, queue grows unbounded.

**Probability:** Medium (during promo bursts)

**Impact:** High — Delayed messages, memory pressure

**Mitigation:**
```typescript
// 1. Monitoring alert
// Cloud Monitoring: cloudtasks.googleapis.com/queue/depth > 10000

// 2. Auto-scale workers (maxInstances)
export const processInboundMessage = onTaskDispatched({
  maxInstances: 200, // Scale up
  rateLimits: { maxDispatchesPerSecond: 500 },
}, handler);

// 3. Priority queues for critical messages
// Separate queue for order confirmations vs promos

// 4. Circuit breaker
let circuitOpen = false;
let failureCount = 0;

async function handler(payload) {
  if (circuitOpen) {
    // Re-queue with delay
    await enqueueTask('processInboundMessage', payload, { delaySeconds: 60 });
    return;
  }
  
  try {
    await process(payload);
    failureCount = 0;
  } catch (error) {
    failureCount++;
    if (failureCount > 10) {
      circuitOpen = true;
      setTimeout(() => { circuitOpen = false; failureCount = 0; }, 60000);
    }
    throw error;
  }
}
```

---

### R14: Timezone/IST Bugs

**Scenario:** Scheduled functions run at wrong time due to timezone confusion.

**Probability:** Medium

**Impact:** Medium — Reports at wrong time, wallet gate off-schedule

**Mitigation:**
```typescript
// 1. Explicit timezone in all schedules
export const dailyReports = onSchedule({
  schedule: '0 6 * * *', // 6 AM
  timeZone: 'Asia/Kolkata', // EXPLICIT
  region: 'us-central1',
}, handler);

// 2. IST helpers in shared code
// functions/src/shared/utils/dates.ts
export const IST_OFFSET = 5.5 * 60 * 60 * 1000;

export function getISTDateInfo(date = new Date()) {
  const ist = new Date(date.getTime() + IST_OFFSET);
  return {
    dateStr: ist.toISOString().split('T')[0],
    hour: ist.getUTCHours(),
    minute: ist.getUTCMinutes(),
    dayOfWeek: ist.getUTCDay(), // 0=Sunday
    monthKey: ist.toISOString().slice(0, 7), // YYYY-MM
  };
}

// 3. Unit tests for all schedules
test('dailyReports runs at 6 AM IST', () => {
  const schedule = '0 6 * * *';
  const tz = 'Asia/Kolkata';
  // Verify with cron-parser
  const next = cronParser.parseExpression(schedule, { tz }).next();
  expect(next.getUTCHours()).toBe(0); // 6 AM IST = 0:30 UTC? No, 6 AM IST = 0:30 UTC
  // Actually: IST = UTC+5:30, so 6 AM IST = 0:30 UTC
});
```

---

### R15: Data Inconsistency During Dual-Write

**Scenario:** EC2 and Functions both writing to RTDB, conflicts or duplicates.

**Probability:** Medium (during 2-week mirror)

**Impact:** High — Incorrect wallet, orders, reports

**Mitigation:**
```typescript
// 1. Single writer per data type
// Wallet gate: ONLY Functions writes
// Bot status: ONLY EC2 writes (until cutover)
// Orders: Both can write, but use transactions

// 2. Transaction for critical writes
async function updateWalletGate(bid, oid, gate) {
  await db.ref(`businesses/${bid}/outlets/${oid}/walletGate`)
    .transaction(current => {
      if (current === gate) return; // Abort, no change
      return gate;
    });
}

// 3. Version vectors for conflict detection
interface VersionedData<T> {
  data: T;
  version: number;
  writer: 'ec2' | 'functions';
  timestamp: number;
}

// 4. Reconciliation job
export const reconcileData = onSchedule({
  schedule: '0 * * * *', // Hourly during cutover
  timeZone: 'Asia/Kolkata',
}, async () => {
  // Compare wallet gates
  // Compare order counts
  // Alert on drift > 1%
});
```

---

## Incident Response Runbooks

### INC-01: Webhook 5xx Errors > 1%

**Detection:** Cloud Monitoring alert on `cloudfunctions.googleapis.com/function/executions` with status=error

**Response:**
1. Check Function logs for error pattern
2. If cold start: increase minInstances
3. If Meta API error: check Meta status page
4. If code bug: hotfix deploy (<15 min)
5. If persistent: route to EC2 via Cloudflare

### INC-02: Task Queue Depth > 10,000

**Detection:** Cloud Monitoring alert on `cloudtasks.googleapis.com/queue/depth`

**Response:**
1. Check worker error rate
2. Increase maxInstances temporarily
3. Pause non-critical enqueues (promos)
4. Scale up manually if needed
5. Post-incident: analyze root cause

### INC-03: Meta Token Expired

**Detection:** 401/403 on Graph API calls, token expiry alert

**Response:**
1. Rotate token via Secret Manager
2. Deploy new secret (no code change needed)
3. Verify sends work
4. Update rotation calendar

### INC-04: Wallet Gate Stuck

**Detection:** Merchant reports wallet not blocking/allowing correctly

**Response:**
1. Check walletGateCheck function logs
2. Verify walletBilling data integrity
3. Manual recompute: `walletGatePublish({bid, oid})`
4. Fix root cause (data corruption, logic bug)

---

## Post-Migration Monitoring (First 30 Days)

| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| Webhook p99 latency | < 300ms | > 500ms |
| Webhook error rate | < 0.1% | > 1% |
| Task queue depth | < 100 | > 1000 |
| Task queue processing time | < 5s | > 30s |
| Scheduled function success | 100% | < 100% |
| Functions cost/day | < $2 | > $5 |
| Cold start rate | < 2% | > 5% |
| RTDB trigger latency | < 1s | > 5s |

---

## Success Criteria (Sign-off)

- [ ] 30 days zero message loss
- [ ] 30 days zero SLA breach
- [ ] Functions cost < $50/mo
- [ ] Team can debug independently
- [ ] Runbooks validated in fire drill
- [ ] EC2 fully decommissioned
- [ ] Documentation complete