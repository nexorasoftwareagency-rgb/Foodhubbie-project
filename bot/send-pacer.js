const MIN_GAP_MS = 1500;
let _lastBurstSendAt = 0;

async function paceBurstSend() {
    const now = Date.now();
    const wait = Math.max(0, _lastBurstSendAt + MIN_GAP_MS - now);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    _lastBurstSendAt = Date.now();
}

module.exports = { paceBurstSend, MIN_GAP_MS };
