/**
 * End-to-end proof of the webhook -> bot hop (run manually; hits live infra).
 *
 *   node FIREBASE_SERVER_MIGRATION/functions/test/webhook-inbox.e2e.cjs
 *
 * Flow proved here:
 *   Meta-shaped signed POST -> whatsappWebhook (Cloud Function)
 *     -> businesses/{bid}/outlets/{oid}/webhookInbox
 *     -> createMetaTransport() child_added drain (the real bot code)
 *     -> messages.upsert with the right text + JID, entry deleted.
 *
 * Requires the repo's bot/service-account.json and gcloud auth for the two
 * Meta secrets. Never touches a running bot: the live pizza outlet is on the
 * Baileys transport, so this process is the only consumer of the queue.
 */
const crypto = require('crypto');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../../..');
const { createMetaTransport } = require(path.join(ROOT, 'bot/transport'));
const { db } = require(path.join(ROOT, 'bot/firebase'));

const GCLOUD = (() => {
  if (process.env.GCLOUD_BIN) return process.env.GCLOUD_BIN;
  const win = 'C:\\Program Files (x86)\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd';
  return process.platform === 'win32' && require('fs').existsSync(win) ? win : 'gcloud';
})();
const PROJECT = process.env.GCLOUD_PROJECT || 'foodhubbie-10';
const URL = process.env.WEBHOOK_URL || 'https://whatsappwebhook-xydqit33wq-uc.a.run.app';
const PHONE_ID = '999999000002'; // temporary routing entry, removed at the end
const BID = process.env.PROBE_BID || 'roshani-pizza';
const OID = process.env.PROBE_OID || 'pizza';

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function secret(name) {
  const bin = GCLOUD.includes(path.sep) ? `"${GCLOUD}"` : GCLOUD;
  return execSync(`${bin} secrets versions access latest --secret=${name} --project=${PROJECT}`, { encoding: 'utf8' });
}

(async () => {
  const appSecret = secret('META_APP_SECRET').trim();

  // A previous failed run could leave entries behind; start clean.
  await db.ref(`businesses/${BID}/outlets/${OID}/webhookInbox`).remove();
  await db.ref(`phoneNumberIndex/${PHONE_ID}`).set({ businessId: BID, outletId: OID });

  const received = [];
  const sock = createMetaTransport({ outlet: OID, phoneNumberId: PHONE_ID, accessToken: 'probe', redisUrl: null });
  sock.ev.on('messages.upsert', (u) => received.push(u));
  await sock.start();

  const message = {
    from: '919999999998',
    id: 'wamid.INBOX_PROBE_' + Date.now(),
    timestamp: String(Math.floor(Date.now() / 1000)),
    type: 'text',
    text: { body: 'INBOX_PROBE_margherita' },
  };
  // Batching proof: Meta may put several messages in one payload. The EC2
  // server only read messages[0]; the port must deliver every one.
  const message2 = {
    ...message,
    id: message.id + '_B',
    text: { body: 'INBOX_PROBE_farmhouse' },
  };
  const payload = {
    object: 'whatsapp_business_account',
    entry: [{
      id: '2589174454849821',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '917485095436', phone_number_id: PHONE_ID },
          contacts: [{ profile: { name: 'Probe' }, wa_id: '919999999998' }],
          messages: [message, message2],
        },
      }],
    }],
  };
  const raw = JSON.stringify(payload);
  const sig = 'sha256=' + crypto.createHmac('sha256', appSecret).update(raw).digest('hex');

  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig },
    body: raw,
  });
  check('POST accepted', res.status === 200, `status=${res.status}`);

  const deadline = Date.now() + 25000;
  while (received.length < 2 && Date.now() < deadline) await sleep(250);

  check('transport drained the queue', received.length === 2, `upserts=${received.length}`);
  const first = received
    .map((u) => u.messages?.[0])
    .find((m) => m?.message?.conversation === 'INBOX_PROBE_margherita');
  const second = received
    .map((u) => u.messages?.[0])
    .find((m) => m?.message?.conversation === 'INBOX_PROBE_farmhouse');
  check('batched message #1 preserved', !!first, JSON.stringify(received.map((u) => u.messages?.[0]?.message)));
  check('batched message #2 preserved (EC2 dropped this)', !!second);
  check('remoteJid is a WhatsApp JID', first?.key?.remoteJid === '919999999998@s.whatsapp.net', first?.key?.remoteJid);
  check('message id preserved', first?.key?.id === message.id, first?.key?.id);
  check('second message keeps its own id', second?.key?.id === message2.id, second?.key?.id);

  await sleep(1500);
  const left = await db.ref(`businesses/${BID}/outlets/${OID}/webhookInbox`).once('value');
  check('queue entry deleted after dispatch', !left.exists(), left.exists() ? 'still queued' : 'empty');

  await sock.stop();
  await db.ref(`phoneNumberIndex/${PHONE_ID}`).remove();

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch(async (e) => {
  console.error('TEST ERROR', e);
  try { await db.ref(`phoneNumberIndex/${PHONE_ID}`).remove(); } catch { /* ignore */ }
  try { await db.ref(`businesses/${BID}/outlets/${OID}/webhookInbox`).remove(); } catch { /* ignore */ }
  process.exit(1);
});
