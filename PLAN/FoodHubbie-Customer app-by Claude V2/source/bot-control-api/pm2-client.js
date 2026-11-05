/**
 * Single shared PM2 daemon connection for the whole process.
 *
 * The first draft had every HTTP route call pm2.connect()/pm2.disconnect()
 * per-request while status-watcher.js *also* held its own persistent
 * connection open for the PM2 event bus. Those conflicted: pm2's Node
 * client shares one underlying RPC connection per process, so any
 * request's disconnect() call was silently killing the bus listener the
 * moment anyone clicked Restart or Stop — real-time status would stop
 * updating until the next scheduled reconcile happened to paper over it
 * (or wouldn't, since that reconcile loop's own "already connected"
 * guard had no way to know the connection had died from outside it).
 *
 * Fix: connect exactly once for the process's lifetime, never disconnect
 * except on shutdown. Both server.js and status-watcher.js import this
 * instead of requiring('pm2') directly.
 */

const pm2 = require('pm2');

let connectPromise = null;

function connectOnce() {
  if (!connectPromise) {
    connectPromise = new Promise((resolve, reject) => {
      pm2.connect((err) => (err ? reject(err) : resolve()));
    });
  }
  return connectPromise;
}

function shutdown() {
  console.log('bot-control-api: shutting down, disconnecting from pm2');
  pm2.disconnect();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = { pm2, connectOnce };
