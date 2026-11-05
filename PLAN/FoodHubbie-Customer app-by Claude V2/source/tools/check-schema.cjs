// Validate every JSON-LD block on all site pages parses.
const fs = require('fs');
let n = 0;
for (const f of fs.readdirSync('website').filter(f => f.endsWith('.html'))) {
  const c = fs.readFileSync('website/' + f, 'utf8');
  const blocks = [...c.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => m[1]);
  blocks.forEach((b, i) => { JSON.parse(b); n++; });
}
console.log('OK blocks parsed:', n);
