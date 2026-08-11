# Prasant Pizza ERP — Architecture

```mermaid
flowchart LR
    subgraph Customers["Customer Menu App"]
        M[menu/ — QR ordering]
        O[order.js — order lifecycle]
        S[session.js — session + PII]
        M --> O --> S
    end

    subgraph Admin["Admin Dashboard"]
        A[Admin/dist — tables, orders, POS]
        T[features/tables.js — session policing]
        P[features/promotions.js — promo engine]
        C[features/catalog.js — menu catalog]
    end

    subgraph Rider["Rider App"]
        R[rider-app/dist — dispatch]
    end

    DB[(Firebase Realtime DB)]
    FNS[Cloud Functions]

    S -- "session attach (transaction)" --> DB
    A -- "tableSessions / orderGroups" --> DB
    A --> T
    P --> DB
    C --> DB
    R --> DB
    FNS --> DB
    DB -. "world-readable menu/catalog" .-> M
    DB -. "auth-gated tableSessionsContact (PII)" .-> A

    subgraph Deploy["Firebase Hosting — 3 targets"]
        DA[hosting:admin → Admin/dist]
        DR[hosting:rider → rider-app/dist]
        DM[hosting:menu → menu]
    end

    DA -. deploy .-> A
    DR -. deploy .-> R
    DM -. deploy .-> M
```

## Key flows
- Order: created as `Pending` → promoted to `Placed` only after session attach succeeds.
- PII (phone) lives in `tableSessionsContact` (auth-gated); `tableSessions` is world-readable without it.
- Totals everywhere use `_effectiveTotal(sess)` — table card, drawer, CSV, KPI.
- Billing excludes cancelled orders; `_policeExpiredSessions` cancels orders and clears arrays on expiry.

## Deployment
`npm run build` then `firebase deploy --only hosting:admin` (per target), or all: `firebase deploy --only database,hosting`.
