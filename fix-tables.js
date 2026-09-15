const fs = require('fs');
let content = fs.readFileSync('D:\\Foodhubbie Project\\Admin\\js\\features\\tables.js', 'utf8');
const idx = content.indexOf('Scan');
const endIdx = content.indexOf('</div>', idx) + 6;
const oldLine = content.substring(idx, endIdx);
console.log('Old line:', JSON.stringify(oldLine));
console.log('Old line codes:', [...oldLine].map(c => c.charCodeAt(0)));

const newLine = '                <div class="qr-scan-cta">📷 Scan & Crave</div>';
console.log('New line:', JSON.stringify(newLine));
console.log('New line codes:', [...newLine].map(c => c.charCodeAt(0)));

content = content.replace(oldLine, newLine);
fs.writeFileSync('D:\\Foodhubbie Project\\Admin\\js\\features\\tables.js', content, 'utf8');
console.log('Replaced line');