/**
 * migrate-roshani.mjs — one-time data migration: prashant-pizza-e86e4 (flat) -> foodhubbie-10 (multi-tenant).
 *
 * Reads the already-exported flat DB JSON and writes the tenant structure.
 * Each restaurant is its OWN business (one outlet each):
 *   pizza/*          -> businesses/roshani-pizza/outlets/pizza/*
 *   cake/*           -> businesses/roshani-cake/outlets/cake/*
 *   bot/pizza/*      -> businesses/roshani-pizza/outlets/pizza/bot/*
 *   bot/cake/*       -> businesses/roshani-cake/outlets/cake/bot/*
 *   shared root      -> admins, riders, riderStats, logs, settlements,
 *                       migrationStatus, botUsers, settings, bot/commands|logs|status
 *
 * Usage: node tools/migrate-roshani.mjs <export.json> <serviceAccount.json> [dbUrl]
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const admin = require('../bot/node_modules/firebase-admin');

const [src, sa, dbUrl = 'https://foodhubbie-10-default-rtdb.firebaseio.com'] = process.argv.slice(2);
if (!src || !sa) {
    console.error('usage: node tools/migrate-roshani.mjs <export.json> <service-account.json> [dbUrl]');
    process.exit(1);
}

const data = JSON.parse(readFileSync(src, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(require(sa)), databaseURL: dbUrl });
const db = admin.database();
const root = db.ref();

const shared = ['admins', 'riders', 'riderStats', 'logs', 'settlements', 'migrationStatus', 'botUsers', 'settings'];
const strip = (o) => JSON.parse(JSON.stringify(o));

async function main() {
    // shared root nodes copy as-is
    for (const k of shared) {
        if (data[k]) {
            await root.child(k).set(strip(data[k]));
            console.log(`  root/${k}  (${Object.keys(data[k]).length} keys)`);
        }
    }
    // shared bot state
    const botShared = {};
    for (const k of ['commands', 'logs', 'status']) {
        if (data.bot && data.bot[k] !== undefined) botShared[k] = data.bot[k];
    }
    if (Object.keys(botShared).length) {
        await root.child('bot').set(strip(botShared));
        console.log('  root/bot  (shared commands/logs/status)');
    }

    // Separate restaurants: each outlet is its OWN business with one outlet.
    //   pizza -> businesses/roshani-pizza/outlets/pizza
    //   cake  -> businesses/roshani-cake/outlets/cake
    for (const [bid, oid, srcKey] of [['roshani-pizza', 'pizza', 'pizza'], ['roshani-cake', 'cake', 'cake']]) {
        const outlet = strip(data[srcKey] || {});
        if (data.bot && data.bot[srcKey]) outlet.bot = strip(data.bot[srcKey]);
        const ref = root.child(`businesses/${bid}/outlets/${oid}`);
        await ref.set(outlet);
        console.log(`  businesses/${bid}/outlets/${oid}  (${Object.keys(outlet).length} keys)`);
    }
    console.log('\nMigration complete.');
    process.exit(0);
}

main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
