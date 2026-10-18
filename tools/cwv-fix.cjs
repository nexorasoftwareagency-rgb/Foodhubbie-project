// CWV fixes: eager hero image + non-blocking Google Fonts on all 5 pages.
const fs = require('fs');
const pages = ['website/index.html', 'website/signup.html', 'website/architecture.html', 'website/book.html', 'website/contact.html'];
for (const f of pages) {
  let c = fs.readFileSync(f, 'utf8');
  // 1) hero LCP image: eager + fetchpriority
  c = c.replace(
    /<img src="assets\/shots\/admin-dashboard\.webp" alt="FoodHubbie Admin Dashboard[^"]*" loading="lazy">/,
    '<img src="assets/shots/admin-dashboard.webp" alt="FoodHubbie Admin Dashboard — real-time KPIs, multi-outlet management" fetchpriority="high" decoding="async">'
  );
  // 2) fonts stylesheet non-blocking
  c = c.replace(
    /<link href="(https:\/\/fonts\.googleapis\.com\/[^"]*)" rel="stylesheet">/,
    '<link rel="preload" as="style" href="$1"><link href="$1" rel="stylesheet" media="print" onload="this.media=\'all\'"><noscript><link href="$1" rel="stylesheet"></noscript>'
  );
  fs.writeFileSync(f, c);
  console.log(f, ': hero fix=' + /fetchpriority/.test(c) + ' fonts-async=' + /media="print" onload/.test(c));
}
