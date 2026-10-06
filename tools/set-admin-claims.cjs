// Sets (or revokes) the `admin: true` custom claim on Firebase Auth accounts.
//
// WHY THIS EXISTS
// database.rules.json used to grant unconditional write access to admins/$uid
// to two hardcoded Gmail addresses. That was replaced with the
// `auth.token.admin == true` custom claim, which is set server-side with the
// Admin SDK, is revocable instantly, and keeps no email address in the rules.
// Run THIS SCRIPT FIRST, verify it reports SAFE, and only then deploy the rules.
//
// USAGE
//   node tools/set-admin-claims.cjs --dry-run owner@example.com other@example.com
//   node tools/set-admin-claims.cjs owner@example.com other@example.com
//   node tools/set-admin-claims.cjs --revoke former-owner@example.com
//
// After setting a claim, that user must sign out and sign back in (or wait up
// to ~1 hour) before their ID token carries it. Existing custom claims (e.g.
// isSuper / isSupport used by SupremeAdmin) are preserved, never overwritten.

'use strict';

/** Split CLI args into flags and email addresses. */
function parseArgs(argv) {
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const emails = argv
    .filter((a) => !a.startsWith('--'))
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const unknown = [...flags].filter((f) => f !== '--dry-run' && f !== '--revoke');
  return { dryRun: flags.has('--dry-run'), revoke: flags.has('--revoke'), emails, unknown };
}

/** Merge the admin claim into existing claims without dropping any others. */
function mergeClaims(existing, revoke) {
  const next = { ...(existing || {}) };
  if (revoke) delete next.admin;
  else next.admin = true;
  return next;
}

/**
 * Will this account still be able to write admins/$uid once the email clauses
 * are gone from the rules? It can if it holds the admin claim afterwards, or if
 * its admins/{uid} node already has isSuper === true (the other rule branch).
 */
function retainsAccess(claimsAfter, dbIsSuper) {
  return claimsAfter.admin === true || dbIsSuper === true;
}

async function main() {
  const { dryRun, revoke, emails, unknown } = parseArgs(process.argv.slice(2));

  if (unknown.length) {
    console.error(`Unknown flag(s): ${unknown.join(', ')}`);
    process.exit(2);
  }
  if (!emails.length) {
    console.error('Usage: node tools/set-admin-claims.cjs [--dry-run] [--revoke] <email> [<email> ...]');
    process.exit(2);
  }

  const admin = require('../bot/node_modules/firebase-admin');
  const serviceAccount = require('../bot/service-account.json');
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: 'https://foodhubbie-10-default-rtdb.firebaseio.com',
  });

  console.log(`${dryRun ? '[DRY RUN] ' : ''}${revoke ? 'Revoking' : 'Granting'} admin claim for ${emails.length} account(s)\n`);

  let failures = 0;
  let allRetainAccess = true;

  for (const email of emails) {
    let user;
    try {
      user = await admin.auth().getUserByEmail(email);
    } catch (err) {
      console.error(`✗ ${email}: no Firebase Auth account found (${err.code || err.message})`);
      failures++;
      allRetainAccess = false;
      continue;
    }

    const before = user.customClaims || {};
    const after = mergeClaims(before, revoke);
    const dbIsSuper = (await admin.database().ref(`admins/${user.uid}/isSuper`).once('value')).val();
    const keeps = retainsAccess(after, dbIsSuper);

    console.log(`• ${email}  (uid ${user.uid}, emailVerified: ${user.emailVerified})`);
    console.log(`    claims before : ${JSON.stringify(before)}`);
    console.log(`    claims after  : ${JSON.stringify(after)}`);
    console.log(`    admins/{uid}.isSuper in database: ${dbIsSuper === true}`);
    console.log(`    keeps write access to admins/ after rules change: ${keeps ? 'YES' : 'NO'}`);

    if (!keeps) allRetainAccess = false;

    if (!dryRun) {
      try {
        await admin.auth().setCustomUserClaims(user.uid, after);
        console.log('    ✓ claims written');
      } catch (err) {
        console.error(`    ✗ failed to write claims: ${err.message}`);
        failures++;
      }
    }
    console.log('');
  }

  if (dryRun) {
    console.log('Dry run only — nothing was written.');
  } else if (!revoke && !failures) {
    console.log('Reminder: each user must sign out and back in before their token carries the new claim.');
  }

  if (!revoke) {
    console.log(
      allRetainAccess && !failures
        ? '\nVERDICT: SAFE — every listed account keeps access once the hardcoded emails are removed from the rules.'
        : '\nVERDICT: DO NOT DEPLOY THE RULES YET — at least one account would lose write access to admins/.'
    );
  }

  process.exit(failures ? 1 : 0);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}

module.exports = { parseArgs, mergeClaims, retainsAccess };
