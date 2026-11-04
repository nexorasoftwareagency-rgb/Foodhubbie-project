/**
 * D4 wallet gate read — the public `outlets/{oid}/walletGate` flag.
 * bot-control-api publishes it ONLY while `billing.wallet.enforce` is armed
 * ('low' | 'closed', '' when healthy); absent = no gate.
 *
 * Read fresh, not via getData: its 30 s cache would keep handing out order
 * links after the owner flips the flag. Fail open — a DB hiccup must never
 * take ordering down. The decision table lives in utils.walletGateBlocks().
 */
const { db, resolvePath } = require('./firebase');

async function getWalletGate(outlet = 'pizza') {
    try {
        const snap = await db.ref(resolvePath('walletGate', outlet)).once('value');
        return String(snap.val() || '').trim().toLowerCase() || null;
    } catch (e) {
        console.warn('[WALLET] gate read failed:', e.message);
        return null;
    }
}

module.exports = { getWalletGate };
