/**
 * Batch 23j — one construction path for the vendored demo tenant builder.
 *
 * The builder itself is `tools/demo-seed-core.cjs` (static content in
 * `tools/demo-fixtures.cjs`), copied byte-for-byte into `lib/vendor/` by
 * `scripts/copy-vendor.cjs` (run by `npm run build`). This file only supplies
 * the deps the CLI supplies on a laptop:
 *
 *   - `now` — the builder's ONLY clock. A frozen value produces a
 *     byte-identical payload, which is how the guard proves determinism and how
 *     a dry run can be compared with what the Function actually wrote.
 *   - `money` — the real `shared/money-math.js` plus `computePayroll` from
 *     `shared/payroll-math.js`. Both are vendored as ESM (`lib/vendor/shared/
 *     package.json {"type":"module"}`), so `require(esm)` gives the same rupee
 *     arithmetic the live ERP and the CLI use.
 *   - `live` — the source catalog, read over the public RTDB REST API. The demo
 *     must showcase the real menu (prices, sizes, photos, combos), and those
 *     nodes are world-readable because the customer menu needs them, so no
 *     credential and no Admin SDK read is involved.
 *
 * Nothing here writes to the database: `demoReseed.ts` owns the writes (Auth
 * upsert + the four RTDB nodes), exactly like `tools/seed-demo-tenant.cjs` owns
 * them on the command line.
 */

import * as path from 'path';
import { getDB } from '../firebase/admin';

/* eslint-disable @typescript-eslint/no-var-requires */
const VENDOR = path.join(__dirname, '../../vendor');
const core = require(path.join(VENDOR, 'tools/demo-seed-core.cjs'));
const fixtures = require(path.join(VENDOR, 'tools/demo-fixtures.cjs'));
const moneyMath = require(path.join(VENDOR, 'shared/money-math.js'));
const payrollMath = require(path.join(VENDOR, 'shared/payroll-math.js'));
/* eslint-enable @typescript-eslint/no-var-requires */

/** The demo tenant ids live in ONE place: the vendored builder. */
export const DEMO_BID: string = core.BID;
export const DEMO_OID: string = core.OID;
export const DEMO_EMAIL: string = core.DEMO_EMAIL;
export const DEMO_PASSWORD: string = core.DEMO_PASSWORD;
export const DEMO_NAME: string = core.DEMO_NAME;
export const DEMO_SOURCE_BID: string = core.SOURCE_BID;
export const DEMO_SOURCE_OID: string = core.SOURCE_OID;

export interface DemoSeedStats {
  orders: number;
  openSessions: number;
  customers: number;
  dishes: number;
  combos: number;
  staff: number;
  payrollLines: number;
  payrollNet: number;
  payloadBytes: number;
}

export interface DemoSeedTenant {
  business: Record<string, any>;
  billing: Record<string, any>;
  stats: DemoSeedStats;
}

/**
 * The RTDB REST origin for the public catalog read. `FIREBASE_DATABASE_URL` is
 * bound as an env var by the function's `secrets` list, which avoids a Secret
 * Manager round-trip; the app option is the fallback for a local invoke.
 */
export function demoDbUrl(): string {
  const fromEnv = String(process.env.FIREBASE_DATABASE_URL || '').trim();
  const fromApp = String(getDB().app.options.databaseURL || '').trim();
  const url = fromEnv || fromApp;
  if (!url) throw new Error('demoReseed: no database URL (FIREBASE_DATABASE_URL unset)');
  return url.replace(/\/+$/, '');
}

/**
 * Build the whole demo tenant in memory. Pure apart from the catalog `fetch`:
 * the same `now` + the same live catalog always yield the same bytes.
 */
export async function buildDemoTenant(
  opts: { now: number; dbUrl?: string } = { now: Date.now() }
): Promise<DemoSeedTenant> {
  const live = await core.loadLiveCatalog({ dbUrl: opts.dbUrl || demoDbUrl() });
  const money = { ...moneyMath, computePayroll: payrollMath.computePayroll };
  const seed = core.createDemoSeedCore({ now: opts.now, money, fixtures, live });
  return seed.buildTenant();
}
