/**
 * BOT-SIDE DISCOUNT ENGINE — the WhatsApp bot's instance of the shared core.
 *
 * The logic lives in `bot/discount-engine-core.js` (dependency-injected, no
 * `./firebase` import) so the same code can run inside Cloud Functions with the
 * Functions admin instance. This shim keeps every existing `require('./discount-engine')`
 * call site unchanged: same exports, same behaviour, built from `bot/firebase.js`.
 *
 * Batch 23c. Never put logic here — put it in the core.
 */

const { db, getData, resolvePath } = require('./firebase.js');
const { createDiscountEngine, discountAmount } = require('./discount-engine-core.js');

module.exports = {
    ...createDiscountEngine({ db, getData, resolvePath }),
    discountAmount,
};
