# EC2 RETIREMENT PLAN — SUPERSEDED

**Status: superseded 2026-11-17. Do not implement from this document.**

**Authoritative document: [`PLAN/BACKEND-ARCHITECTURE.md`](./BACKEND-ARCHITECTURE.md).**

---

## What this document was

A 473-line plan to retire EC2 entirely: move the WhatsApp bot, order handling,
promotions and reporting to Cloud Functions, and run the platform with no
server. It contained the current-state inventory, a gap analysis, a cloud-only
target architecture, a function-by-function specification list, and a phased
migration.

Batches 23a-23l of that migration **did ship** and are live: order
finalization, loyalty, redemption, push, rider notifications, media,
notifications, onboarding, settlement, demo reseed and the wallet gate all run
on Functions today. `FIREBASE_SERVER_MIGRATION/23_*` through `41_*` are their
per-batch records.

## Why it was superseded

The owner reversed the retirement decision on 2026-11-17. EC2 is retained
**permanently** as a deliberately scoped host for the one workload that cannot
be done serverlessly at acceptable cost: a long-lived Baileys WhatsApp socket.

The reasoning, in short:

- **Cost.** Meta's India rate card is roughly ₹0.86-1.15 per billable message
  after the 1,000/month/number free tier. One active outlet sending ~5,400
  messages a month costs ~₹3,800/month on the official API — more than the
  entire EC2 bill. The socket does the same work for a flat fee.
- **Fitness.** A WhatsApp socket is stateful and long-lived; Cloud Functions are
  request-scoped. Pacing outbound messages 4-8 seconds apart (the ban-proofing
  requirement) is impossible in a per-invocation runtime.
- **Tenancy.** Per the 2026-11-01 decision each restaurant owns its own WABA, so
  the platform pays Meta usage directly. That makes per-message pricing a
  first-class cost, not a rounding error.

What the plan got right, and was kept, is the split of **database effects** onto
Functions. What it got wrong was the assumption that the **transport** had to
follow them. It did not.

## What specifically did not survive

| proposed in this plan | outcome |
|---|---|
| `onWebhookInboxMessage` (trigger draining the inbox) | **deleted, never deployed.** It deletes inbox entries after enqueueing, which would race the bot's own drain and silently steal inbound messages |
| `processInboundMessage` (task queue) | **deleted.** Prices cart lines at `price: 0`, writes `source:'WA'` orders the finalizer deliberately skips, invents a cart state machine the real bot does not have, and writes opt-out to the wrong path |
| `sendOutboundMessage` (task queue) | **deleted.** Same class of problem |
| `promoScheduler` | **deleted, never deployed.** Its only job was to tell EC2 to send a WhatsApp message — the wrong side of the boundary |
| `dailyReports` | **deleted, never deployed.** Same |
| `botControl`, `transportSwitch`, `qrMenuOrder`, `qrMenuPayment`, `getWhatsAppQuota`, `onboardingApprove` | **deleted.** Verified dead: zero client callers |
| `onOrderStatusChange`, both `orderFinalizerShadow` triggers | **deleted.** Migration scaffolding with no readers |
| cloud-only target architecture (§4) | **replaced** by the scoped-host model in `BACKEND-ARCHITECTURE.md` §3 |
| phased migration (§5-6) | **replaced** by phases M1-M4 in `BACKEND-ARCHITECTURE.md` §10 |

## Where the surviving content went

| topic | new home |
|---|---|
| deployed-function inventory | `BACKEND-ARCHITECTURE.md` §2.1 |
| EC2 inventory (processes, routes, listeners) | `BACKEND-ARCHITECTURE.md` §2.3-2.5 |
| config flags | `BACKEND-ARCHITECTURE.md` §2.6, §3.4 |
| gap analysis | resolved; recorded as the deletion list in §9 |
| target architecture | `BACKEND-ARCHITECTURE.md` §3 |
| migration phases | `BACKEND-ARCHITECTURE.md` §10 |
| cost model | `BACKEND-ARCHITECTURE.md` §11 |
| provisioning a box | `BACKEND-ARCHITECTURE.md` §5 |

Kept in the repository because the batch records (`FIREBASE_SERVER_MIGRATION/`)
reference it, and because the reversal itself is worth being able to read.
