/**
 * BigQuery billing-export readiness check (read-only).
 *
 *   node tools/check-billing-export.cjs
 *
 * Why this exists: enabling the Cloud Billing → BigQuery export is a
 * console-only setting (there is no public API — the billingDataExports route
 * 404s), so the click cannot be automated or verified from `firebase deploy`.
 * This script is how we prove the click landed, without opening the console:
 *
 *   Cloud Billing adds `billing-export-bigquery@system.gserviceaccount.com` as an
 *   OWNER of the dataset the moment an export is saved. That ACL entry is the
 *   definitive signal — a dataset can exist for days and still never have been
 *   attached to an export.
 *
 * Credentials: the owner's `firebase login` refresh token (the Firebase CLI
 * config). The admin SDK service account has no Cloud Billing or BigQuery IAM,
 * so it cannot answer any of this. Run it on the dev machine only.
 *
 * Exit codes: 0 = export attached, 1 = not attached yet, 2 = could not check.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const PROJECT = process.env.FH_PROJECT || 'foodhubbie-10';
const DATASET = process.env.FH_DATASET || 'billing_export_us';
const BILLING = process.env.FH_BILLING || '015AD6-4B5D4F-657177';
// gcp_billing_export_v1_<billing account id with dashes -> underscores>
const TABLE = `gcp_billing_export_v1_${BILLING.replace(/-/g, '_')}`;
const EXPORT_SA = 'billing-export-bigquery@system.gserviceaccount.com';

function cliRefreshToken() {
    const p = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
    if (!fs.existsSync(p)) throw new Error(`Firebase CLI config not found at ${p} — run "firebase login" first`);
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    const token = j.tokens && j.tokens.refresh_token;
    if (!token) throw new Error('No refresh token in the Firebase CLI config — run "firebase login"');
    return token;
}

async function accessToken() {
    const body = new URLSearchParams({
        // The public firebase-tools OAuth client — same one `firebase login` used.
        client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
        client_secret: 'j9iVZfS8kkCEFUPaAeJV0sAi',
        refresh_token: cliRefreshToken(),
        grant_type: 'refresh_token'
    });
    const r = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
    });
    const j = await r.json();
    if (!r.ok) throw new Error('Token refresh failed: ' + JSON.stringify(j).slice(0, 200));
    return j.access_token;
}

async function api(token, url, method = 'GET', payload) {
    const r = await fetch(url, {
        method,
        headers: { Authorization: 'Bearer ' + token, ...(payload ? { 'Content-Type': 'application/json' } : {}) },
        body: payload ? JSON.stringify(payload) : undefined
    });
    return { status: r.status, body: await r.json().catch(() => null) };
}

const inr = (n) => '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
    const token = await accessToken();

    const acct = await api(token, `https://cloudbilling.googleapis.com/v1/billingAccounts/${BILLING}`);
    if (acct.status !== 200) {
        console.error(`  cannot read billing account ${BILLING}: HTTP ${acct.status}`);
        process.exit(2);
    }
    console.log(`billing account  ${acct.body.displayName} (${BILLING})  ${acct.body.currencyCode}  open=${acct.body.open}`);

    const ds = await api(token, `https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT}/datasets/${DATASET}`);
    if (ds.status === 404) {
        console.error(`  dataset ${PROJECT}.${DATASET} does not exist — create it first (US multi-region for backfill)`);
        process.exit(2);
    }
    if (ds.status !== 200) {
        console.error(`  cannot read dataset: HTTP ${ds.status}`);
        process.exit(2);
    }

    const sa = (ds.body.access || []).find((a) => String(a.userByEmail || '').includes('billing-export-bigquery'));
    console.log(`dataset          ${PROJECT}.${DATASET}  location=${ds.body.location}`);
    console.log(`export attached  ${sa ? 'YES — ' + EXPORT_SA + ' is ' + sa.role : 'NO — the export has never been saved'}`);

    const tables = await api(token, `https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT}/datasets/${DATASET}/tables`);
    const names = (tables.body && tables.body.tables || []).map((t) => t.tableReference.tableId);
    console.log(`tables           ${names.length ? names.join(', ') : '(none yet)'}`);

    if (!names.includes(TABLE)) {
        console.log(`\nexpected table   ${TABLE}  (appears a few hours after Save)`);
        if (sa) console.log('export is wired — data is still propagating. Re-run later.');
        else console.log('nothing to query: enable the export in the console (see FIREBASE_SERVER_MIGRATION/21_BILLING_EXPORT.md)');
        process.exit(sa ? 0 : 1);
    }

    const meta = await api(token, `https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT}/datasets/${DATASET}/tables/${TABLE}`);
    console.log(`rows             ${meta.body.numRows}   bytes=${meta.body.numBytes}`);

    const q = await api(token, `https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT}/queries`, 'POST', {
        useLegacySql: false,
        maxResults: 100,
        query: `
            SELECT DATE(usage_start_time) AS day,
                   ROUND(SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)), 2) AS net_inr,
                   COUNT(*) AS lines
            FROM \`${PROJECT}.${DATASET}.${TABLE}\`
            GROUP BY 1 ORDER BY 1 DESC LIMIT 14`
    });
    if (q.status !== 200) {
        console.log('  cost query failed: HTTP', q.status, JSON.stringify(q.body).slice(0, 300));
        process.exit(sa ? 0 : 1);
    }
    console.log('\nnet cost by usage day (INR, credits applied)');
    (q.body.rows || []).forEach((r) => {
        const [day, net, lines] = r.f.map((c) => c.v);
        console.log(`  ${day}  ${inr(net).padStart(12)}  ${lines} lines`);
    });
    if (!(q.body.rows || []).length) console.log('  (no rows yet — backfill can take up to 5 days)');

    const svc = await api(token, `https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT}/queries`, 'POST', {
        useLegacySql: false,
        maxResults: 25,
        query: `
            SELECT service.description AS service,
                   ROUND(SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)), 2) AS net_inr
            FROM \`${PROJECT}.${DATASET}.${TABLE}\`
            WHERE cost_type = 'regular'
            GROUP BY 1 ORDER BY 2 DESC LIMIT 15`
    });
    if (svc.status === 200) {
        console.log('\nnet cost by service (all time in the table, usage only)');
        (svc.body.rows || []).forEach((r) => {
            const [name, net] = r.f.map((c) => c.v);
            console.log(`  ${String(name).padEnd(46)} ${inr(net).padStart(12)}`);
        });
    }

    process.exit(0);
})().catch((e) => {
    console.error('CHECK FAILED —', e.message);
    process.exit(2);
});
