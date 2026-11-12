# 21 — Invoice-exact cost numbers: BigQuery billing export

Status: **provisioned, NOT yet enabled** (one console click outstanding at
2026-11-11 19:41 IST). No cost data exists in BigQuery yet; nothing in this
document is a measured number.

Closes the open item in `16_HOSTING_EGRESS_ASSET_DIET.md` §"Open": *invoice-exact
numbers need a BigQuery billing export; none exists on this project.*

## 1. Why the existing numbers are not invoice lines

Every ₹ figure in batches 11–20 came from **Cloud Monitoring metrics**
(`sent_bytes_count`, hosting byte counts) multiplied by the published rate card.
For RTDB that reads ~3× high — `11_RTDB_COST_INCIDENT.md` §6 records
23.7 GiB/Nov 1–10 ≈ ₹1.7 k against an actual ₹469.36 alert. For Hosting the
mechanism is physically reproduced (batch 16), so those numbers hold; RTDB's do
not. Only the billing export answers "what did Firebase actually charge, per
SKU, per day, in INR".

## 2. State verified on the project (2026-11-11)

| Thing | Value | How |
|---|---|---|
| BigQuery API | **ENABLED** | `serviceusage …/services/bigquery.googleapis.com` |
| Billing account | `015AD6-4B5D4F-657177` "Firebase Payment", **open**, currency **INR** | `cloudbilling v1/billingAccounts/{id}` |
| Linked projects | `foodhubbie-10` only | `…/billingAccounts/{id}/projects` |
| Dataset `billing_export` | exists, **`asia-south1`**, **0 tables**, created 08:38 IST today | BigQuery API |
| Dataset `billing_export_us` | created by this batch, **`US`**, **0 tables** | BigQuery API |
| Export ever enabled? | **No** — `billing-export-bigquery@system.gserviceaccount.com` is absent from both datasets | dataset ACL |
| API to enable it | **None** | `billingAccounts/{id}/billingDataExports` → 404 |

## 3. The decision that cannot be undone: dataset location

Google backfills **only** into a multi-region dataset (US or EU):

> "If you configure the dataset to use a multi-region location (EU or US), the
> dataset includes Google Cloud billing data incurred from the start of the
> previous month from when you first enabled the export."

A *region* dataset (`asia-south1`) starts at the enable date and **never**
backfills. The dataset already on the project was `asia-south1` — enabling into
it would have produced history starting today and left the Nov 8–10 peak
unrecoverable for ever.

So `billing_export_us` was created (US multi-region, empty, free to create).
Enabling into it backfills **1 Oct 2026 → now** over up to five days, in
chronological order.

`billing_export` (asia-south1) is empty, was never attached to an export, and is
safe to delete. It is left in place in case the owner prefers Mumbai data
residency and accepts no backfill.

Do **not** plan to switch dataset/project later: a switch does not backfill, and
reconciling the two requires a manual `JOIN`.

## 4. The click (console-only, must be done by the owner)

`https://console.cloud.google.com/billing/export` (or
`https://console.cloud.google.com/billing/015AD6-4B5D4F-657177/export`)

1. **BigQuery export** tab → **Standard usage cost** card → **Enable standard usage cost export**.
2. **Projects**: `foodhubbie-10`. **Dataset ID**: `billing_export_us`. **Save**.
3. Do **not** enable Detailed usage cost (adds resource-level data that is empty
   for RTDB/Hosting/Storage) or Pricing (needs the Data Transfer Service API and
   only carries SKU list prices).
4. Requires **Billing Account Administrator** or **Costs Manager** on
   `015AD6-4B5D4F-657177` — project Owner (`nexorasoftwareagency@gmail.com` is
   Owner on the project) does **not** imply billing roles.

## 5. How to prove the click landed without the console

`node tools/check-billing-export.cjs` (read-only, dev machine, uses the
`firebase login` refresh token because the admin SDK service account has no
Cloud Billing or BigQuery IAM).

The decisive signal is the dataset ACL: Cloud Billing adds
`billing-export-bigquery@system.gserviceaccount.com` as **OWNER** of the dataset
the moment an export is saved. A dataset with no such entry has never been
attached — that is how the 08:38 dataset was proven unused.

Exit codes: `0` attached (data may still be propagating), `1` not attached,
`2` could not check.

## 6. Table and queries

Table (dashes → underscores):

```
foodhubbie-10.billing_export_us.gcp_billing_export_v1_015AD6_4B5D4F_657177
```

Net cost always means `cost` **plus** the `credits` array (free-tier and
promotion credits arrive as separate negative line items):

```sql
SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0))
```

* **Daily shape** — `GROUP BY DATE(usage_start_time)`, ordered desc.
* **Per service** — `GROUP BY service.description` with `cost_type = 'regular'`
  (RTDB / Hosting / Storage / Functions split).
* **Peak hours** — `GROUP BY TIMESTAMP_TRUNC(usage_start_time, HOUR), sku.description`
  over 2026-11-08…10, ordered by cost desc.
* **Invoice reconciliation** — `GROUP BY invoice.month, cost_type`, using
  **`invoice.month`** and not a timestamp: end-of-month usage legitimately rolls
  into the next invoice, and `cost_type = 'tax'` (18 % GST) is a separate line,
  so the invoice reads ≈ usage × 1.18.

Full copy-paste versions live in the chat guide; keep them in sync if edited.

## 7. Cost of having it

Zero at this scale: BigQuery's 10 GiB storage and 1 TiB/month query processing
free tiers are orders of magnitude above a single-project billing export (single
digit MB per month; every query here scans < 1 MB). BigQuery does require
billing enabled on the project, which it already is.

## 8. Limits (honest)

* The export records **when it was enabled**; the five-day backfill covers the
  previous month (Oct 2026) and the current one. Anything earlier (Sep 2026 and
  before) is not obtainable — the console **Cost table** CSV download is the only
  source for those months.
* Data for the last ~24 h keeps changing; a query run mid-day is not the final
  number.
* Never `INSERT` into the export table (the exporter deletes foreign rows) and
  never remove the export service account from the dataset.
* The table schema can change under you; if this is ever automated into a
  dashboard, query a **view**, not the raw table.
* Standard export has no resource-level rows, so "which bot/outlet cost the
  bytes" stays a modelling question — the export gives SKU × project × day, and
  per-outlet attribution still comes from the RTDB profiler.

## 9. Blocked on

Owner clicks **Enable standard usage cost export** → `billing_export_us`.
Then: `node tools/check-billing-export.cjs` until it exits 0 with rows, and
replace this section with the measured Oct/Nov 2026 breakdown.
