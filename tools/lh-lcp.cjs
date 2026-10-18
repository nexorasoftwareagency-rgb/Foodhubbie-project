const os = require('os');
const path = require('path');
const r = require(path.join(os.tmpdir(), 'opencode', 'lh', 'home.json'));
const a = r.audits['largest-contentful-paint-element'];
if (a && a.details) {
  const raw = JSON.stringify(a.details);
  const snips = raw.match(/snippet[^,]{0,220}/g) || [];
  console.log(snips.slice(0, 8).join('\n\n'));
  console.log('phases:', (a.details.items || []).map(i => i.phase).join(' | '));
}
console.log('render-blocking:', JSON.stringify((r.audits['render-blocking-resources'] || { details: { items: [] } }).details.items.map(i => i.url), null, 1));
console.log('lcp-breakdown:', JSON.stringify((r.audits['lcp-lazy-loaded'] || {}).warnings, null, 1));
const misc = r.audits['uses-responsive-images'] || r.audits['modern-image-formats'] || { details: { items: [] } };
console.log('big-images:', JSON.stringify((misc.details || { items: [] }).items.map(i => i.url + ' ' + Math.round(i.wastedBytes / 1024) + 'KB').slice(0, 5)));
const tti = r.audits['network-requests'];
if (tti && tti.details) {
  const imgs = tti.details.items.filter(i => i.resourceType === 'Image').map(i => (i.url.split('/').pop()) + ' ' + Math.round(i.resourceSize / 1024) + 'KB');
  console.log('image sizes:', JSON.stringify(imgs, null, 1));
}
