// Quick sanity check for createMetaTransport duck-typing.
// Run: node bot/test-transport.js
const assert = require('assert');
const { createMetaTransport } = require('./transport');

async function main() {
  const sent = [];
  const sock = createMetaTransport({
    outlet: 'pizza',
    phoneNumberId: '1211796118690392',
    accessToken: 'TEST',
    redisUrl: 'redis://localhost:6379'
  });

  // sendMessage: plain phone JID -> strips @ suffix
  const origSend = require('./whatsapp-send');
  origSend.sendWhatsAppMessage = async (_p, _t, to, text) => { sent.push([to, text]); return { id: 'wamid.x' }; };

  await sock.sendMessage('919724649971@s.whatsapp.net', { text: 'hello' });
  assert.deepStrictEqual(sent[0], ['919724649971', 'hello'], 'plain phone JID should be stripped');

  // ev.on stores handlers
  let fired = null;
  sock.ev.on('connection.update', (u) => { fired = u; });
  assert.ok(!fired, 'handler stored, not fired yet');

  // sendMessage image URL -> routed to image sender
  origSend.sendWhatsAppImage = async (_p, _t, to, url, cap) => { sent.push([to, 'IMG:' + url, cap]); return { id: 'wamid.i' }; };
  await sock.sendMessage('919724649971', { image: 'https://example.com/p.png', caption: 'cap' });
  assert.deepStrictEqual(sent[1], ['919724649971', 'IMG:https://example.com/p.png', 'cap'], 'image URL path');

  // text fallback when image has no URL
  await sock.sendMessage('919724649971', { image: Buffer.from('x'), caption: 'cap2' });
  assert.deepStrictEqual(sent[2], ['919724649971', 'cap2'], 'image buffer -> text fallback');

  // readMessages / sendPresenceUpdate are no-ops (must not throw)
  await sock.readMessages(['919724649971']);
  await sock.sendPresenceUpdate('composing', '919724649971');

  // meta user/ws shape
  assert.strictEqual(sock.user.id, 'meta:1211796118690392');
  assert.ok(sock.ws.isOpen);

  // sendButton -> interactive URL button
  origSend.sendWhatsAppUrlButton = async (_p, _t, to, opts) => { sent.push([to, 'BTN:' + opts.url, opts.title]); return { id: 'wamid.b' }; };
  await sock.sendButton('919724649971', { body: 'Order', url: 'https://menu.test/x', title: 'Order Now' });
  assert.deepStrictEqual(sent[3], ['919724649971', 'BTN:https://menu.test/x', 'Order Now'], 'url button path');

  console.log('transport.js sanity checks passed');
}

main().catch((e) => { console.error('FAIL', e); process.exit(1); });
