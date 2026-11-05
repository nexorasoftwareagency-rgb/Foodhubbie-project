/**
 * Integration tests against the REAL Firebase DB (Section 17.5 gate).
 * Skips silently when bot/service-account.json or DB URL is absent
 * (service account is a human-provided credential — see 7.2).
 * Run: node --test bot/tests/integration.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const SERVICE_ACCOUNT = path.join(__dirname, '..', 'service-account.json');
const DB_URL = process.env.FIREBASE_DB_URL || 'https://foodhubbie-10-default-rtdb.firebaseio.com';

function hasCredentials() {
    return fs.existsSync(SERVICE_ACCOUNT);
}

test('Section 17.5 gate: businesses/{bid}/outlets/{oid} exists in real DB', { skip: !hasCredentials() }, async (t) => {
    const admin = require('firebase-admin');
    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert(require(SERVICE_ACCOUNT)),
            databaseURL: DB_URL
        });
    }
    const snap = await admin.database().ref('businesses').limitToFirst(1).once('value');
    const data = snap.val();
    assert.ok(data, 'FAIL: no businesses/ node found — refactor not deployed yet');
    const bid = Object.keys(data)[0];
    const outlets = data[bid].outlets;
    assert.ok(outlets, `FAIL: businesses/${bid}/outlets missing`);
    assert.ok(Object.keys(outlets).length > 0, `FAIL: businesses/${bid}/outlets is empty`);
    const oid = Object.keys(outlets)[0];
    assert.ok(outlets[oid], `FAIL: businesses/${bid}/outlets/${oid} missing`);
    console.log(`OK: found businesses/${bid}/outlets/${oid}`);
});
