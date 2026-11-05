// Phase 1: add canonical + GA4 include to the 5 website pages.
const fs = require('fs');
const pages = {
  'website/index.html': 'https://foodhubbie-web.web.app/',
  'website/signup.html': 'https://foodhubbie-web.web.app/signup.html',
  'website/architecture.html': 'https://foodhubbie-web.web.app/architecture.html',
  'website/book.html': 'https://foodhubbie-web.web.app/book.html',
  'website/contact.html': 'https://foodhubbie-web.web.app/contact.html',
};
for (const [f, url] of Object.entries(pages)) {
  let c = fs.readFileSync(f, 'utf8');
  if (c.includes('rel="canonical"')) { console.log(f, 'already has canonical'); continue; }
  const canon = '\n<link rel="canonical" href="' + url + '">';
  const ga = '<script type="module" src="shared/ga4.js"></script>';
  c = c.replace(/(<meta name="description"[^>]*>)/, '$1' + canon);
  c = c.replace('</head>', ga + '\n</head>');
  fs.writeFileSync(f, c);
  console.log(f, '->', url, '(ga4 added)');
}
