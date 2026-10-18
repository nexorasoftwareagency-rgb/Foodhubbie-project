// Preload the hero LCP image on index.
const fs = require('fs');
let c = fs.readFileSync('website/index.html', 'utf8');
if (c.includes('<link rel="preload" as="image"')) { console.log('already'); process.exit(0); }
c = c.replace('</title>', '</title>\n<link rel="preload" as="image" href="assets/shots/admin-dashboard.webp" fetchpriority="high">');
fs.writeFileSync('website/index.html', c);
console.log('preload added');
